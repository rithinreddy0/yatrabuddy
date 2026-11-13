"""Turn public destination guides into short, cited reading notes."""

import asyncio
import re
import unicodedata
from html.parser import HTMLParser
from typing import Annotated, Literal
from urllib.parse import unquote, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .agents import USER_AGENT
from .auth import limit
from .locations import compact, destination_guide, find_destinations, location_weather, lookup
from .source_cache import SourceCache, source_result
from .wikivoyage import wikivoyage_document

router = APIRouter(prefix="/api")
cache = SourceCache(192)
advisory_cache = SourceCache(128)

Topic = Literal["overview", "routes", "stays", "food", "experiences", "events", "safety", "weather"]
PRACTICAL = ("Getting around", "Safety and practical advice", "Staying healthy", "Respect and local customs")
TOPICS = {
    "overview": ("Overview", "Culture and local context"),
    "routes": ("Getting around", "Getting there"),
    "stays": ("Where to stay", "Getting around"),
    "food": ("Food", "Culture and local context"),
    "experiences": ("Sightseeing", "Things to do"),
    "events": ("Things to do", "Culture and local context"),
    "safety": ("Safety and practical advice", "Staying healthy", "Respect and local customs"),
    "weather": ("Staying healthy", "Culture and local context"),
}
KINDS = {
    "Overview": "overview", "Getting around": "transport", "Getting there": "transport",
    "Safety and practical advice": "safety", "Staying healthy": "health",
    "Respect and local customs": "customs", "Culture and local context": "culture",
    "Where to stay": "stays", "Food": "food", "Sightseeing": "experiences", "Things to do": "experiences",
}
PRACTICAL_WORDS = {
    "transport": r"\b(?:metro|train|bus|ferr(?:y|ies)|taxi|walk|station|tram|rental|rickshaw|airport)\b",
    "safety": r"\b(?:avoid|beware|carry|check|watch|scams?|currents?|lifeguards?|theft|road|traffic|crossing)\b",
    "health": r"\b(?:water|heat|shade|altitude|mosquito|clinic|hospital|pharmacy)\b",
    "customs": r"\b(?:wear|cover|remove|shoes|ask|dress|customs?|temples?|photograph|etiquette)\b",
    "stays": r"\b(?:hotels?|hostels?|neighbou?rhood|stays?|resorts?|guesthouses?|district|rooms?)\b",
    "food": r"\b(?:eat|food|dish(?:es)?|cuisine|restaurants?|vegetarian|markets?|specialt(?:y|ies))\b",
}
UNSUPPORTED_SAFETY = re.compile(
    r"\b(?:(?:very|perfectly|generally|completely|quite) safe|safe (?:city|place|destination)|crime[- ]free|no crime|totally harmless|"
    r"nothing to worry|guaranteed safe|safest (?:city|place)|dial\s+\d|emergency (?:number|telephone))\b", re.I)
READ_ERRORS = (TimeoutError, httpx.HTTPError, ValueError, TypeError, KeyError)


def evidence_words(text):
    normalized = unicodedata.normalize("NFKD", text.casefold())
    without_marks = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(re.findall(r"[^\W_]+", without_marks))


def as_guide_url(url):
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    if (parsed.scheme == "https" and parsed.netloc == "en.wikivoyage.org"
            and parsed.path.startswith("/wiki/")):
        return parsed
    return None


def concise_excerpt(text, kind):
    practical = PRACTICAL_WORDS.get(kind)
    sentences = [sentence for paragraph in text.split("\n\n")
                 for sentence in re.split(r'(?<=[.!?])\s+(?=[A-Z“"])', " ".join(paragraph.split()))]
    candidates = []
    for index, sentence in enumerate(sentences):
        sentence = sentence.strip()
        words = sentence.split()
        if not 5 <= len(words) <= 25:
            continue
        if sentence[-1] not in ".!?":
            continue
        if re.match(r"(?:However|But|These|Those|They|It|This)\b", sentence, re.I):
            continue
        if kind in {"safety", "health"} and (
            UNSUPPORTED_SAFETY.search(sentence) or not practical or not re.search(practical, sentence, re.I)
        ):
            continue
        score = len(re.findall(practical, sentence, re.I)) if practical else 0
        candidates.append((score, -index, sentence))
    if not candidates:
        return None
    return max(candidates)[2]


