"""Answer commands from the current itinerary without a public web lookup."""

import re

from .catalog import DESTINATIONS


def trip_snapshot(draft, request, plan, brief):
    if draft:
        return draft
    if plan:
        brief = plan["brief"]
        return {
            "name": DESTINATIONS[brief["destination"]]["name"],
            "departure": brief.get("date"), "travelers": brief["people"], "budget": brief["budget"],
            "days": [[{"name": name} for name in day["stops"]] for day in plan["days"]],
        }
    return {
        "name": request.get("destination") or DESTINATIONS.get(brief.get("destination"), {}).get("name"),
        "departure": request.get("date") or brief.get("date"),
        "travelers": request.get("people") or brief.get("people"),
        "budget": request.get("budget") or brief.get("budget"),
        "duration": request.get("days") or brief.get("days"),
        "party": request.get("party"),
        "days": [],
    }


def packing_list(trip):
    days = trip["days"]
    duration = len(days) or trip.get("duration")
    stops = [stop["name"] for day in days for stop in day]
    itinerary = " ".join([trip.get("name") or "", *stops])
    heading = "Packing checklist" + (f" for {trip['name']}" if trip.get("name") else "")
    items = [
        "ID and any required travel documents",
        "Tickets, confirmations and offline maps",
        "Phone, charger and power bank",
        f"Clothes and underwear for {duration} {'day' if duration == 1 else 'days'}" if duration else "Clothes and underwear for each travel day",
        "Comfortable shoes, toiletries and a refillable water bottle",
        "Personal medications and a small first-aid kit",
    ]
    forecast = trip.get("weather") or []
    if any((day.get("rainProbability") or 0) >= 50 for day in forecast):
        items.append("Rain jacket or compact umbrella for the forecast rain")
    elif not forecast:
        items.append("Check the forecast before leaving and add rain gear or warm layers as needed")
    if re.search(r"\b(?:beach|coast|varkala|palolem|baga)\b", itinerary, re.I):
        items.append("Swimwear, sun protection and a bag for wet clothes if you plan to swim")
    if re.search(r"\b(?:trek|trail|hiking|waterfall)\b", itinerary, re.I):
        items.append("Grippy shoes and a daypack for trail or waterfall stops")
    if re.search(r"\b(?:temple|mosque|shrine)\b", itinerary, re.I):
        items.append("Clothing that covers shoulders and knees for religious sites where required")
    party = trip.get("party") or {}
    if party.get("infants") or party.get("children"):
        items.append("Children’s snacks, spare clothes and any infant supplies")
    if party.get("pets"):
        items.append("Pet food, water bowl, lead and any required documents")
    return f"### {heading}\n" + "\n".join(f"- [ ] {item}" for item in items)


def summarize_trip(trip):
    if not trip.get("name"):
        return "Which destination should we plan around? I can summarize the route once there’s an itinerary."
    days = trip["days"]
    lines = [f"### Trip to {trip['name']}"]
    if length := len(days) or trip.get("duration"):
        lines.append(f"- Duration: {length} {'day' if length == 1 else 'days'}")
    if people := trip.get("travelers"):
        lines.append(f"- Travellers: {people}")
    if trip.get("departure"):
        lines.append(f"- Departure: {trip['departure']}")
    if trip.get("budget") is not None:
        lines.append(f"- Group budget: ₹{trip['budget']:,}")
    if stay := trip.get("stay"):
        lines.append(f"- Suggested stay: {stay['name']}")
    lines.extend(f"- Day {index}: {', '.join(stop['name'] for stop in day) or 'Free time'}"
                 for index, day in enumerate(days, 1))
    lines.append("### Next steps")
    if days:
        lines.extend(["- Check opening hours and booking prices with the venues.", "- Review your packing checklist."])
    else:
        lines.append("- Finish entering the trip details, then ask me to build the itinerary.")
    return "\n".join(lines)


