import os
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError

from . import agents, auth, conversation, locations, nearby, news, partners, place_search, planning_agent, transport_quotes, trip_workspace, voice, yatra
from .catalog import CATALOG
from .city_briefing import router as city_briefing_router
from .transport_sources import router as transport_router
from .db import Base, Library, engine, transaction
from .source_cache import SourceCache, source_result
from .models import Brief, Destination, LibraryDocument, LibraryUpdate, PlanRequest, ResearchRequest, RouteRequest, Trip
from typing import Literal


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            current_type = connection.scalar(text(
                "SELECT atttypid::regtype::text FROM pg_attribute "
                "WHERE attrelid = 'trip_workspaces'::regclass AND attname = 'updated'"
            ))
            if current_type == "integer":
                connection.execute(text("ALTER TABLE trip_workspaces ALTER COLUMN updated TYPE BIGINT"))
    try:
        yield
    finally:
        engine.dispose()


app = FastAPI(title="Wayfarer API", version="1.0.0", lifespan=lifespan)
road_cache = SourceCache()
PUBLIC_API_PATHS = {"/api/health", "/api/session", "/api/auth/config", "/api/auth/firebase", "/api/logout"}
PUBLIC_BROWSE_GET = {"/api/destinations", "/api/locations", "/api/locations/reverse", "/api/city-briefing",
                     "/api/news", "/api/places/search", "/api/places/media"}
PUBLIC_LOCATION = re.compile(r"/api/locations/[0-9]+(?:/(?:nearby|weather|briefing|guide))?")
app.include_router(auth.router)
app.include_router(partners.router)
app.include_router(locations.router)
app.include_router(city_briefing_router)
app.include_router(nearby.router)
app.include_router(place_search.router)
app.include_router(conversation.router)
app.include_router(voice.router)
app.include_router(yatra.router)
app.include_router(planning_agent.router)
app.include_router(trip_workspace.router)
app.include_router(transport_quotes.router)
app.include_router(transport_router)


@app.middleware("http")
async def protect_api(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        site = request.headers.get("sec-fetch-site")
        origin = request.headers.get("origin")
        allowed = {item.strip() for item in os.getenv(
            "PUBLIC_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3010,http://localhost:3010"
        ).split(",")}
        if site == "cross-site" or (origin and origin not in allowed):
            return JSONResponse({"detail": "Open Wayfarer directly and try again."}, status_code=403)
    path = request.url.path.rstrip("/")
    public_browse = (request.method == "GET" and (path in PUBLIC_BROWSE_GET or PUBLIC_LOCATION.fullmatch(path))
                     or request.method == "POST" and path == "/api/research")
    if auth.google_required() and path.startswith("/api/") and path not in PUBLIC_API_PATHS and not public_browse:
        user = await run_in_threadpool(auth.current_user, request)
        if not user:
            return JSONResponse({"detail": "Sign in with Google to use YatraBuddy."}, status_code=401,
                                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        request.state.signed_in_user = user
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    with transaction() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/destinations")
def destinations():
    return CATALOG


@app.post("/api/plan", response_model=Trip)
def plan(brief: PlanRequest, request: Request):
    auth.limit(request, "plan", 35, 60)
    try:
        return agents.plan_trip(Brief.model_validate(brief.model_dump()), brief.selectedStops, brief.selectedStay)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/api/research")
async def research(data: ResearchRequest, request: Request):
    auth.limit(request, "research", 12, 60)
    return await agents.research(
        data.destination, data.topic, data.interest, data.diet, data.departure, data.days,
        query=data.query, refresh=data.refresh,
    )


@app.post("/api/road-route")
async def road_route(data: RouteRequest, request: Request):
    auth.limit(request, "route", 20, 60)
    key = (data.destination, tuple(data.stops))
    cached = road_cache.get(key, 1800)
    if cached:
        return source_result(cached, "cached")
    result = await agents.road_route(data.destination, data.stops)
    if result is not None:
        return road_cache.put(key, source_result(result))
    cached = road_cache.get(key, 86400)
    if cached:
        return source_result(cached, "cached")
    raise HTTPException(503, "Driving routes are unavailable for these stops.")


@app.get("/api/news")
async def travel_news(request: Request, destination: Destination | None = None,
                      topic: Literal["highlights", "transport", "events", "conditions"] = "highlights",
                      days: int = 14, location_id: int | None = Query(default=None, gt=0)):
    if days not in (7, 14, 30):
        raise HTTPException(422, "Choose a 7, 14, or 30 day coverage window.")
    auth.limit(request, "news", 18, 60)
    if location_id is not None:
        city = await locations.location_details(location_id, request)
        return await news.travel_news(None, topic, days, city_name=city["name"].replace('"', ''))
    if destination is None:
        raise HTTPException(422, "Choose a destination to check travel updates.")
    return await news.travel_news(destination, topic, days)


@app.get("/api/library")
def library(user=Depends(auth.require_user)):
    with transaction() as db:
        record = db.get(Library, user["id"])
        if record:
            return {"revision": record.revision, "library": LibraryDocument.model_validate_json(record.document)}
    return {"revision": 0, "library": LibraryDocument()}


@app.put("/api/library")
def save(data: LibraryUpdate, user=Depends(auth.require_user)):
    document = data.library.model_dump_json()
    if len(document.encode()) > 512_000:
        raise HTTPException(413, "Your library exceeds the sync limit.")
    next_revision = data.revision + 1
    try:
        with transaction() as db:
            if data.revision == 0:
                db.add(Library(user_id=user["id"], document=document, revision=next_revision))
                db.flush()
            else:
                changed = db.execute(update(Library).where(
                    Library.user_id == user["id"], Library.revision == data.revision
                ).values(document=document, revision=next_revision))
                if changed.rowcount != 1:
                    raise HTTPException(409, "Your library changed elsewhere. Reload before syncing.")
    except IntegrityError as error:
        raise HTTPException(409, "Your library changed elsewhere. Reload before syncing.") from error
    return {"revision": next_revision}
