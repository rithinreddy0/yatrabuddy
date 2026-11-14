"""Find named OpenStreetMap places through Photon and Overpass."""

import asyncio
from math import isfinite
from urllib.parse import unquote, urlsplit

import httpx

from .agents import clean
from .source_cache import SourceCache


PHOTON = "https://photon.komoot.io"
OVERPASS = "https://overpass-api.de/api/interpreter"
OBJECT_TYPES = {"N": "node", "W": "way", "R": "relation"}
OSM_TYPE_CODES = {value: key for key, value in OBJECT_TYPES.items()}
STAYS = ("tourism:hotel", "tourism:guest_house", "tourism:hostel", "tourism:apartment",
         "tourism:chalet", "tourism:motel")
FOOD = ("amenity:restaurant", "amenity:cafe", "amenity:fast_food", "amenity:ice_cream", "amenity:food_court")
NATURE = ("natural:beach", "natural:peak", "waterway:waterfall", "leisure:park", "leisure:nature_reserve",
          "tourism:viewpoint", "leisure:garden")
ACTIVITIES = ("sport:climbing", "sport:surfing", "leisure:water_park", "leisure:amusement_arcade",
              "tourism:theme_park")
ATTRACTIONS = ("tourism:attraction", "tourism:museum", "tourism:gallery", "historic:monument",
               "historic:fort", "historic:castle", "historic:ruins", *NATURE, *ACTIVITIES)
FILTERS = {"hotels": STAYS, "stays": STAYS, "food": FOOD, "attractions": ATTRACTIONS}
cache = SourceCache(256)


def website_url(value):
    if isinstance(value, str):
        try:
            target = urlsplit(value)
            if target.scheme in {"https", "http"} and target.hostname and not target.username and not target.password:
                return value[:600]
        except ValueError:
            pass
    return None


def commons_filename(value):
    if not isinstance(value, str):
        return None
    value = unquote(value)
    if value.startswith("https://commons.wikimedia.org/wiki/File:"):
        value = value.removeprefix("https://commons.wikimedia.org/wiki/")
    elif value.startswith("https://upload.wikimedia.org/wikipedia/commons/"):
        value = "File:" + urlsplit(value).path.rsplit("/", 1)[-1]
    if value.startswith("File:") and 6 < len(value) <= 250 and not any(char in value for char in "|#?\n\r"):
        return value
    return None


def point_from_feature(feature):
    geometry = feature.get("geometry", {})
    point = geometry.get("coordinates", [])
    if geometry.get("type") == "Point" and len(point) == 2:
        lon, lat = point
        if (isinstance(lat, (int, float)) and isfinite(lat) and -90 <= lat <= 90
                and isinstance(lon, (int, float)) and isfinite(lon) and -180 <= lon <= 180):
            return {"lat": lat, "lon": lon}
    return None


def place_from_feature(feature):
    point = point_from_feature(feature)
    properties = feature.get("properties", {})
    name = clean(properties.get("name") or "", 220)
    entity = OBJECT_TYPES.get(properties.get("osm_type"))
    identifier = properties.get("osm_id")
    if not point or not name or not entity or not isinstance(identifier, int) or identifier < 1:
        return None
    osm_tag = f"{properties.get('osm_key')}:{properties.get('osm_value')}"
    if osm_tag in STAYS:
        category = "Stay"
    elif osm_tag in FOOD:
        category = "Food"
    elif osm_tag in NATURE:
        category = "Nature"
    elif osm_tag in ACTIVITIES:
        category = "Activity"
    elif osm_tag in ATTRACTIONS:
        category = "Sight"
    else:
        return None
    extra = properties.get("extra") or {}
    address_parts = [properties.get(field) for field in ("street", "district", "city", "state")]
    address = ", ".join(dict.fromkeys(part for part in address_parts if part))
    cuisine = extra.get("cuisine") or ""
    diet = [name for name in ("vegetarian", "vegan", "halal", "kosher") if extra.get(f"diet:{name}") in {"yes", "only"}]
    description = "; ".join(filter(None, (cuisine.replace(";", ", "), ", ".join(diet))))
    wikipedia = unquote(extra.get("wikipedia") or "")
    article = wikipedia[3:].replace("_", " ") if wikipedia.startswith("en:") and not any(
        value in wikipedia[3:] for value in ":|/#") else None
    return {
        **point, "name": name, "category": category, "source": "OpenStreetMap",
        "url": f"https://www.openstreetmap.org/{entity}/{identifier}",
        "address": address[:240] or None, "description": clean(description, 350) or None,
        "openingHours": clean(extra.get("opening_hours") or "", 400) or None,
        "website": website_url(extra.get("website") or extra.get("contact:website")),
        "articleTitle": article,
        "commonsFile": commons_filename(extra.get("wikimedia_commons")) or commons_filename(extra.get("image")),
        "osmTag": osm_tag,
    }


