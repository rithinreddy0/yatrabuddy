"""Public transport and hotel searches, with booking on the provider's site."""

import re
from datetime import date as Date, timedelta
from math import ceil
from urllib.parse import quote, urlencode

from fastapi import APIRouter, HTTPException, Query

from .catalog import CATALOG
from .place_search import public_url


router = APIRouter(prefix="/api")
MODE_WORDS = {
    "flight": r"flights?|fly|flying|airfare|planes?|airlines?|indigo",
    "rail": r"trains?|rail(?:ways?)?|irctc|ixigo",
    "bus": r"bus(?:es)?|coaches|redbus|abhibus|flixbus",
    "ride": r"uber|rapido|ola|lyft|cabs?|taxis?|ride[- ]?hail(?:ing)?|rickshaws?|autos?",
    "transit": r"metros?|subway|public (?:transport(?:ation)?|transit)|local (?:transport(?:ation)?|transit)|bus passes?|day passes?",
    "ferry": r"ferr(?:y|ies)|water taxis?|water buses",
    "cruise": r"cruises?|cruising|cordelia",
    "drive": r"driv(?:e|ing)|road trip|self[- ]drive|car rental",
}
MODE_NAMES = {
    "flight": "Flights", "rail": "Rail", "bus": "Intercity bus", "ride": "Ride-hail",
    "transit": "Public transit", "ferry": "Ferry", "cruise": "Cruise", "drive": "Driving",
}
PLACE = r"[\w][\w .’',&()/-]{0,99}?"
PLACE_END = (
    r"(?=\s+(?:from|on|for|with|under|at|by|via|using|tomorrow|today|next|this|"
    r"and (?:show|check|find|compare|book)|check|compare|including|prices?|reviews?|rates?|fares?)"
    r"\b|[,;][ ]+(?=\d)|[.!?;]?(?:\s*$))"
)
INDIA_NAMES = {
    "ahmedabad", "amritsar", "agra", "bangalore", "bengaluru", "bhopal", "bhubaneswar", "bhuj",
    "chandigarh", "chennai", "cochin", "coimbatore", "delhi", "dharamshala", "ernakulam",
    "gangtok", "goa", "guwahati", "hyderabad", "indore", "jaipur", "jodhpur", "kashmir", "kerala",
    "kochi", "kolkata", "kutch", "leh", "lucknow", "madurai", "mandrem", "mangalore", "margao",
    "mumbai", "mysore", "mysuru", "nagpur", "nashik", "new delhi", "noida", "palolem", "panaji",
    "panjim", "patna", "pondicherry", "puducherry", "pune", "raipur", "rishikesh", "secunderabad", "shimla",
    "srinagar", "surat", "thiruvananthapuram", "trivandrum", "udaipur", "vadodara", "varanasi",
    "varkala", "visakhapatnam", "vizag", "betim", "chorao", "divar", "ribandar", "old goa",
}
INDIA_REGIONS = {
    "andhra pradesh", "assam", "bihar", "chhattisgarh", "delhi", "goa", "gujarat", "haryana",
    "himachal pradesh", "india", "jammu and kashmir", "jharkhand", "karnataka", "kerala", "ladakh",
    "madhya pradesh", "maharashtra", "odisha", "punjab", "rajasthan", "sikkim", "tamil nadu",
    "telangana", "uttar pradesh", "uttarakhand", "west bengal",
}
GOA_NAMES = {"goa", "panaji", "panjim", "palolem", "mandrem", "betim", "chorao", "divar", "ribandar", "old goa"}
CATALOG_NAMES = {place["id"]: place["name"] for place in CATALOG}
ROME2RIO_HELP = "https://help.rome2rio.com/en/support/solutions/articles/22000282689-how-to-find-tickets-on-rome2rio"
MAPS_HELP = "https://developers.google.com/maps/documentation/urls/get-started"
UBER_PRICE = "https://www.uber.com/global/en/price-estimate/"
BOOKING_REVIEWS = "https://www.booking.com/reviews_guidelines.html"
GOA_FERRY = "https://rnd.goa.gov.in/ferry-routes/"


