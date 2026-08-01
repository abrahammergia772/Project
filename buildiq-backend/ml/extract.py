"""Pull real audit_logs out of the database into a training CSV.

This is the one that matters. Everything else in this directory is
scaffolding for the day you run this and get enough rows back.

Labels come from reviewer verdicts recorded by POST /audit/feedback:

    review_status = 'Confirmed Threat'  -> label 1
    review_status = 'False Alarm'       -> label 0
    anything else                       -> label None (never reviewed)

Unreviewed rows are still exported: unsupervised training uses all of them,
and they are what the per-user baselines are built from.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

LABEL_MAP = {"Confirmed Threat": 1, "False Alarm": 0}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="ml/data/real.csv")
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    ap.add_argument("--limit", type=int, default=1_000_000)
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit(
            "No DATABASE_URL. Pass --database-url, or export the same value\n"
            "the API uses (Render dashboard -> Environment -> DATABASE_URL)."
        )

    os.environ["DATABASE_URL"] = args.database_url
    os.environ.setdefault("ALLOW_SQLITE", "true")   # so a local sqlite copy works too
    os.environ.setdefault("SECRET_KEY", "extract-only")

    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from app.models import AuditLog

    engine = create_engine(args.database_url)
    with Session(engine) as db:
        logs = list(db.scalars(
            select(AuditLog).order_by(AuditLog.timestamp.asc()).limit(args.limit)
        ).all())

    if not logs:
        raise SystemExit("audit_logs is empty -- nothing to extract yet.")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["user", "user_role", "action", "audit_type",
                    "resource", "timestamp", "label"])
        for lg in logs:
            w.writerow([
                lg.user or "unknown", lg.user_role or "unknown", lg.action,
                lg.audit_type, lg.resource or "",
                lg.timestamp.isoformat() if lg.timestamp else "",
                LABEL_MAP.get(lg.review_status, ""),
            ])

    labelled = Counter(LABEL_MAP[lg.review_status] for lg in logs
                       if lg.review_status in LABEL_MAP)
    span = (logs[-1].timestamp - logs[0].timestamp).days if len(logs) > 1 else 0

    print(f"Wrote {len(logs):,} events to {out}")
    print(f"  users        : {len({lg.user for lg in logs})}")
    print(f"  span         : {span} days")
    print(f"  audit types  : {len({lg.audit_type for lg in logs})}/7")
    print(f"  reviewed     : {sum(labelled.values()):,} "
          f"({labelled.get(1, 0)} confirmed, {labelled.get(0, 0)} false alarms)")

    print()
    if len(logs) < 10_000 or span < 30:
        print("NOT ENOUGH YET for meaningful per-user baselines.")
        print("Target: ~10,000+ events across 30+ days. Keep the system running")
        print("and re-run this later; ml/synth.py covers you in the meantime.")
    elif sum(labelled.values()) < 200:
        print("Enough events for UNSUPERVISED training:")
        print(f"  python ml/train.py --data {out}")
        print()
        print("For supervised training you need ~200+ reviewer verdicts (you have"
              f" {sum(labelled.values())}).")
        print("Ask your Auditor to work through flagged entries with the Confirm")
        print("Threat / False Alarm buttons -- each click is one training label.")
    else:
        print("Ready for both:")
        print(f"  python ml/train.py --data {out}")
        print(f"  python ml/train.py --data {out} --supervised")


if __name__ == "__main__":
    main()
