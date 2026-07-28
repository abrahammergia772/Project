/* ============================================================
   BuildIQ — audit.js  (A.11)
   ============================================================ */

const AuditPage = (() => {
  let logs = [];
  let charts = [];

  function shell() {
    return `
      <div class="page-header"><div><h1>Audit Intelligence</h1><div class="page-sub">Dual-model anomaly detection: Isolation Forest + Random Forest</div></div></div>
      <div id="alertBanner"></div>
      <div class="audit-stats" id="auditStats"></div>
      <div class="tabs" id="auditTabs">
        <div class="tab active" data-tab="anomalies">Anomalies</div>
        <div class="tab" data-tab="logs">All Logs</div>
        <div class="tab" data-tab="analytics">Analytics</div>
        <div class="tab" data-tab="rules">Rules</div>
      </div>
      <div id="tabContent" style="margin-top:18px;"></div>`;
  }

  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("tabContent").innerHTML = Components.skeletonGrid(4);

    logs = await API.getAuditLogs();
    renderBanner();
    renderStats();
    renderTab("anomalies");

    Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("auditTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTab(tab.dataset.tab);
    }));
  }

  function renderBanner() {
    const critical = logs.filter(l => l.risk_level === "CRITICAL").length;
    document.getElementById("alertBanner").innerHTML = critical ? `
      <div class="alert-banner">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>${critical} critical anomal${critical === 1 ? "y" : "ies"} detected</span>
        <button class="btn btn-danger btn-sm" id="reviewNowBtn">Review Now</button>
      </div>` : "";
    document.getElementById("reviewNowBtn")?.addEventListener("click", () => renderTab("anomalies"));
  }

  function renderStats() {
    const flaggedToday = logs.filter(l => l.is_flagged).length;
    const underReview = logs.filter(l => l.review_status === "Under Review").length;
    const cleared = logs.filter(l => l.review_status === "Cleared").length;
    document.getElementById("auditStats").innerHTML = [
      Components.createStatCard("Flagged Today", flaggedToday, null, "red", "fa-flag"),
      Components.createStatCard("Under Review", underReview, null, "yellow", "fa-magnifying-glass"),
      Components.createStatCard("Cleared", cleared, null, "green", "fa-circle-check"),
      Components.createStatCard("Total Logs", logs.length, null, "blue", "fa-list"),
      Components.createStatCard("AI Accuracy", "94.2%", null, "purple", "fa-brain"),
      Components.createStatCard("False Alarm Rate", "5.1%", null, "accent", "fa-ban"),
    ].join("");
  }

  function renderTab(key) {
    const el = document.getElementById("tabContent");
    charts.forEach(c => c.destroy()); charts = [];
    if (key === "anomalies") {
      const anomalies = logs.filter(l => l.is_flagged).sort((a,b)=>b.anomaly_score-a.anomaly_score);
      el.innerHTML = anomalies.length ? `<div class="audit-cards-grid">${anomalies.map(Components.createAuditCard).join("")}</div>` : Components.createEmptyState("fa-shield-halved","No anomalies detected");
      bindAuditActions();
    } else if (key === "logs") {
      el.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>User</th><th>Action</th><th>Resource</th><th>Time</th><th>Risk</th><th>Score</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td><div class="flex items-center gap-8">${Components.createAvatar(l.user,"sm")}<span>${Utils.escapeHtml(l.user)}</span></div></td>
          <td>${Components.createBadge(l.action, (l.action==="BULK_DELETE"||l.action==="EXPORT_DATA")?"red":"gray")}</td>
          <td>${Utils.escapeHtml(l.resource)}</td>
          <td>${Utils.formatDate(l.timestamp)}</td>
          <td>${Components.createBadge(l.risk_level, Utils.riskBadgeType(l.risk_level))}</td>
          <td class="mono">${(l.anomaly_score*100).toFixed(1)}%</td>
        </tr>`).join("")}</tbody></table></div>`;
    } else if (key === "analytics") {
      el.innerHTML = `
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div class="card chart-card"><div class="section-title">Risk Score Histogram</div><canvas id="histChart"></canvas></div>
          <div class="card chart-card"><div class="section-title">Anomaly Types</div><canvas id="typesChart"></canvas></div>
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
      const rules = [
        { name: "Off-hours Access", desc: "Flags activity outside 6AM–10PM working hours", on: true },
        { name: "Bulk Data Export", desc: "Flags exports exceeding 1000 records", on: true },
        { name: "Rapid Permission Changes", desc: "Flags 3+ permission changes within 1 hour", on: true },
        { name: "Unusual Location Login", desc: "Flags logins from new IP/device combinations", on: false },
        { name: "Repeated Failed Logins", desc: "Flags 5+ failed login attempts within 10 minutes", on: true },
      ];
      el.innerHTML = `<div class="rules-list">${rules.map((r,i) => `
        <div class="rule-row">
          <div><div style="font-weight:600; font-size:13.5px;">${r.name}</div><div style="font-size:12px; color:var(--text-muted);">${r.desc}</div></div>
          <div class="toggle-switch ${r.on ? "on" : ""}" data-idx="${i}"></div>
        </div>`).join("")}</div>
        <div class="card" style="margin-top:16px;"><div class="section-title"><i class="fa-solid fa-sliders"></i> Sensitivity</div>
          <input type="range" min="0" max="100" value="65" class="input" style="padding:0;">
        </div>`;
      Utils.qsa(".toggle-switch").forEach(t => t.addEventListener("click", () => t.classList.toggle("on")));
    }
  }

  function renderAnalyticsCharts() {
    Chart.defaults.color = "#94A3B8"; Chart.defaults.font.family = "Inter";
    const buckets = [0,0,0,0,0];
    logs.forEach(l => buckets[Math.min(4, Math.floor(l.anomaly_score*5))]++);
    charts.push(new Chart(document.getElementById("histChart"), {
      type: "bar", data: { labels: ["0-20","20-40","40-60","60-80","80-100"], datasets: [{ data: buckets, backgroundColor: ["#22C55E","#22C55E","#EAB308","#EF4444","#EF4444"], borderRadius:6 }] },
      options: { plugins: { legend: { display:false } } },
    }));
    const typeCounts = {};
    logs.forEach(l => typeCounts[l.action] = (typeCounts[l.action]||0)+1);
    charts.push(new Chart(document.getElementById("typesChart"), {
      type: "doughnut", data: { labels: Object.keys(typeCounts), datasets: [{ data: Object.values(typeCounts), backgroundColor: ["#F97316","#3B82F6","#22C55E","#A855F7","#EAB308","#EF4444","#64748B","#FB923C"] }] },
      options: { plugins: { legend: { position:"bottom", labels:{boxWidth:10,font:{size:10}} } } },
    }));
    charts.push(new Chart(document.getElementById("trendChart"), {
      type: "line", data: { labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], datasets: [{ data:[2,4,3,6,5,9,7], borderColor:"#EF4444", backgroundColor:"rgba(239,68,68,0.12)", fill:true, tension:0.4 }] },
      options: { plugins: { legend: { display:false } } },
    }));
    const userCounts = {};
    logs.filter(l=>l.is_flagged).forEach(l => userCounts[l.user] = (userCounts[l.user]||0)+1);
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
