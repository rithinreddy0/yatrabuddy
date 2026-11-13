import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from starlette.requests import Request

from .conversation import City, Citation, ConversationRequest, Evidence, ModelConfig, converse, generate_answer
from .models import Finding


class ConversationTest(unittest.IsolatedAsyncioTestCase):
    async def test_follows_destination_context_and_links_exact_sources(self):
        finding = Finding(
            agent="Experience scout", title="Gardens by the Bay",
            url="https://example.org/places/gardens", snippet="A waterfront garden.",
            provider="Test travel guide",
        )
        request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
        data = ConversationRequest(
            destination="singapore", message="What else is nearby?",
            history=[{"role": "user", "content": "Things to do near Marina Bay"}],
        )
        with patch("backend.conversation.model_config", return_value=None), patch(
            "backend.conversation.research", new=AsyncMock(return_value={"findings": [finding]}),
        ) as research:
            response = await converse(data, request)
        self.assertEqual(response.mode, "sources")
        self.assertEqual(response.destination.id, "singapore")
        self.assertIn("Marina Bay", research.await_args.kwargs["query"])
        self.assertIn("[1]", response.answer)
        self.assertEqual(str(response.citations[0].url), "https://example.org/places/gardens")

    async def test_model_cannot_invent_citations_or_link_elsewhere(self):
        city = City(id="singapore", name="Singapore")
        data = ConversationRequest(message="What can I see?")
        evidence = [Evidence(
            Citation(id=1, title="Gardens by the Bay", url="https://example.org/gardens", provider="Test travel guide"),
            "Waterfront gardens.",
        )]
        config = ModelConfig("https://example.org/chat/completions", "test-key", "test-model")
        for answer, expected in [
            ("Visit the waterfront gardens [1].", True),
            ("Visit this secret attraction [7].", False),
            ("Open https://another.example/place [1].", False),
        ]:
            with self.subTest(answer=answer):
                response = httpx.Response(
                    200, json={"choices": [{"message": {"content": json.dumps({"answer": answer})}}]},
                    request=httpx.Request("POST", config.url),
                )
                with patch.object(httpx.AsyncClient, "post", new=AsyncMock(return_value=response)):
                    result = await generate_answer(config, data, city, evidence, timeout=2)
                self.assertEqual(result is not None, expected)
                if result:
                    self.assertEqual(result[1], [evidence[0].citation])
