# Verify that the preview reached the expected page

A preview image can come from an error page. For a UI change, first inspect the final HTTP response and then verify expected rendered content at the actual route. Record both observations in the QA evidence. Capture a screenshot when it helps a reviewer confirm visual behavior.

The regression fixture supplies a 404 response with a screenshot reference. The gate rejects it. A 200 response with missing expected content also fails. Only a 2xx response with the expected content can advance the workflow. This fixture demonstrates the evidence rule. It does not measure the live YatraBuddy browser route.

During the YatraBuddy integration check, the desktop preview used `http://127.0.0.1:3010/#chat`. Agent_PM observed that posting to `/api/planning-agent/sessions` through the Vite proxy returned 404 while an older backend process was running. The same call returned 201 after the backend restarted. Agent_PM then completed nine API turns and confirmed save and resume. Agent_QA independently used Chrome to verify the actual rail recovery flow: the 95-minute delay returned a ₹2,250 group replacement, and reserving all but ₹500 returned an exact ₹1,750 shortfall. The HTTP result and the browser content check are separate pieces of evidence.

Next improvement is to have the host browser adapter record status, route, and rendered content observations into the evidence file.
