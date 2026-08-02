"""
BuildIQ — routers/ai.py
Groq-backed chatbot, global search, dashboard stats and executive summary.
Everything is scoped to what the caller is allowed to see, and the context
handed to Groq is built from that same scoped data — the model never sees
records the user couldn't already read.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ai_engine, rate_limit
from ..config import settings
from ..database import get_db
from ..deps import (
    complaint_dict, managed_projects, member_dict, project_dict,
    visible_complaints, visible_members, visible_projects,
)
from ..models import AuditLog, User
from ..schemas import (
    ChatRequest, ChatResponse, DashboardStats, SearchRequest, SearchResponse,
)
from ..security import AUDITOR, CLIENT, ORG_WIDE, PROJECT_MANAGER, get_current_user
from ..services import ai_cache, groq_service

router = APIRouter(tags=["ai"])


def _scoped_context(db: Session, user: User) -> dict:
    return {
        "projects": [project_dict(p, include_team=False) for p in visible_projects(db, user)],
        "complaints": [complaint_dict(c) for c in visible_complaints(db, user)],
        "members": [member_dict(m) for m in visible_members(db, user)],
    }


def _context_prompt(ctx: dict, user: User) -> str:
    """A compact, factual digest for the model — capped so prompts stay small."""
    projects, complaints, members = ctx["projects"], ctx["complaints"], ctx["members"]
    lines = [f"Signed-in user: {user.full_name}, role {user.role}"
             + (f", department {user.department}" if user.department else "")]

    lines.append(f"\nPROJECTS VISIBLE ({len(projects)}):")
    for p in projects[:12]:
        lines.append(
            f"- {p['title']} | {p['department']} | {p['progress']}% done (expected "
            f"{p['expected_progress']}%) | risk {p['delay_risk']} | manager {p['manager_name'] or 'unassigned'}"
        )
    if len(projects) > 12:
        lines.append(f"  ...and {len(projects) - 12} more")

    open_c = [c for c in complaints if c["status"] != "resolved"]
    lines.append(f"\nCOMPLAINTS VISIBLE ({len(complaints)} total, {len(open_c)} open):")
    for c in open_c[:8]:
        lines.append(f"- {c['id']} | {c['category']} | {c['severity']} | {c['department']} | {c['project'] or 'n/a'}")

    lines.append(f"\nTEAM VISIBLE ({len(members)}):")
    busiest = sorted(members, key=lambda m: m.get("projects_count", 0), reverse=True)[:6]
    for m in busiest:
        lines.append(f"- {m['full_name']} | {m['role']} | {m['department']} | {m.get('projects_count', 0)} projects")
    return "\n".join(lines)


@router.post("/ai/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, request: Request,
         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rate_limit.enforce(request, rate_limit.AI, extra_key=user.id, by_ip=False)
    ctx = _scoped_context(db, user)
    # An unknown or disallowed id resolves to the default rather than erroring.
    chosen = settings.resolve_model(payload.model)
    reply = groq_service.chat(
        payload.message, _context_prompt(ctx, user), payload.history, model=chosen
    )
    if reply:
        return ChatResponse(reply=reply, ai_source="groq", model=chosen)
    return ChatResponse(
        reply=ai_engine.chatbot_reply(payload.message, user.role, user.department, ctx),
        ai_source="heuristic",
        model=None,
    )


@router.post("/ai/search", response_model=SearchResponse)
def search(payload: SearchRequest, request: Request,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rate_limit.enforce(request, rate_limit.AI, extra_key=user.id, by_ip=False)
    q = payload.query.lower().strip()
    if not q:
        return SearchResponse()

    members = [] if user.role in (AUDITOR, CLIENT) else [
        member_dict(m) for m in visible_members(db, user) if q in m.full_name.lower()][:5]
    projects = [project_dict(p) for p in visible_projects(db, user) if q in p.title.lower()][:5]
    complaints = [complaint_dict(c) for c in visible_complaints(db, user)
                  if q in (c.text or "").lower() or q in (c.category or "").lower()][:5]
    return SearchResponse(members=members, projects=projects, complaints=complaints)


@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = managed_projects(db, user) if user.role == PROJECT_MANAGER else visible_projects(db, user)
    complaints = visible_complaints(db, user)
    members = visible_members(db, user)

    audit_flags = 0
    if user.role in ORG_WIDE + [AUDITOR]:
        audit_flags = db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.is_flagged.is_(True))) or 0

    return DashboardStats(
        active_projects=sum(1 for p in projects if p.status == "In Progress"),
        total_members=sum(1 for m in members if m.role != CLIENT),
        high_risk=sum(1 for p in projects if p.delay_risk == "HIGH"),
        open_complaints=sum(1 for c in complaints if c.status != "resolved"),
        audit_flags=audit_flags,
    )


@router.get("/ai/executive-summary")
def executive_summary(request: Request,
                      user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    """The natural-language briefing shown at the top of role dashboards."""
    rate_limit.enforce(request, rate_limit.AI, extra_key=user.id, by_ip=False)
    projects = [project_dict(p, include_team=False) for p in
                (managed_projects(db, user) if user.role == PROJECT_MANAGER else visible_projects(db, user))]
    complaints = [complaint_dict(c) for c in visible_complaints(db, user)]

    high_risk = [p for p in projects if p["delay_risk"] == "HIGH"]
    behind = [p for p in projects if p["progress"] < p["expected_progress"]]
    open_c = [c for c in complaints if c["status"] != "resolved"]
    critical = [c for c in open_c if c["severity"] == "critical"]

    facts = (
        f"- {len(projects)} project(s) in view; {len(high_risk)} flagged HIGH delay risk\n"
        f"- {len(behind)} trailing their planned schedule\n"
        f"- {len(open_c)} open complaint(s), {len(critical)} critical\n"
    )
    if high_risk:
        facts += "- Highest risk: " + ", ".join(
            f"{p['title']} ({p['progress']}% vs {p['expected_progress']}%)" for p in high_risk[:3]) + "\n"

    # Cached on the facts themselves, not on the user id: two managers with
    # an identical view share the answer, and the moment anything they can
    # see changes the key changes with it. Role is in the key because the
    # prompt is written differently per role.
    cache_key = ai_cache.make_key("exec-summary", user.role, facts)
    cached = ai_cache.get(cache_key)
    if cached is not None:
        return {"summary": cached, "ai_source": "groq", "cached": True}

    summary = groq_service.executive_summary(facts, user.role)
    if summary:
        # Only real LLM output is cached -- pinning the fallback would keep
        # the degraded answer for the full TTL after the provider recovers.
        ai_cache.set(cache_key, summary)
        return {"summary": summary, "ai_source": "groq", "cached": False}

    # Deterministic fallback
    parts = [f"You have {len(projects)} project(s) in view."]
    parts.append(
        f"{len(high_risk)} flagged HIGH risk ({', '.join(p['title'] for p in high_risk[:2])})."
        if high_risk else "None are flagged HIGH risk.")
    if behind:
        parts.append(f"{len(behind)} trailing the planned schedule.")
    parts.append(f"{len(open_c)} open complaint(s), {len(critical)} critical.")
    parts.append("Recommend re-sequencing critical-path tasks and clearing critical complaints first."
                 if high_risk or critical else "Delivery is tracking to plan — keep the current cadence.")
    return {"summary": " ".join(parts), "ai_source": "heuristic"}


@router.get("/ai/status")
def ai_status(user: User = Depends(get_current_user)):
    """Lets the UI show whether live AI is active or heuristics are in use."""
    live = groq_service.is_available()
    # Report the model ACTUALLY in use. This previously always returned
    # GROQ_MODEL, so an OpenAI-compatible provider showed the wrong name.
    if live and settings.uses_openai_compatible:
        model = settings.AI_MODEL
    elif live:
        model = settings.GROQ_MODEL
    else:
        model = None

    return {
        "groq_available": live,          # kept: the frontend reads this key
        "model": model,
        "mode": "groq" if live else "heuristic",
        "provider": settings.ai_provider_label,
        # Verified free models you can drop into AI_MODEL. Free model ids
        # churn, so this is a starting point rather than a guarantee.
        "known_free_models": settings.KNOWN_FREE_MODELS,
        # Ids a client may send as ChatRequest.model. Anything else is ignored.
        "selectable_models": settings.allowed_models(),
    }
