"""Optional, bounded audio transcription for browsers without Web Speech."""

import os
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request

from .auth import limit

router = APIRouter(prefix="/api/voice")
MAX_AUDIO_BYTES = 600_000
AUDIO_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}


def transcription_config():
    url = os.getenv("VOICE_TRANSCRIPTION_URL", "").strip()
    model = os.getenv("VOICE_TRANSCRIPTION_MODEL", "").strip()
    key = (os.getenv("VOICE_API_KEY") or os.getenv("AI_API_KEY") or "").strip()
    try:
        address = urlsplit(url)
    except ValueError:
        return None
    if (
        address.scheme == "https"
        and address.hostname
        and not (address.username or address.password or address.query or address.fragment)
        and key
        and model
    ):
        return url, model, key
    return None


@router.get("/config")
def voice_config():
    return {"transcription": transcription_config() is not None}


@router.post("/transcribe")
async def transcribe(request: Request):
    provider = transcription_config()
    if not provider:
        raise HTTPException(503, "The audio transcription service is unavailable.")
    limit(request, "voice-transcription", 12, 60)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    extension = AUDIO_EXTENSIONS.get(content_type)
    if not extension:
        raise HTTPException(415, "This audio format is unsupported.")
    audio = bytearray()
    async for chunk in request.stream():
        if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "The recording is too large. Try a shorter question.")
        audio.extend(chunk)
    if not audio:
        raise HTTPException(422, "No audio was captured.")
    url, model, key = provider
    try:
        async with httpx.AsyncClient(timeout=16, follow_redirects=False) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                files={"file": (f"recording.{extension}", bytes(audio), content_type)},
                data={"model": model},
            )
            response.raise_for_status()
            result = response.json()
            text = result.get("text") if isinstance(result, dict) else None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "The audio transcription service could not finish.") from None
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(422, "No speech was recognized. Try speaking closer to the microphone.")
    return {"text": text.strip()[:500]}
