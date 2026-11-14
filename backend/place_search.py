"""Worldwide place discovery and on-demand Google Places details."""

import asyncio
import hashlib
import os
import re
from datetime import datetime, timezone
from math import isfinite
from typing import Annotated, Literal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .agents import USER_AGENT, clean
from .auth import current_user, google_required, limit
from .locations import compact, find_destinations, lookup
from .nearby import ENCYCLOPEDIA_CATEGORIES, distance_metres, nearby_report
from .open_places import osm_places
from .place_media import nearby_media
from .place_photos import attach_place_photos, title_key
from .wikivoyage import travel_listings
from .source_cache import SourceCache, source_result


router = APIRouter(prefix="/api")
open_place_cache = SourceCache()
verified_places = SourceCache(2048)
Category = Literal["all", "attractions", "hotels", "stays", "food"]
Sort = Literal["relevance", "rating", "reviews", "distance"]
GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places"
GOOGLE_SEARCH_TYPES = {
    "attractions": "tourist_attraction",
    "hotels": "hotel",
    "stays": "lodging",
    "food": "restaurant",
}
GOOGLE_CORE_FIELDS = (
    "id", "displayName", "formattedAddress", "primaryType", "types", "location",
    "googleMapsUri", "rating", "userRatingCount", "priceLevel", "priceRange",
    "attributions", "businessStatus",
)
CATEGORY_TERMS = {
    "attractions": "places to visit",
    "hotels": "hotels",
    "stays": "places to stay",
    "food": "restaurants",
}
CATEGORY_FILTER = {
    "attractions": {"Sight", "Nature", "Activity"},
    "hotels": {"Stay"},
    "stays": {"Stay"},
    "food": {"Food"},
}
STAY_TYPES = {
    "lodging", "hotel", "resort_hotel", "bed_and_breakfast", "budget_japanese_inn",
    "campground", "camping_cabin", "cottage", "extended_stay_hotel", "farmstay",
    "guest_house", "hostel", "inn", "japanese_inn", "motel", "private_guest_room",
    "mobile_home_park", "rv_park",
}
WIKIMEDIA_FAILURES = (TimeoutError, HTTPException, httpx.HTTPError, KeyError, TypeError, ValueError)
HISTORICAL_EVENT_TITLE = re.compile(r"^(?:Battle|Siege|Bombing|Massacre|Invasion) of\b", re.IGNORECASE)
OPEN_SOURCES = {"Wikipedia", "Wikivoyage", "OpenStreetMap"}


def verified_place(url):
    """Recover a public place already returned by the source search in this process."""
    place = verified_places.get(str(url), 86400)
    return place.copy() if place else None


