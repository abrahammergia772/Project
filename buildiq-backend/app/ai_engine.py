"""
BuildIQ — ai_engine.py
Deterministic scoring, ranking and classification, ported from the frontend's
js/ai-engine.js so both sides produce identical numbers.

Groq is layered on top of these in the routers: where an LLM adds value
(narratives, explanations, triage nuance) it is tried first and these
functions are the fallback. Pure functions, no I/O, fully unit-testable.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SLOTS = ["09:00", "10:30", "13:00", "14:30", "16:00"]
RISK_POINTS = {"CRITICAL": 30, "HIGH": 25, "MEDIUM": 12, "LOW": 4}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ============================================================
#  Audit taxonomy — the seven audit types
# ============================================================
AUDIT_TYPES: dict[str, dict[str, Any]] = {
    "SECURITY": {
        "label": "Security Audit", "icon": "fa-lock", "color": "red",
        "purpose": "Monitors who accesses the system and how",
        "ml_role": "Anomaly detection",
        "signals": ["Failed login attempts", "Logins at unusual hours",
                    "Multiple IP address changes", "Unauthorized module access"],
        "actions": ["LOGIN", "LOGIN_FAILED", "LOGOUT", "IP_CHANGE",
                    "UNAUTHORIZED_ACCESS", "PERMISSION_CHANGE"],
    },
    "FINANCIAL": {
        "label": "Financial Audit", "icon": "fa-coins", "color": "yellow",
        "purpose": "Tracks all money-related actions",
        "ml_role": "Outlier scoring",
        "signals": ["Payment approvals", "Budget modifications",
                    "Invoice creation/deletion", "Expense claims above threshold"],
        "actions": ["PAYMENT_APPROVAL", "BUDGET_MODIFY", "INVOICE_CREATE",
                    "INVOICE_DELETE", "EXPENSE_CLAIM"],
    },
    "COMPLIANCE": {
        "label": "Compliance Audit", "icon": "fa-clipboard-check", "color": "blue",
        "purpose": "Ensures users follow company rules",
        "ml_role": "Rule violation scoring",
        "signals": ["Proper approval chains followed?", "Documents submitted on time?",
                    "Required fields filled correctly?", "Policy violations flagged"],
        "actions": ["APPROVAL_BYPASS", "LATE_SUBMISSION", "INCOMPLETE_RECORD", "POLICY_VIOLATION"],
    },
    "USER_ACTIVITY": {
        "label": "User Activity Audit", "icon": "fa-user-clock", "color": "purple",
        "purpose": "Tracks what every user does",
        "ml_role": "Pattern detection",
        "signals": ["Actions per session", "Bulk operations (mass delete/edit)",
                    "Role misuse (doing things outside their role)",
                    "Inactive accounts still accessing system"],
        "actions": ["BULK_DELETE", "BULK_EDIT", "ROLE_MISUSE", "DORMANT_ACCESS", "VIEW_SENSITIVE"],
    },
    "DATA_INTEGRITY": {
        "label": "Data Integrity Audit", "icon": "fa-database", "color": "accent",
        "purpose": "Detects unauthorized data changes",
        "ml_role": "Change anomaly detection",
        "signals": ["Record edits without approval", "Deleted records",
                    "Duplicate entries", "Data imported from outside sources"],
        "actions": ["UPDATE_RECORD", "UNAPPROVED_EDIT", "RECORD_DELETE",
                    "DUPLICATE_ENTRY", "EXTERNAL_IMPORT"],
    },
    "PROJECT_RESOURCE": {
        "label": "Project & Resource Audit", "icon": "fa-helmet-safety", "color": "cyan",
        "purpose": "Construction-specific resource and delivery oversight",
        "ml_role": "Predictive analytics",
        "signals": ["Material usage vs budget", "Equipment assigned vs returned",
                    "Project milestone delays", "Contractor performance tracking"],
        "actions": ["MATERIAL_OVERUSE", "EQUIPMENT_CHECKOUT", "EQUIPMENT_UNRETURNED",
                    "MILESTONE_DELAY", "CONTRACTOR_REVIEW"],
    },
    "REPORT_DOCUMENT": {
        "label": "Report & Document Audit", "icon": "fa-file-shield", "color": "green",
        "purpose": "Tracks report generation and document access activity",
        "ml_role": "Access pattern analysis",
        "signals": ["Who generated what report", "Reports downloaded or shared externally",
                    "Modified reports after approval", "Frequency of report generation"],
        "actions": ["REPORT_GENERATE", "EXPORT_DATA", "EXTERNAL_SHARE",
                    "POST_APPROVAL_EDIT", "FILE_UPLOAD", "DELETE_DOCUMENT"],
    },
}

ACTION_TO_TYPE: dict[str, str] = {
    action: key for key, meta in AUDIT_TYPES.items() for action in meta["actions"]
}

ACTION_LABELS = {
    "LOGIN": "Login", "LOGIN_FAILED": "Failed login", "LOGOUT": "Logout",
    "IP_CHANGE": "IP address change", "UNAUTHORIZED_ACCESS": "Unauthorized module access",
    "PERMISSION_CHANGE": "Permission change", "PAYMENT_APPROVAL": "Payment approval",
    "BUDGET_MODIFY": "Budget modification", "INVOICE_CREATE": "Invoice created",
    "INVOICE_DELETE": "Invoice deleted", "EXPENSE_CLAIM": "Expense claim",
    "APPROVAL_BYPASS": "Approval chain bypassed", "LATE_SUBMISSION": "Late document submission",
    "INCOMPLETE_RECORD": "Incomplete required fields", "POLICY_VIOLATION": "Policy violation",
    "BULK_DELETE": "Bulk delete", "BULK_EDIT": "Bulk edit", "ROLE_MISUSE": "Role misuse",
    "DORMANT_ACCESS": "Dormant account access", "VIEW_SENSITIVE": "Viewed sensitive data",
    "UPDATE_RECORD": "Record updated", "UNAPPROVED_EDIT": "Edit without approval",
    "RECORD_DELETE": "Record deleted", "DUPLICATE_ENTRY": "Duplicate entry",
    "EXTERNAL_IMPORT": "External data import", "MATERIAL_OVERUSE": "Material usage over budget",
    "EQUIPMENT_CHECKOUT": "Equipment checked out", "EQUIPMENT_UNRETURNED": "Equipment not returned",
    "MILESTONE_DELAY": "Milestone delay", "CONTRACTOR_REVIEW": "Contractor performance review",
    "REPORT_GENERATE": "Report generated", "EXPORT_DATA": "Data export",
    "EXTERNAL_SHARE": "Shared externally", "POST_APPROVAL_EDIT": "Report edited after approval",
    "FILE_UPLOAD": "File upload", "DELETE_DOCUMENT": "Document deleted",
    "SUSPEND_USER": "User suspended",
}

HIGH_RISK_ACTIONS = {
    "LOGIN_FAILED", "UNAUTHORIZED_ACCESS", "PERMISSION_CHANGE", "IP_CHANGE",
    "INVOICE_DELETE", "BUDGET_MODIFY", "APPROVAL_BYPASS", "POLICY_VIOLATION",
    "BULK_DELETE", "ROLE_MISUSE", "DORMANT_ACCESS", "UNAPPROVED_EDIT",
    "RECORD_DELETE", "EXTERNAL_IMPORT", "MATERIAL_OVERUSE", "EQUIPMENT_UNRETURNED",
    "EXTERNAL_SHARE", "POST_APPROVAL_EDIT", "EXPORT_DATA", "SUSPEND_USER",
}


def audit_type_for_action(action: str) -> str:
    return ACTION_TO_TYPE.get(action, "USER_ACTIVITY")


def action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action.replace("_", " ").lower())


def _explain_audit(type_key: str, actor: str, action: str, score: float) -> str:
    if score <= 0.5:
        return "Access pattern consistent with role and history."
    label = action_label(action).lower()
    by = {
        "SECURITY": f"Anomaly detection flagged {actor}: {label} deviates from their established access baseline.",
        "FINANCIAL": f"Outlier scoring flagged {actor}: this {label} sits outside the normal value distribution for their history.",
        "COMPLIANCE": f"Rule violation scoring flagged {actor}: {label} breaks a required approval or submission rule.",
        "USER_ACTIVITY": f"Pattern detection flagged {actor}: {label} is inconsistent with the volume this role normally performs.",
        "DATA_INTEGRITY": f"Change anomaly detection flagged {actor}: {label} altered records without the expected approval trail.",
        "PROJECT_RESOURCE": f"Predictive analytics flagged {actor}: {label} projects a budget or schedule overrun.",
        "REPORT_DOCUMENT": f"Access pattern analysis flagged {actor}: {label} is an unusual distribution pattern for this sensitivity.",
    }
    return by.get(type_key, by["USER_ACTIVITY"])


def score_audit_event(action: str, actor_name: str, when: datetime | None = None) -> dict:
    when = when or _now()
    hour = when.hour
    odd_hours = hour < 6 or hour > 22
    type_key = audit_type_for_action(action)
    base = (0.45 if action in HIGH_RISK_ACTIONS else 0.08) + (0.28 if odd_hours else 0.0)
    score = round(min(0.99, base + 0.09), 4)
    return {
        "audit_type": type_key,
        "ml_role": AUDIT_TYPES[type_key]["ml_role"],
        "action_label": action_label(action),
        "anomaly_score": score,
        "risk_level": "CRITICAL" if score > 0.85 else "HIGH" if score > 0.65 else "MEDIUM" if score > 0.45 else "LOW",
        "is_flagged": score > 0.5,
        "context": (f"Performed at {hour:02d}:00 — outside working hours" if odd_hours else "Normal business hours"),
        "explanation": _explain_audit(type_key, actor_name, action, score),
        "review_status": "Under Review" if score > 0.5 else "Cleared",
    }


# ============================================================
#  Task prioritisation and scheduling
# ============================================================
def score_task(task: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    due = _aware(task.get("due_date"))
    days_until_due = (due - now).total_seconds() / 86400 if due else 30

    score, reasons = 0, []
    if days_until_due < 0:
        score += 45
        reasons.append(f"overdue by {abs(round(days_until_due))}d")
    elif days_until_due <= 1:
        score += 40
        reasons.append("due within 24h")
    elif days_until_due <= 3:
        score += 28
        reasons.append(f"due in {int(days_until_due) + 1}d")
    elif days_until_due <= 7:
        score += 16
        reasons.append("due this week")
    else:
        score += 6

    rp = RISK_POINTS.get(str(task.get("project_risk", "LOW")).upper(), 4)
    score += rp
    if rp >= 25:
        reasons.append(f'project "{task.get("project_title")}" is {task.get("project_risk")} risk')

    if task.get("blocking"):
        score += 15
        reasons.append("blocks other tasks")
    if task.get("status") == "In Progress":
        score += 6
    if task.get("status") == "Done":
        score, reasons = 2, ["already completed"]

    score = max(0, min(100, round(score)))
    return {
        **task,
        "ai_score": score,
        "ai_priority": "CRITICAL" if score >= 75 else "HIGH" if score >= 55 else "MEDIUM" if score >= 30 else "LOW",
        "ai_reason": " · ".join(reasons[:2]) if reasons else "no immediate urgency signals",
        "days_until_due": round(days_until_due),
    }


def prioritize_tasks(tasks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted((score_task(t) for t in tasks), key=lambda t: t["ai_score"], reverse=True)


def auto_schedule(tasks: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Greedy placement of top-priority open tasks into a Mon-Fri slot grid."""
    open_tasks = prioritize_tasks(t for t in tasks if t.get("status") != "Done")
    grid: dict[str, Any] = {f"{d}-{s}": None for d in WORK_DAYS for s in SLOTS}

    day_idx = slot_idx = 0
    for task in open_tasks:
        blocks = max(1, int(-(-float(task.get("estimated_hours") or 2) // 1.5)))
        placed = 0
        while placed < blocks and day_idx < len(WORK_DAYS):
            key = f"{WORK_DAYS[day_idx]}-{SLOTS[slot_idx]}"
            if grid[key] is None:
                grid[key] = task
                placed += 1
            slot_idx += 1
            if slot_idx >= len(SLOTS):
                slot_idx, day_idx = 0, day_idx + 1
        if day_idx >= len(WORK_DAYS):
            break
    return grid


# ============================================================
#  Department health
# ============================================================
def department_health(dept_name: str, projects: list[dict], members: list[dict], complaints: list[dict]) -> dict:
    dp = [p for p in projects if p.get("department") == dept_name]
    dm = [m for m in members if m.get("department") == dept_name]
    dc = [c for c in complaints if c.get("department") == dept_name]

    avg_gap = sum(p.get("expected_progress", 0) - p.get("progress", 0) for p in dp) / len(dp) if dp else 0
    high_risk = sum(1 for p in dp if p.get("delay_risk") == "HIGH")
    open_complaints = sum(1 for c in dc if c.get("status") != "resolved")
    avg_on_time = sum(m.get("on_time_pct", 0) for m in dm) / len(dm) if dm else 85

    score = 100 - max(0, avg_gap) * 1.4 - high_risk * 8 - open_complaints * 4 + (avg_on_time - 85) * 0.5
    score = max(5, min(100, round(score)))
    status = "Healthy" if score >= 80 else "Stable" if score >= 60 else "At Risk" if score >= 40 else "Critical"

    notes = []
    if high_risk:
        notes.append(f"{high_risk} project{'s' if high_risk > 1 else ''} at HIGH delay risk")
    if open_complaints:
        notes.append(f"{open_complaints} open complaint{'s' if open_complaints > 1 else ''}")
    if avg_gap > 8:
        notes.append("average progress trailing schedule expectations")
    if not notes:
        notes.append("no significant risk signals detected")

    tail = ("Recommend reviewing resource allocation and following up on open items this week."
            if score < 60 else "Continue current operating cadence.")
    return {
        "score": score, "status": status,
        "summary": f"{dept_name} is currently {status.lower()} (AI health score {score}/100). " + "; ".join(notes) + ". " + tail,
        "metrics": {"deptProjects": len(dp), "deptMembers": len(dm),
                    "openComplaints": open_complaints, "highRiskCount": high_risk,
                    "avgOnTime": round(avg_on_time)},
    }


# ============================================================
#  Complaint triage
# ============================================================
DEPARTMENT_ROUTING = {
    "Material Quality": "Quality Control", "Payment Delay": "Finance & Budget",
    "Safety Violation": "Health & Safety", "Project Delay": "Site Operations",
    "Staff Behavior": "Human Resources", "Technical Issue": "Engineering & Design",
    "Contract Dispute": "Client Relations", "Procurement Issue": "Procurement & Supply",
}
COMPLAINT_CATEGORIES = list(DEPARTMENT_ROUTING.keys())

_CATEGORY_KEYWORDS = {
    "Material Quality": ["concrete", "material", "grade", "crack", "quality", "batch", "cement"],
    "Payment Delay": ["invoice", "payment", "paid", "billing", "overdue", "money"],
    "Safety Violation": ["safety", "harness", "helmet", "ppe", "injury", "accident", "unsafe"],
    "Project Delay": ["delay", "behind", "schedule", "late", "slow", "progress"],
    "Staff Behavior": ["rude", "abusive", "behavior", "harass", "conduct", "supervisor"],
    "Technical Issue": ["design", "spec", "hvac", "drawing", "technical", "rework", "install"],
    "Contract Dispute": ["contract", "scope", "addendum", "dispute", "agreement", "legal"],
    "Procurement Issue": ["supplier", "shipment", "procure", "delivery", "order", "rebar"],
}
_SEVERITY_KEYWORDS = {
    "critical": ["injury", "collapse", "fatal", "danger", "emergency", "critical"],
    "high": ["unsafe", "urgent", "immediately", "serious", "violation", "stopped"],
}

SOLUTION_TEMPLATES = {
    "Material Quality": "Quarantine the affected material batch, request a supplier quality certificate, and schedule an independent lab test before further use. Offer replacement or credit if the batch fails testing.",
    "Payment Delay": "Escalate the invoice to Finance & Budget for same-week processing, confirm the payment schedule in writing, and provide the client/vendor a firm payment date.",
    "Safety Violation": "Immediately halt the unsafe activity, issue a safety corrective action to the site supervisor, and schedule a refresher PPE/safety briefing for the crew involved.",
    "Project Delay": "Share an updated schedule with a clear recovery plan, identify the critical path items causing delay, and assign additional resources to the two most delayed tasks.",
    "Staff Behavior": "Open a confidential HR investigation, interview involved parties separately, and apply the organization's conduct policy consistently. Follow up with the reporting party within 5 business days.",
    "Technical Issue": "Route to Engineering & Design for a technical review, issue a corrective work order referencing the approved drawings, and re-inspect after rework is complete.",
    "Contract Dispute": "Loop in Client Relations and legal/contracts review, clarify the disputed scope against the signed contract, and propose a written addendum resolving the ambiguity.",
    "Procurement Issue": "Contact the supplier for a revised delivery commitment, activate a backup supplier if the delay exceeds 5 days, and update the project schedule to reflect the new timeline.",
}


def classify_complaint(text: str) -> dict[str, Any]:
    """Keyword triage — the fallback when Groq is unavailable."""
    lowered = (text or "").lower()
    scores = {cat: sum(1 for kw in kws if kw in lowered) for cat, kws in _CATEGORY_KEYWORDS.items()}
    best = max(scores, key=lambda k: scores[k])
    hits = scores[best]
    if hits == 0:
        best = "Technical Issue"

    severity = "medium"
    for level, kws in _SEVERITY_KEYWORDS.items():
        if any(kw in lowered for kw in kws):
            severity = level
            break

    return {
        "category": best,
        "department": DEPARTMENT_ROUTING.get(best, "Site Operations"),
        "severity": severity,
        "confidence": min(97, 62 + hits * 11),
        "sentiment": "Angry" if severity == "critical" else "Frustrated" if severity == "high" else "Neutral",
        "ai_summary": (f"AI has identified this as a {severity} priority issue related to "
                       f"{best.lower()}, requiring coordination with the assigned department."),
    }


def suggest_complaint_solution(category: str | None, severity: str | None) -> str:
    base = SOLUTION_TEMPLATES.get(
        category or "",
        "Review the complaint details with the responsible department and respond to the submitter within 48 hours with a clear action plan.",
    )
    prefix = ("This is CRITICAL severity — prioritize immediate action and notify department leadership. "
              if severity == "critical" else
              "This is HIGH severity — aim to resolve within 24-48 hours. " if severity == "high" else "")
    return prefix + base


# ============================================================
#  Project delay analysis
# ============================================================
def analyze_project(project: dict[str, Any]) -> dict[str, Any]:
    progress = project.get("progress", 0)
    expected = project.get("expected_progress", 0)
    prob = max(0.05, min(0.97, (expected - progress) / 60 + 0.1))
    return {
        "delay_probability": round(prob, 2),
        "risk_level": "CRITICAL" if prob > 0.85 else "HIGH" if prob > 0.65 else "MEDIUM" if prob > 0.35 else "LOW",
        "key_risk_factors": ["Progress gap vs. schedule", "Material lead times", "Team allocation density"],
        "groq_explanation": (
            f"{project.get('title')} shows a {prob * 100:.0f}% probability of delay based on current "
            f"progress trends. The gap between actual ({progress}%) and expected ({expected}%) completion "
            f"is the primary driver. Recommend: (1) expedite pending material orders, (2) add a second "
            f"shift on critical-path tasks, (3) review supplier SLAs for the coming two weeks."
        ),
    }


# ============================================================
#  Absence ranking
# ============================================================
def rank_absences(records: list[dict], window_days: int = 30) -> list[dict]:
    cutoff = (_now() - timedelta(days=window_days)).date()
    recent_cutoff = (_now() - timedelta(days=7)).date()

    by_person: dict[str, dict] = {}
    for rec in records:
        try:
            rec_date = datetime.strptime(rec["date"], "%Y-%m-%d").date()
        except (ValueError, KeyError, TypeError):
            continue
        if rec_date < cutoff:
            continue
        p = by_person.setdefault(rec["person_id"], {
            "person_id": rec["person_id"], "person_name": rec.get("person_name"),
            "person_type": rec.get("person_type"), "department": rec.get("department"),
            "project_title": rec.get("project_title"),
            "total": 0, "absent": 0, "present": 0, "recentAbsent": 0,
        })
        p["total"] += 1
        if rec.get("status") == "Absent":
            p["absent"] += 1
            if rec_date >= recent_cutoff:
                p["recentAbsent"] += 1
        else:
            p["present"] += 1

    ranked = []
    for p in by_person.values():
        rate = p["absent"] / p["total"] if p["total"] else 0
        score = min(100, round(rate * 80 + (p["recentAbsent"] / max(1, min(p["total"], 7))) * 20))
        reasons = []
        if p["absent"]:
            reasons.append(f"{p['absent']} absence{'s' if p['absent'] > 1 else ''} in last {window_days}d")
        if p["recentAbsent"]:
            reasons.append(f"{p['recentAbsent']} in the last 7 days")
        ranked.append({
            **p,
            "absence_rate": round(rate * 100),
            "ai_score": score,
            "ai_risk": "CRITICAL" if score >= 55 else "HIGH" if score >= 35 else "MEDIUM" if score >= 15 else "LOW",
            "ai_reason": " · ".join(reasons) if reasons else "consistent attendance",
        })
    return sorted(ranked, key=lambda r: r["ai_score"], reverse=True)


def build_attendance_narrative(ranked: list[dict], scope: str = "the organization") -> str:
    if not ranked:
        return f"No attendance data is available for {scope} in the selected period."
    critical = [r for r in ranked if r["ai_risk"] == "CRITICAL"]
    high = [r for r in ranked if r["ai_risk"] == "HIGH"]
    flagged = len(critical) + len(high)

    text = (f"Attendance analysis for {scope} over the selected period: {flagged} of "
            f"{len(ranked)} tracked individual(s) show elevated absence risk. ")
    if critical:
        listed = ", ".join(f"{r['person_name']} ({r['absence_rate']}% absence rate)" for r in critical[:3])
        text += f"{len(critical)} flagged CRITICAL — most notably {listed}. "
    if high:
        text += f"{len(high)} flagged HIGH risk and should be monitored closely. "
    text += ("Recommend a direct check-in with the flagged individuals and reviewing whether daily "
             "worker replacements are needed to protect site schedules." if flagged
             else "Attendance patterns are healthy across the board with no significant absence risk detected.")
    return text


# ============================================================
#  Report narrative (fallback)
# ============================================================
def build_report_narrative(report_type: str, scope: str, ctx: dict) -> str:
    projects = ctx.get("projects", [])
    complaints = ctx.get("complaints", [])
    members = ctx.get("members", [])
    department = ctx.get("department")

    if report_type in ("Department Performance", "Department Team Report"):
        avg = round(sum(m.get("on_time_pct", 0) for m in members) / len(members)) if members else "N/A"
        return (f"This report summarizes performance for {department}: {len(projects)} active or recent "
                f"project(s), {len(members)} team member(s), and an average on-time delivery rate of {avg}%. "
                f"Continued focus on schedule adherence and proactive risk flagging is recommended.")

    if report_type == "Department Complaint Summary":
        open_count = sum(1 for c in complaints if c.get("status") != "resolved")
        top = complaints[0].get("category") if complaints else "N/A"
        return (f"Within {department}, {len(complaints)} complaint(s) were logged, of which {open_count} "
                f"remain open. Top category: {top}. Recommend closing open items within the standard 48-hour SLA.")

    if report_type in ("My Project Status Report", "My Projects Summary"):
        if not projects:
            return "No project data is currently available for your account."
        p = projects[0]
        reasons = p.get("delay_reasons") or []
        tail = "Noted factors: " + ", ".join(reasons) + "." if reasons else "No significant delay factors reported."
        deadline = p.get("deadline")
        dstr = deadline.strftime("%a %b %d %Y") if isinstance(deadline, datetime) else str(deadline)
        return (f"{p.get('title')} is {p.get('progress')}% complete against an expected "
                f"{p.get('expected_progress')}%, currently rated {p.get('delay_risk')} delay risk. "
                f"Deadline: {dstr}. {tail}")

    if report_type in ("Audit & Compliance", "Anomaly Summary"):
        return ("Audit intelligence summary generated from the seven-type audit taxonomy. "
                "Review the Audit Intelligence page for anomaly-level detail and recommended actions.")

    if report_type == "Attendance & Absence Report":
        return build_attendance_narrative(ctx.get("rankedAbsences", []), scope)

    return (f"This AI-generated summary covers {scope} across {len(projects)} project(s), "
            f"{len(complaints)} complaint(s), and {len(members)} team member(s) currently in view.")


# ============================================================
#  Chatbot (fallback)
# ============================================================
def chatbot_reply(message: str, user_role: str, user_department: str | None, ctx: dict) -> str:
    m = (message or "").lower()
    projects = ctx.get("projects", [])
    complaints = ctx.get("complaints", [])
    members = ctx.get("members", [])

    if "risk" in m or "delay" in m:
        risky = [p for p in projects if p.get("delay_risk") == "HIGH"][:4]
        if not risky:
            return "Good news — none of your visible projects are currently flagged HIGH risk."
        lines = "\n".join(
            f"• **{p['title']}** — {p['progress']}% complete (expected {p['expected_progress']}%)"
            for p in risky)
        return (f"Based on current data, **{len(risky)} project{'s' if len(risky) != 1 else ''}** "
                f"{'are' if len(risky) != 1 else 'is'} flagged HIGH risk:\n\n{lines}\n\n"
                f"Recommend reallocating resources to the two most delayed sites.")

    if "complaint" in m:
        pending = sum(1 for c in complaints if c.get("status") == "pending")
        critical = sum(1 for c in complaints if c.get("severity") == "critical")
        note = (f"Scoped to {user_department}." if user_role == "Department Manager"
                else "Most complaints route to Site Operations and Quality Control this week.")
        return f"Complaint overview:\n\n• **{pending}** pending review\n• **{critical}** critical severity\n\n{note}"

    if "overload" in m or "workload" in m:
        busy = sorted(members, key=lambda x: x.get("projects_count", 0), reverse=True)[:3]
        if not busy:
            return "I don't have visibility into team workload for your role."
        lines = "\n".join(f"• **{b['full_name']}** ({b['role']}) — {b.get('projects_count', 0)} active projects" for b in busy)
        return f"Highest current workload:\n\n{lines}\n\nConsider redistributing tasks over the next sprint."

    if "report" in m:
        return ("I can generate a report covering the areas you have access to — head to the "
                "**Reports** page and click \"Generate with AI\".")

    if "schedule" in m or "task" in m:
        return ("Open the **Tasks** page: \"AI Prioritize\" re-ranks your list by urgency and project "
                "risk, and \"Auto-Schedule\" places them on your weekly calendar.")

    return ("I'm BuildIQ Assistant. I can help with project risk, complaint trends, team workload, "
            "task priorities and audit anomalies. Ask me about any of those.")
