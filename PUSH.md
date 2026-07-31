# Pushing this work to GitHub

I can't push for you: this sandbox has no GitHub credentials — no token, no
SSH key, no `gh` CLI. Only you can authenticate. Everything else is done, so
this is one command.

---

## The command

```bash
git push origin main
```

That's it. No `--force` needed, and no `--force` should be used.

---

## Why it's safe

The two histories had **diverged**:

- 32 commits on GitHub that weren't here (your web-UI uploads)
- 19 commits here that weren't on GitHub (the reviewed work)

A force-push would have destroyed your 32 commits. Instead I checked what was
actually in them, then merged.

**Every shared file on GitHub was an older copy of what is here.** Verified
individually — for example GitHub's `app/main.py` was missing the CORS
credentials fix, and `sample_data.sql`, `data-store.js`, `app-events.js` and
the four new test modules were absent entirely.

The **only** file unique to GitHub was `buildiq-backend/tests/a`: a 1-byte
placeholder the web UI creates when you add an empty folder. Removed.

The merge used `-X ours` to keep the newer local content, and GitHub's history
is now an ancestor of `main` — so the push fast-forwards cleanly and nothing on
GitHub is lost.

### If you want to double-check first

```bash
git log --oneline origin/main..HEAD    # what will be added
git diff --stat origin/main..HEAD      # what will change
```

### Safety net

The exact pre-merge GitHub state is kept on a local branch:

```bash
git log --oneline github-backup -1     # c4580cb Update config.js
```

If anything looks wrong you can inspect or restore any file from it:

```bash
git checkout github-backup -- path/to/file
```

Delete it once you're happy: `git branch -D github-backup`

---

## One thing the merge broke, and I fixed

`-X ours` resolves conflicts in favour of local content — but `reports.html`
existed **only** on the GitHub side, so the merge deleted it, dropping the
frontend from 16 pages to 15. Caught by counting pages afterwards and restored
in the following commit. Worth knowing that `-X ours` can silently remove
files that exist on one side only.

---

## Verified before handing this over

- 148 backend tests pass on the merged tree
- `verify_frontend` 170, `verify_admin_portal` 88, `matrix_check` 81,
  `verify_ai_features` 130 — all green
- All three `sample_data.sql` fixes survived the merge
  (`experience_years = 0`, lowercase severity, `reason_status = 'Accepted'`)
- All 16 frontend pages present

---

## After pushing

Render deploys from GitHub, so the push is what actually updates your live
services. Then, on the **API** service (Environment tab):

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | Supabase pooler URI | **Data is currently wiped on every restart** |
| `ENV` | `production` | `/docs` is public and forgot-password leaks a reset token |
| `CORS_ORIGINS` | `https://cmsai.onrender.com` | Already set — keep it exact |

See `SUPABASE_SETUP.md` for the connection string format, and run
`python3 buildiq-backend/check_db.py "<your URI>"` to validate it before
deploying.
