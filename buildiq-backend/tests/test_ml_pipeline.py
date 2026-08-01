"""The ML training pipeline.

These tests do not train a real model -- that takes a minute and needs
scikit-learn, which is deliberately NOT a deployment dependency. They check
the parts that are easy to get quietly wrong:

  * features are causal (no future leakage), the classic way anomaly
    detection results end up fraudulent;
  * the train/test split is chronological, not random;
  * the synthetic generator produces the taxonomy the app actually uses;
  * explanations exist for every score, because an unexplainable audit
    finding is not actionable.

Skipped cleanly when scikit-learn is absent, so the normal test run on a
deploy box is unaffected.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml import synth  # noqa: E402
from ml.features import (  # noqa: E402
    FEATURE_NAMES, Event, build_baselines, explain, featurize,
)

UTC = timezone.utc


def _ev(user, action, when, role="Engineer", atype="SECURITY", res="r", label=None):
    return Event(user=user, user_role=role, action=action, audit_type=atype,
                 resource=res, timestamp=when, label=label)


# ---------------- Feature correctness ----------------

def test_features_are_causal():
    """An event must never be described using events that came after it.

    This is the bug that silently invents excellent anomaly detectors: build
    the rolling counts over the whole history and the model sees the future.
    The first event of a user must have an empty window.
    """
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("A", "LOGIN", base + timedelta(minutes=10 * i)) for i in range(6)]
    baselines = build_baselines(events)
    rows, ordered = featurize(events, baselines)

    i_1h = FEATURE_NAMES.index("events_last_1h")
    assert rows[0][i_1h] == 0, "the first event has no prior activity"
    # Each subsequent event sees exactly the ones before it (all within 1h).
    assert [r[i_1h] for r in rows] == [0, 1, 2, 3, 4, 5]


def test_featurize_sorts_by_time():
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    shuffled = [_ev("A", "LOGIN", base + timedelta(hours=3)),
                _ev("A", "LOGIN", base),
                _ev("A", "LOGIN", base + timedelta(hours=1))]
    _, ordered = featurize(shuffled, build_baselines(shuffled))
    assert [e.timestamp for e in ordered] == sorted(e.timestamp for e in shuffled)


def test_one_users_activity_does_not_pollute_another():
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("Busy", "LOGIN", base + timedelta(minutes=i)) for i in range(30)]
    events.append(_ev("Quiet", "LOGIN", base + timedelta(minutes=31)))
    rows, ordered = featurize(events, build_baselines(events))

    i_1h = FEATURE_NAMES.index("events_last_1h")
    quiet = [r for r, e in zip(rows, ordered) if e.user == "Quiet"][0]
    assert quiet[i_1h] == 0, "windows are per-user, not global"


def test_night_shift_worker_is_not_permanently_anomalous():
    """The circular-hour feature exists for exactly this case.

    A plain mean-hour comparison marks a 23:00-03:00 worker as deviant
    forever, which is the false-positive pattern the rule engine already has.
    """
    i_dev = FEATURE_NAMES.index("deviation_from_usual_hour")
    nights = []
    for d in range(20):
        day = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=d)
        nights.append(_ev("Night", "LOGIN", day.replace(hour=23)))
        nights.append(_ev("Night", "UPDATE_RECORD", day.replace(hour=1)))
    baselines = build_baselines(nights)

    probe_night = _ev("Night", "LOGIN", datetime(2026, 2, 1, 0, tzinfo=UTC))
    probe_noon = _ev("Night", "LOGIN", datetime(2026, 2, 1, 12, tzinfo=UTC))
    rows, ordered = featurize(nights + [probe_night, probe_noon], baselines)

    by_ts = {e.timestamp: r for r, e in zip(rows, ordered)}
    assert by_ts[probe_night.timestamp][i_dev] < 0.3, "midnight is normal for them"
    assert by_ts[probe_noon.timestamp][i_dev] > 0.5, "midday is the odd one"


def test_rarity_is_relative_to_the_person():
    i_rare = FEATURE_NAMES.index("action_rarity_for_user")
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("Finance", "PAYMENT_APPROVAL", base + timedelta(hours=i))
              for i in range(40)]
    events.append(_ev("Finance", "BULK_DELETE", base + timedelta(hours=41)))
    rows, ordered = featurize(events, build_baselines(events))
    by_action = {e.action: r for r, e in zip(rows, ordered)}
    assert by_action["PAYMENT_APPROVAL"][i_rare] < 0.1, "routine for this user"
    assert by_action["BULK_DELETE"][i_rare] > 0.9, "never seen before"


def test_every_feature_is_finite():
    """NaN or inf silently poisons a scikit-learn fit."""
    import math
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("Solo", "LOGIN", base)]          # degenerate: one event, zero span
    rows, _ = featurize(events, build_baselines(events))
    assert all(math.isfinite(v) for v in rows[0]), rows[0]


def test_feature_vector_matches_the_declared_names():
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("A", "LOGIN", base)]
    rows, _ = featurize(events, build_baselines(events))
    assert len(rows[0]) == len(FEATURE_NAMES)
    assert len(set(FEATURE_NAMES)) == len(FEATURE_NAMES), "names must be unique"


# ---------------- Explanations ----------------

def test_every_score_can_be_explained():
    base = datetime(2026, 1, 5, 3, tzinfo=UTC)          # 03:00
    events = [_ev("A", "BULK_DELETE", base)]
    rows, _ = featurize(events, build_baselines(events))
    reasons = explain(rows[0])
    assert reasons and all(isinstance(r, str) for r in reasons)
    joined = " ".join(reasons)
    assert "outside working hours" in joined or "never performed" in joined


def test_normal_behaviour_says_so():
    base = datetime(2026, 1, 5, 10, tzinfo=UTC)
    events = [_ev("A", "LOGIN", base + timedelta(days=i)) for i in range(30)]
    rows, _ = featurize(events, build_baselines(events))
    assert "consistent" in " ".join(explain(rows[-1]))


# ---------------- Synthetic generator ----------------

def test_synth_uses_the_real_taxonomy():
    from app import ai_engine
    assert set(synth.ACTION_TO_TYPE) <= set(ai_engine.ACTION_TO_TYPE), \
        "the generator invented action codes the app does not know"
    for action, atype in synth.ACTION_TO_TYPE.items():
        assert ai_engine.ACTION_TO_TYPE[action] == atype, \
            f"{action} is typed differently from ai_engine"


def test_synth_covers_all_seven_types():
    rows = synth.generate(days=40, n_users=15, seed=1, malicious_pct=0.1)
    assert len({r["audit_type"] for r in rows}) == 7


def test_synth_roles_match_the_app():
    from app.security import ALL_ROLES
    assert set(synth.ROLE_ACTIONS) == set(ALL_ROLES)


def test_synth_is_realistically_imbalanced():
    """If malicious events were common the problem would be trivial and the
    metrics meaningless. Real insider data is well under 5%."""
    rows = synth.generate(days=60, n_users=25, seed=7, malicious_pct=0.05)
    rate = sum(r["label"] for r in rows) / len(rows)
    assert 0 < rate < 0.05, f"anomaly rate {rate:.3%} is not realistic"


def test_synth_puts_anomalies_in_both_halves():
    """Campaigns must span the timeline, or a chronological split leaves the
    holdout with no positives and nothing can be measured. That happened."""
    rows = synth.generate(days=120, n_users=60, seed=42, malicious_pct=0.05)
    cut = int(len(rows) * 0.7)
    assert sum(r["label"] for r in rows[:cut]) > 0, "no positives to train on"
    assert sum(r["label"] for r in rows[cut:]) > 0, "no positives to test on"


def test_synth_includes_benign_night_work():
    """Without honest night-time noise the model just learns 'night = attack'
    and reproduces the rule engine's biggest false-positive source."""
    rows = synth.generate(days=60, n_users=30, seed=3, malicious_pct=0.05)
    night_benign = [r for r in rows
                    if not r["label"]
                    and datetime.fromisoformat(r["timestamp"]).hour in (5, 6, 20, 21, 22)]
    assert len(night_benign) > 20, "no benign out-of-hours activity"


