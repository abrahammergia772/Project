"""In-process rate limiting for the endpoints worth protecting.

Scope, stated honestly
----------------------
This is an in-memory fixed-window counter. It is not distributed: run two
Render instances and each keeps its own tally, so the effective limit doubles.
That is an acceptable trade at this size -- the alternative is a Redis
dependency for a service that currently runs a single instance -- but it is a
real limitation and `is_distributed()` reports it so /health can be honest
about it.

What it does buy, on one instance:
  * password guessing against /auth/login becomes impractical;
  * /auth/forgot-password cannot be used to spray reset mail;
  * AI endpoints cannot be used to burn the Groq quota.

Two independent limits are applied to auth endpoints: one keyed on client IP,
one on the submitted email. IP-only lets an attacker spread guesses for a
single account across many addresses; email-only lets one address hammer many
accounts. Both are cheap.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass(frozen=True)
class Rule:
    limit: int          # allowed requests...
    window: int         # ...per this many seconds
    scope: str          # label used in logs and the error message


# Deliberately generous enough that a real person never notices, and tight
# enough that automated guessing is pointless. A human mistyping their
# password five times in a minute is plausible; sixty times is not.
LOGIN = Rule(limit=10, window=300, scope="login")
SIGNUP = Rule(limit=5, window=3600, scope="signup")
FORGOT_PASSWORD = Rule(limit=5, window=3600, scope="password reset")
RESET_PASSWORD = Rule(limit=10, window=3600, scope="password reset")
AI = Rule(limit=30, window=60, scope="AI")


class _Counter:
    """Sliding-window counter, with a bound on memory."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def check(self, key: str, rule: Rule) -> tuple[bool, int]:
        """Returns (allowed, seconds_until_reset)."""
        now = time.monotonic()
        with self._lock:
            self._maybe_sweep(now)
            q = self._hits[key]
            cutoff = now - rule.window
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= rule.limit:
                return False, max(1, int(q[0] + rule.window - now))
            q.append(now)
            return True, 0

    def reset(self, key: str | None = None) -> None:
        """Clear a key, or everything. Used by tests and after a good login."""
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)

    def _maybe_sweep(self, now: float) -> None:
        """Drop empty buckets occasionally so a long uptime cannot leak memory
        one entry per distinct IP seen."""
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        dead = [k for k, q in self._hits.items() if not q or q[-1] < now - 3600]
        for k in dead:
            self._hits.pop(k, None)


_counter = _Counter()


def is_distributed() -> bool:
    """False: counters are per-process. See the module docstring."""
    return False


def client_ip(request: Request) -> str:
    """Best-effort client address.

    Render terminates TLS at a proxy, so request.client.host is the proxy.
    X-Forwarded-For's FIRST entry is the original client; the rest are
    intermediaries. It is spoofable by the client, which is exactly why the
    email-keyed limit exists alongside it -- neither is trusted alone.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(request: Request, rule: Rule, *, extra_key: str | None = None,
            by_ip: bool = True) -> None:
    """Apply `rule`, raising 429 when exceeded.

    `extra_key` adds a second, independent counter (typically the submitted
    email) so one identity cannot be attacked from many addresses.

    `by_ip=False` drops the address-based counter. Use it for AUTHENTICATED
    endpoints, where the user id is already trustworthy and the IP counter
    only causes collateral damage: a whole site office behind one NAT shares
    an address, so one person using the assistant heavily would lock out
    every colleague. For unauthenticated endpoints the IP counter is the only
    thing available and must stay on.
    """
    keys = []
    if by_ip:
        keys.append(f"{rule.scope}:ip:{client_ip(request)}")
    if extra_key:
        keys.append(f"{rule.scope}:id:{extra_key.lower()}")
    if not keys:                       # misuse: never silently allow everything
        raise ValueError("enforce() needs by_ip=True or an extra_key")

    for key in keys:
        allowed, retry_after = _counter.check(key, rule)
        if not allowed:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many {rule.scope} attempts. Try again in "
                f"{retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )


def clear_all() -> None:
    """Test hook. Never called by application code."""
    _counter.reset()


def clear(rule: Rule, *, ip: str | None = None, extra_key: str | None = None) -> None:
    """Forget a specific counter -- called after a SUCCESSFUL login so that a
    person who simply forgot their password is not locked out once they get
    it right."""
    if ip:
        _counter.reset(f"{rule.scope}:ip:{ip}")
    if extra_key:
        _counter.reset(f"{rule.scope}:id:{extra_key.lower()}")
