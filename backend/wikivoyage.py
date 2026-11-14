"""Fetch geocoded listings published on Wikivoyage city and district guides."""

import asyncio
import json
import re
from html.parser import HTMLParser
from math import isfinite
from time import monotonic
from urllib.parse import quote, unquote, urlsplit

import httpx

from .wikimedia import note_response, read_gate, require_available, WikimediaUnavailable

LISTING_GROUPS = {
    "see": "Sight", "do": "Activity", "view": "Nature",
    "eat": "Food", "buy": "Shopping", "sleep": "Stay", "vicinity": "Nature",
}
LISTING_DETAILS = {
    "listing-address": ("address", 240),
    "listing-hours": ("openingHours", 400),
    "listing-price": ("publishedPrice", 280),
    "listing-phone": ("phone", 100),
}
REGION_SECTIONS = {"Cities": 0, "Towns": 0, "Other_destinations": 1, "Regions": 2}
MARKER_FILE = re.compile(r'(?:\[\[File:|resource="\./File:)([^"|\]]{1,235}\.(?:jpe?g|png|webp))', re.I)
GUIDE_SECTIONS = {
    "": "Overview", "Understand": "Culture and local context", "Get_in": "Getting there",
    "Get_around": "Getting around", "See": "Sightseeing", "Do": "Things to do",
    "Eat": "Food", "Sleep": "Where to stay", "Stay_safe": "Safety and practical advice",
    "Respect": "Respect and local customs", "Talk": "Language", "Stay_healthy": "Staying healthy",
    "Climate": "Climate", "Buy": "Shopping", "Go_next": "Nearby trips",
}
LIST_SUMMARIES = {"See", "Do", "Eat", "Buy", "Sleep", "Go_next", "Stay_safe", "Stay_healthy", "Respect", "Get_around"}
SECTION_GROUPS = {"See": "see", "Do": "do", "Eat": "eat", "Buy": "buy", "Sleep": "sleep"}
MAX_DOCUMENT_BYTES = 2_500_000
_pages = {}
HOST = "en.wikivoyage.org"


