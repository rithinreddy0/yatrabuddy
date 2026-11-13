import asyncio
import json
import logging
import re
from datetime import date
from math import asin, cos, isfinite, radians, sin, sqrt
from time import monotonic, time
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints

from .agents import USER_AGENT, route_points
from . import gemini_planning, groq_planning
from .auth import limit
from .locations import compact, lookup
from .models import LocalMode, MealPreference, Pace, TripParty, WorldwideDraft
from .open_places import osm_places
from .source_cache import SourceCache, source_result
from .wikivoyage import travel_listings


router = APIRouter(prefix="/api")
RADIUS_METRES = 10_000
ENCYCLOPEDIA_CATEGORIES = {
    "Stay": re.compile(r"\b(hotel|hostel|guesthouse|resort)\b", re.IGNORECASE),
    "Food": re.compile(r"\b(restaurant|café|cafe|food centre|hawker centre)\b", re.IGNORECASE),
    "Nature": re.compile(r"\b(park|garden|zoo|aquarium|beach|viewpoint|waterfall|lake|hill|nature reserve)\b", re.IGNORECASE),
    "Shopping": re.compile(r"\b(market|bazaar|shopping centre)\b", re.IGNORECASE),
    "Sight": re.compile(
        r"\b(museum|gallery|temple|shrine|castle|palace|fort|monument|memorial|church|"
        r"cathedral|mosque|theat(?:re|er)|landmark|historic (?:house|building|district)|"
        r"tourist attraction|heritage site)\b", re.IGNORECASE,
    ),
}
OUTDOOR_NAMES = re.compile(r"\b(?:national park|nature reserve|wildlife sanctuary|botanical gardens?|public gardens?|waterfall|beach)\b", re.I)
_nearby_cache = {}
logger = logging.getLogger(__name__)
transit_cache = SourceCache(32)
TGSRTC = "https://www.tgsrtc.telangana.gov.in/reservation-marketing-schemes"


def distance_metres(first, second):
    lat1, lat2 = radians(first["lat"]), radians(second["lat"])
    delta_lon = radians(second["lon"] - first["lon"])
    haversine = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    return round(12_742_000 * asin(sqrt(min(1, haversine))))


async def encyclopedia_places(client, city):
    response = await client.get("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "generator": "geosearch", "ggscoord": f"{city['lat']}|{city['lon']}",
        "ggsradius": RADIUS_METRES, "ggslimit": 50, "ggsnamespace": 0,
        "prop": "coordinates|description", "coprimary": "primary", "format": "json", "formatversion": 2,
    })
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise ValueError("Wikipedia geosearch failed")
    places = []
    for page in payload.get("query", {}).get("pages", []):
        coordinates = page.get("coordinates")
        description = page.get("description", "")
        label = f"{page['title']} {description}"
        category = next((name for name, pattern in ENCYCLOPEDIA_CATEGORIES.items() if pattern.search(label)), None)
        if not coordinates or not category:
            continue
        places.append({
            "name": page["title"], "category": category, "description": description,
            "lat": coordinates[0]["lat"], "lon": coordinates[0]["lon"], "source": "Wikipedia",
            "url": f"https://en.wikipedia.org/wiki/{quote(page['title'].replace(' ', '_'), safe='')}",
        })
    return places


def nearby_results(city, lookups):
    radius = 100_000 if city.get("kind") == "region" else RADIUS_METRES
    results = {}
    for lookup_result in lookups:
        if isinstance(lookup_result, BaseException):
            continue
        for item in lookup_result:
            if not item["name"] or not all(isinstance(item.get(axis), (int, float))
                                           and isfinite(item[axis]) for axis in ("lat", "lon")):
                continue
            if item["category"] in {"Sight", "Activity"} and OUTDOOR_NAMES.search(item["name"]):
                item = {**item, "category": "Nature"}
            distance = distance_metres(city, item)
            if distance > radius:
                continue
            short_name = item["name"].split(",", 1)[0]
            key = re.sub(r"[\W_]+", "", short_name.casefold())
            previous = results.get(key)
            if previous and distance_metres(previous, item) > 250:
                key = item["url"]
                previous = results.get(key)
            if previous:
                # Other sources may have an exact image or article link that the primary listing lacks.
                for field in ("articleTitle", "commonsFile"):
                    if not previous.get(field) and item.get(field):
                        previous[field] = item[field]
            else:
                results[key] = {**item, "distanceMetres": distance}
    places = sorted(results.values(), key=lambda item: item["distanceMetres"])

    def shortlist(categories, size, guide_slots):
        matching = [item for item in places if item["category"] in categories]
        linked = [item for item in matching if item.get("commonsFile") or item.get("articleTitle")
                  or item["source"] == "Wikipedia"]
        guide = [item for item in matching if item["source"] == "Wikivoyage" and item.get("description")]
        chosen = {}
        for item in [*linked[:guide_slots], *guide[:guide_slots], *matching]:
            chosen.setdefault(item["url"], item)
            if len(chosen) == size:
                break
        return list(chosen.values())

    # A dense historic district can otherwise crowd all the outdoor results out of the feed.
    outdoors = shortlist({"Nature", "Activity"}, 10, 4)
    sights = shortlist({"Sight", "Shopping"}, 14, 6)
    remaining = shortlist({"Nature", "Activity", "Sight", "Shopping"}, 24, 8)
    visits = {item["url"]: item for item in [*sights, *outdoors, *remaining]}
    return (list(visits.values())[:24] + shortlist({"Food"}, 8, 3)
            + shortlist({"Stay"}, 8, 3))


