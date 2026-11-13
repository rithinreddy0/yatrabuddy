import unittest
from unittest.mock import AsyncMock, patch

from . import destination_images as images
from .source_cache import SourceCache


class DestinationImagesTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.old_cache = images.cache
        images.cache = SourceCache()

    async def asyncTearDown(self):
        images.cache = self.old_cache

    async def test_preserves_credit_and_marks_cache(self):
        photo = {"url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Goa.jpg",
                 "license": "CC BY-SA 4.0", "credit": "Photographer"}
        article = {"name": "Goa", "lat": 15.5, "lon": 73.8,
                   "url": "https://en.wikipedia.org/wiki/Goa", "photo": photo}
        with patch.object(images, "exact_article", AsyncMock(return_value=[article])) as fetch, \
                patch.object(images, "attach_place_photos", AsyncMock()), \
                patch.object(images, "nearby_media", AsyncMock(return_value={"items": []})):
            result = await images.destination_images("Goa")
            cached = await images.destination_images("goa")
        self.assertEqual(result["status"], "live")
        self.assertEqual(cached["status"], "cached")
        self.assertEqual(cached["places"][0]["photo"], photo)
        self.assertEqual(cached["retrievedAt"], result["retrievedAt"])
        fetch.assert_awaited_once()

    async def test_no_unlicensed_image_substitution(self):
        with patch.object(images, "exact_article", AsyncMock(return_value=[])), \
                patch.object(images, "attach_place_photos", AsyncMock()), \
                patch.object(images, "lookup_places", AsyncMock(return_value={"places": []})):
            result = await images.destination_images("Unknown")
        self.assertEqual(result["places"], [])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("licensed", result["error"])

    async def test_exact_place_fallback_uses_only_licensed_matching_photos(self):
        exact = {"name": "Charminar", "lat": 17.3616, "lon": 78.4747,
                 "url": "https://en.wikipedia.org/wiki/Charminar"}
        unrelated = {**exact, "name": "Golconda Fort", "photo": {"url": "https://example.org/other.jpg"}}
        photo = {"title": "Charminar from the north", "credit": "Photographer", "license": "CC BY-SA 4.0",
                 "url": "https://upload.wikimedia.org/wikipedia/commons/1/11/Charminar.jpg",
                 "sourceUrl": "https://commons.wikimedia.org/wiki/File:Charminar.jpg", "nearby": False}
        other_photo = {**photo, "title": "Street café", "sourceUrl": "https://commons.wikimedia.org/wiki/File:Cafe.jpg"}
        with patch.object(images, "exact_article", AsyncMock(return_value=[])), \
                patch.object(images, "attach_place_photos", AsyncMock()), \
                patch.object(images, "lookup_places", AsyncMock(return_value={"places": [unrelated, exact]})), \
                patch.object(images, "nearby_media", AsyncMock(return_value={"items": [other_photo, photo, photo]})):
            result = await images.destination_images("Charminar")
        self.assertEqual([item["photo"] for item in result["places"]], [photo])
