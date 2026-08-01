"""Generate a cold-start audit dataset shaped like a construction firm.

WHY THIS EXISTS
---------------
You have ~84 seeded audit rows. Nothing can be trained on that, and no public
dataset matches your taxonomy (see ml/README.md §2). This generates events
using YOUR seven audit types, YOUR 36 action codes and YOUR seven roles, so
the pipeline can be built and tested today.

WHAT THIS IS NOT
----------------
This is not your organisation's data and a model trained on it has not learned
anything true about your staff -- it has learned the assumptions written
below. Its purpose is to prove the plumbing works and to give you something to
demo. Every artifact trained from it is tagged "synthetic" so it can never be
mistaken for the real thing.

The assumptions are listed explicitly rather than buried, so you can judge
whether they match your reality -- and so it is obvious what a model would be
absorbing if you trained on this.
"""
from __future__ import annotations

import argparse
import csv
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --- Assumptions baked into this generator. Change them to match your site. ---
# 1. Normal work happens 07:00-18:00, Monday to Saturday (Ethiopian six-day week).
# 2. Site roles start earlier than office roles: engineers from 06:00.
# 3. Each role mostly performs actions belonging to its own audit types.
# 4. A small fraction of users behave maliciously for a bounded stretch of
#    days (default 5% of users, which yields well under 1% of EVENTS -- real
#    insider data is extremely imbalanced; CERT r4.2 is ~0.03% of events).
# 5. Malicious behaviour = off-hours bursts, rare-for-role actions, bulk export.
WORK_START, WORK_END = 7, 18
SITE_ROLES = {"Engineer", "Project Manager"}

ROLE_ACTIONS: dict[str, list[str]] = {
    "Super Admin": ["LOGIN", "LOGOUT", "PERMISSION_CHANGE", "UPDATE_RECORD",
                    "VIEW_SENSITIVE", "REPORT_GENERATE", "SUSPEND_USER", "BULK_EDIT"],
    "General Manager": ["LOGIN", "LOGOUT", "PAYMENT_APPROVAL", "BUDGET_MODIFY",
                        "REPORT_GENERATE", "EXPORT_DATA", "VIEW_SENSITIVE", "UPDATE_RECORD"],
    "Department Manager": ["LOGIN", "LOGOUT", "UPDATE_RECORD", "EXPENSE_CLAIM",
                           "LATE_SUBMISSION", "REPORT_GENERATE", "MATERIAL_OVERUSE",
                           "CONTRACTOR_REVIEW", "FILE_UPLOAD"],
    "Project Manager": ["LOGIN", "LOGOUT", "UPDATE_RECORD", "MILESTONE_DELAY",
                        "EQUIPMENT_CHECKOUT", "EQUIPMENT_UNRETURNED", "MATERIAL_OVERUSE",
                        "FILE_UPLOAD", "CONTRACTOR_REVIEW"],
    "Engineer": ["LOGIN", "LOGOUT", "UPDATE_RECORD", "FILE_UPLOAD",
                 "EQUIPMENT_CHECKOUT", "INCOMPLETE_RECORD", "DUPLICATE_ENTRY"],
    "Auditor": ["LOGIN", "LOGOUT", "VIEW_SENSITIVE", "REPORT_GENERATE",
                "EXPORT_DATA", "POLICY_VIOLATION"],
    "Client": ["LOGIN", "LOGOUT", "VIEW_SENSITIVE", "FILE_UPLOAD"],
}

# Actions an attacker reaches for that are rare or forbidden for most roles.
MALICIOUS_ACTIONS = [
    "UNAUTHORIZED_ACCESS", "BULK_DELETE", "EXTERNAL_SHARE", "EXPORT_DATA",
    "INVOICE_DELETE", "APPROVAL_BYPASS", "UNAPPROVED_EDIT", "ROLE_MISUSE",
    "RECORD_DELETE", "POST_APPROVAL_EDIT", "EXTERNAL_IMPORT", "DORMANT_ACCESS",
]

