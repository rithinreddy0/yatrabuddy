"""Provider-sourced, read-only transport quotes."""

import asyncio
import os
import re
from datetime import datetime, time, timedelta, timezone
from math import isfinite

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .auth import limit
from .source_cache import SourceCache

router = APIRouter(prefix="/api")
transit_cache = SourceCache(200)


def transit_point(value):
    try:
        latitude, longitude = map(float, value.split(","))
    except (ValueError, TypeError):
        raise HTTPException(422, "Enter coordinates as latitude,longitude.") from None
    if not (isfinite(latitude) and isfinite(longitude) and -90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(422, "Enter valid latitude and longitude.")
    return f"{latitude:.6f},{longitude:.6f}"


@router.get("/transit/plan")
async def transit_plan(request: Request, origin: str = Query(max_length=50), destination: str = Query(max_length=50),
                       departure: datetime | None = None):
    """Look up scheduled journeys for a mapped itinerary leg through Transitous."""
    limit(request, "transit-plan", 20, 60)
    start, end = transit_point(origin), transit_point(destination)
    if start == end:
        raise HTTPException(422, "Choose two different places.")
    if departure and (departure.tzinfo is None or departure < datetime.now(timezone.utc)):
        raise HTTPException(422, "Choose a future departure time with a time zone.")
    params = {"fromPlace": start, "toPlace": end, "numItineraries": 5, "directModes": "WALK"}
    if departure:
        params["time"] = departure.isoformat()
    cache_key = tuple(params.items())
    cached = transit_cache.get(cache_key, 60)
    if cached is not None:
        return cached
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "YatraBuddy/1.0 (travel planner)"}) as client:
            response = await client.get("https://api.transitous.org/api/v6/plan", params=params)
            response.raise_for_status()
            itineraries = response.json().get("itineraries") or []
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        raise HTTPException(503, "Transitous schedules are unavailable. Try again shortly.") from error
    options = []
    for itinerary in itineraries[:5]:
        if not isinstance(itinerary, dict):
            continue
        legs = []
        for leg in itinerary.get("legs") or []:
            if not isinstance(leg, dict) or leg.get("mode") == "WALK":
                continue
            legs.append({"operator": leg.get("agencyName"), "service": leg.get("displayName") or leg.get("routeShortName"),
                         "vehicle": leg.get("mode"), "direction": leg.get("headsign"),
                         "board": {"name": (leg.get("from") or {}).get("name"),
                                   "time": (leg.get("from") or {}).get("departure") or (leg.get("from") or {}).get("scheduledDeparture")},
                         "alight": {"name": (leg.get("to") or {}).get("name"),
                                    "time": (leg.get("to") or {}).get("arrival") or (leg.get("to") or {}).get("scheduledArrival")}})
        if legs:
            start_time, end_time = itinerary.get("startTime"), itinerary.get("endTime")
            try:
                duration = max(0, round((datetime.fromisoformat(end_time.replace("Z", "+00:00")) -
                                          datetime.fromisoformat(start_time.replace("Z", "+00:00"))).total_seconds()))
            except (AttributeError, TypeError, ValueError):
                duration = 0
            options.append({"duration": f"{duration}s", "legs": legs})
    result = {"source": "Transitous", "status": "ready" if options else "empty", "options": options,
              "checkedAt": datetime.now(timezone.utc).isoformat(), "searchedAt": departure.isoformat() if departure else None}
    return transit_cache.put(cache_key, result)

GOA_AIRPORTS = ("GOI", "GOX")
AIRPORT_ALIASES = {
    **dict.fromkeys(("goa", "old goa", "panaji", "panjim", "palolem", "margao"), GOA_AIRPORTS),
    **dict.fromkeys(("hyderabad", "secunderabad"), ("HYD",)),
    "mumbai": ("BOM",), "delhi": ("DEL",), "new delhi": ("DEL",),
    "bengaluru": ("BLR",), "bangalore": ("BLR",), "kochi": ("COK",),
    "pune": ("PNQ",), "chennai": ("MAA",), "kolkata": ("CCU",), "singapore": ("SIN",),
}