def _text(value):
    return " ".join(str(value or "").split())[:120].strip(" ,;?!")


def _place(value):
    name = _text(value)
    if not re.search(r"[^\W\d_]", name) or name.casefold() in {"here", "there", "my trip", "my destination", "the destination", "get there"}:
        return None
    return CATALOG_NAMES.get(name, name)


def _matching_location(place, location):
    return location and _base(place) == _base(location.get("name"))


def _base(place):
    return _text(place).partition(",")[0].strip().casefold()


def _query(base, **params):
    return base + "?" + urlencode({key: value for key, value in params.items() if value not in (None, "")})


def _date(value):
    try:
        return Date.fromisoformat(str(value))
    except ValueError:
        return None


def _positive_int(value, upper):
    return value if type(value) is int and 1 <= value <= upper else None


def _india(place, country=None):
    first, comma, qualifier = _text(place).casefold().partition(",")
    if country:
        return country.casefold() in {"in", "india"}
    if comma:
        return bool({part.strip() for part in qualifier.split(",")} & INDIA_REGIONS)
    return first in INDIA_NAMES


def _goa(place, location):
    if _matching_location(place, location) and location.get("country") not in {None, "India"}:
        return False
    name = _text(place).casefold()
    return _base(name) in GOA_NAMES or "goa" in {part.strip() for part in name.split(",")[1:]}


