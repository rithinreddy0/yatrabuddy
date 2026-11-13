# Deploy YatraBuddy

The same GitHub repository supplies the Vite frontend to Vercel and the FastAPI backend to Render. Neon Postgres stores accounts, saved trips, chat sessions, and workspace files. Firebase Authentication verifies Google sign-in. The Vercel site proxies `/api/` to Render, so the browser can keep the session cookie on the frontend origin.

This setup uses Vercel Hobby for personal, non-commercial use, one Render Free web service, Neon Free, and Firebase Spark. Render Free suspends an idle service after 15 minutes and can take about a minute to wake. Its local files are ephemeral, and Render Free Postgres expires after 30 days. Neon Free includes 1 GB per project and 100 compute unit hours per project, with quotas for network transfer. Keep large attachments out of the demo database. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Render Free](https://render.com/docs/free), [Neon plans](https://neon.com/docs/introduction/plans), [Firebase pricing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

## Connect the accounts

1. Push the source to the new personal GitHub repository. Keep it private unless it is intended to be public. Give Vercel and Render access to that repository in their GitHub app settings. [Vercel Git setup](https://vercel.com/docs/git), [Render Git setup](https://render.com/docs/git-provider)
2. Create a Neon Free project in Singapore if available. Copy its database connection string into Render's `DATABASE_URL`. Change the initial `postgresql://` to `postgresql+psycopg://` and preserve the query parameters, including `sslmode=require`. [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app)
3. In the Firebase console, select the project's web app or register one. Enable **Google** under **Authentication → Sign-in method**. Copy its `projectId`, `authDomain`, `apiKey`, and `appId` for Render. Add the final Vercel hostname under **Authentication → Settings → Authorized domains**. Enter a hostname such as `yatrabuddy.vercel.app` there. For local development, authorize `localhost` in a separate development Firebase project. [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Firebase authorized domains](https://firebase.google.com/docs/auth/faq-and-troubleshooting)

## Deploy the API on Render

Choose **New → Blueprint** and select the repository. The root `render.yaml` uses the existing Python Dockerfile, the Free plan, and `/api/health`. Complete the environment prompts in Render:

- `DATABASE_URL` is the Neon connection string in SQLAlchemy format, such as `postgresql+psycopg://user:password@host/database?sslmode=require`.
- `PUBLIC_ORIGINS` is the exact HTTPS frontend origin, including the scheme and excluding the trailing slash. If Vercel assigns a different hostname, update this setting in Render and restart the service. Add extra authorized frontend origins with commas only when they need access to the API.
- `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_WEB_API_KEY`, and `FIREBASE_WEB_APP_ID` come from the Firebase web app.
- `SECURE_COOKIES=1` and `REQUIRE_GOOGLE_SIGN_IN=1` are set by the Blueprint.
- `SEARCH_USER_AGENT` can identify the app and its operator to public travel data sources. Optional model and provider credentials belong in Render's environment settings.

Once Render finishes the first deployment, open `https://<render-service>.onrender.com/api/health` and check for `{"status":"ok"}`. FastAPI creates tables in the configured database during startup. [Render Blueprint reference](https://render.com/docs/blueprint-spec)

## Deploy the frontend on Vercel

Import the GitHub repository into a personal Hobby project and use its root directory. In the Vercel project, set `RENDER_API_ORIGIN` for Production to the actual Render HTTPS origin, for example `https://yatrabuddy-api.onrender.com`. The value has no path. `vercel.ts` installs with `npm ci`, builds the Vite app into `dist`, and configures the API rewrite. Use the Vercel dashboard or a current CLI for programmatic configuration. Keep the frontend's Vercel environment separate from Render's application credentials. [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-ts), [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)

## Verify the live app

1. Open `/api/health` through the Vercel URL and confirm that it returns the same JSON as Render. Check `/api/auth/config` for the configured Firebase project and `googleRequired: true`.
2. Open the frontend in a fresh browser profile. Confirm that Google is required. Sign in with a Google test account, complete the chat onboarding, and refresh. Confirm that the session and preferences remain available.
3. Start a trip chat, answer its follow-up questions, and save the itinerary. Open the map, place photos, and the destination summary. Reload the page and confirm the saved trip remains available.
4. Open a shared trip invitation in a second browser profile using a separate Google test account. Confirm the invite works, updates appear for both members, and an account outside the group cannot read the workspace.
5. Check once after an idle period. The initial request can outlast the browser's timeout while Render wakes. Open `/api/health`, allow the service to start, and retry. If Google sign-in reports an unauthorized domain, check that the final Vercel hostname appears in Firebase and that the exact frontend origin appears in Render's `PUBLIC_ORIGINS`.
