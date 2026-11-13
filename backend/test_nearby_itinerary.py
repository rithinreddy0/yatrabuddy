from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from .nearby import estimate_day_route, group_draft_stops


class NearbyItineraryTests(IsolatedAsyncioTestCase):
    def test_keeps_neighbourhoods_together_without_dropping_stops(self):
        east = [{"lat": 17.36 + i * 0.001, "lon": 78.47} for i in range(4)]
        west = [{"lat": 17.39 + i * 0.001, "lon": 78.40} for i in range(2)]
        self.assertEqual(group_draft_stops(east + west, 2, east[0], 4), [east, west])
        self.assertEqual(group_draft_stops(west + east, 2, west[0], 4), [west, east[::-1]])

    async def test_route_includes_selected_stay_and_labels_fallback(self):
        stay = {"lat": 17.35, "lon": 78.46}
        stop = {"lat": 17.36, "lon": 78.47}
        with patch("backend.nearby.route_points", new=AsyncMock(return_value=None)) as route:
            legs = await estimate_day_route([stop], stay)
            route.assert_awaited_once_with([stay, stop])
        self.assertEqual(legs[0]["method"], "straight-line")
        self.assertGreater(legs[0]["kilometres"], 0)
