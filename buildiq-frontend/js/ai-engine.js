/* ============================================================
   BuildIQ — ai-engine.js
   Client-side "AI" heuristics used across the app. In MOCK_MODE these
   compute locally; in real mode, the equivalent scoring would come from
   the backend's Groq/ML services (see B.6-B.9 in the prompt doc) — the
   UI functions calling into here are written so swapping the source is
   a one-line change (see API.aiPrioritizeTasks etc. in api.js).
   ============================================================ */

const AIEngine = (() => {

  // ---------------- #5 Task priority scoring ----------------
  // Blends: due-date urgency, project risk level, "blocking" flag, task age.
  function scoreTask(task, now = Date.now()) {
    const dueMs = new Date(task.due_date).getTime();
    const daysUntilDue = (dueMs - now) / 86400000;

    let score = 0;
    let reasons = [];

    // Urgency (due date) — up to 45 pts
    if (daysUntilDue < 0) { score += 45; reasons.push(`overdue by ${Math.abs(Math.round(daysUntilDue))}d`); }
    else if (daysUntilDue <= 1) { score += 40; reasons.push("due within 24h"); }
    else if (daysUntilDue <= 3) { score += 28; reasons.push("due in " + Math.ceil(daysUntilDue) + "d"); }
    else if (daysUntilDue <= 7) { score += 16; reasons.push("due this week"); }
    else { score += 6; }

    // Project risk — up to 30 pts
    const riskPts = { CRITICAL: 30, HIGH: 25, MEDIUM: 12, LOW: 4 };
    const rp = riskPts[String(task.project_risk).toUpperCase()] ?? 4;
    score += rp;
    if (rp >= 25) reasons.push(`project "${task.project_title}" is ${task.project_risk} risk`);

    // Blocking other work — 15 pts
    if (task.blocking) { score += 15; reasons.push("blocks other tasks"); }

    // Already in progress gets a small boost to encourage finishing
    if (task.status === "In Progress") { score += 6; }

    // Done tasks are always deprioritized regardless of the above
    if (task.status === "Done") { score = 2; reasons = ["already completed"]; }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const priority = score >= 75 ? "CRITICAL" : score >= 55 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
    const reason = reasons.length ? reasons.slice(0,2).join(" · ") : "no immediate urgency signals";

    return { ...task, ai_score: score, ai_priority: priority, ai_reason: reason, days_until_due: Math.round(daysUntilDue) };
  }

  function prioritizeTasks(tasks) {
    return tasks.map(t => scoreTask(t)).sort((a,b) => b.ai_score - a.ai_score);
  }

  // ---------------- #5 AI auto-scheduling ----------------
  // Greedy placement of the highest-priority open tasks into a Mon-Fri,
  // 5-slot (9am-5pm, 90min blocks) weekly grid, respecting estimated_hours.
  const WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const SLOTS = ["09:00", "10:30", "13:00", "14:30", "16:00"];

  function autoSchedule(tasks) {
    const open = prioritizeTasks(tasks.filter(t => t.status !== "Done"));
    const grid = {}; // "Mon-09:00" -> task
    WORK_DAYS.forEach(d => SLOTS.forEach(s => grid[`${d}-${s}`] = null));

    let dayIdx = 0, slotIdx = 0;
    for (const task of open) {
      const blocksNeeded = Math.max(1, Math.ceil(task.estimated_hours / 1.5));
      let placed = 0;
      while (placed < blocksNeeded && dayIdx < WORK_DAYS.length) {
        const key = `${WORK_DAYS[dayIdx]}-${SLOTS[slotIdx]}`;
        if (!grid[key]) { grid[key] = task; placed++; }
        slotIdx++;
        if (slotIdx >= SLOTS.length) { slotIdx = 0; dayIdx++; }
      }
      if (dayIdx >= WORK_DAYS.length) break; // ran out of week
    }
    return grid;
  }

  // ---------------- #4 Department AI health score ----------------
  function departmentHealth(dept, projects, members, complaints) {
    const deptProjects = projects.filter(p => p.department === dept.name);
    const deptMembers = members.filter(m => m.department === dept.name);
    const deptComplaints = complaints.filter(c => c.department === dept.name);

    const avgProgressGap = deptProjects.length
      ? deptProjects.reduce((s,p) => s + (p.expected_progress - p.progress), 0) / deptProjects.length
      : 0;
    const highRiskCount = deptProjects.filter(p => p.delay_risk === "HIGH").length;
    const openComplaints = deptComplaints.filter(c => c.status !== "resolved").length;
    const avgOnTime = deptMembers.length
      ? deptMembers.reduce((s,m) => s + (m.on_time_pct||0), 0) / deptMembers.length
      : 85;

    let score = 100;
    score -= Math.max(0, avgProgressGap) * 1.4;
    score -= highRiskCount * 8;
    score -= openComplaints * 4;
    score += (avgOnTime - 85) * 0.5;
    score = Math.max(5, Math.min(100, Math.round(score)));

    const status = score >= 80 ? "Healthy" : score >= 60 ? "Stable" : score >= 40 ? "At Risk" : "Critical";

    const notes = [];
    if (highRiskCount) notes.push(`${highRiskCount} project${highRiskCount>1?"s":""} at HIGH delay risk`);
    if (openComplaints) notes.push(`${openComplaints} open complaint${openComplaints>1?"s":""}`);
    if (avgProgressGap > 8) notes.push("average progress trailing schedule expectations");
    if (!notes.length) notes.push("no significant risk signals detected");

    return {
      score, status,
      summary: `${dept.name} is currently ${status.toLowerCase()} (AI health score ${score}/100). ` +
        notes.join("; ") + ". " +
        (score < 60 ? "Recommend reviewing resource allocation and following up on open items this week." : "Continue current operating cadence."),
      metrics: { deptProjects: deptProjects.length, deptMembers: deptMembers.length, openComplaints, highRiskCount, avgOnTime: Math.round(avgOnTime) },
    };
  }

  // ---------------- #6 AI-suggested complaint resolution ----------------
  const SOLUTION_TEMPLATES = {
    "Material Quality": "Quarantine the affected material batch, request a supplier quality certificate, and schedule an independent lab test before further use. Offer replacement or credit if the batch fails testing.",
    "Payment Delay": "Escalate the invoice to Finance & Budget for same-week processing, confirm the payment schedule in writing, and provide the client/vendor a firm payment date.",
    "Safety Violation": "Immediately halt the unsafe activity, issue a safety corrective action to the site supervisor, and schedule a refresher PPE/safety briefing for the crew involved.",
    "Project Delay": "Share an updated schedule with a clear recovery plan, identify the critical path items causing delay, and assign additional resources to the two most delayed tasks.",
    "Staff Behavior": "Open a confidential HR investigation, interview involved parties separately, and apply the organization's conduct policy consistently. Follow up with the reporting party within 5 business days.",
    "Technical Issue": "Route to Engineering & Design for a technical review, issue a corrective work order referencing the approved drawings, and re-inspect after rework is complete.",
    "Contract Dispute": "Loop in Client Relations and legal/contracts review, clarify the disputed scope against the signed contract, and propose a written addendum resolving the ambiguity.",
    "Procurement Issue": "Contact the supplier for a revised delivery commitment, activate a backup supplier if the delay exceeds 5 days, and update the project schedule to reflect the new timeline.",
  };

  function suggestComplaintSolution(complaint) {
    const base = SOLUTION_TEMPLATES[complaint.category] || "Review the complaint details with the responsible department and respond to the submitter within 48 hours with a clear action plan.";
    const urgency = complaint.severity === "critical" ? "This is CRITICAL severity — prioritize immediate action and notify department leadership. "
      : complaint.severity === "high" ? "This is HIGH severity — aim to resolve within 24-48 hours. "
      : "";
    return `${urgency}${base}`;
  }

  // ---------------- #7 Role-aware AI report narrative ----------------
  function buildReportNarrative(type, scope, ctx) {
    const { projects = [], complaints = [], members = [], department } = ctx;
    if (type === "Department Performance" || type === "Department Team Report") {
      const dept = department;
      return `This report summarizes performance for ${dept}: ${projects.length} active or recent project(s), ` +
        `${members.length} team member(s), and an average on-time delivery rate of ` +
        `${members.length ? Math.round(members.reduce((s,m)=>s+(m.on_time_pct||0),0)/members.length) : "N/A"}%. ` +
        `Continued focus on schedule adherence and proactive risk flagging is recommended.`;
    }
    if (type === "Department Complaint Summary") {
      const open = complaints.filter(c => c.status !== "resolved").length;
      return `Within ${department}, ${complaints.length} complaint(s) were logged, of which ${open} remain open. ` +
        `Top category: ${complaints[0]?.category || "N/A"}. Recommend closing open items within the standard 48-hour SLA.`;
    }
    if (type === "My Project Status Report") {
      const p = projects[0];
      if (!p) return "No project data is currently available for your account.";
      return `${p.title} is ${p.progress}% complete against an expected ${p.expected_progress}%, currently rated ${p.delay_risk} delay risk. ` +
        `Deadline: ${new Date(p.deadline).toDateString()}. ${p.delay_reasons?.length ? "Noted factors: " + p.delay_reasons.join(", ") + "." : "No significant delay factors reported."}`;
    }
    if (type === "Audit & Compliance" || type === "Anomaly Summary") {
      return `Audit intelligence summary generated from the dual-model (Isolation Forest + Random Forest) anomaly detection pipeline. Review the Audit Intelligence page for full anomaly-level detail and recommended actions.`;
    }
    return `This AI-generated summary covers ${scope} across ${projects.length} project(s), ${complaints.length} complaint(s), and ${members.length} team member(s) currently in view.`;
  }

  return { scoreTask, prioritizeTasks, autoSchedule, WORK_DAYS, SLOTS, departmentHealth, suggestComplaintSolution, buildReportNarrative };
})();
