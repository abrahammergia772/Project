/* ============================================================
   BuildIQ — audit.js  (A.11)
   ============================================================ */

const AuditPage = (() => {
  let logs = [];
  let charts = [];
  let activeTab = "anomalies";
  // Active audit-type filter ("ALL" or one of the 7 AUDIT_TYPES keys)
  let typeFilter = "ALL";

  function types() { return MockData.AUDIT_TYPE_LIST; }
  function typeMeta(key) { return MockData.auditTypeMeta(key); }

  // Logs narrowed to the current audit-type filter
  function filtered() {
    return typeFilter === "ALL" ? logs : logs.filter(l => l.audit_type === typeFilter);
  }

  function shell() {
    return `
      <div class="page-header"><div><h1>Audit Intelligence</h1><div class="page-sub">Seven audit types monitored by dedicated AI models</div></div></div>
      <div id="alertBanner"></div>
      <div class="audit-stats" id="auditStats"></div>
      <div class="tabs" id="auditTabs">
        <div class="tab active" data-tab="anomalies">Anomalies</div>
        <div class="tab" data-tab="types">Audit Types</div>
        <div class="tab" data-tab="logs">All Logs</div>
        <div class="tab" data-tab="analytics">Analytics</div>
        <div class="tab" data-tab="rules">Rules</div>
      </div>
      <div id="typeFilterBar"></div>
      <div id="tabContent" style="margin-top:18px;"></div>`;
  }

  // ---------------- Audit-type filter chips ----------------
  function renderTypeFilter() {
    const bar = document.getElementById("typeFilterBar");
    // The filter only makes sense where we're listing events
    if (!["anomalies", "logs", "analytics"].includes(activeTab)) { bar.innerHTML = ""; return; }

    const counts = { ALL: logs.length };
    types().forEach(t => { counts[t.key] = logs.filter(l => l.audit_type === t.key).length; });

    bar.innerHTML = `
      <div class="audit-type-filter" role="tablist" aria-label="Filter by audit type">
        <button class="type-chip ${typeFilter === "ALL" ? "active" : ""}" data-type="ALL">
          <i class="fa-solid fa-layer-group"></i> All Types <span class="type-chip-count">${counts.ALL}</span>
        </button>
        ${types().map(t => `
          <button class="type-chip ${typeFilter === t.key ? "active" : ""}" data-type="${t.key}" style="--chip-color: var(--${t.color});">
            <i class="fa-solid ${t.icon}"></i> ${Utils.escapeHtml(t.label.replace(" Audit", ""))}
            <span class="type-chip-count">${counts[t.key]}</span>
          </button>`).join("")}
      </div>`;

    Utils.qsa(".type-chip", bar).forEach(chip => chip.addEventListener("click", () => {
      typeFilter = chip.dataset.type;
      renderTypeFilter();
      renderStats();
      renderTab(activeTab);
    }));
  }

  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("tabContent").innerHTML = Components.skeletonGrid(4);

    logs = await API.getAuditLogs();
    renderBanner();
    renderTypeFilter();
    renderStats();
    renderTab("anomalies");

    Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      renderTypeFilter();
      renderTab(activeTab);
    }));
  }

  function renderBanner() {
    // Group critical anomalies by audit type so the banner says *what kind* of risk
    const critical = logs.filter(l => l.risk_level === "CRITICAL");
    if (!critical.length) { document.getElementById("alertBanner").innerHTML = ""; return; }

    const byType = {};
    critical.forEach(l => { byType[l.audit_type] = (byType[l.audit_type] || 0) + 1; });
    const worst = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const worstMeta = typeMeta(worst[0]);

    document.getElementById("alertBanner").innerHTML = `
      <div class="alert-banner">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>${critical.length} critical anomal${critical.length === 1 ? "y" : "ies"} detected —
          most in <b>${Utils.escapeHtml(worstMeta.label)}</b> (${worst[1]})</span>
        <button class="btn btn-danger btn-sm" id="reviewNowBtn">Review Now</button>
      </div>`;

    document.getElementById("reviewNowBtn")?.addEventListener("click", () => {
      typeFilter = worst[0];
      activeTab = "anomalies";
      Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(t =>
        t.classList.toggle("active", t.dataset.tab === "anomalies"));
      renderTypeFilter();
      renderStats();
      renderTab("anomalies");
    });
  }

  function renderStats() {
    const scoped = filtered();
    const flagged = scoped.filter(l => l.is_flagged).length;
    const underReview = scoped.filter(l => l.review_status === "Under Review").length;
    const cleared = scoped.filter(l => l.review_status === "Cleared").length;
    // Which audit type is generating the most flags in the current scope
    const byType = {};
    scoped.filter(l => l.is_flagged).forEach(l => { byType[l.audit_type] = (byType[l.audit_type] || 0) + 1; });
    const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const topLabel = top ? typeMeta(top[0]).label.replace(" Audit", "") : "—";

    document.getElementById("auditStats").innerHTML = [
      Components.createStatCard("Flagged", flagged, null, "red", "fa-flag"),
      Components.createStatCard("Under Review", underReview, null, "yellow", "fa-magnifying-glass"),
      Components.createStatCard("Cleared", cleared, null, "green", "fa-circle-check"),
      Components.createStatCard("Events in Scope", scoped.length, null, "blue", "fa-list"),
      Components.createStatCard("Top Risk Area", topLabel, null, "purple", "fa-crosshairs"),
      Components.createStatCard("AI Accuracy", "94.2%", null, "accent", "fa-brain"),
    ].join("");
  }

  // ---------------- Audit Types overview tab ----------------
  function renderTypesTab(el) {
    el.innerHTML = `
      <p class="audit-types-intro">
        Every audit event is classified into one of seven audit types. Each type watches for its own
        signals and is analyzed by a dedicated AI technique. Click a card to review that type's events.
      </p>
      <div class="audit-types-grid">
        ${types().map((t, i) => {
          const typeLogs = logs.filter(l => l.audit_type === t.key);
          const flagged = typeLogs.filter(l => l.is_flagged).length;
          const critical = typeLogs.filter(l => l.risk_level === "CRITICAL").length;
          const health = typeLogs.length ? Math.round(100 - (flagged / typeLogs.length) * 100) : 100;
          return `
            <div class="audit-type-card" data-type="${t.key}" style="--type-color: var(--${t.color});" tabindex="0" role="button" aria-label="Review ${Utils.escapeHtml(t.label)}">
              <div class="atc-head">
                <div class="atc-icon"><i class="fa-solid ${t.icon}"></i></div>
                <div class="atc-title">
                  <div class="atc-num">${i + 1}</div>
                  <h3>${Utils.escapeHtml(t.label)}</h3>
                  <p>${Utils.escapeHtml(t.purpose)}</p>
                </div>
                ${critical ? `<span class="badge badge-red">${critical} critical</span>` : ""}
              </div>

              <ul class="atc-signals">
                ${t.signals.map(s => `<li><i class="fa-solid fa-circle-check"></i> ${Utils.escapeHtml(s)}</li>`).join("")}
              </ul>

              <div class="atc-footer">
                <div class="atc-ml"><i class="fa-solid fa-brain"></i> <span>${Utils.escapeHtml(t.ml_role)}</span></div>
                <div class="atc-metrics">
                  <span title="Events recorded"><b>${typeLogs.length}</b> events</span>
                  <span title="Flagged for review" class="${flagged ? "is-flagged" : ""}"><b>${flagged}</b> flagged</span>
                </div>
              </div>
              <div class="atc-health">
                <div class="atc-health-bar"><span style="width:${health}%;"></span></div>
                <span class="atc-health-label">${health}% clean</span>
              </div>
            </div>`;
        }).join("")}
      </div>`;

    const open = (key) => {
      typeFilter = key;
      activeTab = "anomalies";
      Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(t =>
        t.classList.toggle("active", t.dataset.tab === "anomalies"));
      renderTypeFilter();
      renderStats();
      renderTab("anomalies");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    Utils.qsa(".audit-type-card", el).forEach(card => {
      card.addEventListener("click", () => open(card.dataset.type));
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(card.dataset.type); } });
    });
  }

  function renderTab(key) {
    const el = document.getElementById("tabContent");
    charts.forEach(c => c.destroy()); charts = [];
    if (key === "types") {
      renderTypesTab(el);
    } else if (key === "anomalies") {
      const scopeLabel = typeFilter === "ALL" ? "" : ` in ${typeMeta(typeFilter).label}`;
      const anomalies = filtered().filter(l => l.is_flagged).sort((a,b)=>b.anomaly_score-a.anomaly_score);
      el.innerHTML = anomalies.length
        ? `<div class="audit-cards-grid">${anomalies.map(Components.createAuditCard).join("")}</div>`
        : Components.createEmptyState("fa-shield-halved", `No anomalies detected${scopeLabel}`);
      bindAuditActions();
      EntityDetail.bindAuto(el);
    } else if (key === "logs") {
      const rows = filtered();
      el.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>User</th><th>Audit Type</th><th>Action</th><th>Resource</th><th>Time</th><th>Risk</th><th>Score</th></tr></thead>
        <tbody>${rows.length ? rows.map(l => {
          const member = MockData.getMemberByName(l.user);
          const t = typeMeta(l.audit_type);
          return `<tr>
          <td><div class="flex items-center gap-8 ${member ? 'clickable-entity' : ''}" ${member ? `data-entity="member" data-id="${member.id}"` : ""} style="${member ? 'cursor:pointer;' : ''}">${Components.createAvatar(l.user,"sm")}<span>${Utils.escapeHtml(l.user)}</span></div></td>
          <td><span class="type-pill" style="--type-color:var(--${t.color});"><i class="fa-solid ${t.icon}"></i> ${Utils.escapeHtml(t.label.replace(" Audit",""))}</span></td>
          <td>${Components.createBadge(l.action_label || l.action, l.is_flagged ? "red" : "gray")}</td>
          <td>${Utils.escapeHtml(l.resource)}</td>
          <td>${Utils.formatDate(l.timestamp)}</td>
          <td>${Components.createBadge(l.risk_level, Utils.riskBadgeType(l.risk_level))}</td>
          <td class="mono">${(l.anomaly_score*100).toFixed(1)}%</td>
        </tr>`;
        }).join("") : `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:22px;">No events for this audit type.</td></tr>`}</tbody></table></div>`;
      EntityDetail.bindAuto(el);
    } else if (key === "analytics") {
      el.innerHTML = `
        <div class="card chart-card" style="margin-bottom:16px;">
          <div class="section-title"><i class="fa-solid fa-layer-group"></i> Flagged Events by Audit Type</div>
          <canvas id="byTypeChart" style="max-height:260px;"></canvas>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div class="card chart-card"><div class="section-title">Risk Score Histogram</div><canvas id="histChart"></canvas></div>
          <div class="card chart-card"><div class="section-title">Action Breakdown</div><canvas id="typesChart"></canvas></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:16px;">
          <div class="card chart-card"><div class="section-title">Trend Over Time</div><canvas id="trendChart"></canvas></div>
          <div class="card chart-card"><div class="section-title">Top Flagged Users</div><canvas id="usersChart"></canvas></div>
        </div>`;
      setTimeout(renderAnalyticsCharts, 30);
    } else if (key === "rules") {
      const user = Auth.getUser();
      if (user.role !== "Super Admin") {
        el.innerHTML = Components.createEmptyState("fa-lock", "Super Admin only", "Detection rules can only be configured by a Super Admin.");
        return;
      }
      // Detection rules grouped under the audit type they belong to
      const RULES_BY_TYPE = {
        SECURITY: [
          { name: "Repeated Failed Logins", desc: "Flags 5+ failed login attempts within 10 minutes", on: true },
          { name: "Off-hours Access", desc: "Flags activity outside 6AM–10PM working hours", on: true },
          { name: "Unusual Location Login", desc: "Flags logins from new IP/device combinations", on: false },
          { name: "Unauthorized Module Access", desc: "Flags attempts to open modules outside the user's role", on: true },
        ],
        FINANCIAL: [
          { name: "Expense Above Threshold", desc: "Flags expense claims exceeding the configured limit", on: true },
          { name: "Budget Modification", desc: "Flags any change to an approved project budget", on: true },
          { name: "Invoice Deletion", desc: "Flags deletion of issued invoices", on: true },
          { name: "Self-Approved Payment", desc: "Flags payments approved by their own requester", on: true },
        ],
        COMPLIANCE: [
          { name: "Approval Chain Bypass", desc: "Flags records advanced without the required approver", on: true },
          { name: "Late Document Submission", desc: "Flags documents submitted after their due date", on: true },
          { name: "Incomplete Required Fields", desc: "Flags records saved with mandatory fields blank", on: false },
        ],
        USER_ACTIVITY: [
          { name: "Bulk Operations", desc: "Flags mass delete/edit affecting 25+ records", on: true },
          { name: "Role Misuse", desc: "Flags actions outside the user's normal role scope", on: true },
          { name: "Dormant Account Access", desc: "Flags activity from accounts inactive 60+ days", on: true },
        ],
        DATA_INTEGRITY: [
          { name: "Edit Without Approval", desc: "Flags record changes lacking an approval trail", on: true },
          { name: "Duplicate Entry Detection", desc: "Flags near-identical records created within 24h", on: true },
          { name: "External Data Import", desc: "Flags data loaded from outside sources", on: false },
        ],
        PROJECT_RESOURCE: [
          { name: "Material Usage vs Budget", desc: "Flags material spend exceeding 90% of allocation", on: true },
          { name: "Equipment Not Returned", desc: "Flags equipment overdue past its return date", on: true },
          { name: "Milestone Delay", desc: "Flags milestones trending more than 7 days late", on: true },
          { name: "Contractor Performance Drop", desc: "Flags contractors falling below the quality baseline", on: false },
        ],
        REPORT_DOCUMENT: [
          { name: "External Report Sharing", desc: "Flags reports shared outside the organization", on: true },
          { name: "Post-Approval Edit", desc: "Flags reports modified after sign-off", on: true },
          { name: "High Generation Frequency", desc: "Flags unusually frequent report generation by one user", on: false },
        ],
      };

      el.innerHTML = `
        <p class="audit-types-intro">Detection rules are grouped by audit type. Each group feeds the AI model listed beside it.</p>
        ${types().map(t => `
          <div class="rules-group">
            <div class="rules-group-head" style="--type-color:var(--${t.color});">
              <span class="type-pill" style="--type-color:var(--${t.color});"><i class="fa-solid ${t.icon}"></i> ${Utils.escapeHtml(t.label)}</span>
              <span class="rules-group-ml"><i class="fa-solid fa-brain"></i> ${Utils.escapeHtml(t.ml_role)}</span>
            </div>
            <div class="rules-list">
              ${(RULES_BY_TYPE[t.key] || []).map((r, i) => `
                <div class="rule-row">
                  <div><div style="font-weight:600; font-size:13.5px;">${Utils.escapeHtml(r.name)}</div><div style="font-size:12px; color:var(--text-muted);">${Utils.escapeHtml(r.desc)}</div></div>
                  <div class="toggle-switch ${r.on ? "on" : ""}" data-type="${t.key}" data-idx="${i}" role="switch" aria-checked="${r.on}" tabindex="0" aria-label="${Utils.escapeHtml(r.name)}"></div>
                </div>`).join("")}
            </div>
          </div>`).join("")}
        <div class="card" style="margin-top:16px;"><div class="section-title"><i class="fa-solid fa-sliders"></i> Global Detection Sensitivity</div>
          <input type="range" min="0" max="100" value="65" class="input" id="sensitivityRange" style="padding:0;">
          <div style="font-size:12px; color:var(--text-muted); margin-top:8px;">Higher sensitivity flags more events across all seven audit types.</div>
        </div>`;

      const toggle = (t) => {
        t.classList.toggle("on");
        t.setAttribute("aria-checked", String(t.classList.contains("on")));
        Components.createToast("Detection rule updated.", "success");
      };
      Utils.qsa(".toggle-switch", el).forEach(t => {
        t.addEventListener("click", () => toggle(t));
        t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(t); } });
      });
    }
  }

  // Resolve a CSS custom property to a real color for Chart.js
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#64748B";
  }

  function renderAnalyticsCharts() {
    Chart.defaults.color = "#94A3B8"; Chart.defaults.font.family = "Inter";
    const scoped = filtered();

    // Stacked flagged-vs-clean per audit type
    const byTypeCanvas = document.getElementById("byTypeChart");
    if (byTypeCanvas) {
      const labels = types().map(t => t.label.replace(" Audit", ""));
      const flaggedData = types().map(t => logs.filter(l => l.audit_type === t.key && l.is_flagged).length);
      const cleanData = types().map(t => logs.filter(l => l.audit_type === t.key && !l.is_flagged).length);
      charts.push(new Chart(byTypeCanvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Flagged", data: flaggedData, backgroundColor: types().map(t => cssVar(`--${t.color}`)), borderRadius: 6 },
            { label: "Clean", data: cleanData, backgroundColor: "rgba(100,116,139,0.35)", borderRadius: 6 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, beginAtZero: true } },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                afterTitle: (items) => {
                  const t = types()[items[0].dataIndex];
                  return `AI: ${t.ml_role}`;
                },
              },
            },
          },
        },
      }));
    }

    const buckets = [0,0,0,0,0];
    scoped.forEach(l => buckets[Math.min(4, Math.floor(l.anomaly_score*5))]++);
    charts.push(new Chart(document.getElementById("histChart"), {
      type: "bar", data: { labels: ["0-20","20-40","40-60","60-80","80-100"], datasets: [{ data: buckets, backgroundColor: ["#22C55E","#22C55E","#EAB308","#EF4444","#EF4444"], borderRadius:6 }] },
      options: { plugins: { legend: { display:false } } },
    }));
    // Action breakdown within the current scope, using readable labels
    const actionCounts = {};
    scoped.forEach(l => {
      const label = l.action_label || l.action;
      actionCounts[label] = (actionCounts[label] || 0) + 1;
    });
    const topActions = Object.entries(actionCounts).sort((a,b) => b[1]-a[1]).slice(0, 8);
    charts.push(new Chart(document.getElementById("typesChart"), {
      type: "doughnut",
      data: { labels: topActions.map(a=>a[0]), datasets: [{ data: topActions.map(a=>a[1]), backgroundColor: ["#F97316","#3B82F6","#22C55E","#A855F7","#EAB308","#EF4444","#64748B","#06B6D4"] }] },
      options: { plugins: { legend: { position:"bottom", labels:{boxWidth:10,font:{size:10}} } } },
    }));
    // Real 7-day flagged trend derived from the scoped logs
    const dayLabels = [], dayCounts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      dayLabels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
      dayCounts.push(scoped.filter(l => l.is_flagged && String(l.timestamp).slice(0, 10) === key).length);
    }
    charts.push(new Chart(document.getElementById("trendChart"), {
      type: "line",
      data: { labels: dayLabels, datasets: [{ data: dayCounts, borderColor:"#EF4444", backgroundColor:"rgba(239,68,68,0.12)", fill:true, tension:0.4 }] },
      options: { plugins: { legend: { display:false } }, scales: { y: { beginAtZero: true } } },
    }));
    const userCounts = {};
    scoped.filter(l=>l.is_flagged).forEach(l => userCounts[l.user] = (userCounts[l.user]||0)+1);
    const topUsers = Object.entries(userCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
    charts.push(new Chart(document.getElementById("usersChart"), {
      type: "bar", data: { labels: topUsers.map(u=>u[0]), datasets: [{ data: topUsers.map(u=>u[1]), backgroundColor:"#A855F7", borderRadius:6 }] },
      options: { indexAxis:"y", plugins: { legend: { display:false } } },
    }));
  }

  function bindAuditActions() {
    const actionMap = { "suspend-btn": "suspended", "revoke-btn": "revoked", "confirm-threat-btn": "confirmed as threat", "false-alarm-btn": "marked as false alarm" };
    Object.keys(actionMap).forEach(cls => {
      Utils.qsa(`.${cls}`).forEach(btn => btn.addEventListener("click", async () => {
        await API.auditFeedback({ id: btn.dataset.id, action: cls });
        const reviewer = Auth.getUser();
        const AUDIT_ACTIONS = { "suspend-btn": "SUSPEND_USER", "revoke-btn": "PERMISSION_CHANGE", "confirm-threat-btn": "UPDATE_RECORD", "false-alarm-btn": "UPDATE_RECORD" };
        MockData.logAuditEvent(reviewer, AUDIT_ACTIONS[cls], `audit_logs/${btn.dataset.id}`);
        Components.createToast(`Log entry ${actionMap[cls]}.`, cls === "false-alarm-btn" ? "info" : "success");
        if (cls === "false-alarm-btn" || cls === "confirm-threat-btn") {
          const log = logs.find(l => l.id === btn.dataset.id);
          if (log) log.is_flagged = false;
          renderStats(); renderTab("anomalies");
        }
      }));
    });
  }

  return { init };
})();
