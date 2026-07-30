# BuildIQ

AI-powered construction organization management system.

```
Project/
├── buildiq-frontend/   Pure HTML/CSS/JS — no build step, no framework
└── buildiq-backend/    FastAPI + Supabase Postgres + Groq
```

---

## Run it in 30 seconds (no backend, no keys)

```bash
cd buildiq-frontend
python3 -m http.server 8080
```

Open <http://localhost:8080/index.html> and click any **role chip** to sign in.
The frontend ships with `MOCK_MODE: true`, so every page, chart and workflow
runs on in-browser demo data with nothing else installed.

---

## Run the full stack

**1. Backend**

```bash
cd buildiq-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in Supabase + Groq, or leave blank
uvicorn app.main:app --reload
```

With an empty `.env` it still runs: SQLite on disk, local file storage,
heuristic AI. Docs at <http://localhost:8000/docs>.

**2. Point the frontend at it** — in `buildiq-frontend/js/config.js`:

```js
const BUILDIQ_CONFIG = {
  MOCK_MODE: false,
  API_BASE: "http://localhost:8000",
};
```

Add `http://localhost:8080` to `CORS_ORIGINS` in `.env`.

### Demo accounts

Password `Demo1234!` for all of them.

| Role | Email |
|---|---|
| Super Admin | `admin@buildiq.et` |
| General Manager | `gm@buildiq.et` |
| Department Manager *(also a Project Manager — try role switching)* | `meron.tadesse@buildiq.et` |
| Workforce & Attendance *(the only role that can take attendance)* | `girma.assefa@buildiq.et` |
| Project Manager | `pm@buildiq.et` |
| Engineer | `engineer@buildiq.et` |
| Auditor | `auditor@buildiq.et` |
| Client | `client@buildiq.et` |

---

## The seven roles

Enforced server-side in `app/security.py`; the frontend's checks are UX only.

| Role | Scope |
|---|---|
| **Super Admin** | Everything — users, audit, AI config |
| **General Manager** | Organization-wide; creates projects, appoints department heads |
| **Department Manager** | Their own department |
| **Project Manager** | Only the projects they manage |
| **Engineer** | Their own tasks and assigned projects |
| **Auditor** | Read-only org-wide + audit; may assign remedial tasks |
| **Client** | Their own linked project(s) |

A few rules worth knowing, because they're deliberate and slightly unusual:

- **Attendance is taken only by the Workforce & Attendance department** — not
  even a Super Admin can mark the register, though they retain full visibility.
- **Everyone can explain their own absence**; department managers, the GM,
  auditors and admins read those reasons. Auditors read but cannot rule on them.
- **One account can hold several roles** and switch between them from the
  sidebar. The active role is validated server-side on every request.
- **Every project has exactly one accountable manager**, always on the team.

---

## Documentation

| Where | What |
|---|---|
| `buildiq-frontend/README.md` | Pages, roles, mock mode, AI heuristics |
| `buildiq-backend/README.md` | Setup, Supabase, Groq, deployment checklist |
| `buildiq-backend/supabase/README.md` | Schema, RLS policies, why deny-by-default |

---

## Tests

```bash
cd buildiq-backend && pytest -q      # 103 tests
```

The frontend is covered by headless suites (~894 checks) run during
development, including an end-to-end pass that drives the real `js/api.js`
against a live backend over HTTP.

---

## Before going to production

- [ ] Set a strong `SECRET_KEY` — startup refuses to boot without one when `ENV=production`
- [ ] Restrict `CORS_ORIGINS` to your real frontend origin
- [ ] Apply `supabase/migrations/0002_rls_policies.sql` so the public anon key can't bypass the API
- [ ] Set `SEED_ON_STARTUP=false` once you have real data
- [ ] Wire `POST /auth/forgot-password` to an email provider — outside production it returns the reset token in the response body, which is deliberate for development but must not ship
- [ ] Adopt Alembic for migrations; `create_all()` handles first boot but won't migrate schema changes
