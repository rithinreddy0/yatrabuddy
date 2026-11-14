"""Month-by-month weather from recent records, used to suggest when to visit a destination.

The figures come from Open-Meteo's historical weather archive (ERA5 reanalysis). They describe
what recent years were like, not a forecast, and the response says so.
"""

import asyncio
import os
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from . import auth
from .agents import USER_AGENT
from .source_cache import SourceCache, source_result

router = APIRouter(prefix="/api")
cache = SourceCache(256)
ARCHIVE_DOCS = "https://open-meteo.com/en/docs/historical-weather-api"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
YEARS = 3


def monthly_climate(days, temperatures, rain):
    """Average temperature, monthly rainfall and wet days for each calendar month."""
    buckets = {month: {"temps": [], "rain": [], "years": set()} for month in range(1, 13)}
    for day, temperature, precipitation in zip(days, temperatures, rain):
        if temperature is None or precipitation is None:
            continue
        year, month = int(day[:4]), int(day[5:7])
        bucket = buckets[month]
        bucket["temps"].append(temperature)
        bucket["rain"].append(precipitation)
        bucket["years"].add(year)
    months = []
    for month, bucket in buckets.items():
        years = len(bucket["years"])
        if not bucket["temps"] or not years:
            months.append({"month": MONTHS[month - 1], "temperature": None, "rainfall": None, "wetDays": None})
            continue
        months.append({
            "month": MONTHS[month - 1],
            "temperature": round(sum(bucket["temps"]) / len(bucket["temps"]), 1),
            "rainfall": round(sum(bucket["rain"]) / years),
            "wetDays": round(sum(1 for value in bucket["rain"] if value >= 1) / years),
        })
    return months


def comfort(month):
    """Lower is better: distance from a 18–29 °C range plus a penalty for rain."""
    temperature, rainfall = month["temperature"], month["rainfall"]
    if temperature is None:
        return None
    heat = max(0, 18 - temperature) + max(0, temperature - 29)
    return heat * 2 + rainfall / 25


def best_months(months):
    scored = [(comfort(month), index) for index, month in enumerate(months) if comfort(month) is not None]
    if len(scored) < 12:
        return []
    best = min(score for score, _ in scored)
    # Every month within a small margin of the best one, so a long dry season is not cut short.
    return [MONTHS[index] for score, index in sorted(scored, key=lambda item: item[1]) if score <= best + 2.5]


def season_note(months, picks):
    wet = [month["month"] for month in months if month["rainfall"] is not None and month["rainfall"] >= 200]
    hot = [month["month"] for month in months if month["temperature"] is not None and month["temperature"] >= 32]
    notes = []
    if wet:
        notes.append(f"Heavy rain in {', '.join(wet)} (200 mm or more a month).")
    if hot:
        notes.append(f"Hottest in {', '.join(hot)} (daily means of 32 °C or more).")
    if picks:
        notes.append(f"Most comfortable: {', '.join(picks)}.")
    return " ".join(notes)


async def fetch_archive(lat, lon):
    today = date.today()
    start = date(today.year - YEARS, 1, 1)
    end = date(today.year - 1, 12, 31)
    key = os.getenv("OPEN_METEO_API_KEY")
    host = "customer-archive-api.open-meteo.com" if key else "archive-api.open-meteo.com"
    params = {"latitude": round(lat, 2), "longitude": round(lon, 2), "start_date": start.isoformat(),
              "end_date": end.isoformat(), "daily": "temperature_2m_mean,precipitation_sum", "timezone": "auto"}
    if key:
        params["apikey"] = key
    async with asyncio.timeout(9), httpx.AsyncClient(timeout=8, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(f"https://{host}/v1/archive", params=params)
        response.raise_for_status()
        daily = response.json().get("daily", {})
    return start.year, end.year, daily


@router.get("/climate")
async def climate(request: Request, lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    auth.limit(request, "climate", 40, 60)
    if os.getenv("ENABLE_WEATHER", "1") == "0":
        return {"status": "unconfigured", "months": []}
    cache_key = (round(lat, 1), round(lon, 1))
    cached = cache.get(cache_key, 30 * 86400)
    if cached:
        return cached
    try:
        first, last, daily = await fetch_archive(lat, lon)
    except (httpx.HTTPError, TimeoutError, ValueError) as error:
        raise HTTPException(503, "Historical weather is temporarily unavailable.") from error
    months = monthly_climate(daily.get("time", []), daily.get("temperature_2m_mean", []), daily.get("precipitation_sum", []))
    picks = best_months(months)
    return cache.put(cache_key, source_result({
        "status": "ready" if picks else "partial", "months": months, "bestMonths": picks,
        "summary": season_note(months, picks), "period": f"{first}–{last}",
        "basis": f"Daily records for {first}–{last} from the Open-Meteo historical weather archive (ERA5). "
                 "Past weather, not a forecast.",
        "source": "Open-Meteo", "sourceUrl": ARCHIVE_DOCS,
    }))