def source_intent(message):
    """Recognize a quote, review, or transport question outside itinerary creation."""
    text = " ".join(message.split()).strip()
    if not text or re.match(r"^(?:please\s+)?(?:plan|build|create|make|draft|change|add|remove|replace)\b", text, re.I):
        return None
    if re.search(r"\b(?:things to do|places to (?:see|visit)|what to (?:see|do))\b", text, re.I):
        return None
    requested = [
        mode for mode, words in MODE_WORDS.items()
        if re.search(rf"(?<![\w-])(?:{words})(?![\w-])", text, re.I)
    ]
    getting_there = bool(re.search(
        r"\b(?:transport(?:ation)?|(?:how|ways?) (?:do|can|should|to) (?:i |we )?(?:get|go|travel)"
        r"|(?:getting|travel) (?:there|from|to)|(?:get|go) from|getting around|get around)\b", text, re.I
    ))
    local = bool(re.search(
        r"\b(?:getting around|get around|local transport(?:ation)?|public transport(?:ation)?|public transit|metro|commut\w+|(?:one[- ]day|day|transit|travel|bus|metro) pass(?:es)?)\b",
        text, re.I,
    ))
    stay = bool(
        re.search(r"\b(?:hotels?|stays?|hostels?|resorts?|accommodations?|guest ?houses?|rooms?)\b", text, re.I)
        and re.search(r"\b(?:how much|what do .* cost|prices?|fares?|rates?|quotes?|availability|available|reviews?|ratings?|book(?:ing)?|compare)\b", text, re.I)
    )
    if not stay and re.search(
        r"\b(?:train (?:staff|employees|for)|(?:railway|train) museums?|"
        r"(?:eat|food|restaurants?|cafes?|sights?|things to do|visit|attractions?)\b.{0,55}"
        r"\b(?:near|around|at)\b.{0,35}\b(?:train station|airport|bus stop|bus station|ferry terminal))\b",
        text, re.I,
    ):
        return None
    pair = None if stay else re.search(rf"\bfrom\s+({PLACE})\s+(?:to|→)\s+({PLACE}){PLACE_END}", text, re.I)
    origin = _place(pair[1]) if pair else None
    destination = _place(pair[2]) if pair else None
    bare_pair = None
    if not pair and not stay:
        start = re.sub(r"^(?:(?:please|compare|find|show|check|search|cheapest|cheap|book)\s+)+", "", text, flags=re.I)
        for words in MODE_WORDS.values():
            start = re.sub(rf"^(?:{words})\s+(?:(?:options|tickets)\s+)?", "", start, flags=re.I)
        bare_pair = re.match(rf"^(?:between\s+)?({PLACE})\s+(?:to|→)\s+({PLACE}){PLACE_END}", start, re.I)
        if not bare_pair:
            bare_pair = re.match(rf"^between\s+({PLACE})\s+and\s+({PLACE}){PLACE_END}", start, re.I)
        if bare_pair and not re.search(
            r"\b(?:how|what|when|where|which|should|want|need|ways?|options?|have|going|get|go|book|travel|"
            r"plan|ticket|convert|between|from|and|for)\b", bare_pair[1], re.I
        ):
            origin, destination = _place(bare_pair[1]), _place(bare_pair[2])
        if not origin and (requested or getting_there):
            reverse = re.match(rf"^({PLACE})\s+from\s+({PLACE}){PLACE_END}", start, re.I)
            if reverse and not re.search(r"\b(?:how|what|when|where|which|go|get|travel|to|fares?|tickets?)\b", reverse[1], re.I):
                destination, origin = _place(reverse[1]), _place(reverse[2])
            elif match := re.search(rf"\bfrom\s+({PLACE}){PLACE_END}", text, re.I):
                origin = _place(match[1])
    if not destination and (stay or requested or local or getting_there):
        prepositions = r"in|near|around" if stay else r"in|near|around|for|within|to"
        arrival = None if stay else re.search(rf"\b(?:get|go|travel|flying|fly)\s+(to)\s+({PLACE}){PLACE_END}", text, re.I)
        if location := arrival or re.search(rf"\b({prepositions})\s+({PLACE}){PLACE_END}", text, re.I):
            destination = _place(location[2])
            if destination and not stay and not origin and location[1].casefold() in {"in", "around", "within"} and set(requested) <= {"ride", "transit", "bus", "drive", "ferry", "cruise"}:
                local = True
    transport = bool(requested or local or getting_there or (bare_pair and origin and destination))
    if not transport and not stay:
        return None
    if local:
        requested = list(dict.fromkeys("transit" if mode == "bus" else mode for mode in requested))
    hotel = None
    if stay:
        name = re.search(
            rf"\b(?:reviews?|ratings?|rates?|prices?|availability)\s+(?:for|of|at)\s+({PLACE})"
            r"(?=\s+(?:in|near|around|on|for|with|under)\b|[?!]?(?:\s*$))", text, re.I,
        )
        if not name:
            name = re.search(
                rf"^(?:show |check |find )?({PLACE})\s+(?:reviews?|ratings?|rates?|prices?)"
                r"(?=\s+(?:in|near|around|on|for|with|under)\b|[?!]?(?:\s*$))", text, re.I,
            )
        if name and not re.fullmatch(
            r"(?:(?:a|the|my|some|live|current|latest) )?(?:hotels?|resorts?|hostels?|rooms?|stays?)", name[1], re.I
        ):
            hotel = _place(name[1])
    dates = [value for token in re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text) if (value := _date(token))]
    travelers = re.search(r"\b([1-9]\d?)\s+(?:adults?|travell?ers?|people|passengers?|guests?)\b", text, re.I)
    nights = re.search(r"\b([1-9]\d?)\s+nights?\b", text, re.I)
    return {
        "kind": "stay" if stay else "transport", "mode": requested[0] if len(requested) == 1 else None,
        "modes": requested, "origin": origin, "destination": destination, "hotel": hotel, "local": local,
        "date": dates[0].isoformat() if dates else None,
        "checkout": dates[1].isoformat() if len(dates) == 2 and dates[0] < dates[1] else None,
        "travelers": int(travelers[1]) if travelers else None, "nights": int(nights[1]) if nights else None,
    }


def _provider(name, mode, url, source_url, summary, action=None):
    return {
        "name": name, "mode": MODE_NAMES.get(mode, mode), "url": url, "sourceUrl": source_url,
        "summary": summary, "action": action or f"Open {name}",
    }


def _slug(name):
    return quote(re.sub(r"[^\w]+", "-", name, flags=re.UNICODE).strip("-"), safe="")


