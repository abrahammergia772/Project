"""Retrain the free-text audit-type classifier.

The committed artifact (buildiq_audit_type_classifier_hard.joblib) was
produced elsewhere; this script reproduces and evaluates it so the model can
be rebuilt when the dataset grows, and so its quality is measured the same
way every time.

    pip install -r ../buildiq-backend/requirements-ml.txt
    python train_audit_type_classifier.py
    python train_audit_type_classifier.py --out my_model.joblib

Why the split is grouped
------------------------
audit_types_hard_dataset.csv repeats 957 texts. A plain random split puts
copies of the same string on both sides, so the model is scored on text it
memorised and the reported accuracy is inflated. Splitting on unique text
instead keeps the measurement honest -- on this data the difference is small
but the habit matters, and it is the single most common way NLP results are
accidentally faked.

Why accuracy is not the whole story
-----------------------------------
125 texts in this dataset carry contradictory labels -- "flagged item"
appears under all seven types. That caps any model at about 96.3%. The script
prints that ceiling next to the score so a result can be read against what
is actually achievable rather than against 100%.
"""
from __future__ import annotations

import argparse
import collections
import csv
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DATA = HERE / "audit_types_hard_dataset.csv"
DEFAULT_OUT = HERE / "buildiq_audit_type_classifier_hard.joblib"

SEVEN = {"SECURITY", "FINANCIAL", "COMPLIANCE", "USER_ACTIVITY",
         "DATA_INTEGRITY", "PROJECT_RESOURCE", "REPORT_DOCUMENT"}


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r.get("text") and r.get("audit_type")]
    if not rows:
        raise SystemExit(f"{path} has no usable rows")
    unknown = {r["audit_type"] for r in rows} - SEVEN
    if unknown:
        raise SystemExit(f"dataset contains unknown audit types: {sorted(unknown)}")
    return rows


def label_ceiling(rows: list[dict]) -> tuple[float, int]:
    """Best accuracy any model could reach, given contradictory labels."""
    by_text: dict[str, list[str]] = collections.defaultdict(list)
    for r in rows:
        by_text[r["text"].strip().lower()].append(r["audit_type"])
    best = sum(collections.Counter(v).most_common(1)[0][1] for v in by_text.values())
    conflicts = sum(1 for v in by_text.values() if len(set(v)) > 1)
    return best / len(rows), conflicts


def grouped_split(rows: list[dict], frac: float, seed: int):
    groups: dict[str, int] = {}
    for r in rows:
        groups.setdefault(r["text"].strip().lower(), len(groups))
    uniq = sorted(set(groups.values()))
    random.Random(seed).shuffle(uniq)
    train_ids = set(uniq[:int(len(uniq) * frac)])
    train = [r for r in rows if groups[r["text"].strip().lower()] in train_ids]
    test = [r for r in rows if groups[r["text"].strip().lower()] not in train_ids]
    return train, test


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--train-frac", type=float, default=0.75)
    args = ap.parse_args()

    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.pipeline import Pipeline

    rows = load(args.data)
    ceiling, conflicts = label_ceiling(rows)
    counts = collections.Counter(r["audit_type"] for r in rows)

    print(f"Loaded {len(rows):,} rows from {args.data.name}")
    for k, v in sorted(counts.items()):
        print(f"  {k:18} {v:5}")
    print(f"\nContradictory texts : {conflicts} "
          f"(the same wording labelled more than one way)")
    print(f"Achievable ceiling  : {ceiling * 100:.2f}%  <- not 100%, by construction")
    print(f"Guessing baseline   : {max(counts.values()) / len(rows) * 100:.2f}%\n")

    train, test = grouped_split(rows, args.train_frac, args.seed)
    print(f"Grouped split: {len(train):,} train / {len(test):,} test "
          f"(identical texts never straddle the two)")

    pipe = Pipeline([
        # Word bigrams catch the phrases that decide the class -- "external
        # share", "no change order" -- which single words miss.
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True,
                                  min_df=1, strip_accents="unicode",
                                  lowercase=True)),
        ("lr", LogisticRegression(max_iter=2000, C=5, class_weight="balanced")),
    ])
    pipe.fit([r["text"] for r in train], [r["audit_type"] for r in train])

    y_true = [r["audit_type"] for r in test]
    y_pred = pipe.predict([r["text"] for r in test])
    acc = accuracy_score(y_true, y_pred)

    print(f"\nHeld-out accuracy   : {acc * 100:.2f}%  "
          f"({acc / ceiling * 100:.1f}% of what is achievable)\n")
    print(classification_report(y_true, y_pred, digits=3, zero_division=0))

    worst = min(
        ((lbl, sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p == lbl)
          / max(sum(1 for t in y_true if t == lbl), 1))
         for lbl in sorted(SEVEN)), key=lambda t: t[1])
    print(f"Weakest class: {worst[0]} (recall {worst[1]:.3f})")
    if worst[1] < 0.6:
        print("  ^ that type is being systematically missed; add examples for it.")

    # Refit on everything before saving: the split existed to measure, and
    # throwing away 25% of the data in the shipped model would be wasteful.
    pipe.fit([r["text"] for r in rows], [r["audit_type"] for r in rows])
    joblib.dump(pipe, args.out)
    print(f"\nSaved {args.out}")
    print("Refit on the full dataset after measuring — the reported score "
          "comes from the held-out split above, not from this final fit.")


if __name__ == "__main__":
    main()