@router.get("/locations/{location_id}/nearby")
async def nearby(location_id: int, request: Request, meal: MealPreference = "No preference", photos: bool = True):
    limit(request, "nearby-places", 12, 60)
    from .place_photos import attach_place_photos

    report = await nearby_report(location_id)
    places = await add_meal_results(report, [place.copy() for place in report["places"]], meal)
    if photos:
        try:
            async with asyncio.timeout(7), httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
                await attach_place_photos(client, places, report["location"]["name"])
        except TimeoutError:
            pass
    return {**report, "places": places, "status": "partial" if places and report["status"] == "unavailable" else report["status"]}


async def add_meal_results(report, places, meal):
    if meal != "No preference":
        from .place_search import lookup_places
        try:
            async with asyncio.timeout(7):
                food = await lookup_places(f"{meal} restaurants in {report['location']['name']}",
                                           "food", location_id=report["location"]["id"], public_only=True,
                                           include_photos=False)
            seen = {place["url"] for place in places}
            for place in food["places"]:
                if (place["source"] in {"Wikipedia", "Wikivoyage", "OpenStreetMap"} and place["url"] not in seen
                        and meal.casefold() in f"{place['name']} {place.get('description') or ''}".casefold()
                        and place["lat"] is not None and place["lon"] is not None):
                    places.append({**place, "distanceMetres": distance_metres(report["location"], place)})
                    seen.add(place["url"])
        except (TimeoutError, httpx.HTTPError, HTTPException, KeyError, ValueError, TypeError):
            pass
    return places


async def nearby_report(location_id):
    cached = _nearby_cache.get(location_id)
    if cached and monotonic() - cached[0] < 300:
        return source_result(cached[1], "cached")

    try:
        async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            city = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
            async def bounded_lookup(lookup_result):
                async with asyncio.timeout(6.5):
                    return await lookup_result

            providers = await asyncio.gather(
                bounded_lookup(travel_listings(client, city, include_districts=True)),
                bounded_lookup(encyclopedia_places(client, city)),
                bounded_lookup(osm_places(client, city)),
                return_exceptions=True,
            )
    except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(503, "Could not locate this city for the nearby search.") from error

    places = nearby_results(city, providers)
    failed_count = sum(isinstance(result, BaseException) for result in providers)
    status = "partial" if places and failed_count else "ready" if places else "unavailable" if failed_count else "empty"
    report = source_result({"location": city, "places": places, "status": status})
    if not places and cached and cached[1]["places"] and monotonic() - cached[0] < 86400:
        return {**cached[1], "status": "partial", "freshness": "cached"}
    if places:
        if len(_nearby_cache) >= 128:
            _nearby_cache.pop(next(iter(_nearby_cache)))
        _nearby_cache[location_id] = (monotonic(), report)
    return report


@router.get("/locations/{location_id}/local-transport")
async def local_transport(location_id: int, request: Request):
    limit(request, "local-transport", 16, 60)
    return await transit_passes(location_id)


