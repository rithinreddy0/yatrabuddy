"""Licensed Commons thumbnails for place results matched to Wikipedia articles."""

import asyncio
import re
from time import monotonic
from unicodedata import normalize
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx

from .agents import clean
from .nearby import distance_metres
from .wikimedia import note_response, read_gate, require_available, WikimediaUnavailable


WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IMAGE_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}
RASTER_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/webm", "video/ogg", "video/mp4"}
COMMONS_METADATA = "Artist|LicenseShortName|LicenseUrl|Attribution|Restrictions"
PHOTO_LIMIT = 40
PHOTO_CATEGORIES = ("Sight", "Nature", "Food", "Stay", "Activity", "Shopping")
_photo_cache = {}


def cached_place_photo(url):
    cached = _photo_cache.get(url)
    return cached[1].get("photo") if cached and monotonic() - cached[0] < 86400 else None


def matching_title(place):
    try:
        source = urlsplit(place["url"])
    except ValueError:
        return None
    if source.scheme != "https":
        return None
    if source.netloc == "en.wikipedia.org" and source.path.startswith("/wiki/"):
        return unquote(source.path.removeprefix("/wiki/")).replace("_", " ")
    if source.netloc in {"en.wikivoyage.org", "www.openstreetmap.org"}:
        return place.get("articleTitle") or place["name"]
    return None


def title_key(value):
    return normalize("NFC", value).replace("_", " ").strip().casefold()


def validated_url(value, hosts, prefix):
    if not isinstance(value, str):
        return None
    try:
        target = urlsplit(value)
    except ValueError:
        return None
    if target.scheme == "https" and target.netloc in hosts and target.path.startswith(prefix):
        return urlunsplit(("https", target.netloc, target.path, "", ""))
    return None


async def wiki_pages(client, endpoint, titles, **params):
    title_list = "|".join(titles)
    host = urlsplit(endpoint).netloc
    async with read_gate(host):
        require_available(host)
        response = await client.get(endpoint, follow_redirects=False, params={
            "action": "query", "format": "json", "formatversion": 2,
            **({"titles": title_list, "redirects": 1} if title_list else {}), "maxlag": 5, **params,
        })
        note_response(host, response)
        response.raise_for_status()
        payload = response.json()
        if "error" in payload:
            if payload["error"].get("code") in {"ratelimited", "maxlag"}:
                note_response(host, httpx.Response(429, headers=response.headers))
                raise WikimediaUnavailable("Wikimedia temporarily limited this lookup.")
            raise ValueError("Wikimedia media query failed")
    return payload.get("query", {})


async def commons_files(client, titles):
    return await wiki_pages(client, COMMONS_API, titles, prop="imageinfo", iiurlwidth=480,
                            iiprop="url|mime|size|extmetadata", iiextmetadatafilter=COMMONS_METADATA)


def indexed_pages(query):
    entries = {title_key(page["title"]): page for page in query.get("pages", [])}
    aliases = {
        title_key(item["from"]): title_key(item["to"])
        for field in ("normalized", "redirects") for item in query.get(field, [])
    }
    for alias in aliases:
        title = aliases[alias]
        for _ in range(4):
            if title in entries:
                entries[alias] = entries[title]
                break
            if title not in aliases:
                break
            title = aliases[title]
    return entries


def matched_page(place, page):
    if not page or page.get("missing"):
        return False
    if place["source"] in {"Wikivoyage", "OpenStreetMap"}:
        if place.get("articleTitle") and title_key(page["title"]) == title_key(place["articleTitle"]):
            return True
        # A listing name alone can point to a different business with the same name.
        coordinates = (page.get("coordinates") or [{}])[0]
        if not all(isinstance(coordinates.get(axis), (float, int)) for axis in ("lat", "lon")):
            return False
        if distance_metres(place, coordinates) > 500:
            return False
    return True


def nearby_title_match(place, page):
    if not matched_page(place, page):
        return False
    words = set(re.findall(r"[^\W_]+", title_key(place["name"])))
    title_words = set(re.findall(r"[^\W_]+", title_key(page["title"].split(",", 1)[0])))
    shared = words & title_words
    return len(shared - {"of", "the", "and", "a"}) >= 2 and (
        title_words <= words or words <= title_words
    )


def place_file_match(place, page):
    """Require the place name as a title phrase, excluding nearby viewpoints."""
    place_words = re.findall(r"[^\W\d_]+", title_key(place["name"]))
    title = re.sub(r"\.[a-zA-Z0-9]{2,5}$", "", page["title"].removeprefix("File:"))
    words = re.findall(r"[^\W\d_]+", title_key(title))
    return len(place_words) >= 2 and any(
        words[index:index + len(place_words)] == place_words
        and (index == 0 or words[index - 1] not in {"near", "nearby", "from", "opposite", "behind"})
        for index in range(len(words))
    )


