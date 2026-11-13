import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .voice import MAX_AUDIO_BYTES, router


class VoiceTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.configuration = {
            "VOICE_TRANSCRIPTION_URL": "https://voice.example.test/transcriptions",
            "VOICE_TRANSCRIPTION_MODEL": "speech",
            "VOICE_API_KEY": "test-token",
        }

    def test_provider_config_and_audio_upload(self):
        def provider(request):
            self.assertEqual(request.headers["Authorization"], "Bearer test-token")
            self.assertIn(b"sample-voice-bytes", request.content)
            self.assertIn(b'filename="recording.webm"', request.content)
            return httpx.Response(200, json={"text": " Plan a trip to Kyoto. "})

        original_client = httpx.AsyncClient
        with patch.dict(os.environ, self.configuration), patch(
            "backend.voice.httpx.AsyncClient",
            side_effect=lambda **kwargs: original_client(transport=httpx.MockTransport(provider), **kwargs),
        ):
            self.assertEqual(self.client.get("/api/voice/config").json(), {"transcription": True})
            result = self.client.post(
                "/api/voice/transcribe",
                content=b"sample-voice-bytes",
                headers={"Content-Type": "audio/webm;codecs=opus"},
            )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"text": "Plan a trip to Kyoto."})

    def test_rejects_unsupported_or_oversize_audio(self):
        with patch.dict(os.environ, self.configuration):
            unknown = self.client.post(
                "/api/voice/transcribe", content=b"text", headers={"Content-Type": "text/plain"}
            )
            oversized = self.client.post(
                "/api/voice/transcribe",
                content=b"x" * (MAX_AUDIO_BYTES + 1),
                headers={"Content-Type": "audio/ogg"},
            )
        self.assertEqual(unknown.status_code, 415)
        self.assertEqual(oversized.status_code, 413)

    def test_missing_provider_is_reported(self):
        with patch.dict(os.environ, {"VOICE_TRANSCRIPTION_URL": ""}):
            self.assertEqual(self.client.get("/api/voice/config").json(), {"transcription": False})
            self.assertEqual(self.client.post("/api/voice/transcribe").status_code, 503)