def airports(value):
    if re.fullmatch(r"[A-Za-z]{3}", value):
        return (value.upper(),)
    if match := re.search(r"\(([A-Za-z]{3})\)$", value):
        return (match[1].upper(),)
    return AIRPORT_ALIASES.get(value.partition(",")[0].strip().casefold(), ())


def endpoint(stop, timestamp):
    return {"name": stop.get("name"), "time": timestamp}


def transit_options(data):
    options = []
    for route in data.get("routes", []):
        legs = []
        for group in route.get("legs", []):
            for step in group.get("steps", []):
                detail = step.get("transitDetails")
                if not detail:
                    continue
                stops = detail.get("stopDetails", {})
                local_times = detail.get("localizedValues", {})
                line = detail.get("transitLine", {})
                agencies = line.get("agencies", [])
                legs.append({"operator": ", ".join(item["name"] for item in agencies if item.get("name")),
                             "operatorUrl": next((item["uri"] for item in agencies if item.get("uri")), None),
                             "service": line.get("nameShort") or line.get("name"),
                             "vehicle": line.get("vehicle", {}).get("type"),
                             "direction": detail.get("headsign"),
                             "board": {**endpoint(stops.get("departureStop", {}), stops.get("departureTime")),
                                       "timeZone": local_times.get("departureTime", {}).get("timeZone")},
                             "alight": {**endpoint(stops.get("arrivalStop", {}), stops.get("arrivalTime")),
                                        "timeZone": local_times.get("arrivalTime", {}).get("timeZone")}})
        if legs:
            fare = route.get("travelAdvisory", {}).get("transitFare", {})
            price = None
            if fare.get("currencyCode"):
                price = {"amount": int(fare.get("units", 0)) + fare.get("nanos", 0) / 1e9, "currency": fare["currencyCode"]}
            options.append({"legs": legs, "price": price, "duration": route.get("duration"), "metres": route.get("distanceMeters")})
    return options


def waypoint(value):
    match = re.fullmatch(r"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)", value)
    if match and abs(float(match[1])) <= 90 and abs(float(match[2])) <= 180:
        return {"location": {"latLng": {"latitude": float(match[1]), "longitude": float(match[2])}}}
    return {"address": value}


async def transit(client, origin, destination, departure, local, modes):
    key = os.getenv("GOOGLE_ROUTES_API_KEY")
    if not key:
        return {"source": "Google Routes", "status": "unconfigured"}
    payload = {"origin": waypoint(origin), "destination": waypoint(destination), "travelMode": "TRANSIT",
               "computeAlternativeRoutes": True}
    if departure:
        payload["departureTime"] = departure.isoformat()
    allowed = [vehicle for mode, vehicle in (("bus", "BUS"), ("rail", "TRAIN")) if mode in modes]
    if allowed:
        payload["transitPreferences"] = {"allowedTravelModes": allowed}
    response = await client.post("https://routes.googleapis.com/directions/v2:computeRoutes", json=payload, headers={
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.travelAdvisory.transitFare,routes.legs.steps.transitDetails",
    })
    response.raise_for_status()
    options = transit_options(response.json())
    return {"source": "Google Routes", "status": "ready" if options else "empty", "options": options,
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "searchedAt": departure.isoformat() if departure else None}


