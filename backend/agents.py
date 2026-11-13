import asyncio
import html
import math
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from time import monotonic, time
from urllib.parse import quote, urlsplit
from uuid import uuid4
from xml.etree.ElementTree import ParseError

import httpx

from .catalog import DESTINATIONS, allowed_stop
from .models import Brief, Day, Finding, Trip

SEARCH_TASKS = {
    "overview": (("Destination scout", "visitor guide"), ("Experience scout", "things to do"), ("Transport scout", "getting around")),
    "stays": (("Stay scout", "where to stay neighborhoods"),),
    "routes": (("Transport scout", "getting there airport railway official transport"),),
    "food": (("Food scout", "food markets local cuisine"),),
    "experiences": (("Experience scout", "things to do visitor attractions"),),
    "events": (("Events scout", "tourism events calendar official"),),
}
USER_AGENT = os.getenv("SEARCH_USER_AGENT", "WayfarerTravel/1.0 (travel itinerary research)")
BRAVE = "Brave Search"
WIKIPEDIA = "Wikipedia"
NEWS = "Google News RSS"
WEB_SOURCES = {
    BRAVE: "https://brave.com/search/api/",
    WIKIPEDIA: "https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages",
    NEWS: "https://news.google.com/",
}
WEATHER_DOCS = "https://open-meteo.com/en/docs"
AIR_QUALITY_DOCS = "https://open-meteo.com/en/docs/air-quality-api"
PROVIDER_ERRORS = (httpx.HTTPError, KeyError, TypeError, ValueError, ParseError)
WIKIPEDIA_QUERIES = {
    "hyderabad": ("Hyderabad", "Tourism in Hyderabad", "Transport in Hyderabad"),
    "kerala": ("Varkala", "Varkala Beach", "Varkala railway station"),
    "goa": ("South Goa district", "Palolem Beach", "Goa International Airport"),
    "singapore": ("Singapore", "Tourism in Singapore", "Transport in Singapore"),
    "kutch": ("Great Rann of Kutch", "Kutch district", "Bhuj Airport"),
}
TOPIC_ARTICLE = {
    "hyderabad": {"stays": "Banjara Hills", "food": "Hyderabadi cuisine", "events": "Bonalu"},
    "kerala": {"stays": "Varkala", "food": "Cuisine of Kerala", "events": "Onam"},
    "goa": {"stays": "Palolem Beach", "food": "Goan cuisine", "events": "Goa Carnival"},
    "singapore": {"stays": "Singapore", "food": "Singaporean cuisine", "events": "Public holidays in Singapore"},
    "kutch": {"stays": "Dhordo", "food": "Gujarati cuisine", "events": "Rann Utsav"},
}
_research_cache = {}


@dataclass
class SearchResult:
    findings: list[Finding]
    checks: dict[str, str]


def clean(value, limit):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", str(value))).split())[:limit]


async def article(client, title):
    slug = quote(title.replace(" ", "_"), safe="")
    response = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}", follow_redirects=True)
    if response.status_code == 404:
        return []
    response.raise_for_status()
    data = response.json()
    if data.get("type") != "standard":
        return []
    return [{"title": data["title"], "description": data.get("extract", ""),
             "url": data["content_urls"]["desktop"]["page"]}]


def findings_for(entries, agent, provider, kind):
    findings = []
    for entry in entries:
        url = entry.get("url") or ""
        title = clean(entry.get("title") or "", 220)
        if not title or not url:
            continue
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username:
                continue
            findings.append(Finding(
                agent=agent, title=title, url=url, provider=provider, kind=kind,
                snippet=clean(entry.get("description") or "", 350),
                publisher=entry.get("publisher") or None, publishedAt=entry.get("date"),
            ))
        except ValueError:
            continue
    return findings[:3]


async def brave_search(client, query, key):
    response = await client.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": 3},
        headers={"X-Subscription-Token": key},
    )
    response.raise_for_status()
    return response.json().get("web", {}).get("results", [])