class ListingsParser(HTMLParser):
    def __init__(self, title):
        super().__init__()
        self.title = title.casefold()
        self.listings = []
        self.districts = []
        self.listing = None
        self.depth = 0
        self.name_depth = 0
        self.content_depth = 0
        self.content_tag = None
        self.detail = None
        self.detail_depth = 0
        self.section = ""
        self.region_links = {}
        self.guide = {}
        self.paragraph = None
        self.paragraph_tag = None
        self.paragraph_depth = 0
        self.legacy_heading = False
        self.parent_section = ""
        self.hidden_text = False
        self.hidden_spans = 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        classes = attrs.get("class", "").split()
        if tag == "h2":
            self.section = attrs.get("id", "")
            self.parent_section = self.section
            self.legacy_heading = not self.section
        if tag == "h3":
            self.section = "Climate" if attrs.get("id") == "Climate" else self.parent_section
            self.legacy_heading = not attrs.get("id")
        if self.legacy_heading and tag == "span" and "mw-headline" in classes:
            heading = attrs.get("id", "")
            if self.legacy_heading == "h3":
                self.section = "Climate" if heading == "Climate" else self.parent_section
            else:
                self.section = self.parent_section = heading
        if tag in {"h2", "h3"} and self.legacy_heading:
            self.legacy_heading = tag
        if self.paragraph is None and (tag == "p" or (tag == "li" and self.section in LIST_SUMMARIES)) and self.section in GUIDE_SECTIONS:
            self.paragraph = []
            self.paragraph_tag = tag
            self.paragraph_depth = 1
        elif tag == self.paragraph_tag:
            self.paragraph_depth += 1
        if tag in {"script", "style", "sup"}:
            self.hidden_text = True
        if tag == "span" and (self.hidden_spans or "listing-coordinates" in classes):
            self.hidden_spans += 1
        if tag == "a":
            href = attrs.get("href") or ""
            article_path = href.removeprefix("./") if href.startswith("./") else href.removeprefix("/wiki/")
            if article_path != href and "?" not in article_path and "#" not in article_path:
                district = unquote(article_path)
                if (district.casefold().startswith(self.title + "/")
                        and district.count("/") == 1 and district not in self.districts):
                    self.districts.append(district)
                if (self.section in REGION_SECTIONS
                        and (attrs.get("rel") == "mw:WikiLink" or href.startswith("/wiki/"))
                        and ":" not in district
                        and 1 < len(district) <= 90):
                    priority = REGION_SECTIONS[self.section]
                    self.region_links[district] = min(self.region_links.get(district, priority), priority)
        if self.listing is None and "vcard" in classes and tag in {"bdi", "span", "div"}:
            self.depth = 1
            self.listing = {"name_parts": [], "content_parts": [], "root": tag}
        elif self.listing is not None and tag == self.listing["root"]:
            self.depth += 1
        if self.listing is None:
            return
        if tag == "span" and "listing-name" in classes:
            self.name_depth = 1
            self.listing["anchor"] = attrs.get("id", "")
        elif tag == "span" and self.name_depth:
            self.name_depth += 1
        if "listing-content" in classes:
            self.content_tag = tag
            self.content_depth = 1
        elif self.content_depth and tag == self.content_tag:
            self.content_depth += 1
        if tag == "span":
            detail = next((LISTING_DETAILS[value] for value in classes if value in LISTING_DETAILS), None)
            if self.detail:
                self.detail_depth += 1
            elif detail:
                self.detail, _ = detail
                self.listing[self.detail] = []
                self.detail_depth = 1
        if tag == "a" and self.name_depth:
            target = attrs.get("href") or ""
            try:
                url = urlsplit(target)
                if url.scheme in {"https", "http"} and url.hostname and not url.username and not url.password:
                    self.listing["website"] = target
            except ValueError:
                pass
        if tag == "a":
            target = attrs.get("href") or ""
            for prefix in ("./w:", "https://en.wikipedia.org/wiki/", "//en.wikipedia.org/wiki/"):
                if target.startswith(prefix):
                    article = unquote(target[len(prefix):]).replace("_", " ").strip()
                    if article and not any(character in article for character in ":|/#?"):
                        self.listing["articleTitle"] = article
                    break
            for prefix in ("./commons:File:", "https://commons.wikimedia.org/wiki/File:"):
                if target.startswith(prefix):
                    filename = unquote(target[len(prefix):])
                    if 0 < len(filename) <= 245 and not any(char in filename for char in "|#?"):
                        self.listing["commonsFile"] = "File:" + filename
                    break
        if tag == "a" and attrs.get("data-mw-kartographer") == "maplink":
            try:
                self.listing.update(lat=float(attrs["data-lat"]), lon=float(attrs["data-lon"]))
                if group := SECTION_GROUPS.get(self.section):
                    self.listing["group"] = group
                maplink = json.loads(attrs.get("data-mw", "{}"))
                if group := maplink.get("attrs", {}).get("group"):
                    self.listing["group"] = group
                geometry = json.loads(maplink.get("body", {}).get("extsrc") or "{}")
                description = geometry.get("properties", {}).get("description") or ""
                if image := MARKER_FILE.search(description):
                    self.listing["commonsFile"] = "File:" + unquote(image[1])
            except (KeyError, ValueError, TypeError, AttributeError):
                return

    def handle_endtag(self, tag):
        if tag in {"h2", "h3"}:
            self.legacy_heading = False
        if tag in {"script", "style", "sup"}:
            self.hidden_text = False
        if tag == "span" and self.hidden_spans:
            self.hidden_spans -= 1
        if tag == self.paragraph_tag:
            self.paragraph_depth -= 1
        if tag == self.paragraph_tag and self.paragraph_depth == 0:
            text = " ".join("".join(self.paragraph).split())
            minimum = 28 if self.section in LIST_SUMMARIES or self.section == "Climate" else 55
            if len(text) >= minimum and not text.startswith(("For other places", "This article")):
                section = self.guide.setdefault(self.section, [])
                if len(section) < 24:
                    section.append(text[:800])
            self.paragraph = None
            self.paragraph_tag = None
        if tag == "span" and self.name_depth:
            self.name_depth -= 1
        if tag == self.content_tag and self.content_depth:
            self.content_depth -= 1
            if not self.content_depth:
                self.content_tag = None
        if tag == "span" and self.detail_depth:
            self.detail_depth -= 1
            if not self.detail_depth:
                self.detail = None
        if self.listing is not None and tag == self.listing["root"]:
            self.depth -= 1
            if self.depth == 0:
                self.listings.append(self.listing)
                self.listing = None
                self.name_depth = 0
                self.content_depth = 0
                self.content_tag = None
                self.detail = None
                self.detail_depth = 0

    def handle_data(self, data):
        if self.paragraph is not None and not self.hidden_text and not self.hidden_spans:
            self.paragraph.append(data)
        if self.name_depth:
            self.listing["name_parts"].append(data)
        if self.content_depth:
            self.listing["content_parts"].append(data)
        if self.detail:
            self.listing[self.detail].append(data)


async def wikivoyage_page(client, title):
    places, links, _ = await wikivoyage_document(client, title)
    return places, links


async def wikivoyage_document(client, title):
    cached = _pages.get(title)
    if cached and monotonic() - cached[0] < 3600:
        return cached[1]
    async with read_gate(HOST):
        cached = _pages.get(title)
        if cached and monotonic() - cached[0] < 3600:
            return cached[1]
        try:
            require_available(HOST)
            results = await fetch_wikivoyage_page(client, title)
        except (TimeoutError, httpx.HTTPError, ValueError):
            if cached and monotonic() - cached[0] < 86400:
                return cached[1]
            raise
        if len(_pages) >= 128:
            _pages.pop(next(iter(_pages)))
        _pages[title] = (monotonic(), results)
        return results