def _rome_place(place):
    return _slug("Goa, India" if _text(place).casefold() == "goa" else place)


def _google_maps(origin=None, destination=None, travelmode=None, query=None):
    if query:
        return _query("https://www.google.com/maps/search/", api=1, query=query)
    return _query("https://www.google.com/maps/dir/", api=1, origin=origin,
                  destination=destination, travelmode=travelmode)


def _flight_link(origin, destination):
    # Google Flights city landing pages use provider-specific names and may not
    # exist for smaller destinations. Use the search form for other routes.
    aliases = {"delhi": "new-delhi", "new delhi": "new-delhi", "cochin": "kochi"}
    endpoints = tuple(aliases.get(_base(place), _slug(_base(place))) for place in (origin, destination))
    if endpoints in {("hyderabad", "goa"), ("new-delhi", "kochi")}:
        return f"https://www.google.com/travel/flights/flights-from-{endpoints[0]}-to-{endpoints[1]}.html"
    return "https://www.google.com/travel/flights"


def transport_sources(origin, destination, *, date=None, travelers=None, days=None, mode=None,
                      country_code=None, origin_country_code=None, destination_location=None, local=False):
    """Build quote and schedule links from an identified route or city."""
    origin, destination = _place(origin), _place(destination)
    departure = _date(date)
    travelers = _positive_int(travelers, 99)
    destination_country = country_code or (
        destination_location.get("country_code") or destination_location.get("country")
        if _matching_location(destination, destination_location) else None
    )
    destination_india = _india(destination, destination_country)
    origin_india = _india(origin, origin_country_code)
    domestic_india = bool(destination_india and (not origin or origin_india))
    requested = [mode] if isinstance(mode, str) else list(mode or [])
    requested = list(dict.fromkeys(item for item in requested if item in MODE_NAMES))
    if local or (origin and destination and origin.casefold() == destination.casefold()):
        local = True
        requested = list(dict.fromkeys("transit" if item == "bus" else item for item in requested))
    intercity = bool(origin and destination and not local)
    if not requested:
        requested = ["ride", "transit"] if local else ["flight", "rail", "bus"]
        if local and _goa(destination, destination_location):
            requested.append("ferry")
    all_modes = len(requested) > 1
    route = " → ".join((origin, destination)) if origin and destination and origin != destination else destination or origin
    providers = []
    notes = []

    if intercity and any(item in requested for item in ("flight", "rail", "bus", "ferry", "drive")):
        url = f"https://www.rome2rio.com/s/{_rome_place(origin)}/{_rome_place(destination)}"
        providers.append(_provider(
            "Rome2Rio", "Route comparison", url, ROME2RIO_HELP,
            "Compare routes, door-to-door travel times and operators. Treat its price ranges as estimates.",
            "Compare this route",
        ))
    if "flight" in requested:
        providers.append(_provider(
            "Google Flights", "flight", _flight_link(origin, destination),
            "https://support.google.com/travel/answer/2475306",
            "Set the date and passenger count, then compare fares, airports and stops.", "Compare flights",
        ))
        if domestic_india and not all_modes:
            providers.append(_provider(
                "IndiGo", "flight", "https://www.goindigo.in/fare-calendar.html",
                "https://www.goindigo.in/information/how-to-book.html",
                "Check its fare calendar and confirm baggage and change terms with the airline.",
            ))
    if "rail" in requested:
        if domestic_india:
            providers.append(_provider(
                "IRCTC", "rail", "https://www.irctc.co.in/eticket/train-search",
                "https://contents.irctc.co.in/en/bookEticket.html",
                "Select the stations, departure date and class to see the fare and reservation status.", "Check train seats",
            ))
            if not all_modes:
                providers.append(_provider(
                    "ixigo", "rail", "https://www.ixigo.com/trains", "https://www.ixigo.com/trains",
                    "Compare Indian Railways schedules, fares and availability by class.",
                ))
        else:
            providers.append(_provider(
                "Omio", "rail", "https://www.omio.com/trains", "https://www.omio.com/",
                "Enter the stations and travel date to compare fares where covered.", "Search trains",
            ))
    if "bus" in requested:
        if domestic_india:
            providers.append(_provider(
                "redBus", "bus", "https://www.redbus.in/", "https://www.redbus.in/",
                "Enter your cities and date, then compare operators, pickup points and seat types.", "Search buses",
            ))
            if not all_modes:
                providers.append(_provider(
                    "AbhiBus", "bus", "https://www.abhibus.com/", "https://www.abhibus.com/",
                    "Compare available coaches and boarding points for the same date.",
                ))
        else:
            providers.append(_provider(
                "Omio", "bus", "https://www.omio.com/buses", "https://www.omio.com/",
                "Look up intercity coaches and verify the boarding point and luggage allowance.", "Search coaches",
            ))
    if "ride" in requested:
        providers.append(_provider(
            "Uber", "ride", UBER_PRICE, UBER_PRICE,
            "Enter the exact pickup and drop-off to compare ride types and fares where available.", "Check Uber prices",
        ))
        if domestic_india:
            rapido = "https://rapido.bike/Hyderabad/main-page" if _base(destination) == "hyderabad" else "https://www.rapido.bike/"
            providers.append(_provider(
                "Rapido", "ride", rapido, rapido,
                "Check the app for bike taxi, auto and cab options at your pickup point.", "Check Rapido options",
            ))
    if "transit" in requested:
        providers.append(_provider(
            "Google Maps", "transit", _google_maps(origin, destination, "transit") if origin else
            _google_maps(query=f"public transit in {destination}" if destination else "public transit"),
            MAPS_HELP, "Compare transit routes, transfers and walking legs where transit data is available.", "View public transit",
        ))
        if _base(destination) in {"hyderabad", "secunderabad"} and destination_india:
            providers.append(_provider(
                "Hyderabad Metro", "transit", "https://ltmetro.com/fare-ticketing/",
                "https://ltmetro.com/plan-your-trip/",
                "Choose both stations to see the published fare and journey time.", "Check metro fares",
            ))
    if "drive" in requested:
        providers.append(_provider(
            "Google Maps", "drive", _google_maps(origin, destination, "driving"),
            MAPS_HELP, "Compare road routes and journey times. Check tolls, parking and any rental fees separately.", "View road routes",
        ))
    if "ferry" in requested:
        if _goa(destination, destination_location) and (not origin or _goa(origin, None)):
            direct = {_base(origin), _base(destination)} in ({"panaji", "betim"}, {"panjim", "betim"})
            url = "https://rnd.goa.gov.in/panaji-betim/" if direct else GOA_FERRY
            providers.append(_provider(
                "Goa River Navigation", "ferry", url, GOA_FERRY,
                "Check published river ferry routes, departure times and vehicle fares.", "View Goa ferry schedules",
            ))
        else:
            providers.append(_provider(
                "Direct Ferries", "ferry", "https://www.directferries.com/", "https://www.directferries.com/",
                "Search by port and date, then compare schedules and passenger or vehicle tickets.", "Search ferry crossings",
            ))
    if "cruise" in requested:
        if _goa(destination, destination_location) and (not origin or _goa(origin, None)):
            providers.append(_provider(
                "Goa Tourism", "cruise", "https://bookings.goa-tourism.com/Appln/UIL/ActivitiesHome?__Mode=AC010",
                "https://goa-tourism.com/booking/evening_cruises/",
                "Check Mandovi River cruise departures from Panaji and the ticket inclusions.", "View river cruises",
            ))
        if domestic_india or origin_india or not route:
            providers.append(_provider(
                "Cordelia Cruises", "cruise", "https://www.cordeliacruises.com/routes", "https://www.cordeliacruises.com/routes",
                "Compare sailing dates, departure ports, cabin types and inclusions.", "Find cruise sailings",
            ))
        if not any(item["mode"] == "Cruise" for item in providers):
            providers.append(_provider(
                "Cruise Critic", "cruise", "https://www.cruisecritic.com/cruiseto/",
                "https://www.cruisecritic.com/", "Look up sailings by departure port and dates, then check the cruise line's fare.",
            ))

    if not local and (not origin or not destination) and any(item in requested for item in ("flight", "rail", "bus", "ferry", "drive")):
        notes.append("Add your departure and arrival cities to compare a specific route.")
    if local and "ride" in requested and not origin:
        notes.append("Enter the exact pickup and drop-off to check ride prices.")
    if departure is None and any(item in requested for item in ("flight", "rail", "bus", "ferry", "cruise")):
        notes.append("Choose a travel date on the provider’s site.")
    return {
        "kind": "transport", "title": "Transport sources", "route": route,
        "origin": origin, "destination": destination, "date": departure.isoformat() if departure else None,
        "travelers": travelers, "providers": providers, "notes": notes,
        "detail": "Check the provider for current fares, schedules and availability.",
    }


