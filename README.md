# YatraBuddy

YatraBuddy combines worldwide place search, trip drafts, maps, and a conversational travel assistant with linked sources. The React desktop web workspace and FastAPI API run as independent services.

## Local development

Use Node.js 24 and Python 3.12 or newer. Install dependencies from the workspace root.

```powershell
npm.cmd ci
python -m pip install -r backend/requirements.txt
```

Start FastAPI in one terminal and Vite in another.

```powershell
python -m backend.run --reload
```

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:3000. Vite forwards /api to FastAPI at port 8000. API documentation is at http://127.0.0.1:8000/docs. SQLite persists local accounts in data/travel.sqlite3.

Continue with Google to open YatraBuddy. On first sign-in, the app collects travel preferences in a conversation and saves them to the account. Then start on **Home** and choose a city, or ask in the composer. The assistant uses public sources first and asks for missing trip details before building an itinerary. For example, try `Plan a trip to Tamil Nadu 5 days 3 members`, answer the date and other follow-up questions, then choose a starting city. Use **Show map** to open the map alongside the answer; hover or focus a pin to preview the place, or select it for details.

**Research**, **Updates**, **Travel Sources**, **Explore**, **Saved**, and saved trip workspaces show reusable city briefings and relevant source links. City briefings are cached for repeat visits. Updates show publisher photos when the feed supplies them. Place carousels use credited photos, with other listings kept in a separate compact list. Hotel availability and fares must be checked with the providers; budget charts use the costs you enter.

The local API launcher loads the ignored root `.env` without overriding process environment variables. Set `GROQ_API_KEY` there to use GroqCloud for trip chat. Optionally set `GROQ_API_KEY_FALLBACK` to one or more comma-separated backup keys; the app retries with these only when Groq returns a rate-limit response. Groq is the only provider used by default. Set `TRAVEL_CHAT_PROVIDER=gemini` to switch explicitly to the saved Gemini configuration. `GROQ_MODEL` defaults to `openai/gpt-oss-20b`. Never prefix server secrets with `VITE_`; that would expose them in the browser bundle. Restart the API after changing credentials. The existing development preview uses port 3010.

The Travel Profile sets trip length, group size, INR budget, home city, interests, food preferences, pace, transport, and mobility defaults. Users can change the profile or override those defaults for each trip. Guest preferences stay in the browser and registered profiles sync to the API.

## Modules

- `src/features` contains discovery, global city lookup, onboarding, account, research, travel news, provider handoffs, buddy, trip brief, itinerary, map, and library sync components.
- `src/components` contains reusable interface controls.
- `backend/auth.py` contains credential handling, sessions, and request throttling.
- `backend/db.py` contains SQLAlchemy database models and transactions.
- `backend/models.py` contains the validated trip and library contracts.
- `backend/agents.py` contains the planning, destination, transport, experience, stay, food, event, and weather workflows.
- `backend/news.py`, `backend/locations.py`, and `backend/partners.py` contain the news, global city lookup, and partner integrations.
- `backend/catalog.json` contains the initial five curated destinations and itinerary estimates.

## Research and accuracy

The home briefing and research views report source status and retrieval time. Research uses Brave Web Search when `BRAVE_SEARCH_API_KEY` is configured, with Wikimedia and Google News RSS available as fallbacks. Open-Meteo and CAMS provide model-based weather and air quality. Set `ENABLE_WEATHER=0` to disable these feeds. Use a commercial Open-Meteo key and a routing provider of your own for a commercial deployment.

Keyless place search shows licensed Wikimedia Commons thumbnails when an article matches the place and publishes reuse metadata. The result links to the original file, photographer credit when available, and the applicable license.

Optional Crawl4AI extraction adds relevant paragraphs from Wikimedia articles already cited by Travel Buddy. In Docker, set `ENABLE_CRAWL4AI=1` in `.env` and run `docker compose up --build`. For local FastAPI development, install `backend/requirements-crawl.txt` and set `ENABLE_CRAWL4AI=1` in the server environment. The integration checks `robots.txt`, caps article downloads, and falls back to the API sources if extraction times out. It uses Crawl4AI’s HTML parser and requires no browser installation.

