"""Synthetic YatraBuddy demo data and shared journey decisions."""

import json
import asyncio
import secrets
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
import httpx
from pydantic import BaseModel, Field
from sqlalchemy import String, Text, update
from sqlalchemy.orm import Mapped, mapped_column

from . import agents, auth
from .db import Base, transaction
from .source_cache import SourceCache, source_result

router = APIRouter(prefix="/api/yatra")
SAMPLE = json.loads(Path(__file__).with_name("goa-escape.json").read_text(encoding="utf-8"))
ROUTES = SAMPLE["routes"]
JOURNEYS = SAMPLE["journeys"]
CONNECTION = json.loads(Path(__file__).with_name("connection-simulation.json").read_text(encoding="utf-8"))
MIN_CONNECTION = CONNECTION["minimumConnection"]
PALEM_POINT = {"places": [{"lat": 15.008889, "lon": 74.022778}]}
weather_cache = SourceCache()
currency_cache = SourceCache()
weather_lock = asyncio.Lock()


class JourneyGroup(Base):
    __tablename__ = "yatra_journey_groups"
    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    state: Mapped[str] = mapped_column(Text)


class Member(BaseModel):
    name: str = Field(min_length=1, max_length=32, pattern=r"^\S(?:.*\S)?$")
    budget: int = Field(ge=1000, le=100000)
    priority: Literal["value", "comfort", "explore", "safe"]
    home: str = Field(default="Delhi", min_length=1, max_length=60)
    interests: list[Literal["Beach", "Forest trek", "Culture", "Food"]] = Field(default_factory=list, max_length=4)
    style: Literal["Budget", "Balanced", "Comfort"] = "Balanced"
    crowds: Literal["Prefer quiet", "Flexible", "Like lively places"] = "Flexible"
    journey: int = Field(default=0, ge=0, lt=len(JOURNEYS))


class Ballot(BaseModel):
    token: str = Field(min_length=24, max_length=64)
    route: Literal["flight", "rail", "coast"]


class Delay(BaseModel):
    route: Literal["flight", "rail", "coast"]
    minutes: int = Field(ge=0, le=CONNECTION["maximumDelay"])
    remaining: int = Field(ge=0, le=100000)


def group_view(state):
    members = list(state.values())
    journey_index = members[0].get("journey", 0)
    journey = JOURNEYS[journey_index]
    limit = min(member["budget"] for member in members)
    options = []
    for index, template in enumerate(ROUTES):
        route = {**template, "price": journey["prices"][index], "minutes": journey["minutes"][index]}
        if index == 2 and journey_index != 0:
            route.update(name="Rail + flexible transfer",
                         reason="The longest connection buffer gives the group more time to change vehicles.")
        if route["price"] > limit or route["buffer"] < MIN_CONNECTION:
            continue
        matches = sum(
            member["priority"] == route["theme"] or
            (member["priority"] == "safe" and route["buffer"] >= 90) or
            (route["theme"] == "explore" and "Forest trek" in member.get("interests", []))
            for member in members
        )
        score = round(40 * (1 - route["price"] / limit)
                      + 25 * max(0, 1 - route["minutes"] / 1800)
                      + 20 * min(route["buffer"] / 100, 1)
                      + 15 * matches / len(members))
        options.append({**route, "score": score,
                        "risk": "Moderate" if route["buffer"] < 60 else "Low",
                        "votes": sum(member.get("vote") == route["id"] for member in members)})
    options.sort(key=lambda route: (-route["votes"], -route["score"], route["id"]))
    crowds = sorted({member.get("crowds", "Flexible") for member in members} - {"Flexible"})
    return {"budget": limit, "journey": journey_index, "options": options, "crowdConflict": len(crowds) > 1, "members": [
        {"name": member["name"], "voted": any(option["id"] == member.get("vote") for option in options)}
        for member in members
    ]}


@router.get("/sample")
def sample():
    return SAMPLE


