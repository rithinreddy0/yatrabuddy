"""Extract trip preferences and rank sourced places without a model call."""

import re
from datetime import date
from unicodedata import normalize
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException

from .nearby import WorldwideSelection, distance_metres, prepare_draft


DESTINATION_END = (
    r"(?=\s+(?:from|for|with|under|on|starting|budget|leaving|departing)\b"
    r"|\s+\d[\d,]*\s*[- ]?\s*(?:days?|nights?|people|members?|travellers?|travelers?|adults?|friends?)\b"
    r"|\s+\d{4}-\d{2}-\d{2}\b|[,;.!?](?:\s*\d|$)|$)"
)
DESTINATION = re.compile(
    r"\b(?:trip|holiday|vacation|itinerary|weekend|travel|visit)\s+(?:to\s+|in\s+|for\s+)?"
    r"([\w][\w .'’,-]{1,95}?)" + DESTINATION_END,
    re.I,
)
IN_DESTINATION = re.compile(r"\b\d+\s*[- ]?days?\s+(?:in|at)\s+([\w][\w .'’,-]{1,95}?)" + DESTINATION_END, re.I)
INTERESTS = {
    "Nature": r"\b(?:beaches?|parks?|nature|wildlife|gardens?|waterfalls?)\b",
    "Culture": r"\b(?:culture|heritage|museums?|history|architecture|temples?)\b",
    "Food": r"\b(?:food|restaurants?|caf[eé]s?|cuisine|markets?)\b",
    "Adventure": r"\b(?:adventure|treks?|hiking|kayak\w*|surf\w*)\b",
}
PLACE_TYPES = {
    "Nature": {"Nature"}, "Culture": {"Sight", "Shopping"},
    "Food": {"Food", "Shopping"}, "Adventure": {"Activity", "Nature"},
    "Relaxation": {"Nature"}, "Shopping": {"Shopping"}, "Arts & design": {"Sight"}, "Nightlife": {"Activity", "Food"},
}
PACE_CAPACITY = {"Relaxed": 2, "Balanced": 3, "Packed": 4}
MONTHS = "january february march april may june july august september october november december".split()
MONTH_PATTERN = "|".join(f"{name[:3]}(?:{name[3:]})?" if len(name) > 3 else name for name in MONTHS)
WRITTEN_DATE = re.compile(rf"\b(?:(\d{{1,2}})(?:st|nd|rd|th)?\s+({MONTH_PATTERN})|({MONTH_PATTERN})\s+(\d{{1,2}})(?:st|nd|rd|th)?)(?:,?\s+(\d{{4}}))?\b", re.I)


def trip_dates(text, today):
    dates = [date.fromisoformat(value) for value in re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text)]
    if not dates and (written := WRITTEN_DATE.search(text)):
        first_day, first_month, second_month, second_day, year = written.groups()
        day, month = int(first_day or second_day), next(i for i, name in enumerate(MONTHS, 1) if name.startswith((first_month or second_month).lower()[:3]))
        travel_date = date(int(year) if year else today.year, month, day)
        if not year and travel_date < today:
            travel_date = date(today.year + 1, month, day)
        dates.append(travel_date)
    if dates and dates[0] < today:
        raise ValueError("Choose a departure date today or later.")
    if len(dates) == 2 and not 0 <= (dates[1] - dates[0]).days <= 4:
        raise ValueError("Choose an end date on or after departure, up to five days in total.")
    return dates


def next_intake_question(intake):
    prompts = (
        ("destination", bool(intake.get("destination")), "Where would you like to go?", []),
        ("date", bool(intake.get("date") or intake.get("flexibleDates")), "When would you like to travel? Give a date or date range, or choose flexible dates.", ["Flexible dates"]),
        ("days", bool(intake.get("days")), "How many days should I plan? Choose 1–5 days.", ["2 days", "3 days", "5 days"]),
        ("people", bool(intake.get("people")), "How many people are traveling?", ["1 traveler", "2 travelers", "3 travelers"]),
        ("origin", bool(intake.get("origin") or intake.get("localStart")), "Where are you leaving from? Tell me the departure city, or start the itinerary at your destination.", ["Start at the destination"]),
        ("budget", bool(intake.get("budget") or intake.get("budgetOpen")), "What total budget should I plan around in INR? You can also leave it undecided.", ["Budget undecided"]),
    )
    return next(({"field": field, "prompt": prompt, "choices": choices} for field, known, prompt, choices in prompts if not known), None)


