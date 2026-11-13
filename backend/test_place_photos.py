import unittest

import httpx

from backend.nearby import nearby_results
from backend.place_photos import attach_named_commons_photo, attach_place_photos, parse_photo


MEDIA = {
    "mime": "image/jpeg",
    "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Castle.jpg/500px-Castle.jpg?tracking=1",
    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Castle.jpg",
    "extmetadata": {
        "Artist": {"value": "<a>Alice &amp; Bob</a>"},
        "LicenseShortName": {"value": "CC BY-SA 4.0"},
        "LicenseUrl": {"value": "http://creativecommons.org/licenses/by-sa/4.0/"},
    },
}


class PlacePhotoTest(unittest.IsolatedAsyncioTestCase):
    async def test_named_cafe_photo_requires_a_matching_branch_and_license(self):
        place = {"name": "Harbor Cafe", "category": "Food", "lat": 17.4332, "lon": 78.381,
                 "url": "https://www.openstreetmap.org/node/123456"}

        async def response(request):
            self.assertEqual(request.url.params["gsrsearch"], 'intitle:"Harbor Cafe" Hyderabad')
            return httpx.Response(200, json={"query": {"pages": [
                {"title": "File:Harbor Cafe different branch.jpg", "coordinates": [{"lat": 17.5, "lon": 78.381}],
                 "imageinfo": [MEDIA]},
                {"title": "File:View from Harbor Cafe.jpg", "coordinates": [{"lat": 17.4332, "lon": 78.381}],
                 "imageinfo": [MEDIA]},
                {"title": "File:Harbor Cafe unlicensed.jpg", "coordinates": [{"lat": 17.4332, "lon": 78.381}],
                 "imageinfo": [{**MEDIA, "extmetadata": {}}]},
                {"title": "File:Harbor Cafe Hyderabad.jpg", "coordinates": [{"lat": 17.4334, "lon": 78.381}],
                 "imageinfo": [{**MEDIA, "descriptionurl": "https://commons.wikimedia.org/wiki/File:Harbor_Cafe_Hyderabad.jpg"}]},
            ]}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            await attach_named_commons_photo(client, place, "Hyderabad")
        self.assertEqual(place["photo"]["sourceUrl"], "https://commons.wikimedia.org/wiki/File:Harbor_Cafe_Hyderabad.jpg")

    async def test_photo_batch_includes_stays_after_many_sights(self):
        def place(number, category):
            return {"name": f"Test place {number}", "category": category,
                    "source": "Wikipedia", "url": f"https://en.wikipedia.org/wiki/Test_place_{number}"}

        sights = [place(i, "Sight") for i in range(32)]
        stay = place(34, "Stay")

        async def response(request):
            if request.url.host == "en.wikipedia.org":
                self.assertIn("Test place 34", request.url.params["titles"].split("|"))
                return httpx.Response(200, json={"query": {"pages": [
                    {"title": "Test place 34", "pageimage": "Castle.jpg"},
                ]}})
            return httpx.Response(200, json={"query": {"pages": [
                {"title": "File:Castle.jpg", "imageinfo": [MEDIA]},
            ]}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            await attach_place_photos(client, [*sights, stay])
        self.assertEqual(stay["photo"]["license"], "CC BY-SA 4.0")

    def test_nearby_retains_outdoor_candidates_when_sights_dominate(self):
        city = {"lat": 17.3, "lon": 78.4}
        def place(number, category, lat):
            return {"name": f"Discovery place {number}", "category": category, "lat": lat, "lon": 78.4,
                    "source": "Wikivoyage", "description": "Guide listing",
                    "url": f"https://en.wikivoyage.org/wiki/City#Place_{number}"}

        sights = [place(i, "Sight", 17.301) for i in range(24)]
        garden = {**place(30, "Activity", 17.35), "name": "A national park"}
        results = nearby_results(city, [[*sights, garden]])
        self.assertEqual(len(results), 24)
        self.assertEqual(next(item["category"] for item in results if item["url"] == garden["url"]), "Nature")

    async def test_adds_matching_photo_and_checks_coordinates_for_listings(self):
        async def response(request):
            if request.url.host == "en.wikipedia.org":
                self.assertEqual(request.url.params["pilicense"], "free")
                return httpx.Response(200, json={"query": {"pages": [
                    {"title": "Castle", "pageimage": "Castle.jpg"},
                    {"title": "Castle Hotel", "pageimage": "Castle.jpg", "coordinates": [{"lat": 50.0, "lon": 2.0}]},
                ]}})
            return httpx.Response(200, json={"query": {"pages": [
                {"title": "File:Castle.jpg", "imageinfo": [MEDIA]},
            ]}})

        castle = {"name": "Castle", "source": "Wikipedia", "url": "https://en.wikipedia.org/wiki/Castle"}
        hotel = {"name": "Castle Hotel", "source": "Wikivoyage", "lat": 45.0, "lon": 2.0,
                 "url": "https://en.wikivoyage.org/wiki/City#Castle_Hotel"}
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            await attach_place_photos(client, [castle, hotel])
        self.assertEqual(castle["photo"]["credit"], "Alice & Bob")
        self.assertEqual(castle["photo"]["licenseUrl"], "https://creativecommons.org/licenses/by-sa/4.0/")
        self.assertNotIn("?", castle["photo"]["url"])
        self.assertNotIn("photo", hotel)

    def test_omits_unlicensed_or_untrusted_image(self):
        self.assertIsNone(parse_photo({"imageinfo": [{**MEDIA, "extmetadata": {}}]}))
        self.assertIsNone(parse_photo({"imageinfo": [{**MEDIA, "thumburl": "https://example.com/Castle.jpg"}]}))
