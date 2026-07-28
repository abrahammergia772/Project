/* ============================================================
   BuildIQ — dashboard.js  (role-aware dashboard, A.7)
   ============================================================ */

const DashboardPage = (() => {

  let charts = [];
  function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

  function statCardsFor(role) {
    const s = MockData.dashboardStats(role);
    if (role === "Super Admin") {
      return [
        Components.createStatCard("Active Projects", s.active_projects, 8, "accent", "fa-diagram-project"),
        Components.createStatCard("Total Members", s.total_members, 4, "blue", "fa-users"),
        Components.createStatCard("High Risk Projects", s.high_risk, -12, "red", "fa-triangle-exclamation"),
        Components.createStatCard("Open Complaints", s.open_complaints, 3, "yellow", "fa-comments"),
        Components.createStatCard("Audit Flags", s.audit_flags, -5, "purple", "fa-shield-halved"),
      ];
    }
    if (role === "Manager") {
      return [
        Components.createStatCard("Dept. Projects", Math.round(s.active_projects/2), 6, "accent", "fa-diagram-project"),
        Components.createStatCard("Team Members", Math.round(s.total_members/4), 2, "blue", "fa-users"),
        Components.createStatCard("Open Complaints", Math.round(s.open_complaints/2), 3, "yellow", "fa-comments"),
        Components.createStatCard("High Risk", Math.max(1,Math.round(s.high_risk/2)), -8, "red", "fa-triangle-exclamation"),
      ];
    }
    if (role === "Engineer") {
      return [
        Components.createStatCard("My Tasks Today", 6, null, "accent", "fa-list-check"),
        Components.createStatCard("My Projects", 3, null, "blue", "fa-diagram-project"),
        Components.createStatCard("Overdue", 1, null, "red", "fa-clock"),
      ];
    }
    // Auditor
    return [
      Components.createStatCard("Flagged Today", s.audit_flags, 12, "red", "fa-triangle-exclamation"),
      Components.createStatCard("Under Review", Math.round(s.audit_flags*1.6), null, "yellow", "fa-magnifying-glass"),
      Components.createStatCard("Cleared", 128, null, "green", "fa-circle-check"),
      Components.createStatCard("AI Accuracy", "94%", null, "purple", "fa-brain"),
    ];
  }

  function renderSuperAdmin() {
    return `
      <div class="stats-row" id="statsRow"></div>
      <div class="charts-row">
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-chart-line"></i> Project Completion Trends</div>
          <canvas id="trendChart"></canvas>
        </div>
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-chart-pie"></i> Complaint Categories</div>
          <canvas id="donutChart"></canvas>
        </div>
      </div>
      <div class="two-col-row">
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-diagram-project"></i> Active Projects</div>
          <div id="activeProjectsList" class="flex-col gap-12"></div>
        </div>
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-bolt"></i> Recent Activity</div>
          <div class="activity-feed" id="activityFeed"></div>
        </div>
      </div>
      <div class="card">
        <div class="section-title"><i class="fa-solid fa-building"></i> Department Performance</div>
        <div class="table-wrap"><table class="data-table" id="deptTable"></table></div>
      </div>`;
  }

  function renderManager() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(4,1fr);"></div>
      <div class="charts-row">
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-diagram-project"></i> Department Projects</div>
          <canvas id="deptProjectsChart"></canvas>
        </div>
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-users"></i> Team Workload</div>
          <canvas id="workloadChart"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="section-title"><i class="fa-solid fa-comments"></i> Open Complaints — My Department</div>
        <div id="deptComplaintsList" class="flex-col gap-12"></div>
      </div>`;
  }

  function renderEngineer() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(3,1fr);"></div>
      <div class="card" style="margin-bottom:20px;">
        <div class="section-title"><i class="fa-solid fa-table-columns"></i> My Task Board</div>
        <div class="kanban-board" id="kanbanBoard"></div>
      </div>
      <div class="card">
        <div class="section-title"><i class="fa-solid fa-bolt"></i> My Recent Activity</div>
        <div class="activity-feed" id="activityFeed"></div>
      </div>`;
  }

  function renderAuditor() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(4,1fr);"></div>
      <div class="card" style="margin-bottom:20px;">
        <div class="section-title"><i class="fa-solid fa-flag"></i> Recent Anomaly Flags</div>
        <div id="anomalyList" class="flex-col gap-12"></div>
      </div>
      <div class="card chart-card">
        <div class="section-title"><i class="fa-solid fa-chart-column"></i> Risk Score Distribution</div>
        <canvas id="riskDistChart"></canvas>
      </div>`;
  }

  function chartDefaults() {
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary") || "#94A3B8";
    Chart.defaults.font.family = "Inter";
    Chart.defaults.borderColor = "rgba(255,255,255,0.06)";
  }

  async function init() {
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header">
        <div><h1>Welcome back, ${Utils.escapeHtml(user.name.split(" ")[0])} 👋</h1><div class="page-sub">Here's what's happening across BuildIQ today.</div></div>
      </div>
      <div id="dashBody">${Components.skeletonGrid(4)}</div>`;

    await new Promise(r => setTimeout(r, 300));
    chartDefaults();
    const body = document.getElementById("dashBody");

    if (user.role === "Super Admin") body.innerHTML = renderSuperAdmin();
    else if (user.role === "Manager") body.innerHTML = renderManager();
    else if (user.role === "Engineer") body.innerHTML = renderEngineer();
    else body.innerHTML = renderAuditor();

    document.getElementById("statsRow").innerHTML = statCardsFor(user.role).join("");

    if (user.role === "Super Admin") await fillSuperAdmin();
    else if (user.role === "Manager") await fillManager();
    else if (user.role === "Engineer") await fillEngineer();
    else await fillAuditor();
  }

  async function fillSuperAdmin() {
    const projects = await API.getProjects();
    const complaints = await API.getComplaints();

    // Trend chart (mocked 6-month completion trend)
    charts.push(new Chart(document.getElementById("trendChart"), {
      type: "line",
      data: {
        labels: ["Feb","Mar","Apr","May","Jun","Jul"],
        datasets: [{
          label: "Avg. Completion %",
          data: [42, 51, 58, 63, 70, 76],
          borderColor: "#F97316",
          backgroundColor: "rgba(249,115,22,0.12)",
          fill: true, tension: 0.4, pointRadius: 3,
        }],
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
    }));

    // Donut of complaint categories
    const catCounts = {};
    complaints.forEach(c => catCounts[c.category] = (catCounts[c.category]||0)+1);
    charts.push(new Chart(document.getElementById("donutChart"), {
      type: "doughnut",
      data: {
        labels: Object.keys(catCounts),
        datasets: [{ data: Object.values(catCounts), backgroundColor: ["#F97316","#3B82F6","#22C55E","#A855F7","#EAB308","#EF4444","#64748B","#FB923C"] }],
      },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
    }));

    document.getElementById("activeProjectsList").innerHTML = projects.filter(p => p.status === "In Progress").slice(0,4)
      .map(p => `<div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border);">
        <div><div style="font-weight:600; font-size:13.5px;">${Utils.escapeHtml(p.title)}</div><div style="font-size:11.5px; color:var(--text-muted);">${p.region}</div></div>
        ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
      </div>`).join("");

    document.getElementById("activityFeed").innerHTML = MockData.auditLogs.slice(0,6).map(l => `
      <div class="activity-item">
        <div class="activity-icon"><i class="fa-solid fa-circle-info"></i></div>
        <div><div class="activity-text"><b>${Utils.escapeHtml(l.user)}</b> performed ${l.action.replace(/_/g," ").toLowerCase()}</div><div class="activity-time">${Utils.timeAgo(l.timestamp)}</div></div>
      </div>`).join("");

    const deptTable = document.getElementById("deptTable");
    deptTable.innerHTML = `<thead><tr><th>Department</th><th>Head</th><th>Members</th><th>Projects</th><th>Performance</th></tr></thead>
      <tbody>${MockData.departments.map(d => `<tr><td>${d.name}</td><td>${d.head}</td><td>${d.members}</td><td>${d.projects}</td>
        <td style="width:160px;">${Components.createProgressBar(60+Math.round(Math.random()*35))}</td></tr>`).join("")}</tbody>`;
  }

  async function fillManager() {
    charts.push(new Chart(document.getElementById("deptProjectsChart"), {
      type: "bar",
      data: { labels: ["Planning","In Progress","Completed"], datasets: [{ label: "Projects", data: [2,4,3], backgroundColor: "#3B82F6", borderRadius: 6 }] },
      options: { plugins: { legend: { display:false } } },
    }));
    charts.push(new Chart(document.getElementById("workloadChart"), {
      type: "bar",
      data: { labels: ["Abebe","Bethel.","Girma","Liya","Samuel"], datasets: [{ label: "Tasks", data: [8,5,9,4,7], backgroundColor: "#F97316", borderRadius: 6 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } } },
    }));
    const complaints = await API.getComplaints({ status: "pending" });
    document.getElementById("deptComplaintsList").innerHTML = complaints.slice(0,4).map(Components.createComplaintCard).join("");
  }

  async function fillEngineer() {
    const cols = { "To Do": [], "In Progress": [], "Done": [] };
    const sample = ["Pour foundation slab","Install rebar mesh","Site safety inspection","Review structural drawings","Coordinate with electrical team","Update progress photos","Submit weekly report"];
    sample.forEach((t,i) => { const k = Object.keys(cols)[i % 3]; cols[k].push(t); });
    document.getElementById("kanbanBoard").innerHTML = Object.entries(cols).map(([col, tasks]) => `
      <div class="kanban-col">
        <div class="kanban-col-title"><span>${col}</span><span>${tasks.length}</span></div>
        ${tasks.map(t => `<div class="kanban-card">${t}<div class="kanban-meta"><i class="fa-regular fa-clock"></i> Due in ${Math.ceil(Math.random()*5)+1}d</div></div>`).join("")}
      </div>`).join("");
    document.getElementById("activityFeed").innerHTML = `
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-check"></i></div><div><div class="activity-text">Marked "Site safety inspection" complete</div><div class="activity-time">2h ago</div></div></div>
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-comment"></i></div><div><div class="activity-text">Submitted a complaint regarding material delivery</div><div class="activity-time">1d ago</div></div></div>`;
  }

  async function fillAuditor() {
    const anomalies = await API.getAuditAnomalies();
    document.getElementById("anomalyList").innerHTML = anomalies.slice(0,3).map(Components.createAuditCard).join("");
    const buckets = [0,0,0,0,0];
    MockData.auditLogs.forEach(l => { buckets[Math.min(4, Math.floor(l.anomaly_score*5))]++; });
    charts.push(new Chart(document.getElementById("riskDistChart"), {
      type: "bar",
      data: { labels: ["0-20","20-40","40-60","60-80","80-100"], datasets: [{ label: "Logs", data: buckets, backgroundColor: ["#22C55E","#22C55E","#EAB308","#EF4444","#EF4444"], borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } } },
    }));
  }

  return { init };
})();