async def duffel_flights(client, token, origin, destination, travel_date, travelers):
    groups = [(a, b) for a in airports(origin) for b in airports(destination) if a != b]
    if not groups:
        return {"source": "Duffel", "status": "need_airports"}
    if not travel_date:
        return {"source": "Duffel", "status": "need_date"}
    if travel_date < datetime.now(timezone.utc).date():
        return {"source": "Duffel", "status": "need_time"}
    if travelers and travelers > 9:
        return {"source": "Duffel", "status": "need_group_search"}
    async def offers(start, end):
        response = await client.post("https://api.duffel.com/air/offer_requests",
            params={"supplier_timeout": 6500, "return_offers": "true"}, timeout=10,
            headers={"Authorization": "Bearer " + token, "Duffel-Version": "v2"},
            json={"data": {"slices": [{"origin": start, "destination": end, "departure_date": travel_date.isoformat()}],
                           "passengers": [{"type": "adult"} for _ in range(travelers or 1)],
                           "cabin_class": "economy", "max_connections": 1}})
        response.raise_for_status()
        data = response.json()["data"]
        if not data.get("live_mode"):
            return []
        result = []
        for offer in data.get("offers", []):
            itinerary = next(iter(offer.get("slices", [])), {})
            legs = []
            for segment in itinerary.get("segments", []):
                carrier = segment["marketing_carrier"]
                legs.append({"operator": carrier["name"], "service": (carrier.get("iata_code") or "") + segment["marketing_carrier_flight_number"],
                             "vehicle": "Flight",
                             "board": {**endpoint({"name": segment["origin"]["iata_code"]}, segment["departing_at"]),
                                       "terminal": segment.get("origin_terminal")},
                             "alight": {**endpoint({"name": segment["destination"]["iata_code"]}, segment["arriving_at"]),
                                        "terminal": segment.get("destination_terminal")}})
            if legs:
                result.append({"legs": legs, "price": {"amount": offer["total_amount"], "currency": offer["total_currency"]},
                               "duration": itinerary.get("duration"), "partyTotal": True, "expiresAt": offer.get("expires_at")})
        return result[:4]
    responses = await asyncio.gather(*(offers(*group) for group in groups), return_exceptions=True)
    options = [option for group in responses if isinstance(group, list) for option in group]
    status = "ready" if options else "empty" if any(isinstance(group, list) for group in responses) else "unavailable"
    return {"source": "Duffel", "status": status, "options": options[:8], "checkedAt": datetime.now(timezone.utc).isoformat()}


async def flights(client, origin, destination, travel_date, travelers):
    if token := os.getenv("DUFFEL_ACCESS_TOKEN"):
        return await duffel_flights(client, token, origin, destination, travel_date, travelers)
    key, secret = os.getenv("AMADEUS_CLIENT_ID"), os.getenv("AMADEUS_CLIENT_SECRET")
    if not (key and secret):
        return {"source": "Duffel", "status": "unconfigured"}
    start, end = next(iter(airports(origin)), None), next(iter(airports(destination)), None)
    if not (start and end and travel_date):
        return {"source": "Amadeus", "status": "need_airports"}
    if travel_date < datetime.now(timezone.utc).date():
        return {"source": "Amadeus", "status": "need_time"}
    base = "https://api.amadeus.com"
    token = await client.post(base + "/v1/security/oauth2/token", data={
        "grant_type": "client_credentials", "client_id": key, "client_secret": secret,
    })
    token.raise_for_status()
    response = await client.get(base + "/v2/shopping/flight-offers", headers={
        "Authorization": "Bearer " + token.json()["access_token"],
    }, params={"originLocationCode": start, "destinationLocationCode": end, "departureDate": travel_date.isoformat(),
               "adults": travelers or 1, "max": 4})
    response.raise_for_status()
    data = response.json()
    carriers = data.get("dictionaries", {}).get("carriers", {})
    options = []
    for offer in data.get("data", []):
        itinerary = next(iter(offer.get("itineraries", [])), {})
        legs = []
        for segment in itinerary.get("segments", []):
            a, b = segment["departure"], segment["arrival"]
            carrier = segment["carrierCode"]
            legs.append({"operator": carriers.get(carrier, carrier), "service": carrier + segment["number"], "vehicle": "Flight",
                         "board": {**endpoint({"name": a["iataCode"]}, a["at"]), "terminal": a.get("terminal")},
                         "alight": {**endpoint({"name": b["iataCode"]}, b["at"]), "terminal": b.get("terminal")}})
        if legs:
            price = offer["price"]
            options.append({"legs": legs, "price": {"amount": price.get("grandTotal") or price["total"], "currency": price["currency"]},
                            "duration": itinerary.get("duration"), "partyTotal": True})
    return {"source": "Amadeus", "status": "ready" if options else "empty", "options": options,
            "checkedAt": datetime.now(timezone.utc).isoformat()}


