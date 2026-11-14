import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx

from .transport_quotes import flights, transit


class TransportQuotesTest(unittest.IsolatedAsyncioTestCase):
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
