import unittest

from .trip_transport import airport_rows, station_rows


def feature(osm_id, lat, lon, name, osm_type="N"):
    return {"geometry": {"coordinates": [lon, lat]}, "properties": {"osm_type": osm_type, "osm_id": osm_id, "name": name}}


class HubFilterTest(unittest.TestCase):
    point = {"lat": 15.5946, "lon": 73.8105}

    def test_airports_need_a_code_and_skip_military_fields(self):
        features = [feature(1, 15.73, 73.86, "Manohar", "W"), feature(2, 15.38, 73.83, "Dabolim", "W"),
                    feature(3, 15.6, 73.9, "Air base", "W"), feature(4, 15.65, 73.8, "Airstrip", "W")]
        tags = {("W", 1): {"name": "Manohar International Airport", "iata": "GOX"},
                ("W", 2): {"name": "Goa International Airport", "iata": "GOI"},
                ("W", 3): {"name": "Naval air base", "iata": "XXA", "aerodrome:type": "military"},
                ("W", 4): {"name": "Private strip"}}
        rows = airport_rows(features, tags, self.point)
        self.assertEqual([row["code"] for row in rows], ["GOX", "GOI"])
        self.assertLess(rows[0]["distanceKm"], rows[1]["distanceKm"])

    def test_stations_drop_metro_and_construction_and_list_coded_ones_first(self):
        features = [feature(1, 15.66, 73.87, "Thivim"), feature(2, 15.59, 73.81, "Metro stop"),
                    feature(3, 15.60, 73.81, "New line (u/c)"), feature(4, 15.595, 73.811, "Local halt"),
                    feature(5, 15.48, 73.90, "Karmali")]
        tags = {
            ("N", 1): {"name": "Thivim", "railway": "station", "ref": "THVM", "train": "yes"},
            ("N", 2): {"name": "Metro stop", "railway": "station", "station": "subway"},
            ("N", 3): {"name": "New line (u/c)", "railway": "station"},
            ("N", 4): {"name": "Local halt", "railway": "halt"},
            ("N", 5): {"name": "Karmali", "railway": "station", "railway:ref": "KRMI"},
        }
        rows = station_rows(features, tags, self.point)
        self.assertEqual([row["name"] for row in rows], ["Thivim", "Karmali", "Local halt"])
        self.assertEqual(rows[0]["code"], "THVM")
        self.assertIsNone(rows[2]["code"])


if __name__ == "__main__":
    unittest.main()
