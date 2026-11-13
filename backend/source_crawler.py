"""Optional Crawl4AI extraction of cited Wikimedia articles."""

import asyncio
import logging
import os
import re
from functools import lru_cache
from html.parser import HTMLParser
from time import monotonic
from urllib.parse import unquote, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx

from .agents import USER_AGENT


logger = logging.getLogger(__name__)
ALLOWED_HOSTS = {"en.wikipedia.org", "en.wikivoyage.org"}
MAX_HTML_BYTES = 1_500_000
_slots = asyncio.Semaphore(2)
_pages = {}
_robots = {}


class ArticleParagraphs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self.fragments = None

    def handle_starttag(self, tag, attrs):
        if tag == "p":
            self.fragments = []

    def handle_data(self, data):
        if self.fragments is not None:
            self.fragments.append(data)

    def handle_endtag(self, tag):
        if tag == "p" and self.fragments is not None:
            paragraph = " ".join("".join(self.fragments).split())
            if len(paragraph) >= 100:
                self.paragraphs.append(paragraph[:480])
            self.fragments = None


def article_url(value):
    try:
        target = urlsplit(str(value))
    except ValueError:
        return None
    if (target.scheme != "https" or target.netloc not in ALLOWED_HOSTS or target.query or target.fragment
            or not target.path.startswith("/wiki/") or len(target.path) > 600):
        return None
    title = unquote(target.path.removeprefix("/wiki/"))
    if not title or ":" in title or any(part in {".", ".."} for part in title.split("/")):
        return None
    return urlunsplit(("https", target.netloc, target.path, "", ""))


async def page_body(client, url, *, max_bytes, content_type):
    async with client.stream("GET", url, follow_redirects=False) as response:
        response.raise_for_status()
        if response.headers.get("Content-Type", "").split(";", 1)[0].lower() != content_type:
            raise ValueError("Unexpected content type")
        body = bytearray()
        async for chunk in response.aiter_bytes(chunk_size=32_768):
            if len(body) + len(chunk) > max_bytes:
                raise ValueError("Response exceeds the extraction limit")
            body.extend(chunk)
        return body.decode(response.encoding or "utf-8", errors="replace").removeprefix("\ufeff")


async def permitted(client, url):
    host = urlsplit(url).netloc
    cached = _robots.get(host)
    if cached and monotonic() - cached[0] < 3600:
        rules = cached[1]
    else:
        robots_url = f"https://{host}/robots.txt"
        body = await page_body(client, robots_url, max_bytes=128_000, content_type="text/plain")
        rules = RobotFileParser(robots_url)
        rules.parse(body.splitlines())
        _robots[host] = (monotonic(), rules)
    return rules.can_fetch(USER_AGENT.split("/", 1)[0], url)


def extract_paragraphs(url, body):
    strategy = load_strategy()
    if strategy is None:
        return []
    result = strategy().scrap(
        url, body, css_selector=".mw-parser-output", excluded_tags=["table", "nav", "footer", "sup"],
        exclude_external_links=True, exclude_external_images=True, word_count_threshold=15,
    )
    if not result.success:
        return []
    content = ArticleParagraphs()
    content.feed(result.cleaned_html)
    return content.paragraphs[:60]


def enabled():
    return os.getenv("ENABLE_CRAWL4AI", "").lower() in {"1", "true"}


@lru_cache(maxsize=1)
def load_strategy():
    try:
        from crawl4ai import LXMLWebScrapingStrategy
    except ImportError:
        logger.warning("Crawl4AI extraction requires backend/requirements-crawl.txt")
        return None
    except Exception:
        logger.warning("Crawl4AI initialization failed", exc_info=True)
        return None
    return LXMLWebScrapingStrategy


async def article_paragraphs(url, timeout):
    if not enabled() or timeout < 0.5:
        return []
    if load_strategy() is None:
        return []
    url = article_url(url)
    if not url:
        return []
    cached = _pages.get(url)
    if cached and monotonic() - cached[0] < 900:
        return cached[1]
    try:
        async with asyncio.timeout(timeout), _slots:
            async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}) as client:
                if not await permitted(client, url):
                    return []
                body = await page_body(client, url, max_bytes=MAX_HTML_BYTES, content_type="text/html")
            paragraphs = await asyncio.to_thread(extract_paragraphs, url, body)
    except (httpx.HTTPError, TimeoutError, LookupError, ValueError):
        return []
    except Exception:
        logger.warning("Crawl4AI article extraction failed", exc_info=True)
        return []
    if len(_pages) >= 128:
        _pages.pop(next(iter(_pages)))
    _pages[url] = (monotonic(), paragraphs)
    return paragraphs


def relevant_paragraph(paragraphs, question, prior_detail):
    terms = set(re.findall(r"\b[^\W\d_]{4,}\b", question.casefold()))
    terms.difference_update(re.findall(r"\b\w+\b", prior_detail.casefold()))
    if not terms:
        return None

    def score(paragraph):
        return len(terms.intersection(re.findall(r"\b\w+\b", paragraph.casefold())))

    best = max(paragraphs, key=score, default="")
    return best if score(best) else None


if enabled():
    # Optional import can take several seconds. Pay that cost at process startup.
    load_strategy()
