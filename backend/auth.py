import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from threading import Lock

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from .db import AccountProfile, FirebaseIdentity, LoginSession, User, transaction
from . import account_mail

router = APIRouter(prefix="/api")
COOKIE = "wayfarer_session"
LIFETIME = 30 * 24 * 3600
SECURE = os.environ.get("SECURE_COOKIES") == "1"
_ATTEMPTS = {}
_LOCK = Lock()


class Credentials(BaseModel):
    name: str = Field(default="", max_length=70)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class FirebaseToken(BaseModel):
    token: str = Field(min_length=100, max_length=8192)


def firebase_config():
    config = {
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "").strip(),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "").strip(),
        "apiKey": os.getenv("FIREBASE_WEB_API_KEY", "").strip(),
        "appId": os.getenv("FIREBASE_WEB_APP_ID", "").strip(),
    }
    return config if all(config.values()) else None


def google_required():
    return os.getenv("REQUIRE_GOOGLE_SIGN_IN", "1") != "0"


def limit(request: Request, bucket: str, maximum: int, seconds: int):
    key = (bucket, request.client.host if request.client else "unknown")
    now = time.monotonic()
    with _LOCK:
        for expired in [item for item, (end, _) in _ATTEMPTS.items() if end <= now]:
            del _ATTEMPTS[expired]
        end, count = _ATTEMPTS.get(key, (now + seconds, 0))
        if count >= maximum:
            raise HTTPException(429, "Too many requests. Try again shortly.")
        _ATTEMPTS[key] = (end, count + 1)


def digest(token: str):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64).hex()


def account_details(user):
    return {"id": user.id, "name": user.name, "email": user.email}


def current_user(request: Request):
    cached = getattr(request.state, "signed_in_user", None)
    if cached:
        return cached
    token = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        return None
    with transaction() as db:
        query = select(User).join(LoginSession).where(
            LoginSession.token == digest(token), LoginSession.expires > int(time.time())
        )
        if google_required():
            query = query.join(FirebaseIdentity, FirebaseIdentity.user_id == User.id)
        user = db.scalar(query)
        return account_details(user) if user else None


def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Sign in to sync your library.")
    return user


class AccountEdit(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}
    name: str = Field(min_length=1, max_length=70)
    username: str = Field(max_length=40, pattern=r"^[A-Za-z0-9_.-]*$")
    phone: str = Field(max_length=32, pattern=r"^\+?[0-9 ()-]*$")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value):
        if value and not 7 <= sum(char.isdigit() for char in value) <= 15:
            raise ValueError("Enter a phone number with 7 to 15 digits.")
        return value


def private_account(user, profile):
    return {**account_details(user), "username": profile.username if profile else "", "phone": profile.phone if profile else ""}


@router.get("/account")
def get_account(identity=Depends(require_user)):
    with transaction() as db:
        return private_account(db.get(User, identity["id"]), db.get(AccountProfile, identity["id"]))


@router.put("/account")
def update_account(data: AccountEdit, request: Request, identity=Depends(require_user)):
    limit(request, "account-profile", 30, 60)
    with transaction() as db:
        user = db.scalar(select(User).where(User.id == identity["id"]).with_for_update())
        user.name = data.name
        profile = db.get(AccountProfile, user.id) or AccountProfile(user_id=user.id)
        profile.username, profile.phone = data.username, data.phone
        db.add(profile)
        return private_account(user, profile)


def session_cookie(request, response, db, user_id):
    old = request.cookies.get(COOKIE)
    if old:
        db.execute(delete(LoginSession).where(LoginSession.token == digest(old)))
    now = int(time.time())
    db.execute(delete(LoginSession).where(LoginSession.expires <= now))
    token = secrets.token_hex(32)
    db.add(LoginSession(token=digest(token), user_id=user_id, expires=now + LIFETIME))
    response.set_cookie(COOKIE, token, max_age=LIFETIME, httponly=True, secure=SECURE, samesite="lax", path="/api")


@router.get("/session")
def session(request: Request):
    return {"user": current_user(request)}


