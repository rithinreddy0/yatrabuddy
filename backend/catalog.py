import json
from datetime import timedelta
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("catalog.json").read_text(encoding="utf-8"))
DESTINATIONS = {item["id"]: item for item in CATALOG}
STYLES = ("Balanced", "Nature", "Culture", "Food", "Adventure", "Relaxed")
VENUE_HOURS = {
    "Salar Jung Museum": ("https://salarjungmuseum.in/plan-your-visit/", [4]),
    "Chowmahalla Palace": ("https://www.chowmahalla.in/visit/", [4]),
}
for destination in CATALOG:
    for place in destination["places"]:
        if place["name"] in VENUE_HOURS:
            source, closed = VENUE_HOURS[place["name"]]
            place.update(hoursSource=source, closedWeekdays=closed)


def allowed_stop(place, brief, day_index):
    if brief.diet != "No restrictions" and place["theme"] == "Food":
        if brief.diet not in place.get("diet", ()):
            return False
    date = brief.date + timedelta(days=day_index) if brief.date else None
    return not date or date.weekday() not in place.get("closedWeekdays", ())
