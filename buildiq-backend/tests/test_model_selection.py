"""Users can choose which AI model answers them.

The chosen id is validated against an allowlist. A model name from a client
goes straight into a billed API call, so accepting arbitrary strings would let
anyone run an expensive model on the account.
"""
import httpx

from app.config import Settings

OR = "https://openrouter.ai/api/v1"


def _compat(**kw):
    return Settings(AI_PROVIDER="openai_compatible", AI_BASE_URL=OR,
                    AI_API_KEY="k", AI_MODEL="openai/gpt-oss-20b:free", **kw)


def test_no_choice_uses_the_configured_default():
    assert _compat().resolve_model(None) == "openai/gpt-oss-20b:free"


def test_an_allowed_model_is_honoured():
    s = _compat()
    assert s.resolve_model("inclusionai/ling-3.0-flash:free") \
        == "inclusionai/ling-3.0-flash:free"


def test_a_paid_model_cannot_be_forced():
    """The security boundary: a client must not be able to bill you."""
    s = _compat()
    for evil in ("openai/gpt-4o", "anthropic/claude-opus-4",
                 "openai/o1-pro", "../../etc/passwd", ""):
        assert s.resolve_model(evil) == "openai/gpt-oss-20b:free", evil


def test_the_default_is_listed_first_and_flagged():
    models = _compat().allowed_models()
    assert models[0]["id"] == "openai/gpt-oss-20b:free"
    assert models[0]["default"] is True
    assert sum(1 for m in models if m["default"]) == 1


def test_no_duplicate_entries_when_default_is_a_known_free_model():
    ids = [m["id"] for m in _compat().allowed_models()]
    assert len(ids) == len(set(ids))


def test_groq_mode_offers_only_its_own_model():
    """Groq's ids differ from OpenRouter's, so don't offer them there."""
    s = Settings(GROQ_API_KEY="k")
    models = s.allowed_models()
    assert [m["id"] for m in models] == [s.GROQ_MODEL]
    assert s.resolve_model("inclusionai/ling-3.0-flash:free") == s.GROQ_MODEL


def test_the_selected_model_reaches_the_provider(monkeypatch):
    from app.services import groq_service

    for k, v in (("AI_PROVIDER", "openai_compatible"), ("AI_BASE_URL", OR),
                 ("AI_API_KEY", "k"), ("AI_MODEL", "openai/gpt-oss-20b:free")):
        monkeypatch.setattr(groq_service.settings, k, v)

    seen = {}

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "ok"}}]}

    monkeypatch.setattr(httpx, "post",
                        lambda url, **kw: (seen.update(kw["json"]), Resp())[1])

    groq_service.complete("s", "u", model="inclusionai/ling-3.0-flash:free")
    assert seen["model"] == "inclusionai/ling-3.0-flash:free"

    groq_service.complete("s", "u", model="openai/gpt-4o")
    assert seen["model"] == "openai/gpt-oss-20b:free", "paid model was not blocked"


def test_chat_forwards_the_model(monkeypatch):
    """chat() accepted a model parameter but silently dropped it."""
    from app.services import groq_service

    captured = {}
    monkeypatch.setattr(groq_service, "complete",
                        lambda *a, **kw: captured.update(kw) or "reply")
    groq_service.chat("hi", "ctx", model="inclusionai/ling-3.0-flash:free")
    assert captured.get("model") == "inclusionai/ling-3.0-flash:free"


def test_chat_endpoint_reports_which_model_answered(client, monkeypatch):
    from app.routers import ai as ai_router

    monkeypatch.setattr(ai_router.groq_service, "chat", lambda *a, **kw: "hello")

    tok = client.post("/auth/login",
                      json={"email": "admin@buildiq.et", "password": "Demo1234!"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    body = client.post("/ai/chat", headers=h, json={"message": "hi"}).json()
    assert body["model"] is not None
    assert body["ai_source"] == "groq"


def test_fallback_reports_no_model(client, monkeypatch):
    """When the heuristics answer, no model produced the text."""
    from app.routers import ai as ai_router

    monkeypatch.setattr(ai_router.groq_service, "chat", lambda *a, **kw: None)

    tok = client.post("/auth/login",
                      json={"email": "admin@buildiq.et", "password": "Demo1234!"}).json()["token"]
    body = client.post("/ai/chat", headers={"Authorization": f"Bearer {tok}"},
                       json={"message": "hi"}).json()
    assert body["ai_source"] == "heuristic"
    assert body["model"] is None


def test_status_lists_selectable_models(client):
    tok = client.post("/auth/login",
                      json={"email": "admin@buildiq.et", "password": "Demo1234!"}).json()["token"]
    body = client.get("/ai/status", headers={"Authorization": f"Bearer {tok}"}).json()
    assert "selectable_models" in body
    assert isinstance(body["selectable_models"], list)


def test_an_unknown_model_does_not_error(client, monkeypatch):
    """A stale id in a client should degrade, not break the chat."""
    from app.routers import ai as ai_router
    monkeypatch.setattr(ai_router.groq_service, "chat", lambda *a, **kw: "hello")

    tok = client.post("/auth/login",
                      json={"email": "admin@buildiq.et", "password": "Demo1234!"}).json()["token"]
    r = client.post("/ai/chat", headers={"Authorization": f"Bearer {tok}"},
                    json={"message": "hi", "model": "made/up:free"})
    assert r.status_code == 200
