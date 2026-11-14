# YatraBuddy final pre-submission report (15 November 2026)

Branch `final/production-polish`, based on `main` after pull request #1. Earlier batches (budget and
expenses, bookings, Destination guide essentials, Transport redesign, home-to-home journeys) are
described in [AUDIT_2026-11.md](AUDIT_2026-11.md). This report covers the final audit pass.

## 1. Changes implemented

### Homepage (mobile first)
- New layout: photo hero with the trip planner inside it, a swipeable row of example trips, a compact
  "Continue planning" card with shortcuts (Getting there, Budget, Bookings, Travel Mode), a "Popular trips"
  row (swipe on phones, grid on desktop), three shortcut tiles, a photo-only "Around <city>" row of real
  places with licensed photos, and a sources footer.
- The phone homepage went from about 6,200 px to about 1,950 px tall at 390 px. The long discovery feed
  moved off the home page (it remains in Explore and the Destination guide).
- The Plan button stays enabled and focuses the trip box when it is empty.
- Dead code removed: `BentoGrid` (no longer used).

### Trip planning (found by real-traveller tests and fixed)
| Problem | Fix |
| --- | --- |
| "A family of 4 with two kids…" asked "How many people are traveling?" | Parser understands "family/group of N", "we are N", "N of us", "N adults and M kids". |
| "Reduce the budget to 15000" rebuilt the plan and left ₹20,000 | "budget to/is/at N" is parsed; budget-only changes keep the itinerary. |
| Typing or tapping an offered base city ("Panaji") said "Which city did you mean?" | Offered cities are reused as verified; alias fallback for names the geocoder files differently (Panaji→Panjim, Pondicherry→Puducherry, Bombay, Madras, Cochin, Bangalore and others). |
| "Add Fort Aguada" was not understood | Adding without a day works; the stop goes on the nearest day with room; places outside the base town are found through the destination's guides; ambiguous names are not guessed. |
| Changing dates rebuilt the plan and brought back removed stops | Date-only changes keep the itinerary and its edits, move the dates and refresh the forecast. |
| "Add a rest break" got "I couldn't answer that" | Pace requests get a useful answer; "take it easy", "slower pace", "fewer stops" set a relaxed pace. |

### Motion and visual consistency
- Images get a tinted placeholder while loading and a short fade-in (disabled with reduced motion).
- Collapsed desktop sidebar: the clipped "Nev" button is now an icon button.
- Existing motion was reviewed and kept: page arrival (300 ms), dialogs, day panels, chat message entrance,
  skeleton loaders, and a global `prefers-reduced-motion` override.