async def wikipedia_search(client, query):
    response = await client.get(
        "https://en.wikipedia.org/w/rest.php/v1/search/page",
        params={"q": query, "limit": 3},
    )
    response.raise_for_status()
    return [
        {"title": page["title"], "description": page.get("excerpt"),
         "url": "https://en.wikipedia.org/wiki/" + quote(page["key"], safe="")}
        for page in response.json().get("pages", [])
    ]


async def search(client, agent, query, fallback):
    from .news import news_rss_query

    checks = {}
    key = os.getenv("BRAVE_SEARCH_API_KEY")
    attempts = []
    if key:
        attempts.append((BRAVE, "search", brave_search, (query, key)))
    attempts.extend([
        (WIKIPEDIA, "reference", wikipedia_search, (query,)),
        (NEWS, "news", news_rss_query, (query,)),
    ])
    if fallback:
        attempts.append((WIKIPEDIA, "reference", article, (fallback,)))

    for provider, kind, fetch, args in attempts:
        try:
            findings = findings_for(await fetch(client, *args), agent, provider, kind)
        except PROVIDER_ERRORS:
            checks.setdefault(provider, "unavailable")
            continue
        if findings:
            checks[provider] = "ready"
            return SearchResult(findings, checks)
        checks[provider] = "empty"
    return SearchResult([], checks)


async def weather_agent(client, place, departure=None, days=1):
    if os.getenv("ENABLE_WEATHER", "1") == "0":
        return None
    point = place["places"][0]
    key = os.getenv("OPEN_METEO_API_KEY")
    host = "customer-api.open-meteo.com" if key else "api.open-meteo.com"
    params = {"latitude": point["lat"], "longitude": point["lon"],
              "current": "temperature_2m,weather_code", "timezone": "auto"}
    forecast_available = departure and date.today() <= departure <= date.today() + timedelta(days=15)
    if forecast_available:
        params.update(daily="weather_code,temperature_2m_max,temperature_2m_min",
                      forecast_days=min(16, (departure - date.today()).days + days))
    if key:
        params["apikey"] = key
    endpoint = f"https://{host}/v1/forecast"
    result = await client.get(endpoint, params=params)
    result.raise_for_status()
    payload = result.json()
    current = payload["current"]
    code = current["weather_code"]
    if code is None or current["temperature_2m"] is None:
        return None
    conditions = ("Clear" if code == 0 else "Cloudy" if code <= 3 else
                  "Fog" if code <= 48 else "Drizzle" if code <= 57 else
                  "Rain" if code <= 67 else "Snow" if code <= 77 else
                  "Showers" if code <= 86 else "Thunderstorms")
    forecast = []
    if forecast_available:
        daily = payload.get("daily", {})
        forecast = [{"date": day, "min": low, "max": high, "code": code}
                    for day, low, high, code in zip(daily.get("time", []), daily.get("temperature_2m_min", []),
                                                     daily.get("temperature_2m_max", []), daily.get("weather_code", []))
                    if day >= departure.isoformat() and low is not None and high is not None]
    return {"temperature": current["temperature_2m"], "conditions": conditions, "forecast": forecast,
            "time": current["time"], "timezone": payload["timezone"],
            "url": WEATHER_DOCS if key else str(httpx.URL(endpoint, params=params))}


async def air_quality_agent(client, place):
    if os.getenv("ENABLE_WEATHER", "1") == "0":
        return None
    point = place["places"][0]
    key = os.getenv("OPEN_METEO_API_KEY")
    host = "customer-air-quality-api.open-meteo.com" if key else "air-quality-api.open-meteo.com"
    params = {"latitude": point["lat"], "longitude": point["lon"], "current": "us_aqi", "timezone": "auto"}
    if key:
        params["apikey"] = key
    endpoint = f"https://{host}/v1/air-quality"
    response = await client.get(endpoint, params=params)
    response.raise_for_status()
    payload = response.json()
    current = payload["current"]
    if current["us_aqi"] is None:
        return None
    return {"index": current["us_aqi"], "time": current["time"], "timezone": payload["timezone"],
            "url": AIR_QUALITY_DOCS if key else str(httpx.URL(endpoint, params=params))}


