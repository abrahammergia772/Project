"""Password policy, rate limiting, and production hardening.

The rate-limit tests clear the counters around themselves: the limiter is
process-global, so without that they would leak state into every other test
module and the login-based fixtures elsewhere would start returning 429.
"""
from __future__ import annotations

import pytest

from app import rate_limit
from app.password_policy import (
    MIN_LENGTH, PasswordPolicyError, strength, validate_password,
)

PW = "Demo1234!"


@pytest.fixture(autouse=True)
def _clean_limiter():
    rate_limit.clear_all()
    yield
    rate_limit.clear_all()


# ---------------- Password policy ----------------

def test_a_good_password_is_accepted():
    validate_password("correct-horse-7-battery")


@pytest.mark.parametrize("pw,because", [
    ("Ab1", "too short"),
    ("short12", "under the minimum"),
    ("abcdefghijkl", "no digit"),
    ("123456789012", "no letter"),
    ("password123", "on the common list"),
    ("Passw0rd", "too short and common-ish"),
    ("aaaa1111bbbb", "repeated runs"),
    ("abcde12345xyz", "keyboard sequence"),
    (" leading12345", "leading space"),
])
def test_weak_passwords_are_rejected(pw, because):
    with pytest.raises(PasswordPolicyError):
        validate_password(pw)


def test_minimum_length_is_ten_not_eight():
    """The plan raised this from 8. Nine must fail, ten must pass."""
    assert MIN_LENGTH == 10
    with pytest.raises(PasswordPolicyError):
        validate_password("Abcxyz1qw")            # 9 chars, otherwise fine
    validate_password("Abcxyz1qwe")               # 10


def test_a_password_cannot_contain_the_users_name():
    with pytest.raises(PasswordPolicyError) as exc:
        validate_password("abebekebede2026", full_name="Abebe Kebede")
    assert "name" in str(exc.value).lower()


def test_a_password_cannot_contain_the_email_local_part():
    with pytest.raises(PasswordPolicyError) as exc:
        validate_password("meron.tadesse99x", email="meron@buildiq.et")
    assert "email" in str(exc.value).lower()


def test_short_name_tokens_do_not_cause_false_rejections():
    """A two-letter name fragment must not blacklist every password
    containing those letters."""
    validate_password("thunder-42-cliff", full_name="Al Bo")


def test_bcrypt_truncation_is_rejected_not_ignored():
    """Bcrypt silently truncates at 72 bytes, so two different long passwords
    can hash identically. Rejecting is safer than silently ignoring the tail."""
    with pytest.raises(PasswordPolicyError):
        validate_password("a1" + "x" * 80)


def test_strength_meter_ranks_sensibly():
    assert strength("password")["score"] <= 1
    assert strength("correct-horse-7-battery-staple")["score"] >= 3


# ---------------- Password policy is enforced by the API ----------------

def test_signup_rejects_a_weak_password(client):
    r = client.post("/auth/signup", json={
        "email": "weak.pw@buildiq.et", "password": "password123",
        "full_name": "Weak Password", "role": "Engineer",
    })
    assert r.status_code == 422
    assert "common" in r.json()["detail"].lower()


def test_signup_accepts_a_strong_password(client):
    r = client.post("/auth/signup", json={
        "email": "strong.pw@buildiq.et", "password": "quarry-lift-91-north",
        "full_name": "Strong Password", "role": "Engineer",
    })
    assert r.status_code == 201


def test_signup_rejects_a_password_containing_the_users_name(client):
    # The email deliberately shares nothing with the password, so the NAME
    # rule is what is under test -- an earlier version used selam.b@... and
    # tripped the email rule first, testing the wrong branch.
    r = client.post("/auth/signup", json={
        "email": "sb.contact@buildiq.et", "password": "selambekele2026",
        "full_name": "Selam Bekele", "role": "Engineer",
    })
    assert r.status_code == 422
    assert "name" in r.json()["detail"].lower()


def test_the_reset_path_enforces_the_same_policy(client):
    """A policy applied to only one of two write paths is not a policy.

    Without this the reset flow could set 'abc' on any account.
    """
    email = "reset.policy@buildiq.et"
    client.post("/auth/signup", json={
        "email": email, "password": "granite-hoist-55", "full_name": "Reset Policy",
        "role": "Engineer",
    })
    token = client.post("/auth/forgot-password",
                        json={"email": email}).json().get("demo_token")
    assert token, "dev mode should return a walkable token"

    bad = client.post("/auth/reset-password",
                      json={"token": token, "new_password": "password123"})
    assert bad.status_code == 422

    good = client.post("/auth/reset-password",
                       json={"token": token, "new_password": "basalt-crane-77"})
    assert good.status_code == 200


# ---------------- Rate limiting ----------------

def test_repeated_bad_logins_are_throttled(client):
    body = {"email": "admin@buildiq.et", "password": "wrong-password-here"}
    codes = [client.post("/auth/login", json=body).status_code for _ in range(12)]
    assert 401 in codes, "the first attempts should be ordinary failures"
    assert 429 in codes, "sustained guessing must be throttled"


def test_the_throttle_response_says_when_to_retry(client):
    body = {"email": "throttle.probe@buildiq.et", "password": "nope-nope-nope"}
    last = None
    for _ in range(12):
        last = client.post("/auth/login", json=body)
    assert last.status_code == 429
    assert "Retry-After" in last.headers
    assert int(last.headers["Retry-After"]) > 0