ACTION_TO_TYPE = {
    "LOGIN": "SECURITY", "LOGIN_FAILED": "SECURITY", "LOGOUT": "SECURITY",
    "IP_CHANGE": "SECURITY", "UNAUTHORIZED_ACCESS": "SECURITY", "PERMISSION_CHANGE": "SECURITY",
    "PAYMENT_APPROVAL": "FINANCIAL", "BUDGET_MODIFY": "FINANCIAL", "INVOICE_CREATE": "FINANCIAL",
    "INVOICE_DELETE": "FINANCIAL", "EXPENSE_CLAIM": "FINANCIAL",
    "APPROVAL_BYPASS": "COMPLIANCE", "LATE_SUBMISSION": "COMPLIANCE",
    "INCOMPLETE_RECORD": "COMPLIANCE", "POLICY_VIOLATION": "COMPLIANCE",
    "BULK_DELETE": "USER_ACTIVITY", "BULK_EDIT": "USER_ACTIVITY", "ROLE_MISUSE": "USER_ACTIVITY",
    "DORMANT_ACCESS": "USER_ACTIVITY", "VIEW_SENSITIVE": "USER_ACTIVITY",
    "UPDATE_RECORD": "DATA_INTEGRITY", "UNAPPROVED_EDIT": "DATA_INTEGRITY",
    "RECORD_DELETE": "DATA_INTEGRITY", "DUPLICATE_ENTRY": "DATA_INTEGRITY",
    "EXTERNAL_IMPORT": "DATA_INTEGRITY",
    "MATERIAL_OVERUSE": "PROJECT_RESOURCE", "EQUIPMENT_CHECKOUT": "PROJECT_RESOURCE",
    "EQUIPMENT_UNRETURNED": "PROJECT_RESOURCE", "MILESTONE_DELAY": "PROJECT_RESOURCE",
    "CONTRACTOR_REVIEW": "PROJECT_RESOURCE",
    "REPORT_GENERATE": "REPORT_DOCUMENT", "EXPORT_DATA": "REPORT_DOCUMENT",
    "EXTERNAL_SHARE": "REPORT_DOCUMENT", "POST_APPROVAL_EDIT": "REPORT_DOCUMENT",
    "FILE_UPLOAD": "REPORT_DOCUMENT", "DELETE_DOCUMENT": "REPORT_DOCUMENT",
}

RESOURCES = {
    "SECURITY": ["auth/login", "settings/permissions", "admin/console"],
    "FINANCIAL": ["finance/invoices", "projects/budget", "finance/payments"],
    "COMPLIANCE": ["compliance/approvals", "documents/permits"],
    "USER_ACTIVITY": ["members", "tasks/bulk", "users/roles"],
    "DATA_INTEGRITY": ["projects/proj_3", "materials/ledger", "attendance/records"],
    "PROJECT_RESOURCE": ["equipment/registry", "projects/milestones"],
    "REPORT_DOCUMENT": ["reports/export", "documents/drawings.pdf"],
}

DEPARTMENTS = ["Structural", "Site Operations", "Finance", "Compliance",
               "Workforce & Attendance", "Executive", "Design"]

FIRST = ["Abebe", "Meron", "Samuel", "Hana", "Dawit", "Tigist", "Yonas", "Selam",
         "Bereket", "Marta", "Kidus", "Rahel", "Getachew", "Almaz", "Solomon", "Eden"]
LAST = ["Tadesse", "Alemayehu", "Girma", "Bekele", "Haile", "Mengistu",
        "Worku", "Desta", "Assefa", "Tesfaye"]


