from unittest import IsolatedAsyncioTestCase

import httpx

from .place_media import nearby_media
from .wikivoyage import fetch_wikivoyage_page


class PublicMediaTest(IsolatedAsyncioTestCase):
    async def test_combined_gallery_plays_named_ogg_clip_as_webm(self):
        filename = "File:Charminar Surrounding video.ogv"
        source = "https://commons.wikimedia.org/wiki/File:Charminar_Surrounding_video.ogv"
        video = "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/Charminar.ogv/480p.webm"

        async def respond(request):
            params = request.url.params
            pages = []
            if params.get("prop") == "videoinfo":
                pages = [{"title": filename, "videoinfo": [{"derivatives": [
                    {"src": video, "type": "video/webm; codecs=vp9", "height": 480},
                ]}]}]
            elif "intitle:" in params.get("gsrsearch", ""):
                pages = [{"title": filename, "imageinfo": [{
                    "url": "https://upload.wikimedia.org/wikipedia/commons/a/a1/Charminar.ogv",
                    "descriptionurl": source, "mime": "application/ogg", "extmetadata": {
                        "LicenseShortName": {"value": "CC BY-SA 3.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/3.0"},
                        "Artist": {"value": "Local photographer"},
                    },
                }]}]
            return httpx.Response(200, json={"query": {"pages": pages}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            result = await nearby_media(client, 17.3615, 78.4747, "Charminar", kind="all")
        self.assertEqual(result["status"], "live")
        item = result["items"][0]
        self.assertEqual((item["type"], item["mime"], item["url"]), ("video", "video/webm", video))
        self.assertEqual(item["sourceUrl"], source)
        self.assertTrue(item["nameMatchOnly"])

    async def test_wikivoyage_extracts_legacy_markup_when_rest_fails(self):
        html = """
            <h2 id="Cities">Cities</h2><a href="/wiki/Old_City">Old City</a>
            <h2 id="See">See</h2><bdi class="vcard">
            <a data-mw-kartographer="maplink" data-lat="17.36" data-lon="78.47">1</a>
            <span id="Charminar" class="listing-name">Charminar</span>
            <bdi class="listing-content">Historic monument.</bdi>
            <a href="https://en.wikipedia.org/wiki/Charminar">Wikipedia</a>
            </bdi>
            <h2 id="Respect">Respect</h2>
            <p>Visitors should consult the venue for any local rules and photography policies.</p>
        """
        def respond(request):
            if request.url.path != "/w/api.php":
                return httpx.Response(502)
            self.assertEqual(request.url.params.get("action"), "parse")
            return httpx.Response(200, json={"parse": {"title": "Example Region", "text": html}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            places, districts, guide = await fetch_wikivoyage_page(client, "Example Region")
        self.assertEqual(districts, ["Old_City"])
        self.assertEqual((places[0]["name"], places[0]["articleTitle"]), ("Charminar", "Charminar"))
        self.assertTrue(places[0]["url"].endswith("#Charminar"))
        self.assertEqual(guide[0]["title"], "Respect and local customs")