def public_url(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme == "https" and parsed.hostname and not parsed.username else None
    except ValueError:
        return None


def coordinates(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError, OverflowError):
        return None
    if not isfinite(lat) or not isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return {"lat": lat, "lon": lon}


def wikipedia_category(title, description=""):
    text = f"{title} {description}"
    return next((category for category, pattern in ENCYCLOPEDIA_CATEGORIES.items()
                 if pattern.search(text)), "Other")


def google_category(place):
    place_types = set(place.get("types") or ())
    primary = place.get("primaryType") or ""
    if place_types & STAY_TYPES or primary in STAY_TYPES:
        return "Stay"
    if place_types & {"restaurant", "food", "cafe", "bakery", "meal_takeaway"} or primary.endswith("_restaurant"):
        return "Food"
    if primary in {"beach", "park", "garden", "hiking_area", "national_park", "nature_preserve", "scenic_spot"}:
        return "Nature"
    if primary in {"shopping_mall", "market", "store", "gift_shop"}:
        return "Shopping"
    if place_types & {"tourist_attraction", "museum", "historical_landmark", "cultural_landmark"}:
        return "Sight"
    if primary in {"amusement_park", "water_park", "zoo", "aquarium", "tour_agency"}:
        return "Activity"
    return "Other"


def money(amount):
    if not isinstance(amount, dict):
        return None
    currency = amount.get("currencyCode")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    try:
        value = int(amount.get("units", 0)) + int(amount.get("nanos", 0)) / 1_000_000_000
    except (TypeError, ValueError, OverflowError):
        return None
    return {"amount": value, "currency": currency} if isfinite(value) and value >= 0 else None


def google_review(review):
    author = review.get("authorAttribution") or {}
    return {
        "rating": review.get("rating"),
        "text": (review.get("text") or {}).get("text") or "",
        "publishedAt": review.get("publishTime"),
        "url": public_url(review.get("googleMapsUri")),
        "author": {
            "name": author.get("displayName"),
            "url": public_url(author.get("uri")),
            "photoUrl": public_url(author.get("photoUri")),
        },
    }


def google_place(place):
    name = (place.get("displayName") or {}).get("text")
    link = public_url(place.get("googleMapsUri"))
    place_id = place.get("id")
    if not name or not link or not place_id or place.get("businessStatus") == "CLOSED_PERMANENTLY":
        return None
    location = place.get("location") or {}
    point = coordinates(location.get("latitude"), location.get("longitude")) or {"lat": None, "lon": None}
    price_range = place.get("priceRange") or {}
    start, end = money(price_range.get("startPrice")), money(price_range.get("endPrice"))
    return {
        "id": place_id, "name": name, "category": google_category(place),
        "address": place.get("formattedAddress"), **point, "url": link, "source": "Google Maps",
        "description": None, "rating": place.get("rating"), "reviewCount": place.get("userRatingCount"),
        "priceLevel": place.get("priceLevel"),
        "priceRange": {"start": start, "end": end} if start or end else None,
        "attributions": [{"provider": item.get("provider"), "url": public_url(item.get("providerUri"))}
                         for item in place.get("attributions") or [] if item.get("provider")],
        "reviews": [google_review(item) for item in place.get("reviews") or []],
        "distanceMetres": None,
    }


def google_headers(key, fields):
    return {"X-Goog-Api-Key": key, "X-Goog-FieldMask": ",".join(fields)}


def text_for_google(query, category, city):
    text = query.strip()
    if category != "all":
        if city and city_text(text) == text and text.split(",", 1)[0].strip().casefold() == city["name"].casefold():
            text = CATEGORY_TERMS[category]
        elif not city and not re.search(r"\b(hotels?|stays?|resorts?|restaurants?|attractions?|near|around)\b", text, re.IGNORECASE):
            text = f"{CATEGORY_TERMS[category]} near {text}"
    if city and city["name"].casefold() not in text.casefold():
        text = f"{text} in {city['name']}, {city['country'] or city['region'] or ''}".rstrip(", ")
    return text


async def google_search(client, key, query, category, city, point, min_rating, sort, page_token):
    payload = {"textQuery": text_for_google(query, category, city), "pageSize": 18}
    if category != "all":
        payload.update(includedType=GOOGLE_SEARCH_TYPES[category], strictTypeFiltering=True)
    if min_rating:
        payload["minRating"] = min_rating
    if point:
        payload["locationBias"] = {"circle": {
            "center": {"latitude": point["lat"], "longitude": point["lon"]},
            "radius": 15_000,
        }}
        if sort == "distance":
            payload["rankPreference"] = "DISTANCE"
    if page_token:
        payload["pageToken"] = page_token
    fields = [f"places.{name}" for name in GOOGLE_CORE_FIELDS] + ["nextPageToken"]
    photo_enabled = os.getenv("ENABLE_GOOGLE_PLACE_PHOTOS") == "1"
    if photo_enabled:
        fields.append("places.photos")
    response = await client.post(GOOGLE_ENDPOINT + ":searchText", json=payload, headers=google_headers(key, fields))
    response.raise_for_status()
    data = response.json()
    places = [item for raw in data.get("places", []) if (item := google_place(raw))]
    if point:
        for item in places:
            if item["lat"] is not None:
                item["distanceMetres"] = distance_metres(point, item)
    ranked = sorted_places(places, sort)
    if photo_enabled:
        by_id = {item["id"]: item for item in data.get("places", []) if item.get("id")}
        await asyncio.gather(*(google_photo(client, key, place, by_id[place["id"]]) for place in ranked[:6]))
    return ranked, data.get("nextPageToken")


async def resolve_google_photo(client, key, place, photo):
    name = photo.get("name", "")
    if not re.fullmatch(r"places/[\w-]+/photos/[\w-]+", name, re.ASCII) or name.split("/")[1] != place["id"]:
        return
    try:
        response = await client.get("https://places.googleapis.com/v1/" + name + "/media",
                                    params={"maxWidthPx": 640, "skipHttpRedirect": "true"},
                                    headers={"X-Goog-Api-Key": key})
        response.raise_for_status()
        url = public_url(response.json().get("photoUri"))
    except (httpx.HTTPError, ValueError, TypeError):
        return
    if not url or not (urlsplit(url).hostname or "").endswith(".googleusercontent.com"):
        return
    return {
        "url": url, "sourceUrl": public_url(photo.get("googleMapsUri")) or place["url"],
        "authors": [{"name": author["displayName"], "url": public_url(author.get("uri")),
                     "avatar": public_url(author.get("photoUri"))}
                    for author in photo.get("authorAttributions") or [] if author.get("displayName")],
    }


async def google_photo(client, key, place, raw):
    photo = next(iter(raw.get("photos") or []), None)
    if photo:
        resolved = await resolve_google_photo(client, key, place, photo)
        if resolved:
            place["photo"] = resolved


async def matched_venue_photo(client, key, name, lat, lon):
    fields = ["places.id", "places.displayName", "places.location", "places.googleMapsUri", "places.photos"]
    response = await client.post(GOOGLE_ENDPOINT + ":searchText", headers=google_headers(key, fields), json={
        "textQuery": name, "pageSize": 5, "locationRestriction": {"rectangle": {
            "low": {"latitude": max(-90, lat - .002), "longitude": max(-180, lon - .002)},
            "high": {"latitude": min(90, lat + .002), "longitude": min(180, lon + .002)},
        }},
    })
    response.raise_for_status()
    point = {"lat": lat, "lon": lon}
    matches = []
    for raw in response.json().get("places", []):
        location = raw.get("location") or {}
        position = coordinates(location.get("latitude"), location.get("longitude"))
        if (raw.get("id") and position and title_key((raw.get("displayName") or {}).get("text", "")) == title_key(name)
                and distance_metres(point, position) <= 80):
            matches.append(raw)
    if len(matches) != 1:
        return None
    raw = matches[0]
    photo = next(iter(raw.get("photos") or []), None)
    return await resolve_google_photo(client, key, {"id": raw["id"], "url": public_url(raw.get("googleMapsUri"))}, photo) if photo else None


@router.get("/places/google/{place_id}/photos")
async def google_place_photos(place_id: str, request: Request, count: int = Query(default=10, alias="limit", ge=1, le=10)):
    limit(request, "google-place-gallery", 18, 60)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{4,160}", place_id):
        raise HTTPException(422, "Invalid Google place ID.")
    key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not key or os.getenv("ENABLE_GOOGLE_PLACE_PHOTOS") != "1":
        return {"status": "disabled", "items": []}
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            response = await client.get(f"{GOOGLE_ENDPOINT}/{place_id}", headers=google_headers(key, ["id", "googleMapsUri", "photos"]))
            response.raise_for_status()
            raw = response.json()
            if raw.get("id") != place_id:
                return {"status": "empty", "items": []}
            place = {"id": place_id, "url": public_url(raw.get("googleMapsUri"))}
            photos = await asyncio.gather(*(resolve_google_photo(client, key, place, photo) for photo in (raw.get("photos") or [])[:count]))
        items = [{**photo, "type": "photo"} for photo in photos if photo]
        return {"status": "live" if items else "empty", "items": items}
    except (httpx.HTTPError, TypeError, ValueError) as error:
        raise HTTPException(503, "Google Maps photos are unavailable right now.") from error


@router.get("/places/google/{place_id}")
async def google_place_details(place_id: str, request: Request):
    limit(request, "google-place-details", 16, 60)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{4,160}", place_id):
        raise HTTPException(422, "Invalid Google place ID.")
    key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not key:
        raise HTTPException(503, "Google Maps place details are not configured.")
    fields = [*GOOGLE_CORE_FIELDS, "reviews"]
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            response = await client.get(f"{GOOGLE_ENDPOINT}/{place_id}", headers=google_headers(key, fields))
            if response.status_code == 404:
                raise HTTPException(404, "Google Maps did not return this place.")
            response.raise_for_status()
        place = google_place(response.json())
        if not place:
            raise HTTPException(404, "Google Maps did not return this place.")
        return place
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(503, "Google Maps place details are unavailable right now.") from error


def open_place(*, name, category, point, source, url, address=None, description=None, distance=None):
    return {
        "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
        "name": name, "category": category, "address": address, **point,
        "description": description, "url": url, "source": source, "rating": None,
        "reviewCount": None, "priceLevel": None, "priceRange": None, "reviews": [],
        "attributions": [], "distanceMetres": distance,
    }


def normalize_nearby(data):
    details = ("website", "openingHours", "publishedPrice", "phone", "articleTitle", "commonsFile",
               "osmTag", "photo", "overview", "overviewUrl")
    return [{
        **open_place(name=item["name"], category=item["category"],
                     point={"lat": item["lat"], "lon": item["lon"]}, source=item["source"],
                     url=item["url"], address=item.get("address"), description=item.get("description"),
                     distance=item.get("distanceMetres")),
        **{field: item[field] for field in details if item.get(field)},
    } for item in data.get("places", [])]


async def encyclopedia_search(client, query):
    response = await client.get("https://en.wikipedia.org/w/api.php", params={
        "action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": 0, "gsrlimit": 24,
        "prop": "coordinates|description", "coprimary": "primary", "format": "json", "formatversion": 2,
    })
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise ValueError("Wikipedia search failed")
    results = []
    for entry in sorted(data.get("query", {}).get("pages", []), key=lambda item: item.get("index", 999)):
        location = (entry.get("coordinates") or [{}])[0]
        point = coordinates(location.get("lat"), location.get("lon"))
        if not point:
            continue
        title = entry["title"]
        if HISTORICAL_EVENT_TITLE.match(title):
            continue
        description = clean(entry.get("description") or "", 350) or None
        category = wikipedia_category(title, description or "")
        slug = quote(title.replace(" ", "_"), safe="")
        results.append(open_place(name=title, category=category, point=point, source="Wikipedia",
                                  url=f"https://en.wikipedia.org/wiki/{slug}", description=description))
    return results


async def exact_article(client, query):
    slug = quote(query.replace(" ", "_"), safe="")
    response = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}", follow_redirects=True)
    if response.status_code == 404:
        return []
    response.raise_for_status()
    data = response.json()
    point = coordinates(**{key: (data.get("coordinates") or {}).get(key) for key in ("lat", "lon")})
    url = public_url(data.get("content_urls", {}).get("desktop", {}).get("page"))
    if data.get("type") != "standard" or not point or not url:
        return []
    title, description = data["title"], clean(data.get("extract") or "", 350)
    return [open_place(name=title, category=wikipedia_category(title, data.get("description") or ""),
                       point=point, source="Wikipedia", url=url, description=description)]