def matching_file_location(place, page):
    """Check that a named Commons file belongs to this branch or point of interest."""
    location = (page.get("coordinates") or [{}])[0]
    if not all(isinstance(location.get(axis), (int, float)) for axis in ("lat", "lon")):
        return False
    radius = 180 if place["category"] in {"Food", "Stay"} else 500
    return distance_metres(place, location) <= radius


def distribute_candidates(places):
    """Reserve the first lookups for a mix of places, including food and stays."""
    priority = [place for place in places if place.get("commonsFile") or place.get("articleTitle")]
    for category in PHOTO_CATEGORIES:
        priority.extend([place for place in places if place.get("category") == category][:4])
    return {place["url"]: place for place in [*priority, *places]}.values()


def parse_photo(page):
    media = (page.get("imageinfo") or [{}])[0]
    if media.get("mime") not in RASTER_TYPES:
        return None
    size = media.get("size")
    original = validated_url(media.get("url"), IMAGE_HOSTS, "/wikipedia/commons/")
    original = original if isinstance(size, int) and size <= 8_000_000 else None
    photo = licensed_media(media, media.get("thumburl") or original)
    if photo and original and original != photo["url"]:
        photo["originalUrl"] = original
    return photo


def licensed_media(media, media_url):
    url = validated_url(media_url, IMAGE_HOSTS, "/wikipedia/commons/")
    source = validated_url(media.get("descriptionurl"), {"commons.wikimedia.org"}, "/wiki/File:")
    if not url or not source:
        return None

    metadata = media.get("extmetadata", {})
    if metadata.get("Restrictions", {}).get("value"):
        return None
    license_name = clean(metadata.get("LicenseShortName", {}).get("value", ""), 70)
    credit = clean(metadata.get("Attribution", {}).get("value") or metadata.get("Artist", {}).get("value", ""), 500) or None
    raw_license = str(metadata.get("LicenseUrl", {}).get("value") or "").replace("http://", "https://", 1)
    if license_name == "Public domain":
        license_url = None
    elif license_name == "CC0":
        license_url = validated_url(raw_license, {"creativecommons.org"}, "/publicdomain/zero/")
        if not license_url:
            return None
    elif re.fullmatch(r"CC BY(?:-SA)? [1-4]\.\d(?: [A-Z]{2})?", license_name):
        license_url = validated_url(raw_license, {"creativecommons.org"}, "/licenses/by")
        if not license_url or not credit:
            return None
    else:
        return None
    return {"url": url, "sourceUrl": source, "credit": credit, "license": license_name, "licenseUrl": license_url}


async def attach_place_photos(client, places, city=None):
    """Decorate the first page in bounded batches. Photos never gate discovery."""
    candidates = []
    for place in distribute_candidates(places):
        title = matching_title(place)
        if not title or len(title) > 250 or "|" in title:
            continue
        cached = _photo_cache.get(place["url"])
        max_age = 3600 if cached and cached[1].get("photo") else 120
        if cached and monotonic() - cached[0] < max_age:
            place.update(cached[1])
        else:
            candidates.append((title, place))
        if len(candidates) >= PHOTO_LIMIT:
            break
    if candidates:
        await attach_listing_photos(client, [place for _, place in candidates if place.get("commonsFile")])
        await load_photo_batch(client, candidates, city)
    landmarks = [place for _, place in candidates if not place.get("photo") and place["source"] in {"Wikivoyage", "OpenStreetMap"}
                 and place.get("category") in {"Sight", "Nature", "Activity"}]
    if city and landmarks:
        await attach_nearby_articles(client, landmarks)
    if city:
        photos_by_category = {place.get("category") for place in places if place.get("photo")}
        remaining = [place for _, place in candidates if not place.get("photo")
                     and place.get("category") in PHOTO_CATEGORIES
                     and all(isinstance(place.get(axis), (int, float)) for axis in ("lat", "lon"))
                     and len(re.findall(r"[^\W\d_]+", place["name"])) >= 2]
        # Limit extra requests and give first priority to categories with no illustrated result.
        selected = {}
        for category in ("Nature", "Food", "Stay", "Sight", "Activity", "Shopping"):
            if category in photos_by_category:
                continue
            options = [place for place in remaining if place["category"] == category]
            if options:
                best = next((place for place in options if place.get("description") and place["source"] == "Wikivoyage"), options[0])
                selected[best["url"]] = best
        for place in remaining:
            selected.setdefault(place["url"], place)
        await asyncio.gather(*(attach_named_commons_photo(client, place, city) for place in list(selected.values())[:3]))


async def attach_listing_photos(client, places):
    if not places:
        return
    try:
        async with asyncio.timeout(2):
            pages = indexed_pages(await commons_files(client, dict.fromkeys(place["commonsFile"] for place in places)))
    except (httpx.HTTPError, TimeoutError, KeyError, TypeError, ValueError):
        return
    for place in places:
        page = pages.get(title_key(place["commonsFile"]))
        if page and (photo := parse_photo(page)):
            place["photo"] = photo
            _cache_enrichment(place["url"], {"photo": photo})


