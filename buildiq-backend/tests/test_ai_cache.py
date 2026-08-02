"""AI response caching.

The one that matters is test_the_cache_is_scoped_per_role: a cache keyed only
on the endpoint would serve one user's briefing to another, turning a
performance optimisation into a data leak.
"""
from __future__ import annotations

import pytest

from app import rate_limit
from app.services import ai_cache

PW = "Demo1234!"


@pytest.fixture(autouse=True)
def _clean():
    ai_cache.clear()
    rate_limit.clear_all()
    yield
    ai_cache.clear()
    rate_limit.clear_all()


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, email
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------- Cache mechanics ----------------

def test_a_value_round_trips():
    key = ai_cache.make_key("probe", 1)
    ai_cache.set(key, "hello")
    assert ai_cache.get(key) == "hello"


def test_a_missing_key_returns_none():
    assert ai_cache.get(ai_cache.make_key("never", "stored")) is None


def test_entries_expire():
    key = ai_cache.make_key("ttl")
    ai_cache.set(key, "x", ttl=0)
    assert ai_cache.get(key) is None


def test_failures_are_never_cached():
    """Caching a None (the heuristic fallback) would pin the degraded answer
    for the whole TTL even after the provider recovers."""
    key = ai_cache.make_key("fail")
    ai_cache.set(key, None)
    assert ai_cache.get(key) is None


def test_different_inputs_get_different_keys():
    assert ai_cache.make_key("a", "b") != ai_cache.make_key("a", "c")
    assert ai_cache.make_key("a", "b") == ai_cache.make_key("a", "b")


def test_the_cache_is_bounded():
    """A long uptime must not grow memory without limit."""
    for i in range(ai_cache.MAX_ENTRIES + 50):
        ai_cache.set(ai_cache.make_key("bulk", i), i, ttl=300)
    assert ai_cache.stats()["entries"] <= ai_cache.MAX_ENTRIES


def test_stats_report_hits_and_misses():
    key = ai_cache.make_key("stats")
    ai_cache.get(key)                 # miss
    ai_cache.set(key, "v")
    ai_cache.get(key)                 # hit
    s = ai_cache.stats()
    assert s["hits"] == 1 and s["misses"] == 1


# ---------------- Scoping: the part that could leak data ----------------

def test_the_cache_is_scoped_per_role():
    """Two roles must never share an entry.

    The executive summary is written differently per role and built from
    role-scoped facts, so a key that ignored the role would hand a
    Department Manager the Super Admin's briefing.
    """
    facts = "- 3 projects\n- 1 high risk\n"
    admin_key = ai_cache.make_key("exec-summary", "Super Admin", facts)
    dm_key = ai_cache.make_key("exec-summary", "Department Manager", facts)
    assert admin_key != dm_key

    ai_cache.set(admin_key, "admin briefing")
    assert ai_cache.get(dm_key) is None


def test_different_facts_get_different_entries():
    """When the underlying data changes the key changes with it, so a stale
    briefing cannot outlive the facts it described."""
    a = ai_cache.make_key("exec-summary", "Engineer", "- 3 projects")
    b = ai_cache.make_key("exec-summary", "Engineer", "- 4 projects")
    assert a != b


def test_two_users_of_the_same_role_and_view_share_an_entry():
    """The actual win: identical scope means one LLM call, not two."""
    facts = "- 2 projects\n"
    assert (ai_cache.make_key("exec-summary", "Auditor", facts)
            == ai_cache.make_key("exec-summary", "Auditor", facts))


# ---------------- Endpoint behaviour ----------------

def test_the_summary_endpoint_reports_whether_it_was_cached(client):
    admin = _tok(client, "admin@buildiq.et")
    first = client.get("/ai/executive-summary", headers=admin)
    assert first.status_code == 200
    body = first.json()
    assert "summary" in body and body["summary"]

    # Without a live provider the heuristic path runs, which is deliberately
    # NOT cached -- so "cached" is either absent (heuristic) or False/True.
    if body.get("ai_source") == "heuristic":
        assert "cached" not in body
    else:
        second = client.get("/ai/executive-summary", headers=admin).json()
        assert second["cached"] is True


def test_ai_endpoints_are_rate_limited(client):
    """Otherwise one user can burn the whole Groq quota."""
    admin = _tok(client, "admin@buildiq.et")
    codes = [client.post("/ai/chat", headers=admin,
                         json={"message": "status?"}).status_code
             for _ in range(35)]
    assert 429 in codes


def test_the_rate_limit_is_per_user_not_global(client):
    """One heavy user must not lock everyone else out of the assistant."""
    admin = _tok(client, "admin@buildiq.et")
    for _ in range(35):
        client.post("/ai/chat", headers=admin, json={"message": "spam"})

    # Same source address, different account. This caught a real bug: the AI
    # limiter also counted per IP, so an office behind one NAT would have had
    # colleagues locking each other out of the assistant.
    eng = _tok(client, "engineer@buildiq.et")
    r = client.post("/ai/chat", headers=eng, json={"message": "am I locked out?"})
    assert r.status_code == 200
