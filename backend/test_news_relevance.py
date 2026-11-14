import unittest

from .news import travel_group, travel_relevant


class NewsRelevanceTest(unittest.TestCase):
    def test_political_and_crime_news_is_dropped_unless_it_disrupts_travel(self):
        self.assertIsNone(travel_group("Minister inaugurates new airport terminal wing ahead of elections"))
        self.assertIsNone(travel_group("Police arrest two after murder near tourist spot"))
        self.assertEqual(travel_group("Opposition party calls statewide bandh on Friday"), "Disruptions")
        self.assertEqual(travel_group("Metro services extended till midnight for festival"), "Getting around")
        self.assertIsNone(travel_group("Sensex closes higher on banking gains"))

    def test_disruptions_lead_and_each_story_says_what_to_do(self):
        stories = travel_relevant([
            {"title": "Goa Carnival parade dates announced", "date": "2026-11-12"},
            {"title": "Ferry services suspended due to rough sea", "date": "2026-11-10"},
            {"title": "Chief minister meets industry leaders", "date": "2026-11-13"},
        ])
        self.assertEqual([item["travelImpact"]["group"] for item in stories], ["Disruptions", "Events and culture"])
        self.assertIn("official notices", stories[0]["travelImpact"]["advice"])


if __name__ == "__main__":
    unittest.main()
