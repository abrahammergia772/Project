# BuildIQ Frontend

AI-Powered Construction Organization Management System — frontend only, built exactly
to the spec in `BuildIQ_Prompts.pdf` (Part A): pure HTML/CSS/JavaScript, no frameworks.

## Running it

No build step needed. Just serve the folder statically, e.g.:

```bash
cd buildiq-frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

## Mock mode (works with zero backend)

By default the app runs in **mock mode** (`js/config.js` → `BUILDIQ_CONFIG.MOCK_MODE = true`).
All data (members, projects, complaints, audit logs, chatbot replies, AI risk analysis, etc.)
comes from `js/mock-data.js` and simulated responses in `js/api.js`, so every page,
chart, modal, and role works immediately without Supabase, Groq, or trained ML models.

- On the login screen, click any of the **role chips** (Super Admin / Manager / Engineer /
  Auditor) to instantly sign in as a demo user with that role and see the role-aware
  dashboard, navigation, and access control in action.
- Or sign up through the 3-step form — any role you pick will work.

## Connecting the real backend

Set `MOCK_MODE: false` in `js/config.js` and point `API_BASE` at your running FastAPI
backend (see Part B of the prompt document — `buildiq-backend/`). `js/api.js` already
implements every real endpoint call (`/auth/login`, `/members`, `/projects/:id/analyze`,
`/ai/chat`, `/audit/anomalies`, etc.) with an Authorization header, 401-redirect, and
error-toast handling — no frontend code changes are needed beyond the config flag.

## Structure

Matches the spec's file structure (A.3): `css/tokens.css` (design tokens), `css/reset.css`,
`css/components.css`, `css/layout.css`, `css/pages/*.css`, `js/auth.js`, `js/api.js`,
`js/router.js` (role-based access control), `js/shell.js` (shared sidebar/topbar renderer),
`js/components.js` (reusable UI builders), `js/utils.js`, and one `js/pages/*.js` per page.

## Pages implemented

`index.html` (login/signup), `dashboard.html` (role-aware), `members.html`, `departments.html`,
`projects.html` (cards/table/Gantt), `tasks.html`, `complaints.html`, `audit.html`
(anomalies/logs/analytics/rules tabs), `reports.html`, `chatbot.html`, `documents.html`,
`settings.html`, `user_management.html`.

## Notes

- Verified with an automated headless-browser pass across all 12 pages × 4 roles (48
  combinations): correct role-based redirects, zero console errors.
- Responsive: desktop full sidebar, tablet icon-only sidebar, mobile burger menu + bottom nav.
- Respects `prefers-reduced-motion`, visible focus rings, ARIA labels on icon buttons.
