"""Classify free-text notes into the seven audit types.

Where this fits
---------------
Structured events (an action code like BULK_DELETE) already get their audit
type from a dictionary lookup -- `ai_engine.audit_type_for_action()` -- which
is exact and needs no model. This module handles the case that lookup cannot:
a human typing "measurement sheet deleted, no change order" into a complaint
or inspection note.

The model is a TF-IDF + LogisticRegression pipeline trained offline and
committed to train_model/. It is loaded lazily on first use and never blocks
startup: if scikit-learn is absent, the file is missing, or the artifact was
produced by an incompatible library version, `classify()` falls back to a
keyword heuristic and reports `source="heuristic"`. The API must keep working
on a deploy box that never installed scikit-learn.

Honesty about confidence
------------------------
The training data contains 125 texts carrying contradictory labels -- some
deliberately, like "flagged item", which appears under all seven types. That
puts a hard ceiling of ~96.3% on any model, and it means a low-confidence
prediction is often the data being genuinely ambiguous rather than the model
failing. `classify()` therefore always returns a probability and an
`is_confident` flag so callers can route uncertain notes to a human instead
of silently filing them under a guess.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("buildiq.audit_classifier")

# train_model/ sits at the repository root, beside buildiq-backend/.
_REPO_ROOT = Path(__file__).resolve().parents[3]
MODEL_PATH = _REPO_ROOT / "train_model" / "buildiq_audit_type_classifier_hard.joblib"

VALID_TYPES = {
    "SECURITY", "FINANCIAL", "COMPLIANCE", "USER_ACTIVITY",
    "DATA_INTEGRITY", "PROJECT_RESOURCE", "REPORT_DOCUMENT",
}

# Below this the prediction is reported but flagged for human review.
CONFIDENCE_THRESHOLD = 0.55

_model: Any = None
_load_attempted = False
_load_error: str | None = None
_lock = threading.Lock()


# --- Keyword fallback -------------------------------------------------------
# Used when the model cannot load. Deliberately small: its job is to keep the
# feature working, not to compete with the model.
_KEYWORDS: dict[str, tuple[str, ...]] = {
    "SECURITY": ("login", "log in", "password", "unauthorized", "unauthorised",
                 "access attempt", "ip address", "ip change", "permission",
                 "credential", "breach", "mfa", "session"),
    "FINANCIAL": ("invoice", "payment", "budget", "cost", "etb", "expense",
                  "cash", "advance", "overspend", "billing", "paid", "refund"),
    "COMPLIANCE": ("approval", "approved", "permit", "policy", "regulation",
                   "late submission", "signed off", "sign-off", "bypass",
                   "violation", "mandatory", "deadline missed"),
    "USER_ACTIVITY": ("bulk", "mass delete", "role misuse", "dormant",
                      "inactive account", "logged in as", "impersonat"),
    "DATA_INTEGRITY": ("altered", "modified", "edited", "overwrote", "deleted",
                       "duplicate", "import", "record change", "no change order",
                       "unapproved edit", "take-off", "backdated"),
    "PROJECT_RESOURCE": ("material", "equipment", "scaffold", "concrete",
                         "cement", "site", "milestone", "delay", "contractor",
                         "delivery", "plant", "demob", "stock", "fuel"),
    "REPORT_DOCUMENT": ("report", "document", "drawing", "export", "download",
                        "shared", "external share", "pdf", "attachment",
                        "published", "circulated"),
}


def _heuristic(text: str) -> tuple[str, float]:
    lowered = (text or "").lower()
    scores = {t: sum(1 for kw in kws if kw in lowered) for t, kws in _KEYWORDS.items()}
    best = max(scores, key=lambda k: scores[k])
    hits = scores[best]
    if hits == 0:
        # No signal at all. USER_ACTIVITY is the catch-all, matching
        # ai_engine.audit_type_for_action()'s default for unknown actions.
        return "USER_ACTIVITY", 0.0
    total = sum(scores.values()) or 1
    return best, min(0.9, hits / total)


# --- Model loading ----------------------------------------------------------
def _load():
    """Load the artifact once. Never raises -- callers fall back instead."""
    global _model, _load_attempted, _load_error
    with _lock:
        if _load_attempted:
            return _model
        _load_attempted = True

        if not MODEL_PATH.exists():
            _load_error = f"no model file at {MODEL_PATH}"
            log.info("Audit text classifier: %s -- using keywords.", _load_error)
            return None
        try:
            import joblib                        # noqa: PLC0415 -- optional dep
        except ImportError:
            _load_error = "joblib/scikit-learn not installed"
            log.info("Audit text classifier: %s -- using keywords.", _load_error)
            return None
        try:
            model = joblib.load(MODEL_PATH)
            # A joblib file can contain anything; check it behaves like a
            # classifier before trusting it in a request path.
            if not hasattr(model, "predict"):
                raise TypeError(f"{type(model).__name__} has no predict()")
            classes = set(getattr(model, "classes_", []))
            unknown = classes - VALID_TYPES
            if unknown:
                raise ValueError(f"model predicts unknown types: {sorted(unknown)}")
            _model = model
            log.info("Audit text classifier loaded from %s", MODEL_PATH.name)
        except Exception as exc:                 # pragma: no cover - env specific
            # A scikit-learn version mismatch lands here. Degrading to
            # keywords is strictly better than 500ing every complaint.
            _load_error = f"{type(exc).__name__}: {exc}"
            log.warning("Audit text classifier unusable (%s) -- using keywords.",
                        _load_error)
            _model = None
        return _model


def is_available() -> bool:
    return _load() is not None


def status() -> dict:
    """Surfaced on /ai/status so the UI can say which path is live."""
    _load()
    return {
        "model_loaded": _model is not None,
        "model_path": str(MODEL_PATH) if MODEL_PATH.exists() else None,
        "fallback": "keyword heuristic",
        "error": _load_error,
    }


def classify(text: str) -> dict:
    """Return the predicted audit type for a free-text note.

    Always returns a usable answer:

        {"audit_type": "FINANCIAL", "confidence": 0.87,
         "is_confident": True, "source": "model",
         "alternatives": [("FINANCIAL", 0.87), ("COMPLIANCE", 0.06)]}
    """
    text = (text or "").strip()
    if not text:
        return {"audit_type": "USER_ACTIVITY", "confidence": 0.0,
                "is_confident": False, "source": "empty", "alternatives": []}

    model = _load()
    if model is None:
        kind, conf = _heuristic(text)
        return {"audit_type": kind, "confidence": round(conf, 3),
                "is_confident": conf >= CONFIDENCE_THRESHOLD,
                "source": "heuristic", "alternatives": []}

    try:
        predicted = str(model.predict([text])[0])
        alternatives: list[tuple[str, float]] = []
        confidence = 0.0
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba([text])[0]
            pairs = sorted(zip(model.classes_, probs), key=lambda t: -t[1])
            alternatives = [(str(c), round(float(p), 3)) for c, p in pairs[:3]]
            confidence = float(dict(pairs)[predicted])
        return {
            "audit_type": predicted,
            "confidence": round(confidence, 3),
            # Ambiguous notes are common in this data by design, so say when
            # the answer is a coin flip rather than presenting it as fact.
            "is_confident": confidence >= CONFIDENCE_THRESHOLD,
            "source": "model",
            "alternatives": alternatives,
        }
    except Exception as exc:                     # pragma: no cover
        log.warning("Classification failed (%s) -- using keywords.", exc)
        kind, conf = _heuristic(text)
        return {"audit_type": kind, "confidence": round(conf, 3),
                "is_confident": False, "source": "heuristic", "alternatives": []}


def classify_many(texts: list[str]) -> list[dict]:
    """Batch version. One vectorise + one matrix multiply beats N calls."""
    if not texts:
        return []
    model = _load()
    if model is None or not hasattr(model, "predict_proba"):
        return [classify(t) for t in texts]
    try:
        cleaned = [(t or "").strip() for t in texts]
        probs = model.predict_proba(cleaned)
        out = []
        for text, row in zip(cleaned, probs):
            if not text:
                out.append({"audit_type": "USER_ACTIVITY", "confidence": 0.0,
                            "is_confident": False, "source": "empty",
                            "alternatives": []})
                continue
            pairs = sorted(zip(model.classes_, row), key=lambda t: -t[1])
            best, conf = str(pairs[0][0]), float(pairs[0][1])
            out.append({
                "audit_type": best, "confidence": round(conf, 3),
                "is_confident": conf >= CONFIDENCE_THRESHOLD, "source": "model",
                "alternatives": [(str(c), round(float(p), 3)) for c, p in pairs[:3]],
            })
        return out
    except Exception:                            # pragma: no cover
        return [classify(t) for t in texts]


def reset_cache() -> None:
    """Test hook: forget the loaded model so a fresh load can be exercised."""
    global _model, _load_attempted, _load_error
    with _lock:
        _model = None
        _load_attempted = False
        _load_error = None
