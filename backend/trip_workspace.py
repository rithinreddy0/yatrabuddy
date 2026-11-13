"""Persist collaborative tools for source-backed itinerary drafts."""

import asyncio
import re
import secrets
from datetime import date as CalendarDate
from datetime import datetime, timezone
from time import time
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, HttpUrl, StringConstraints, ValidationError
from sqlalchemy import ForeignKey, LargeBinary, String, Text, UniqueConstraint, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from . import auth
from .db import Base, transaction
from .models import LocalMode, MealPreference, Pace, WorldwideDraft, WorldwideLeg, WorldwidePlace

router = APIRouter(prefix="/api/trip-workspaces")
COOKIE = "yatra_workspace"
FILE_LIMIT = 12 * 1024 * 1024
WORKSPACE_FILE_LIMIT = 48 * 1024 * 1024
TextValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=220)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Kind = Literal["idea", "booking", "message", "media"]


class Workspace(Base):
    __tablename__ = "trip_workspaces"
    __table_args__ = (UniqueConstraint("owner", "draft_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(72))
    draft_id: Mapped[str] = mapped_column(String(36))
    draft: Mapped[str] = mapped_column(Text)
    updated: Mapped[int]
    invite_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    stored_bytes: Mapped[int] = mapped_column(default=0)


class Member(Base):
    __tablename__ = "trip_workspace_members"

    workspace_id: Mapped[str] = mapped_column(ForeignKey("trip_workspaces.id"), primary_key=True)
    principal: Mapped[str] = mapped_column(String(72), primary_key=True)
    name: Mapped[str] = mapped_column(String(70))


class Entry(Base):
    __tablename__ = "trip_workspace_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("trip_workspaces.id"), index=True)
    author: Mapped[str] = mapped_column(String(72))
    kind: Mapped[str] = mapped_column(String(12))
    document: Mapped[str] = mapped_column(Text)
    created: Mapped[str] = mapped_column(String(35))
    file_size: Mapped[int] = mapped_column(default=0)
    file_mime: Mapped[str | None] = mapped_column(String(32))


class Attachment(Base):
    __tablename__ = "trip_workspace_attachments"

    entry_id: Mapped[str] = mapped_column(ForeignKey("trip_workspace_entries.id"), primary_key=True)
    mime: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)


class JoinRequest(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=70)]


class DayStopInput(BaseModel):
    url: HttpUrl


class PreferenceInput(BaseModel):
    model_config = {"extra": "forbid"}

    expectedUpdated: int = Field(ge=0)
    origin: TextValue | None = None
    departure: CalendarDate | None = None
    travelers: int = Field(ge=1, le=8)
    budget: int | None = Field(default=None, ge=1000, le=10_000_000)
    mealPreference: MealPreference
    pace: Pace
    localModes: list[LocalMode] = Field(max_length=5)


