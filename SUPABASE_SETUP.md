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
