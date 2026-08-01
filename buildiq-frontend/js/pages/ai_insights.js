/* ============================================================
   BuildIQ — ai_insights.js
   One place for every AI feature in the product, role-scoped.

   Tabs:
     Overview    — executive summary, headline signals, AI status
     Predictions — per-project delay risk with on-demand deep analysis
     Priorities  — AI-ranked tasks and the auto-scheduler
     Workforce   — absence-risk ranking and department health scores
     Anomalies   — the seven audit types and what each flagged

   Everything here reads the same role-scoped data the rest of the app
   uses, so a Client sees only their project and an Engineer only their work.
   ============================================================ */

const AIInsightsPage = (() => {
  let user;
  let charts = [];
  let activeTab = "overview";

  function destroyCharts() { charts.forEach(c => { try { c.destroy(); } catch {} }); charts = []; }

  // Which tabs make sense for this role.
  function tabsFor(u) {
    const tabs = [{ key: "overview", label: "Overview", icon: "fa-wand-magic-sparkles" }];
    if (Roles.visibleProjects(u, DataStore.projects).length) {
      tabs.push({ key: "predictions", label: "Predictions", icon: "fa-chart-line" });
    }
    if (u.role !== "Client" && u.role !== "Auditor") {
      tabs.push({ key: "priorities", label: "Priorities", icon: "fa-ranking-star" });
    }
    if (Roles.canViewAttendance(u)) {
      tabs.push({ key: "workforce", label: "Workforce", icon: "fa-users-gear" });
    }
    if (Router.accessFor("audit", u.role) !== false) {
      tabs.push({ key: "anomalies", label: "Anomalies", icon: "fa-shield-halved" });
    }
    return tabs;
  }

  function shell() {
    const tabs = tabsFor(user);
    activeTab = tabs[0].key;
    return `
      <div class="page-header">
        <div>
          <h1>AI Insights</h1>
          <div class="page-sub">Everything BuildIQ's AI can tell you, scoped to your role</div>
        </div>
        <div class="page-header-actions">
          <span class="ai-mode-pill" id="aiModePill"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking AI…</span>
          <button class="btn btn-secondary" id="askAiBtn"><i class="fa-solid fa-comments"></i> Ask the Assistant</button>
        </div>
      </div>
      <div class="tabs" id="aiTabs">
        ${tabs.map((t, i) => `
          <div class="tab ${i === 0 ? "active" : ""}" data-tab="${t.key}">
            <i class="fa-solid ${t.icon}"></i> ${t.label}
          </div>`).join("")}
      </div>
      <div id="aiTabContent" style="margin-top:18px;"></div>`;
  }

  async function init() {
    // Load real server data before rendering.
    await DataStore.load(["projects","members","departments","tasks","complaints","attendance","auditLogs"]);
    user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("aiTabContent").innerHTML = Components.skeletonGrid(4);

    document.getElementById("askAiBtn").addEventListener("click", () => {
      if (window.AIAssistant) AIAssistant.open();
      else window.location.href = "chatbot";
    });

    Utils.qsa(".tab", document.getElementById("aiTabs")).forEach(tab =>
      tab.addEventListener("click", () => {
        Utils.qsa(".tab", document.getElementById("aiTabs")).forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        activeTab = tab.dataset.tab;
        renderTab(activeTab);
      }));

    reportMode();
    renderTab(activeTab);
  }

  async function reportMode() {
    const pill = document.getElementById("aiModePill");
    if (!pill) return;
    if (BUILDIQ_CONFIG.MOCK_MODE) {
      pill.className = "ai-mode-pill demo";
      pill.innerHTML = `<i class="fa-solid fa-flask"></i> Demo mode`;
      return;
    }
    try {
      const res = await fetch(`${BUILDIQ_CONFIG.API_BASE}/ai/status`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
      });
      const body = await res.json();
      const live = body.mode === "groq";
      pill.className = `ai-mode-pill ${live ? "live" : "local"}`;
      pill.innerHTML = live
        ? `<i class="fa-solid fa-bolt"></i> Live AI · ${Utils.escapeHtml(body.model || "")}`
        : `<i class="fa-solid fa-microchip"></i> Local analysis`;
    } catch {
      pill.className = "ai-mode-pill local";
      pill.innerHTML = `<i class="fa-solid fa-microchip"></i> Local analysis`;
    }
  }

  function renderTab(key) {
    destroyCharts();
    const el = document.getElementById("aiTabContent");
    if (key === "overview")         renderOverview(el);
    else if (key === "predictions") renderPredictions(el);
    else if (key === "priorities")  renderPriorities(el);
    else if (key === "workforce")   renderWorkforce(el);
    else                            renderAnomalies(el);
  }

  // ============================================================
  //  Overview
  // ============================================================
  function renderOverview(el) {
    const projects = Roles.visibleProjects(user, DataStore.projects);
    const complaints = Roles.visibleComplaints(user, DataStore.complaints, DataStore.projects);
    const openC = complaints.filter(c => c.status !== "resolved");
    const critical = openC.filter(c => c.severity === "critical");
    const highRisk = projects.filter(p => p.delay_risk === "HIGH");
    const behind = projects.filter(p => p.progress < p.expected_progress);

    const myTasks = DataStore.tasks.filter(t => t.assignee_id === user.id && t.status !== "Done");
    const ranked = AIEngine.prioritizeTasks(myTasks);
    const urgent = ranked.filter(t => t.ai_priority === "CRITICAL" || t.ai_priority === "HIGH");

    // A short narrative assembled from the same signals the backend would use.
    const summary = buildSummary({ projects, highRisk, behind, openC, critical, urgent });

    el.innerHTML = `
      <div class="ai-hero">
        <div class="ai-hero-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div class="ai-hero-body">
          <b>AI Executive Summary</b>
          <p id="aiSummaryText">${Utils.escapeHtml(summary)}</p>
        </div>
      </div>

      <div class="ai-signal-grid">
        ${signalCard("Projects at risk", highRisk.length, "fa-triangle-exclamation", "red",
          highRisk.length ? `${highRisk.slice(0, 2).map(p => p.title).join(", ")}` : "None flagged",
          "projects.html?risk=HIGH")}
        ${signalCard("Behind schedule", behind.length, "fa-clock-rotate-left", "yellow",
          `of ${projects.length} in view`, "projects.html")}
        ${signalCard("Open complaints", openC.length, "fa-comments", "accent",
          `${critical.length} critical`, "complaints.html?status=pending")}
        ${signalCard("Urgent tasks", urgent.length, "fa-ranking-star", "purple",
          urgent.length ? urgent[0].title : "Nothing pressing", "tasks.html")}
      </div>

      <div class="ai-feature-grid">
        ${featureCard("fa-chart-line", "Delay prediction",
          "Scores every project on the gap between actual and planned progress, then explains the drivers.",
          "predictions")}
        ${featureCard("fa-ranking-star", "Task prioritization",
          "Ranks work by due-date urgency, project risk and whether it blocks other tasks.",
          "priorities")}
        ${featureCard("fa-users-gear", "Absence risk",
          "Flags attendance patterns worth a conversation, weighted toward recent absences.",
          "workforce")}
        ${featureCard("fa-shield-halved", "Anomaly detection",
          "Classifies every audit event into one of seven types, each with its own detection model.",
          "anomalies")}
      </div>`;

    Utils.qsa(".ai-feature-card", el).forEach(card => card.addEventListener("click", () => {
      const target = card.dataset.goto;
      const tab = Utils.qsa(".tab", document.getElementById("aiTabs")).find(t => t.dataset.tab === target);
      if (tab) tab.click();
    }));
    EntityDetail.bindAuto(el);
  }

  function buildSummary({ projects, highRisk, behind, openC, critical, urgent }) {
    if (!projects.length && !openC.length) {
      return "There's nothing in your view yet. Once projects and complaints are assigned to you, this summary will highlight what needs attention.";
    }
    const parts = [];
    parts.push(`You have ${projects.length} project${projects.length === 1 ? "" : "s"} in view.`);
    parts.push(highRisk.length
      ? `${highRisk.length} ${highRisk.length === 1 ? "is" : "are"} flagged HIGH delay risk — most notably ${highRisk.slice(0, 2).map(p => p.title).join(" and ")}.`
      : "None are flagged HIGH delay risk.");
    if (behind.length) parts.push(`${behind.length} ${behind.length === 1 ? "is" : "are"} trailing the planned schedule.`);
    if (openC.length) {
      parts.push(`${openC.length} complaint${openC.length === 1 ? "" : "s"} remain open${critical.length ? `, including ${critical.length} critical` : ""}.`);
    }
    if (urgent.length) parts.push(`${urgent.length} of your tasks are ranked urgent.`);
    parts.push(highRisk.length || critical.length
      ? "Recommended focus: re-sequence critical-path work and clear the critical complaints first this week."
      : "Delivery is tracking to plan — maintain the current cadence.");
    return parts.join(" ");
  }

  function signalCard(label, value, icon, color, sub, href) {
    return `
      <a class="ai-signal" href="${href}" style="--sig:var(--${color});">
        <span class="ai-signal-icon"><i class="fa-solid ${icon}"></i></span>
        <span class="ai-signal-value">${value}</span>
        <span class="ai-signal-label">${Utils.escapeHtml(label)}</span>
        <span class="ai-signal-sub">${Utils.escapeHtml(String(sub))}</span>
      </a>`;
  }

  function featureCard(icon, title, body, goto) {
    return `
      <div class="ai-feature-card" data-goto="${goto}" tabindex="0" role="button">
        <span class="ai-feature-icon"><i class="fa-solid ${icon}"></i></span>
        <b>${Utils.escapeHtml(title)}</b>
        <p>${Utils.escapeHtml(body)}</p>
        <span class="ai-feature-go">Explore <i class="fa-solid fa-arrow-right"></i></span>
      </div>`;
  }

  // ============================================================
  //  Predictions
  // ============================================================
  function renderPredictions(el) {
    const projects = Roles.visibleProjects(user, DataStore.projects)
      .map(p => ({ ...p, gap: p.expected_progress - p.progress }))
      .sort((a, b) => b.gap - a.gap);

    if (!projects.length) {
      el.innerHTML = Components.createEmptyState("fa-chart-line", "No projects in view",
        "Delay predictions appear once projects are assigned to you.");
      return;
    }

    el.innerHTML = `
      <p class="ai-tab-intro">Every project is scored on the gap between actual and planned progress,
         weighted by known delay factors. Run a deep analysis for a written explanation and recommendations.</p>
      <div class="card chart-card" style="margin-bottom:16px;">
        <div class="section-title"><i class="fa-solid fa-chart-column"></i> Actual vs expected progress</div>
        <canvas id="aiPredChart" style="max-height:240px;"></canvas>
      </div>
      <div class="ai-pred-list">
        ${projects.map(p => {
          const prob = Math.max(5, Math.min(97, Math.round(p.gap / 60 * 100 + 10)));
          const tone = prob > 65 ? "red" : prob > 35 ? "yellow" : "green";
          return `
          <div class="ai-pred-row" data-id="${p.id}">
            <div class="ai-pred-gauge" style="--tone:var(--${tone}); --deg:${Math.round(prob * 3.6)}deg;">
              <span>${prob}%</span>
            </div>
            <div class="ai-pred-main">
              <div class="flex items-center gap-8" style="flex-wrap:wrap;">
                <b class="clickable-entity" data-entity="project" data-id="${p.id}" style="cursor:pointer;">${Utils.escapeHtml(p.title)}</b>
                ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
              </div>
              <div class="ai-pred-meta">${p.progress}% complete vs ${p.expected_progress}% expected
                · ${Utils.escapeHtml(p.department || "—")}
                ${p.delay_reasons?.length ? " · " + Utils.escapeHtml(p.delay_reasons.join(", ")) : ""}</div>
              <div class="ai-pred-explain" id="explain_${p.id}"></div>
            </div>
            <button class="btn btn-secondary btn-sm analyze-btn" data-id="${p.id}">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Analyze
            </button>
          </div>`;
        }).join("")}
      </div>`;

    setTimeout(() => {
      const canvas = document.getElementById("aiPredChart");
      if (!canvas || typeof Chart === "undefined") return;
      Chart.defaults.color = "#94A3B8";
      const top = projects.slice(0, 8);
      charts.push(new Chart(canvas, {
        type: "bar",
        data: {
          labels: top.map(p => p.title.length > 16 ? p.title.slice(0, 15) + "…" : p.title),
          datasets: [
            { label: "Actual", data: top.map(p => p.progress), backgroundColor: "#F97316", borderRadius: 6 },
            { label: "Expected", data: top.map(p => p.expected_progress), backgroundColor: "rgba(100,116,139,0.45)", borderRadius: 6 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100 } },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
        },
      }));
    }, 30);

    Utils.qsa(".analyze-btn", el).forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const target = document.getElementById(`explain_${id}`);
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing`;
      try {
        const res = await API.analyzeProject(id);
        target.innerHTML = `
          <div class="ai-explain-box">
            <i class="fa-solid fa-robot"></i>
            <div>
              <b>${Math.round(res.delay_probability * 100)}% delay probability · ${Utils.escapeHtml(res.risk_level)}</b>
              <p>${Utils.escapeHtml(res.groq_explanation)}</p>
              ${res.key_risk_factors?.length ? `<div class="ai-factors">${res.key_risk_factors.map(f => Components.createBadge(f, "gray")).join("")}</div>` : ""}
            </div>
          </div>`;
      } catch {
        Components.createToast("Could not run the analysis.", "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Analyze`;
      }
    }));
    EntityDetail.bindAuto(el);
  }

  // ============================================================
  //  Priorities
  // ============================================================
  function renderPriorities(el) {
    const mine = DataStore.tasks.filter(t => t.assignee_id === user.id && t.status !== "Done");
    // Oversight roles rarely hold tasks themselves. Rather than show them an
    // empty tab, fall back to the work they're responsible for.
    let pool = mine;
    let scopeLabel = "your open tasks";
    if (!mine.length && Roles.canViewTeamTasks(user.role)) {
      if (user.role === Roles.PROJECT_MANAGER) {
        const ids = new Set(Roles.managedProjects(user, DataStore.projects).map(p => p.id));
        pool = DataStore.tasks.filter(t => ids.has(t.project_id) && t.status !== "Done");
        scopeLabel = "tasks across the projects you manage";
      } else if (Roles.ORG_WIDE.includes(user.role)) {
        pool = DataStore.tasks.filter(t => t.status !== "Done");
        scopeLabel = "open tasks across the organization";
      } else {
        pool = DataStore.tasks.filter(t => t.department === user.department && t.status !== "Done");
        scopeLabel = `open tasks in ${user.department}`;
      }
    }
    const ranked = AIEngine.prioritizeTasks(pool);

    if (!ranked.length) {
      el.innerHTML = Components.createEmptyState("fa-champagne-glasses", "No open tasks",
        "You're all caught up — nothing to prioritize.");
      return;
    }

    const grid = AIEngine.autoSchedule(ranked);
    const placed = Object.values(grid).filter(Boolean).length;

    el.innerHTML = `
      <p class="ai-tab-intro">Scored 0-100 on due-date urgency, the risk level of the parent project, and
         whether the task blocks other work — currently ranking <b>${Utils.escapeHtml(scopeLabel)}</b>.
         The scheduler places the highest scorers into a Mon-Fri week.</p>
      <div class="ai-two-col">
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-ranking-star"></i> Ranked queue (${ranked.length})</div>
          <div class="ai-task-list">
            ${ranked.slice(0, 10).map(t => `
              <a class="ai-task-row" href="tasks">
                <span class="ai-task-score" style="--tone:${scoreTone(t.ai_score)};">${t.ai_score}</span>
                <span class="ai-task-main">
                  <b>${Utils.escapeHtml(t.title)}</b>
                  <small>${Utils.escapeHtml(t.project_title)}${pool !== mine ? " · " + Utils.escapeHtml(t.assignee_name || "Unassigned") : ""} · due ${Utils.formatDate(t.due_date)}${t.days_until_due < 0 ? " (overdue)" : ""}</small>
                  <em><i class="fa-solid fa-sparkles"></i> ${Utils.escapeHtml(t.ai_reason)}</em>
                </span>
                ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
              </a>`).join("")}
          </div>
        </div>
        <div class="card">
          <div class="flex items-center justify-between" style="margin-bottom:12px;">
            <div class="section-title" style="margin-bottom:0;"><i class="fa-solid fa-calendar-week"></i> Suggested week</div>
            <a href="tasks" class="btn btn-outline btn-sm">Open scheduler</a>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${placed} slot${placed === 1 ? "" : "s"} filled from your ranked queue.</p>
          <div class="ai-week">
            ${AIEngine.WORK_DAYS.map(day => `
              <div class="ai-week-day">
                <span class="ai-week-label">${day}</span>
                ${AIEngine.SLOTS.map(slot => {
                  const task = grid[`${day}-${slot}`];
                  return task
                    ? `<span class="ai-week-slot filled" title="${Utils.escapeHtml(task.title)} · ${slot}">${Utils.escapeHtml(task.title.slice(0, 14))}</span>`
                    : `<span class="ai-week-slot"></span>`;
                }).join("")}
              </div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function scoreTone(score) {
    return score >= 75 ? "var(--red)" : score >= 55 ? "var(--accent)" : score >= 30 ? "var(--yellow)" : "var(--text-muted)";
  }

  // ============================================================
  //  Workforce
  // ============================================================
  function renderWorkforce(el) {
    const attendance = Roles.visibleAttendance(user, DataStore.attendance);
    const ranked = AIEngine.rankAbsences(attendance);
    const flagged = ranked.filter(r => r.ai_risk === "CRITICAL" || r.ai_risk === "HIGH");

    const depts = Roles.visibleDepartments(user, DataStore.departments).map(d => ({
      dept: d,
      health: AIEngine.departmentHealth(d, DataStore.projects, DataStore.members, DataStore.complaints),
    })).sort((a, b) => a.health.score - b.health.score);

    el.innerHTML = `
      <p class="ai-tab-intro">Absence risk blends a 30-day absence rate with recent (7-day) absences, so a
         pattern that started this week outranks one that has already settled. Department health combines
         delay risk, open complaints and on-time delivery.</p>

      <div class="ai-two-col">
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-user-clock"></i> Absence risk (${flagged.length} flagged)</div>
          ${ranked.length ? `
            <div class="ai-task-list">
              ${ranked.slice(0, 8).map((r, i) => `
                <div class="ai-task-row">
                  <span class="ai-task-score" style="--tone:${r.ai_risk === "CRITICAL" ? "var(--red)" : r.ai_risk === "HIGH" ? "var(--accent)" : "var(--text-muted)"};">${r.ai_score}</span>
                  <span class="ai-task-main">
                    <b class="clickable-entity" data-entity="${r.person_type === "daily_worker" ? "daily_worker" : "member"}" data-id="${r.person_id}" style="cursor:pointer;">
                      #${i + 1} ${Utils.escapeHtml(r.person_name)}</b>
                    <small>${Utils.escapeHtml(r.department || "—")} · ${r.absence_rate}% absence rate</small>
                    <em><i class="fa-solid fa-sparkles"></i> ${Utils.escapeHtml(r.ai_reason)}</em>
                  </span>
                  ${Components.createBadge(r.ai_risk, Utils.priorityBadgeType(r.ai_risk))}
                </div>`).join("")}
            </div>`
          : Components.createEmptyState("fa-user-check", "No attendance data in view")}
        </div>

        <div class="card">
          <div class="section-title"><i class="fa-solid fa-building-shield"></i> Department health</div>
          ${depts.length ? depts.map(({ dept, health }) => {
            const tone = health.score >= 80 ? "green" : health.score >= 60 ? "blue" : health.score >= 40 ? "yellow" : "red";
            return `
            <div class="ai-health-row">
              <div class="flex items-center justify-between" style="margin-bottom:6px;">
                <b style="font-size:13px;">${Utils.escapeHtml(dept.name)}</b>
                ${Components.createBadge(`${health.score}/100 · ${health.status}`, tone)}
              </div>
              ${Components.createProgressBar(health.score, tone === "red" ? "red" : tone === "yellow" ? "yellow" : "")}
              <p class="ai-health-note">${Utils.escapeHtml(health.summary.split(". ").slice(1).join(". ") || health.summary)}</p>
            </div>`;
          }).join("") : Components.createEmptyState("fa-building", "No departments in view")}
        </div>
      </div>`;
    EntityDetail.bindAuto(el);
  }

  // ============================================================
  //  Anomalies
  // ============================================================
  function renderAnomalies(el) {
    const logs = DataStore.auditLogs;
    const types = ReferenceData.AUDIT_TYPE_LIST;
    const flagged = logs.filter(l => l.is_flagged);

    el.innerHTML = `
      <p class="ai-tab-intro">Every audit event is classified into one of seven types, each analyzed by its own
         technique. Counts below are live from the audit trail.</p>

      <div class="ai-type-grid">
        ${types.map(t => {
          const all = logs.filter(l => l.audit_type === t.key);
          const bad = all.filter(l => l.is_flagged).length;
          const clean = all.length ? Math.round(100 - (bad / all.length) * 100) : 100;
          return `
          <a class="ai-type-card" href="audit" style="--tone:var(--${t.color});">
            <span class="ai-type-icon"><i class="fa-solid ${t.icon}"></i></span>
            <b>${Utils.escapeHtml(t.label)}</b>
            <small>${Utils.escapeHtml(t.ml_role)}</small>
            <div class="ai-type-stats">
              <span><b>${all.length}</b> events</span>
              <span class="${bad ? "bad" : ""}"><b>${bad}</b> flagged</span>
            </div>
            <div class="ai-type-bar"><span style="width:${clean}%"></span></div>
            <small class="ai-type-clean">${clean}% clean</small>
          </a>`;
        }).join("")}
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          <div class="section-title" style="margin-bottom:0;"><i class="fa-solid fa-triangle-exclamation"></i> Highest-scoring anomalies</div>
          <a href="audit" class="btn btn-outline btn-sm">Open Audit Intelligence</a>
        </div>
        ${flagged.length ? `
          <div class="ai-task-list">
            ${flagged.sort((a, b) => b.anomaly_score - a.anomaly_score).slice(0, 6).map(l => `
              <a class="ai-task-row" href="audit">
                <span class="ai-task-score" style="--tone:${l.anomaly_score > 0.85 ? "var(--red)" : "var(--accent)"};">${Math.round(l.anomaly_score * 100)}</span>
                <span class="ai-task-main">
                  <b>${Utils.escapeHtml(l.user)} — ${Utils.escapeHtml(l.action_label || l.action)}</b>
                  <small>${Utils.escapeHtml(ReferenceData.auditTypeMeta(l.audit_type).label)} · ${Utils.formatDate(l.timestamp)}</small>
                  <em><i class="fa-solid fa-sparkles"></i> ${Utils.escapeHtml(l.explanation)}</em>
                </span>
                ${Components.createBadge(l.risk_level, Utils.riskBadgeType(l.risk_level))}
              </a>`).join("")}
          </div>`
        : Components.createEmptyState("fa-shield-check", "No anomalies flagged")}
      </div>`;
  }

  return { init };
})();

// Published for the single-page shell: a top-level `const` creates a
// script-scope binding, NOT a window property, so SPA's window[name]
// lookup would otherwise find nothing.
if (typeof window !== "undefined") window.AIInsightsPage = AIInsightsPage;