async def overpass_features(client, lat, lon, tags, radius):
    groups = {}
    for tag in tags:
        key, value = tag.split(":", 1)
        groups.setdefault(key, []).append(value)
    selection = "".join(
        f'nwr(around:{radius},{lat:.5f},{lon:.5f})["name"]["{key}"~"^({"|".join(values)})$"];'
        for key, values in groups.items()
    )
    async with asyncio.timeout(3.5):
        response = await client.post(OVERPASS, data={"data": f"[out:json][timeout:3];({selection});out center 60;"},
                                     follow_redirects=False)
        response.raise_for_status()
        elements = response.json()["elements"]
    features = []
    for element in elements:
        extra = element.get("tags", {})
        tag = next((tag for tag in tags if extra.get(tag.split(":", 1)[0]) == tag.split(":", 1)[1]), None)
        if not tag:
            continue
        key, value = tag.split(":", 1)
        center = element.get("center", element)
        features.append({
            "geometry": {"type": "Point", "coordinates": [center.get("lon"), center.get("lat")]},
            "properties": {"osm_type": OSM_TYPE_CODES.get(element.get("type")), "osm_id": element.get("id"),
                           "osm_key": key, "osm_value": value, "name": extra.get("name"),
                           "street": extra.get("addr:street"), "city": extra.get("addr:city"), "extra": extra},
        })
    return features


async def osm_places(client, city, category=None, query=None):
    """Search within a limited radius of the geocoded location and cache nearby results."""
    lat, lon = city["lat"], city["lon"]
    key = (round(lat, 3), round(lon, 3), city.get("kind"), category, query.casefold() if query else None)
    cached = cache.get(key, 3600)
    if cached is not None:
        return cached
    tags = FILTERS.get(category, (*STAYS, *FOOD, *ATTRACTIONS))
    radius = 35 if city.get("kind") == "region" else 12
    params = {"lat": lat, "lon": lon, "osm_tag": tags, "limit": 35}
    endpoint = "api" if query else "reverse"
    if query:
        params["q"] = query[:150]
        params["zoom"] = 10 if city.get("kind") == "region" else 13
    else:
        params["radius"] = radius
    source_errors = (TimeoutError, httpx.HTTPError, KeyError, ValueError, TypeError)
    photon_error = None
    try:
        async with asyncio.timeout(4 if query else 2.5):
            response = await client.get(f"{PHOTON}/{endpoint}", params=params, follow_redirects=False)
            response.raise_for_status()
            features = response.json()["features"]
    except source_errors as error:
        photon_error = error
        stale = cache.get(key, 86400)
        if stale is not None:
            return stale
        if query:
            raise
        features = []
    from .nearby import distance_metres

    def collect(features, limit_metres):
        places = {}
        for feature in features:
            place = place_from_feature(feature)
            if place and distance_metres(city, place) <= limit_metres:
                places.setdefault(place["url"], place)
        return places

    places = collect(features, radius * 1000)
    if not places and not query:
        fallback_radius = 3500 if city.get("kind") == "region" else 1800
        try:
            places = collect(await overpass_features(client, lat, lon, tags, fallback_radius), fallback_radius)
        except source_errors:
            if photon_error:
                raise
    return cache.put(key, list(places.values()))
