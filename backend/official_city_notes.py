"""Short editorial notes from official destination sources."""

NOTES = {
    "delhi": (
        ("Why visit", "pros", "https://www.delhitourism.gov.in/", "Delhi Tourism",
         ["Pair Old Delhi’s markets and Mughal landmarks with New Delhi’s museums and gardens."]),
        ("What to plan around", "cons", "https://environment.delhi.gov.in/environment/ambient-air-quality", "Delhi Department of Environment",
         ["Winter can bring pollution episodes. Check the local AQI before committing to a full day outdoors."]),
        ("Festivals and traditions", "events", "https://delhi.gov.in/page/about-us", "Government of Delhi",
         ["Look for the Qutub Festival and Garden Tourism Festival. Confirm the date and venue for this year."]),
        ("Nature and outdoors", "nature", "https://www.delhitourism.gov.in/", "Delhi Tourism",
         ["Lodhi Garden pairs a park walk with historic tombs."]),
        ("Adventure and activities", "adventure", "https://delhi.gov.in/page/about-us", "Government of Delhi",
         ["Delhi Tourism lists rock climbing and boating. Confirm the venue, opening days and availability."]),
        ("Climate", "weather", "https://delhitourism.gov.in/aboutus/seasons_of_delhi.html", "Delhi Tourism",
         ["Expect hot summers and cool winter mornings. Plan outdoor visits for the cooler part of a hot day."]),
    ),
    "hyderabad": (
        ("Why visit", "pros", "https://tourism.telangana.gov.in/page/hyderabad", "Telangana Tourism",
         ["Start with Charminar in the Old City and set aside a separate visit for Golconda Fort and the Qutb Shahi Tombs."]),
        ("Festivals and traditions", "events", "https://www.tourism.telangana.gov.in/page/festivals-and-fairs", "Telangana Tourism",
         ["Bonalu is celebrated in Hyderabad and Secunderabad. Bathukamma is Telangana’s flower festival; check dates before planning around it."]),
        ("Nature and outdoors", "nature", "https://www.telangana.gov.in/telangana-tourism/", "Government of Telangana",
         ["Try KBR National Park for greenery or Hussain Sagar for a waterfront outing."]),
        ("Adventure and activities", "adventure", "https://tourism.telangana.gov.in/experience/adventure", "Telangana Tourism",
         ["Hyderabad’s granite formations are used for climbing and bouldering. Ask a local operator about beginner sessions."]),
    ),
}


def official_city_notes(location, topic):
    if (location.get("country") or "").casefold() != "india":
        return []
    name = location["name"].casefold()
    if name == "new delhi":
        name = "delhi"
    kinds = {"events": {"events"}, "experiences": {"adventure", "nature"}, "weather": {"weather"}}
    return [{"title": title, "kind": kind, "sourceUrl": url, "source": source,
             "text": points[0], "points": points}
            for title, kind, url, source, points in NOTES.get(name, ())
            if topic == "overview" or kind in kinds.get(topic, ())]
