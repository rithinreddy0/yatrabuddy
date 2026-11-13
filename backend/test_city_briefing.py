import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from .city_briefing import advisory_links, city_briefing, summarize
from .wikivoyage import parse_wikivoyage_html


class CityBriefingTests(unittest.TestCase):
    def test_extracts_local_precautions_and_preserves_source(self):
        _, _, sections = parse_wikivoyage_html("Example", """
            <p>Example is a coastal town in India with a harbor and a central market near the station.</p>
            <h2><span class="mw-headline" id="Get_around">Get around</span></h2>
            <p>Bus routes connect the ferry terminal to the old market, with a taxi stand at the station.</p>
            <h2><span class="mw-headline" id="Stay_safe">Stay safe</span></h2>
            <p>This is a generally safe city. There is nothing to worry about on the road.</p>
            <ul><li>Avoid swimming beyond the flagged area where lifeguards patrol.</li></ul>
        """)
        notes = summarize({"sections": sections}, "safety")
        self.assertEqual(notes[0]["kind"], "safety")
        self.assertEqual(notes[0]["text"], "Avoid swimming beyond the flagged area where lifeguards patrol.")
        self.assertTrue(notes[0]["sourceUrl"].endswith("#Stay_safe"))
        self.assertEqual(notes[1]["kind"], "transport")

    def test_advisory_links_distinguish_country_and_matched_region(self):
        payload = {"parts": [{"slug": "regional-risks", "body": (
            '<h2 id="goa">Goa</h2><h2 id="border">Border areas</h2>'
        )}]}
        location = {"name": "Panjim", "region": "Goa", "country": "India"}
        links = advisory_links(payload, "/foreign-travel-advice/india", location)
        self.assertEqual([item["scope"] for item in links], ["region", "country"])
        self.assertTrue(links[0]["sourceUrl"].endswith("/regional-risks#goa"))

    def test_lookup_requires_one_destination_selector(self):
        request = Request({"type": "http", "client": ("test-briefing", 80)})
        with self.assertRaises(HTTPException) as missing:
            city_briefing(request).send(None)
        self.assertEqual(missing.exception.status_code, 422)
        with self.assertRaises(HTTPException) as both:
            city_briefing(request, q="Example", location_id=1).send(None)
        self.assertEqual(both.exception.status_code, 422)

    def test_unavailable_sources_stay_empty(self):
        request = Request({"type": "http", "client": ("test-briefing", 80)})
        location = {"id": 45, "name": "Example", "country": "India"}
        async def resolve(*args):
            return location
        async def gather(*tasks):
            return [await task for task in tasks]
        async def guide(*args):
            return {"status": "unavailable", "sections": []}
        async def advisories(*args):
            return []
        with (patch("backend.city_briefing.resolve_location", resolve),
              patch("backend.city_briefing.read_guide", guide),
              patch("backend.city_briefing.official_advisory", advisories),
              patch("backend.city_briefing.asyncio.gather", gather)):
            with self.assertRaises(StopIteration) as done:
                city_briefing(request, q="Example", topic="food").send(None)
        report = done.exception.value
        self.assertEqual(report["location"], location)
        self.assertEqual(report["status"], "unavailable")
        self.assertEqual(report["sections"], [])