def event_excerpt(sections):
    marker = re.compile(r"\b(?:festival|parade|carnival|celebration|fair|procession)\b", re.I)
    for section in sections:
        if section.get("title") not in {"Culture and local context", "Things to do", "Overview"}:
            continue
        text, url = section.get("text"), section.get("sourceUrl")
        if not isinstance(text, str) or not isinstance(url, str) or not as_guide_url(url):
            continue
        for paragraph in text.split("\n\n"):
            for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z])", " ".join(paragraph.split())):
                if marker.search(sentence) and concise_excerpt(sentence, "events"):
                    return guide_note("Festivals and traditions", sentence, "events", url)
    return None


def guide_note(title, text, kind, url):
    return {"title": title, "text": text, "kind": kind, "source": "Wikivoyage", "sourceUrl": url,
            "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/"}


def summarize(guide, topic):
    sections = {}
    candidates = guide.get("sections", [])
    for section in candidates:
        title = section.get("title")
        text = section.get("text")
        url = section.get("sourceUrl")
        if title not in KINDS or not isinstance(text, str) or not isinstance(url, str) or not as_guide_url(url):
            continue
        excerpt = concise_excerpt(text, KINDS[title])
        if excerpt:
            sections[title] = guide_note(title, excerpt, KINDS[title], url)
    order = dict.fromkeys((*TOPICS[topic], *PRACTICAL, "Overview", "Culture and local context"))
    notes = [sections[title] for title in order if title in sections]
    if topic == "events" and (note := event_excerpt(candidates)):
        notes.insert(0, note)
    return notes[:6]


def matches_guide(guide, location):
    sections = guide.get("sections", [])
    intro = " ".join(section.get("text", "") for section in sections
                     if section.get("title") in {"Overview", "Culture and local context"})
    first = next((item["sourceUrl"] for item in sections if item.get("sourceUrl")), "")
    parsed = as_guide_url(first)
    if not parsed:
        return False
    article = evidence_words(unquote(parsed.path.removeprefix("/wiki/")))
    name = evidence_words(location["name"])
    qualifiers = {evidence_words(value) for value in (location.get("region"), location.get("country")) if value}
    if not qualifiers or name in qualifiers:
        return article == name
    contextual = f" {article} {evidence_words(intro[:6000])} "
    return f" {name} " in f" {article} " and any(f" {value} " in contextual for value in qualifiers)


async def read_guide(location):
    guide = await destination_guide(location)
    if matches_guide(guide, location) or guide.get("status") == "unavailable":
        return guide
    name = location["name"]
    qualifiers = dict.fromkeys(location.get(key) for key in ("region", "country"))
    try:
        async with asyncio.timeout(5), httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
            for qualifier in qualifiers:
                if not qualifier or qualifier.casefold() == name.casefold():
                    continue
                title = f"{name} ({qualifier})".replace(" ", "_")
                _, _, sections = await wikivoyage_document(client, title)
                qualified = source_result({"status": "live", "sections": sections})
                if matches_guide(qualified, location):
                    return qualified
    except READ_ERRORS:
        return {**guide, "status": "unavailable", "sections": []}
    return {**guide, "status": "empty", "sections": []}


class RegionalAdvisory(HTMLParser):
    def __init__(self, names):
        super().__init__()
        self.names = names
        self.heading = None
        self.anchor = None
        self.matches = []

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            self.heading = []
            self.anchor = dict(attrs).get("id")

    def handle_data(self, data):
        if self.heading is not None:
            self.heading.append(data)

    def handle_endtag(self, tag):
        if tag == "h2" and self.heading is not None:
            title = "".join(self.heading).strip()
            if evidence_words(title) in self.names and self.anchor and re.fullmatch(r"[a-z0-9-]+", self.anchor):
                self.matches.append((title, self.anchor))
            self.heading = None


def advisory_links(payload, path, location):
    country = location["country"]
    base = "https://www.gov.uk" + path
    source = "UK Foreign Office"
    links = [{"title": f"Official travel advice for {country}", "source": source, "sourceUrl": base, "scope": "country"}]
    names = {evidence_words(value) for value in (location.get("name"), location.get("region")) if value}
    names.discard(evidence_words(country))
    for part in payload.get("parts", []):
        if part.get("slug") != "regional-risks" or not isinstance(part.get("body"), str):
            continue
        parser = RegionalAdvisory(names)
        parser.feed(part["body"])
        links[:0] = [{"title": f"Official regional advice for {title}", "source": source,
                      "sourceUrl": base + "/regional-risks#" + anchor, "scope": "region"}
                     for title, anchor in parser.matches]
    return links


