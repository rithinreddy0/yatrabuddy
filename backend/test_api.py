import base64
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

_tmp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_tmp.name) / "tests.sqlite")
os.environ["REQUIRE_GOOGLE_SIGN_IN"] = "0"
from .main import app
from .agents import BRAVE, NEWS, SearchResult
from .models import Finding


class ApiTest(unittest.TestCase):
    def test_trip_transport_endpoint_exposes_timed_quotes(self):
        with patch("backend.transport_sources.transport_quotes", new=AsyncMock(return_value={"transit": {"status": "empty"}})) as quote:
            response = self.client.get("/api/travel-providers?timetable=true&local=true&origin=17.4,78.4&destination=17.5,78.5")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["quotes"]["transit"]["status"], "empty")
        self.assertTrue(quote.await_args.kwargs["local"])

    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.brief = {
            "destination": "singapore", "origin": "Hyderabad", "date": None,
            "days": 3, "people": 2, "budget": 90000, "style": "Nature", "assumed": ["date"],
        }

    def test_guest_plan_and_authenticated_revision(self):
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})
        self.assertEqual(len(self.client.get("/api/destinations").json()), 5)
        self.assertEqual(self.client.get("/api/library").status_code, 401)
        response = self.client.post("/api/plan", json=self.brief)
        self.assertEqual(response.status_code, 200, response.text)
        trip = response.json()
        self.assertEqual(len(trip["days"]), 3)
        self.assertTrue(all(day["stops"] for day in trip["days"]))
        credentials = {"name": "Test traveler", "email": f"{uuid4()}@example.invalid", "password": "local-test-password"}
        response = self.client.post("/api/register", json=credentials)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        trip["route"] = 1
        document = {"trips": [trip], "saved": ["singapore"], "style": "Nature", "profile": None, "drafts": [],
                    "sampleExpenses": [{"name": "Palolem taxi", "amount": 450, "day": 2}]}
        payload = {"revision": 0, "library": document}
        self.assertEqual(self.client.put("/api/library", json=payload).json(), {"revision": 1})
        self.assertEqual(self.client.put("/api/library", json=payload).status_code, 409)
        self.assertEqual(self.client.get("/api/library").json()["library"], document)
        self.assertEqual(self.client.post("/api/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/library").status_code, 401)
        self.assertEqual(self.client.post("/api/login", json=credentials).status_code, 200)
        self.assertEqual(self.client.get("/api/library").json()["revision"], 1)

    def test_guests_can_browse_but_account_details_and_chat_are_private(self):
        from unittest.mock import patch
        with (patch.dict(os.environ, {"REQUIRE_GOOGLE_SIGN_IN": "1"}),
              patch("backend.auth.firebase_config", return_value={"apiKey": "example"}),
              patch("backend.auth.firebase_identity", side_effect=[
                  (str(uuid4()), f"{uuid4()}@example.invalid", "One"),
                  (str(uuid4()), f"{uuid4()}@example.invalid", "Two"),
              ])):
            self.assertEqual(self.client.get("/api/health").status_code, 200)
            self.assertTrue(self.client.get("/api/auth/config").json()["googleRequired"])
            self.assertEqual(self.client.get("/api/destinations").status_code, 200)
            self.assertEqual(self.client.get("/api/news?days=1").status_code, 422)
            self.assertEqual(self.client.get("/api/locations?q=x").status_code, 422)
            self.assertEqual(self.client.get("/api/account").status_code, 401)
            self.assertEqual(self.client.get("/api/library").status_code, 401)
            self.assertEqual(self.client.post("/api/planning-agent/sessions").status_code, 401)
            token = {"token": "x" * 120}
            self.assertEqual(self.client.post("/api/auth/firebase", json=token).status_code, 200)
            self.assertEqual(self.client.get("/api/destinations").status_code, 200)
            self.assertEqual(self.client.get("/api/account").json()["phone"], "")
            profile = {"name": "First traveler", "username": "first-traveler", "phone": "+91 98765 43210"}
            self.assertEqual(self.client.put("/api/account", json=profile).status_code, 200)
            self.assertEqual(self.client.get("/api/account").json()["phone"], profile["phone"])
            self.assertNotIn("phone", self.client.get("/api/session").json()["user"])
            conversation = self.client.post("/api/planning-agent/sessions").json()["token"]
            path = f"/api/planning-agent/sessions/{conversation}"
            self.assertEqual(self.client.get(path).status_code, 200)
            self.assertEqual(self.client.post("/api/logout").status_code, 200)
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.post("/api/auth/firebase", json=token).status_code, 200)
            self.assertEqual(self.client.get("/api/account").json()["phone"], "")
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_registration_schedules_welcome_after_creating_account(self):
        address = f"{uuid4()}@example.invalid"
        with (patch("backend.account_mail.configured", return_value=True),
              patch("backend.account_mail.send_welcome") as send):
            response = self.client.post("/api/register", json={
                "name": "Test traveler", "email": address, "password": "local-test-password",
            })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["welcomeEmail"], "scheduled")
        send.assert_called_once_with(address)

    def test_trip_workspace_sharing_and_private_attachments(self):
        draft = {
            "id": str(uuid4()), "cityId": 1857910, "name": "Kyoto",
            "updated": 2, "departure": "2026-11-21",
            "days": [[{"name": "Kyoto Imperial Palace", "category": "Sight", "source": "Wikipedia",
                       "url": "https://en.wikipedia.org/wiki/Kyoto_Imperial_Palace", "lat": 35.025, "lon": 135.762}]],
        }
        response = self.client.post("/api/trip-workspaces", json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        workspace_id = response.json()["id"]
        path = f"/api/trip-workspaces/{workspace_id}"
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertEqual(self.client.post(path + "/entries", json={
            "kind": "idea", "title": "Kyoto Imperial Palace", "url": draft["days"][0][0]["url"],
        }).status_code, 200)
        invite = "/api/trip-workspaces/invites/" + self.client.post(path + "/invite").json()["code"]
        guest = TestClient(app)
        visitor = TestClient(app)
        self.addCleanup(guest.close)
        self.addCleanup(visitor.close)
        self.assertEqual(guest.get(path).status_code, 404)
        self.assertEqual(guest.get(invite).json(), {"name": "Kyoto"})
        joined = guest.post(invite, json={"name": "Traveler"}).json()
        self.assertFalse(joined["isOwner"])
        self.assertEqual(guest.post(path + "/invite").status_code, 403)
        self.assertEqual(guest.delete(path + "/entries/" + joined["entries"][0]["id"]).status_code, 403)
        self.assertEqual(guest.post(path + "/entries", json={"kind": "message", "notes": "See you at the station."}).status_code, 200)
        received = self.client.get(path).json()["entries"][-1]
        self.assertEqual((received["author"], received["notes"], received["mine"]),
                         ("Traveler", "See you at the station.", False))
        media = self.client.post(path + "/entries", json={
            "kind": "media", "title": "Palace photo", "place": "Kyoto Imperial Palace",
            "url": "https://upload.wikimedia.org/example.jpg", "credit": "Example photographer", "license": "CC BY 4.0",
        })
        self.assertEqual(media.status_code, 200, media.text)
        saved_media = next(entry for entry in guest.get(path).json()["entries"] if entry["kind"] == "media")
        self.assertEqual((saved_media["place"], saved_media["license"]), ("Kyoto Imperial Palace", "CC BY 4.0"))
        self.assertEqual(visitor.get(path).status_code, 404)

        png = b"\x89PNG\r\n\x1a\npreview"
        metadata = {"kind": "booking", "title": "Trip receipt", "amount": 2200, "notes": "Paid directly"}
        payload = json.dumps(metadata).encode() + b"\n" + png
        response = guest.post(path + "/files", content=payload)
        self.assertEqual(response.status_code, 200, response.text)
        receipt = response.json()["entries"][-1]
        self.assertEqual(receipt["amount"], 2200)
        self.assertEqual(receipt["notes"], "Paid directly")
        self.assertEqual(receipt["attachmentType"], "image/png")
        self.assertEqual(visitor.get(receipt["attachment"]).status_code, 404)
        partial = self.client.get(receipt["attachment"], headers={"Range": "bytes=0-7"})
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.content, png[:8])

        updated = self.client.post("/api/trip-workspaces", json={**draft, "updated": 3, "travelers": 3})
        self.assertEqual(updated.json()["id"], workspace_id)
        self.assertEqual(guest.get(path).json()["draft"]["travelers"], 3)
        self.assertEqual(len(guest.get(path).json()["entries"]), 4)
        self.assertEqual(self.client.post("/api/trip-workspaces", json=draft).json()["draft"]["travelers"], 3)
        self.assertEqual(self.client.delete(path + "/invite").status_code, 204)
        self.assertEqual(visitor.post(invite, json={"name": "Visitor"}).status_code, 404)
        self.assertEqual(guest.get("/api/trip-workspaces").json()[0]["id"], workspace_id)
        self.assertEqual(guest.delete(path + "/entries/" + receipt["id"]).status_code, 200)
        self.assertEqual(self.client.get(receipt["attachment"]).status_code, 404)

    def test_trip_workspace_stop_edits_keep_routes_costs_and_newer_preferences(self):
        palace = {"name": "Kyoto Imperial Palace", "category": "Sight", "source": "Wikipedia",
                  "url": "https://en.wikipedia.org/wiki/Kyoto_Imperial_Palace", "lat": 35.025, "lon": 135.762}
        castle = {"name": "Nijō Castle", "category": "Sight", "source": "Wikipedia",
                  "url": "https://en.wikipedia.org/wiki/Nij%C5%8D_Castle", "lat": 35.014, "lon": 135.747}
        draft = {"id": str(uuid4()), "cityId": 1857910, "name": "Kyoto", "updated": 1,
                 "days": [[palace], []], "stopCosts": {palace["url"]: 500}}
        response = self.client.post("/api/trip-workspaces", json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        path = f"/api/trip-workspaces/{response.json()['id']}"
        stops = path + "/days/1/stops"
        invite = "/api/trip-workspaces/invites/" + self.client.post(path + "/invite").json()["code"]
        guest = TestClient(app)
        outsider = TestClient(app)
        self.addCleanup(guest.close)
        self.addCleanup(outsider.close)
        self.assertEqual(guest.post(invite, json={"name": "Traveler"}).status_code, 200)
        self.assertEqual(guest.request("DELETE", stops, json={"url": palace["url"]}).status_code, 403)
        self.assertEqual(outsider.post(stops, json={"url": castle["url"]}).status_code, 404)

        nearby = {"location": {"lat": 35.025, "lon": 135.762}, "places": [castle]}
        with (patch("backend.nearby.nearby_report", new=AsyncMock(return_value=nearby)),
              patch("backend.nearby.route_points", new=AsyncMock(return_value=None))):
            added = self.client.post(stops, json={"url": castle["url"]})
        self.assertEqual(added.status_code, 200, added.text)
        changed = added.json()["draft"]
        self.assertEqual([stop["name"] for stop in changed["days"][0]], [palace["name"], castle["name"]])
        self.assertEqual(changed["routes"][0][0]["method"], "straight-line")

        preferences = {"expectedUpdated": 1, "travelers": 2, "budget": 9000,
                       "mealPreference": "Vegetarian", "pace": "Relaxed", "localModes": ["Walk"]}
        self.assertEqual(self.client.patch(path + "/preferences", json=preferences).status_code, 409)
        preferences["expectedUpdated"] = changed["updated"]
        self.assertEqual(guest.patch(path + "/preferences", json=preferences).status_code, 403)
        changed_preferences = self.client.patch(path + "/preferences", json=preferences)
        self.assertEqual(changed_preferences.status_code, 200, changed_preferences.text)
        self.assertEqual(changed_preferences.json()["draft"]["days"], changed["days"])

        removed = self.client.request("DELETE", stops, json={"url": palace["url"]})
        self.assertEqual(removed.status_code, 200, removed.text)
        final = removed.json()["draft"]
        self.assertEqual([stop["name"] for stop in final["days"][0]], [castle["name"]])
        self.assertEqual(final["stopCosts"], {})
        self.assertEqual(final["routes"], [[], []])
        self.assertEqual((final["travelers"], final["budget"]), (2, 9000))
        self.assertEqual(guest.get(path).json()["draft"], final)
        self.assertEqual(self.client.request("DELETE", stops, json={"url": castle["url"]}).status_code, 422)

    def test_validation_and_cross_origin(self):
        response = self.client.post("/api/plan", json={**self.brief, "days": 40})
        self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/plan", json=self.brief, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status_code, 403)

    def test_planner_preserves_explicit_stops_and_stay(self):
        stops = ["Gardens by the Bay", "Marina Bay Promenade", "Maxwell Food Centre"]
        selection = {**self.brief, "selectedStops": stops, "selectedStay": 1}
        response = self.client.post("/api/plan", json=selection)
        self.assertEqual(response.status_code, 200, response.text)
        trip = response.json()
        self.assertEqual(trip["stay"], 1)
        self.assertCountEqual([stop for day in trip["days"] for stop in day["stops"]], stops)

        response = self.client.post("/api/plan", json={**selection, "days": 1, "pace": "Relaxed"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("choose fewer stops", response.json()["detail"])

    def test_planner_applies_diet_and_known_venue_closures(self):
        response = self.client.post("/api/plan", json={
            **self.brief, "destination": "hyderabad", "date": "2026-11-13", "style": "Culture",
            "diet": "Vegan", "pace": "Relaxed",
        })
        self.assertEqual(response.status_code, 200, response.text)
        trip = response.json()
        self.assertTrue(trip["days"][0]["relaxed"])
        self.assertNotIn("Chowmahalla Palace", trip["days"][0]["stops"])
        self.assertNotIn("Salar Jung Museum", trip["days"][0]["stops"])
        self.assertTrue(all("Nimrah Café" not in day["stops"] for day in trip["days"]))

    def test_news_validates_filters(self):
        response = self.client.get("/api/news?destination=singapore&topic=transport&days=99")
        self.assertEqual(response.status_code, 422)
        with patch("backend.news.travel_news", new=AsyncMock(return_value={
            "provider": "GDELT", "status": "empty", "articles": [],
        })) as news:
            response = self.client.get("/api/news?destination=singapore&topic=transport&days=7")
        self.assertEqual(response.status_code, 200, response.text)
        news.assert_awaited_once_with("singapore", "transport", 7)

    def test_research_sources_and_provider_failure(self):
        finding = Finding(agent="Destination scout", title="Visit Singapore", url="https://www.visitsingapore.com/", provider=BRAVE)
        results = [SearchResult([finding], {BRAVE: "ready"}), SearchResult([], {BRAVE: "empty"}), TimeoutError()]
        with patch("backend.agents.search", new=AsyncMock(side_effect=results)), patch(
            "backend.agents.weather_agent", new=AsyncMock(side_effect=TimeoutError())
        ), patch("backend.agents.air_quality_agent", new=AsyncMock(return_value=None)):
            response = self.client.post("/api/research", json={"destination": "singapore", "topic": "overview"})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["status"], "partial")
        self.assertEqual(data["weatherStatus"], "unavailable")
        self.assertEqual(data["findings"][0]["url"], "https://www.visitsingapore.com/")
        self.assertEqual(data["sources"]["web"]["status"], "partial")
        self.assertEqual(data["sources"]["weather"]["status"], "unavailable")

    def test_research_uses_question_and_labels_fallback_sources(self):
        article = {
            "title": "Singapore transport update", "url": "https://news.google.com/rss/articles/test",
            "publisher": "Test publication", "date": "2026-11-05T01:02:03+00:00",
        }
        with patch.dict(os.environ, {"BRAVE_SEARCH_API_KEY": "", "ENABLE_WEATHER": "0"}), patch(
            "backend.agents.wikipedia_search", new=AsyncMock(side_effect=ValueError())
        ), patch("backend.news.news_rss_query", new=AsyncMock(return_value=[article])) as rss:
            response = self.client.post("/api/research", json={
                "destination": "singapore", "topic": "routes", "query": "train passes", "refresh": True,
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(rss.await_args.args[1], "Singapore train passes")
        data = response.json()
        self.assertEqual(data["provider"], NEWS)
        self.assertEqual(data["findings"][0]["kind"], "news")
        self.assertEqual(data["findings"][0]["publisher"], "Test publication")
        self.assertEqual(data["sources"]["weather"]["status"], "disabled")


    def test_google_config_and_session_exchange(self):
        with patch.dict(os.environ, {"FIREBASE_WEB_API_KEY": ""}):
            self.assertIsNone(self.client.get("/api/auth/config").json()["firebase"])
            self.assertEqual(self.client.post("/api/auth/firebase", json={"token": "x" * 100}).status_code, 503)

        config = {
            "FIREBASE_PROJECT_ID": "test-project",
            "FIREBASE_AUTH_DOMAIN": "test-project.firebaseapp.com",
            "FIREBASE_WEB_API_KEY": "example-web-key",
            "FIREBASE_WEB_APP_ID": "example-app-id",
        }
        uid = uuid4().hex
        claims = {
            "aud": config["FIREBASE_PROJECT_ID"],
            "iss": "https://securetoken.google.com/" + config["FIREBASE_PROJECT_ID"],
            "sub": uid,
            "firebase": {"sign_in_provider": "google.com"},
            "exp": int(time.time()) + 300,
        }
        email = f"{uid}@example.invalid"
        profile = {"localId": uid, "email": email, "emailVerified": True, "displayName": "Google traveler"}
        lookup_url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
        lookup = httpx.Response(200, json={"users": [profile]}, request=httpx.Request("POST", lookup_url))
        with patch.dict(os.environ, config), patch("backend.auth.httpx.Client") as firebase_client:
            provider = firebase_client.return_value.__enter__.return_value.post
            provider.return_value = lookup
            self.assertEqual(self.client.get("/api/auth/config").json()["firebase"]["projectId"], "test-project")

            def exchange(token_claims):
                payload = base64.urlsafe_b64encode(json.dumps(token_claims).encode()).decode().rstrip("=")
                token = f"header.{payload}.signature"
                return self.client.post("/api/auth/firebase", json={"token": token})

            self.assertEqual(exchange({**claims, "aud": "other-project"}).status_code, 401)
            self.assertIsNone(self.client.get("/api/session").json()["user"])
            result = exchange(claims)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()["newAccount"])
            self.assertIn("HttpOnly", result.headers["set-cookie"])
            self.assertEqual(self.client.get("/api/session").json()["user"]["email"], email)
            repeat = exchange(claims)
            self.assertFalse(repeat.json()["newAccount"])
            self.assertEqual(repeat.json()["user"]["id"], result.json()["user"]["id"])
            self.assertEqual(provider.call_args.args, (lookup_url,))


if __name__ == "__main__":
    unittest.main()
