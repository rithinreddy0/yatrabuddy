import unittest
from unittest.mock import AsyncMock, patch

from .planning_agent import revise_stops


def stop(name, lat, lon, category="Sight"):
    return {"name": name, "category": category, "source": "Wikivoyage", "url": f"https://en.wikivoyage.org/wiki/Goa#{name.replace(' ', '_')}",
            "lat": lat, "lon": lon}


class AddStopTest(unittest.IsolatedAsyncioTestCase):
    async def test_add_without_a_day_uses_regional_search_and_nearest_day(self):
        draft = {"id": "00000000-0000-4000-8000-000000000001", "cityId": 1263580, "name": "Mapusa", "updated": 5, "travelers": 2,
                 "days": [[stop("Old Goa church", 15.50, 73.91)], [stop("Calangute", 15.54, 73.76)]], "stopCosts": {}}
        aguada = stop("Fort Aguada", 15.49, 73.77)
        with (patch("backend.planning_agent.nearby_report", new=AsyncMock(return_value={"places": []})),
              patch("backend.planning_agent.lookup_places", new=AsyncMock(return_value={"places": [aguada, stop("Alorna Fort", 15.7, 73.9)]})),
              patch("backend.planning_agent.estimate_day_route", new=AsyncMock(side_effect=lambda day, stay, **_: ([{"minutes": 5, "kilometres": 1.0, "method": "road"}] * (len(day) - 1), [])))):
            revised, answer = await revise_stops(draft, ("add", None, None, "Fort Aguada"), offline=False)
        self.assertEqual(answer, "I added Fort Aguada to day 2.")
        self.assertEqual([place["name"] for place in revised["days"][1]], ["Calangute", "Fort Aguada"])

    async def test_unclear_place_is_not_guessed(self):
        draft = {"id": "00000000-0000-4000-8000-000000000001", "cityId": 1, "name": "Mapusa", "updated": 5, "travelers": 2,
                 "days": [[stop("A", 15.5, 73.9)]], "stopCosts": {}}
        with (patch("backend.planning_agent.nearby_report", new=AsyncMock(return_value={"places": []})),
              patch("backend.planning_agent.lookup_places", new=AsyncMock(return_value={"places": [stop("Fort One", 15.5, 73.8), stop("Fort Two", 15.6, 73.8)]}))):
            revised, answer = await revise_stops(draft, ("add", None, None, "Fort"), offline=False)
        self.assertIsNone(revised)
        self.assertIn("couldn’t identify one verified stop", answer)


if __name__ == "__main__":
    unittest.main()
