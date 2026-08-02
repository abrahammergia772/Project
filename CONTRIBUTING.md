# Contributing to BuildIQ

## Layout

```
Project/
  render.yaml            Render Blueprint (must stay at the repo root)
  buildiq-backend/       FastAPI + SQLAlchemy + Supabase
  buildiq-frontend/      Pure HTML/CSS/JS — no build step, no framework
```

The frontend is intentionally dependency-free: it is served as a static site
and must keep working when opened directly from disk. Do not introduce a
bundler, npm dependency or framework without discussing it first.

## Running it locally

```bash
cd buildiq-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

export SECRET_KEY="anything-for-local"
export ALLOW_SQLITE=true                 # tests/dev only, never in deployment
export DATABASE_URL="sqlite:///./buildiq.db"
uvicorn app.main:app --reload
```

Frontend:

```bash
cd buildiq-frontend
python -m http.server 8080
```

Set `API_BASE` in `js/config.js` to `http://127.0.0.1:8000`.

## Tests

```bash
cd buildiq-backend
ALLOW_SQLITE=true python -m pytest -q          # 280+ tests
```

`pglast` matters: `tests/test_schema.py` parses the Supabase migrations with
PostgreSQL's real parser to check them against the SQLAlchemy models. Without
it those tests **skip silently** and schema drift goes unnoticed. It is in
`requirements-dev.txt` — keep it installed.

Optional, for the ML pipeline only:

```bash
pip install -r requirements-ml.txt
```

## Things that will break if you change them carelessly

These are all real incidents from this project's history, not hypotheticals.

**`fastapi==0.115.6` + `starlette==0.41.3` are pinned together.**
With Starlette 1.x, `include_router()` silently produces `Mount` objects and
only 2 of the ~92 endpoints register. Nothing errors; the API just returns
404 for almost everything.

**`Base.metadata.create_all()` adds missing TABLES but never missing COLUMNS.**
Adding a field to a model does not add it to an existing database. Adding
`users.avatar_url` once made every login return 500. Add the column to
`supabase/migrations/` as well; `_add_missing_columns()` in `main.py` is a
safety net for nullable columns only, not a migration system.

**Frontend page modules must be published to `window`.**
`const XPage = (() => {...})()` at the top level creates a script-scope
binding, *not* a window property, and `js/spa.js` looks up `window[name]`.
Every page module ends with:

```js
if (typeof window !== "undefined") window.XPage = XPage;
```

**Chart.js and flatpickr must load in `app.html` before the page modules.**
Dashboard, audit, complaints and ai_insights call `new Chart(...)` during
init.

**Check constraint casing is not consistent between tables.**
`complaints.severity` is lowercase (`'low'`…`'critical'`), while
`projects.delay_risk` and `audit_logs.risk_level` are UPPERCASE. Match the
table you are writing to.

**Sessions live in `sessionStorage`, not `localStorage`** — closing the tab
signs the user out, deliberately.

## Security rules that are not negotiable

- **Every rule is enforced server-side.** The frontend's role logic is a UX
  convenience. If a check exists only in `js/roles.js`, it does not exist.
- **Only the `Workforce & Attendance` department takes attendance.** It is
  department-based, not role-based: an Engineer in that department qualifies,
  a Super Admin in Executive does not.
- **Self-service signup can never mint a privileged role.**
- **Passwords** go through `app/password_policy.py`. Both write paths
  (signup and reset) must validate.
- **Never commit secrets.** `ml/data/` and `ml/artifacts/` are git-ignored
  because real extracts contain staff names and activity.

## Style

- Comments explain *why*, not *what*. A comment restating the code is noise;
  a comment recording the incident that forced the code is worth keeping.
- Tests are named as sentences describing the behaviour
  (`test_an_engineer_cannot_send_one`), not `test_case_3`.
- When a test fails, work out whether the product or the assertion is wrong.
  Say which. Fixing a correct test to make it pass is how bugs ship.

## Pull requests

1. Branch from `main`.
2. Run the full suite — all of it, not just the tests near your change.
3. State what you verified and what you did not.
4. Flag trade-offs explicitly rather than burying them.
