/* ============================================================
   BuildIQ — dashboard.js  (role-aware dashboard for all 6 roles)
   ============================================================ */

const DashboardPage = (() => {

  let charts = [];
  function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

  function statCardsFor(user) {
    const role = user.role;
    const s = MockData.dashboardStats(role);
    if (role === "Super Admin" || role === "General Manager") {
      return [
        Components.createStatCard("Active Projects", s.active_projects, 8, "accent", "fa-diagram-project"),
        Components.createStatCard("Total Members", s.total_members, 4, "blue", "fa-users"),
        Components.createStatCard("High Risk Projects", s.high_risk, -12, "red", "fa-triangle-exclamation"),
        Components.createStatCard("Open Complaints", s.open_complaints, 3, "yellow", "fa-comments"),
        role === "Super Admin" ? Components.createStatCard("Audit Flags", s.audit_flags, -5, "purple", "fa-shield-halved")
                               : Components.createStatCard("Departments", MockData.departments.length, null, "cyan", "fa-building"),
      ];
    }
    if (role === "Department Manager") {
      const deptProjects = MockData.projects.filter(p => p.department === user.department);
      const deptComplaints = MockData.complaints.filter(c => c.department === user.department);
      const deptMembers = MockData.members.filter(m => m.department === user.department);
      return [
        Components.createStatCard("Dept. Projects", deptProjects.length, null, "accent", "fa-diagram-project"),
        Components.createStatCard("Team Members", deptMembers.length, null, "blue", "fa-users"),
        Components.createStatCard("Open Complaints", deptComplaints.filter(c=>c.status!=="resolved").length, null, "yellow", "fa-comments"),
        Components.createStatCard("High Risk", deptProjects.filter(p=>p.delay_risk==="HIGH").length, null, "red", "fa-triangle-exclamation"),
      ];
    }
    if (role === "Engineer") {
      const myTasks = MockData.tasks.filter(t => t.assignee_id === user.id);
      const overdue = myTasks.filter(t => t.status !== "Done" && new Date(t.due_date) < new Date()).length;
      return [
        Components.createStatCard("Open Tasks", myTasks.filter(t=>t.status!=="Done").length, null, "accent", "fa-list-check"),
        Components.createStatCard("My Projects", Roles.visibleProjects(user, MockData.projects).length, null, "blue", "fa-diagram-project"),
        Components.createStatCard("Overdue", overdue, null, "red", "fa-clock"),
      ];
    }
    if (role === "Client") {
      const myProjects = Roles.visibleProjects(user, MockData.projects);
      const myComplaints = Roles.visibleComplaints(user, MockData.complaints);
      return [
        Components.createStatCard("My Projects", myProjects.length, null, "accent", "fa-diagram-project"),
        Components.createStatCard("Avg. Progress", myProjects.length ? Math.round(myProjects.reduce((s,p)=>s+p.progress,0)/myProjects.length) + "%" : "—", null, "blue", "fa-chart-line"),
        Components.createStatCard("My Complaints", myComplaints.length, null, "yellow", "fa-comments"),
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

  function aiExecSummaryBox(id) {
    return `<div class="card" id="${id}" style="background:rgba(var(--accent-rgb),0.08); border-left:3px solid var(--accent); margin-bottom:20px;">
      <div style="font-weight:700; font-size:12.5px; color:var(--accent); margin-bottom:6px;"><i class="fa-solid fa-robot"></i> AI Executive Summary</div>
      <div style="font-size:13px; color:var(--text-secondary);">${Components.createSkeleton("text")}</div>
    </div>`;
  }

  function renderOrgWide(role) {
    return `
      <div class="stats-row" id="statsRow" ${role==="General Manager" ? 'style="grid-template-columns:repeat(5,1fr);"' : ""}></div>
      ${aiExecSummaryBox("execSummary")}
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

  function renderDeptManager() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(4,1fr);"></div>
      ${aiExecSummaryBox("execSummary")}
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
        <div class="flex items-center justify-between" style="margin-bottom:14px;">
          <div class="section-title" style="margin-bottom:0;"><i class="fa-solid fa-ranking-star"></i> My AI-Prioritized Tasks</div>
          <a href="tasks.html" class="btn btn-outline btn-sm">Open Tasks & Schedule</a>
        </div>
        <div id="topTasksList" class="flex-col gap-8"></div>
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

  function renderClient() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(3,1fr);"></div>
      <div class="card" style="margin-bottom:20px;" id="myProjectCard"></div>
      <div class="two-col-row">
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-comments"></i> My Complaints</div>
          <div id="myComplaintsList" class="flex-col gap-12"></div>
        </div>
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-file-lines"></i> Latest Report</div>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom:14px;">Generate an up-to-date AI status report for your project any time.</p>
          <a href="reports.html" class="btn btn-primary btn-block"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Project Report</a>
        </div>
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

    if (Roles.ORG_WIDE.includes(user.role)) body.innerHTML = renderOrgWide(user.role);
    else if (user.role === "Department Manager") body.innerHTML = renderDeptManager();
    else if (user.role === "Engineer") body.innerHTML = renderEngineer();
    else if (user.role === "Client") body.innerHTML = renderClient();
    else body.innerHTML = renderAuditor();

    document.getElementById("statsRow").innerHTML = statCardsFor(user).join("");

    if (Roles.ORG_WIDE.includes(user.role)) await fillOrgWide(user);
    else if (user.role === "Department Manager") await fillDeptManager(user);
    else if (user.role === "Engineer") await fillEngineer(user);
    else if (user.role === "Client") await fillClient(user);
    else await fillAuditor();
  }

  async function fillOrgWide(user) {
    const projects = await API.getProjects();
    const complaints = await API.getComplaints();

    // AI executive summary (heuristic narrative over current org data)
    const highRisk = projects.filter(p => p.delay_risk === "HIGH");
    const openComplaints = complaints.filter(c => c.status !== "resolved");
    const critical = complaints.filter(c => c.severity === "critical");
    document.getElementById("execSummary").querySelector("div:nth-child(2)").innerHTML =
      `${highRisk.length} project${highRisk.length===1?"":"s"} ${highRisk.length===1?"is":"are"} currently flagged HIGH delay risk` +
      (highRisk.length ? ` (notably ${highRisk.slice(0,2).map(p=>p.title).join(", ")})` : "") + `. ` +
      `${openComplaints.length} complaint${openComplaints.length===1?"":"s"} remain open, including ${critical.length} critical. ` +
      `Recommend prioritizing the highest-risk projects and clearing critical complaints first this week.`;

    charts.push(new Chart(document.getElementById("trendChart"), {
      type: "line",
      data: {
        labels: ["Feb","Mar","Apr","May","Jun","Jul"],
        datasets: [{ label: "Avg. Completion %", data: [42, 51, 58, 63, 70, 76], borderColor: "#F97316", backgroundColor: "rgba(249,115,22,0.12)", fill: true, tension: 0.4, pointRadius: 3 }],
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
    }));

    const catCounts = {};
    complaints.forEach(c => catCounts[c.category] = (catCounts[c.category]||0)+1);
    charts.push(new Chart(document.getElementById("donutChart"), {
      type: "doughnut",
      data: { labels: Object.keys(catCounts), datasets: [{ data: Object.values(catCounts), backgroundColor: ["#F97316","#3B82F6","#22C55E","#A855F7","#EAB308","#EF4444","#64748B","#FB923C"] }] },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
    }));

    document.getElementById("activeProjectsList").innerHTML = projects.filter(p => p.status === "In Progress").slice(0,4)
      .map(p => `<div class="flex items-center justify-between clickable-entity" data-entity="project" data-id="${p.id}" style="padding:10px 0; border-bottom:1px solid var(--border); cursor:pointer;">
        <div><div style="font-weight:600; font-size:13.5px;">${Utils.escapeHtml(p.title)}</div><div style="font-size:11.5px; color:var(--text-muted);">${p.region} · ${p.department}</div></div>
        ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
      </div>`).join("");
    EntityDetail.bindAuto(document.getElementById("activeProjectsList"));

    document.getElementById("activityFeed").innerHTML = MockData.auditLogs.slice(0,6).map(l => `
      <div class="activity-item">
        <div class="activity-icon"><i class="fa-solid fa-circle-info"></i></div>
        <div><div class="activity-text"><b class="clickable-entity" data-entity="member" data-id="${(MockData.getMemberByName(l.user)||{}).id||''}" style="cursor:pointer;">${Utils.escapeHtml(l.user)}</b> performed ${l.action.replace(/_/g," ").toLowerCase()}</div><div class="activity-time">${Utils.timeAgo(l.timestamp)}</div></div>
      </div>`).join("");
    EntityDetail.bindAuto(document.getElementById("activityFeed"));

    const deptTable = document.getElementById("deptTable");
    deptTable.innerHTML = `<thead><tr><th>Department</th><th>Head</th><th>Members</th><th>Projects</th><th>AI Health</th></tr></thead>
      <tbody>${MockData.departments.map(d => {
        const health = AIEngine.departmentHealth(d, MockData.projects, MockData.members, MockData.complaints);
        const color = health.score >= 80 ? "green" : health.score >= 60 ? "blue" : health.score >= 40 ? "yellow" : "red";
        return `<tr><td>${d.name}</td><td>${d.head}</td><td>${d.members}</td><td>${d.projects}</td>
        <td style="width:180px;"><div class="flex items-center gap-8">${Components.createProgressBar(health.score, color==="red"?"red":color==="yellow"?"yellow":color==="blue"?"blue":"")}<span style="font-size:11.5px; color:var(--text-muted); white-space:nowrap;">${health.score}</span></div></td></tr>`;
      }).join("")}</tbody>`;
  }

  async function fillDeptManager(user) {
    const deptProjects = MockData.projects.filter(p => p.department === user.department);
    const deptMembers = MockData.members.filter(m => m.department === user.department);
    const deptComplaints = MockData.complaints.filter(c => c.department === user.department);
    const health = AIEngine.departmentHealth(MockData.getDepartmentByName(user.department), MockData.projects, MockData.members, MockData.complaints);

    document.getElementById("execSummary").querySelector("div:nth-child(2)").innerHTML = health.summary;

    const statusCounts = { Planning: 0, "In Progress": 0, Completed: 0 };
    deptProjects.forEach(p => statusCounts[p.status] = (statusCounts[p.status]||0)+1);
    charts.push(new Chart(document.getElementById("deptProjectsChart"), {
      type: "bar",
      data: { labels: Object.keys(statusCounts), datasets: [{ label: "Projects", data: Object.values(statusCounts), backgroundColor: "#3B82F6", borderRadius: 6 }] },
      options: { plugins: { legend: { display:false } } },
    }));
    const topMembers = deptMembers.slice(0,5);
    charts.push(new Chart(document.getElementById("workloadChart"), {
      type: "bar",
      data: { labels: topMembers.map(m=>m.full_name.split(" ")[0]), datasets: [{ label: "Projects", data: topMembers.map(m=>m.projects_count), backgroundColor: "#F97316", borderRadius: 6 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } } },
    }));
    const pending = deptComplaints.filter(c => c.status !== "resolved");
    document.getElementById("deptComplaintsList").innerHTML = pending.length ? pending.slice(0,4).map(Components.createComplaintCard).join("") : Components.createEmptyState("fa-circle-check", "No open complaints in your department");
  }

  async function fillEngineer(user) {
    const myTasks = AIEngine.prioritizeTasks(MockData.tasks.filter(t => t.assignee_id === user.id && t.status !== "Done")).slice(0,5);
    document.getElementById("topTasksList").innerHTML = myTasks.length ? myTasks.map(t => `
      <div class="flex items-center justify-between" style="padding:10px 12px; background:var(--bg-input); border-radius:8px;">
        <div><div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(t.title)}</div><div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(t.project_title)} · Due ${Utils.formatDate(t.due_date)}</div></div>
        ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
      </div>`).join("") : Components.createEmptyState("fa-champagne-glasses", "No open tasks — you're all caught up!");

    document.getElementById("activityFeed").innerHTML = `
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-check"></i></div><div><div class="activity-text">Marked "Site safety inspection" complete</div><div class="activity-time">2h ago</div></div></div>
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-comment"></i></div><div><div class="activity-text">Submitted a complaint regarding material delivery</div><div class="activity-time">1d ago</div></div></div>`;
  }

  async function fillClient(user) {
    const myProjects = Roles.visibleProjects(user, MockData.projects);
    const myComplaints = Roles.visibleComplaints(user, MockData.complaints);
    const card = document.getElementById("myProjectCard");
    if (!myProjects.length) { card.innerHTML = Components.createEmptyState("fa-diagram-project", "No project linked to your account yet"); }
    else {
      const p = myProjects[0];
      card.innerHTML = `
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          <div><h3 style="font-size:16px;">${Utils.escapeHtml(p.title)}</h3><div style="font-size:12.5px; color:var(--text-muted);">${p.type} · ${p.region}</div></div>
          ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
        </div>
        ${Components.createProgressBar(p.progress, Utils.riskBadgeType(p.delay_risk)==="red"?"red":"")}
        <div class="grid" style="grid-template-columns:repeat(4,1fr); gap:8px; margin-top:14px;">
          <div><div style="font-size:11px;color:var(--text-muted);">Progress</div><div style="font-weight:600;">${p.progress}%</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Expected</div><div style="font-weight:600;">${p.expected_progress}%</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Deadline</div><div style="font-weight:600;">${Utils.formatDate(p.deadline)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Budget</div><div style="font-weight:600;">${Utils.currency(p.budget)}</div></div>
        </div>`;
    }
    document.getElementById("myComplaintsList").innerHTML = myComplaints.length
      ? myComplaints.slice(0,4).map(c => `<div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border); font-size:13px;">
          <span>${Utils.escapeHtml(c.category)}</span>${Components.createBadge(c.status === "resolved" ? "Resolved" : "Open", c.status === "resolved" ? "green" : "yellow")}
        </div>`).join("")
      : Components.createEmptyState("fa-comments", "You haven't submitted any complaints");
  }

  async function fillAuditor() {
    const anomalies = await API.getAuditAnomalies();
    document.getElementById("anomalyList").innerHTML = anomalies.slice(0,3).map(Components.createAuditCard).join("");
    EntityDetail.bindAuto(document.getElementById("anomalyList"));
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
