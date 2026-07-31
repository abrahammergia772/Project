"""BuildIQ can run on any OpenAI-compatible AI provider.

Groq remains the default. Setting AI_PROVIDER=openai_compatible points the
same code at OpenRouter, Cerebras, Scaleway, Kilo, Google AI Studio's
compatibility layer or anything else exposing /chat/completions -- useful for
free tiers and as a fallback when one provider is down.

Every failure path must return None so callers use the deterministic
heuristics; an AI outage must never break a request.
"""
from app.config import Settings

OR = "https://openrouter.ai/api/v1"


def test_groq_is_still_the_default():
    s = Settings(GROQ_API_KEY="k")
    assert s.AI_PROVIDER == "groq"
    assert s.uses_openai_compatible is False
    assert s.groq_ready is True
    assert s.ai_provider_label.startswith("groq (")


def test_openai_compatible_needs_all_three_settings():
    """A half-configured provider must not look ready."""
    base = dict(AI_PROVIDER="openai_compatible")
    assert Settings(**base).groq_ready is False
    assert Settings(**base, AI_BASE_URL=OR).groq_ready is False
    assert Settings(**base, AI_BASE_URL=OR, AI_API_KEY="k").groq_ready is False
    assert Settings(**base, AI_BASE_URL=OR, AI_API_KEY="k",
                    AI_MODEL="m").groq_ready is True


def test_provider_label_names_host_and_model():
    s = Settings(AI_PROVIDER="openai_compatible", AI_BASE_URL=OR,
                 AI_API_KEY="k", AI_MODEL="deepseek/deepseek-r1:free")
    assert s.ai_provider_label == "openrouter.ai (deepseek/deepseek-r1:free)"


def test_no_provider_reports_heuristic():
    assert Settings().ai_provider_label == "heuristic"


def test_ai_disabled_overrides_a_configured_provider():
    s = Settings(AI_ENABLED=False, AI_PROVIDER="openai_compatible",
                 AI_BASE_URL=OR, AI_API_KEY="k", AI_MODEL="m")
    assert s.groq_ready is False


def test_provider_value_is_case_and_space_tolerant():
    assert Settings(AI_PROVIDER="  OpenAI_Compatible  ").uses_openai_compatible is True


def test_a_failing_provider_returns_none_not_an_exception(monkeypatch):
    """The contract every caller relies on: None means 'use the fallback'."""
    import httpx
    from app.services import groq_service

    monkeypatch.setattr(groq_service.settings, "AI_PROVIDER", "openai_compatible")
    monkeypatch.setattr(groq_service.settings, "AI_BASE_URL", OR)
    monkeypatch.setattr(groq_service.settings, "AI_API_KEY", "k")
    monkeypatch.setattr(groq_service.settings, "AI_MODEL", "m")

    def boom(*a, **kw):
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(httpx, "post", boom)
    assert groq_service.complete("sys", "user") is None


def test_a_malformed_response_returns_none(monkeypatch):
    import httpx
    from app.services import groq_service

    monkeypatch.setattr(groq_service.settings, "AI_PROVIDER", "openai_compatible")
    monkeypatch.setattr(groq_service.settings, "AI_BASE_URL", OR)
    monkeypatch.setattr(groq_service.settings, "AI_API_KEY", "k")
    monkeypatch.setattr(groq_service.settings, "AI_MODEL", "m")

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"unexpected": "shape"}

    monkeypatch.setattr(httpx, "post", lambda *a, **kw: Resp())
    assert groq_service.complete("sys", "user") is None


