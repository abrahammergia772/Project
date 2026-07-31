# Deploying BuildIQ to Render

## The error you hit

```
ERROR: Could not open requirements file:
[Errno 2] No such file or directory: 'requirements.txt'
==> Build failed 😞
```

Nothing was wrong with the code. The service was building from the **repo
root**, and there is no `requirements.txt` there — this repo holds two
deployables in subfolders:

```
Project/
├── render.yaml          <- Blueprint (must be at the root)
├── buildiq-backend/     <- requirements.txt lives HERE
└── buildiq-frontend/
```

The build needs to run *inside* `buildiq-backend/`. That's what `rootDir`
does, and it's now set in the root `render.yaml`.

---

## Fix it (pick one)

### Option A — Blueprint (recommended, deploys both services)

1. Push these changes: `git push origin main`
2. Render → **New → Blueprint** → select this repo
3. Render reads `/render.yaml` and creates **buildiq-api** + **buildiq-frontend**
4. Fill in the secrets it prompts for (see below)

### Option B — Fix the existing service by hand

In your current `Constructionai` service → **Settings**:

| Field | Set it to |
|---|---|
| Root Directory | `buildiq-backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

Then **Environment** → add `PYTHON_VERSION` = `3.13.4` (see the warning below),
plus the secrets. Save and **Manual Deploy**.

Setting *Root Directory* alone fixes the error in your screenshot.

---

## ⚠️ The second problem, waiting behind the first

Your log shows:

```
==> Using Python version 3.14.3 (default)
```

Render defaulted to **3.14**. Several dependencies (`bcrypt`, `pydantic`,
`cryptography` via `python-jose`) ship compiled wheels, and at time of writing
they had no `cp314` builds — so pip falls back to compiling from source, which
typically fails on Render's build image with a Rust/C toolchain error.

You'd have fixed the `requirements.txt` error only to hit a wall of compiler
output. So this is pinned in two places now:

- `render.yaml` → `PYTHON_VERSION: "3.13.4"`
- `buildiq-backend/.python-version` → `3.13.4`

**Note:** the old value was `"3.13"`. Render wants a **full `x.y.z` version**;
a two-part value can be ignored, silently handing you the default again. Always
write `3.13.4`, not `3.13`.

---

## Environment variables

Set these in the Render dashboard — never commit them.

| Variable | Required | Notes |
|---|---|---|
| `SECRET_KEY` | yes | JWT signing. Render can auto-generate it. |
| `DATABASE_URL` | yes | Supabase Postgres connection string. Omit → SQLite, wiped on every deploy. |
| `CORS_ORIGINS` | yes | Your frontend URL, e.g. `https://buildiq-frontend.onrender.com` |
| `SUPABASE_URL` | no | Needed only for Supabase Storage uploads. |
| `SUPABASE_SERVICE_KEY` | no | Falls back to local disk if unset. |
| `GROQ_API_KEY` | no | Without it, AI features use the deterministic fallback. |
| `SEED_ON_STARTUP` | no | `true` populates demo data on first boot. |
| `ENV` | no | `production` disables the dev-only reset-token echo. |

### Supabase connection string

Use the **pooler** URI (port `6543`) and force the SQLAlchemy driver:

```
postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Run the migrations once before first boot:

```bash
psql "$DATABASE_URL" -f buildiq-backend/supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f buildiq-backend/supabase/migrations/0002_rls_policies.sql
```

---

## Point the frontend at the API

`buildiq-frontend/js/config.js` currently runs in mock mode:

```js
MOCK_MODE: true,
API_BASE: ... "https://buildiq-api.onrender.com",
```

To use the real backend, set `MOCK_MODE: false` and make `API_BASE` match your
deployed API URL. Leaving it `true` is fine for a demo — the frontend then runs
entirely in the browser and needs no backend at all.

---

## Verify

```bash
curl https://<your-api>.onrender.com/health
# {"status":"online","database":"connected",...}
```

Then open `https://<your-frontend>.onrender.com/` for staff sign-in, or
`/admin.html` for the administrator portal.

**Free-tier note:** the instance sleeps after inactivity, so the first request
can take ~50 seconds. That's cold start, not a bug.
