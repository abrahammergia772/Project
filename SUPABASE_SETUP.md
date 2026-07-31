# Supabase-only setup

> **The API now refuses to start without `DATABASE_URL`.** There is no SQLite
> fallback. If the variable is missing the deploy fails with an explicit
> message in the Render log rather than coming up "healthy" while throwing
> away every signup.

# Why your users and files aren't in Supabase

## Short answer

`SUPABASE_URL` and `DATABASE_URL` are **two different settings**, and you only
set the first one.

| Setting | Controls | You set it? |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | **File storage only** (uploaded documents) | ✅ yes |
| `DATABASE_URL` | **The database** — users, emails, passwords, projects, attendance | ❌ **no** |

Your Render log says:

```
buildiq: Database: sqlite:///./buildiq.db
```

That's a local file on Render's disk, not Supabase. So the app *is* storing
your email and password — just into a throwaway file that **Render deletes on
every deploy, restart, and free-tier sleep.** Nothing was ever written to your
Supabase tables, which is why they look empty.

`/health` said `"database": "connected"`, which hid this: SQLite connects
perfectly well. It just isn't permanent. `/health` now also reports
`database_backend` and `data_persistent` so you can see the difference.

---

## Your project's exact values

From your dashboard:

| Field | Value |
|---|---|
| Project ID (ref) | `ocfyddxklqephrvxqgfb` |
| Region | `us-east-2` (East US, Ohio) |
| Postgres | 17.6.1.155 |
| Plan | Free |

So your `DATABASE_URL` is this, with only the password to fill in:

```
postgresql+psycopg://postgres.ocfyddxklqephrvxqgfb:YOURPASSWORD@aws-0-us-east-2.pooler.supabase.com:6543/postgres
```

And `SUPABASE_URL` is exactly:

```
https://ocfyddxklqephrvxqgfb.supabase.co
```

> **Check the pooler prefix.** It is usually `aws-0-`, but some newer projects
> use `aws-1-`. Both hostnames exist for us-east-2, so don't guess — copy the
> host from **Project Settings → Database → Connection string → URI** and use
> whatever it shows.

> **Must use the pooler.** On the free tier the direct host
> (`db.ocfyddxklqephrvxqgfb.supabase.co`) is IPv6-only, and Render's outbound
> network is IPv4. Connecting directly will fail with "Network is unreachable";
> the pooler on port `6543` is IPv4 and works.

### Don't have the database password?

It is **not** your Supabase account password, and it is only shown once at
project creation. If you don't have it: **Project Settings → Database →
Database password → Reset database password**. Copy the new one immediately.

---

## Fix: set `DATABASE_URL`

### 1. Get the connection string

Supabase dashboard → **Project Settings → Database → Connection string** →
**URI** tab. Choose **Session pooler** (port `6543`). It looks like:

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
```

### 2. Adapt it for SQLAlchemy

Two edits:

- Change `postgresql://` to **`postgresql+psycopg://`** (this project uses psycopg 3)
- Replace `[YOUR-PASSWORD]` with your real database password

Final value:

```
postgresql+psycopg://postgres.abcdefgh:YOURPASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
```

> If the password contains `@ : / ? # &`, URL-encode it — otherwise the URI
> parses wrongly. `@` → `%40`, `#` → `%23`, `/` → `%2F`.

### 3. Create the tables

Supabase dashboard → **SQL Editor** → paste and run, in order:

1. `buildiq-backend/supabase/migrations/0001_schema.sql`
2. `buildiq-backend/supabase/migrations/0002_rls_policies.sql`

Or from a terminal:

```bash
psql "$DATABASE_URL" -f buildiq-backend/supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f buildiq-backend/supabase/migrations/0002_rls_policies.sql
```

The app also calls `create_all()` at boot, so tables appear even without this —
but running the migrations gives you the indexes and RLS policies too.

### 3b. Test the string before deploying

Rather than deploying and reading logs, validate it locally:

```bash
cd buildiq-backend
pip install -r requirements.txt
python3 check_db.py "postgresql+psycopg://postgres.ocfyddxklqephrvxqgfb:YOURPASSWORD@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
```

It checks the URI shape first (driver, host, port, username, password
encoding), then connects and lists your tables and user count. Each failure
maps to a specific cause — wrong password, paused project, IPv6-only host,
unencoded special character — instead of a raw driver traceback.

---

### 4. Set it on Render

**API service → Environment → Add Environment Variable**

| Key | Value |
|---|---|
| `DATABASE_URL` | the `postgresql+psycopg://...` string above |
| `ENV` | `production` |
| `CORS_ORIGINS` | your frontend origin, e.g. `https://buildiq-frontend.onrender.com` |

Save → Render redeploys.

### 5. Confirm

```bash
curl https://constructionai-q9er.onrender.com/health
```

You want:

```json
{
  "database_backend": "postgres (supabase)",
  "data_persistent": true,
  "env": "production"
}
```

Then in Supabase → **Table Editor** you'll see `users`, `projects`,
`attendance` and the rest, with rows in them.

---

## About passwords

Passwords are **never stored as text.** Signup runs them through bcrypt and
saves only the hash:

```
$2b$12$Xq3...   ← what lands in users.hashed_password
```

That's correct and deliberate — you will not see readable passwords in the
`users` table, and you shouldn't. Login re-hashes the attempt and compares.
Nobody, including you, can read a user's password back out.

---

## About files

`storage: supabase` in `/health` means uploads *are* going to Supabase Storage.
But while `DATABASE_URL` is unset there's a mismatch worth knowing about: the
**file** goes to Supabase and survives, while the **database row describing
it** (name, owner, project) lives in the throwaway SQLite file. After a restart
the bytes are still in your bucket, but nothing points at them.

Fixing `DATABASE_URL` fixes this too.

Also check the bucket exists: earlier logs showed
`Could not verify Supabase bucket`, caused by `SUPABASE_URL` being set to the
REST endpoint. Use the **bare project URL** (`https://<ref>.supabase.co`), and
make sure `SUPABASE_SERVICE_KEY` is the **`service_role`** key — the `anon` key
can't create buckets.

---

## Losing the demo data

Once `SEED_ON_STARTUP=true` runs against real Postgres it inserts the 46 demo
users once. After you have real users, set `SEED_ON_STARTUP=false` so demo
records stop being recreated.
