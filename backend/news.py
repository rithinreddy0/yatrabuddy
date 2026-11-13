import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from ipaddress import ip_address
from time import monotonic
from urllib.parse import urlsplit
from xml.etree import ElementTree

import httpx

from .agents import USER_AGENT, clean
from .catalog import DESTINATIONS

TOPICS = {
    "highlights": ("tourism", "tourist", "sightseeing", "attraction", "museum", "visitor"),
    "transport": ("airport", "railway", "metro", "bus", "public transport"),
    "events": ("festival", "events", "exhibition", "concert"),
    "conditions": ("weather", "rain", "travel advisory"),
}
CACHE = {}


def article_url(value):
    try:
        address = urlsplit(value)
        return value if address.scheme in ("https", "http") and address.hostname and not address.username and not address.password else None
    except (ValueError, TypeError):
        return None


def preview_url(value):
    """Only use image URLs explicitly supplied by an upstream feed."""
    if not isinstance(value, str) or len(value) > 1800 or not article_url(value):
        return None
    try:
        address = urlsplit(value)
        host = address.hostname.rstrip(".")
        if address.scheme != "https" or address.port not in {None, 443} or "." not in host or host.endswith((".local", ".internal", ".localhost")):
            return None
        try:
            return value if ip_address(host).is_global else None
        except ValueError:
            return value
    except ValueError:
        return None


def rss_images(item):
    images = []
    for element in item.iter():
        if element.tag in {"{http://search.yahoo.com/mrss/}thumbnail", "{http://search.yahoo.com/mrss/}content", "enclosure"}:
            content_type = element.get("type", "")
            if element.tag.endswith("thumbnail") or element.get("medium") == "image" or content_type.startswith("image/"):
                if url := preview_url(element.get("url")):
                    images.append(url)
    return list(dict.fromkeys(images))[:5]


TRAVEL_SIGNALS = {
    "Getting around": r"\b(?:traffic|diversions?|closures?|airport|flights?|metro|railway|trains?|buses?|runway|roadworks?)\b",
    "Events and culture": r"\b(?:festival|exhibition|concert|mela|carnival|museum|heritage|celebrations?|performance|show|tour)\b",
    "Local conditions": r"\b(?:weather|advisory|rain|heatwave|flood|cyclone|storm|warning|forecast)\b",
    "Stays and attractions": r"\b(?:hotels?|tourism|attractions?|tourists?|resorts?|visitor|sightseeing)\b",
}
IMPACT = {
    "Getting around": "Check current road or service notices for your travel date.",
    "Events and culture": "Confirm the date, venue and opening hours before making plans.",
    "Local conditions": "Check the latest official forecast or notice before leaving.",
    "Stays and attractions": "Confirm that the venue is open and check current rates before planning around it.",
}


def travel_highlights(articles):
    groups = {}
    for article in articles:
        title = article["title"]
        group = next((label for label, pattern in TRAVEL_SIGNALS.items() if re.search(pattern, title, re.I)), None)
        if not group:
            continue
        words = set(re.findall(r"[^\W\d_]{4,}", title.casefold()))
        stories = groups.setdefault(group, [])
        if any(len(words & other) >= 3 and len(words & other) / max(1, min(len(words), len(other))) >= 0.55 for _, other in stories):
            continue
        if len(stories) < 2:
            stories.append((article, words))
    return [{"title": group, "note": IMPACT[group], "stories": [article for article, _ in rows]}
            for group, rows in groups.items()][:4]


def gdelt_date(value):
    try:
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


async def gdelt(client, name, words, days):
    expression = " OR ".join(f'"{word}"' for word in words)
    response = await client.get("https://api.gdeltproject.org/api/v2/doc/doc", timeout=3.5, params={
        "query": f'"{name}" ({expression})', "mode": "artlist", "format": "json",
        "sort": "DateDesc", "timespan": f"{days}d", "maxrecords": 12,
    })
    response.raise_for_status()
    return [
        {"title": clean(item["title"], 220), "url": article_url(item["url"]),
         "publisher": clean(item.get("domain", ""), 100), "date": gdelt_date(item.get("seendate")),
         "dateKind": "Indexed", "images": [url] if (url := preview_url(item.get("socialimage"))) else []}
        for item in response.json().get("articles", [])
    ]


async def news_rss(client, name, words, days):
    expression = " OR ".join(f'"{word}"' for word in words)
    return await news_rss_query(client, f'"{name}" ({expression}) when:{days}d')


async def news_rss_query(client, query):
    response = await client.get("https://news.google.com/rss/search", params={
        "q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en",
    })
    response.raise_for_status()
    if len(response.content) > 750_000 or re.search(rb"<!DOCTYPE|<!ENTITY", response.content, flags=re.I):
        raise ValueError("Unexpected feed content")
    entries = []
    for item in ElementTree.fromstring(response.content).findall("./channel/item")[:12]:
        date = item.findtext("pubDate")
        try:
            published = parsedate_to_datetime(date).isoformat()
        except (TypeError, ValueError):
            published = None
        publisher = clean(item.findtext("source", ""), 100)
        title = clean(item.findtext("title", ""), 220)
        if publisher and title.endswith(" - " + publisher):
            title = title[:-(len(publisher) + 3)]
        entries.append({"title": title, "url": article_url(item.findtext("link", "")),
                        "publisher": publisher, "date": published, "dateKind": "Published", "images": rss_images(item)})
    return entries


async def travel_news(destination, topic, days, *, city_name=None):
    cache_key = (destination, city_name, topic, days)
    cached = CACHE.get(cache_key)
    if cached and monotonic() - cached[0] < 300:
        return cached[1]
    name = city_name or DESTINATIONS[destination]["name"]
    if destination == "kutch":
        name = "Kutch"
    words = TOPICS[topic]
    entries, provider, status = [], "GDELT", "empty"
    async with httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
        for label, lookup in [("GDELT", gdelt), ("Google News RSS", news_rss)]:
            try:
                entries = await lookup(client, name, words, days)
                provider, status = label, "empty"
                if entries:
                    break
            except (httpx.HTTPError, KeyError, TypeError, ValueError, ElementTree.ParseError):
                provider, status = label, "unavailable"
    deduped = {item["url"]: item for item in entries if item["url"] and item["title"]}
    articles = sorted(deduped.values(), key=lambda item: item["date"] or "", reverse=True)
    report = {"provider": provider, "status": "ready" if deduped else status,
              "retrievedAt": datetime.now(timezone.utc).isoformat(), "articles": articles,
              "highlights": travel_highlights(articles)}
    if status != "unavailable":
        if len(CACHE) >= 160 and cache_key not in CACHE:
            CACHE.pop(next(iter(CACHE)))
        CACHE[cache_key] = (monotonic(), report)
    return report