async def attach_named_commons_photo(client, place, city):
    name = " ".join(re.findall(r"[^\W_]+", place["name"]))[:120]
    area = " ".join(re.findall(r"[^\W_]+", city))[:80]
    if not name or not area:
        return
    venue = place["category"] in {"Food", "Stay"}
    params = (
        {"generator": "search", "gsrnamespace": 6, "gsrsearch": f'intitle:"{name}" {area}', "gsrlimit": 6}
        if venue else
        {"generator": "geosearch", "ggsnamespace": 6, "ggsprimary": "all", "ggslimit": 12,
         "ggscoord": f"{place['lat']}|{place['lon']}", "ggsradius": 400}
    )
    try:
        async with asyncio.timeout(2):
            data = await wiki_pages(
                client, COMMONS_API, (), **params,
                prop="coordinates|imageinfo", coprimary="all", iiurlwidth=480, iiprop="url|mime|size|extmetadata",
                iiextmetadatafilter=COMMONS_METADATA,
            )
    except (httpx.HTTPError, TimeoutError, KeyError, TypeError, ValueError):
        return
    photo = next((photo for item in data.get("pages", []) if place_file_match(place, item)
                  and (not venue or matching_file_location(place, item))
                  and (photo := parse_photo(item))), None)
    if photo:
        place["photo"] = photo
        _cache_enrichment(place["url"], {"photo": photo})


async def attach_nearby_articles(client, places):
    center = places[0]
    try:
        nearby = await wiki_pages(
            client, WIKIPEDIA_API, (), generator="geosearch", ggsnamespace=0, ggslimit=50,
            ggsradius=7500, ggscoord=f"{center['lat']}|{center['lon']}", prop="coordinates",
            coprimary="primary",
        )
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return
    matches = []
    for place in places:
        pages = [page for page in nearby.get("pages", []) if nearby_title_match(place, page)]
        if len(pages) == 1:
            matches.append((pages[0]["title"], place))
    for index in range(0, min(len(matches), 8), 8):
        await load_photo_batch(client, matches[index:index + 8], None)


async def load_photo_batch(client, candidates, city):
    def titles_for(title, place):
        if city and "|" not in city and place["source"] in {"Wikivoyage", "OpenStreetMap"}:
            variants = [title, f"{title}, {city}", f"{title} ({city})"]
            suffix = re.search(r"\b(?:houses?|museums?|churches?|cathedrals?) of .+", title, re.IGNORECASE)
            if suffix and suffix.start():
                variants.append(f"{suffix[0]}, {city}")
            return variants
        return (title,)

    lookups = [(place, titles_for(title, place)) for title, place in candidates]
    titles = list(dict.fromkeys(title for _, variants in lookups for title in variants[:1]))
    titles.extend(title for title in dict.fromkeys(title for _, variants in lookups for title in variants[1:])
                  if title not in titles)
    try:
        async with asyncio.timeout(9):
            pages = indexed_pages(await wiki_pages(client, WIKIPEDIA_API, titles[:50],
                                                  prop="pageimages|coordinates|extracts", piprop="name", pilicense="free",
                                                  exintro=1, explaintext=1, exchars=650, exlimit=20,
                                                  pilimit=PHOTO_LIMIT, coprimary="primary"))
            matches = []
            for place, variants in lookups:
                articles = [page for title in variants if matched_page(place, page := pages.get(title_key(title)))]
                article = next((page for page in articles if page.get("extract") and len(page["extract"]) > 60), None)
                enrichment = {}
                if article:
                    enrichment["overview"] = clean(article["extract"], 650)
                    enrichment["overviewUrl"] = "https://en.wikipedia.org/wiki/" + quote(article["title"].replace(" ", "_"), safe="")
                    place.update(enrichment)
                file = None if place.get("photo") else next(
                    ("File:" + page["pageimage"] for page in articles if page.get("pageimage")), None)
                matches.append((place, file, enrichment))
            files = dict.fromkeys(file for _, file, _ in matches if file)
            photos = {}
            if files:
                commons = await commons_files(client, files)
                photos = {title: parse_photo(page) for title, page in indexed_pages(commons).items()}
    except (httpx.HTTPError, TimeoutError, KeyError, TypeError, ValueError):
        return

    for place, file, enrichment in matches:
        photo = photos.get(title_key(file)) if file else place.get("photo")
        if photo:
            enrichment["photo"] = photo
        place.update(enrichment)
        _cache_enrichment(place["url"], enrichment)


def _cache_enrichment(url, enrichment):
    previous = _photo_cache.pop(url, (None, {}))[1]
    if len(_photo_cache) >= 512:
        _photo_cache.pop(next(iter(_photo_cache)))
    _photo_cache[url] = (monotonic(), {**previous, **enrichment})
