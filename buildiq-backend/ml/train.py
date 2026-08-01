"""Train the audit anomaly model.

Two modes:

  unsupervised (default)  IsolationForest over behavioural features. Needs no
                          labels, which is the realistic starting point: your
                          logs have no "this was an attack" column.

  --supervised            GradientBoosting over reviewer verdicts from
                          POST /audit/feedback. Far better, but only once your
                          Auditor has actually reviewed a few hundred entries.

On metrics
----------
Anomaly detection on imbalanced data makes accuracy meaningless: predicting
"nothing is ever an anomaly" scores 99.3% on this dataset. This script refuses
to print accuracy and reports precision/recall/PR-AUC instead, plus the
precision at the alert volume a human can actually work through -- because an
auditor who can review 20 items a day does not care about anything below
rank 20.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.features import (  # noqa: E402
    FEATURE_NAMES, Baselines, Event, build_baselines, explain, featurize,
)

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"


def load_events(path: Path) -> list[Event]:
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"{path} is empty")
    out = []
    for r in rows:
        lab = r.get("label")
        r = dict(r)
        r["label"] = int(lab) if lab not in (None, "", "None") else None
        out.append(Event.from_row(r))
    return out


def time_split(events: list[Event], frac: float = 0.7) -> tuple[list[Event], list[Event]]:
    """Split by TIME, never randomly.

    A random split lets the model see Tuesday while being tested on Monday.
    Behaviour is autocorrelated, so that leaks and every metric comes out
    flattering and wrong. Train on the past, test on the future -- which is
    also how the model will actually be used.
    """
    events = sorted(events, key=lambda e: e.timestamp)
    cut = int(len(events) * frac)
    return events[:cut], events[cut:]


def _pr_auc(y_true: list[int], scores: list[float]) -> float:
    from sklearn.metrics import average_precision_score
    return float(average_precision_score(y_true, scores))


def _precision_at_k(y_true: list[int], scores: list[float], k: int) -> float:
    ranked = sorted(zip(scores, y_true), reverse=True)[:k]
    return sum(y for _, y in ranked) / max(len(ranked), 1)


def report(y_true: list[int], scores: list[float], label: str) -> dict:
    """Honest metrics for an imbalanced ranking problem."""
    n_pos = sum(y_true)
    base = n_pos / len(y_true) if y_true else 0.0
    print(f"\n--- {label} ---")
    print(f"events: {len(y_true):,}   true anomalies: {n_pos:,} ({base * 100:.2f}%)")

    if n_pos == 0:
        print("No labelled anomalies in this split -- nothing to measure.")
        print("The model still ranks events; you just cannot score it yet.")
        return {"note": "no positives in holdout"}

    pr = _pr_auc(y_true, scores)
    print(f"PR-AUC        : {pr:.3f}   (random baseline = {base:.4f})")
    print(f"lift over random: {pr / base:.1f}x" if base else "")

    out = {"pr_auc": pr, "baseline": base, "n_positives": n_pos, "precision_at_k": {}}
    print("\nIf an auditor reviews the top N alerts per period:")
    for k in (10, 20, 50, 100):
        if k > len(y_true):
            continue
        p = _precision_at_k(y_true, scores, k)
        out["precision_at_k"][k] = p
        print(f"  top {k:>3}: {p * 100:5.1f}% are genuine "
              f"({int(p * k)} of {k} worth reviewing)")

    # Accuracy deliberately omitted -- see the module docstring.
    print(f"\n(Accuracy is not reported: always predicting 'normal' would "
          f"score {(1 - base) * 100:.1f}% here and catch nothing.)")
    return out


def train_unsupervised(train: list[Event], test: list[Event], contamination: float):
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler

    baselines = build_baselines(train)
    Xtr, _ = featurize(train, baselines)
    Xte, te_events = featurize(test, baselines)

    scaler = StandardScaler().fit(Xtr)
    model = IsolationForest(
        n_estimators=300, contamination=contamination,
        random_state=42, n_jobs=-1,
    ).fit(scaler.transform(Xtr))

    # score_samples: lower = more anomalous. Flip and squash to 0..1 so the
    # output means the same thing as the rule engine's anomaly_score and the
    # existing risk_level thresholds keep working.
    raw = model.score_samples(scaler.transform(Xte))
    lo, hi = raw.min(), raw.max()
    scores = [float((hi - v) / (hi - lo)) if hi > lo else 0.0 for v in raw]

    y = [e.label or 0 for e in te_events]
    metrics = report(y, scores, "IsolationForest (unsupervised, held-out future)")
    return model, scaler, baselines, metrics, te_events, scores, Xte


def train_supervised(train: list[Event], test: list[Event]):
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler

    labelled = [e for e in train if e.label is not None]
    if len({e.label for e in labelled}) < 2:
        raise SystemExit(
            "Supervised training needs both Confirmed Threat and False Alarm\n"
            "verdicts. Have your Auditor review flagged entries first --\n"
            "every click on those buttons creates one training label.\n"
            "See ml/README.md section 4."
        )
    if len(labelled) < 200:
        print(f"WARNING: only {len(labelled)} labelled events. Metrics below "
              f"will be noisy;\n         aim for 500+ reviewer verdicts.\n")

    baselines = build_baselines(train)
    Xtr, tr_events = featurize(labelled, baselines)
    ytr = [e.label for e in tr_events]

    scaler = StandardScaler().fit(Xtr)
    model = GradientBoostingClassifier(
        n_estimators=200, max_depth=3, learning_rate=0.05, random_state=42,
    ).fit(scaler.transform(Xtr), ytr)

    Xte, te_events = featurize(test, baselines)
    scores = [float(p) for p in model.predict_proba(scaler.transform(Xte))[:, 1]]
    y = [e.label or 0 for e in te_events]
    metrics = report(y, scores, "GradientBoosting (supervised, held-out future)")

    print("\nWhat the model is keying on:")
    for name, imp in sorted(zip(FEATURE_NAMES, model.feature_importances_),
                            key=lambda t: -t[1])[:8]:
        print(f"  {name:28} {imp:.3f}")

    return model, scaler, baselines, metrics, te_events, scores, Xte


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--supervised", action="store_true")
    ap.add_argument("--contamination", type=float, default=0.01)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    path = Path(args.data)
    events = load_events(path)
    synthetic = "synth" in path.name.lower()

    print(f"Loaded {len(events):,} events from {path}")
    print(f"  users {len({e.user for e in events})}, "
          f"span {(max(e.timestamp for e in events) - min(e.timestamp for e in events)).days} days")

    if len(events) < 5000:
        print(f"\nWARNING: {len(events):,} events is thin. Per-user baselines need")
        print("         roughly 10,000+ events over 30+ days to mean anything.")

    train, test = time_split(events)
    print(f"  train {len(train):,} (older)  test {len(test):,} (newer)")

    if args.supervised:
        model, scaler, baselines, metrics, te, scores, X = train_supervised(train, test)
        kind = "gradient_boosting_supervised"
    else:
        model, scaler, baselines, metrics, te, scores, X = train_unsupervised(
            train, test, args.contamination)
        kind = "isolation_forest_unsupervised"

    print("\nHighest-scoring events in the holdout (what an auditor would see):")
    for s, e, row in sorted(zip(scores, te, X), key=lambda t: -t[0])[:5]:
        why = "; ".join(explain(row))
        flag = " [TRUE POSITIVE]" if e.label else ""
        print(f"  {s:.3f}  {e.user:22} {e.action:22} {e.timestamp:%Y-%m-%d %H:%M}{flag}")
        print(f"         -> {why}")

    import joblib
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out) if args.out else ARTIFACT_DIR / "audit_anomaly.joblib"
    joblib.dump({"model": model, "scaler": scaler,
                 "baselines": baselines.to_dict(),
                 "features": FEATURE_NAMES}, out)

    meta = {
        "kind": kind,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source": str(path),
        "provenance": "synthetic" if synthetic else "real",
        "n_events": len(events),
        "n_users": len({e.user for e in events}),
        "features": FEATURE_NAMES,
        "metrics": metrics,
    }
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(f"\nSaved {out}\n      {out.with_suffix('.json')}")

    if synthetic:
        print("\n" + "=" * 68)
        print("THIS MODEL WAS TRAINED ON SYNTHETIC DATA.")
        print("The scores above are the generator grading itself -- train and")
        print("test came from the same assumptions, so good numbers here are")
        print("NOT evidence it works on your staff. Use it to verify the")
        print("pipeline and to demo. Retrain on real logs before acting on any")
        print("finding. See ml/README.md.")
        print("=" * 68)


if __name__ == "__main__":
    main()
