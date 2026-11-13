from datetime import date as CalendarDate
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, model_validator

from .catalog import DESTINATIONS, allowed_stop

Destination = Literal["hyderabad", "kerala", "goa", "singapore", "kutch"]
ResearchTopic = Literal["overview", "stays", "routes", "food", "experiences", "events"]
Style = Literal["Balanced", "Nature", "Culture", "Food", "Adventure", "Relaxed"]
Diet = Literal["No restrictions", "Vegetarian", "Vegan", "Jain", "Halal"]
Pace = Literal["Relaxed", "Balanced", "Packed"]
Transport = Literal["Any", "Public transit", "Car", "Bike", "Walking"]
BriefField = Literal["destination", "origin", "date", "days", "people", "budget", "style", "diet", "pace"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Brief(BaseModel):
    destination: Destination
    origin: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    date: CalendarDate | None = None
    days: int = Field(ge=1, le=5)
    people: int = Field(ge=1, le=8)
    budget: int = Field(ge=1000, le=10_000_000)
    style: Style
    diet: Diet = "No restrictions"
    pace: Pace = "Balanced"
    assumed: list[BriefField] = Field(default_factory=list, max_length=9)


class Day(BaseModel):
    relaxed: bool
    stops: list[Short] = Field(max_length=12)


class PlanRequest(Brief):
    selectedStops: list[Short] | None = Field(default=None, max_length=20)
    selectedStay: int = Field(default=0, ge=0, le=2)

    @model_validator(mode="after")
    def validate_selection(self):
        if self.selectedStops is None:
            return self
        names = {place["name"] for place in DESTINATIONS[self.destination]["places"]}
        if len(set(self.selectedStops)) != len(self.selectedStops) or not set(self.selectedStops) <= names:
            raise ValueError("Choose unique stops from this destination.")
        return self


class Finding(BaseModel):
    agent: Short
    title: Annotated[str, StringConstraints(min_length=1, max_length=220)]
    url: HttpUrl
    snippet: Annotated[str, StringConstraints(max_length=350)] = ""
    provider: Short | None = None
    kind: Literal["search", "reference", "news"] = "search"
    publisher: Short | None = None
    publishedAt: Annotated[str, StringConstraints(max_length=40)] | None = None


class AgentRoute(BaseModel):
    id: Short
    name: Short
    price: int = Field(ge=0, le=10_000_000)
    total: int = Field(ge=0, le=10_000_000)
    minutes: int | None = Field(default=None, ge=0)
    buffer: int | None = Field(default=None, ge=0)
    reason: str = Field(default="", max_length=240)
    unpriced: bool = False


class SourcedStay(BaseModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    url: HttpUrl
    source: Short


class Trip(BaseModel):
    id: UUID
    brief: Brief
    days: list[Day] = Field(min_length=1, max_length=5)
    stay: int = Field(ge=0, le=2)
    route: int = Field(ge=0, le=1)
    updated: int = Field(ge=0)
    findings: list[Finding] = Field(default_factory=list, max_length=12)
    agentTransport: int | None = Field(default=None, ge=0, le=10_000_000)
    agentLocal: int | None = Field(default=None, ge=0, le=10_000_000)
    agentFoodAllowance: int | None = Field(default=None, ge=0, le=10_000_000)
    agentRoute: AgentRoute | None = None
    sourcedStay: SourcedStay | None = None

    @model_validator(mode="after")
    def validate_stops(self):
        places = {place["name"]: place for place in DESTINATIONS[self.brief.destination]["places"]}
        if len(self.days) != self.brief.days or any(
            len(set(day.stops)) != len(day.stops) or not set(day.stops) <= places.keys()
            or not all(allowed_stop(places[name], self.brief, index) for name in day.stops)
            for index, day in enumerate(self.days)
        ):
            raise ValueError("A stop conflicts with the destination, travel dates, or food preference.")
        origin = self.brief.origin.casefold()
        local = origin == DESTINATIONS[self.brief.destination]["name"].casefold()
        other_singapore = self.brief.destination == "singapore" and "hyderabad" not in origin
        if self.route and (local or other_singapore):
            raise ValueError("This route is unavailable.")
        return self


class SampleExpense(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=70)]
    amount: int = Field(ge=1, le=1_000_000)
    day: int = Field(ge=0, le=4)


class LibraryDocument(BaseModel):
    trips: list[Trip] = Field(default_factory=list, max_length=75)
    drafts: list["WorldwideDraft"] = Field(default_factory=list, max_length=25)
    saved: list[Destination] = Field(default_factory=list, max_length=5)
    style: Style | Literal[""] = ""
    profile: "TravelProfile | None" = None
    sampleExpenses: list[SampleExpense] = Field(default_factory=list, max_length=100)


class TravelProfile(BaseModel):
    preferredName: Annotated[str, StringConstraints(strip_whitespace=True, max_length=70)] = ""
    homeCity: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""
    travelGroup: Literal["Any", "Solo", "Couple", "Friends", "Family"] = "Any"
    travelers: int = Field(ge=1, le=8)
    tripDays: int = Field(ge=1, le=5)
    budget: int = Field(ge=1000, le=10_000_000)
    style: Style
    interests: list[Literal["Nature", "Culture", "Food", "Adventure", "Relaxation", "Shopping", "Arts & design", "Nightlife"]] = Field(max_length=8)
    stayPreferences: list[Literal["Hotels", "Boutique stays", "Resorts", "Vacation rentals", "Hostels", "Homestays"]] = Field(default_factory=list, max_length=6)
    diet: Diet
    pace: Pace
    transport: Transport
    mobility: Literal["No preference", "Less walking", "Step-free when possible"]
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class LicensedPlacePhoto(BaseModel):
    url: HttpUrl
    sourceUrl: HttpUrl
    license: str = Field(max_length=80)
    licenseUrl: HttpUrl | None = None
    credit: str | None = Field(default=None, max_length=500)


class WorldwidePlace(BaseModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=220)]
    category: Literal["Activity", "Food", "Nature", "Shopping", "Sight", "Stay"]
    source: Literal["Wikipedia", "Wikivoyage", "OpenStreetMap"]
    url: HttpUrl
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    address: str | None = None
    photo: LicensedPlacePhoto | None = None
    description: str | None = Field(default=None, max_length=700)
    website: HttpUrl | None = None
    openingHours: str | None = Field(default=None, max_length=400)
    publishedPrice: str | None = Field(default=None, max_length=280)
    rating: float | None = Field(default=None, ge=0, le=5)
    reviewCount: int | None = Field(default=None, ge=0)
    priceLevel: int | None = Field(default=None, ge=0, le=4)
    fitScore: int | None = Field(default=None, ge=0, le=100)
    fitReasons: list[str] = Field(default_factory=list, max_length=5)


