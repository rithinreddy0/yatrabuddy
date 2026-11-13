import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from .place_search import free_search, google_search


class PlaceSearchTest(unittest.TestCase):
    def test_google_text_search_uses_verified_response_fields_and_hides_key_from_url(self):
        requests = []

        def reply(request):
            requests.append(request)
            return httpx.Response(200, json={
                "places": [
                    {"id": "A", "displayName": {"text": "Hotel One"}, "types": ["hotel"],
                     "location": {"latitude": 35.0, "longitude": 135.0}, "rating": 4.7,
                     "userRatingCount": 190, "googleMapsUri": "https://maps.google.com/?cid=1"},
                    {"id": "B", "displayName": {"text": "Hotel Two"}, "types": ["hotel"],
                     "location": {"latitude": 35.01, "longitude": 135.0}, "rating": 4.9,
                     "userRatingCount": 25, "googleMapsUri": "https://maps.google.com/?cid=2"},
                    {"id": "C", "displayName": {"text": "Closed Hotel"}, "types": ["hotel"],
                     "businessStatus": "CLOSED_PERMANENTLY", "rating": 5.0,
                     "googleMapsUri": "https://maps.google.com/?cid=3"},
                ],
                "nextPageToken": "page-two",
            })

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
                return await google_search(client, "mock-key", "Kyoto", "hotels", {
                    "name": "Kyoto", "country": "Japan", "region": "Kyoto",
                }, {"lat": 35.0, "lon": 135.0}, 4, "rating", None)

        results, next_page = asyncio.run(run())
        self.assertEqual([item["name"] for item in results], ["Hotel Two", "Hotel One"])
        self.assertEqual(results[0]["reviewCount"], 25)
        self.assertIsNone(results[0]["priceRange"])
        self.assertEqual(next_page, "page-two")
        self.assertEqual(requests[0].headers["X-Goog-Api-Key"], "mock-key")
        self.assertNotIn("mock-key", str(requests[0].url))
        self.assertNotIn("places.reviews", requests[0].headers["X-Goog-FieldMask"])

    def test_keyless_city_search_filters_category_and_reports_partial_sources(self):
        city = {"id": 1857910, "name": "Kyoto", "region": "Kyoto", "country": "Japan",
                "lat": 35.0, "lon": 135.0}
        data = {"location": city, "status": "ready", "places": [
            {"name": "Nearby Museum", "category": "Sight", "lat": 35.01, "lon": 135.0,
             "source": "Wikivoyage", "url": "https://en.wikivoyage.org/wiki/Kyoto#Museum"},
            {"name": "Nearby Hotel", "category": "Stay", "lat": 35.02, "lon": 135.0,
             "source": "Wikivoyage", "url": "https://en.wikivoyage.org/wiki/Kyoto#Hotel"},
        ]}
        with (patch("backend.place_search.encyclopedia_search", new=AsyncMock(side_effect=ValueError)),
              patch("backend.place_search.exact_article", new=AsyncMock(return_value=[])),
              patch("backend.place_search.wikivoyage_district_search", new=AsyncMock(return_value=[])),
              patch("backend.place_search.nearby_report", new=AsyncMock(return_value=data))):
            results, status = asyncio.run(free_search(None, "hotels in Kyoto, Japan", "hotels", city, city, None, "distance"))
        self.assertEqual(status, "partial")
        self.assertEqual([item["name"] for item in results], ["Nearby Hotel"])
        self.assertIsNone(results[0]["rating"])
        self.assertTrue(results[0]["url"].endswith("#Hotel"))