async def wikivoyage_district_search(client, city, category):
    preferred = "Stay" if category in {"hotels", "stays"} else "Food"
    places = await travel_listings(client, city, include_districts=True, category=preferred)
    return normalize_nearby({"location": city, "places": places})


def city_text(query):
    """Resolve destination phrases without guessing a city from unrelated words."""
    if match := re.search(r"\b(?:in|near|around)\s+(.+)$", query, re.IGNORECASE):
        return match[1].strip(" .?!")
    if "," in query and re.match(r"^(?:best\s+|top\s+)?(?:hotels?|stays?|restaurants?|attractions?)\s*,", query, re.IGNORECASE):
        return query.split(",", 1)[1].strip()
    categories = r"(?:hotels?|stays?|restaurants?|attractions?|places to visit|things to do)"
    if match := re.fullmatch(rf"(?:(?:best|top)\s+)?{categories}\s+(.+)", query, re.IGNORECASE):
        return match[1].strip(" .?!")
    if match := re.fullmatch(rf"(.+?)\s+{categories}", query, re.IGNORECASE):
        return match[1].strip(" .?!")
    return query


async def resolve_cities(client, query, location_id):
    if location_id:
        city = compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
        return city, [city]
    raw = city_text(query)
    if not raw:
        return None, []
    name = raw.split(",", 1)[0].strip().casefold()
    locations = await find_destinations(client, raw[:100])
    exact = [item for item in locations if item["name"].casefold() == name]
    if "," in raw:
        qualifier = raw.split(",", 1)[1].strip().casefold()
        exact = [item for item in exact if qualifier in f"{item['region'] or ''} {item['country'] or ''}".casefold()]
    return (exact[0] if exact else None), locations