def test_a_good_response_is_returned(monkeypatch):
    import httpx
    from app.services import groq_service

    monkeypatch.setattr(groq_service.settings, "AI_PROVIDER", "openai_compatible")
    monkeypatch.setattr(groq_service.settings, "AI_BASE_URL", OR)
    monkeypatch.setattr(groq_service.settings, "AI_API_KEY", "k")
    monkeypatch.setattr(groq_service.settings, "AI_MODEL", "m")

    captured = {}

    class Resp:
        def raise_for_status(self): pass
        def json(self):
            return {"choices": [{"message": {"content": "  hello  "}}]}

    def fake_post(url, **kw):
        captured["url"] = url
        captured["payload"] = kw.get("json")
        captured["headers"] = kw.get("headers")
        return Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    assert groq_service.complete("sys", "user") == "hello"
    assert captured["url"] == OR + "/chat/completions"
    assert captured["payload"]["model"] == "m"
    assert captured["headers"]["Authorization"] == "Bearer k"


def test_base_url_trailing_slash_is_handled(monkeypatch):
    import httpx
    from app.services import groq_service

    monkeypatch.setattr(groq_service.settings, "AI_PROVIDER", "openai_compatible")
    monkeypatch.setattr(groq_service.settings, "AI_BASE_URL", OR + "/")
    monkeypatch.setattr(groq_service.settings, "AI_API_KEY", "k")
    monkeypatch.setattr(groq_service.settings, "AI_MODEL", "m")

    seen = {}

    class Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "x"}}]}

    monkeypatch.setattr(httpx, "post",
                        lambda url, **kw: (seen.update(url=url), Resp())[1])
    groq_service.complete("s", "u")
    assert "//chat/completions" not in seen["url"]


def test_health_reports_the_provider(client):
    body = client.get("/health").json()
    assert "ai_provider" in body


# ---------------- Known free models ----------------
# Verified against OpenRouter's live /models endpoint. Free ids churn, so these
# are a documented starting point rather than a guarantee.

def test_the_two_requested_models_are_listed():
    from app.config import Settings

    ids = [m["id"] for m in Settings.KNOWN_FREE_MODELS]
    assert "inclusionai/ling-3.0-flash:free" in ids
    assert "openai/gpt-oss-20b:free" in ids


def test_every_known_model_is_a_free_openrouter_id():
    from app.config import Settings

    for m in Settings.KNOWN_FREE_MODELS:
        assert m["id"].endswith(":free"), m["id"]
        assert "/" in m["id"], m["id"]
        assert m["context"] > 0
        assert isinstance(m["supports_json"], bool)


def test_json_support_is_recorded_accurately():
    """Checked against OpenRouter's supported_parameters.

    Ling 3.0 Flash does NOT advertise response_format. It still works --
    complete_json() salvages an object out of prose -- but the structured
    features are more reliable on gpt-oss-20b, which does support it.
    """
    from app.config import Settings

    by_id = {m["id"]: m for m in Settings.KNOWN_FREE_MODELS}
    assert by_id["openai/gpt-oss-20b:free"]["supports_json"] is True
    assert by_id["inclusionai/ling-3.0-flash:free"]["supports_json"] is False


def test_ai_status_reports_the_model_actually_in_use(monkeypatch, client):
    """It previously always returned GROQ_MODEL, which is wrong for an
    OpenAI-compatible provider."""
    from app.routers import ai as ai_router

    monkeypatch.setattr(ai_router.settings, "AI_PROVIDER", "openai_compatible")
    monkeypatch.setattr(ai_router.settings, "AI_BASE_URL", OR)
    monkeypatch.setattr(ai_router.settings, "AI_API_KEY", "k")
    monkeypatch.setattr(ai_router.settings, "AI_MODEL", "openai/gpt-oss-20b:free")
    monkeypatch.setattr(ai_router.groq_service, "is_available", lambda: True)

    r = client.post("/auth/login",
                    json={"email": "admin@buildiq.et", "password": "Demo1234!"})
    tok = {"Authorization": f"Bearer {r.json()['token']}"}
    body = client.get("/ai/status", headers=tok).json()

    assert body["model"] == "openai/gpt-oss-20b:free"
    assert "openrouter.ai" in body["provider"]
    assert any(m["id"] == "inclusionai/ling-3.0-flash:free"
               for m in body["known_free_models"])
