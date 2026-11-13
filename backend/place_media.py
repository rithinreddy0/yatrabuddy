"""Discover reusable travel media through Wikimedia Commons."""

import asyncio
import re
from datetime import datetime, timezone

import httpx

from .place_photos import (
    COMMONS_API, COMMONS_METADATA, IMAGE_HOSTS, VIDEO_TYPES,
    WIKIPEDIA_API, licensed_media, parse_photo, title_key, validated_url, wiki_pages,
)
from .source_cache import SourceCache


cache = SourceCache(256)
COMMONS_FIELDS = {
    "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata", "iiurlwidth": 640,
    "iiextmetadatafilter": COMMONS_METADATA,
}
SOURCE_URL = "https://commons.wikimedia.org/wiki/Commons:Search_by_location"
SOURCE_ERRORS = (TimeoutError, httpx.HTTPError, ValueError, KeyError, TypeError)


def name_words(value):
    return re.findall(r"[^\W_]+", title_key(value))


def named_file(title, name):
    words = name_words(name)
    if not words:
        return False
    title_words = name_words(title)
    return any(title_words[index:index + len(words)] == words for index in range(len(title_words)))


def media_item(page, name, *, nearby):
    raw_title = page.get("title", "").removeprefix("File:")
    title = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", raw_title).replace("_", " ").strip()[:250]
    if not title:
        return None
    info = (page.get("imageinfo") or [{}])[0]
    mime = info.get("mime")
    video = mime in VIDEO_TYPES or (mime == "application/ogg" and raw_title.casefold().endswith(".ogv"))
    if video and mime == "application/ogg":
        mime = "video/ogg"
    media = licensed_media(info, info.get("url")) if video else parse_photo(page)
    if not media:
        return None
    return {
        **media, "type": "video" if video else "photo", "title": title,
        "author": media["credit"], "mime": mime,
        "fileTitle": page["title"],
        "thumbnail": validated_url(info.get("thumburl"), IMAGE_HOSTS, "/wikipedia/commons/"),
        "nearby": nearby and not named_file(title, name),
    }


async def media_pages(client, **params):
    async with asyncio.timeout(5):
        data = await wiki_pages(client, COMMONS_API, (), **COMMONS_FIELDS, **params)
    return data.get("pages", [])


def title_phrase(name):
    """Build a phrase from plain words so user input cannot add search operators."""
    return " ".join(name_words(name))[:120].strip()


async def search_videos(client, lat, lon, radius):
    query = f"filetype:video nearcoord:{radius}m,{lat},{lon}"
    return await media_pages(client, generator="search", gsrnamespace=6, gsrlimit=12, gsrsearch=query)


async def named_videos(client, name):
    phrase = title_phrase(name)
    if not phrase:
        return []
    pages = await media_pages(client, generator="search", gsrnamespace=6, gsrlimit=8,
                              gsrsearch=f'intitle:"{phrase}" filetype:video')
    return [page for page in pages if named_file(page.get("title", ""), name)]


async def prefer_webm(client, videos):
    titles = [item["fileTitle"] for item in videos if item["mime"] == "video/ogg"]
    if not titles:
        return
    try:
        async with asyncio.timeout(3):
            data = await wiki_pages(client, COMMONS_API, titles, prop="videoinfo", viprop="derivatives")
    except SOURCE_ERRORS:
        return
    pages = {title_key(page["title"]): page for page in data.get("pages", [])}
    for video in videos:
        page = pages.get(title_key(video["fileTitle"]), {})
        derivatives = (page.get("videoinfo") or [{}])[0].get("derivatives", [])
        playable = sorted(
            (item for item in derivatives if isinstance(item.get("height"), int)
             and str(item.get("type", "")).startswith("video/webm")
             and validated_url(item.get("src"), IMAGE_HOSTS, "/wikipedia/commons/")),
            key=lambda item: (item["height"] > 480, abs(480 - item["height"])),
        )
        if playable:
            video["url"] = validated_url(playable[0]["src"], IMAGE_HOSTS, "/wikipedia/commons/")
            video["mime"] = "video/webm"