@router.get("/weather")
async def weather(departure: date = date.fromisoformat(SAMPLE["date"])):
    async with weather_lock:
        cached = weather_cache.get(departure, 900)
        if cached:
            return {**source_result(cached, "cached"), "cached": True}
        try:
            async with httpx.AsyncClient(timeout=4, headers={"User-Agent": agents.USER_AGENT}) as client:
                data = await agents.weather_agent(client, PALEM_POINT, departure, len(SAMPLE["days"]))
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            data = None
        if data:
            return weather_cache.put(departure, {**source_result(data), "cached": False})
        cached = weather_cache.get(departure, 21600)
        if cached:
            return {**source_result(cached, "cached"), "cached": True}
        return source_result({"temperature": SAMPLE["weather"], "forecast": [],
                              "conditions": "Sample weather", "retrievedAt": None}, "simulated")


@router.get("/options")
def options():
    return group_view({"sample": {"name": "Aarav", "budget": 15000, "priority": "explore"}})


@router.get("/exchange")
async def exchange(request: Request, currency: Literal["USD", "EUR", "GBP", "SGD"] = "USD"):
    auth.limit(request, "yatra-exchange", 20, 60)
    cached = currency_cache.get(currency, 3600)
    if cached:
        return source_result(cached, "cached")
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            response = await client.get("https://api.frankfurter.dev/v1/latest", params={"base": "INR", "symbols": currency})
            response.raise_for_status()
            data = response.json()
            result = {"rate": float(data["rates"][currency]), "date": data["date"], "currency": currency}
        return currency_cache.put(currency, source_result(result))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        cached = currency_cache.get(currency, 86400 * 7)
        if cached:
            return source_result(cached, "cached")
        raise HTTPException(503, "Exchange rate unavailable.")


@router.post("/recover")
def recover(delay: Delay):
    route = next(item for item in ROUTES if item["id"] == delay.route)
    buffer = route["buffer"] - delay.minutes
    if buffer >= MIN_CONNECTION:
        return {"buffer": buffer, "missed": False, "replacement": None, "extraBudget": None}
    available = [item for item in CONNECTION["alternatives"] if delay.minutes <= item["latestDelay"]]
    replacement = next((item for item in available if item["amount"] <= delay.remaining), None)
    return {"buffer": buffer, "missed": True, "replacement": replacement,
            "extraBudget": None if replacement else min(item["amount"] for item in available) - delay.remaining}


@router.post("/groups", status_code=201)
def create(member: Member, request: Request):
    auth.limit(request, "yatra-group", 20, 60)
    code = secrets.token_urlsafe(12)
    token = secrets.token_urlsafe(24)
    state = {token: member.model_dump()}
    with transaction() as db:
        db.add(JourneyGroup(code=code, state=json.dumps(state)))
    return {"code": code, "token": token, **group_view(state)}


@router.get("/groups/{code}")
def group(code: str):
    with transaction() as db:
        record = db.get(JourneyGroup, code)
        if not record:
            raise HTTPException(404, "Trip group not found.")
        return group_view(json.loads(record.state))


def change_group(code, change):
    for _ in range(4):
        with transaction() as db:
            record = db.get(JourneyGroup, code)
            if not record:
                raise HTTPException(404, "Trip group not found.")
            previous = record.state
            state = json.loads(previous)
            change(state)
            changed = db.execute(update(JourneyGroup).where(
                JourneyGroup.code == code, JourneyGroup.state == previous
            ).values(state=json.dumps(state)))
            if changed.rowcount == 1:
                return group_view(state)
    raise HTTPException(409, "The group changed. Please try again.")


@router.post("/groups/{code}/join")
def join(code: str, member: Member, request: Request):
    auth.limit(request, "yatra-join", 20, 60)
    token = secrets.token_urlsafe(24)

    def add_member(state):
        if len(state) >= 8:
            raise HTTPException(409, "This trip group already has eight travellers.")
        state[token] = member.model_dump()

    return {"token": token, **change_group(code, add_member)}


@router.put("/groups/{code}/vote")
def vote(code: str, ballot: Ballot, request: Request):
    auth.limit(request, "yatra-vote", 40, 60)

    def cast(state):
        if ballot.token not in state:
            raise HTTPException(403, "Join the trip group before voting.")
        if ballot.route not in {option["id"] for option in group_view(state)["options"]}:
            raise HTTPException(422, "This route is outside the group budget.")
        state[ballot.token]["vote"] = ballot.route

    return change_group(code, cast)