def matches_category(item, category):
    if category == "hotels" and item["source"] in {"Wikipedia", "Wikivoyage"}:
        return item["category"] == "Stay" and bool(re.search(r"\b(?:hotel|resort)\b", item["name"], re.IGNORECASE))
    return category == "all" or item["category"] in CATEGORY_FILTER[category]


def sorted_places(places, sort):
    if sort == "rating":
        return sorted(places, key=lambda item: (item["rating"] or 0, item["reviewCount"] or 0), reverse=True)
    if sort == "reviews":
        return sorted(places, key=lambda item: item["reviewCount"] or 0, reverse=True)
    if sort == "distance":
        return sorted(places, key=lambda item: float("inf") if item["distanceMetres"] is None else item["distanceMetres"])
    return places


def local_query(query, city):
    if not city:
        return query
    name = city["name"]
    return query if name.casefold() in query.casefold() else f"{query} {name}"


def nearby_query_matches(item, query, city):
    if not city or city_text(query).casefold() == query.casefold() == city["name"].casefold():
        return True
    words = set(re.findall(r"\w+", query.casefold()))
    ignored = {
        "best", "top", "in", "near", "around", "visit", "the", "places", "things", "to", "do",
        "hotels", "hotel", "stay", "stays", "attractions", "restaurant", "restaurants",
    } | set(re.findall(r"\w+", f"{city['name']} {city.get('region') or ''} {city.get('country') or ''}".casefold()))
    specific = words - ignored
    return not specific or any(word in f"{item['name']} {item['description'] or ''}".casefold() for word in specific)


