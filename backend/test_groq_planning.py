import asyncio
import os
import unittest
from unittest.mock import patch

import httpx

from .groq_planning import browse, generate


class ResponseSequence:
    def __init__(self, responses):
        self.responses = list(responses)
        self.authorization = []

    async def post(self, url, *, headers, json):
        self.authorization.append(headers["Authorization"])
        return self.responses.pop(0)


def response(status, body=None):
    return httpx.Response(status, json=body or {}, request=httpx.Request(
        "POST", "https://api.groq.com/openai/v1/chat/completions"))


class GroqPlanningTest(unittest.TestCase):
    def test_rate_limit_retries_with_fallback_key(self):
        client = ResponseSequence([
            response(429, {"error": {"message": "rate limited"}}),
            response(200, {"choices": [{"message": {"content": "Ready", "tool_calls": []}}]}),
        ])
        with patch.dict(os.environ, {"GROQ_API_KEY_FALLBACK": "fallback-key"}):
            result = asyncio.run(generate(client, "primary-key", "test-model", [
                {"role": "user", "parts": [{"text": "Plan a trip"}]},
            ]))
        self.assertEqual(client.authorization, ["Bearer primary-key", "Bearer fallback-key"])
        self.assertEqual(result["parts"], [{"text": "Ready"}])

    def test_non_rate_limit_error_does_not_rotate_keys(self):
        client = ResponseSequence([response(500, {"error": {"message": "unavailable"}})])
        with patch.dict(os.environ, {"GROQ_API_KEY_FALLBACK": "fallback-key"}):
            with self.assertRaises(httpx.HTTPStatusError):
                asyncio.run(generate(client, "primary-key", "test-model", [
                    {"role": "user", "parts": [{"text": "Plan a trip"}]},
                ]))
        self.assertEqual(client.authorization, ["Bearer primary-key"])

    def test_browser_research_retries_with_fallback_key(self):
        source = "https://example.com/travel-guide"
        client = ResponseSequence([
            response(429, {"error": {"message": "rate limited"}}),
            response(200, {"choices": [{"message": {
                "content": "Check the guide at " + source,
                "executed_tools": [{"search_results": {"results": [
                    {"url": source, "title": "Travel guide"},
                ]}}],
            }}]}),
        ])
        with patch.dict(os.environ, {"GROQ_API_KEY": "primary-key", "GROQ_API_KEY_FALLBACK": "fallback-key"}):
            result = asyncio.run(browse(client, "unique travel search for fallback test", {"city": "Test City"}))
        self.assertEqual(client.authorization, ["Bearer primary-key", "Bearer fallback-key"])
        self.assertIn("answer", result)
        self.assertEqual(result["sources"][0]["url"], source)

    def test_browser_research_handles_http_errors_without_crashing(self):
        client = ResponseSequence([response(500, {"error": {"message": "unavailable"}})])
        with patch.dict(os.environ, {"GROQ_API_KEY": "primary-key", "GROQ_API_KEY_FALLBACK": "fallback-key"}):
            result = asyncio.run(browse(client, "unique browser error handling test", {"city": "Test City"}))
        self.assertIn("error", result)
        self.assertEqual(client.authorization, ["Bearer primary-key"])