def test_synth_is_deterministic():
    a = synth.generate(days=20, n_users=10, seed=99, malicious_pct=0.1)
    b = synth.generate(days=20, n_users=10, seed=99, malicious_pct=0.1)
    assert a == b, "same seed must reproduce the same dataset"


# ---------------- Training utilities ----------------

def test_split_is_chronological_not_random():
    """A random split leaks: behaviour is autocorrelated, so a model that saw
    Tuesday can 'predict' Monday and every metric comes out inflated."""
    pytest.importorskip("sklearn")
    from ml.train import time_split

    base = datetime(2026, 1, 1, tzinfo=UTC)
    events = [_ev("A", "LOGIN", base + timedelta(hours=i)) for i in range(100)]
    train, test = time_split(events, 0.7)
    assert len(train) == 70 and len(test) == 30
    assert max(e.timestamp for e in train) <= min(e.timestamp for e in test), \
        "every training event must predate every test event"


def test_precision_at_k_counts_correctly():
    pytest.importorskip("sklearn")
    from ml.train import _precision_at_k
    y = [1, 1, 0, 0, 0]
    scores = [0.9, 0.8, 0.7, 0.6, 0.5]
    assert _precision_at_k(y, scores, 2) == 1.0
    assert _precision_at_k(y, scores, 4) == 0.5