class WorldwideWeatherDay(BaseModel):
    date: CalendarDate
    low: float
    high: float
    code: int = Field(ge=0, le=99)
    rainProbability: int | None = Field(default=None, ge=0, le=100)


LocalMode = Literal["Walk", "Bus", "Metro", "Auto", "Cab"]
MealPreference = Literal["No preference", "Vegetarian", "Non-vegetarian", "Vegan", "Jain", "Halal"]


class WorldwideLeg(BaseModel):
    minutes: int = Field(ge=0)
    kilometres: float = Field(ge=0)
    method: Literal["road", "straight-line"]


class TripParty(BaseModel):
    adults: int = Field(ge=1, le=8)
    children: int = Field(default=0, ge=0, le=7)
    infants: int = Field(default=0, ge=0, le=7)
    pets: int = Field(default=0, ge=0, le=8)

    @model_validator(mode="after")
    def validate_size(self):
        if self.adults + self.children + self.infants > 8:
            raise ValueError("Choose up to eight travelers.")
        return self


class WorldwideDraft(BaseModel):
    id: UUID
    cityId: int = Field(gt=0)
    name: Short
    region: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    origin: Short | None = None
    stay: WorldwidePlace | None = None
    departure: CalendarDate | None = None
    travelers: int = Field(default=1, ge=1, le=8)
    party: TripParty | None = None
    budget: int | None = Field(default=None, ge=1000, le=10_000_000)
    days: list[list[WorldwidePlace]] = Field(min_length=1, max_length=5)
    updated: int = Field(ge=0)
    mealPreference: MealPreference = "No preference"
    localModes: list[LocalMode] = Field(default_factory=list, max_length=5)
    pace: Pace = "Balanced"
    routes: list[list[WorldwideLeg]] = Field(default_factory=list, max_length=5)
    routeGeometry: list[list[tuple[float, float]]] = Field(default_factory=list, max_length=5)
    routeAdvice: str | None = Field(default=None, max_length=600)
    stopCosts: dict[str, int] = Field(default_factory=dict, max_length=25)
    weather: list[WorldwideWeatherDay] = Field(default_factory=list, max_length=5)
    weatherStatus: Literal["not_requested", "ready", "partial", "unavailable"] = "not_requested"
    weatherNote: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def validate_draft(self):
        stops = [stop for day in self.days for stop in day]
        if not 1 <= len(stops) <= 25 or any(len(day) > 5 for day in self.days):
            raise ValueError("A draft needs at least one stop, with up to five stops each day.")
        if (self.stay and self.stay.category != "Stay") or any(stop.category == "Stay" for stop in stops):
            raise ValueError("Choose stays separately from stops.")
        if len({stop.url for stop in stops}) != len(stops):
            raise ValueError("Select each stop only once.")
        if not set(self.stopCosts) <= {str(stop.url) for stop in stops} or any(
            not 0 <= value <= 10_000_000 for value in self.stopCosts.values()
        ):
            raise ValueError("Enter valid group costs for selected stops.")
        if self.routes and (len(self.routes) != len(self.days) or any(
            len(legs) != max(0, len(day) - (0 if self.stay else 1))
            for legs, day in zip(self.routes, self.days)
        )):
            raise ValueError("The travel legs must match the itinerary.")
        if self.routeGeometry and (len(self.routeGeometry) != len(self.days) or any(
            len(line) > 1200 or any(not (-90 <= lat <= 90 and -180 <= lon <= 180) for lat, lon in line)
            for line in self.routeGeometry
        )):
            raise ValueError("The map geometry must match the itinerary.")
        return self


class LibraryUpdate(BaseModel):
    revision: int = Field(ge=0)
    library: LibraryDocument


class ResearchRequest(BaseModel):
    destination: Destination
    topic: ResearchTopic = "overview"
    interest: Literal["Nature", "Culture", "Food", "Adventure"] | None = None
    diet: Diet | None = None
    departure: CalendarDate | None = None
    days: int = Field(default=1, ge=1, le=5)
    query: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)] | None = None
    refresh: bool = False


class RouteRequest(BaseModel):
    destination: Destination
    stops: list[Short] = Field(min_length=2, max_length=12)

    @model_validator(mode="after")
    def validate_route(self):
        names = {place["name"] for place in DESTINATIONS[self.destination]["places"]}
        if len(set(self.stops)) != len(self.stops) or not set(self.stops) <= names:
            raise ValueError("Select two or more different stops from the destination catalog.")
        return self
