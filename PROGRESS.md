# Travel workspace update

- Trip starts from Home, Explore, Saved, the destination guide, and place shortlists now open one chat with a concrete prompt (destination, profile defaults, and selected places). The structured builder stays available from inside chat when the planner hands off a draft.
- Mobile pages no longer reserve a top gap for a menu that is not on the page. Trip actions stick under the top of the screen, and narrow widths keep filters and trip cards inside the viewport.

## Conversational itinerary

- The chat collects the destination, duration, party, origin or local start, and group budget or undecided budget. It asks one missing question at a time and starts research automatically once those answers are available. Exact dates are optional and the itinerary shows when flexible dates were assumed.
- The session stores the trip requirements and latest itinerary. The planner resolves the destination, gathers public listings, checks dated forecasts, ranks stops, and passes the same listings into the existing route builder. Budget-only changes preserve the schedule and entered costs. A failed revision for the same destination keeps the previous itinerary available for retry.
- Regression coverage exercises a multi-turn trip, per-person and total budget changes, route estimation fallback, failed research and recovery, and session reload. The local mobile browser journey covers itinerary, map, budget revision, save, and reload with public data.
- Provider prices and availability require a provider check. Published venue hours and suggested visit times are shown separately. The itinerary does not confirm venue accessibility or verify the whole trip cost against the budget.
- Planning starts in chat from both entry buttons. Pending questions and destination choices survive side lookups and reloads. Itineraries use compact expandable day cards and distribute sourced meal options across days while reserving room for visits.
- Place cards and itinerary stops retain available photos while hiding OpenStreetMap listing links. Hotel and restaurant searches switch the map to their own results. Save Trip in the composer persists the itinerary before clearing the conversation and opening the trip page.
- Transport replies lead with sourced arrival and local guidance, published day passes where available, and a labeled driving estimate when routing succeeds. Hotel listings show published prices and details where the source supplies them.
- Chat and trip-page dictation show a listening indicator and Stop control. Trip tools sit to the left of the selected view on desktop. My Trips shows stop photos when available, while Saved, Updates, and Research use wider galleries of sourced destination photos.
- The shared shell uses a black canvas, dark glass panels, locally bundled Poppins, a top hamburger, and a mobile navigation dock. The landing page has a 12-column grid and 96px section spacing. Saved trips open to the itinerary, with compact day cards and ratings and review counts where supplied.
- Home puts trip planning and exploration first. Generated travel photographs illustrate the Home features and trip sections, including Bookings, Calendar, and Transport.

- Home, Saved, and chat prioritize sourced photo carousels. Nearby cards support favorites, a trip shortlist, and estimated interest matches. Other results remain available in compact lists.
- Chat uses public place listings, guides, media, and current model weather before considering a configured model. The conversation collects preferences, offers verified starting cities for broad regions, and builds routes from sourced stops.
- Saved trips have a budget chart, optional vector map, bookings, per-place media, calendar export, packing list, journal, preferences, and shared rooms with invite links. Packing lists and journals stay in the browser.
- Research, Updates, Travel Sources, Explore, Saved, and trips reuse cited city briefings. Research puts practical notes before the detailed source list. Explicit result actions reveal their content; background refreshes do not scroll.
- Google sign-in gates travel tools in both the browser and API. New users complete preference onboarding in chat. Research uses a permitted current location or a saved city/profile fallback.
- Vercel and Render deployment files and Neon/Firebase setup instructions are ready. Publication requires access to the hosting accounts and a new GitHub repository.
- Known limits: photo and video coverage varies by source and licensing. Booking rates and live fares are provider-dependent. A local preview invite cannot be used on other devices.