async def official_advisory(location):
    country = location.get("country")
    if not country:
        return []
    slug = evidence_words(country).replace(" ", "-")
    if not re.fullmatch(r"[a-z0-9-]{2,100}", slug):
        return []
    path = "/foreign-travel-advice/" + slug
    if (cached := advisory_cache.get(slug, 3600)) is not None:
        return advisory_links(cached, path, location) if cached else []
    try:
        async with httpx.AsyncClient(timeout=3, headers={"User-Agent": USER_AGENT}) as client:
            response = await client.get("https://www.gov.uk/api/content" + path, follow_redirects=False)
            if response.status_code == 404:
                advisory_cache.put(slug, {})
                return []
            response.raise_for_status()
        data = response.json()
        if data.get("document_type") != "travel_advice" or data.get("base_path") != path or data.get("withdrawn"):
            return []
        payload = {"parts": [part for part in data.get("details", {}).get("parts", [])
                             if part.get("slug") == "regional-risks"]}
        advisory_cache.put(slug, payload)
    except READ_ERRORS:
        payload = advisory_cache.get(slug, 86400)
    return advisory_links(payload, path, location) if payload else []


async def resolve_location(query, location_id):
    async with asyncio.timeout(8), httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
        if location_id is not None:
            return compact(await lookup(client, "get", {"id": location_id, "language": "en"}))
        name, *qualifiers = [part.strip() for part in query.split(",")]
        qualifier = next((value for value in reversed(qualifiers) if value), None)
        matches = await find_destinations(client, f"{name}, {qualifier}" if qualifier else name)
        exact = [item for item in matches if evidence_words(item["name"]) == evidence_words(name)]
        expected = {evidence_words(value) for value in qualifiers[:-1] if value}
        return next((item for item in exact if expected <= {
            evidence_words(value) for value in (item.get("region"), item.get("country")) if value
        }), None)


@router.get("/city-briefing")
async def city_briefing(
    request: Request,
    q: Annotated[str | None, Query(min_length=2, max_length=100)] = None,
    location_id: Annotated[int | None, Query(gt=0)] = None,
    topic: Topic = "overview",
):
    limit(request, "city-briefing", 20, 60)
    query = q.strip() if q else None
    if (location_id is None) == (not query) or (query and len(query.partition(",")[0].strip()) < 2):
        raise HTTPException(422, "Choose a destination name or location ID.")
    key = (location_id or query.casefold(), topic)
    if cached := cache.get(key, 300 if topic == "weather" else 1800):
        return source_result(cached, "cached")
    base = {"location": None, "topic": topic, "sections": [], "advisories": []}
    try:
        location = await resolve_location(query, location_id)
    except READ_ERRORS:
        if topic != "weather" and (cached := cache.get(key, 86400)):
            return source_result(cached, "cached")
        return source_result({**base, "status": "unavailable"}, "unavailable")
    if location is None:
        return source_result({**base, "status": "empty"})

    tasks = [read_guide(location), official_advisory(location)]
    if topic == "weather":
        tasks.append(location_weather(location["id"], request))
    guide, advisories, *weather_reports = await asyncio.gather(*tasks)
    sections = summarize(guide, topic)
    weather = next(iter(weather_reports), {})
    if weather.get("status") == "ready":
        sections.insert(0, {
            "title": "Current model conditions", "kind": "weather", "source": "Open-Meteo",
            "text": f"{weather['conditions']}, {weather['temperature']}°C at {weather['time'].replace('T', ' ')} ({weather['timezone']}).",
            "sourceUrl": weather["url"], "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        })
    if not sections and topic != "weather" and (cached := cache.get(key, 86400)):
        return source_result(cached, "cached")
    status = "empty"
    if sections:
        status = "partial" if topic == "weather" and weather.get("status") != "ready" else "ready"
    elif advisories:
        status = "partial"
    elif guide["status"] == "unavailable":
        status = "unavailable"
    freshness = weather.get("freshness") if weather.get("status") == "ready" else guide.get("freshness")
    payload = source_result({**base, "location": location, "sections": sections, "advisories": advisories,
                             "status": status, "retrievedAt": weather.get("retrievedAt") or guide.get("retrievedAt")},
                            "unavailable" if status == "unavailable" else freshness or "live")
    return cache.put(key, payload) if sections else payload
