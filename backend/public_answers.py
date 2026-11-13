"""Bounded key-free travel research for factual chat questions."""

import asyncio
import re

import httpx
from fastapi import HTTPException

from . import agents
from .locations import destination_guide, find_destinations
from .place_media import nearby_media
from .place_search import lookup_places, public_url
from .source_cache import SourceCache, source_result


SOURCE_ERRORS = (TimeoutError, httpx.HTTPError, HTTPException, ValueError, TypeError, KeyError)
TOPICS = {
    "Safety and practical advice": r"\b(?:safe(?:ty)?|danger\w*|scams?|watch out|precautions?|risks?)\b",
    "Culture and local context": r"\b(?:culture|customs?|etiquette|dress code|language|history|festivals?)\b",
    "Respect and local customs": r"\b(?:culture|customs?|etiquette|dress code|respect)\b",
    "Language": r"\b(?:language|speak|phrase\w*)\b",
    "Staying healthy": r"\b(?:water quality|stay healthy|health precautions)\b",
    "Getting around": r"\b(?:local transport|bus pass|metro pass|commut\w+)\b",
    "Food": r"\b(?:local dishes|cuisine|traditional food)\b",
    "Sightseeing": r"\b(?:admission|entrance fee|opening hours|ticket prices?)\b",
}
STOP_WORDS = set("a about an and are around at best can do does for from have here how i in is it like me of on or should show tell the there to travel trip what when where which who why with you".split())
HOURS = r"\b(?:opening hours|closing hours|what time (?:does|do|is|are).+?\b(?:open|close)|(?:when|how late) (?:does|do).+?\b(?:open|close)|is .+? open)\b"
PRICE = r"\b(?:admission|entrance fees?|entry fees?|ticket prices?|how much (?:is|are|does|do).+?\bcost)\b"
LOOKUP_WORDS = r"\b(?:safe(?:ty)?|danger\w*|scams?|watch out|precautions?|risks?|customs?|etiquette|culture|history|language|festivals?|local dishes|cuisine|dress code|cost|fares?|bus passes?|day passes?|reviews?|menus?|accessib\w*|when to visit|best time)\b"
VENUE_PATTERN = re.compile(r"\b(?:what time|when|how late|how much)\s+(?:does|do|is|are)\s+(.+?)\s+(?:open|close|cost)\b", re.I)
VENUE_PREPOSITION = re.compile(r"\b(?:opening hours|closing hours|admission|entrance fees?|entry fees?|ticket prices?)\s+(?:for|of|at)\s+(.+?)(?=\s+in\s+|\s+(?:today|tomorrow)\b|$)", re.I)
HERE = {"here", "there", "this city", "that city", "this place", "that place"}
cache = SourceCache(192)


def contextual_query(query, fallback=None):
    value = re.sub(r"^the\s+", "", (query or "").strip(" ?!.;:,"), flags=re.I)
    return (fallback or "") if not value or value.casefold() in HERE else value


def venue_subject(question):
    clean = question.strip(" ?!.;")
    match = VENUE_PATTERN.search(clean) or VENUE_PREPOSITION.search(clean)
    if match:
        return contextual_query(match[1])
    if match := re.search(r"^is\s+(.+?)\s+open\b", clean, re.I):
        return contextual_query(match[1])
    return ""


def research_intent(question, fallback=None):
    if not re.search(rf"{LOOKUP_WORDS}|{HOURS}|{PRICE}", question, re.I):
        return None
    if venue := venue_subject(question):
        return venue
    # Match the last location preposition, as in "about the history of Hyderabad".
    parts = re.split(r"\b(?:in|near|around|for|of|about)\s+", question.strip(" ?!.;"), flags=re.I)
    if len(parts) > 1:
        return contextual_query(parts[-1], fallback)
    return fallback or ""


def words(text):
    return {token for token in re.findall(r"[^\W\d_]{2,}", text.casefold()) if token not in STOP_WORDS}


async def resolve_location(client, query, known=None):
    name = query.partition(",")[0].strip().casefold()
    if known and name in {"here", "there", known["name"].casefold()}:
        return known
    matches = await find_destinations(client, query)
    return next((item for item in matches if item["name"].casefold() == name), None)


