# Sprint 01: Make planning chat useful before and during a trip

The hackathon brief asks how to simplify planning and journeys by bringing routes, timing and traveller needs together. The organiser notes identify missed connections and constrained recovery as a demonstration opportunity. The product focus for this sprint: **plan together, then test whether the same trip can recover without exceeding the group's budget.** It is the focus of the demo, not a claim that competitors lack disruption tools. [Mindtrip](https://mindtrip.ai/) already markets alerts and on-trip advice. [This desktop concept on Dribbble](https://dribbble.com/shots/27259473-AI-Travel-Planner-Web-App-AI-Chat-Trip-Builder-UI) reinforces keeping the chat and structured itinerary in one workspace.

1. **Agent_PM — reliability first.** Reproduce the planner's `404` through the frontend, check the organiser's requirements, and define the connection recovery scenario with both outcomes.
2. **Agent_Design — chat answers.** Keep the composer visible, distinguish source lookups from planning, attach compact source and map links, preserve answers after reload, and give an actionable error when a session cannot resume.
3. **Agent_Dev — planning and recovery.** Restore the running preview. Route explicit travel questions to public sources without mutating the brief. Run the saved Goa connection simulation against the route and total that the group actually selected. Keep the shared delay rules and all demo prices clearly simulated.
4. **Agent_QA — browser acceptance.** On the desktop preview, confirm the composer renders, a Palolem question returns real references, and Rehan can save a five-person rail trip. At 95 minutes late, accept the simulated ₹2,250 shuttle. With only ₹500 available, confirm the exact group shortfall of ₹1,750. Recheck the saved-chat-to-library handoff after interruption.

Next three priorities, in order:

1. Bring group voting and consensus into the saved chat journey; reuse the lowest-member budget rule.
2. Let users explicitly add verified place references to an itinerary, with source attribution retained on the stop.
3. Capture browser evidence automatically in the QA record so both the status and rendered-content checks are repeatable.

Live fare quotes require an authorised provider. In-app planner fares, transfer buffers and replacement quotes are marked as simulated. The public place sources and Open-Meteo results have their own provenance.