def update_intake(text, previous, profile, parsed):
    result = {**(previous or {})}
    if profile:
        for field in ("pace", "diet", "interests", "mobility", "transport", "stayPreferences", "travelGroup", "notes"):
            if profile.get(field) and field not in result:
                result[field] = profile[field]
        if profile.get("homeCity") and "origin" not in result:
            result["origin"] = profile["homeCity"]
    if match := (IN_DESTINATION.search(text) or DESTINATION.search(text)):
        destination = match[1].strip(" ,.-")
        destination = re.sub(r"^\d+\s+days?\s+(?:to|in)\s+", "", destination, flags=re.I)
        if not re.match(r"^(?:me\b|please\b|a |an |the |my |days?\b|\d|is\b|with\b|for\b|on\b|to\b)", destination, re.I):
            if destination.casefold() != (result.get("destination") or "").casefold():
                result.pop("location", None)
            result["destination"] = destination
    if parsed.get("replace_destination"):
        if parsed["replace_destination"].casefold() != (result.get("destination") or "").casefold():
            result.pop("location", None)
        result["destination"] = parsed["replace_destination"]
    elif not result.get("destination") and parsed.get("destination_name"):
        result["destination"] = parsed["destination_name"]
    if re.fullmatch(r"\s*\d+\s*", text):
        for field, lower, upper in (("days", 1, 5), ("people", 1, 8), ("budget", 1000, 10_000_000)):
            if not result.get(field):
                value = int(text)
                if lower <= value <= upper:
                    parsed[field] = value
                break
    for field, lower, upper in (("days", 1, 5), ("people", 1, 8), ("budget", 1000, 10_000_000)):
        if lower <= parsed.get(field, 0) <= upper:
            result[field] = parsed[field]
    if parsed.get("origin") and (parsed.get("bare_origin") or re.search(r"\bfrom\s", text, re.I) or re.match(r"^[\w .'’-]+\s+to\s+", text, re.I)):
        result["origin"] = parsed["origin"]
    dates = trip_dates(text, date.today())
    if dates:
        result["date"] = dates[0].isoformat()
        result.pop("flexibleDates", None)
        if len(dates) == 2:
            result.update(endDate=dates[1].isoformat(), days=(dates[1] - dates[0]).days + 1)
        else:
            result.pop("endDate", None)
    elif re.search(r"\bflexible dates\b", text, re.I):
        result.pop("date", None)
        result.pop("endDate", None)
        result["flexibleDates"] = True
    if re.fullmatch(r"(?:start at the destination|already there|local itinerary)[.! ]*", text.strip(), re.I):
        result.pop("origin", None)
        result["localStart"] = True
    elif result.get("origin"):
        result.pop("localStart", None)
    if re.fullmatch(r"(?:budget undecided|no budget(?: yet)?|skip budget)[.! ]*", text.strip(), re.I):
        result.pop("budget", None)
        result["budgetOpen"] = True
    elif result.get("budget"):
        result.pop("budgetOpen", None)
    if match := re.search(r"\b(\d+) adults?, (\d+) children, (\d+) infants?, (\d+) pets?\b", text, re.I):
        adults, children, infants, pets = map(int, match.groups())
        if 1 <= adults and adults + children + infants <= 8 and pets <= 8:
            result.update(people=adults + children + infants, party=dict(adults=adults, children=children, infants=infants, pets=pets))
    elif parsed.get("people") and result.get("party"):
        result.pop("party")
    if re.search(r"\bnon[- ]?veg(?:etarian)?\b", text, re.I):
        result["diet"] = "Non-vegetarian"
    elif re.search(r"\b(?:no dietary restrictions|no (?:food )?preference|any food)\b", text, re.I):
        result["diet"] = "No preference"
    elif parsed.get("diet"):
        result["diet"] = parsed["diet"]
    if re.search(r"\b(?:packed|fast[- ]paced)\b", text, re.I):
        result["pace"] = "Packed"
    elif re.search(r"\b(?:balanced pace)\b", text, re.I):
        result["pace"] = "Balanced"
    elif parsed.get("pace"):
        result["pace"] = parsed["pace"]
    interests = [name for name, pattern in INTERESTS.items() if re.search(pattern, text, re.I)]
    if interests:
        result["interests"] = list(dict.fromkeys([*interests, *result.get("interests", [])]))[:8]
    if notes := re.match(r"Trip preferences:\s*(.+)", text, re.I | re.S):
        result["notes"] = notes[1].strip()[:500]
    return result


