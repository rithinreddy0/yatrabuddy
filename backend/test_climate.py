import unittest
from datetime import date, timedelta

from .climate import best_months, monthly_climate, season_note


def year(temperature, rain):
    """One synthetic year where temperature(month) and rain(month) give each day's values."""
    days, temps, rains = [], [], []
    day = date(2024, 1, 1)
    while day.year == 2024:
        days.append(day.isoformat())
        temps.append(temperature(day.month))
        rains.append(rain(day.month))
        day += timedelta(days=1)
    return days, temps, rains


class ClimateTest(unittest.TestCase):
    def test_monsoon_destination_prefers_dry_mild_months(self):
        # Goa-like: hot April-May, monsoon June-September, pleasant November-February.
        temperature = lambda month: {4: 31, 5: 32}.get(month, 26 if month in (11, 12, 1, 2) else 29)
        rain = lambda month: 25.0 if month in (6, 7, 8, 9) else 0.0
        months = monthly_climate(*year(temperature, rain))
        self.assertEqual(months[6]["rainfall"], 775)
        self.assertEqual(months[6]["wetDays"], 31)
        picks = best_months(months)
        self.assertIn("Dec", picks)
        self.assertNotIn("Jul", picks)
        self.assertNotIn("May", picks)
        note = season_note(months, picks)
        self.assertIn("Heavy rain in Jun, Jul, Aug, Sep", note)
        self.assertIn("Hottest in May", note)

    def test_missing_months_give_no_recommendation(self):
        days, temps, rains = year(lambda month: 22, lambda month: 0.0)
        months = monthly_climate(days[:200], temps[:200], rains[:200])
        self.assertIsNone(months[11]["temperature"])
        self.assertEqual(best_months(months), [])


if __name__ == "__main__":
    unittest.main()