### Security
- Vercel now sends security headers for the web app: `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS, and a minimal CSP (`frame-ancestors 'none'`,
  `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`). The nginx deployment already had a full CSP.
- User-facing text still said "Wayfarer" (the old name) in emails, prompts and messages; replaced.

### Performance
- The home page no longer preloads the place-details, city-brief and discovery code: the first load
  preloads 2 extra chunks instead of 12. Place details load when a place is opened.
- `Intl.Segmenter` (which loads locale data) is created on first use instead of at import.
- The 240 KB animated splash image is fetched only if the app is not ready within 600 ms, and never with
  data saver or on 2G.
- The home hero photo starts downloading from the HTML (`public/preload-hero.js`, a file rather than an inline
  script so the nginx Content-Security-Policy allows it), and the first two destination photos load eagerly.
- The last known sign-in policy is remembered on the device, so a returning visitor's saved trip renders on
  the first frame instead of popping in and pushing the page down.
- How the problems were found: `e2e/profile-load.mjs` (CPU profile) showed 6 s spent creating the
  `Intl.Segmenter` and pre-loading unused chunks; `e2e/trace-load.mjs` showed that headless software
  rendering inflated layout and paint (17 s → 5 s with the GPU), so all final numbers use `GPU=1`.

### Testing tools added
- `e2e/journeys.spec.mjs`: Playwright journeys on mobile (390 px) and desktop (1280 px) using the installed
  Edge (`npm run test:e2e`).
- `e2e/live-scenarios.mjs`: real conversations against the live planner and public data sources.
- `e2e/screenshots.mjs`: screenshots of 15 pages at 8 widths with overflow, broken-image and console-error checks.
- `e2e/perf.mjs`, `e2e/profile-load.mjs`, `e2e/trace-load.mjs`: load metrics, CPU profile and task breakdown.
  `GPU=1` uses the graphics card instead of software rendering.

## 2. Pages redesigned or changed in this pass
Home (full redesign), desktop sidebar (New chat button), Travel Mode (dates, dropdowns, stray "0"),
trip Calendar (stray "0"). Planner behaviour changed in Chat. Earlier batches:
Trip budget, Bookings, Transport, Destination guide, Itinerary and Calendar (journey cards), Travel Mode.

## 3. Bugs fixed
See the table in section 1, plus:
- A stray "0" printed under the Travel Mode and Calendar screens (a numeric `&&` in the trip workspace).
- Travel Mode showed raw ISO dates and 21 px tall dropdowns.
- Hero text and the Plan button were clipped at 320 px; swipe rows snapped cards against the screen edge.
- The continue card showed a raw ISO date.
- Home preloaded 10 chunks it did not need; the splash downloaded a 240 KB animation during every load.
- Saved trips popped in after the sign-in policy loaded, shifting the home page by 157 px (layout shift 0.065).
- Planner: "Switch to Kochi" or "Make Kochi the base" now rebuilds the trip around the new base, and a lone
  city name suggests that phrasing instead of "I couldn't answer that".

## 4. Test results
All commands were run on 15 November 2026 in this environment.

| Command | Result |
| --- | --- |
| `python -m unittest backend.test_*` (all backend modules) | 114 passed |
| `npm test` (frontend unit tests) | 34 passed |
| `npm run build` | succeeds; main chunk 324 kB (102 kB gzip) |
| `npm run test:e2e` (Playwright, Edge, mobile 390 px and desktop 1280 px) | 39 passed, 3 skipped (width sweeps run on the mobile project only) |
| `node e2e/live-scenarios.mjs` (real planner and public sources) | 5 scenarios behave as expected; transcript in `docs/screenshots/scenarios/transcript.md` |
| `node e2e/screenshots.mjs after` (15 pages × 8 widths) | 120 screenshots; no horizontal overflow, broken images or page errors |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `pip-audit -r backend/requirements.txt` and `requirements-crawl.txt` | 0 known vulnerabilities after upgrading python-dotenv 1.2.1 → 1.2.2 |

Playwright journeys cover: home to chat, empty Plan button, journey cards on a saved trip, budget totals and
settlement, transport tabs, chat network failure with Retry, back/forward/refresh, very long input, and
no sideways scrolling at 320, 360 and 768 px. Accessibility checks (20 runs) cover unnamed controls, images
without alt text, unlabelled fields and a missing page heading on 10 screens, on mobile and desktop.

Live scenarios (Hyderabad → Goa budget trip, family of four to Kerala, plan changes, invalid destination,
stays near Calangute) found six planner bugs, all fixed and covered by new backend tests. No failures remain.

## 5. Screenshot evidence
- Before: `docs/screenshots/before/` (10 pages at 360, 390 and 1440 px).
- After: `docs/screenshots/after/` (15 pages at 320, 360, 375, 390, 430, 768, 1024 and 1440 px).
- Live scenarios: `docs/screenshots/scenarios/` with `transcript.md`.

## 6. Security findings
| Area | Finding | Status |
| --- | --- | --- |
| Secrets in git | No keys, tokens or private keys in tracked files or history; `.env` ignored; only `.env.example` (empty values) tracked. | OK |
| Frontend secrets | No `VITE_` variables; Firebase web config is public by design and comes from the API. | OK |
| Server keys | Groq, Gemini, Duffel, Google and Amadeus keys are read on the server only. | OK |
| Writes from other sites | POST/PUT/PATCH/DELETE reject cross-site requests and unknown origins. | OK |
| Data between users | Workspaces require membership; files check workspace and entry; chat sessions are keyed to the caller. | OK (by code review and existing tests) |
| AI and API cost | Rate limits on chat turns (45/min), conversation (12/min), voice (12/min), places, transport and climate. | OK |
| Prompt injection | Prompts state that retrieved content and user text are data, not instructions; model output links are limited to http(s). | Mitigated, not provable |
| HTML injection | Only static icon SVG uses `innerHTML`; no user or fetched HTML is rendered. | OK |
| Web security headers on Vercel | Were missing. | Fixed |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. `pip-audit` found PYSEC-2026-2270 in python-dotenv 1.2.1 (symlink overwrite in `set_key()`; the app only reads `.env`, so exposure was low). | Fixed (1.2.2) |
| Firebase | Used for Google sign-in only; no Firestore or Storage rules to review. | N/A |
Not done: penetration testing, a full CSP for the Vercel deployment (needs testing against every image
host the app loads), and rotation checks (no exposed credentials were found).

## 7. Performance results
Method: production builds served with `vite preview`; "before" is `main` at `7425add`, "after" is this
branch. Both were measured alternately in one warmed-up Edge with the GPU enabled, on a 390 px phone viewport
with the CPU slowed 4×, as a returning guest with one saved trip. Each value is the median of 5 loads
(`GPU=1 node e2e/perf.mjs before=… after=…`; raw output in `docs/screenshots/perf-results.txt`).
"App ready" is when the startup splash is removed and the app can be used.

| Network | Page | First paint | Largest paint | App ready | Layout shift (CLS) |
| --- | --- | --- | --- | --- | --- |
| Slow 4G | Home | 1,756 → **1,472 ms** | 4,636 → **4,336 ms** | 3,000 → **2,817 ms** | 0.225 → **0.000** |
| Slow 4G | Chat | 1,864 → **1,388 ms** | 2,068 → **1,400 ms** | 2,974 → **2,259 ms** | 0 → 0 |
| Slow 4G | Trip | 1,860 → **1,392 ms** | 1,860 → **1,392 ms** | 2,814 → **2,186 ms** | 0 → 0 |
| Fast 4G | Home | 992 → **824 ms** | 4,232 → **3,816 ms** | 2,214 → **1,992 ms** | 0.200 → **0.000** |
| Fast 4G | Chat | 1,156 → **1,056 ms** | 1,156 → 2,416 ms | 2,333 → **2,093 ms** | 0 → 0 |
| Fast 4G | Trip | 1,276 → **1,088 ms** | 2,984 → **2,292 ms** | 2,447 → **2,014 ms** | 0 → 0 |

- Home data transferred in the measurement window: 716 KB → 445 KB.
- Main JavaScript chunk: 337.8 kB → 324.2 kB; chunks preloaded by the HTML: 12 → 2.
- The one worse number, Chat's largest paint on fast 4G, is a change in *which* element counts: the chat
  welcome illustration now paints within the window and is larger than the splash, which was the largest
  element before. The chat is usable sooner (app ready 2.33 s → 2.09 s).
- Transfer sizes on Chat and Trip under slow 4G are not comparable between builds: they count only what
  finished downloading inside the measurement window.
- Absolute times varied by up to 2× between runs on this machine (background load); only before/after pairs
  from the same run are compared. These are lab measurements, not field data from real phones.

## 8. Remaining limitations
- Fares, timetables and seat availability need Duffel or Google Routes credentials; without them the app
  links to providers and says so.
- Many small hotels, guesthouses and restaurants have no openly licensed photo; they show a neutral
  illustration rather than an unrelated image.
- After a plan exists, a lone city name ("Kochi") does not switch the base by itself; the planner asks the
  traveller to say "Switch to Kochi" (supported). This avoids treating ordinary words as places.
- Home in the home-to-home journey is the departure city's centre, not a street address.
- Not tested: real phones (keyboard, notch), Google sign-in, Groq or Gemini responses, paid providers.
- Public data sources (Wikivoyage, Wikipedia, OpenStreetMap, Open-Meteo, OSRM) occasionally time out; the
  planner then falls back to local map listings.

## 9. Final submission checklist
| Criterion | Result | Evidence |
| --- | --- | --- |
| App builds for production | PASS | `npm run build` |
| Backend unit and API tests | PASS | `python -m unittest backend.test_*` (count in section 4) |
| Frontend unit tests | PASS | `npm test` |
| Browser journeys, mobile and desktop | PASS | `npm run test:e2e` |
| No horizontal scrolling at 320–1440 px | PASS | screenshot script checks, width sweep tests |
| Homepage usable on a phone without scrolling to the planner | PASS | journey test "home leads straight into planning" |
| Trip planning from a single message (live data) | PASS | live scenarios: budget, family, modify |
| Clarifying question only when needed | PASS | Goa → base city question; full requests build directly |
| Itinerary refinement (budget, add, remove, dates) stays consistent | PASS | live scenario "modify" |
| Invalid destination handled | PASS | live scenario "invalid" |
| Chat network failure shows error and Retry | PASS | journey test with the API blocked |
| Back, forward and refresh | PASS | journey test |
| Very long input is capped | PASS | journey test |
| No fabricated prices, ratings or schedules | PASS (by design and review) | unpriced items say so; fares only from providers; estimates labelled |
| Images: no broken images on main pages | PASS | screenshot script check |
| Load performance not worse than before | PASS (one metric explained in section 7) | `e2e/perf.mjs`, before/after in one run |
| No layout shift on Home | PASS (CLS 0.000, was 0.20–0.23) | `e2e/perf.mjs` |
| Exposed credentials | PASS (none found) | repository and history scan |
| Dependency vulnerabilities | PASS | `npm audit`, `pip-audit` (python-dotenv upgraded) |
| Accessibility basics (names, labels, alt, h1) | PASS | `e2e/accessibility.spec.mjs` (no contrast or screen-reader testing) |
| Live fares and timetables | NOT TESTED | needs Duffel or Google Routes credentials |
| Google sign-in, Groq and Gemini responses | NOT TESTED | needs credentials |
| Real phones (iOS, Android keyboards and notches) | NOT TESTED | only browser emulation was available |