LANDMARK_WORDS = {"abbey", "basilica", "cathedral", "cathédrale", "church", "de", "du", "des",
                  "église", "la", "le", "the", "fort", "palace", "museum", "temple"}


def landmark_words(name, city):
    if not name:
        return set()
    tokens = re.findall(r"[^\W_]+", normalize("NFKC", name).casefold())
    city_tokens = set(re.findall(r"[^\W_]+", normalize("NFKC", city).casefold()))
    return set(tokens) - LANDMARK_WORDS - city_tokens


def same_landmark(left, right, city):
    if left["url"] == right["url"]:
        return True
    if left["category"] != "Sight" or right["category"] != "Sight":
        return False
    if not all(isinstance(place.get(axis), (int, float)) for place in (left, right) for axis in ("lat", "lon")):
        return False
    if distance_metres(left, right) > 110:
        return False
    def article(place):
        path = urlsplit(place["url"])
        return place.get("articleTitle") or (unquote(path.path.split("/wiki/", 1)[1]).replace("_", " ")
                                              if path.hostname == "en.wikipedia.org" and "/wiki/" in path.path else "")

    article_left, article_right = article(left), article(right)
    if article_left and article_right and article_left.casefold() == article_right.casefold():
        return True
    names_left, names_right = landmark_words(left["name"], city), landmark_words(right["name"], city)
    return len(names_left) >= 2 and names_left == names_right


def ranked_places(places, preferences, city=""):
    interests = preferences.get("interests") or []
    categories = set().union(*(PLACE_TYPES.get(interest, set()) for interest in interests))
    diet = preferences.get("diet", "No preference")
    restricted = diet not in {"No restrictions", "No preference", "Non-vegetarian"}
    eligible = [place for place in places if place["category"] != "Stay" and (
        place["category"] != "Food" or not restricted or re.search(
            rf"\b{re.escape(diet)}\b", f"{place['name']} {place.get('description') or ''}", re.I
        )
    )]
    ordered = sorted(eligible, key=lambda place: (
        place["category"] not in categories,
        not bool(place.get("photo")),
        not bool(place.get("description")),
        place.get("distanceMetres") or 0,
    ))
    distinct = []
    for place in ordered:
        if not any(same_landmark(place, previous, city) for previous in distinct):
            distinct.append(place)
    return distinct


async def draft_from_sources(location, places, intake):
    days = intake.get("days") or 2
    pace = intake.get("pace") or "Balanced"
    ranked = ranked_places(places, intake, location["name"])
    stops = [place["url"] for place in ranked[:days * PACE_CAPACITY[pace]]]
    if not stops:
        return None
    stay_terms = {"Hotels": "hotel", "Boutique stays": "boutique", "Resorts": "resort", "Vacation rentals": "apartment", "Hostels": "hostel", "Homestays": "homestay"}
    preferred_stays = [stay_terms[item] for item in intake.get("stayPreferences", []) if item in stay_terms]
    stays = [place for place in places if place["category"] == "Stay" and any(term in f"{place['name']} {place.get('description') or ''}".lower() for term in preferred_stays)]
    selection = WorldwideSelection(
        stops=stops, days=days, departure=intake.get("date"), origin=intake.get("origin"), travelers=intake.get("people") or 1,
        stay=stays[0]["url"] if stays else None,
        budget=intake.get("budget"), pace=pace, interests=(intake.get("interests") or [])[:4], party=intake.get("party"),
        mealPreference="No preference" if intake.get("diet") in {None, "No restrictions"} else intake["diet"],
        mobility=intake.get("mobility"),
        localModes={"Public transit": ["Bus", "Metro"], "Car": ["Cab"], "Walking": ["Walk"]}.get(intake.get("transport"), []),
    )
    try:
        return await prepare_draft(location["id"], selection)
    except HTTPException as error:
        if error.status_code == 422 and selection.stay:
            return await prepare_draft(location["id"], selection.model_copy(update={"stay": None}))
        raise
