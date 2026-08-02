"""The free-text audit-type classifier backed by train_model/.

Two distinct concerns are tested here:

  1. Integration -- the endpoint works, complaints get tagged, and the API
     degrades to keywords rather than 500ing when the model cannot load.
  2. Quality -- the committed artifact is actually good enough to ship,
     measured on a leak-free split and compared against a trivial baseline.

The quality tests skip when scikit-learn is absent, because it is a
training-only dependency and the deployed service never installs it.
"""
from __future__ import annotations

import csv
from pathlib import Path

import pytest

from app.services import audit_classifier as ac

PW = "Demo1234!"
REPO = Path(__file__).resolve().parents[2]
DATASET = REPO / "train_model" / "audit_types_hard_dataset.csv"
MODEL = REPO / "train_model" / "buildiq_audit_type_classifier_hard.joblib"

SEVEN = {"SECURITY", "FINANCIAL", "COMPLIANCE", "USER_ACTIVITY",
         "DATA_INTEGRITY", "PROJECT_RESOURCE", "REPORT_DOCUMENT"}


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, email
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------- The shipped artifact ----------------

def test_the_model_and_dataset_are_committed():
    assert MODEL.exists(), f"missing {MODEL}"
    assert DATASET.exists(), f"missing {DATASET}"


def test_the_model_only_predicts_the_seven_known_types():
    """A model emitting an eighth label would silently corrupt every
    dashboard that groups by audit type."""
    pytest.importorskip("sklearn")
    import joblib
    model = joblib.load(MODEL)
    assert set(model.classes_) == SEVEN


def test_the_dataset_covers_every_type():
    with DATASET.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) > 1000
    assert {r["audit_type"] for r in rows} == SEVEN


# ---------------- Classification behaviour ----------------

def test_obvious_text_is_classified_correctly():
    cases = [
        ("failed login attempt from an unknown ip address", "SECURITY"),
        ("invoice deleted from the finance ledger", "FINANCIAL"),
        ("scaffolding not returned after demobilisation", "PROJECT_RESOURCE"),
    ]
    for text, expected in cases:
        result = ac.classify(text)
        assert result["audit_type"] == expected, f"{text!r} -> {result}"


def test_every_result_carries_a_confidence():
    r = ac.classify("budget modified without approval")
    assert 0.0 <= r["confidence"] <= 1.0
    assert isinstance(r["is_confident"], bool)
    assert r["source"] in {"model", "heuristic", "empty"}


def test_ambiguous_text_is_reported_as_unconfident():
    """"flagged item" appears in the training data under ALL SEVEN types.

    The right behaviour is a low score, not a confident guess -- that is what
    lets the UI send it to a human instead of filing it wrongly.
    """
    r = ac.classify("flagged item")
    assert r["is_confident"] is False, f"expected low confidence, got {r}"


def test_empty_text_does_not_crash():
    for value in ("", "   ", None):
        r = ac.classify(value)
        assert r["audit_type"] in SEVEN
        assert r["is_confident"] is False


def test_alternatives_are_ranked():
    r = ac.classify("payment approved outside the normal chain")
    if r["source"] == "model":
        confs = [a[1] for a in r["alternatives"]]
        assert confs == sorted(confs, reverse=True)
        assert r["alternatives"][0][0] == r["audit_type"]


def test_batch_matches_single_classification():
    texts = ["failed login attempt", "invoice deleted", "scaffold missing"]
    batch = ac.classify_many(texts)
    singles = [ac.classify(t) for t in texts]
    assert [b["audit_type"] for b in batch] == [s["audit_type"] for s in singles]


def test_batch_of_nothing_is_empty():
    assert ac.classify_many([]) == []


# ---------------- Degradation ----------------

def test_a_missing_model_falls_back_to_keywords(monkeypatch):
    """The deployed API must keep working on a box with no scikit-learn.

    Falling back to a keyword guess is much better than a 500 on every
    complaint submission.
    """
    monkeypatch.setattr(ac, "MODEL_PATH", Path("/nonexistent/model.joblib"))
    ac.reset_cache()
    try:
        assert ac.is_available() is False
        r = ac.classify("failed login attempt from a strange ip address")
        assert r["source"] == "heuristic"
        assert r["audit_type"] == "SECURITY", "keywords should still get this one"
        assert ac.status()["model_loaded"] is False
    finally:
        ac.reset_cache()


def test_a_corrupt_model_falls_back_rather_than_raising(monkeypatch, tmp_path):
    bad = tmp_path / "corrupt.joblib"
    bad.write_bytes(b"this is not a joblib file")
    monkeypatch.setattr(ac, "MODEL_PATH", bad)
    ac.reset_cache()
    try:
        assert ac.is_available() is False
        assert ac.classify("invoice deleted")["source"] == "heuristic"
        assert ac.status()["error"]
    finally:
        ac.reset_cache()


def test_the_keyword_fallback_covers_all_seven_types():
    """Otherwise a whole audit type becomes unreachable when the model is
    unavailable."""
    assert set(ac._KEYWORDS) == SEVEN


# ---------------- API ----------------