def test_a_successful_login_clears_the_counter(client):
    """Someone who forgot their password must not stay locked out after
    finally getting it right."""
    for _ in range(6):
        client.post("/auth/login",
                    json={"email": "engineer@buildiq.et", "password": "wrong"})
    ok = client.post("/auth/login",
                     json={"email": "engineer@buildiq.et", "password": PW})
    assert ok.status_code == 200
    again = client.post("/auth/login",
                        json={"email": "engineer@buildiq.et", "password": PW})
    assert again.status_code == 200, "counter should have been reset"


def test_one_email_cannot_be_attacked_from_many_addresses(client):
    """IP-keyed limiting alone is trivially bypassed with a proxy pool, so
    there is a second counter keyed on the targeted email."""
    target = {"email": "gm@buildiq.et", "password": "guessing-away-now"}
    codes = []
    for i in range(12):
        codes.append(client.post("/auth/login", json=target,
                                 headers={"X-Forwarded-For": f"203.0.113.{i}"}).status_code)
    assert 429 in codes, "the email-keyed counter must catch distributed guessing"


def test_different_accounts_do_not_share_a_counter(client):
    """...but the reverse must not happen: one user hitting the limit cannot
    lock everyone else out."""
    for i in range(12):
        client.post("/auth/login",
                    json={"email": "victim@buildiq.et", "password": "x-wrong-x"},
                    headers={"X-Forwarded-For": "198.51.100.7"})
    other = client.post("/auth/login",
                        json={"email": "engineer@buildiq.et", "password": PW},
                        headers={"X-Forwarded-For": "198.51.100.99"})
    assert other.status_code == 200


def test_password_reset_cannot_be_sprayed(client):
    codes = [client.post("/auth/forgot-password",
                         json={"email": "admin@buildiq.et"}).status_code
             for _ in range(8)]
    assert 429 in codes


def test_the_limiter_is_honest_about_not_being_distributed():
    assert rate_limit.is_distributed() is False


def test_client_ip_prefers_the_original_forwarded_address():
    """Render terminates TLS at a proxy, so request.client.host is the proxy.
    The FIRST X-Forwarded-For entry is the real client."""
    class _Req:
        headers = {"x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178"}
        client = type("C", (), {"host": "10.0.0.1"})()
    assert rate_limit.client_ip(_Req()) == "203.0.113.5"


# ---------------- Production hardening ----------------

def test_security_headers_are_present(client):
    r = client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"


def test_hsts_is_not_sent_outside_production(client):
    """Sending HSTS from a local http server pins a developer's browser to
    https for localhost and breaks it."""
    r = client.get("/health")
    assert "Strict-Transport-Security" not in r.headers


def test_docs_are_open_in_development(client):
    assert client.get("/docs").status_code == 200


def test_docs_are_disabled_when_env_is_production(monkeypatch):
    """The live service currently exposes /docs to the world because ENV is
    unset. Setting ENV=production must switch it off."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("SECRET_KEY", "a-real-looking-production-secret")
    monkeypatch.setenv("ALLOW_SQLITE", "true")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./prod_probe.db")

    import importlib

    from app import config
    importlib.reload(config)
    config.get_settings.cache_clear()

    try:
        assert config.settings.is_production
        from app import main
        importlib.reload(main)
        with TestClient(main.app) as c:
            assert c.get("/docs").status_code == 404
            assert c.get("/redoc").status_code == 404
            assert c.get("/openapi.json").status_code == 404
            # And HSTS appears only here.
            assert "Strict-Transport-Security" in c.get("/health").headers
            assert c.get("/").json()["docs"] is None
    finally:
        # Restore the shared modules, or every later test sees production.
        for var in ("ENV", "SECRET_KEY", "DATABASE_URL"):
            monkeypatch.delenv(var, raising=False)
        importlib.reload(config)
        config.get_settings.cache_clear()
        from app import main as m
        importlib.reload(m)


def test_forgot_password_withholds_the_token_in_production(client, monkeypatch):
    """Today this endpoint hands a working reset token to anyone who knows an
    email address -- a full account-takeover path on the live service.

    Patches the settings object the router actually holds. An earlier version
    reloaded app.config, which left the router bound to an orphaned copy and
    asserted nothing.
    """
    from app.routers import auth as auth_router

    email = "prod.reset@buildiq.et"
    client.post("/auth/signup", json={
        "email": email, "password": "girder-tower-63", "full_name": "Prod Reset",
        "role": "Engineer",
    })

    # Development: the token is returned so the flow is walkable without mail.
    dev = client.post("/auth/forgot-password", json={"email": email})
    assert dev.status_code == 200
    assert dev.json()["demo_token"], "dev mode should return a walkable token"

    monkeypatch.setattr(auth_router.settings, "ENV", "production")
    assert auth_router.settings.is_production

    prod = client.post("/auth/forgot-password", json={"email": email})
    assert prod.status_code == 200
    assert prod.json()["demo_token"] is None, (
        "production must never return the reset token in the response body")
    # The generic message is unchanged, so account enumeration is still blocked.
    assert "if that email exists" in prod.json()["message"].lower()