def summarize_budget(trip, estimated=None, unpriced=()):
    lines = ["### Trip budget"]
    budget = trip.get("budget")
    lines.append(f"- Group target: ₹{budget:,}" if budget is not None else "- Group target: undecided")
    if estimated:
        lines += [f"- {label}: ₹{amount:,} estimated" if label not in unpriced else f"- {label}: price unconfirmed"
                  for label, amount in estimated.items()]
        lines.append("These catalog estimates can differ from current provider prices.")
        return "\n".join(lines)
    if not trip["days"]:
        lines.append("Build an itinerary to review stop costs. Check stays and transport with providers.")
        return "\n".join(lines)
    categories = {"Food": "Food", "Sight": "Activities", "Nature": "Activities", "Activity": "Activities", "Shopping": "Shopping"}
    groups = {"Food": [0, 0], "Activities": [0, 0], "Shopping": [0, 0]}
    costs = trip.get("stopCosts") or {}
    for day in trip["days"]:
        for stop in day:
            totals = groups[categories[stop["category"]]]
            if stop["url"] in costs:
                totals[0] += costs[stop["url"]]
            else:
                totals[1] += 1
    for label, (amount, unpriced) in groups.items():
        lines.append(f"- {label}: ₹{amount:,} entered" + (f", {unpriced} unpriced" if unpriced else ""))
    lines.extend(["- Stays and transport: check provider quotes", f"- Total entered: ₹{sum(costs.values()):,}"])
    return "\n".join(lines)


PHRASES = {
    "hindi": ("नमस्ते", "धन्यवाद", "स्टेशन कहाँ है?", "इसकी कीमत कितनी है?"),
    "malayalam": ("നമസ്കാരം", "നന്ദി", "സ്റ്റേഷൻ എവിടെയാണ്?", "ഇതിന് എത്ര വിലയാണ്?"),
    "tamil": ("வணக்கம்", "நன்றி", "நிலையம் எங்கே உள்ளது?", "இதன் விலை எவ்வளவு?"),
    "french": ("Bonjour", "Merci", "Où est la gare ?", "Combien ça coûte ?"),
    "spanish": ("Hola", "Gracias", "¿Dónde está la estación?", "¿Cuánto cuesta?"),
}


def travel_phrases(language):
    values = PHRASES.get(language.casefold().strip(" .?!"))
    if not values:
        return "Choose a language for common travel phrases: Hindi, Malayalam, Tamil, French, or Spanish. For example, type `/translate Malayalam`."
    labels = ("Hello", "Thank you", "Where is the station?", "How much does this cost?")
    return "### Useful travel phrases\n" + "\n".join(f"- **{label}**: {value}" for label, value in zip(labels, values))


CALCULATOR = """### Trip cost calculator
Enter the total amount you expect to spend in each category. This Python script totals the costs and splits them equally.
```python
from decimal import Decimal

categories = ("Transport", "Stay", "Food", "Activities")
total = sum(Decimal(input(f"{category} cost: ")) for category in categories)
travelers = int(input("Number of travelers: "))
if travelers < 1:
    raise ValueError("Enter at least one traveler.")

print(f"Group total: {total:.2f}")
print(f"Per traveler: {total / travelers:.2f}")
```"""


def command_reply(text, trip, estimated=None, unpriced=()):
    message = " ".join(text.casefold().split())
    command, _, argument = message.partition(" ")
    if command in {"/pack", "/packing"} or re.search(
        r"\b(?:what (?:should|do) (?:i|we) (?:pack|bring)|packing (?:check\s?list|list)|check\s?list (?:for packing|of things to pack))\b", message
    ):
        return packing_list(trip)
    if command in {"/summary", "/summarize"} or re.match(r"^(?:please )?summari[sz]e (?:this|the|my|our) (?:trip|itinerary)\b", message):
        return summarize_trip(trip)
    if command == "/budget" or re.match(r"^(?:please )?break down\b.*\b(?:budget|costs?)\b", message):
        return summarize_budget(trip, estimated, unpriced)
    if command == "/translate":
        return travel_phrases(argument)
    if phrase_request := re.fullmatch(r"translate (?:useful |these )?travel phrases (?:into|to) (.+)", message):
        return travel_phrases(phrase_request[1])
    if command == "/code" or re.match(r"^(?:write|create|make)\b.*\b(?:trip|travel) (?:cost |budget )?calculator\b", message):
        if argument and command == "/code" and not re.fullmatch(r"(?:(?:python|trip|travel|cost|budget|calculator)\s*)+", argument):
            return "The built-in code command creates a Python trip-cost calculator. Use `/code`, or describe another travel script in a regular message."
        return CALCULATOR
    if command.startswith("/") and command not in {"/trip", "/save", "/undo"}:
        return "Try `/trip`, `/summary`, `/budget`, `/pack`, `/translate`, `/code`, `/save`, or `/undo`."
    return None
