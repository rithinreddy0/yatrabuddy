import os
import re
from datetime import date, timedelta
from math import ceil
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from .auth import limit
from .catalog import DESTINATIONS
from .models import Destination
from .locations import compact, lookup

router = APIRouter(prefix="/api")


class StaySearch(BaseModel):
    destination: Destination | str = Field(max_length=30)
    checkin: date
    checkout: date
    adults: int = Field(ge=1, le=8)

    @model_validator(mode="after")
    def check_dates(self):
        if self.destination not in DESTINATIONS and not re.fullmatch(r"geo:[1-9][0-9]{0,10}", self.destination):
            raise ValueError("Choose a destination from the city search.")
        if not (date.today() <= self.checkin < self.checkout <= date.today() + timedelta(days=500)):
            raise ValueError("Choose future check-in and checkout dates.")
        if (self.checkout - self.checkin).days > 30:
            raise ValueError("Choose a stay of 30 nights or less.")
        return self


def config():
    return os.getenv("BOOKING_API_TOKEN"), os.getenv("BOOKING_AFFILIATE_ID")


@router.get("/partners")
def partners():
    return {"bookingSearch": all(config())}


@router.post("/stays/search")
async def search_stays(data: StaySearch, request: Request):
    limit(request, "stays", 12, 60)
    token, affiliate = config()
    if not token or not affiliate:
        raise HTTPException(503, "In-app accommodation search requires Booking.com partner access.")
    point = DESTINATIONS[data.destination]["places"][0] if data.destination in DESTINATIONS else None
    if point is None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                point = compact(await lookup(client, "get", {"id": int(data.destination[4:]), "language": "en"}))
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            raise HTTPException(502, "The selected city could not be resolved.") from error
    payload = {
        "booker": {"country": "in", "platform": "desktop"},
        "checkin": data.checkin.isoformat(), "checkout": data.checkout.isoformat(),
        "guests": {"number_of_adults": data.adults, "number_of_rooms": ceil(data.adults / 2)},
        "coordinates": {"latitude": point["lat"], "longitude": point["lon"], "radius": 10},
        "currency": "INR", "rows": 10, "extras": ["extra_charges"],
    }
    try:
        base = "https://demandapi.booking.com/3.3/accommodations"
        headers = {"Authorization": "Bearer " + token, "X-Affiliate-Id": affiliate}
        async with httpx.AsyncClient(headers=headers, timeout=7) as client:
            search = await client.post(base + "/search", json=payload)
            search.raise_for_status()
            results = search.json()["data"][:10]
            if not results:
                return {"stays": []}
            details = await client.post(base + "/details", json={
                "accommodations": [item["id"] for item in results], "languages": ["en-gb"],
            })
            details.raise_for_status()
            names = {item["id"]: item.get("name") for item in details.json()["data"]}
        stays = []
        for item in results:
            url = item.get("url", "")
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or not (
                parsed.hostname == "booking.com" or parsed.hostname.endswith(".booking.com")
            ):
                continue
            name = names.get(item["id"])
            if isinstance(name, dict):
                name = name.get("en-gb") or next(iter(name.values()), None)
            if not isinstance(name, str):
                continue
            price = item.get("price") or {}
            display = price.get("display") or price.get("total") or {}
            amount = display.get("booker_currency") if isinstance(display, dict) else None
            stays.append({"id": item["id"], "name": name, "url": url,
                          "amount": amount if isinstance(amount, (int, float)) and amount >= 0 else None})
        return {"stays": stays}
    except (httpx.HTTPError, TypeError, ValueError, KeyError) as error:
        raise HTTPException(502, "Booking.com could not return stays right now.") from error
