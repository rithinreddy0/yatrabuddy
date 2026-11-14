"""Facts for planning how to reach a trip: road distance, air distance, and nearby airports and stations.

Everything here comes from public map data (OpenStreetMap via Photon and the OSM API, routes from OSRM).
Nothing is a fare or a schedule; the client links out to providers for those.
"""

import asyncio
import re

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from . import agents, auth
from .agents import USER_AGENT
from .locations import find_destinations
from .nearby import distance_metres
from .open_places import PHOTON
from .source_cache import SourceCache, source_result

router = APIRouter(prefix="/api")
hub_cache = SourceCache(256)
OSM_API = "https://api.openstreetmap.org/api/0.6"
OSM_KINDS = {"N": "node", "W": "way", "R": "relation"}
AIRPORT_RADIUS_KM = 150
STATION_RADIUS_KM = 25
NOT_MAINLINE = {"subway", "light_rail", "monorail", "tram", "funicular"}


def km(a, b):
    return round(distance_metres(a, b) / 1000, 1)


def feature_point(feature):
    lon, lat = feature["geometry"]["coordinates"][:2]
    return {"lat": lat, "lon": lon}


async def osm_tags(client, features):
    """Fetch OSM tags for Photon features in one request per element type."""
    wanted = {}
    for feature in features:
        properties = feature["properties"]
        if properties.get("osm_type") in OSM_KINDS and properties.get("osm_id"):
            wanted.setdefault(properties["osm_type"], []).append(str(properties["osm_id"]))

    async def batch(code, ids):
        kind = OSM_KINDS[code]
        response = await client.get(f"{OSM_API}/{kind}s.json", params={f"{kind}s": ",".join(ids[:40])})
        response.raise_for_status()
        return {(code, element["id"]): element.get("tags", {}) for element in response.json().get("elements", [])}

    results = await asyncio.gather(*(batch(code, ids) for code, ids in wanted.items()))
    return {key: value for result in results for key, value in result.items()}


def tags_for(tags, feature):
    properties = feature["properties"]
    return tags.get((properties.get("osm_type"), properties.get("osm_id")), {})


def airport_rows(features, tags, point):
    rows = []
    for feature in features:
        info = tags_for(tags, feature)
        code = (info.get("iata") or "").strip().upper()
        kind = (info.get("aerodrome:type") or info.get("aerodrome") or "").lower()
        if not re.fullmatch(r"[A-Z]{3}", code) or "military" in kind or info.get("disused:aeroway"):
            continue
        place = feature_point(feature)
        distance = km(point, place)
        if distance <= AIRPORT_RADIUS_KM:
            rows.append({"kind": "airport", "name": info.get("name") or feature["properties"].get("name"),
                         "code": code, **place, "distanceKm": distance})
    unique = {row["code"]: row for row in sorted(rows, key=lambda row: row["distanceKm"], reverse=True)}
    return sorted(unique.values(), key=lambda row: row["distanceKm"])[:3]


def station_rows(features, tags, point):
    rows = []
    for feature in features:
        info = tags_for(tags, feature)
        name = info.get("name") or feature["properties"].get("name") or ""
        if (info.get("station") in NOT_MAINLINE or info.get("subway") == "yes" or info.get("light_rail") == "yes"
                or info.get("train") == "no" or "(u/c)" in name or info.get("railway") not in {"station", "halt"}):
            continue
        place = feature_point(feature)
        code = (info.get("railway:ref") or info.get("ref") or "").strip().upper()
        rows.append({"kind": "station", "name": name, "code": code if re.fullmatch(r"[A-Z0-9]{1,6}", code) else None,
                     **place, "distanceKm": km(point, place)})
    # Stations with a code are the ones travellers can search for; keep them first, then nearest.
    rows.sort(key=lambda row: (row["code"] is None, row["distanceKm"]))
    seen, unique = set(), []
    for row in rows:
        if row["name"].casefold() not in seen:
            seen.add(row["name"].casefold())
            unique.append(row)
    return unique[:4]


async def hubs_near(client, point):
    key = (round(point["lat"], 2), round(point["lon"], 2))
    cached = hub_cache.get(key, 7 * 86400)
    if cached is not None:
        return cached
    airports_request = client.get(f"{PHOTON}/api", params={
        "q": "airport", "lat": point["lat"], "lon": point["lon"], "osm_tag": "aeroway:aerodrome",
        "limit": 8, "location_bias_scale": 0.1, "zoom": 9})
    stations_request = client.get(f"{PHOTON}/reverse", params={
        "lat": point["lat"], "lon": point["lon"], "osm_tag": "railway:station", "radius": STATION_RADIUS_KM, "limit": 30})
    airports_response, stations_response = await asyncio.gather(airports_request, stations_request)
    airports_response.raise_for_status()
    stations_response.raise_for_status()
    airport_features = [item for item in airports_response.json().get("features", [])
                        if km(point, feature_point(item)) <= AIRPORT_RADIUS_KM]
    station_features = stations_response.json().get("features", [])
    tags = await osm_tags(client, [*airport_features, *station_features])
    result = {"airports": airport_rows(airport_features, tags, point),
              "stations": station_rows(station_features, tags, point)}
    return hub_cache.put(key, result)


async def resolve_origin(client, origin):
    matches = await find_destinations(client, origin)
    name = origin.split(",", 1)[0].strip().casefold()
    exact = [item for item in matches if item["name"].casefold() == name]
    return (exact or matches or [None])[0]


@router.get("/trip-transport")
async def trip_transport(
    request: Request,
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    name: str = Query(min_length=1, max_length=120),
    origin: str | None = Query(default=None, max_length=120),
):
    """Road and air distance from the departure city, and arrival points near the stay."""
    auth.limit(request, "trip-transport", 30, 60)
    destination = {"name": name, "lat": lat, "lon": lon}
    async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
        start = None
        if origin and origin.strip():
            try:
                async with asyncio.timeout(6):
                    start = await resolve_origin(client, origin.strip())
            except (TimeoutError, httpx.HTTPError, HTTPException, KeyError, ValueError):
                start = None

        async def guarded(coroutine):
            try:
                async with asyncio.timeout(9):
                    return await coroutine
            except (TimeoutError, httpx.HTTPError, KeyError, ValueError, TypeError):
                return None

        far_enough = start is not None and km(start, destination) > 3
        destination_hubs, origin_hubs, road = await asyncio.gather(
            guarded(hubs_near(client, destination)),
            guarded(hubs_near(client, start)) if far_enough else asyncio.sleep(0),
            agents.route_points([start, destination]) if far_enough else asyncio.sleep(0),
        )
    origin_info = {"name": start["name"], "region": start.get("region"), "country": start.get("country"),
                   "lat": start["lat"], "lon": start["lon"]} if start else None
    return source_result({
        "origin": origin_info,
        "originStatus": "ready" if start else "missing" if not origin else "not_found",
        "destination": destination,
        "airDistanceKm": km(start, destination) if start else None,
        "road": {"kilometres": road["kilometres"], "minutes": sum(road["legMinutes"]),
                 "note": "Driving estimate without live traffic", "source": "OSRM", "sourceUrl": road["url"]}
        if isinstance(road, dict) else None,
        "hubs": {"destination": destination_hubs, "origin": origin_hubs if far_enough else None,
                 "status": "ready" if destination_hubs else "unavailable"},
        "sources": [{"name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright"},
                    {"name": "OSRM", "url": "https://project-osrm.org/"}],
    })