def test_the_classify_endpoint_works(client):
    r = client.post("/audit/classify", headers=_tok(client, "admin@buildiq.et"),
                    json={"text": "unauthorised access to the payroll module"})
    assert r.status_code == 200
    body = r.json()
    assert body["audit_type"] in SEVEN
    assert body["label"]
    assert "confidence" in body and "is_confident" in body


def test_classify_requires_audit_access(client):
    """Same guard as the rest of the audit router: an Engineer has none."""
    r = client.post("/audit/classify", headers=_tok(client, "engineer@buildiq.et"),
                    json={"text": "anything"})
    assert r.status_code == 403


def test_classify_requires_authentication(client):
    assert client.post("/audit/classify", json={"text": "x"}).status_code in (401, 403)


def test_classify_rejects_empty_text(client):
    r = client.post("/audit/classify", headers=_tok(client, "admin@buildiq.et"),
                    json={"text": ""})
    assert r.status_code == 422


def test_classifier_status_endpoint(client):
    r = client.get("/audit/classifier-status", headers=_tok(client, "auditor@buildiq.et"))
    assert r.status_code == 200
    assert "model_loaded" in r.json()


def test_a_new_complaint_is_tagged_with_an_audit_type(client):
    """The real payoff: complaints become countable alongside audit events."""
    r = client.post("/complaints", headers=_tok(client, "engineer@buildiq.et"),
                    json={"text": "site drawings were shared with an outside "
                                  "contractor without approval"})
    assert r.status_code == 201
    body = r.json()
    assert body["audit_type"] in SEVEN
    assert body["audit_type_confidence"] is not None


def test_complaint_tagging_never_blocks_submission(client, monkeypatch):
    """A classifier problem must not stop someone reporting a problem."""
    monkeypatch.setattr(ac, "MODEL_PATH", Path("/nonexistent/model.joblib"))
    ac.reset_cache()
    try:
        r = client.post("/complaints", headers=_tok(client, "engineer@buildiq.et"),
                        json={"text": "concrete delivery arrived three days late"})
        assert r.status_code == 201
        assert r.json()["audit_type"] in SEVEN
    finally:
        ac.reset_cache()


# ---------------- Quality: is the artifact good enough to ship? ----------------

def _grouped_split(rows, frac=0.75, seed=42):
    """Split so identical texts never straddle train and test.

    The dataset repeats 957 texts. A random split puts copies on both sides,
    so the model is scored on strings it memorised and the number is inflated.
    """
    import random
    groups: dict[str, int] = {}
    for r in rows:
        groups.setdefault(r["text"].strip().lower(), len(groups))
    uniq = sorted(set(groups.values()))
    random.Random(seed).shuffle(uniq)
    train_groups = set(uniq[:int(len(uniq) * frac)])
    train = [r for r in rows if groups[r["text"].strip().lower()] in train_groups]
    test = [r for r in rows if groups[r["text"].strip().lower()] not in train_groups]
    return train, test


def test_the_data_has_contradictory_labels_and_we_know_it():
    """Documents a real property of this dataset rather than hiding it.

    125 texts carry more than one label, so no model can exceed ~96.3%
    accuracy. Anyone reporting 99% on this data has leaked their test set.
    """
    import collections
    with DATASET.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    by_text = collections.defaultdict(list)
    for r in rows:
        by_text[r["text"].strip().lower()].append(r["audit_type"])

    conflicting = {t: set(v) for t, v in by_text.items() if len(set(v)) > 1}
    assert conflicting, "expected the 'hard' dataset to contain ambiguity"

    ceiling = sum(collections.Counter(v).most_common(1)[0][1]
                  for v in by_text.values()) / len(rows)
    assert 0.90 < ceiling < 1.0
    assert ceiling < 0.98, (
        f"ceiling {ceiling:.3f}: this dataset is not perfectly separable, "
        "so any near-100% claim indicates leakage")


def test_the_shipped_model_beats_a_trivial_baseline():
    """Guards against shipping a broken artifact.

    Seven balanced classes means always guessing one gets 14.3%. Anything
    near that is a model that did not train.
    """
    pytest.importorskip("sklearn")
    import joblib
    from sklearn.metrics import accuracy_score

    with DATASET.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    _, test = _grouped_split(rows)

    model = joblib.load(MODEL)
    acc = accuracy_score([r["audit_type"] for r in test],
                         model.predict([r["text"] for r in test]))
    assert acc > 0.75, f"accuracy {acc:.3f} is too low to ship"
    assert acc > 0.143 * 3, "barely better than guessing"


def test_no_audit_type_is_systematically_missed():
    """Overall accuracy can hide one class the model never predicts, which
    would make that whole audit type invisible."""
    pytest.importorskip("sklearn")
    import joblib
    from sklearn.metrics import recall_score

    with DATASET.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    _, test = _grouped_split(rows)

    model = joblib.load(MODEL)
    labels = sorted(SEVEN)
    recalls = recall_score([r["audit_type"] for r in test],
                           model.predict([r["text"] for r in test]),
                           labels=labels, average=None, zero_division=0)
    worst = min(zip(labels, recalls), key=lambda t: t[1])
    assert worst[1] > 0.60, f"{worst[0]} is recalled only {worst[1]:.2f} of the time"