def test_tie_aware_precision_does_not_flatter_a_flat_scorer():
    """The rule engine emits four distinct values. Plain sorting credits it for
    whatever order the input happened to be in -- it 'scored' 100% at top-20
    that way. Averaging over tie orders exposes that."""
    pytest.importorskip("sklearn")
    from ml.evaluate import precision_at_k_tie_aware
    from ml.train import _precision_at_k

    # All positives first in input order, but every score identical.
    y = [1] * 20 + [0] * 980
    scores = [0.54] * 1000
    assert _precision_at_k(y, scores, 20) == 1.0, "naive version is fooled"
    fair = precision_at_k_tie_aware(y, scores, 20, trials=50)
    assert fair < 0.15, f"tie-aware precision should be near the 2% base rate, got {fair}"


def test_baselines_survive_a_round_trip():
    """Baselines are saved with the model; if they do not deserialise exactly,
    scoring drifts away from training without anything failing loudly."""
    from ml.features import Baselines
    base = datetime(2026, 1, 5, 9, tzinfo=UTC)
    events = [_ev("A", "LOGIN", base + timedelta(hours=i)) for i in range(10)]
    original = build_baselines(events)
    restored = Baselines.from_dict(original.to_dict())

    rows_a, _ = featurize(events, original)
    rows_b, _ = featurize(events, restored)
    assert rows_a == rows_b


def test_the_deployed_api_does_not_import_sklearn():
    """scikit-learn is a training-only dependency. If the app ever imports it,
    the Render build grows by ~100 MB and cold starts get slower."""
    import subprocess
    src = Path(__file__).resolve().parent.parent / "app"
    hits = subprocess.run(
        ["grep", "-rn", "-e", "import sklearn", "-e", "from sklearn", str(src)],
        capture_output=True, text=True).stdout.strip()
    assert not hits, f"app/ must not import scikit-learn:\n{hits}"


def test_ml_deps_are_not_in_the_runtime_requirements():
    reqs = (Path(__file__).resolve().parent.parent / "requirements.txt").read_text()
    for pkg in ("scikit-learn", "joblib", "numpy"):
        assert pkg not in reqs, f"{pkg} must stay out of requirements.txt"
