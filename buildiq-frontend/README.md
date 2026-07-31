# BuildIQ Frontend

AI-Powered Construction Organization Management System — frontend only, pure
HTML/CSS/JavaScript, no frameworks.

## Running it

No build step needed. Just serve the folder statically, e.g.:

```bash
cd buildiq-frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

## Mock mode (works with zero backend)

By default the app runs in **mock mode** (`js/config.js` → `BUILDIQ_CONFIG.MOCK_MODE = true`).
All data comes from `js/mock-data.js` and simulated responses in `js/api.js`, so every
page, chart, modal, and role works immediately without Supabase, Groq, or trained ML models.

On the login screen, click any of the **role chips** to instantly sign in as a demo user
with that role: **Super Admin, General Manager, Department Manager, Engineer, Auditor,
Client**. Or sign up through the 3-step form — the form adapts (e.g. Client signup asks
for company + linked project instead of internal department/job title).

## Roles & permissions

| Role | Scope |
|---|---|
| **Super Admin** | Full system access — all data, all departments, user management, audit logs, AI model/rules config. |
| **General Manager** | Organization-wide oversight — same visibility as Super Admin over projects/members/complaints/reports, but no audit-log or rules access. |
| **Department Manager** | Scoped to their own department only — members, projects, complaints (read + resolve), department-scoped reports. |
| **Engineer** | Personal access — own tasks/schedule, own/department projects (read), submit-only complaints. |
| **Auditor** | Read-only — audit logs, anomaly review, compliance reports. No project/member/complaint access. |
| **Client** *(new, external)* | Sees only their own linked project(s), can submit/track their own complaints, generate a project status report, use the AI chatbot. |

Centralized in `js/roles.js` (`Roles.*` helpers) and enforced per-page in `js/router.js`
(`Router.ACCESS` matrix). Sidebar nav items are hidden automatically per role.

## Feature highlights (this update)

- **#4 Department drill-down** — `departments.html`: click any department card to open a
  full detail panel: description, scope of work, budget, an **AI department health
  score** (0-100, computed from delay risk / open complaints / on-time %), and tabs for
  Members / Projects / Complaints. Department Managers and Engineers only ever see their
  own department; Super Admin, General Manager and Auditor see all.
- **#5 AI task prioritization + personal schedule** — `tasks.html`: every task is scored
  by `js/ai-engine.js` (`AIEngine.scoreTask`) blending due-date urgency, project delay
  risk, and whether it blocks other work, producing a 0-100 score, a priority tier
  (CRITICAL/HIGH/MEDIUM/LOW), and a plain-language reason. "AI Prioritize" re-ranks on
  demand. The **My Schedule** tab auto-places the highest-priority open tasks into a
  Mon–Fri weekly slot grid (`AIEngine.autoSchedule`); users can also manually place or
  remove tasks in any slot. Managers/Admins get an additional "Team/Department Tasks"
  view ranked the same way.
- **#6 Role-scoped complaints with AI-suggested resolutions** — `complaints.html`: Super
  Admin & General Manager can read and resolve any complaint; Department Managers can
  resolve only complaints routed to their department; Engineers and Clients can only
  submit and track their own. Anyone who can resolve gets a **"Suggest Solution with
  AI"** button (`AIEngine.suggestComplaintSolution`) that drafts a category-aware
  resolution they can edit before marking the complaint resolved.
- **#7 Role-scoped report generation** — `reports.html`: the list of generatable report
  types and the scope selector both adapt to the signed-in role (e.g. a Department
  Manager only sees department-level report types with the scope locked to their
  department; a Client only sees "My Project Status Report"; Engineers see no report
  access at all, matching the access matrix).
- **Client role** — a full external-facing experience: role-scoped dashboard (project
  progress, complaints, quick report link), project visibility limited to their own
  linked project, and a dedicated signup path (company name + linked project instead of
  internal org fields).
- **AI Executive Summary** — org-wide dashboards (Super Admin / General Manager) and the
  Department Manager dashboard show a short natural-language AI summary of current risk,
  complaints, and recommended focus, generated locally from live mock data.
- **User Management → Client accounts tab** — Super Admin / General Manager can manage
  both internal staff and external client accounts from one page.

## Connecting the real backend

Set `MOCK_MODE: false` in `js/config.js` and point `API_BASE` at your FastAPI backend.
`js/api.js` documents the intended real endpoints for every mock call, including the new
AI ones: `POST /tasks/ai/prioritize`, `POST /tasks/ai/schedule`,
`POST /complaints/ai/suggest-solution`. No other frontend code changes are needed.

## Structure

- `js/roles.js` — centralized role-capability logic (who can see/resolve/generate what)
- `js/ai-engine.js` — client-side AI heuristics: task scoring, auto-scheduling,
  department health scoring, complaint solution suggestions, report narrative generation
- `js/router.js` — page-level access control matrix
- `js/shell.js` — shared sidebar/topbar renderer, role-aware nav + badges
- `js/mock-data.js` — seeded demo data: members, clients, departments, projects, tasks,
  complaints, audit logs
- `js/components.js`, `js/utils.js`, `js/api.js`, `js/auth.js` — shared infrastructure
- `js/pages/*.js` — one controller per page

## Pages

`index.html` (login/signup, 6 roles), `dashboard.html` (role-aware for all 6 roles),
`members.html`, `departments.html` (with detail drill-down), `projects.html`
(cards/table/Gantt), `tasks.html` (AI priority + schedule), `complaints.html`
(role-scoped read/resolve/submit), `audit.html`, `reports.html` (role-scoped),
`chatbot.html`, `documents.html`, `settings.html`, `user_management.html` (staff +
clients).

## Notes

- Verified with an automated headless-browser pass across all 12 pages × 6 roles (72
  combinations): correct role-based redirects matching the access matrix exactly, zero
  console errors.
- Responsive: desktop full sidebar, tablet icon-only sidebar, mobile burger menu + bottom nav.
- Respects `prefers-reduced-motion`, visible focus rings, ARIA labels on icon buttons.
