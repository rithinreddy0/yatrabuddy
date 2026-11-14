import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError

_tmp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", "sqlite:///" + str(Path(_tmp.name) / "budget.sqlite"))
os.environ["REQUIRE_GOOGLE_SIGN_IN"] = "0"
from .main import app  # noqa: E402
from .models import TripLedger, WorldwideDraft  # noqa: E402


def draft(**extra):
    return {
        "id": str(uuid4()), "cityId": 1271157, "name": "Goa", "updated": 2, "travelers": 2, "budget": 20000,
        "days": [[{"name": "Basilica of Bom Jesus", "category": "Sight", "source": "Wikipedia",
                   "url": "https://en.wikipedia.org/wiki/Basilica_of_Bom_Jesus", "lat": 15.5, "lon": 73.91}]],
        **extra,
    }


class LedgerModelTest(unittest.TestCase):
    def test_ledger_round_trips_with_the_draft(self):
        expense = {"id": str(uuid4()), "category": "Food", "amount": 450, "payer": "Asha", "split": ["Asha", "Ravi"]}
        saved = WorldwideDraft.model_validate(draft(ledger={
            "members": ["Asha", "Ravi"], "contingency": 2000, "categoryBudgets": {"Food": 4000}, "expenses": [expense],
        }))
        self.assertEqual(saved.ledger.expenses[0].amount, 450)
        self.assertEqual(saved.model_dump(mode="json")["ledger"]["categoryBudgets"], {"Food": 4000})

    def test_ledger_rejects_unknown_people_categories_and_duplicates(self):
        base = {"id": str(uuid4()), "category": "Food", "amount": 100}
        with self.assertRaises(ValidationError):
            TripLedger.model_validate({"members": ["Asha"], "expenses": [{**base, "payer": "Stranger"}]})
        with self.assertRaises(ValidationError):
            TripLedger.model_validate({"expenses": [{**base, "category": "Casino"}]})
        with self.assertRaises(ValidationError):
            TripLedger.model_validate({"expenses": [base, base]})
        with self.assertRaises(ValidationError):
            TripLedger.model_validate({"members": ["Asha", "asha"]})
        with self.assertRaises(ValidationError):
            TripLedger.model_validate({"expenses": [{**base, "amount": 0}]})


class BookingStatusTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        room = self.client.post("/api/trip-workspaces", json=draft())
        self.assertEqual(room.status_code, 200, room.text)
        self.path = f"/api/trip-workspaces/{room.json()['id']}/entries"

    def test_booking_status_lifecycle(self):
        created = self.client.post(self.path, json={
            "kind": "booking", "title": "Goa Express", "bookingType": "Train", "status": "link_opened", "amount": 2400,
        })
        self.assertEqual(created.status_code, 200, created.text)
        booking = created.json()["entries"][-1]
        self.assertEqual((booking["status"], booking["bookingType"]), ("link_opened", "Train"))
        confirmed = self.client.patch(f"{self.path}/{booking['id']}", json={
            "kind": "booking", "title": "Goa Express", "bookingType": "Train", "status": "confirmed",
            "amount": 2400, "reference": "PNR 4521",
        })
        self.assertEqual(confirmed.json()["entries"][-1]["reference"], "PNR 4521")
        refunded = self.client.patch(f"{self.path}/{booking['id']}", json={
            "kind": "booking", "title": "Goa Express", "status": "refunded", "amount": 2400, "refundAmount": 1800,
        })
        self.assertEqual(refunded.json()["entries"][-1]["refundAmount"], 1800)

    def test_booking_fields_are_validated(self):
        too_big = self.client.post(self.path, json={"kind": "booking", "title": "Hotel", "status": "refunded",
                                                    "amount": 1000, "refundAmount": 1500})
        self.assertEqual(too_big.status_code, 422)
        not_cancelled = self.client.post(self.path, json={"kind": "booking", "title": "Hotel", "status": "confirmed",
                                                          "refundAmount": 100})
        self.assertEqual(not_cancelled.status_code, 422)
        idea = self.client.post(self.path, json={"kind": "idea", "title": "Fort", "status": "confirmed"})
        self.assertEqual(idea.status_code, 422)
        unknown = self.client.post(self.path, json={"kind": "booking", "title": "Hotel", "status": "paid"})
        self.assertEqual(unknown.status_code, 422)
        legacy = self.client.post(self.path, json={"kind": "booking", "title": "Old receipt", "amount": 900})
        self.assertIsNone(legacy.json()["entries"][-1]["status"])


if __name__ == "__main__":
    unittest.main()