class EntryInput(BaseModel):
    kind: Kind
    title: TextValue | None = None
    notes: Notes = ""
    url: HttpUrl | None = None
    place: TextValue | None = None
    category: TextValue | None = None
    date: CalendarDate | None = None
    amount: int | None = Field(default=None, ge=0, le=10_000_000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    thumbnail: HttpUrl | None = None
    sourceUrl: HttpUrl | None = None
    license: TextValue | None = None
    licenseUrl: HttpUrl | None = None
    credit: Notes = ""


def principal(request: Request, response: Response | None = None):
    user = auth.current_user(request)
    if user:
        return f"account:{user['id']}", user["name"]
    token = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        if response is None:
            return None, ""
        token = secrets.token_hex(32)
        response.set_cookie(
            COOKIE, token, max_age=365 * 86400, httponly=True, secure=auth.SECURE, samesite="lax", path="/api",
        )
    return f"guest:{auth.digest(token)}", "Organizer"


def access(db, workspace_id: UUID, identity: str | None):
    workspace = db.get(Workspace, str(workspace_id))
    member = db.get(Member, (str(workspace_id), identity)) if identity else None
    if not workspace or not member:
        raise HTTPException(404, "This workspace is unavailable. Open your invitation to join.")
    return workspace, member


def invite_lookup(db, code: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32}", code):
        raise HTTPException(404, "This invite link is unavailable.")
    workspace = db.scalar(select(Workspace).where(Workspace.invite_digest == auth.digest(code)))
    if not workspace:
        raise HTTPException(404, "This invite link is unavailable.")
    return workspace


def state(db, workspace: Workspace, member: Member):
    members = {row.principal: row.name for row in db.scalars(select(Member).where(Member.workspace_id == workspace.id))}
    entries = db.scalars(select(Entry).where(Entry.workspace_id == workspace.id).order_by(Entry.created, Entry.id))
    is_owner = workspace.owner == member.principal
    return {
        "id": workspace.id,
        "draft": WorldwideDraft.model_validate_json(workspace.draft),
        "isOwner": is_owner,
        "inviteActive": is_owner and bool(workspace.invite_digest),
        "members": list(members.values()),
        "entries": [
            {
                **EntryInput.model_validate_json(item.document).model_dump(mode="json"),
                "id": item.id, "created": item.created, "author": members.get(item.author, "Traveler"),
                "mine": item.author == member.principal,
                "canRemove": is_owner or item.author == member.principal,
                "attachment": f"/api/trip-workspaces/{workspace.id}/files/{item.id}" if item.file_size else None,
                "attachmentType": item.file_mime,
            }
            for item in entries
        ],
    }


@router.post("")
def save_workspace(draft: WorldwideDraft, request: Request, response: Response):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, name = principal(request, response)
    draft_id = str(draft.id)
    document = draft.model_dump_json()
    try:
        with transaction() as db:
            workspace = db.scalar(select(Workspace).where(Workspace.owner == identity, Workspace.draft_id == draft_id))
            if workspace:
                db.execute(update(Workspace).where(Workspace.id == workspace.id, Workspace.updated < draft.updated)
                           .values(draft=document, updated=draft.updated))
                return state(db, workspace, db.get(Member, (workspace.id, identity)))
            workspace = Workspace(id=str(uuid4()), owner=identity, draft_id=draft_id, draft=document, updated=draft.updated)
            db.add(workspace)
            db.flush()
            member = Member(workspace_id=workspace.id, principal=identity, name=name)
            db.add(member)
            db.flush()
            return state(db, workspace, member)
    except IntegrityError as error:
        raise HTTPException(409, "The workspace changed while opening. Try again.") from error


@router.get("")
def list_workspaces(request: Request):
    identity, _ = principal(request)
    if not identity:
        return []
    with transaction() as db:
        rows = db.scalars(select(Workspace).join(Member).where(Member.principal == identity)
                          .order_by(Workspace.updated.desc()).limit(25))
        return [
            {"id": row.id, "name": WorldwideDraft.model_validate_json(row.draft).name, "isOwner": row.owner == identity}
            for row in rows
        ]


@router.get("/invites/{code}")
def invite_preview(code: str, request: Request):
    auth.limit(request, "trip-workspace-join", 40, 60)
    with transaction() as db:
        workspace = invite_lookup(db, code)
        return {"name": WorldwideDraft.model_validate_json(workspace.draft).name}


@router.post("/invites/{code}")
def join_workspace(code: str, data: JoinRequest, request: Request, response: Response):
    auth.limit(request, "trip-workspace-join", 40, 60)
    identity, _ = principal(request, response)
    try:
        with transaction() as db:
            workspace = invite_lookup(db, code)
            member = db.get(Member, (workspace.id, identity))
            if not member:
                member_count = db.scalar(select(func.count()).select_from(Member).where(Member.workspace_id == workspace.id))
                if member_count >= 25:
                    raise HTTPException(409, "This trip group is full.")
                member = Member(workspace_id=workspace.id, principal=identity, name=data.name)
                db.add(member)
                db.flush()
            return state(db, workspace, member)
    except IntegrityError as error:
        raise HTTPException(409, "Your membership changed while joining. Try again.") from error


@router.get("/{workspace_id}")
def get_workspace(workspace_id: UUID, request: Request):
    identity, _ = principal(request)
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        return state(db, workspace, member)


def organizer_snapshot(workspace_id, identity):
    with transaction() as db:
        workspace, _ = access(db, workspace_id, identity)
        if workspace.owner != identity:
            raise HTTPException(403, "Only the organizer can edit the itinerary.")
        return workspace.draft


def commit_draft(workspace_id, identity, snapshot, draft):
    draft.updated = max(int(time() * 1000), draft.updated + 1)
    document = WorldwideDraft.model_validate_json(draft.model_dump_json()).model_dump_json()
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        changed = db.execute(update(Workspace).where(Workspace.id == workspace.id, Workspace.draft == snapshot)
                             .values(draft=document, updated=draft.updated))
        if not changed.rowcount:
            raise HTTPException(409, "The trip changed in another tab. Review the latest plan and try again.")
        db.refresh(workspace)
        return state(db, workspace, member)


async def update_day_route(draft, index):
    from .nearby import estimate_day_route

    stay = draft.stay.model_dump(mode="json") if draft.stay else None

    async def route(day):
        points = [item.model_dump(mode="json") for item in day]
        legs, geometry = await estimate_day_route(points, stay, include_geometry=True)
        return [WorldwideLeg.model_validate(leg) for leg in legs], geometry

    if draft.routes:
        legs, geometry = await route(draft.days[index])
        draft.routes[index] = legs
        draft.routeGeometry = draft.routeGeometry or [[] for _ in draft.days]
        draft.routeGeometry[index] = geometry
    else:
        routed = await asyncio.gather(*(route(day) for day in draft.days))
        draft.routes, draft.routeGeometry = map(list, zip(*routed))
    draft.routeAdvice = None


def day_index(draft, day):
    if not 1 <= day <= len(draft.days):
        raise HTTPException(404, "This day does not exist.")
    return day - 1


@router.post("/{workspace_id}/days/{day}/stops")
async def add_day_stop(workspace_id: UUID, day: int, data: DayStopInput, request: Request):
    from .nearby import distance_metres, nearby_report, ordered_day
    from .place_photos import cached_place_photo
    from .place_search import verified_place

    auth.limit(request, "trip-workspace-stop", 15, 60)
    identity, _ = principal(request)
    snapshot = organizer_snapshot(workspace_id, identity)
    draft = WorldwideDraft.model_validate_json(snapshot)
    index = day_index(draft, day)
    url = str(data.url)
    if any(str(stop.url) == url for stops in draft.days for stop in stops):
        raise HTTPException(409, "This stop is already in your itinerary.")
    if len(draft.days[index]) >= 5:
        raise HTTPException(422, "Choose a day with fewer than five stops.")
    report = await nearby_report(draft.cityId)
    record = next((place for place in report["places"] if place["url"] == url), None) or verified_place(url)
    if not record or record.get("category") == "Stay" or record.get("lat") is None or record.get("lon") is None:
        raise HTTPException(422, "Choose a mapped stop from the current destination results.")
    radius = 110_000 if report["location"].get("kind") == "region" else 40_000
    if distance_metres(report["location"], record) > radius:
        raise HTTPException(422, "This stop is outside the destination search area.")
    stop = WorldwidePlace.model_validate({**record, "photo": record.get("photo") or cached_place_photo(url)})
    points = ordered_day([item.model_dump(mode="json") for item in [*draft.days[index], stop]])
    draft.days[index] = [WorldwidePlace.model_validate(point) for point in points]
    await update_day_route(draft, index)
    return commit_draft(workspace_id, identity, snapshot, draft)


@router.delete("/{workspace_id}/days/{day}/stops")
async def remove_day_stop(workspace_id: UUID, day: int, data: DayStopInput, request: Request):
    auth.limit(request, "trip-workspace-stop", 15, 60)
    identity, _ = principal(request)
    snapshot = organizer_snapshot(workspace_id, identity)
    draft = WorldwideDraft.model_validate_json(snapshot)
    index = day_index(draft, day)
    url = str(data.url)
    stops = [stop for stop in draft.days[index] if str(stop.url) != url]
    if len(stops) == len(draft.days[index]):
        raise HTTPException(404, "This stop is no longer on the selected day.")
    if not stops and not any(day_stops for i, day_stops in enumerate(draft.days) if i != index):
        raise HTTPException(422, "Keep at least one stop in the itinerary.")
    draft.days[index] = stops
    draft.stopCosts.pop(url, None)
    await update_day_route(draft, index)
    return commit_draft(workspace_id, identity, snapshot, draft)


@router.patch("/{workspace_id}/preferences")
def update_preferences(workspace_id: UUID, data: PreferenceInput, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    snapshot = organizer_snapshot(workspace_id, identity)
    draft = WorldwideDraft.model_validate_json(snapshot)
    if draft.updated != data.expectedUpdated:
        raise HTTPException(409, "The trip changed in another tab. Review the latest plan and try again.")
    changes = data.model_dump(exclude={"expectedUpdated"})
    if changes["travelers"] != draft.travelers:
        changes["party"] = None
    next_draft = WorldwideDraft.model_validate({**draft.model_dump(), **changes, "routeAdvice": None})
    return commit_draft(workspace_id, identity, snapshot, next_draft)


@router.put("/{workspace_id}/name")
def set_display_name(workspace_id: UUID, data: JoinRequest, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        member.name = data.name
        db.flush()
        return state(db, workspace, member)


@router.post("/{workspace_id}/invite")
def create_invite(workspace_id: UUID, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    code = secrets.token_urlsafe(24)
    with transaction() as db:
        workspace, _ = access(db, workspace_id, identity)
        if workspace.owner != identity:
            raise HTTPException(403, "Only the organizer can manage invitations.")
        workspace.invite_digest = auth.digest(code)
    return {"code": code}


@router.delete("/{workspace_id}/invite", status_code=204)
def revoke_invite(workspace_id: UUID, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    with transaction() as db:
        workspace, _ = access(db, workspace_id, identity)
        if workspace.owner != identity:
            raise HTTPException(403, "Only the organizer can manage invitations.")
        workspace.invite_digest = None


def new_entry(db, workspace, identity, data, file_size=0, file_mime=None):
    entry_count = db.scalar(select(func.count()).select_from(Entry).where(Entry.workspace_id == workspace.id))
    if entry_count >= 500:
        raise HTTPException(409, "This workspace has reached its item limit.")
    entry = Entry(
        id=str(uuid4()), workspace_id=workspace.id, author=identity, kind=data.kind,
        document=data.model_dump_json(), created=datetime.now(timezone.utc).isoformat(),
        file_size=file_size, file_mime=file_mime,
    )
    db.add(entry)
    return entry


def validate_entry(data: EntryInput, uploading=False):
    if data.kind == "message" and not data.notes:
        raise HTTPException(422, "Enter a message.")
    if data.kind != "message" and not data.title:
        raise HTTPException(422, "Give this item a title.")
    if data.kind == "media" and not data.url and not uploading:
        raise HTTPException(422, "Add a link or upload a file.")
    for link in (data.url, data.thumbnail, data.sourceUrl, data.licenseUrl):
        if link and (link.scheme != "https" or link.username or link.password):
            raise HTTPException(422, "Enter a public HTTPS link.")


@router.post("/{workspace_id}/entries")
def add_entry(workspace_id: UUID, data: EntryInput, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    validate_entry(data)
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        new_entry(db, workspace, identity, data)
        db.flush()
        return state(db, workspace, member)


@router.delete("/{workspace_id}/entries/{entry_id}")
def remove_entry(workspace_id: UUID, entry_id: UUID, request: Request):
    auth.limit(request, "trip-workspace-write", 100, 60)
    identity, _ = principal(request)
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        entry = db.get(Entry, str(entry_id))
        if not entry or entry.workspace_id != workspace.id:
            raise HTTPException(404, "This item is unavailable.")
        if identity not in (entry.author, workspace.owner):
            raise HTTPException(403, "Only its author or the organizer can remove this item.")
        if entry.file_size:
            db.execute(update(Workspace).where(Workspace.id == workspace.id)
                       .values(stored_bytes=Workspace.stored_bytes - entry.file_size))
            db.delete(db.get(Attachment, entry.id))
            db.flush()
        db.delete(entry)
        db.flush()
        return state(db, workspace, member)


def identify_mime(content: bytes):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content[4:8] == b"ftyp":
        return "video/mp4"
    if content.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in content[:4096]:
        return "video/webm"
    return None


@router.post("/{workspace_id}/files")
async def upload_file(workspace_id: UUID, request: Request):
    auth.limit(request, "trip-workspace-upload", 12, 60)
    identity, _ = principal(request)
    with transaction() as db:
        access(db, workspace_id, identity)
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > FILE_LIMIT + 16_384:
            raise HTTPException(413, "Choose a file smaller than 12 MB.")
        payload.extend(chunk)
    # The first line contains entry metadata. The remaining bytes are the attachment.
    boundary = payload.find(b"\n", 0, 16_384)
    if boundary < 0:
        raise HTTPException(422, "The attachment metadata is missing.")
    try:
        data = EntryInput.model_validate_json(bytes(payload[:boundary]))
    except ValidationError as error:
        raise HTTPException(422, "The attachment metadata is invalid.") from error
    if data.kind not in ("booking", "media"):
        raise HTTPException(422, "Attachments belong to bookings or media.")
    validate_entry(data, uploading=True)
    if len(payload) - boundary - 1 > FILE_LIMIT:
        raise HTTPException(413, "Choose a file smaller than 12 MB.")
    content = bytes(payload[boundary + 1:])
    mime = identify_mime(content)
    if not mime or (data.kind == "booking" and mime.startswith("video/")):
        raise HTTPException(415, "Choose a supported image, document or video file.")
    with transaction() as db:
        workspace, member = access(db, workspace_id, identity)
        changed = db.execute(update(Workspace).where(
            Workspace.id == workspace.id, Workspace.stored_bytes <= WORKSPACE_FILE_LIMIT - len(content),
        ).values(stored_bytes=Workspace.stored_bytes + len(content)))
        if changed.rowcount != 1:
            raise HTTPException(409, "This workspace is out of file storage.")
        entry = new_entry(db, workspace, identity, data, len(content), mime)
        db.flush()
        db.add(Attachment(entry_id=entry.id, mime=mime, data=content))
        return state(db, workspace, member)


@router.get("/{workspace_id}/files/{entry_id}")
def download_file(workspace_id: UUID, entry_id: UUID, request: Request):
    identity, _ = principal(request)
    with transaction() as db:
        access(db, workspace_id, identity)
        entry = db.get(Entry, str(entry_id))
        file = db.get(Attachment, str(entry_id)) if entry and entry.workspace_id == str(workspace_id) else None
        if not file:
            raise HTTPException(404, "This file is unavailable.")
        # PDFs may contain executable document actions. Serve them as downloads.
        disposition = "attachment" if file.mime == "application/pdf" else "inline"
        headers = {
            "Content-Disposition": disposition, "Content-Security-Policy": "default-src 'none'; sandbox",
            "Accept-Ranges": "bytes",
        }
        match = re.fullmatch(r"bytes=(\d{0,12})-(\d{0,12})", request.headers.get("range", ""))
        if match and (match[1] or match[2]):
            size = len(file.data)
            start = int(match[1]) if match[1] else max(0, size - int(match[2]))
            end = min(size - 1, int(match[2])) if match[1] and match[2] else size - 1
            if start > end:
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
            return Response(file.data[start:end + 1], status_code=206, media_type=file.mime, headers=headers)
        return Response(file.data, media_type=file.mime, headers=headers)
