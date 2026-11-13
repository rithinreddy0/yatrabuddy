import asyncio
import os
import re
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .agents import USER_AGENT, location_research, weather_agent
from .auth import limit
from .models import ResearchTopic
from .open_places import PHOTON, point_from_feature
from .source_cache import SourceCache, source_result
from .wikivoyage import wikivoyage_document

router = APIRouter(prefix="/api")
geocode_cache = SourceCache(512)
destination_cache = SourceCache(128)
guide_cache = SourceCache(128)
reverse_cache = SourceCache(256)
weather_cache = SourceCache(128)


async def lookup(client, action, params):
    cache_key = (action, tuple(sorted(params.items())))
    cached = geocode_cache.get(cache_key, 86400 * 30)
    if cached is not None:
        return cached
    key = os.getenv("OPEN_METEO_API_KEY")
    host = "customer-geocoding-api.open-meteo.com" if key else "geocoding-api.open-meteo.com"
    response = await client.get(f"https://{host}/v1/{action}", params={**params, **({"apikey": key} if key else {})})
    if response.status_code == 404:
        raise HTTPException(404, "Location not found.")
    response.raise_for_status()
    return geocode_cache.put(cache_key, response.json())


def compact(result):
    return {
        "id": result["id"], "name": result["name"], "region": result.get("admin1"),
        "country": result.get("country"), "lat": result["latitude"], "lon": result["longitude"],
        "timezone": result.get("timezone"),
        "kind": "region" if is_region(result) else "city",
        "sourceUrl": f"https://www.geonames.org/{result['id']}/",
    }


def is_settlement(result):
    return result.get("feature_code", "").startswith("PPL")


def is_region(result):
    return result.get("feature_code", "") in {"ADM1", "ADM2", "PCLI", "PCLD"}


async def region_match(client, name, qualifier):
    """Resolve a region using Wikipedia's entity and its GeoNames identifier."""
    slug = quote(name.replace(" ", "_"), safe="")
    try:
        summary = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
                                   follow_redirects=True)
        summary.raise_for_status()
        article = summary.json()
        description = article.get("description") or ""
        entity = article.get("wikibase_item") or ""
        if (article.get("title", "").casefold() != name.casefold()
                or not re.match(r"^(?:state|region|province|county|territory|country|constituent country|autonomous community)\b", description, re.I)
                or not re.fullmatch(r"Q\d{1,12}", entity)):
            return None
        response = await client.get(f"https://www.wikidata.org/wiki/Special:EntityData/{entity}.json")
        response.raise_for_status()
        claims = response.json()["entities"][entity]["claims"].get("P1566", [])
        for claim in claims[:3]:
            identifier = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
            if not isinstance(identifier, str) or not identifier.isdecimal():
                continue
            location = await lookup(client, "get", {"id": int(identifier), "language": "en"})
            if is_region(location) and matches_qualifier(location, qualifier):
                return compact(location)
    except (httpx.HTTPError, HTTPException, KeyError, ValueError, TypeError):
        pass
    return None


def matches_qualifier(location, qualifier):
    return not qualifier or any(
        qualifier == str(location.get(key) or "").casefold()
        for key in ("admin1", "admin2", "country", "country_code")
    )


async def find_destinations(client, query):
    name, _, qualifier = query.partition(",")
    name, qualifier = name.strip(), qualifier.strip().casefold()
    key = (name.casefold(), qualifier)
    if (cached := destination_cache.get(key, 3600)) is not None:
        return cached
    lookup_error = None
    try:
        data = await lookup(client, "search", {"name": name, "count": 20 if qualifier else 8, "language": "en"})
    except (httpx.HTTPError, HTTPException, ValueError, TypeError, KeyError) as error:
        lookup_error = error
        data = {}
    results = [item for item in data.get("results", []) if (is_settlement(item) or is_region(item))
               and matches_qualifier(item, qualifier)]
    exact = [item for item in results if item["name"].casefold() == key[0]]
    # A prominent exact city such as Kyoto shouldn't incur an extra network lookup.
    if any(is_region(item) or (item.get("population") or 0) >= 100_000 for item in exact):
        region = None
    else:
        try:
            async with asyncio.timeout(4):
                region = await region_match(client, name, qualifier)
        except TimeoutError:
            region = None
    ranked = [compact(item) for item in [*exact, *(item for item in results if item not in exact)]]
    if region:
        ranked = [region, *(item for item in ranked if item["id"] != region["id"])]
    if ranked:
        destination_cache.put(key, ranked)
    elif cached := destination_cache.get(key, 86400):
        return cached[:8]
    elif lookup_error:
        raise lookup_error
    return ranked[:8]


