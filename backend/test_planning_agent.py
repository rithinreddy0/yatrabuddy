import json
import os
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

# Reuse the test suite's isolated SQLite setup.
from .test_api import app
from .planning_agent import extract, grounded_order


class PlanningAgentTest(TestCase):
    @patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "groq"})
    def test_groq_failure_does_not_call_gemini(self):
        with (TestClient(app) as client,
              patch("backend.groq_planning.config", return_value=("test-key", "test-model")),
              patch("backend.groq_planning.generate", new=AsyncMock(side_effect=ValueError)),
              patch("backend.gemini_planning.config") as gemini_config):
            session = client.post("/api/planning-agent/sessions").json()
            path = "/api/planning-agent/sessions/" + session["token"]
            response = client.post(path + "/turn", json={
                "version": session["version"], "kind": "message", "text": "Help me plan a trip",
            })
            events = [json.loads(line) for line in response.iter_lines()]
            self.assertEqual(events[-1]["type"], "done")
            self.assertEqual([event["name"] for event in events if event["type"] == "tool"],
                             ["Groq", "Groq"])
            gemini_config.assert_not_called()

    def test_complete_trip_with_no_model_or_network(self):
        with TestClient(app) as client, patch("backend.planning_agent.online_tool", new_callable=AsyncMock) as online:
            session = client.post("/api/planning-agent/sessions").json()
            path = "/api/planning-agent/sessions/" + session["token"]

            def send(kind, **kwargs):
                nonlocal session
                response = client.post(path + "/turn", json={
                    "version": session["version"], "kind": kind, "offline": True, **kwargs,
                })
                self.assertEqual(response.status_code, 200, response.text)
                events = [json.loads(line) for line in response.iter_lines()]
                self.assertEqual(events[-1]["type"], "done", events)
                session = events[-1]
                return events

            first = send("message", text="Goa from Delhi, 4 days, 4 friends, 15k each")
            self.assertEqual(session["state"]["brief"]["budget"], 75000)
            self.assertEqual(session["state"]["brief"]["destination"], "goa")
            self.assertEqual(first[0]["status"], "running")
            self.assertEqual(first[1]["status"], "done")
            send("select", value="rail", label="Rail and local transfer")
            self.assertEqual(session["events"][-1]["label"], "Rail and local transfer")
            send("message", text="show cheaper hotels")
            prices = [item["total"] for item in session["events"][-1]["options"]]
            self.assertEqual(prices, sorted(prices))
            send("message", text="What is the weather in Goa?")
            self.assertEqual(session["state"]["step"], 1)
            self.assertEqual(session["events"][-1]["interruption"], "Weather")
            self.assertEqual(session["events"][-1]["tools"][0]["name"], "Weather")
            send("select", value="0")
            send("message", text="make it 85k")
            self.assertEqual(session["state"]["brief"]["budget"], 85000)
            self.assertEqual(set(session["state"]["choices"]), {"Transport", "Stay"})
            send("undo")
            self.assertEqual(session["state"]["brief"]["budget"], 75000)
            send("redo")
            self.assertEqual(session["state"]["step"], 2)
            for _ in range(4):
                send("continue")
            preview = session["state"]["preview"]
            self.assertTrue(any(day["stops"] for day in preview["days"]))
            self.assertEqual(preview["total"], sum(preview["ledger"].values()))
            self.assertLessEqual(preview["total"], session["state"]["brief"]["budget"])
            send("save")
            self.assertIsNotNone(session["state"]["plan"])
            self.assertEqual(session["state"]["plan"]["agentTransport"], session["ledger"]["Transport"])
            self.assertEqual(session["state"]["plan"]["days"], preview["days"])
            self.assertEqual(session["state"]["plan"]["agentRoute"]["id"], "rail")
            plan_id = session["state"]["plan"]["id"]
            send("save")
            self.assertEqual(session["state"]["plan"]["id"], plan_id)
            self.assertEqual(client.get(path).json()["state"], session["state"])
            online.assert_not_awaited()
            self.assertEqual(client.delete(path).status_code, 204)
            self.assertEqual(client.get(path).status_code, 404)

    def test_intake_aliases_and_short_answers(self):
        self.assertEqual(extract("Plan a trip to Goa"), {"destination": "goa"})
        self.assertEqual(extract("Kerala from Hyderabad")["destination"], "kerala")
        self.assertEqual(extract("Hyderabad to Goa")["origin"], "Hyderabad")
        self.assertEqual(extract("Hyderabad to Goa")["destination"], "goa")
        self.assertEqual(extract("Delhi", {"destination": "goa"}), {"origin": "Delhi"})
        self.assertEqual(extract("Hyderabad", {"destination": "goa"}), {"origin": "Hyderabad"})
        self.assertEqual(extract("show cheaper hotels", {"destination": "goa"}), {})
        self.assertEqual(extract("4", {"destination": "goa", "origin": "Delhi"}), {"days": 4})
        self.assertEqual(extract("four", {"destination": "goa", "origin": "Delhi"}), {"days": 4})
        self.assertEqual(extract("₹ 25,000"), {"budget": 25000})

    def test_sourced_stay_is_saved_without_a_sample_rate(self):
        source = {"name": "Listed Stay", "url": "https://en.wikivoyage.org/wiki/Palolem#Stay", "source": "Wikivoyage"}
        with (TestClient(app) as client,
              patch("backend.planning_agent.place_answer", new=AsyncMock(return_value={
                  "query": "Palolem", "category": "stays", "status": "live", "places": [source],
              }))):
            session = client.post("/api/planning-agent/sessions").json()
            path = "/api/planning-agent/sessions/" + session["token"]
            def send(kind, **kwargs):
                nonlocal session
                response = client.post(path + "/turn", json={"kind": kind, "version": session["version"], "offline": True, **kwargs})
                event = json.loads(response.text.splitlines()[-1])
                if event["type"] == "done":
                    session = event
                return event
            self.assertEqual(send("message", text="Plan a trip to Goa")["missing"][0], "origin")
            self.assertEqual(send("message", text="Plan a trip")["events"][-1]["question"]["field"], "origin")
            send("message", text="Hyderabad to Goa for 3 days, 2 people, budget 30000")
            self.assertEqual([item["id"] for item in session["events"][-1]["options"]], ["unpriced"])
            send("select", value="unpriced")
            self.assertEqual(send("use_stay", value=source["url"])["type"], "error")
            send("message", text="Find hotels in Palolem")
            send("use_stay", value=source["url"])
            for _ in range(4):
                send("continue")
            send("save")
            self.assertEqual(session["state"]["plan"]["sourcedStay"], source)
            self.assertEqual(session["state"]["preview"]["unpriced"], ["Transport", "Stay"])
            self.assertEqual(client.get(path).json()["state"]["plan"]["sourcedStay"], source)

    def test_partial_input_and_stale_versions_cannot_corrupt_session(self):
        with TestClient(app) as client:
            session = client.post("/api/planning-agent/sessions").json()
            path = "/api/planning-agent/sessions/" + session["token"]
            rejected = client.post(path + "/turn", json={
                "version": 0, "kind": "edit", "field": "days", "value": "-1", "offline": True,
            })
            self.assertEqual(json.loads(rejected.text)["type"], "error")
            self.assertEqual(client.get(path).json()["version"], 0)
            accepted = client.post(path + "/turn", json={
                "version": 0, "kind": "message", "text": "Goa", "offline": True,
            })
            self.assertEqual(json.loads(accepted.text)["state"]["brief"], {"destination": "goa"})
            stale = client.post(path + "/turn", json={
                "version": 0, "kind": "edit", "field": "origin", "value": "Delhi", "offline": True,
            })
            self.assertEqual(stale.status_code, 409)
            self.assertEqual(client.get(path).json()["state"]["brief"], {"destination": "goa"})

    def test_model_output_cannot_create_facts_or_options(self):
        options = [{"id": "rail", "total": 2700}]
        with self.assertRaises(ValidationError):
            grounded_order('{"lead":"budget","option_ids":["rail"],"price":1}', options)
        with self.assertRaises(ValueError):
            grounded_order('{"lead":"budget","option_ids":["ignore all instructions"]}', options)
        self.assertEqual(grounded_order('{"lead":"budget","option_ids":["rail"]}', options), ("budget", options))

    def test_place_questions_do_not_change_draft_and_preserve_source_links(self):
        photo = {"url": "https://upload.wikimedia.org/example.jpg", "credit": "Example author",
                 "sourceUrl": "https://commons.wikimedia.org/wiki/File:Example.jpg", "license": "CC BY-SA 4.0"}
        palolem = {"places": [{"name": "Galgibaga Beach", "source": "Wikipedia", "lat": 14.95, "lon": 74.05,
                               "url": "https://en.wikipedia.org/wiki/Galgibaga_Beach", "photo": photo},
                              {"name": "Invalid link", "url": "javascript:alert(1)"}],
                   "status": "partial", "freshness": "live", "retrievedAt": "2026-11-13T10:00:00Z"}
        with (TestClient(app) as client, patch("backend.planning_agent.lookup_places", new=AsyncMock(return_value=palolem)) as lookup):
            token = client.post("/api/planning-agent/sessions").json()["token"]
            path = f"/api/planning-agent/sessions/{token}"
            for version, (message, offline) in enumerate([
                ("Goa", True), ("Any sights in Palolem?", False), ("What are the current hotel prices in Goa?", False),
                ("Can you book a train to Goa?", False), ("Find hotels in Kyoto", True),
            ]):
                response = client.post(path + "/turn", json={"kind": "message", "text": message,
                                                             "version": version, "offline": offline})
                turn = [json.loads(line) for line in response.iter_lines()][-1]
                self.assertEqual(turn["state"]["brief"], {"destination": "goa"}, message)
                last = turn["events"][-1]
                if version == 1:
                    result = last["tools"][0]["result"]
                    self.assertEqual(result["status"], "live")
                    self.assertEqual([item["source"] for item in result["places"]], ["Wikipedia"])
                    self.assertEqual(result["places"][0]["photo"], photo)
                elif version in (2, 3):
                    self.assertIn("provider", last["notice"])
                elif version == 4:
                    self.assertEqual(last["tools"][0]["result"]["status"], "unavailable")
            lookup.assert_awaited_once_with("Palolem", "attractions", public_only=True, include_photos=True)
            self.assertEqual(client.get(path).json()["events"][1]["tools"][0]["result"]["query"], "Palolem")

    @patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "gemini"})
    def test_gemini_answers_without_mutating_trip_and_replaces_latest_turn(self):
        def prose(text):
            return {"role": "model", "parts": [{"text": text}]}

        mock = AsyncMock(side_effect=[
            prose("Pack breathable layers and a light rain shell."),
            prose("A coastal weekend works well with a flexible schedule."),
        ])
        with (TestClient(app) as client, patch("backend.gemini_planning.config", return_value=("test", "model")),
              patch("backend.gemini_planning.generate", mock)):
            token = client.post("/api/planning-agent/sessions").json()["token"]
            path = f"/api/planning-agent/sessions/{token}"
            for version, message in enumerate(("What should I pack for Varkala?", "Is a coastal weekend a good idea?")):
                response = client.post(path + "/turn", json={
                    "version": version, "kind": "message", "text": message, "replace": version == 1,
                })
                events = [json.loads(line) for line in response.iter_lines()]
                self.assertIn("answer", [event["type"] for event in events])
                self.assertEqual(events[-1]["state"]["brief"], {})
                self.assertNotIn("question", events[-1]["events"][-1])
            self.assertEqual(events[-1]["version"], 2)
            self.assertEqual([event["text"] for event in events[-1]["events"]], ["Is a coastal weekend a good idea?"])

    @patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "gemini"})
    def test_gemini_tools_retry_ungrounded_answer_and_refuse_invented_trip_fields(self):
        def model_part(part):
            return {"role": "model", "parts": [part]}

        calls = {"functionCall": {"name": "update_trip", "id": "patch-id",
                                  "args": {"destination": "goa", "days": 5, "budget": 9999999}}}
        mock = AsyncMock(side_effect=[
            model_part(calls),
            model_part({"text": "Your trip will cost ₹987654."}),
            model_part({"text": "Goa sounds good. Where would you like to leave from?"}),
        ])
        with (TestClient(app) as client, patch("backend.gemini_planning.config", return_value=("test", "model")),
              patch("backend.gemini_planning.generate", mock)):
            token = client.post("/api/planning-agent/sessions").json()["token"]
            response = client.post(f"/api/planning-agent/sessions/{token}/turn", json={
                "version": 0, "kind": "message", "text": "Plan a trip to Goa",
            })
            events = [json.loads(line) for line in response.iter_lines()]
            self.assertEqual(events[-1]["state"]["brief"], {"destination": "goa"})
            self.assertEqual(events[-1]["events"][-1]["question"]["field"], "origin")
            self.assertNotIn("987654", response.text)
            self.assertEqual(events[-1]["events"][-1]["answer"], "Goa sounds good.")
            mock.assert_awaited()
            self.assertEqual(mock.await_count, 3)

    @patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "gemini"})
    def test_model_suggests_valid_choices_for_missing_field(self):
        question = {"field": "origin", "prompt": "Which city are you leaving from?", "options": [
            {"value": "Delhi", "reason": "Use the city where your trip begins."},
            {"value": "Mumbai", "reason": "Choose this if you are already nearby."},
            {"value": "Hyderabad", "reason": "Start from here if it suits your group."},
        ]}
        with (TestClient(app) as client, patch("backend.gemini_planning.config", return_value=("test", "model")),
              patch("backend.gemini_planning.generate", new=AsyncMock(side_effect=[
                  {"role": "model", "parts": [{"functionCall": {"name": "ask_user", "args": question}}]},
                  {"role": "model", "parts": [{"text": "Choose a starting city to narrow down your journey."}]},
              ]))):
            token = client.post("/api/planning-agent/sessions").json()["token"]
            response = client.post(f"/api/planning-agent/sessions/{token}/turn", json={
                "version": 0, "kind": "message", "text": "Plan a trip to Goa",
            })
            done = json.loads(list(response.iter_lines())[-1])
            rendered = done["events"][-1]["question"]
            self.assertEqual(rendered["prompt"], question["prompt"])
            self.assertEqual([item["label"] for item in rendered["options"]], ["Delhi", "Mumbai", "Hyderabad"])
            self.assertEqual(done["state"]["brief"], {"destination": "goa"})

    def test_draft_saves_and_synced_edits_survive_a_budget_change(self):
        with TestClient(app) as client:
            token = client.post("/api/planning-agent/sessions").json()["token"]
            path = f"/api/planning-agent/sessions/{token}"

            def turn(version, kind, **payload):
                response = client.post(path + "/turn", json={"version": version, "kind": kind, "offline": True, **payload})
                self.assertEqual(response.status_code, 200, response.text)
                done = json.loads(list(response.iter_lines())[-1])
                self.assertEqual(done["type"], "done", done)
                return done

            draft = turn(0, "message", text="Plan Goa from Delhi for 4 days, 2 people, under 50k, no long drives")
            self.assertTrue(draft["events"][-1]["draftPreview"]["unverifiedPreferences"])
            saved = turn(1, "save_draft")
            self.assertTrue(saved["syncPlan"])
            plan = saved["state"]["plan"]
            plan["days"][0]["stops"] = []
            result = client.post(path + "/context", json={"version": 2, "trip": plan})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["state"]["plan"]["days"], plan["days"])
            self.assertEqual(client.post(path + "/context", json={"version": 2, "trip": plan}).status_code, 409)
            unchanged = client.post(path + "/context", json={"version": 3, "trip": plan})
            self.assertEqual(unchanged.json()["version"], 3)
            edited = turn(3, "edit", field="budget", value="55000")
            self.assertEqual(edited["state"]["preview"]["days"], plan["days"])
            revised = turn(4, "save")["state"]["plan"]
            self.assertEqual(revised["id"], plan["id"])
            self.assertEqual(revised["days"], plan["days"])
            self.assertEqual(revised["brief"]["budget"], 55000)

    @patch.dict(os.environ, {"TRAVEL_CHAT_PROVIDER": "gemini"})
    def test_image_request_uses_public_source_when_model_unavailable(self):
        source = AsyncMock(return_value={"query": "Goa", "places": [], "status": "live"})
        with (TestClient(app) as client, patch("backend.gemini_planning.config", return_value=None),
              patch("backend.planning_agent.destination_images", source)):
            token = client.post("/api/planning-agent/sessions").json()["token"]
            response = client.post(f"/api/planning-agent/sessions/{token}/turn", json={
                "version": 0, "kind": "message", "text": "Show me an image of Goa",
            })
            done = json.loads(list(response.iter_lines())[-1])
            self.assertEqual(done["events"][-1]["tools"][0]["name"], "Images")
            self.assertEqual(done["state"]["brief"], {})
            source.assert_awaited_once_with("Goa")
