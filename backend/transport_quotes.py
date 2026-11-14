"""Provider-sourced, read-only transport quotes."""

import asyncio
import os
import re
from datetime import datetime, time, timedelta, timezone

import httpx


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
    allowed = (["BUS", "TRAIN"] if not local and not modes else
               [vehicle for mode, vehicle in (("bus", "BUS"), ("rail", "TRAIN")) if mode in modes])
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


async def flights(client, origin, destination, travel_date, travelers):
    key, secret = os.getenv("AMADEUS_CLIENT_ID"), os.getenv("AMADEUS_CLIENT_SECRET")
    if not (key and secret):
        return {"source": "Amadeus", "status": "unconfigured"}
    def airport(value):
        if re.fullmatch(r"[A-Za-z]{3}", value):
            return value.upper()
        match = re.search(r"\(([A-Z]{3})\)$", value)
        return match.group(1) if match else None
    start, end = airport(origin), airport(destination)
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
            tasks["flights"] = fetch(flights(client, origin, destination, travel_date, travelers), "Amadeus")
        return dict(zip(tasks, await asyncio.gather(*tasks.values()), strict=True))