@router.get("/locations")
async def locations(request: Request, q: str = Query(min_length=2, max_length=100)):
    limit(request, "locations", 24, 60)
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
            return await find_destinations(client, q.strip())
    except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(503, "Location search is unavailable right now.") from error


async def reverse_city(client, lat, lon):
    # Neighborhood precision is sufficient for identifying a nearby city.
    point = (round(lat, 2), round(lon, 2))
    if (cached := reverse_cache.get(point, 86400)) is not None:
        return cached
    response = await client.get(f"{PHOTON}/reverse", params={
        "lat": point[0], "lon": point[1], "radius": 75, "limit": 5,
        "osm_tag": ["place:city", "place:town", "place:village", "place:suburb"],
    }, follow_redirects=False)
    response.raise_for_status()
    for feature in response.json().get("features", [])[:4]:
        properties = feature.get("properties") or {}
        country = properties.get("countrycode")
        names = dict.fromkeys((properties.get("name"), properties.get("city")))
        for name in names:
            if not isinstance(name, str) or not name.strip():
                continue
            qualifier = f", {country}" if isinstance(country, str) and country.isalpha() and len(country) == 2 else ""
            places = await find_destinations(client, name[:90] + qualifier)
            nearby = [item for item in places if item["kind"] == "city"]
            if nearby:
                # Use coordinates to disambiguate same-named towns in one country.
                nearest = min(nearby, key=lambda item: (item["lat"] - point[0]) ** 2
                              + (((item["lon"] - point[1] + 180) % 360) - 180) ** 2)
                found = point_from_feature(feature)
                if found and (abs(nearest["lat"] - found["lat"]) > 1 or abs(((nearest["lon"] - found["lon"] + 180) % 360) - 180) > 1):
                    continue
                return reverse_cache.put(point, nearest)
    return None


@router.get("/locations/reverse")
async def location_reverse(request: Request, lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    limit(request, "location-reverse", 12, 60)
    try:
        async with asyncio.timeout(8), httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
            city = await reverse_city(client, lat, lon)
    except (TimeoutError, httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(503, "Nearby city lookup is unavailable. Search for a city by name.") from error
    if city is None:
        raise HTTPException(404, "No nearby city matched. Search for a city by name.")
    return city


@router.get("/locations/{location_id}")
async def location_details(location_id: int, request: Request):
    limit(request, "location-details", 24, 60)
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
            return compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
    except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(503, "Could not retrieve this destination.") from error


@router.get("/locations/{location_id}/weather")
async def location_weather(location_id: int, request: Request):
    limit(request, "location-weather", 24, 60)
    if cached := weather_cache.get(location_id, 600):
        return source_result(cached, "cached")
    try:
        async with asyncio.timeout(7), httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
            city = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
            weather = await weather_agent(client, {"places": [city]})
        if weather:
            return weather_cache.put(location_id, source_result({"status": "ready", **weather}))
    except (TimeoutError, httpx.HTTPError, TypeError, ValueError, KeyError):
        pass
    if cached := weather_cache.get(location_id, 3600):
        return source_result(cached, "cached")
    return source_result({"status": "unavailable"})


@router.get("/locations/{location_id}/briefing")
async def briefing(location_id: int, request: Request, topic: ResearchTopic = "overview",
                   q: str | None = Query(default=None, max_length=160), refresh: bool = False):
    limit(request, "location-briefing", 12, 60)
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
            item = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
        report = await location_research(item, topic, q.strip() if q else None, refresh)
        return {"location": item, **report}
    except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(503, "Could not retrieve this destination briefing.") from error


async def destination_guide(location):
    key = location["id"]
    cached = guide_cache.get(key, 3600)
    if cached:
        return {**cached, "status": "cached", "freshness": "cached"}
    base = {"location": location, "sections": []}
    try:
        async with asyncio.timeout(6), httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
            _, _, sections = await wikivoyage_document(client, location["name"].replace(" ", "_"))
        if sections:
            report = source_result({**base, "status": "live", "sections": sections})
            return guide_cache.put(key, {**report, "checkedAt": report["retrievedAt"]})
        status = "empty"
    except (TimeoutError, httpx.HTTPError, TypeError, ValueError, KeyError):
        status = "unavailable"
    if stale := guide_cache.get(key, 86400):
        return {**stale, "status": "cached", "freshness": "cached"}
    report = source_result({**base, "status": status})
    return {**report, "checkedAt": report["retrievedAt"]}


@router.get("/locations/{location_id}/guide")
async def location_guide(location_id: int, request: Request):
    limit(request, "location-guide", 12, 60)
    location = await location_details(location_id, request)
    return await destination_guide(location)