async def article_videos(client, name, lat, lon, radius):
    async with asyncio.timeout(4):
        data = await wiki_pages(client, WIKIPEDIA_API, [name], prop="images|coordinates", imlimit=50)
        from .nearby import distance_metres

        point = {"lat": lat, "lon": lon}
        titles = []
        for page in data.get("pages", []):
            location = (page.get("coordinates") or [{}])[0]
            if location.get("lat") is not None and location.get("lon") is not None:
                if distance_metres(point, location) > radius:
                    continue
            elif title_key(page.get("title", "")) != title_key(name):
                continue
            titles.extend(item["title"] for item in page.get("images", [])
                          if item["title"].lower().endswith((".webm", ".ogv", ".mp4")))
        if titles:
            data = await wiki_pages(client, COMMONS_API, titles[:8], **COMMONS_FIELDS)
            return data.get("pages", [])
    return []


async def nearby_media(client, lat, lon, name="", radius=800, kind="all"):
    key = (round(lat, 4), round(lon, 4), title_key(name), radius, kind)
    cached = cache.get(key, 3600)
    if cached:
        return {**cached, "status": "cached" if cached["items"] else "empty"}

    tasks = [(True, media_pages(
        client, generator="geosearch", ggsprimary="all", ggsnamespace=6, ggslimit=32,
        ggsradius=radius, ggscoord=f"{lat}|{lon}",
    ))]
    valid_name = name and not any(character in name for character in ":|/[]{}")
    if valid_name:
        if kind != "video":
            tasks.append((False, media_pages(client, generator="categorymembers", gcmtitle=f"Category:{name}",
                                            gcmtype="file", gcmlimit=16)))
        if kind != "photo":
            tasks.append((False, media_pages(client, generator="categorymembers", gcmtitle=f"Category:Videos of {name}",
                                            gcmtype="file", gcmlimit=12)))
    if kind != "photo":
        tasks.append((True, search_videos(client, lat, lon, radius)))
    results = await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
    nearby_flags = [nearby for nearby, _ in tasks]
    named_index = None
    if kind != "photo" and valid_name:
        has_video = any(
            (item := media_item(page, name, nearby=False)) and item["type"] == "video"
            for pages in results if isinstance(pages, list) for page in pages
        )
        if not has_video:
            fallback = await asyncio.gather(
                media_pages(client, generator="categorymembers", gcmtitle=f"Category:Videos from {name}",
                            gcmtype="file", gcmlimit=12),
                article_videos(client, name, lat, lon, radius),
                named_videos(client, name),
                return_exceptions=True,
            )
            results.extend(fallback)
            nearby_flags.extend((False, False, False))
            named_index = len(results) - 1
    items = {}
    for index, (is_nearby, pages) in enumerate(zip(nearby_flags, results, strict=True)):
        if isinstance(pages, BaseException):
            if not isinstance(pages, SOURCE_ERRORS):
                raise pages
            continue
        for page in pages:
            item = media_item(page, name, nearby=is_nearby)
            if item and (kind == "all" or item["type"] == kind):
                item["nameMatchOnly"] = index == named_index
                previous = items.get(item["sourceUrl"])
                if not previous or (previous["nearby"] and not item["nameMatchOnly"]):
                    items[item["sourceUrl"]] = item
    ranked = sorted(items.values(), key=lambda item: (
        item["nameMatchOnly"], item["nearby"], not named_file(item["title"], name),
    ))
    photos = [item for item in ranked if item["type"] == "photo"][:14]
    videos = [item for item in ranked if item["type"] == "video"][:8]
    await prefer_webm(client, videos)
    for item in (*photos, *videos):
        item.pop("fileTitle", None)
    status = "live" if ranked else "empty" if any(isinstance(result, list) for result in results) else "unavailable"
    response = {"status": status, "source": "Wikimedia Commons", "sourceUrl": SOURCE_URL,
                "checkedAt": datetime.now(timezone.utc).isoformat(), "items": [*photos, *videos]}
    stale = cache.get(key, 86400)
    if stale and stale["items"] and status != "live":
        return {**stale, "status": "cached"}
    if status in {"live", "empty"}:
        cache.put(key, response)
    return response