@router.post("/register", status_code=201)
def register(data: Credentials, request: Request, response: Response, background_tasks: BackgroundTasks):
    if google_required():
        raise HTTPException(403, "Create your account by continuing with Google.")
    limit(request, "auth", 12, 60)
    email, name = data.email.strip().casefold(), data.name.strip()
    if not name or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Enter your name and a valid email address.")
    salt = secrets.token_bytes(16)
    try:
        with transaction() as db:
            user = User(name=name, email=email, password=f"{salt.hex()}:{password_hash(data.password, salt)}")
            db.add(user)
            db.flush()
            session_cookie(request, response, db, user.id)
            account = account_details(user)
    except IntegrityError as error:
        raise HTTPException(409, "This email is already registered.") from error
    welcome_email = account_mail.configured()
    if welcome_email:
        background_tasks.add_task(account_mail.send_welcome, email)
    return {"user": account, "welcomeEmail": "scheduled" if welcome_email else "unavailable"}


@router.post("/login")
def login(data: Credentials, request: Request, response: Response):
    if google_required():
        raise HTTPException(403, "Sign in with Google to use YatraBuddy.")
    limit(request, "auth", 12, 60)
    with transaction() as db:
        user = db.scalar(select(User).where(User.email == data.email.strip().casefold()))
        salt, expected = user.password.split(":") if user and user.password else ("00" * 16, "0" * 128)
        candidate = password_hash(data.password, bytes.fromhex(salt))
        if not user or not user.password or not hmac.compare_digest(expected, candidate):
            raise HTTPException(401, "That email and password do not match.")
        session_cookie(request, response, db, user.id)
        return {"user": account_details(user)}


@router.get("/auth/config")
def social_config():
    return {"firebase": firebase_config(), "googleRequired": google_required()}


def firebase_identity(token, config):
    try:
        with httpx.Client(timeout=7) as client:
            result = client.post(
                "https://identitytoolkit.googleapis.com/v1/accounts:lookup",
                params={"key": config["apiKey"]},
                json={"idToken": token},
            )
            result.raise_for_status()
    except httpx.RequestError as error:
        raise HTTPException(503, "Google sign-in is temporarily unavailable. Try again.") from error
    except httpx.HTTPStatusError as error:
        if error.response.status_code in {429, 500, 502, 503, 504}:
            raise HTTPException(503, "Google sign-in is temporarily unavailable. Try again.") from error
        raise HTTPException(401, "Google identity could not be verified.") from error

    try:
        profile = result.json()["users"][0]
        segment = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
        project = config["projectId"]
        uid = profile["localId"]
        email = profile["email"].strip().casefold()
        if (
            claims["aud"] != project
            or claims["iss"] != f"https://securetoken.google.com/{project}"
            or claims["sub"] != uid
            or claims["firebase"]["sign_in_provider"] != "google.com"
            or int(claims["exp"]) <= time.time()
            or profile.get("emailVerified") is not True
            or profile.get("disabled")
            or not 1 <= len(uid) <= 128
            or len(email) > 254
            or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)
        ):
            raise ValueError("Invalid Firebase identity")
        display_name = (profile.get("displayName") or "").strip()
        return uid, email, (display_name or email.split("@")[0])[:70]
    except (AttributeError, ValueError, KeyError, IndexError, TypeError) as error:
        raise HTTPException(401, "Google identity could not be verified.") from error


@router.post("/auth/firebase")
def google_sign_in(data: FirebaseToken, request: Request, response: Response):
    limit(request, "auth", 12, 60)
    config = firebase_config()
    if not config:
        raise HTTPException(503, "Google sign-in has not been configured.")
    uid, email, name = firebase_identity(data.token, config)
    try:
        with transaction() as db:
            identity = db.get(FirebaseIdentity, uid)
            new_account = not identity
            if identity:
                user = db.get(User, identity.user_id)
            else:
                user = db.scalar(select(User).where(User.email == email))
                if user:
                    raise HTTPException(409, "An existing account already uses this email. Use another Google account or contact support to recover access.")
                if not user:
                    user = User(name=name, email=email, password="")
                    db.add(user)
                    db.flush()
                db.add(FirebaseIdentity(uid=uid, user_id=user.id))
            session_cookie(request, response, db, user.id)
            return {"user": account_details(user), "newAccount": new_account}
    except IntegrityError as error:
        raise HTTPException(409, "An account already uses this email. Try signing in again.") from error


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with transaction() as db:
            db.execute(delete(LoginSession).where(LoginSession.token == digest(token)))
    response.delete_cookie(COOKIE, path="/api", secure=SECURE, httponly=True, samesite="lax")
    return {}
