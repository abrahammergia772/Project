"""Turn raw audit events into behavioural features.

This is the part that actually matters. The current rule engine looks at one
event in isolation, so it can only ever ask "is this action risky, and is it
late?" -- four possible answers, no notion of who did it.

Anomaly detection needs the opposite framing: is this event unusual *for this
person*? That requires comparing the event against the actor's own history,
which is what every function here builds.

Deliberately no scikit-learn import: these features are also used by the
runtime scorer, which must work on a box where only the API is installed.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

# Ordered so the feature vector is stable across runs. Anything that changes
# this list invalidates previously trained artifacts, which is why train.py
# records it in the model metadata and the scorer refuses a mismatch.
FEATURE_NAMES: list[str] = [
    "hour_sin",
    "hour_cos",
    "is_night",
    "is_weekend",
    "action_is_high_risk",
    "action_rarity_for_user",
    "action_rarity_for_role",
    "events_last_1h",
    "events_last_24h",
    "burst_ratio",
    "seconds_since_prev",
    "distinct_actions_24h",
    "distinct_resources_24h",
    "deviation_from_usual_hour",
    "user_event_rate",
    "is_first_time_action",
    "type_share_for_role",
]

# Mirrors ai_engine.HIGH_RISK_ACTIONS. Duplicated rather than imported so this
# module stays usable standalone (e.g. in a notebook) without booting the app.
HIGH_RISK_ACTIONS = {
    "LOGIN_FAILED", "UNAUTHORIZED_ACCESS", "PERMISSION_CHANGE", "IP_CHANGE",
    "INVOICE_DELETE", "BUDGET_MODIFY", "APPROVAL_BYPASS", "POLICY_VIOLATION",
    "BULK_DELETE", "ROLE_MISUSE", "DORMANT_ACCESS", "UNAPPROVED_EDIT",
    "RECORD_DELETE", "EXTERNAL_IMPORT", "MATERIAL_OVERUSE", "EQUIPMENT_UNRETURNED",
    "EXTERNAL_SHARE", "POST_APPROVAL_EDIT", "EXPORT_DATA", "SUSPEND_USER",
}


@dataclass
class Event:
    """One audit log row, reduced to what the features need."""
    user: str
    user_role: str
    action: str
    audit_type: str
    resource: str
    timestamp: datetime
    # Only present in supervised mode; None means "never reviewed".
    label: int | None = None

    @staticmethod
    def from_row(row: dict[str, Any]) -> "Event":
        ts = row["timestamp"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return Event(
            user=str(row.get("user") or "unknown"),
            user_role=str(row.get("user_role") or "unknown"),
            action=str(row.get("action") or "UNKNOWN"),
            audit_type=str(row.get("audit_type") or "USER_ACTIVITY"),
            resource=str(row.get("resource") or ""),
            timestamp=ts,
            label=row.get("label"),
        )


@dataclass
class Baselines:
    """Per-user and per-role history, learned from the training window.

    Kept separate from the feature function so the exact same baselines can be
    saved alongside a model and reused at scoring time. Recomputing them from
    live data at inference would mean the model silently drifts.
    """
    user_action_counts: dict[str, dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    role_action_counts: dict[str, dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    role_type_counts: dict[str, dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    user_totals: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    role_totals: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    user_hours: dict[str, list[int]] = field(default_factory=lambda: defaultdict(list))
    user_span_days: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "user_action_counts": {u: dict(v) for u, v in self.user_action_counts.items()},
            "role_action_counts": {r: dict(v) for r, v in self.role_action_counts.items()},
            "role_type_counts": {r: dict(v) for r, v in self.role_type_counts.items()},
            "user_totals": dict(self.user_totals),
            "role_totals": dict(self.role_totals),
            "user_hours": {u: list(v) for u, v in self.user_hours.items()},
            "user_span_days": dict(self.user_span_days),
        }

    @staticmethod
    def from_dict(d: dict) -> "Baselines":
        b = Baselines()
        for u, v in d.get("user_action_counts", {}).items():
            b.user_action_counts[u].update(v)
        for r, v in d.get("role_action_counts", {}).items():
            b.role_action_counts[r].update(v)
        for r, v in d.get("role_type_counts", {}).items():
            b.role_type_counts[r].update(v)
        b.user_totals.update(d.get("user_totals", {}))
        b.role_totals.update(d.get("role_totals", {}))
        for u, v in d.get("user_hours", {}).items():
            b.user_hours[u] = list(v)
        b.user_span_days.update(d.get("user_span_days", {}))
        return b


def build_baselines(events: Iterable[Event]) -> Baselines:
    b = Baselines()
    first: dict[str, datetime] = {}
    last: dict[str, datetime] = {}

    for e in events:
        b.user_action_counts[e.user][e.action] += 1
        b.role_action_counts[e.user_role][e.action] += 1
        b.role_type_counts[e.user_role][e.audit_type] += 1
        b.user_totals[e.user] += 1
        b.role_totals[e.user_role] += 1
        b.user_hours[e.user].append(e.timestamp.hour)
        if e.user not in first or e.timestamp < first[e.user]:
            first[e.user] = e.timestamp
        if e.user not in last or e.timestamp > last[e.user]:
            last[e.user] = e.timestamp

    for u in first:
        span = (last[u] - first[u]).total_seconds() / 86400.0
        b.user_span_days[u] = max(span, 1.0)     # avoid divide-by-zero on day one
    return b


def _circular_hour_distance(hour: int, hours: list[int]) -> float:
    """How far this hour sits from the actor's usual working hours.

    Circular because 23:00 and 01:00 are two hours apart, not twenty-two --
    a plain mean would call a midnight-shift worker permanently anomalous.
    """
    if not hours:
        return 0.0
    sin_mean = sum(math.sin(2 * math.pi * h / 24) for h in hours) / len(hours)
    cos_mean = sum(math.cos(2 * math.pi * h / 24) for h in hours) / len(hours)
    mean_angle = math.atan2(sin_mean, cos_mean)
    this_angle = 2 * math.pi * hour / 24
    diff = abs(math.atan2(math.sin(this_angle - mean_angle),
                          math.cos(this_angle - mean_angle)))
    return diff / math.pi          # 0 = typical hour, 1 = opposite side of clock


def featurize(events: list[Event], baselines: Baselines) -> tuple[list[list[float]], list[Event]]:
    """Build the feature matrix. Events must be sorted oldest-first.

    Returns (matrix, events) so callers can line rows up with their source
    event -- needed to explain a score back to a human, which an audit tool
    must always be able to do.
    """
    events = sorted(events, key=lambda e: e.timestamp)
    rows: list[list[float]] = []

    # Rolling per-user window, so counts are causal: an event is only ever
    # compared against what happened BEFORE it. Using the full history here
    # would leak the future into training and inflate every metric.
    history: dict[str, list[Event]] = defaultdict(list)

    for e in events:
        prior = history[e.user]
        window_1h = [p for p in prior if e.timestamp - p.timestamp <= timedelta(hours=1)]
        window_24h = [p for p in prior if e.timestamp - p.timestamp <= timedelta(hours=24)]

        u_total = baselines.user_totals.get(e.user, 0)
        r_total = baselines.role_totals.get(e.user_role, 0)
        u_action = baselines.user_action_counts.get(e.user, {}).get(e.action, 0)
        r_action = baselines.role_action_counts.get(e.user_role, {}).get(e.action, 0)
        r_type = baselines.role_type_counts.get(e.user_role, {}).get(e.audit_type, 0)

        # Rarity: 1.0 = this actor has never done this, 0.0 = it is all they do.
        action_rarity_user = 1.0 - (u_action / u_total) if u_total else 1.0
        action_rarity_role = 1.0 - (r_action / r_total) if r_total else 1.0
        type_share_role = (r_type / r_total) if r_total else 0.0

        secs_since_prev = (
            (e.timestamp - prior[-1].timestamp).total_seconds() if prior else 86400.0
        )
        span = baselines.user_span_days.get(e.user, 1.0)
        rate = u_total / span

        rows.append([
            math.sin(2 * math.pi * e.timestamp.hour / 24),
            math.cos(2 * math.pi * e.timestamp.hour / 24),
            1.0 if (e.timestamp.hour < 6 or e.timestamp.hour > 22) else 0.0,
            1.0 if e.timestamp.weekday() >= 5 else 0.0,
            1.0 if e.action in HIGH_RISK_ACTIONS else 0.0,
            action_rarity_user,
            action_rarity_role,
            float(len(window_1h)),
            float(len(window_24h)),
            # Burst: an hour's activity measured against a normal hour for them.
            len(window_1h) / max(len(window_24h) / 24.0, 0.1),
            min(secs_since_prev, 86400.0) / 86400.0,
            float(len({p.action for p in window_24h})),
            float(len({p.resource for p in window_24h})),
            _circular_hour_distance(e.timestamp.hour, baselines.user_hours.get(e.user, [])),
            min(rate / 50.0, 2.0),          # squashed; 50 events/day is already a lot
            1.0 if u_action <= 1 else 0.0,
            type_share_role,
        ])

        history[e.user].append(e)
        # Bound memory on long runs; 24h of history is all the windows need.
        if len(history[e.user]) > 500:
            history[e.user] = history[e.user][-500:]

    return rows, events


def explain(row: list[float], top_n: int = 3) -> list[str]:
    """Plain-English reasons for a score.

    An audit finding a human cannot interpret is not actionable, and in most
    regulatory contexts it is not even admissible. Every score the model
    produces must come with this.
    """
    reasons: list[tuple[float, str]] = []
    f = dict(zip(FEATURE_NAMES, row))

    if f["is_night"]:
        reasons.append((0.8, "performed outside working hours"))
    if f["is_weekend"]:
        reasons.append((0.5, "performed at the weekend"))
    if f["action_is_high_risk"]:
        reasons.append((0.7, "the action itself is high-risk"))
    if f["is_first_time_action"]:
        reasons.append((0.9, "this user has never performed this action before"))
    if f["action_rarity_for_user"] > 0.95:
        reasons.append((0.85, "very rare for this user"))
    if f["action_rarity_for_role"] > 0.95:
        reasons.append((0.75, "very rare for this role"))
    if f["burst_ratio"] > 4:
        reasons.append((0.8, f"activity burst — {int(f['events_last_1h'])} actions in an hour"))
    if f["deviation_from_usual_hour"] > 0.5:
        reasons.append((0.6, "far outside this user's normal working hours"))
    if f["distinct_resources_24h"] > 15:
        reasons.append((0.6, "touched an unusually wide range of records"))

    reasons.sort(reverse=True)
    return [r for _, r in reasons[:top_n]] or ["consistent with this user's normal behaviour"]