@router.get("/travel-providers")
async def trip_transport_providers(
    destination: str = Query(min_length=1, max_length=120),
    origin: str | None = Query(default=None, max_length=120),
    country: str | None = Query(default=None, max_length=80),
    departure: Date | None = None,
    travelers: int | None = Query(default=None, ge=1, le=99),
):
    """Return public provider links for the intercity journey and for local travel."""
    if not _place(destination) or (origin is not None and not _place(origin)):
        raise HTTPException(422, "Enter a destination and a valid departure city if known.")
    return {
        "arrival": transport_sources(origin, destination, date=departure, travelers=travelers, country_code=country),
        "local": transport_sources(None, destination, country_code=country, local=True),
    }


def stay_sources(destination, *, date=None, travelers=None, days=None, hotel=None, checkout=None, nights=None,
                 property_url=None):
    destination, hotel = _place(destination), _text(hotel)
    arrival, departure = _date(date), _date(checkout)
    travelers = _positive_int(travelers, 99)
    nights = _positive_int(nights, 30) or max(0, (_positive_int(days, 31) or 1) - 1)
    if arrival and arrival >= Date.today():
        if not departure or departure <= arrival:
            departure = arrival + timedelta(days=nights) if nights and arrival <= Date.max - timedelta(days=nights) else None
    else:
        arrival, departure = None, None
    query = ", ".join(part for part in (hotel, destination) if part)
    booking_url = _query(
        "https://www.booking.com/searchresults.html", ss=query, group_adults=travelers,
        no_rooms=ceil(travelers / 2) if travelers else None,
        **({"checkin": arrival.isoformat(), "checkout": departure.isoformat()} if arrival and departure else {}),
    ) if query else "https://www.booking.com/"
    providers = [
        _provider(
            "Booking.com", "Stays", booking_url, BOOKING_REVIEWS,
            "Compare total rates, cancellation terms and reviews from guests who booked through Booking.com.", "Search rates and guest reviews",
        ),
        _provider(
            "Google Maps", "Reviews", _google_maps(query=query if hotel else f"Hotels in {destination}" if destination else "Hotels"),
            "https://support.google.com/maps/answer/6230175",
            "Check recent reviews and see the property's location before choosing.", "Find hotel reviews",
        ),
    ]
    if hotel and property_url and public_url(property_url):
        providers.append(_provider(
            hotel, "Property", property_url, property_url,
            "Check direct rates, room details and cancellation terms with the property.", "Open property website",
        ))
    notes = []
    if not query:
        notes.append("Add a city, neighbourhood or hotel name to narrow your search.")
    if not (arrival and departure):
        notes.append("Enter check-in and checkout for prices on your dates.")
    return {
        "kind": "stay", "title": "Hotel rates and reviews", "route": query or None,
        "destination": destination, "hotel": hotel or None, "date": arrival.isoformat() if arrival else None,
        "checkout": departure.isoformat() if departure else None, "travelers": travelers, "providers": providers,
        "notes": notes, "detail": "Compare rates for the same dates, guest count and cancellation policy.",
    }