def request_terms(place_name, topic, query, interest, diet):
    if query:
        return query if place_name.casefold() in query.casefold() else f"{place_name} {query}"
    preference = (diet if topic == "food" and diet != "No restrictions" else
                  interest if topic in ("overview", "experiences") else None)
    return f"{place_name} {preference}" if preference else place_name


def measurement_source(data, provider, docs):
    status = (
        "unavailable" if isinstance(data, Exception) else
        "ready" if data else "disabled" if os.getenv("ENABLE_WEATHER", "1") == "0" else "empty"
    )
    return {"provider": provider, "status": status, "url": data["url"] if status == "ready" else docs}


async def collect_research(place, jobs, cache_key, *, departure=None, days=1, refresh=False):
    key = (*cache_key, os.getenv("ENABLE_WEATHER", "1"), bool(os.getenv("BRAVE_SEARCH_API_KEY")))
    cached = _research_cache.get(key)
    if not refresh and cached and monotonic() - cached[0] < 180:
        return {**cached[1], "cached": True}
    async with httpx.AsyncClient(timeout=4, headers={"User-Agent": USER_AGENT}) as client:
        tasks = (search(client, agent, query, fallback) for agent, query, fallback in jobs)
        batches = await asyncio.gather(
            weather_agent(client, place, departure, days), air_quality_agent(client, place),
            *tasks, return_exceptions=True,
        )
    weather, air_quality, *batches = batches
    findings = {}
    failures = 0
    provider_checks = {}
    for batch in batches:
        if isinstance(batch, Exception):
            failures += 1
            continue
        if not batch.findings and "unavailable" in batch.checks.values():
            failures += 1
        for provider, state in batch.checks.items():
            provider_checks.setdefault(provider, set()).add(state)
        for finding in batch.findings:
            findings.setdefault(str(finding.url), finding)
    status = "partial" if findings and failures else "ready" if findings else "unavailable" if failures else "empty"
    checks = [
        {
            "provider": provider, "url": WEB_SOURCES[provider],
            "status": "partial" if {"ready", "unavailable"} <= states else
                      "ready" if "ready" in states else "unavailable" if "unavailable" in states else "empty",
        }
        for provider, states in provider_checks.items()
    ]
    used = dict.fromkeys(finding.provider for finding in findings.values() if finding.provider)
    web_provider = ", ".join(used) or "Web research"
    weather_source = measurement_source(weather, "Open-Meteo", WEATHER_DOCS)
    air_source = measurement_source(air_quality, "CAMS via Open-Meteo", AIR_QUALITY_DOCS)
    report = {
        "provider": web_provider, "status": status, "findings": list(findings.values()),
        "retrievedAt": datetime.now(timezone.utc).isoformat(), "cached": False,
        "weather": weather if weather_source["status"] == "ready" else None,
        "airQuality": air_quality if air_source["status"] == "ready" else None,
        "weatherStatus": weather_source["status"],
        "sources": {
            "web": {"provider": web_provider, "status": status, "url": WEB_SOURCES[next(iter(used))] if used else None, "checks": checks},
            "weather": weather_source,
            "airQuality": air_source,
        },
    }
    if status == "ready" and "unavailable" not in (weather_source["status"], air_source["status"]):
        if len(_research_cache) >= 256:
            _research_cache.pop(next(iter(_research_cache)))
        _research_cache[key] = (monotonic(), report)
    return report


async def research(destination, topic, interest=None, diet=None, departure=None, days=1, *, query=None, refresh=False):
    place = DESTINATIONS[destination]
    terms = request_terms(place["name"], topic, query, interest, diet)
    wiki = WIKIPEDIA_QUERIES[destination]
    jobs = []
    subjects = SEARCH_TASKS[topic][:1] if query else SEARCH_TASKS[topic]
    for index, (agent, subject) in enumerate(subjects):
        fallback = wiki[index] if topic == "overview" else TOPIC_ARTICLE[destination].get(
            topic, wiki[2 if topic == "routes" else 1],
        )
        jobs.append((agent, terms if query else f"{terms} {subject}", fallback))
    key = ("catalog", destination, topic, interest, diet, departure, days, query)
    return await collect_research(place, jobs, key, departure=departure, days=days, refresh=refresh)