async def factual_answer(question, query, known=None):
    query = query.strip()[:100]
    if not query:
        return {"error": "Which destination or place should I look up?"}
    key = (question.strip().casefold(), query.casefold(), (known or {}).get("id"))
    if cached := cache.get(key, 900):
        return source_result(cached, "cached")
    sections = {section for section, pattern in TOPICS.items() if re.search(pattern, question, re.I)}
    tokens = words(question) - words(query)
    venue = venue_subject(question)
    place_field = ("openingHours" if re.search(HOURS, question, re.I)
                   else "publishedPrice" if re.search(PRICE, question, re.I) else None)
    if venue and place_field:
        try:
            async with asyncio.timeout(5):
                nearby = await lookup_places(venue, public_only=True, include_photos=False)
            for place in nearby.get("places", []):
                if (words(place["name"]) == words(venue) and (url := public_url(place.get("url")))
                        and (detail := place.get(place_field))):
                    finding = {"title": place["name"], "excerpt": detail, "url": url, "publisher": place["source"]}
                    return cache.put(key, source_result({"query": query, "location": known, "findings": [finding]},
                                                        nearby.get("freshness", "live")))
        except SOURCE_ERRORS:
            pass

    async with httpx.AsyncClient(timeout=4, headers={"User-Agent": agents.USER_AGENT}) as client:
        async def guide():
            location = await resolve_location(client, query, known)
            return await destination_guide(location) if location else {}

        async def articles():
            name = query.partition(",")[0].strip()
            topic = " ".join(sorted(tokens))[:85]
            if not topic:
                return []
            return await agents.wikipedia_search(client, f"{name} {topic}")

        guide_result, article_result = await asyncio.gather(guide(), articles(), return_exceptions=True)

    matches = []
    if isinstance(guide_result, dict):
        for section in guide_result.get("sections", []):
            title = section["title"]
            for paragraph in section["text"].split("\n\n"):
                overlap = len(words(paragraph) & tokens)
                if paragraph.strip() and (title in sections or (not sections and overlap >= 2)):
                    matches.append((4 * (title in sections) + overlap, title, paragraph, section["sourceUrl"], "Wikivoyage"))
    if isinstance(article_result, list):
        query_words = words(query.partition(",")[0])
        for article in article_result:
            title, excerpt = article["title"], agents.clean(article.get("description") or "", 350)
            overlap = len(words(title + " " + excerpt) & tokens)
            if excerpt and overlap and query_words <= words(title + " " + excerpt):
                matches.append((overlap, title, excerpt, article["url"], "Wikipedia"))
    results, seen = [], set()
    for _, title, excerpt, url, publisher in sorted(matches, key=lambda row: -row[0]):
        if not (url := public_url(url)) or url in seen:
            continue
        seen.add(url)
        results.append({"title": agents.clean(title, 130), "excerpt": agents.clean(excerpt, 480), "url": url, "publisher": publisher})
        if len(results) == 4:
            break
    location = guide_result.get("location") if isinstance(guide_result, dict) else None
    freshness = guide_result.get("freshness", "live") if isinstance(guide_result, dict) else "live"
    base = source_result({"query": query, "location": location, "findings": results}, freshness)
    if results:
        return cache.put(key, base)
    if cached := cache.get(key, 86400):
        return source_result(cached, "cached")
    return {**base, "error": "I couldn’t verify an answer in the public references. Try a more specific place or check with the venue."}


async def video_answer(query, known=None):
    query = query.strip()[:100]
    async with httpx.AsyncClient(timeout=4, headers={"User-Agent": agents.USER_AGENT}) as client:
        try:
            location = await resolve_location(client, query, known)
        except SOURCE_ERRORS:
            location = None
        center = location
        if not center:
            result = await lookup_places(query, "all", public_only=True, include_photos=False)
            center = next((item for item in result.get("places", [])
                           if item["name"].casefold() == query.partition(",")[0].strip().casefold()
                           and item.get("lat") is not None and item.get("lon") is not None), None)
        if not center:
            return {"query": query, "items": [], "error": "I couldn’t match that city or landmark to a map location."}
        media = await nearby_media(client, center["lat"], center["lon"], center["name"], 4000 if location else 800, "video")
    return {**media, "query": center["name"], "location": location,
            **({"error": "No licensed videos came back for this area. Try a nearby landmark."} if not media["items"] else {})}
