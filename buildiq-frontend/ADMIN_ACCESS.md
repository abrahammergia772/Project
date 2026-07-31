# Administrator Portal — how to reach it

The administrator sign-in page is a normal file that ships with the frontend:
**`admin.html`**. There is nothing extra to deploy, enable, or configure.

Take whatever URL your staff use and put `admin.html` at the end instead of
`index.html`.

| Where you're running it | Administrator link |
|---|---|
| Opening files directly from disk | `file:///.../buildiq-frontend/admin.html` |
| Local dev server (`python3 -m http.server 8080`) | `http://localhost:8080/admin.html` |
| Render / Netlify / Vercel | `https://your-site.onrender.com/admin.html` |
| Custom domain | `https://buildiq.et/admin.html` |
| GitHub Pages (project site) | `https://<user>.github.io/<repo>/buildiq-frontend/admin.html` |

Rule of thumb: **staff URL, with `index.html` swapped for `admin.html`.**
If your staff URL ends in just `/`, append `admin.html` to it.

---

## Who it's for

Only these three roles can sign in here:

- Super Admin
- General Manager
- Auditor

Everyone else (Department Manager, Project Manager, Engineer, Client) is
turned away and sent to the staff page, even with a correct password.

Conversely, those three roles **cannot** sign in on the public staff page. If
they try, they're redirected here automatically — so if you ever forget the
link, just sign in normally at `index.html` and you'll be brought here.
**That is the reliable way to rediscover the portal.**

---

## Why there's no link to it

The portal is deliberately unlisted:

- No link anywhere on the public sign-in page.
- Tagged `noindex, nofollow` so search engines never list it.
- Sends no referrer, so the address doesn't leak to third-party sites.

Be honest about what this buys you: **it is obscurity, not security.** Anyone
who guesses the filename can load the page. It stops the administrative door
being advertised to every visitor and casual passer-by; it is not what keeps
attackers out. Passwords and server-side authorization do that — every single
API request is authorized by role on the backend regardless of which page the
request came from.

So: don't treat the URL as a secret worth protecting, and don't relax password
policy because "nobody knows the address."

---

## Practical suggestions

**Bookmark it.** The intended workflow is that admins bookmark the link once.

**Sharing it with a new admin:** send the link over the same channel you'd send
any internal link. It isn't a credential, so it doesn't need special handling —
but there's also no reason to post it publicly.

**Want a memorable path instead?** `admin.html` is a plain static file, so any
host that supports rewrites can alias it. Examples:

- *Netlify* — in `_redirects`: `/admin  /admin.html  200`
- *Vercel* — in `vercel.json` `rewrites`: `{ "source": "/admin", "destination": "/admin.html" }`
- *Nginx* — `location = /admin { try_files /admin.html =404; }`

Render static sites don't rewrite by default; the `.html` link works fine there.

**If you want it genuinely restricted** rather than merely unlisted, put a real
control in front of it — that's a hosting-layer job, not a frontend one:

- HTTP Basic Auth on the `/admin.html` path
- An IP allowlist limited to the office network
- A VPN-only hostname
- Best of all: enable multi-factor authentication on the admin accounts, which
  protects them no matter which page the login happens on

---

## Demo accounts

All use password `Demo1234!`:

| Role | Email |
|---|---|
| Super Admin | `admin@buildiq.et` |
| General Manager | `gm@buildiq.et` |
| Auditor | `auditor@buildiq.et` |

The portal also has three one-click demo buttons for these.

---

## Audit trail

Every sign-in through this page is recorded as `ADMIN_PORTAL_LOGIN` rather than
a plain `LOGIN`. That distinction is useful: an oversight account showing up as
a plain `LOGIN` means it came through the public page, which is worth a look.

View them under **Audit → filter by action**, or via the API:

```
GET /audit/logs?action=ADMIN_PORTAL_LOGIN
```