async def location_research(location, topic, query=None, refresh=False):
    parts = dict.fromkeys(location[field] for field in ("name", "region", "country") if location[field])
    name = " ".join(parts)
    terms = request_terms(name, topic, query, None, None)
    agent, subject = SEARCH_TASKS[topic][0]
    job = (agent, terms if query else f"{terms} {subject}", location["name"])
    return await collect_research(
        {"places": [location]}, [job], ("location", location["id"], topic, query), refresh=refresh,
    )


async def road_route(destination, stop_names):
    places = {item["name"]: item for item in DESTINATIONS[destination]["places"]}
    return await route_points([places[name] for name in stop_names], include_geometry=True)


def route_geometry(route):
    geometry = route.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        return None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    stride = max(1, math.ceil((len(coordinates) - 1) / 999))
    sampled = [*coordinates[:-1:stride], coordinates[-1]]
    result = []
    for pair in sampled:
        if not isinstance(pair, list) or len(pair) != 2:
            return None
        lon, lat = pair
        if type(lon) not in (int, float) or type(lat) not in (int, float) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
            return None
        result.append([lat, lon])
    return result


async def route_points(points, *, include_geometry=False):
    coordinates = ";".join(f"{point['lon']},{point['lat']}" for point in points)
    base = os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
            params = {"overview": "simplified" if include_geometry else "false", "steps": "false", "alternatives": "false"}
            if include_geometry:
                params["geometries"] = "geojson"
            response = await client.get(f"{base}/route/v1/driving/{coordinates}", params=params)
            response.raise_for_status()
            route = response.json()["routes"][0]
            durations = [max(1, round(leg["duration"] / 60)) for leg in route["legs"]]
            distances = [round(leg["distance"] / 1000, 1) for leg in route["legs"]]
            if len(durations) != len(points) - 1:
                return None
            result = {"legMinutes": durations, "legKilometres": distances,
                      "kilometres": round(route["distance"] / 1000, 1),
                      "url": "https://project-osrm.org/", "model": "Driving estimate without live traffic"}
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None
    if include_geometry and (geometry := route_geometry(route)):
        result["geometry"] = geometry
    return result


def plan_trip(brief: Brief, selected_stops=None, selected_stay=0):
    place = DESTINATIONS[brief.destination]
    preferred = place["theme"] if brief.style == "Balanced" else brief.style
    pool = sorted(place["places"], key=lambda item: item["theme"] != preferred)
    if selected_stops is not None:
        pool = [item for item in pool if item["name"] in selected_stops]
    relaxed = brief.style == "Relaxed" or brief.pace == "Relaxed"
    capacity = 2 if relaxed else 4 if brief.pace == "Packed" else 3
    count = min(capacity, max(1, (len(pool) + brief.days - 1) // brief.days))
    if selected_stops is not None and len(pool) > capacity * brief.days:
        raise ValueError("Add more days, increase the pace, or choose fewer stops.")
    days = []
    for index in range(brief.days):
        available = [item for item in pool if allowed_stop(item, brief, index)]
        selected = []
        while available and len(selected) < count:
            if selected:
                anchor = selected[-1]
                next_place = min(available, key=lambda item: (
                    (item["lat"] - anchor["lat"]) ** 2 + (item["lon"] - anchor["lon"]) ** 2
                ))
            else:
                next_place = available[0]
            selected.append(next_place)
            available.remove(next_place)
            pool.remove(next_place)
        days.append(Day(relaxed=relaxed, stops=[item["name"] for item in selected]))
    if selected_stops is not None and pool:
        remaining = ", ".join(item["name"] for item in pool)
        raise ValueError(f"These selections could not fit the chosen dates or dietary preference: {remaining}.")
    return Trip(id=uuid4(), brief=brief, days=days, stay=selected_stay, route=0, updated=int(time() * 1000))