Worldwide search uses GeoNames and listings fetched from Wikipedia and Wikivoyage. Availability varies by destination and category. Set `GOOGLE_PLACES_API_KEY` on the API to enable Google Maps results, ratings, review counts, review excerpts, and place price levels where available. Google Maps listings link back to Google Maps. Public-source results can be plotted on the OpenStreetMap view. Live room rates come from the separate date-based Booking.com search when partner access is configured.

For a worldwide trip, choose a city, select available public-source stops and a stay, set the trip details, then build and save. FastAPI validates the selections and groups stops by distance. The draft appears in My trips with source links. Existing curated itineraries continue to use their catalog estimates. The Travel Updates page uses GDELT and a Google News RSS fallback.

## Conversation and voice

Ask Wayfarer and Travel Buddy preserve destination context across follow-up questions. Set `AI_CHAT_COMPLETIONS_URL`, `AI_API_KEY`, and `AI_MODEL` in the API environment for model-generated answers. The endpoint expects a compatible chat completions API. FastAPI retrieves evidence first and validates the answer's citations against that evidence. With no model configuration, the assistant returns sourced results.

In a browser with speech recognition, select **Talk to Travel Buddy** and say “Plan a trip to Kyoto, Japan.” Say “list places,” “select option one,” “two days,” and “build draft.” You can also set a departure date, traveler count, or budget by voice. Reminders live in this browser and appear while the app is open. The browser asks for microphone permission before speech recognition can start.

Set `VOICE_TRANSCRIPTION_URL` and `VOICE_TRANSCRIPTION_MODEL` to enable audio transcription for browsers without working native recognition. The endpoint must accept an OpenAI-compatible multipart transcription request. Set `VOICE_API_KEY` if transcription uses different credentials from chat. The recorded audio is sent only when the user chooses to transcribe it.

## Google sign-in and partner inventory

