# BuildIQ Backend

FastAPI backend for BuildIQ — AI-powered construction organization management.
Data lives in **Supabase Postgres**, documents in **Supabase Storage**, and the
AI features call **Groq**, with a deterministic local fallback so nothing breaks
when the key is absent or the API is down.

---

## Quick start

```bash
cd buildiq-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # then fill in the values below
uvicorn app.main:app --reload
```

Open <http://localhost:8000/docs> for interactive API docs, or
<http://localhost:8000/health> for a liveness + dependency check.

With no `.env` at all it still runs: SQLite on disk, local file storage, and
heuristic AI. That's the zero-setup path for development.

---

## Database schema

`supabase/` holds the SQL: table definitions, indexes, and Row Level Security
policies. See [supabase/README.md](supabase/README.md).

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls_policies.sql
```

You can skip this — the API calls `create_all()` on boot — but applying it adds
CHECK constraints, partial/GIN indexes, and locks the database down against the
public anon key. `tests/test_schema.py` fails if the SQL drifts from the ORM.

---

## Configuration

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | JWT signing key. **Startup refuses to boot in production if left at the default.** |
| `DATABASE_URL` | Supabase Postgres URI. Falls back to SQLite when unset. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Supabase Storage for uploads. Falls back to local disk. |
| `GROQ_API_KEY` | Enables live AI. Without it, heuristics are used. |
| `CORS_ORIGINS` | Comma-separated frontend origins. `*` for development only. |
| `SEED_ON_STARTUP` | Populates an empty DB with the demo dataset. |

### Supabase

1. **Database** → Project Settings → Database → Connection string (URI).
   Use the **pooled** connection (port `6543`) for serverless hosts:
   ```
   DATABASE_URL=postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
2. **Storage** → Settings → API → copy the `service_role` key.
   The bucket is created automatically on first boot and is **private** —
   downloads flow through the API so permissions are enforced.

> The `service_role` key bypasses row-level security. It belongs on the server
> only; never ship it to a browser.

### Groq

Get a key at <https://console.groq.com/keys>. Used for:

| Surface | Endpoint |
|---|---|
| Chatbot | `POST /ai/chat` |
| Complaint triage | `POST /complaints` |
| Suggested resolutions | `POST /complaints/ai/suggest-solution` |
| Report narratives | `POST /reports/generate` |
| Project risk explanations | `POST /projects/{id}/analyze` |
| Dashboard summaries | `GET /ai/executive-summary` |

Every response carries `ai_source: "groq" | "heuristic"` so the UI can show
which produced it. `GET /ai/status` reports the current mode.

**The model only ever sees data the caller can already read** — prompt context
is built from the same role-scoped queries that serve the REST endpoints.

---

## Architecture

```
app/
├── main.py              FastAPI app, lifespan, CORS, error handlers
├── config.py            Environment-driven settings
├── database.py          SQLAlchemy engine/session (Postgres or SQLite)
├── models.py            ORM models
├── schemas.py           Pydantic request/response contracts
├── security.py          Passwords, JWTs, role capability rules
├── deps.py              Role-scoped queries, audit logging, notifications
├── ai_engine.py         Deterministic scoring/ranking + the 7 audit types
├── seed.py              Demo dataset (idempotent)
├── services/
│   ├── groq_service.py  Groq wrapper — returns None on any failure
│   └── storage.py       Supabase Storage with local-disk fallback
└── routers/             12 routers, 76 endpoints
```

### Authorization

Roles mirror `buildiq-frontend/js/roles.js`, but **the server is the
enforcement point** — the frontend's checks are UX only, and every rule is
re-verified here.

| Role | Scope |
|---|---|
| Super Admin | Everything, including user management and audit |
| General Manager | Organization-wide; creates projects, appoints heads |
| Department Manager | Their own department |
| Project Manager | Only the projects they manage |
| Engineer | Their own tasks and assigned projects |
| Auditor | Read-only org-wide + audit; may assign remedial tasks |
| Client | Their own linked project(s) only |

Notable rules, all covered by tests:

- **Attendance is taken only by the Workforce & Attendance department** — not
  even a Super Admin can mark the register, though they retain full visibility.
- **Multi-role accounts** hold `roles[]` with one active `role`. `POST
  /auth/switch-role` re-issues the token; a forged role claim in a JWT is
  ignored because `get_current_user` validates it against the roles actually held.
- **Auditors are read-only** on absence reasons — they can read but not rule.
- **Every project has exactly one manager**, always on the team.

### The seven audit types

Every audit event is classified into one type, each with its own ML technique:

| Type | Technique |
|---|---|
| Security | Anomaly detection |
| Financial | Outlier scoring |
| Compliance | Rule violation scoring |
| User Activity | Pattern detection |
| Data Integrity | Change anomaly detection |
| Project & Resource | Predictive analytics |
| Report & Document | Access pattern analysis |

Exposed at `GET /audit/types`, with per-type breakdowns in `GET /audit/stats`.

---

## Connecting the frontend

In `buildiq-frontend/js/config.js`:

```js
const BUILDIQ_CONFIG = {
  MOCK_MODE: false,                        // switch off the in-browser mocks
  API_BASE: "http://localhost:8000",       // or your deployed URL
};
```

Then add the backend's origin to `CORS_ORIGINS`. Response shapes match what the
frontend already reads, so no other JS changes are needed.

### Demo accounts

All use the password `Demo1234!` (override with `SEED_DEMO_PASSWORD`).

| Role | Email |
|---|---|
| Super Admin | `admin@buildiq.et` |
| General Manager | `gm@buildiq.et` |
| Department Manager *(also a Project Manager — try role switching)* | `meron.tadesse@buildiq.et` |
| Workforce & Attendance *(can take attendance)* | `girma.assefa@buildiq.et` |
| Project Manager | `pm@buildiq.et` |
| Engineer | `engineer@buildiq.et` |
| Auditor | `auditor@buildiq.et` |
| Client | `client@buildiq.et` |

---

## Tests

```bash
pytest -q          # 103 tests
```

Runs the real app against a temporary SQLite database with the demo seed.
Covers auth and token forgery, every role's scoping rules, the attendance and
absence-reason workflow, task assignment, complaint triage, the audit taxonomy,
byte-identical document round-trips, report generation, both the Groq path and
its fallback, and that `supabase/*.sql` still matches `app/models.py`
table-for-table and column-for-column.

---

## Deployment

`render.yaml` is included for Render. Set `SECRET_KEY`, `DATABASE_URL`,
`SUPABASE_*`, `GROQ_API_KEY` and `CORS_ORIGINS` as dashboard secrets rather
than committing them. Health checks point at `/health`.

Any container host works:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Before going live

- [ ] Set a strong `SECRET_KEY` (startup enforces this when `ENV=production`)
- [ ] Restrict `CORS_ORIGINS` to your real frontend origin
- [ ] Set `SEED_ON_STARTUP=false` once you have real data
- [ ] Wire `POST /auth/forgot-password` to an email provider — it currently
      returns the reset token in the response body outside production, which is
      deliberate for development but must not be relied on in production
- [ ] Adopt Alembic for migrations; `create_all()` handles first boot but
      won't migrate schema changes
