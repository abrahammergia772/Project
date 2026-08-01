"""Does the model actually beat the rules you already have?

This is the only question that decides whether any of this is worth
deploying. A model that ranks worse than four hard-coded thresholds is not
progress, however good its PR-AUC looks in isolation.

Compares, on the same held-out future window:
  * the current production rule engine (ai_engine.score_audit_event)
  * the trained model in ml/artifacts/
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.features import Baselines, featurize  # noqa: E402
from ml.train import _precision_at_k, _pr_auc, load_events, time_split  # noqa: E402


def precision_at_k_tie_aware(y_true, scores, k, trials=200):
    """Average precision@k over random orderings WITHIN each tied score.

    The rule engine emits four distinct values, so thousands of events share a
    score. Plain sorted() breaks those ties by input order, which silently
    hands it whatever the data happened to be sorted by -- it scored a
    flattering 100% at top-20 that way. Averaging over random tie orders
    measures what an auditor would really get.
    """
    import random
    rnd = random.Random(0)
    idx = list(range(len(scores)))
    total = 0.0
    for _ in range(trials):
        rnd.shuffle(idx)
        ranked = sorted(idx, key=lambda i: -scores[i])[:k]
        total += sum(y_true[i] for i in ranked) / max(k, 1)
    return total / trials


def rule_engine_scores(events) -> list[float]:
    """Exactly what the API does today, so the comparison is fair."""
    from app import ai_engine
    return [ai_engine.score_audit_event(e.action, e.user, e.timestamp)["anomaly_score"]
            for e in events]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="ml/artifacts/audit_anomaly.joblib")
    args = ap.parse_args()

    import joblib

    events = load_events(Path(args.data))
    _, test = time_split(events)
    y = [e.label or 0 for e in sorted(test, key=lambda e: e.timestamp)]

    if not sum(y):
        raise SystemExit("No labelled anomalies in the holdout -- nothing to compare.")

    bundle = joblib.load(args.model)
    baselines = Baselines.from_dict(bundle["baselines"])
    X, te = featurize(test, baselines)
    y = [e.label or 0 for e in te]

    scaled = bundle["scaler"].transform(X)
    model = bundle["model"]
    if hasattr(model, "predict_proba"):
        model_scores = [float(p) for p in model.predict_proba(scaled)[:, 1]]
    else:
        raw = model.score_samples(scaled)
        lo, hi = raw.min(), raw.max()
        model_scores = [float((hi - v) / (hi - lo)) if hi > lo else 0.0 for v in raw]

    rules = rule_engine_scores(te)

    base = sum(y) / len(y)
    print(f"Held-out window: {len(y):,} events, {sum(y)} true anomalies "
          f"({base * 100:.2f}%)\n")
    # Tie-aware, otherwise the rule engine is credited for the arbitrary
    # order its four-value output happens to land in.
    print(f"{'':22} {'PR-AUC':>8} {'top-20':>8} {'top-50':>8} {'top-100':>8}")
    rows = [("Rule engine (current)", rules), ("Trained model", model_scores)]
    results = {}
    for name, s in rows:
        pr = _pr_auc(y, s)
        results[name] = pr
        print(f"{name:22} {pr:8.3f} "
              f"{precision_at_k_tie_aware(y, s, 20) * 100:7.1f}% "
              f"{precision_at_k_tie_aware(y, s, 50) * 100:7.1f}% "
              f"{precision_at_k_tie_aware(y, s, 100) * 100:7.1f}%")
    print(f"{'random baseline':22} {base:8.4f}")
    print("\n(top-N is averaged over random orderings within tied scores --\n"
          " without that the rule engine is credited for arbitrary input order.)")

    a, b = results["Rule engine (current)"], results["Trained model"]
    print()
    if b > a * 1.1:
        print(f"The model is {b / a:.1f}x better than the rules on this data.")
    elif b > a:
        print(f"The model is only marginally better ({b / a:.2f}x). Not worth the")
        print("operational cost of a model unless it improves on real logs.")
    else:
        print(f"The model is WORSE than the rule engine ({b / a:.2f}x). Do not")
        print("deploy it. Either the features are wrong or there is not enough data.")

    # The rule engine emits only 4 distinct values, so huge numbers of events
    # tie for the same score. Ties make ranking meaningless and this is the
    # single clearest argument for replacing it.
    print(f"\nDistinct scores produced — rules: {len(set(rules))}, "
          f"model: {len(set(model_scores))}")
    if len(set(rules)) < 10:
        print("The rule engine cannot rank: with so few distinct values, most")
        print("events tie and 'the top 20 alerts' is effectively arbitrary.")


if __name__ == "__main__":
    main()