To send welcome emails for new email/password accounts, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM` on the API. Use a sender address authorized by your mail provider. Port 465 uses implicit TLS and other ports require STARTTLS. Welcome email is informational. Account verification and password recovery are separate flows.

To include Google Maps photos alongside Google Places ratings and reviews, set `ENABLE_GOOGLE_PLACE_PHOTOS=1` with `GOOGLE_PLACES_API_KEY`. The API requests photos for up to six results per page. Google can bill these photo requests separately. Wikimedia photos and public guide descriptions continue to work without these credentials.

Enable Google in Firebase Authentication and add the exact frontend hostname to Firebase's authorized domains. For local sign-in use `localhost` and authorize it in Firebase. Set `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_API_KEY`, and `FIREBASE_WEB_APP_ID` in the API process environment or the Docker Compose `.env` file. The Firebase web configuration is public. FastAPI verifies the identity token and issues an HTTP-only session. Add any custom Firebase Auth domain to the frontend's connect-src and frame-src policy.

The Travel Desk links travelers to provider sites for rail, buses, ride-hailing, and rentals. The Booking.com adapter uses Demand API access when `BOOKING_API_TOKEN` and `BOOKING_AFFILIATE_ID` are set on the API. Otherwise the desk links to a prefilled Booking.com search. The app does not show live inventory or fares for providers that have not supplied access.

## Build and deploy

See the [deployment guide](docs/deployment.md) for GitHub, Vercel, Render, Neon, and Firebase setup. The production deployment requires Google sign-in. Only use `REQUIRE_GOOGLE_SIGN_IN=0` in a dedicated local test environment.

```powershell
npm.cmd run build
python -m unittest backend.test_api
```

For the containerized stack, copy .env.example to .env, set a strong URL-safe PostgreSQL password and provider settings, then run `docker compose up --build`. The frontend and API use separate images. Only the frontend port is exposed and PostgreSQL has its own persistent volume.

For a public release, put the frontend behind HTTPS, set `PUBLIC_ORIGINS` to the exact HTTPS origin and `SECURE_COOKIES=1`. Keep the API and database private. Configure backups, monitoring, release migrations, and shared edge rate limiting before adding API replicas. The bundled map uses OpenStreetMap standard tiles. Review the tile policy and select a suitable commercial or self-hosted tile service before high-volume use. Account email verification and password recovery require an email delivery provider.
# YatraBuddy demo

| Data | Source | Status in app | License or terms |
| --- | --- | --- | --- |
| Palolem weather | [Open-Meteo](https://open-meteo.com/en/terms) | Live model, cached with time, or simulated fallback | CC BY 4.0. Verify the non-commercial API terms |
| Local driving | [OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy) | Live routing estimate, cached with time, or demo sample | OpenStreetMap data under ODbL. Verify the routing server policy |
| Map | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Online map and bundled stop list | ODbL. Verify the [tile policy](https://operations.osmfoundation.org/policies/tiles/) |
| Places and cities | [Wikivoyage](https://en.wikivoyage.org/), [Wikipedia](https://en.wikipedia.org/), [GeoNames](https://www.geonames.org/) via Open-Meteo | Online results and cached public results | Verify individual Wikimedia content licenses. GeoNames data uses CC BY 4.0 |
| Device position | Browser geolocation | Device location with permission | Coordinates are used locally until the user opens directions |
| Demo fares and delays | YatraBuddy demo fixtures | Simulated. Current quotes are on the provider sites | Project-authored fixtures. Verify individual provider terms |

The desktop production build installs a service worker on HTTPS or localhost. Open the built app online before testing offline. Weather, road estimates, and public place search reuse results previously fetched for the same request. Shared voting and uncached online searches require a connection. Map tiles are served under the provider’s policy.

Start FastAPI with `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir backend` and Vite with `npm.cmd run dev`. Open [localhost:3000](http://localhost:3000). For an occupied port, use `npm.cmd run dev -- --port 3010` and open [127.0.0.1:3010/#chat](http://127.0.0.1:3010/#chat). Vite proxies `/api` to port 8000 by default. If `/api/health` works but the planner returns 404, restart the API from this checkout; an older API process can pass the health check without serving planner routes.

Try “What can I see in Palolem?” in the planner. Public place references include source links, and these questions leave the current trip draft intact. After saving a supported Goa journey, open **Check a missed connection** to test the chosen route against the group budget. It uses simulated timings and replacement costs; accepting a result only selects it in the simulation.

For the development workflow, use the [multi-agent prompt](docs/agent-ops/ORCHESTRATOR_PROMPT.md) and [local workflow guide](docs/agent-ops/OPERATING_SUMMARY.md).

The Itinerary and Budget views share the Goa Escape data. Items marked **SIMULATED DATA** are a sample scenario. Travel Sources links to providers for current fares and availability. Weather uses Open-Meteo and driving estimates use OSRM. In-app accommodation prices require configured Booking.com partner access.

Select **Try the group trip demo** on Overview to open Rehan’s December scenario. Create a group, copy the invite into separate browser profiles, join, and vote. Groups persist in SQLite locally and PostgreSQL in Docker. The fare limit is the lowest member budget. Eligible routes require at least 30 minutes to connect. Ranking uses votes first, then a score weighted 40% fare, 25% duration, 20% transfer buffer, and 15% group preference. Test a 95-minute delay to see alternatives within the remaining budget. Set the remaining budget below Rs 450 per traveller to see the no-fit state. The sample and delay calculation have bundled fallbacks. Shared voting requires the backend.


## Connected desktop planning

Open `http://127.0.0.1:3010/#chat` in the running development preview. Chat can save a draft into My Trips. Itinerary, map, budget and Discuss this trip share its saved ID; linked conversations use separate sessions. Explicitly saving a revision updates the same trip. Budget-only revisions preserve edited stops.

Gemini availability depends on the configured account quota. A daily-quota message means conversational generation is paused by Google, not that the trip was lost. Public lookups and the structured planner can continue. Priced sample itineraries cover the bundled destinations; worldwide source lookup does not imply worldwide bookable itinerary or fare coverage.