def business_query(query, city):
    local = re.split(r"\s+(?:in|near|around)\s+", query, maxsplit=1, flags=re.I)[0]
    local = re.sub(r"^(?:best|top)\s+", "", local, flags=re.I)
    terms = re.sub(r"\b(?:hotels?|stays?|restaurants?|attractions?|places to visit|things to do)\b",
                   " ", local, flags=re.I)
    terms = " ".join(terms.split()).strip(" ,?.!")
    return terms if terms.casefold() != city["name"].casefold() and len(terms) > 2 else None


async def free_search(client, query, category, city, point, min_rating, sort):
    if min_rating:
        return [], "empty"
    query_for_source = local_query(query, city)
    text_search = encyclopedia_search(client, query_for_source)
    tasks = [text_search, exact_article(client, query_for_source)]
    if city:
        tasks.append(nearby_report(city["id"]))
        if client is not None and category in {"hotels", "stays", "food", "attractions"}:
            async def local_businesses():
                focused = business_query(query, city)
                places = await osm_places(client, city, category, focused)
                if focused and not places:
                    places = await osm_places(client, city, category)
                return {"status": "ready", "places": places}

            tasks.insert(0, local_businesses())
    async def bounded(task):
        async with asyncio.timeout(7):
            return await task

    answers = await asyncio.gather(*(bounded(task) for task in tasks), return_exceptions=True)
    entries = []
    completed = False
    partial = False
    for value in reversed(answers):
        if isinstance(value, BaseException):
            partial = True
            continue
        if isinstance(value, dict):
            status = value.get("status")
            completed |= status in ("ready", "partial", "empty")
            partial |= status in ("partial", "unavailable")
            entries.extend(item for item in normalize_nearby(value) if nearby_query_matches(item, query, city))
        else:
            completed = True
            entries.extend(value)
    if city and category in {"hotels", "stays", "food"} and sum(matches_category(item, category) for item in entries) < 8:
        try:
            async with asyncio.timeout(2):
                district_places = await wikivoyage_district_search(client, city, category)
            entries.extend(item for item in district_places if nearby_query_matches(item, query, city))
            completed = True
        except WIKIMEDIA_FAILURES:
            partial = True
    unique = {}
    for item in entries:
        if not matches_category(item, category):
            continue
        if point:
            item["distanceMetres"] = distance_metres(point, item)
        radius = 100_000 if city and city.get("kind") == "region" else 35_000
        if city and item["distanceMetres"] is not None and item["distanceMetres"] > radius:
            continue
        identity = re.sub(r"[\W_]+", "", item["name"].casefold())
        unique.setdefault(identity, item)
    places = sorted_places(list(unique.values()), sort)[:32]
    return places, ("partial" if partial else "ready") if places else ("empty" if completed else "unavailable")


@router.get("/places/search")
async def search_places(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=150)],
    category: Category = "all",
    location_id: Annotated[int | None, Query(gt=0)] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
    min_rating: Annotated[float | None, Query(ge=1, le=5)] = None,
    sort: Sort = "relevance",
    page_token: Annotated[str | None, Query(max_length=1600)] = None,
):
    limit(request, "worldwide-place-search", 24, 60)
    guest = google_required() and not await asyncio.to_thread(current_user, request)
    return await lookup_places(q, category, location_id, lat, lon, min_rating, sort, page_token, public_only=guest)


