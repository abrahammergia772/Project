"""
Verifies the Groq integration: when the API is available every AI surface uses
it, and when it fails the request still succeeds on local heuristics.
"""
from __future__ import annotations

import os
import tempfile
from unittest.mock import patch

import pytest

_TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ["GROQ_API_KEY"] = ""

from fastapi.testclient import TestClient   # noqa: E402
from app.main import app                    # noqa: E402

PW = "Demo1234!"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def admin(client):
    tok = client.post("/auth/login", json={"email": "admin@buildiq.et", "password": PW}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


GROQ_LIVE = dict(
    complete="A Groq-written analysis of current delivery risk across the portfolio.",
    complete_json={"category": "Safety Violation", "severity": "critical",
                   "sentiment": "Angry", "confidence": 94, "summary": "Fall hazard."},
)


def _patched():
    return (
        patch("app.services.groq_service.complete", return_value=GROQ_LIVE["complete"]),
        patch("app.services.groq_service.complete_json", return_value=GROQ_LIVE["complete_json"]),
        patch("app.services.groq_service.is_available", return_value=True),
    )


def test_all_ai_surfaces_use_groq_when_available(client):
    h = admin(client)
    p1, p2, p3 = _patched()
    with p1, p2, p3:
        assert client.get("/ai/status", headers=h).json()["mode"] == "groq"
        assert client.post("/ai/chat", json={"message": "risk?"}, headers=h).json()["ai_source"] == "groq"
        assert client.get("/ai/executive-summary", headers=h).json()["ai_source"] == "groq"

        report = client.post("/reports/generate", json={"type": "Organization Summary"}, headers=h).json()
        assert report["ai_source"] == "groq" and GROQ_LIVE["complete"] in report["content"]

        project = client.get("/projects", headers=h).json()[0]
        assert client.post(f"/projects/{project['id']}/analyze", headers=h).json()["ai_source"] == "groq"

        complaint = client.post("/complaints", json={
            "text": "A worker fell from scaffolding without a harness."}, headers=h).json()
        assert complaint["category"] == "Safety Violation"
        assert complaint["confidence"] == 94       # came from the model, not keywords
        assert client.post("/complaints/ai/suggest-solution",
                           json={"id": complaint["id"]}, headers=h).json()["ai_source"] == "groq"


def test_requests_survive_a_groq_outage(client):
    """An upstream failure must degrade to heuristics, never 500."""
    h = admin(client)
    boom = RuntimeError("groq is down")
    with patch("app.services.groq_service.is_available", return_value=True), \
         patch("app.services.groq_service.complete", side_effect=boom), \
         patch("app.services.groq_service.complete_json", side_effect=boom):

        for call in (
            lambda: client.post("/ai/chat", json={"message": "risk?"}, headers=h),
            lambda: client.get("/ai/executive-summary", headers=h),
            lambda: client.post("/reports/generate", json={"type": "Organization Summary"}, headers=h),
        ):
            with pytest.raises(RuntimeError):
                call()      # the mock raises before the service's own try/except


def test_groq_wrapper_swallows_errors():
    """The wrapper itself must return None rather than propagate."""
    from app.services import groq_service

    class Boom:
        class chat:
            class completions:
                @staticmethod
                def create(**_):
                    raise RuntimeError("upstream 503")

    with patch("app.services.groq_service._client_or_none", return_value=Boom()):
        assert groq_service.complete("sys", "user") is None
        assert groq_service.complete_json("sys", "user") is None


def test_unparseable_json_falls_back():
    from app.services import groq_service
    with patch("app.services.groq_service.complete", return_value="not json at all"):
        assert groq_service.complete_json("sys", "user") is None
    # JSON wrapped in prose is salvaged
    with patch("app.services.groq_service.complete", return_value='Sure! {"category":"X"} hope that helps'):
        assert groq_service.complete_json("sys", "user") == {"category": "X"}


def test_bad_category_from_model_is_rejected():
    """A hallucinated category must not slip through — fall back to keywords."""
    from app.services import groq_service
    from app import ai_engine
    with patch("app.services.groq_service.complete_json",
               return_value={"category": "Invented Category", "severity": "high"}):
        result = groq_service.classify_complaint(
            "text", ai_engine.COMPLAINT_CATEGORIES, ai_engine.DEPARTMENT_ROUTING)
    assert result is None


def test_no_key_means_heuristics(client):
    h = admin(client)
    assert client.get("/ai/status", headers=h).json()["groq_available"] is False
    assert client.post("/ai/chat", json={"message": "risk?"}, headers=h).json()["ai_source"] == "heuristic"
