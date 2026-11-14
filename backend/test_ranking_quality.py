import unittest

from backend.trip_intake import feature_key, ranked_places


def place(name, category, source="OpenStreetMap", distance=500, **extra):
    slug = name.lower().replace(" ", "-").replace("'", "")
    return {"name": name, "category": category, "source": source, "distanceMetres": distance,
            "url": f"https://example.org/{slug}", "lat": 15.59, "lon": 73.81, **extra}


class RankingQualityTest(unittest.TestCase):
    def test_curated_guide_listings_outrank_bare_map_tags(self):
        ranked = ranked_places([
            place("Mapusa 68 Trees - Stretch 1", "Nature", distance=300),
            place("Basilica of Bom Jesus", "Sight", "Wikivoyage", 15_000,
                  description="Home to the grave of St. Francis Xavier."),
        ], {"days": 2})
        self.assertEqual(ranked[0]["name"], "Basilica of Bom Jesus")
        self.assertIn("Listed in the Wikivoyage guide", ranked[0]["fitReasons"])

    def test_numbered_segments_of_one_feature_are_collapsed(self):
        ranked = ranked_places([
            place("Mapusa 68 Trees - Stretch 1", "Nature"),
            place("Mapusa 68 Trees - Stretch 5", "Nature"),
        ], {"days": 2})
        self.assertEqual(len(ranked), 1)
        self.assertEqual(feature_key("Gate 2"), "")
        self.assertEqual(feature_key("Mapusa Gateway"), "mapusagateway")

    def test_chain_outlets_and_multiplexes_rank_last(self):
        ranked = ranked_places([
            place("Domino's", "Food", distance=50),
            place("Chaatpata Chaat", "Food", distance=90),
            place("INOX - Old GMC", "Activity", "Wikivoyage"),
            place("Miramar Beach", "Nature", "Wikivoyage"),
        ], {"days": 2})
        names = [item["name"] for item in ranked]
        self.assertLess(names.index("Chaatpata Chaat"), names.index("Domino's"))
        self.assertLess(names.index("Miramar Beach"), names.index("INOX - Old GMC"))

    def test_far_stops_are_labelled_as_day_trips(self):
        ranked = ranked_places([place("Karai Garden", "Nature", "Wikivoyage", 37_000)], {"days": 1})
        self.assertIn("A day trip from your base (37 km)", ranked[0]["fitReasons"])


class PlaceIntentTest(unittest.TestCase):
    def category(self, text):
        from backend.planning_agent import travel_question
        result = travel_question(text, {}, public_only=True, active_destination="Mapusa")
        return result[1][1] if result and result[0] == "Place search" else None

    def test_everyday_words_for_accommodation_are_understood(self):
        for text in ("Find stays near Calangute beach", "find homestays in Munnar", "any accommodation near Baga"):
            self.assertEqual(self.category(text), "stays", text)

    def test_the_first_named_category_is_the_subject(self):
        self.assertEqual(self.category("show restaurants near the hotel in Goa"), "food")
        self.assertEqual(self.category("find beaches near Mapusa"), "attractions")


if __name__ == "__main__":
    unittest.main()


class MealPlacementTest(unittest.TestCase):
    def test_distant_sight_cluster_gets_a_meal_nearby(self):
        from .trip_intake import pick_meals, sight_clusters

        base = {"lat": 15.59, "lon": 73.81}  # Mapusa
        old_goa = {"name": "Basilica of Bom Jesus", "lat": 15.5009, "lon": 73.9116}
        colva = {"name": "Colva Beach", "lat": 15.2799, "lon": 73.9220}
        near_base = {"name": "Mapusa Market", "lat": 15.592, "lon": 73.812}
        town_cafe = {"name": "Town cafe", "lat": 15.591, "lon": 73.811}
        old_goa_lunch = {"name": "Old Goa lunch", "lat": 15.503, "lon": 73.909}
        self.assertEqual([item["name"] for item in sight_clusters([old_goa, colva, near_base], base)],
                         ["Colva Beach", "Basilica of Bom Jesus"])
        meals = pick_meals([town_cafe, old_goa_lunch], [old_goa, near_base], base, 2)
        self.assertEqual(meals[0]["name"], "Old Goa lunch")
        self.assertEqual(len(meals), 2)
        self.assertEqual(pick_meals([town_cafe], [near_base], base, 1), [town_cafe])
        self.assertEqual(pick_meals([town_cafe], [old_goa], base, 0), [])
