"""Chat routing regressions with controlled public-source responses."""

import json
import os
import unittest
from datetime import date, timedelta
from unittest.mock import AsyncMock, call, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from .test_api import app
from . import public_answers
from .source_cache import SourceCache
from .trip_intake import ranked_places


CITY = {"id": 1269843, "name": "Hyderabad", "lat": 17.38, "lon": 78.47}
PLACE = {"name": "Charminar", "category": "Sight", "source": "Wikipedia",
         "url": "https://en.wikipedia.org/wiki/Charminar", "lat": 17.36, "lon": 78.47,
         "photo": {"url": "https://upload.wikimedia.org/wikipedia/commons/a/a1/Charminar.jpg",
                   "sourceUrl": "https://commons.wikimedia.org/wiki/File:Charminar.jpg"}}
LOOKUP_RESULT = {"places": [PLACE], "location": CITY, "status": "ready",
                 "freshness": "live", "retrievedAt": "2026-11-13T12:00:00Z"}


class ChatPublicTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.addCleanup(patch.stopall)
        patch("backend.planning_agent.auth.limit").start()
        patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "groq"}).start()
        self.groq = patch("backend.groq_planning.config", return_value=("test", "test")).start()
        self.version = 0
        session = self.client.post("/api/planning-agent/sessions")
        self.assertEqual(session.status_code, 201, session.text)
        self.path = "/api/planning-agent/sessions/" + session.json()["token"] + "/turn"

    def turn(self, text, **kwargs):
        response = self.client.post(self.path, json={"version": self.version, "kind": "message",
                                                    "text": text, "live_only": True, **kwargs})
        self.assertEqual(response.status_code, 200, response.text)
        stream = [json.loads(line) for line in response.iter_lines()]
        self.assertEqual(stream[-1]["type"], "done", stream)
        self.version = stream[-1]["version"]
        return stream[-1], stream[-1]["events"][-1]

    def test_first_place_question_and_contextual_media_and_safety(self):
        with (patch("backend.planning_agent.lookup_places", new=AsyncMock(return_value=LOOKUP_RESULT)) as lookup,
              patch("backend.planning_agent.destination_images", new=AsyncMock(return_value={"places": [PLACE]})) as images,
              patch("backend.planning_agent.video_answer", new=AsyncMock(return_value={"items": []})) as video,
              patch("backend.planning_agent.factual_answer", new=AsyncMock(return_value={"findings": []})) as research,
              patch("backend.planning_agent.weather_for_city", new=AsyncMock(return_value={"location": "Hyderabad"})) as weather):
            _, event = self.turn("What places can I visit in Hyderabad?")
            self.assertEqual(event["tools"][0]["result"]["places"][0]["photo"], PLACE["photo"])
            lookup.assert_awaited_once_with("Hyderabad", "attractions", public_only=True, include_photos=True)
            self.turn("Show me photos there")
            self.turn("What about videos there?")
            self.turn("Show videos of Hyderabad Metro")
            self.turn("What should I watch out for there?")
            self.turn("What's the weather like there?")
            images.assert_awaited_once_with("Hyderabad")
            self.assertEqual(video.await_args_list, [call("Hyderabad", CITY), call("Hyderabad Metro", CITY)])
            research.assert_awaited_once_with("What should I watch out for there?", "Hyderabad", CITY)
            weather.assert_awaited_once_with("Hyderabad")
            self.groq.assert_not_called()

    def test_location_answer_then_date_budget_and_preferences_keep_the_same_trip(self):
        future = (date.today() + timedelta(days=15)).isoformat()
        _, event = self.turn("Plan a 3-day trip with a budget of 12k", offline=True)
        self.assertEqual(event["intakeQuestion"]["field"], "destination")
        for message, values in [
            ("Siliguri, India", {"destination": "Siliguri, India"}),
            (f"Travel on {future}", {"date": future}),
            ("Budget ₹15,000", {"budget": 15000}),
            ("Trip preferences: relaxed pace, museums, no long drives", {"pace": "Relaxed", "interests": ["Culture"]}),
        ]:
            session, _ = self.turn(message, offline=True)
            intake = session["currentItinerary"]["request"]
            self.assertEqual(intake["destination"], "Siliguri, India", message)
            self.assertEqual(intake["days"], 3, message)
            self.assertEqual({key: intake.get(key) for key in values}, values, message)
        self.groq.assert_not_called()

    def test_factual_and_dietary_questions_preserve_request_meaning(self):
        vegan_cafe = {**PLACE, "name": "Cafe Orchid", "category": "Food", "description": "Cafe with vegan meals"}
        other_cafe = {**PLACE, "name": "Other Cafe", "category": "Food", "description": "Coffee and pastries"}
        with (patch("backend.planning_agent.lookup_places",
                    new=AsyncMock(return_value={**LOOKUP_RESULT, "places": [other_cafe, vegan_cafe]})) as lookup,
              patch("backend.planning_agent.factual_answer", new=AsyncMock(return_value={"findings": []})) as research):
            _, event = self.turn("Find vegan cafés in Hyderabad")
            self.assertEqual([item["name"] for item in event["tools"][0]["result"]["places"]], ["Cafe Orchid"])
            self.turn("What is the culture like here?")
            self.turn("What time does Charminar open?")
            self.turn("Tell me about the history of Hyderabad")
            lookup.assert_awaited_once_with("vegan cafés in Hyderabad", "food", public_only=True, include_photos=True)
            self.assertEqual(research.await_args_list, [
                call("What is the culture like here?", "Hyderabad", CITY),
                call("What time does Charminar open?", "Charminar", CITY),
                call("Tell me about the history of Hyderabad", "Hyderabad", CITY),
            ])
            self.groq.assert_not_called()

    def test_budget_question_reports_only_entered_costs(self):
        first = {**PLACE, "photo": None}
        second = {**first, "name": "Golconda Fort", "url": "https://en.wikipedia.org/wiki/Golconda"}
        context = {"id": str(uuid4()), "cityId": CITY["id"], "name": CITY["name"],
                   "days": [[first, second]], "updated": 100, "budget": 15000,
                   "stopCosts": {first["url"]: 200}}
        session, event = self.turn("How much is left in our budget?", live_context=context)
        self.assertIn("₹14,800", event["notice"])
        self.assertIn("1 stop still needs a price", event["notice"])
        self.assertIn("Stays and transport", event["notice"])
        self.assertIsNone(session["currentItinerary"])
        self.groq.assert_not_called()

    def test_region_with_duration_and_members_offers_verified_cities(self):
        region = {"id": 1255053, "name": "Tamil Nadu", "region": "Tamil Nadu", "country": "India",
                  "lat": 11, "lon": 78.33, "kind": "region"}
        chennai = {"id": 1264527, "name": "Chennai", "admin1": "Tamil Nadu", "country": "India",
                   "latitude": 13.08, "longitude": 80.27, "feature_code": "PPLA"}
        verified_city = {**CITY, "id": chennai["id"], "name": "Chennai", "region": "Tamil Nadu",
                         "country": "India", "kind": "city"}
        with (patch("backend.planning_agent.find_destinations", new=AsyncMock(side_effect=[[region], [verified_city]])) as geocode,
              patch("backend.planning_agent.wikivoyage_document", new=AsyncMock(return_value=([], ["Chennai", "Salem_(India)"], []))),
              patch("backend.planning_agent.lookup", new=AsyncMock(return_value={"results": [chennai]})),
              patch("backend.planning_agent.nearby_report", new=AsyncMock(return_value={"places": []})),
              patch("backend.planning_agent.draft_from_sources", new=AsyncMock(return_value=None))):
            session, event = self.turn("Plan a trip to tamil nadu 5 days 3 members with flexible dates from Mumbai and a budget of ₹30000")
            self.assertEqual(event["destinationChoices"][0]["name"], "Chennai")
            self.assertIn("Which city", event["answer"])
            self.assertEqual(event["destinationChoices"][0]["sourceUrl"], f"https://www.geonames.org/{chennai['id']}/")
            self.assertEqual(session["currentItinerary"]["request"]["days"], 5)
            self.assertEqual(session["currentItinerary"]["request"]["people"], 3)
            session, event = self.turn("Chennai, Tamil Nadu")
            intake = session["currentItinerary"]["request"]
            self.assertEqual((intake["destination"], intake["days"], intake["people"]), ("Chennai, Tamil Nadu", 5, 3))
            self.assertEqual([call.args[1] for call in geocode.await_args_list], ["tamil nadu", "Chennai, Tamil Nadu"])
            self.groq.assert_not_called()

    def test_bare_destination_retries_failed_match_with_existing_preferences(self):
        with patch("backend.planning_agent.find_destinations", new=AsyncMock(return_value=[])) as geocode:
            session, event = self.turn("Plan a trip to tmail nadu 5 days 3 members with flexible dates from Mumbai and a budget of ₹30000")
            self.assertTrue(event["awaitingDestination"])
            session, _ = self.turn("Tamil Nadu")
            intake = session["currentItinerary"]["request"]
            self.assertEqual((intake["destination"], intake["days"], intake["people"]), ("Tamil Nadu", 5, 3))
            self.assertEqual([call.args[1] for call in geocode.await_args_list], ["tmail nadu", "Tamil Nadu"])

    def test_region_without_city_links_does_not_route_around_region_centroid(self):
        region = {**CITY, "id": 1255053, "name": "Tamil Nadu", "kind": "region"}
        with (patch("backend.planning_agent.find_destinations", new=AsyncMock(return_value=[region])),
              patch("backend.planning_agent.region_cities", new=AsyncMock(return_value=[])),
              patch("backend.planning_agent.nearby_report", new=AsyncMock()) as nearby):
            session, event = self.turn("Plan a trip to tamil nadu 5 days 3 members with flexible dates from Mumbai and a budget of ₹30000")
            self.assertIn("Which city or town", event["answer"])
            self.assertNotIn("liveDraft", event)
            self.assertTrue(event["awaitingDestination"])
            self.assertEqual(session["currentItinerary"]["request"]["people"], 3)
            nearby.assert_not_awaited()

    def test_trip_intake_asks_before_search_and_carries_other_answers(self):
        with patch("backend.planning_agent.live_itinerary", new=AsyncMock(return_value=(None, [], []))) as live:
            for text, field in [("Plan a trip", "destination"), ("Hyderabad", "date"),
                                ("Flexible dates", "days"), ("3 days", "people"),
                                ("3", "origin"), ("Mumbai", "budget")]:
                _, event = self.turn(text)
                self.assertEqual(event["intakeQuestion"]["field"], field, text)
                live.assert_not_awaited()
            session, _ = self.turn("Budget undecided")
            intake = session["currentItinerary"]["request"]
            self.assertEqual((intake["destination"], intake["origin"], intake["days"], intake["people"]), ("Hyderabad", "Mumbai", 3, 3))
            self.assertTrue(intake["flexibleDates"])
            self.assertTrue(intake["budgetOpen"])
            live.assert_awaited_once()
            self.groq.assert_not_called()

    def test_more_like_these_excludes_previously_shown_places(self):
        second = {**PLACE, "name": "Golconda", "url": "https://en.wikipedia.org/wiki/Golconda"}
        with patch("backend.planning_agent.lookup_places", new=AsyncMock(side_effect=[LOOKUP_RESULT, {**LOOKUP_RESULT, "places": [PLACE, second]}])):
            self.turn("What places can I visit in Hyderabad?")
            _, event = self.turn("More like these")
            self.assertEqual([item["name"] for item in event["tools"][0]["result"]["places"]], ["Golconda"])
            self.groq.assert_not_called()


class PublicEvidenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_opening_hours_require_a_matching_record(self):
        venue = {**PLACE, "openingHours": "Mon–Sun 09:00–17:00"}
        unrelated = {**venue, "name": "Golconda Fort", "openingHours": "24 hours"}
        with (patch.object(public_answers, "cache", SourceCache()),
              patch.object(public_answers, "lookup_places", new=AsyncMock(return_value={"places": [unrelated, venue]})),
              patch.object(public_answers, "resolve_location", new=AsyncMock(return_value=None)),
              patch("backend.agents.wikipedia_search", new=AsyncMock(return_value=[]))):
            result = await public_answers.factual_answer("What time does Charminar open?", "Charminar", CITY)
        self.assertEqual([(item["url"], item["excerpt"]) for item in result["findings"]],
                         [(PLACE["url"], venue["openingHours"])])

    async def test_safety_question_does_not_promote_unrelated_guide_text(self):
        guide = {"location": CITY, "sections": [
            {"title": "Overview", "text": "Watch an evening light show here.",
             "sourceUrl": "https://en.wikivoyage.org/wiki/Hyderabad"},
            {"title": "Safety and practical advice", "text": "Use marked crossings on busy roads.",
             "sourceUrl": "https://en.wikivoyage.org/wiki/Hyderabad#Stay_safe"},
        ]}
        with (patch.object(public_answers, "cache", SourceCache()),
              patch.object(public_answers, "destination_guide", new=AsyncMock(return_value=guide)),
              patch("backend.agents.wikipedia_search", new=AsyncMock(return_value=[]))):
            result = await public_answers.factual_answer("What should I watch out for here?", "Hyderabad", CITY)
        self.assertEqual([item["url"] for item in result["findings"]], [guide["sections"][1]["sourceUrl"]])


class TripStopRankingTest(unittest.TestCase):
    def test_nearby_name_variants_are_not_scheduled_twice(self):
        cathedral = {**PLACE, "name": "Notre Dame Cathedral", "lat": 48.853, "lon": 2.350,
                     "url": "https://en.wikivoyage.org/wiki/Paris#Notre_Dame_Cathedral"}
        alias = {**cathedral, "name": "Notre-Dame de Paris", "lat": 48.8531,
                 "url": "https://en.wikipedia.org/wiki/Notre-Dame_de_Paris"}
        separate = {**cathedral, "name": "Notre Dame Chapel", "lat": 48.8532,
                    "url": "https://en.wikipedia.org/wiki/Notre_Dame_Chapel"}
        remote = {**cathedral, "lat": 48.855, "url": "https://www.openstreetmap.org/way/100"}
        self.assertEqual(ranked_places([cathedral, alias, separate, remote], {}, "Paris"),
                         [cathedral, separate, remote])
