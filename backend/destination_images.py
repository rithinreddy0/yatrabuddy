"""Public destination images with reuse metadata, bounded retries and a cache."""

import asyncio

import httpx
from fastapi import HTTPException

from .agents import USER_AGENT
from .place_media import named_file, nearby_media
from .place_photos import attach_place_photos, title_key
from .place_search import exact_article, lookup_places
from .source_cache import SourceCache, source_result


cache = SourceCache(64)
SOURCE_ERRORS = (TimeoutError, httpx.HTTPError, HTTPException, ValueError, KeyError, TypeError)


async def article_place(client, query):
    try:
        async with asyncio.timeout(5):
            places = await exact_article(client, query)
            await attach_place_photos(client, places)
        return next(iter(places), None)
    except SOURCE_ERRORS:
        return None


async def exact_place_lookup(query):
    async with asyncio.timeout(8):
        result = await lookup_places(query, public_only=True, include_photos=True)
    name = title_key(query.partition(",")[0])
    exact = [item for item in result["places"] if title_key(item["name"]) == name]
    return next((item for item in exact if item.get("photo")), exact[0] if exact else None)


def image_card(place, photo, *, title=None, file_url=None):
    return {
        "name": title or place["name"], "description": "Photo from Wikimedia Commons.",
        "url": file_url or place["url"], "source": "Wikimedia Commons",
        "latitude": place.get("lat"), "longitude": place.get("lon"), "photo": photo,
    }


async def destination_images(query):
    query = query.strip()[:100]
    key = query.casefold()
    cached = cache.get(key, 3600)
    if cached:
        return {**source_result(cached, "cached"), "status": "cached"}
    base = {"query": query, "category": "all", "places": [], "status": "unavailable"}
    async with httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
        place = await article_place(client, query)
        if not place or not place.get("photo"):
            try:
                match = await exact_place_lookup(query)
                if match and (not place or match.get("photo")):
                    place = match
            except SOURCE_ERRORS:
                pass
        photos = []
        if place:
            if photo := place.get("photo"):
                photos.append(image_card(place, photo))
            seen = {item["photo"].get("sourceUrl") for item in photos}
            if all(isinstance(place.get(axis), (float, int)) for axis in ("lat", "lon")):
                try:
                    async with asyncio.timeout(3):
                        gallery = await nearby_media(client, place["lat"], place["lon"], place["name"], 800, "photo")
                    for item in gallery["items"]:
                        if item["sourceUrl"] in seen or item.get("nearby") or not named_file(item["title"], place["name"]):
                            continue
                        photos.append(image_card(place, item, title=item["title"], file_url=item["sourceUrl"]))
                        seen.add(item["sourceUrl"])
                        if len(photos) >= 8:
                            break
                except SOURCE_ERRORS:
                    pass
        if photos:
            return cache.put(key, source_result({**base, "places": photos, "status": "live"}))
    cached = cache.get(key, 86400)
    if cached:
        return {**source_result(cached, "cached"), "status": "cached"}
    return {**base, "error": "A licensed destination photo is unavailable. Try a specific city or landmark."}