async def transit_passes(location_id):
    if cached := transit_cache.get(location_id, 3600):
        return source_result(cached, "cached")
    async with httpx.AsyncClient(timeout=5, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        try:
            city = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as error:
            raise HTTPException(503, "Could not verify the city for local transport.") from error
        if city["country"] != "India" or city["name"].casefold() not in {"hyderabad", "secunderabad"}:
            return {"passes": []}
        try:
            response = await client.get(TGSRTC)
            response.raise_for_status()
            page = re.sub(r"<[^>]+>", " ", response.text)
            fares = re.search(
                r"Tariff of Non\s*AC ticket is priced at Rs\.?\s*(\d+)\s*/-"
                r".{0,400}?AC Travel-24 is priced at Rs\.?\s*(\d+)\s*/-", page, re.I | re.S,
            )
            if fares:
                passes = [{"name": label, "amount": int(value), "url": TGSRTC}
                          for label, value in zip(("Travel-24 non-AC", "Travel-24 including AC"), fares.groups())]
                return transit_cache.put(location_id, source_result({"passes": passes}))
        except httpx.HTTPError:
            pass
    cached = transit_cache.get(location_id, 86400)
    return source_result(cached, "cached") if cached else {"passes": []}


class CityResearch(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
    mealPreference: MealPreference = "No preference"
    localModes: list[LocalMode] = Field(default_factory=list, max_length=5)
    stops: list[Annotated[str, StringConstraints(max_length=220)]] = Field(default_factory=list, max_length=25)
    departure: date | None = None
    days: int | None = Field(default=None, ge=1, le=5)
    travelers: int | None = Field(default=None, ge=1, le=8)
    budget: int | None = Field(default=None, ge=1000, le=10_000_000)


@router.post("/locations/{location_id}/groq-research")
async def groq_research(location_id: int, selection: CityResearch, request: Request):
    limit(request, "groq-city-research", 12, 60)
    async with httpx.AsyncClient(timeout=18, headers={"User-Agent": USER_AGENT}) as client:
        try:
            city = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            raise HTTPException(503, "Could not verify the selected city.") from error
        return await groq_planning.browse(client, selection.query, {
            "city": city["name"], "region": city["region"], "country": city["country"],
            **selection.model_dump(mode="json", exclude={"query"}, exclude_none=True),
        })


PlaceKey = Annotated[str, StringConstraints(min_length=1, max_length=1800)]


class WorldwideSelection(BaseModel):
    stops: list[PlaceKey] = Field(min_length=1, max_length=25)
    stay: PlaceKey | None = None
    days: int = Field(ge=1, le=5)
    departure: date | None = None
    origin: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    travelers: int = Field(default=1, ge=1, le=8)
    party: TripParty | None = None
    budget: int | None = Field(default=None, ge=1000, le=10_000_000)
    mealPreference: MealPreference = "No preference"
    localModes: list[LocalMode] = Field(default_factory=list, max_length=5)
    pace: Pace = "Balanced"
    interests: list[Annotated[str, StringConstraints(max_length=30)]] = Field(default_factory=list, max_length=4)
    mobility: Literal["No preference", "Less walking", "Step-free when possible"] | None = None
    stopCosts: dict[PlaceKey, Annotated[int, Field(ge=0, le=10_000_000)]] = Field(default_factory=dict, max_length=25)


def ordered_day(points):
    return sorted(points, key=lambda point: bool(re.search(
        r"\b(?:sunset|evening|night (?:cruise|market|tour|walk)|dinner)\b", point.get("name", ""), re.I
    )))


def group_draft_stops(stops, days, base, capacity=5):
    remaining = list(stops)
    itinerary = []
    for index in range(days):
        days_left = days - index
        count = (len(remaining) + days_left - 1) // days_left
        day = []
        while len(day) < count:
            anchor = day[-1] if day else base
            stop = min(remaining, key=lambda candidate: distance_metres(anchor, candidate))
            if day and days_left > 1 and len(remaining) <= (days_left - 1) * capacity:
                other = [point for point in remaining if point is not stop]
                if other and distance_metres(anchor, stop) > 2 * min(distance_metres(stop, point) for point in other):
                    break
            remaining.remove(stop)
            day.append(stop)
        # Keep a nearby stop with its cluster when the remaining days have room.
        while day and remaining and len(day) < capacity and len(remaining) >= days_left:
            nearest = min(remaining, key=lambda candidate: distance_metres(day[-1], candidate))
            outside = [point for point in remaining if point is not nearest]
            within = distance_metres(day[-1], nearest)
            if not outside or within >= min(distance_metres(nearest, point) for point in outside):
                break
            day.append(nearest)
            remaining.remove(nearest)
        # Keep evening experiences in their geographic cluster, after daytime stops.
        itinerary.append(ordered_day(day))
    return itinerary


async def estimate_day_route(day, stay, *, include_geometry=False):
    points = [stay, *day] if stay and day else day
    if len(points) < 2:
        return ([], []) if include_geometry else []
    route = await route_points(points, include_geometry=True) if include_geometry else await route_points(points)
    if route:
        legs = [{"minutes": minutes, "kilometres": km, "method": "road"}
                for minutes, km in zip(route["legMinutes"], route["legKilometres"])]
    else:
        legs = [{"kilometres": round(distance_metres(start, end) / 1000, 1),
                 "minutes": max(5, round(distance_metres(start, end) / 1000 * 60 / 20)),
                 "method": "straight-line"}
                for start, end in zip(points, points[1:])]
    return (legs, (route or {}).get("geometry", [])) if include_geometry else legs


async def itinerary_advice(city, selection, days, routes):
    credentials = groq_planning.config()
    if not credentials:
        return None
    context = {
        "city": city["name"], "country": city["country"],
        "preferences": selection.model_dump(mode="json", exclude={"stops", "stay", "stopCosts"}),
        "days": [[{"name": stop["name"], "category": stop["category"]} for stop in day] for day in days],
        "legs": routes,
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            reply = await groq_planning.generate(client, *credentials, [
                {"role": "user", "parts": [{"text": json.dumps(context, ensure_ascii=False)}]},
            ], itinerary_review=True)
        advice = gemini_planning.safe_answer(" ".join(part.get("text", "") for part in reply["parts"]))
        if advice and len(advice) <= 600:
            return advice
        logger.info("Groq itinerary advice did not pass validation")
    except (TimeoutError, httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        logger.info("Groq itinerary advice unavailable")
        return None


@router.post("/locations/{location_id}/draft", response_model=WorldwideDraft)
async def build_draft(location_id: int, selection: WorldwideSelection, request: Request):
    limit(request, "worldwide-draft", 20, 60)
    return await prepare_draft(location_id, selection, with_advice=True)


async def prepare_draft(location_id, selection, *, with_advice=False, fit_annotations=None, weather=None,
                        weather_status="not_requested", weather_note=None, report=None, distribute_meals=False):
    from .place_photos import cached_place_photo
    from .place_search import verified_place

    capacity = {"Relaxed": 3, "Balanced": 4, "Packed": 5}[selection.pace]
    if len(set(selection.stops)) != len(selection.stops) or len(selection.stops) > selection.days * capacity:
        raise HTTPException(422, f"Choose unique stops and up to {capacity} per day at this pace.")
    if not set(selection.stopCosts) <= set(selection.stops):
        raise HTTPException(422, "Enter costs only for selected stops.")
    if report is None:
        report = await nearby_report(location_id)
    city = report["location"]
    candidates = list(report["places"])
    known = {place["url"] for place in candidates}
    radius = 110_000 if city.get("kind") == "region" else 40_000
    for key in [*selection.stops, selection.stay]:
        if key and key not in known and (place := verified_place(key)):
            if place.get("lat") is not None and place.get("lon") is not None and distance_metres(city, place) <= radius:
                candidates.append(place)
                known.add(key)
    if any(key not in known for key in selection.stops):
        candidates = await add_meal_results(report, candidates, selection.mealPreference)
    if report["status"] == "unavailable" and not candidates:
        raise HTTPException(503, "The place sources are unavailable. Try again shortly.")
    places = {place["url"]: {**place, "photo": place.get("photo") or cached_place_photo(place["url"])}
              for place in candidates}
    for key, annotation in (fit_annotations or {}).items():
        if key in places:
            places[key].update(annotation)
    if any(key not in places or places[key]["category"] == "Stay" for key in selection.stops):
        raise HTTPException(422, "One or more stops are missing from the current city results.")
    stay = places.get(selection.stay)
    if selection.stay and (stay is None or stay["category"] != "Stay"):
        raise HTTPException(422, "Choose a stay from the current city results.")
    selected = [places[key] for key in selection.stops]
    if distribute_meals:
        meals = [place for place in selected if place["category"] == "Food"]
        visits = [place for place in selected if place["category"] != "Food"]
        days = group_draft_stops(visits, selection.days, stay or city, capacity - 1 if meals else capacity)
        for meal in meals:
            options = [day for day in days if len(day) < capacity and all(stop["category"] != "Food" for stop in day)]
            if not options:
                break
            day = min(options, key=lambda stops: (not bool(stops), min(distance_metres(meal, stop) for stop in (stops or [stay or city]))))
            insert_at = min(range(1, len(day) + 1), key=lambda i: distance_metres(day[i - 1], meal), default=0)
            day.insert(insert_at, meal)
            day[:] = ordered_day(day)
    else:
        days = group_draft_stops(selected, selection.days, stay or city, capacity)
    legs_and_geometry = await asyncio.gather(*(estimate_day_route(day, stay, include_geometry=True) for day in days))
    routes, geometry = map(list, zip(*legs_and_geometry))
    advice = await itinerary_advice(city, selection, days, routes) if with_advice else None
    return WorldwideDraft(id=uuid4(), cityId=city["id"], name=city["name"], region=city["region"],
                          country=city["country"], origin=selection.origin, stay=stay, days=days, departure=selection.departure,
                          travelers=selection.travelers, party=selection.party, budget=selection.budget, pace=selection.pace,
                          mealPreference=selection.mealPreference, localModes=list(dict.fromkeys(selection.localModes)),
                          routes=routes, routeGeometry=geometry, routeAdvice=advice,
                          stopCosts=selection.stopCosts, updated=int(time() * 1000), weather=weather or [],
                          weatherStatus=weather_status, weatherNote=weather_note)
