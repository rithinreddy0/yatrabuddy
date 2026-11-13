import os
import unittest
from unittest.mock import patch

import httpx

from backend.source_crawler import article_paragraphs, article_url, page_body, relevant_paragraph


class SourceCrawlerTest(unittest.IsolatedAsyncioTestCase):
    def test_only_accepts_public_article_urls_from_fixed_hosts(self):
        self.assertEqual(article_url("https://en.wikivoyage.org/wiki/Tokyo"), "https://en.wikivoyage.org/wiki/Tokyo")
        for unsafe in (
            "http://en.wikipedia.org/wiki/Tokyo", "https://en.wikipedia.org.evil.example/wiki/Tokyo",
            "https://en.wikipedia.org@evil.example/wiki/Tokyo", "https://en.wikipedia.org/wiki/%2e%2e/a",
            "https://en.wikipedia.org/wiki/Special%3ARedirect", "https://en.wikipedia.org/wiki/Tokyo#See",
        ):
            self.assertIsNone(article_url(unsafe))

    async def test_disabled_crawler_does_not_request_page(self):
        with patch.dict(os.environ, {"ENABLE_CRAWL4AI": "0"}), patch("backend.source_crawler.httpx.AsyncClient") as client:
            self.assertEqual(await article_paragraphs("https://en.wikivoyage.org/wiki/Tokyo", 2), [])
        client.assert_not_called()

    async def test_http_redirect_and_oversized_html_are_rejected(self):
        def response(request):
            if request.url.path == "/redirect":
                return httpx.Response(302, headers={"Location": "https://example.com"})
            return httpx.Response(200, content=b"0123456789", headers={"Content-Type": "text/html"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            with self.assertRaises(httpx.HTTPStatusError):
                await page_body(client, "https://en.wikipedia.org/redirect", max_bytes=20, content_type="text/html")
            with self.assertRaises(ValueError):
                await page_body(client, "https://en.wikipedia.org/wiki/Tokyo", max_bytes=5, content_type="text/html")

    async def test_robot_rules_block_fetch_and_allowed_articles_use_extractor(self):
        paths = []
        paragraphs = ["The palace grounds include gardens and historic architecture."]

        def response(request):
            paths.append(request.url.path)
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nDisallow: /wiki/Private\n")
            return httpx.Response(200, html="<p>Palace gardens</p>")

        clients = [httpx.AsyncClient(transport=httpx.MockTransport(response)) for _ in range(2)]
        with (patch.dict(os.environ, {"ENABLE_CRAWL4AI": "1"}),
              patch("backend.source_crawler.load_strategy", return_value=object()),
              patch("backend.source_crawler.httpx.AsyncClient", side_effect=clients),
              patch("backend.source_crawler.extract_paragraphs", return_value=paragraphs),
              patch("backend.source_crawler._robots", {}), patch("backend.source_crawler._pages", {})):
            self.assertEqual(await article_paragraphs("https://en.wikivoyage.org/wiki/Palace", 2), paragraphs)
            self.assertEqual(await article_paragraphs("https://en.wikivoyage.org/wiki/Private", 2), [])
        self.assertEqual(paths, ["/robots.txt", "/wiki/Palace"])

    def test_paragraph_selection_prefers_additional_matching_detail(self):
        self.assertEqual(relevant_paragraph(["Tokyo is a city.", "The grounds have several gardens."],
                                           "Tokyo gardens", "A sight in Tokyo."), "The grounds have several gardens.")