def _make_users(n: int, rnd: random.Random) -> list[dict]:
    roles = (["Super Admin"] + ["General Manager"] + ["Auditor"] * 2 +
             ["Department Manager"] * max(2, n // 8) +
             ["Project Manager"] * max(2, n // 6) +
             ["Client"] * max(1, n // 12))
    roles += ["Engineer"] * max(1, n - len(roles))
    rnd.shuffle(roles)

    users, seen = [], set()
    for i in range(n):
        while True:
            name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
            if name not in seen:
                seen.add(name)
                break
        role = roles[i % len(roles)]
        users.append({
            "name": name,
            "role": role,
            "department": "Executive" if role in ("Super Admin", "General Manager")
                          else "Compliance" if role == "Auditor"
                          else rnd.choice(DEPARTMENTS),
            # Personal rhythm: everyone has their own start hour and volume.
            "start_hour": (6 if role in SITE_ROLES else 8) + rnd.randint(-1, 2),
            "daily_events": max(2, int(rnd.gauss(12 if role != "Client" else 3, 5))),
        })
    return users


def _work_hour(user: dict, rnd: random.Random) -> int:
    """An hour drawn from this user's own routine, not a global 9-to-5."""
    h = int(rnd.gauss(user["start_hour"] + 4, 3))
    return max(0, min(23, h))


def generate(days: int, n_users: int, seed: int, malicious_pct: float) -> list[dict]:
    rnd = random.Random(seed)
    users = _make_users(n_users, rnd)

    n_bad = max(1, int(len(users) * malicious_pct))
    bad_users = set(rnd.sample([u["name"] for u in users], n_bad))
    # Each insider is only malicious for a bounded stretch -- real insider
    # activity is episodic, not a permanent state. Campaigns run 5-21 days,
    # which is what the literature reports for data-theft cases.
    # Campaign start is spread across the WHOLE timeline. An earlier version
    # clamped every start into the first stretch, so a chronological
    # train/test split left the holdout with zero positives and nothing could
    # be measured. Insiders turn at arbitrary times; the data must reflect it.
    bad_windows = {
        name: (start := rnd.randint(5, max(6, days - 6)),
               start + rnd.randint(5, 21))
        for name in bad_users
    }

    start = datetime.now(timezone.utc) - timedelta(days=days)
    rows: list[dict] = []

    for day in range(days):
        date = start + timedelta(days=day)
        if date.weekday() == 6:              # Sunday: skeleton activity only
            active = [u for u in users if rnd.random() < 0.08]
        else:
            active = [u for u in users if rnd.random() < 0.92]

        for user in active:
            n = max(1, int(rnd.gauss(user["daily_events"], user["daily_events"] / 3)))
            in_bad_window = (
                user["name"] in bad_users
                and bad_windows[user["name"]][0] <= day <= bad_windows[user["name"]][1]
            )

            for _ in range(n):
                action = rnd.choice(ROLE_ACTIONS.get(user["role"], ["LOGIN"]))
                hour = _work_hour(user, rnd)
                label = 0

                # Benign noise: occasional genuine late work and failed logins.
                # Without this the model learns "night == attack", which is the
                # exact false-positive problem the rule engine already has.
                if rnd.random() < 0.03:
                    hour = rnd.choice([5, 6, 20, 21, 22])
                if rnd.random() < 0.02:
                    action = "LOGIN_FAILED"

                if in_bad_window and rnd.random() < 0.35:
                    action = rnd.choice(MALICIOUS_ACTIONS)
                    hour = rnd.choice([0, 1, 2, 3, 4, 23])
                    label = 1

                ts = date.replace(hour=hour, minute=rnd.randint(0, 59),
                                  second=rnd.randint(0, 59), microsecond=0)
                atype = ACTION_TO_TYPE.get(action, "USER_ACTIVITY")
                rows.append({
                    "user": user["name"],
                    "user_role": user["role"],
                    "department": user["department"],
                    "action": action,
                    "audit_type": atype,
                    "resource": rnd.choice(RESOURCES[atype]),
                    "timestamp": ts.isoformat(),
                    "label": label,
                })

            # Exfiltration burst: many actions in one hour, the signature the
            # per-event rule engine structurally cannot see.
            if in_bad_window and rnd.random() < 0.4:
                burst_hour = rnd.choice([1, 2, 3, 23])
                for k in range(rnd.randint(8, 25)):
                    ts = date.replace(hour=burst_hour, minute=min(59, k * 2),
                                      second=rnd.randint(0, 59), microsecond=0)
                    action = rnd.choice(["EXPORT_DATA", "EXTERNAL_SHARE", "VIEW_SENSITIVE"])
                    atype = ACTION_TO_TYPE[action]
                    rows.append({
                        "user": user["name"], "user_role": user["role"],
                        "department": user["department"], "action": action,
                        "audit_type": atype, "resource": rnd.choice(RESOURCES[atype]),
                        "timestamp": ts.isoformat(), "label": 1,
                    })

    rows.sort(key=lambda r: r["timestamp"])
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--users", type=int, default=40)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--malicious-pct", type=float, default=0.05)
    ap.add_argument("--out", default="ml/data/synthetic.csv")
    args = ap.parse_args()

    rows = generate(args.days, args.users, args.seed, args.malicious_pct)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    n_bad = sum(r["label"] for r in rows)
    print(f"Wrote {len(rows):,} events to {out}")
    print(f"  users        : {args.users}")
    print(f"  days         : {args.days}")
    print(f"  malicious    : {n_bad:,} ({n_bad / len(rows) * 100:.2f}%)")
    print(f"  audit types  : {len({r['audit_type'] for r in rows})}/7")
    if n_bad < 50:
        print()
        print(f"  WARNING: only {n_bad} positive examples. Raise --malicious-pct or")
        print("  --days before trusting any supervised metric computed on this.")
    print()
    print("REMINDER: synthetic data. A model trained on this has learned this")
    print("generator's assumptions, not your organisation. See ml/README.md.")


if __name__ == "__main__":
    main()
