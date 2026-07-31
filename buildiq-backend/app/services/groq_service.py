"""
BuildIQ — services/groq_service.py
Thin wrapper around the Groq chat-completions API.

Every helper degrades gracefully: if no API key is configured, the SDK is
missing, the call errors, or it times out, the caller falls back to the
deterministic heuristics in ai_engine.py. The product therefore works with
or without Groq, and never 500s because of an upstream AI outage.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..config import settings

log = logging.getLogger("buildiq.groq")

try:                                  # the SDK is optional
    from groq import Groq             # type: ignore
    _SDK_AVAILABLE = True
except Exception:                     # pragma: no cover
    Groq = None                       # type: ignore
    _SDK_AVAILABLE = False

_client: Any = None


def _client_or_none():
    """Lazily construct the client so importing this module is always safe."""
    global _client
    if not settings.groq_ready or not _SDK_AVAILABLE:
        return None
    if _client is None:
        try:
            _client = Groq(api_key=settings.GROQ_API_KEY, timeout=settings.GROQ_TIMEOUT_SECONDS)
        except Exception as exc:      # pragma: no cover
            log.warning("Groq client init failed, falling back to heuristics: %s", exc)
            return None
    return _client


def is_available() -> bool:
    # The OpenAI-compatible path needs no SDK client, only configuration.
    if settings.uses_openai_compatible:
        return settings.groq_ready
    return _client_or_none() is not None


def complete(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
    model: str | None = None,
) -> str | None:
    """
    One-shot completion. Returns the text, or None if Groq is unavailable or
    the call failed — callers must treat None as "use the local fallback".

    `model` overrides the configured default for this call only. It is passed
    through settings.resolve_model(), so an unknown id silently falls back
    rather than reaching the provider.
    """
    if settings.uses_openai_compatible:
        return _complete_openai_compatible(
            system, user, max_tokens=max_tokens,
            temperature=temperature, json_mode=json_mode, model=model,
        )

    client = _client_or_none()
    if client is None:
        return None

    kwargs: dict[str, Any] = {
        "model": settings.resolve_model(model),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens or settings.GROQ_MAX_TOKENS,
        "temperature": settings.GROQ_TEMPERATURE if temperature is None else temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    try:
        resp = client.chat.completions.create(**kwargs)
        return (resp.choices[0].message.content or "").strip() or None
    except Exception as exc:
        # Never propagate: an AI outage must not break the request.
        log.warning("Groq completion failed (%s) — using local fallback", exc)
        return None


def _complete_openai_compatible(
    system: str,
    user: str,
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
    model: str | None = None,
) -> str | None:
    """Call any provider exposing an OpenAI-style /chat/completions endpoint.

    Uses httpx directly rather than a second SDK: httpx is already a
    dependency, and the request shape is identical across OpenRouter,
    Cerebras, Scaleway, Kilo, Google AI Studio's compatibility layer and
    others. Returns None on ANY failure so the caller falls back to the
    deterministic heuristics, exactly like the Groq path.
    """
    import httpx

    if not settings.groq_ready:
        return None

    url = settings.AI_BASE_URL.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.resolve_model(model),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens or settings.GROQ_MAX_TOKENS,
        "temperature": settings.GROQ_TEMPERATURE if temperature is None else temperature,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.AI_API_KEY}",
                "Content-Type": "application/json",
                # OpenRouter asks for these; harmless elsewhere.
                "HTTP-Referer": "https://cmsai.onrender.com",
                "X-Title": "BuildIQ",
            },
            timeout=settings.GROQ_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        data = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except Exception as exc:
        log.warning(
            "%s completion failed (%s) — using local fallback",
            settings.AI_BASE_URL or "AI provider", exc,
        )
        return None


def complete_json(system: str, user: str, **kwargs) -> dict | None:
    """Completion that must return a JSON object. Returns None on any problem."""
    raw = complete(system, user, json_mode=True, **kwargs)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Some models wrap JSON in prose or fences — salvage the object.
        match = re.search(r"\{.*\}", raw, re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        log.warning("Groq returned unparseable JSON — using local fallback")
        return None


# ---------------- Prompt builders ----------------

SYSTEM_ANALYST = (
    "You are BuildIQ's construction-operations analyst. You write for site managers "
    "and executives at an Ethiopian construction firm. Be specific, quantitative and "
    "actionable. Never invent figures that were not given to you. Keep to plain prose "
    "with no markdown headings."
)

SYSTEM_TRIAGE = (
    "You are BuildIQ's complaint triage engine for a construction company. "
    "You classify complaints and reply with strict JSON only."
)

SYSTEM_ASSISTANT = (
    "You are BuildIQ Assistant, embedded in a construction management platform. "
    "Answer only from the context provided. If the context doesn't contain the "
    "answer, say so plainly rather than guessing. Be concise — a few sentences "
    "or a short bulleted list. You may use **bold** for emphasis."
)


def classify_complaint(text: str, categories: list[str], departments: dict[str, str]) -> dict | None:
    """Ask Groq to triage a complaint. Returns None to fall back to keywords."""
    payload = complete_json(
        SYSTEM_TRIAGE,
        (
            f"Classify this construction complaint.\n\n"
            f"Complaint: \"\"\"{text[:2000]}\"\"\"\n\n"
            f"Allowed categories: {', '.join(categories)}\n"
            f"Allowed severities: critical, high, medium, low\n"
            f"Allowed sentiments: Angry, Frustrated, Neutral\n\n"
            "Reply with JSON exactly: "
            '{"category": "...", "severity": "...", "sentiment": "...", '
            '"confidence": 0-100, "summary": "one sentence"}'
        ),
        temperature=0.1,
        max_tokens=250,
    )
    if not payload:
        return None

    category = payload.get("category")
    if category not in categories:
        return None                      # unusable — fall back
    severity = str(payload.get("severity", "medium")).lower()
    if severity not in {"critical", "high", "medium", "low"}:
        severity = "medium"

    try:
        confidence = max(0, min(100, int(payload.get("confidence", 80))))
    except (TypeError, ValueError):
        confidence = 80

    return {
        "category": category,
        "department": departments.get(category, "Site Operations"),
        "severity": severity,
        "sentiment": payload.get("sentiment") or "Neutral",
        "confidence": confidence,
        "ai_summary": payload.get("summary")
        or f"AI classified this as a {severity} priority {category.lower()} issue.",
    }


def suggest_resolution(category: str | None, severity: str | None, text: str) -> str | None:
    return complete(
        SYSTEM_ANALYST,
        (
            f"A {severity or 'medium'} severity complaint categorised as "
            f"'{category or 'General'}' was raised:\n\n\"\"\"{text[:1500]}\"\"\"\n\n"
            "Draft a resolution the responsible manager can send. Give 2-4 concrete "
            "steps with owners and timeframes. Under 120 words, no preamble."
        ),
        max_tokens=320,
    )


def project_risk_explanation(project: dict, probability: float) -> str | None:
    return complete(
        SYSTEM_ANALYST,
        (
            f"Project: {project.get('title')}\n"
            f"Type: {project.get('type')} in {project.get('region')}\n"
            f"Actual progress: {project.get('progress')}%\n"
            f"Expected progress: {project.get('expected_progress')}%\n"
            f"Budget: {project.get('budget')}, spent: {project.get('spent')}\n"
            f"Known delay factors: {', '.join(project.get('delay_reasons') or []) or 'none recorded'}\n"
            f"Model-estimated delay probability: {probability * 100:.0f}%\n\n"
            "Explain the delay risk in 3-4 sentences, then give three numbered "
            "recommendations. Reference the actual figures above."
        ),
        max_tokens=420,
    )


def report_narrative(report_type: str, scope: str, facts: str) -> str | None:
    return complete(
        SYSTEM_ANALYST,
        (
            f"Write the executive summary for a '{report_type}' report covering {scope}.\n\n"
            f"Figures:\n{facts}\n\n"
            "One or two paragraphs, under 200 words. Lead with the most important "
            "finding and close with a recommendation. Use only the figures given."
        ),
        max_tokens=460,
    )


def executive_summary(facts: str, role: str) -> str | None:
    return complete(
        SYSTEM_ANALYST,
        (
            f"Write a 2-3 sentence dashboard briefing for a {role}.\n\n"
            f"Current position:\n{facts}\n\n"
            "State the single most pressing issue and the recommended focus for this week."
        ),
        max_tokens=220,
    )


def chat(message: str, context: str, history: list[dict] | None = None,
         model: str | None = None) -> str | None:
    convo = ""
    for turn in (history or [])[-6:]:
        who = "User" if turn.get("role") == "user" else "Assistant"
        convo += f"{who}: {turn.get('content', '')}\n"

    return complete(
        SYSTEM_ASSISTANT,
        (
            f"Context available to this user:\n{context}\n\n"
            f"{('Conversation so far:' + chr(10) + convo + chr(10)) if convo else ''}"
            f"User's question: {message}"
        ),
        max_tokens=520,
        temperature=0.5,
        model=model,
    )