async def read_body(response):
    body = bytearray()
    async for chunk in response.aiter_bytes(chunk_size=32_768):
        if len(body) + len(chunk) > MAX_DOCUMENT_BYTES:
            raise ValueError("Wikivoyage page exceeds the extraction limit")
        body.extend(chunk)
    return body.decode("utf-8", errors="replace")


async def fetch_rest_html(client, title):
    request_title = quote(title, safe="")
    async with client.stream("GET", f"https://en.wikivoyage.org/w/rest.php/v1/page/{request_title}/html",
                             follow_redirects=True) as response:
        note_response(HOST, response)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        article = unquote(response.url.path.removeprefix("/w/rest.php/v1/page/").removesuffix("/html"))
        if response.url.host != "en.wikivoyage.org" or not article or "text/html" not in response.headers.get("content-type", ""):
            raise ValueError("Wikivoyage REST did not return article HTML")
        return article, await read_body(response)


async def fetch_action_html(client, title):
    params = {
        "action": "parse", "page": title, "prop": "text", "redirects": 1,
        "disableeditsection": 1, "disablelimitreport": 1, "maxlag": 5, "format": "json", "formatversion": 2,
    }
    async with client.stream("GET", "https://en.wikivoyage.org/w/api.php", params=params,
                             follow_redirects=False) as response:
        note_response(HOST, response)
        response.raise_for_status()
        payload = json.loads(await read_body(response))
    if payload.get("error", {}).get("code") in {"maxlag", "ratelimited"}:
        note_response(HOST, httpx.Response(429, headers=response.headers))
        raise WikimediaUnavailable("Wikivoyage temporarily limited this lookup.")
    if payload.get("error", {}).get("code") == "missingtitle":
        return None
    result = payload.get("parse", {})
    article, body = result.get("title"), result.get("text")
    if not isinstance(article, str) or not isinstance(body, str):
        raise ValueError("Wikivoyage action API did not return article HTML")
    return article.replace(" ", "_"), body


async def fetch_wikivoyage_page(client, title):
    try:
        async with asyncio.timeout(3):
            page = await fetch_rest_html(client, title)
            if page is None:
                return [], [], []
            parsed = parse_wikivoyage_html(*page)
            if any(parsed):
                return parsed
    except httpx.HTTPStatusError as error:
        if error.response.status_code in {403, 429} or error.response.headers.get("Retry-After"):
            raise
    except (TimeoutError, httpx.HTTPError, TypeError, ValueError):
        pass
    async with asyncio.timeout(3):
        page = await fetch_action_html(client, title)
        return parse_wikivoyage_html(*page) if page else ([], [], [])


def parse_wikivoyage_html(article, html):
    parser = ListingsParser(article)
    parser.feed(html)
    results = []
    for item in parser.listings:
        category = LISTING_GROUPS.get(item.get("group"))
        name = " ".join("".join(item["name_parts"]).split())
        lat, lon, anchor = item.get("lat"), item.get("lon"), item.get("anchor")
        if (name and category and anchor and lat is not None and lon is not None
                and isfinite(lat) and isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            details = {field: text for field, length in LISTING_DETAILS.values()
                       if (text := " ".join("".join(item.get(field, [])).split())[:length])}
            results.append({
                "name": name, "category": category, "lat": lat, "lon": lon, "source": "Wikivoyage",
                "url": f"https://en.wikivoyage.org/wiki/{quote(article, safe='/')}#{quote(anchor, safe='')}",
                "address": article.replace("_", " ").replace("/", " · "),
                "description": " ".join("".join(item["content_parts"]).split())[:700] or None,
                **details,
                **{key: item[key] for key in ("website", "articleTitle", "commonsFile") if key in item},
            })
    region_links = sorted(parser.region_links, key=parser.region_links.get)
    article_url = f"https://en.wikivoyage.org/wiki/{quote(article, safe='/')}"
    sections = [{"title": heading, "text": "\n\n".join(parser.guide[section]), "source": "Wikivoyage",
                 "sourceUrl": f"{article_url}#{quote(section)}" if section else article_url}
                for section, heading in GUIDE_SECTIONS.items() if section in parser.guide]
    return results, list(dict.fromkeys([*parser.districts, *region_links])), sections


async def travel_listings(client, city, *, include_districts=False, category=None):
    city_places, districts = await wikivoyage_page(client, city["name"].replace(" ", "_"))
    places = list(city_places)
    enough = sum(item["category"] == category for item in places) >= 8 if category else False
    if include_districts and not enough:
        if city.get("kind") != "region":
            prefix = city["name"].replace(" ", "_").casefold() + "/"
            districts = [title for title in districts if title.casefold().startswith(prefix)]
        selected = districts[:8] if city.get("kind") == "region" else districts[:3]
        district_results = await asyncio.gather(*(wikivoyage_page(client, title) for title in selected),
                                                 return_exceptions=True)
        for result in district_results:
            if not isinstance(result, BaseException):
                places.extend(result[0])
        if not places and districts and all(isinstance(result, Exception) for result in district_results):
            raise district_results[0]
    return places