@router.get("/places/media")
async def place_media(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    q: Annotated[str, Query(max_length=120)] = "",
    radius: Annotated[int, Query(ge=50, le=10_000)] = 800,
    type: Literal["all", "photo", "video"] = "all",
    exact: bool = False,
    venue: bool = False,
):
    limit(request, "exact-place-media" if exact else "place-media", 48 if exact else 24, 60)
    async with httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
        name = " ".join(q.split())
        result = await nearby_media(client, lat, lon, name, radius, type, exact=exact)
        key = os.getenv("GOOGLE_PLACES_API_KEY")
        if (exact and venue and type != "video" and name and key and os.getenv("ENABLE_GOOGLE_PLACE_PHOTOS") == "1"
                and (not google_required() or await asyncio.to_thread(current_user, request))):
            if result["items"] and type == "photo":
                return result
            try:
                photo = await matched_venue_photo(client, key, name, lat, lon)
            except (httpx.HTTPError, TypeError, ValueError):
                photo = None
            if photo:
                return {**result, "status": "live", "items": [{**photo, "type": "photo", "title": name}, *result["items"]]}
        return result


async def lookup_places(q, category="all", location_id=None, lat=None, lon=None, min_rating=None,
                        sort="relevance", page_token=None, *, public_only=False, include_photos=True):
    query = " ".join(q.split())
    if len(query) < 2 or (lat is None) != (lon is None):
        raise HTTPException(422, "Enter a query and include both coordinates if you provide a map location.")
    key = None if public_only else os.getenv("GOOGLE_PLACES_API_KEY")
    rating_search = bool(min_rating or sort in {"rating", "reviews"})
    next_page = None
    cache_key = (query.casefold(), category, location_id, lat, lon, min_rating, sort, include_photos, bool(key))
    if not page_token and not (key and rating_search):
        cached = open_place_cache.get(cache_key, 1800)
        if cached:
            return source_result(cached, "cached")
    provider = "Wikivoyage / Wikipedia / OpenStreetMap"
    status = "unavailable"
    places = []
    geo_status = "ready"
    google_status = "disabled"
    if key:
        google_status = "available"
    async with httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
        try:
            city, locations = await resolve_cities(client, query, location_id)
        except WIKIMEDIA_FAILURES:
            if location_id:
                raise HTTPException(503, "Could not resolve this selected city. Try searching again.")
            city, locations = None, []
            geo_status = "unavailable"
        point = coordinates(lat, lon) if lat is not None else city
        if not page_token and not (key and rating_search):
            places, status = await free_search(client, query, category, city, point, min_rating, sort)
        if key and (rating_search or page_token or not places):
            try:
                places, next_page = await google_search(client, key, query, category, city, point, min_rating, sort, page_token)
                google_status = "ready" if places else "empty"
                if places or page_token or min_rating:
                    provider = "Google Maps"
                    status = google_status
            except (httpx.HTTPError, KeyError, TypeError, ValueError):
                google_status = "unavailable"
                if page_token:
                    raise HTTPException(503, "Google Maps could not load the next page. Start a new search.")
        if provider != "Google Maps" and not page_token:
            if key and rating_search:
                places, status = await free_search(client, query, category, city, point, min_rating, sort)
            if include_photos:
                try:
                    async with asyncio.timeout(6):
                        await attach_place_photos(client, places, city["name"] if city else None)
                except TimeoutError:
                    pass
    result = {
        "places": places, "locations": locations, "location": city, "status": status,
        "provider": provider, "nextPageToken": next_page,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "googleMaps": {"status": google_status, "provider": "Google Maps", "url": "https://maps.google.com/"},
            "geocoding": {"status": geo_status if locations or geo_status == "unavailable" else "empty",
                          "provider": "GeoNames via Open-Meteo", "url": "https://www.geonames.org/"},
            "places": {"status": status, "provider": provider,
                       "url": "https://maps.google.com/" if provider == "Google Maps" else "https://en.wikivoyage.org/"},
        },
    }
    if provider == "Google Maps":
        return {**result, "freshness": "live", "cacheable": False}
    if not page_token and places and status in {"ready", "partial"}:
        for place in places:
            if place["source"] in OPEN_SOURCES and coordinates(place["lat"], place["lon"]):
                previous = verified_place(place["url"])
                if previous and previous.get("photo") and not place.get("photo"):
                    verified_places.put(place["url"], {**place, "photo": previous["photo"]})
                else:
                    verified_places.put(place["url"], place.copy())
        return open_place_cache.put(cache_key, source_result(result))
    cached = open_place_cache.get(cache_key, 86400) if not page_token else None
    return source_result(cached, "cached") if cached and status in {"unavailable", "empty"} else source_result(result)
