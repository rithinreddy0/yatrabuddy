import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx

from .transport_quotes import driving, flights, transit


class TransportQuotesTest(unittest.IsolatedAsyncioTestCase):
    async def test_duffel_searches_both_goa_airports_and_drops_test_offers(self):
        travel_date = (datetime.now(timezone.utc) + timedelta(days=2)).date()
        searched = set()

        def reply(request):
            self.assertEqual(request.headers["Duffel-Version"], "v2")
            data = json.loads(request.content)["data"]
            self.assertEqual(data["passengers"], [{"type": "adult"}, {"type": "adult"}])
            a, b = (data["slices"][0][key] for key in ("origin", "destination"))
            searched.add((a, b))
            segment = {"origin": {"iata_code": a}, "destination": {"iata_code": b},
                       "departing_at": f"{travel_date}T07:00:00", "arriving_at": f"{travel_date}T08:30:00",
                       "marketing_carrier": {"name": "Example", "iata_code": "XX"}, "marketing_carrier_flight_number": "102"}
            return httpx.Response(200, json={"data": {"live_mode": b == "GOI", "offers": [
                {"slices": [{"segments": [segment]}], "total_currency": "INR", "total_amount": "16000.00"},
            ]}})

        with patch.dict(os.environ, {"DUFFEL_ACCESS_TOKEN": "test"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
                result = await flights(client, "Hyderabad", "Old Goa, India", travel_date, 2)
        self.assertEqual(searched, {("HYD", "GOI"), ("HYD", "GOX")})
        self.assertEqual([offer["legs"][0]["alight"]["name"] for offer in result["options"]], ["GOI"])

    async def test_driving_uses_traffic_aware_duration(self):
        def reply(request):
            self.assertEqual(json.loads(request.content)["routingPreference"], "TRAFFIC_AWARE")
            return httpx.Response(200,json={"routes": [{"distanceMeters": 679800, "duration": "31620s"}]})

        with patch.dict(os.environ, {"GOOGLE_ROUTES_API_KEY": "test"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
                result = await driving(client, "Hyderabad", "Old Goa")
        self.assertEqual((result["status"], result["metres"], result["duration"]), ("ready", 679800, "31620s"))
    async def test_transit_returns_operator_boarding_times_and_fare(self):
        timestamp = datetime.now(timezone.utc) + timedelta(days=2)

        def reply(request):
            self.assertEqual(request.headers["X-Goog-Api-Key"], "example")
            detail = {"stopDetails": {"departureStop": {"name": "Central Bus Station"},
                                      "arrivalStop": {"name": "Airport Terminal"}, "departureTime": timestamp.isoformat()},
                      "transitLine": {"nameShort": "A1", "agencies": [{"name": "City Transit"}]}}
            route = {"duration": "1800s", "distanceMeters": 7200, "legs": [{"steps": [{"transitDetails": detail}]}],
                     "travelAdvisory": {"transitFare": {"currencyCode": "INR", "units": "40", "nanos": 500000000}}}
            return httpx.Response(200, json={"routes": [route]})

        with patch.dict(os.environ, {"GOOGLE_ROUTES_API_KEY": "example"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
                result = await transit(client, "Central Bus Station", "Airport", timestamp, True, ())
        route = result["options"][0]
        self.assertEqual(route["price"], {"amount": 40.5, "currency": "INR"})
        self.assertEqual(route["legs"][0]["board"]["name"], "Central Bus Station")
        self.assertEqual(route["legs"][0]["service"], "A1")

    async def test_flights_return_airport_terminals_and_group_price(self):
        travel_date = (datetime.now(timezone.utc) + timedelta(days=2)).date()

        def reply(request):
            if request.method == "POST":
                return httpx.Response(200, json={"access_token": "example-token"})
            self.assertEqual(request.url.params["adults"], "2")
            segment = {"departure": {"iataCode": "HYD", "terminal": "1", "at": f"{travel_date}T07:00:00"},
                       "arrival": {"iataCode": "GOI", "at": f"{travel_date}T08:30:00"},
                       "carrierCode": "XX", "number": "102"}
            return httpx.Response(200, json={"data": [{"itineraries": [{"duration": "PT1H30M", "segments": [segment]}],
                                                      "price": {"currency": "INR", "grandTotal": "11500.00"}}]})

        with patch.dict(os.environ, {"AMADEUS_CLIENT_ID": "example", "AMADEUS_CLIENT_SECRET": "example"}):
            async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
                result = await flights(client, "Hyderabad (HYD)", "GOI", travel_date, 2)
        offer = result["options"][0]
        self.assertTrue(offer["partyTotal"])
        self.assertEqual(offer["price"]["amount"], "11500.00")
        self.assertEqual(offer["legs"][0]["board"]["terminal"], "1")