async def driving(client, origin, destination, departure=None):
    if not (key := os.getenv("GOOGLE_ROUTES_API_KEY")):
        return {"source": "Google Routes", "status": "unconfigured"}
    payload = {"origin": waypoint(origin), "destination": waypoint(destination), "travelMode": "DRIVE",
               "routingPreference": "TRAFFIC_AWARE"}
    if departure and departure.tzinfo and departure > datetime.now(timezone.utc):
        payload["departureTime"] = departure.isoformat()
    response = await client.post("https://routes.googleapis.com/directions/v2:computeRoutes", json=payload, headers={
        "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    })
    response.raise_for_status()
    route = next(iter(response.json().get("routes", [])), None)
    if not route or not route.get("duration") or not isinstance(route.get("distanceMeters"), int):
        return {"source": "Google Routes", "status": "empty"}
    return {"source": "Google Routes", "status": "ready", "metres": route["distanceMeters"],
            "duration": route["duration"], "checkedAt": datetime.now(timezone.utc).isoformat()}


async def transport_quotes(origin, destination, *, travel_date=None, departure=None, travelers=None, local=False, modes=(), country=None):
    if not origin or not destination or origin.casefold() == destination.casefold():
        return {}
    modes = (modes,) if isinstance(modes, str) else modes or ()
    async with httpx.AsyncClient(timeout=5) as client:
        async def fetch(call, source):
            try:
                return await call
            except (httpx.HTTPError, TypeError, ValueError, KeyError):
                return {"source": source, "status": "unavailable"}
        tasks = {}
        if local or not modes or {"rail", "bus"}.intersection(modes):
            stamp = departure
            if not stamp and travel_date and country and country.casefold() == "india":
                stamp = datetime.combine(travel_date, time(8), timezone(timedelta(hours=5, minutes=30)))
            if travel_date and not stamp:
                tasks["transit"] = asyncio.sleep(0, result={"source": "Google Routes", "status": "need_time"})
            elif stamp and (stamp.tzinfo is None or stamp < datetime.now(timezone.utc)):
                tasks["transit"] = asyncio.sleep(0, result={"source": "Google Routes", "status": "need_time"})
            else:
                def transit_place(value):
                    match = re.fullmatch(r"[A-Za-z]{3}|.*\(([A-Z]{3})\)", value)
                    return (match[1] or value.upper()) + " airport" if match else value
                start, end = (origin, destination) if local else (transit_place(origin), transit_place(destination))
                tasks["transit"] = fetch(transit(client, start, end, stamp, local, modes), "Google Routes")
        if not local and (not modes or "flight" in modes):
            tasks["flights"] = fetch(flights(client, origin, destination, travel_date, travelers),
                                     "Duffel" if os.getenv("DUFFEL_ACCESS_TOKEN") else "Amadeus")
        if not local and (not modes or {"drive", "ride"}.intersection(modes)) and os.getenv("GOOGLE_ROUTES_API_KEY"):
            if not any(re.fullmatch(r"[A-Za-z]{3}|.*\([A-Za-z]{3}\)", city) for city in (origin, destination)):
                tasks["driving"] = fetch(driving(client, origin, destination, departure), "Google Routes")
        return dict(zip(tasks, await asyncio.gather(*tasks.values()), strict=True))
