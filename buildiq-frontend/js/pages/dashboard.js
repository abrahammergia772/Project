/* ============================================================
   BuildIQ — dashboard.js  (role-aware dashboard for all 6 roles)
   ============================================================ */

const DashboardPage = (() => {

  let charts = [];
  function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

  function statCardsFor(user) {
    const role = user.role;
    const s = DataStore.stats || {};
    if (role === "Super Admin" || role === "General Manager") {
      return [
        Components.createStatCard("Active Projects", s.active_projects, 8, "accent", "fa-diagram-project", { href: "projects.html?status=In+Progress", hint: "View projects" }),
        Components.createStatCard("Total Members", s.total_members, 4, "blue", "fa-users", { href: "members.html", hint: "View members" }),
        Components.createStatCard("High Risk Projects", s.high_risk, -12, "red", "fa-triangle-exclamation", { href: "projects.html?risk=HIGH", hint: "Review risks" }),
        Components.createStatCard("Open Complaints", s.open_complaints, 3, "yellow", "fa-comments", { href: "complaints.html?status=pending", hint: "Triage now" }),
        role === "Super Admin"
          ? Components.createStatCard("Audit Flags", s.audit_flags, -5, "purple", "fa-shield-halved", { href: "audit.html", hint: "Investigate" })
          : Components.createStatCard("Departments", DataStore.departments.length, null, "cyan", "fa-building", { href: "departments.html", hint: "View departments" }),
      ];
    }
    if (role === "Department Manager") {
      const deptProjects = DataStore.projects.filter(p => p.department === user.department);
      const deptComplaints = DataStore.complaints.filter(c => c.department === user.department);
      const deptMembers = DataStore.members.filter(m => m.department === user.department);
      return [
        Components.createStatCard("Dept. Projects", deptProjects.length, null, "accent", "fa-diagram-project", { href: "projects.html", hint: "View projects" }),
        Components.createStatCard("Team Members", deptMembers.length, null, "blue", "fa-users", { href: "members.html", hint: "View team" }),
        Components.createStatCard("Open Complaints", deptComplaints.filter(c=>c.status!=="resolved").length, null, "yellow", "fa-comments", { href: "complaints.html?status=pending", hint: "Resolve" }),
        Components.createStatCard("High Risk", deptProjects.filter(p=>p.delay_risk==="HIGH").length, null, "red", "fa-triangle-exclamation", { href: "projects.html?risk=HIGH", hint: "Review risks" }),
      ];
    }
    if (role === "Project Manager") {
      const mine = Roles.managedProjects(user, DataStore.projects);
      const team = Roles.managedTeam(user, DataStore.projects);
      const ids = new Set(mine.map(p => p.id));
      const openTasks = DataStore.tasks.filter(t => ids.has(t.project_id) && t.status !== "Done");
      const overdue = openTasks.filter(t => new Date(t.due_date) < new Date()).length;
      const avgProgress = mine.length ? Math.round(mine.reduce((s, p) => s + p.progress, 0) / mine.length) : 0;
      const spend = mine.reduce((s, p) => s + (p.materials_total_cost || 0), 0);
      return [
        Components.createStatCard("My Projects", mine.length, null, "accent", "fa-diagram-project", { href: "projects.html", hint: "View projects" }),
        Components.createStatCard("Avg. Progress", `${avgProgress}%`, null, "blue", "fa-chart-line", { href: "projects.html", hint: "See progress" }),
        Components.createStatCard("At Risk", mine.filter(p => p.delay_risk === "HIGH").length, null, "red", "fa-triangle-exclamation", { href: "projects.html?risk=HIGH", hint: "Review risks" }),
        Components.createStatCard("Team Size", team.length, null, "cyan", "fa-users", { href: "members.html", hint: "View team" }),
        Components.createStatCard("Overdue Tasks", overdue, null, "yellow", "fa-clock", { href: "tasks.html", hint: "Open tasks" }),
        Components.createStatCard("Materials Spend", Utils.currency(spend), null, "purple", "fa-boxes-stacked", { href: "projects.html", hint: "View costs" }),
      ];
    }
    if (role === "Engineer") {
      const myTasks = DataStore.tasks.filter(t => t.assignee_id === user.id);
      const overdue = myTasks.filter(t => t.status !== "Done" && new Date(t.due_date) < new Date()).length;
      return [
        Components.createStatCard("Open Tasks", myTasks.filter(t=>t.status!=="Done").length, null, "accent", "fa-list-check", { href: "tasks.html", hint: "Open tasks" }),
        Components.createStatCard("My Projects", Roles.visibleProjects(user, DataStore.projects).length, null, "blue", "fa-diagram-project", { href: "projects.html", hint: "View projects" }),
        Components.createStatCard("Overdue", overdue, null, "red", "fa-clock", { href: "tasks.html", hint: "Catch up" }),
      ];
    }
    if (role === "Client") {
      const myProjects = Roles.visibleProjects(user, DataStore.projects);
      const myComplaints = Roles.visibleComplaints(user, DataStore.complaints);
      return [
        Components.createStatCard("My Projects", myProjects.length, null, "accent", "fa-diagram-project", { href: "projects.html", hint: "View projects" }),
        Components.createStatCard("Avg. Progress", myProjects.length ? Math.round(myProjects.reduce((s,p)=>s+p.progress,0)/myProjects.length) + "%" : "—", null, "blue", "fa-chart-line", { href: "projects.html", hint: "See progress" }),
        Components.createStatCard("My Complaints", myComplaints.length, null, "yellow", "fa-comments", { href: "complaints.html", hint: "Track complaints" }),
      ];
    }
    // Auditor
    return [
      Components.createStatCard("Flagged Today", s.audit_flags, 12, "red", "fa-triangle-exclamation", { href: "audit.html", hint: "Investigate" }),
      Components.createStatCard("Under Review", Math.round(s.audit_flags*1.6), null, "yellow", "fa-magnifying-glass", { href: "audit.html", hint: "Review queue" }),
      Components.createStatCard("Cleared", 128, null, "green", "fa-circle-check", { href: "audit.html", hint: "View log" }),
      Components.createStatCard("AI Accuracy", "94%", null, "purple", "fa-brain", { href: "audit.html", hint: "Model stats" }),
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

  function renderProjectManager() {
    return `
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(3,1fr);"></div>
      ${aiExecSummaryBox("execSummary")}
      <div class="card" style="margin-bottom:20px;">
        <div class="flex items-center justify-between" style="margin-bottom:14px;">
          <div class="section-title" style="margin-bottom:0;"><i class="fa-solid fa-diagram-project"></i> Projects I Manage</div>
          <a href="projects.html" class="btn btn-outline btn-sm">Open Projects</a>
        </div>
        <div id="pmProjectsList" class="flex-col gap-12"></div>
      </div>
      <div class="charts-row">
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-chart-column"></i> Progress vs Expected</div>
          <canvas id="pmProgressChart"></canvas>
        </div>
        <div class="card chart-card">
          <div class="section-title"><i class="fa-solid fa-users"></i> Team Workload</div>
          <canvas id="pmWorkloadChart"></canvas>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr; gap:16px;">
        <div class="card">
          <div class="flex items-center justify-between" style="margin-bottom:14px;">
            <div class="section-title" style="margin-bottom:0;"><i class="fa-solid fa-ranking-star"></i> Urgent Team Tasks</div>
            <a href="tasks.html" class="btn btn-outline btn-sm">Assign</a>
          </div>
          <div id="pmTasksList" class="flex-col gap-8"></div>
        </div>
        <div class="card">
          <div class="section-title"><i class="fa-solid fa-comments"></i> Complaints on My Projects</div>
          <div id="pmComplaintsList" class="flex-col gap-12"></div>
        </div>
      </div>`;
  }

  async function fillProjectManager(user) {
    const mine = Roles.managedProjects(user, DataStore.projects);
    const team = Roles.managedTeam(user, DataStore.projects);
    const ids = new Set(mine.map(p => p.id));

    // AI summary scoped to this PM's portfolio
    const atRisk = mine.filter(p => p.delay_risk === "HIGH");
    const behind = mine.filter(p => p.progress < p.expected_progress);
    const openComplaints = Roles.visibleComplaints(user, DataStore.complaints, DataStore.projects)
      .filter(c => c.status !== "resolved");
    document.getElementById("execSummary").querySelector("div:nth-child(2)").innerHTML =
      `You manage ${mine.length} project${mine.length === 1 ? "" : "s"} with ${team.length} people. ` +
      (atRisk.length
        ? `${atRisk.length} ${atRisk.length === 1 ? "is" : "are"} flagged HIGH risk (${atRisk.slice(0, 2).map(p => Utils.escapeHtml(p.title)).join(", ")}). `
        : `None are flagged HIGH risk. `) +
      (behind.length ? `${behind.length} trailing the planned schedule. ` : "") +
      `${openComplaints.length} open complaint${openComplaints.length === 1 ? "" : "s"} on your projects. ` +
      (atRisk.length || behind.length
        ? "Recommend re-sequencing critical-path tasks and confirming material deliveries this week."
        : "Delivery is tracking to plan — keep the current cadence.");

    // Project list
    document.getElementById("pmProjectsList").innerHTML = mine.length ? mine.map(p => `
      <div class="card clickable-entity" data-entity="project" data-id="${p.id}" style="padding:14px; cursor:pointer;">
        <div class="flex items-center justify-between" style="margin-bottom:8px;">
          <b style="font-size:13.5px;">${Utils.escapeHtml(p.title)}</b>
          ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">${Utils.escapeHtml(p.department || "—")} · ${(p.team || []).length} on team · ${Utils.currency(p.budget)}</div>
        ${Components.createProgressBar(p.progress, Utils.riskBadgeType(p.delay_risk) === "red" ? "red" : "")}
        <div class="flex items-center justify-between" style="margin-top:8px; font-size:12px; color:var(--text-muted);">
          <span>${p.progress}% complete (expected ${p.expected_progress}%)</span>
          <span>Due ${Utils.formatDate(p.deadline)}</span>
        </div>
      </div>`).join("") : Components.createEmptyState("fa-diagram-project", "You don't manage any projects yet");
    EntityDetail.bindAuto(document.getElementById("pmProjectsList"));

    // Progress vs expected
    if (mine.length) {
      charts.push(new Chart(document.getElementById("pmProgressChart"), {
        type: "bar",
        data: {
          labels: mine.map(p => p.title.length > 16 ? p.title.slice(0, 15) + "…" : p.title),
          datasets: [
            { label: "Actual", data: mine.map(p => p.progress), backgroundColor: "#F97316", borderRadius: 6 },
            { label: "Expected", data: mine.map(p => p.expected_progress), backgroundColor: "rgba(100,116,139,0.45)", borderRadius: 6 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
      }));

      const workload = team.slice(0, 6).map(m => ({
        name: m.full_name.split(" ")[0],
        count: DataStore.tasks.filter(t => t.assignee_id === m.id && t.status !== "Done").length,
      })).sort((a, b) => b.count - a.count);
      charts.push(new Chart(document.getElementById("pmWorkloadChart"), {
        type: "bar",
        data: { labels: workload.map(w => w.name), datasets: [{ data: workload.map(w => w.count), backgroundColor: "#3B82F6", borderRadius: 6 }] },
        options: { indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
      }));
    }

    // Urgent tasks across the portfolio
    const urgent = AIEngine.prioritizeTasks(
      DataStore.tasks.filter(t => ids.has(t.project_id) && t.status !== "Done")).slice(0, 5);
    document.getElementById("pmTasksList").innerHTML = urgent.length ? urgent.map(t => `
      <a class="dash-row" href="tasks.html" aria-label="Open task: ${Utils.escapeHtml(t.title)}">
        ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:600;">${Utils.escapeHtml(t.title)}</div>
          <div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(t.assignee_name || "Unassigned")} · due ${Utils.formatDate(t.due_date)}</div>
        </div>
        <i class="fa-solid fa-chevron-right dash-row-go"></i>
      </div>`).join("") : Components.createEmptyState("fa-check", "No open tasks on your projects");

    // Complaints raised against these projects
    document.getElementById("pmComplaintsList").innerHTML = openComplaints.length
      ? openComplaints.slice(0, 5).map(c => `
        <a class="dash-row" href="complaints.html" aria-label="Open complaint ${Utils.escapeHtml(c.id)}">
          <div style="min-width:0; flex:1;">
            <b>${Utils.escapeHtml(c.id)}</b> — ${Utils.escapeHtml(c.category)}
            <div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(c.project || "")}</div>
          </div>
          ${Components.createBadge(c.severity, Utils.severityColor(c.severity))}
          <i class="fa-solid fa-chevron-right dash-row-go"></i>
        </a>`).join("")
      : Components.createEmptyState("fa-face-smile", "No open complaints on your projects");
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

    // Pull the real collections before rendering. Previously these numbers
    // came from MockData regardless of MOCK_MODE, so a live deployment showed
    // fabricated counts on every card.
    await DataStore.load(["stats", "projects", "members", "departments",
                          "tasks", "complaints", "auditLogs"]);
    chartDefaults();
    const body = document.getElementById("dashBody");

    if (Roles.ORG_WIDE.includes(user.role)) body.innerHTML = renderOrgWide(user.role);
    else if (user.role === "Department Manager") body.innerHTML = renderDeptManager();
    else if (user.role === Roles.PROJECT_MANAGER) body.innerHTML = renderProjectManager();
    else if (user.role === "Engineer") body.innerHTML = renderEngineer();
    else if (user.role === "Client") body.innerHTML = renderClient();
    else body.innerHTML = renderAuditor();

    document.getElementById("statsRow").innerHTML = statCardsFor(user).join("");

    if (Roles.ORG_WIDE.includes(user.role)) await fillOrgWide(user);
    else if (user.role === "Department Manager") await fillDeptManager(user);
    else if (user.role === Roles.PROJECT_MANAGER) await fillProjectManager(user);
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

    document.getElementById("activityFeed").innerHTML = DataStore.auditLogs.slice(0,6).map(l => `
      <div class="activity-item">
        <div class="activity-icon"><i class="fa-solid fa-circle-info"></i></div>
        <div><div class="activity-text"><b class="clickable-entity" data-entity="member" data-id="${(DataStore.getMemberByName(l.user)||{}).id||''}" style="cursor:pointer;">${Utils.escapeHtml(l.user)}</b> performed ${l.action.replace(/_/g," ").toLowerCase()}</div><div class="activity-time">${Utils.timeAgo(l.timestamp)}</div></div>
      </div>`).join("");
    EntityDetail.bindAuto(document.getElementById("activityFeed"));

    const deptTable = document.getElementById("deptTable");
    deptTable.innerHTML = `<thead><tr><th>Department</th><th>Head</th><th>Members</th><th>Projects</th><th>AI Health</th></tr></thead>
      <tbody>${DataStore.departments.map(d => {
        const health = AIEngine.departmentHealth(d, DataStore.projects, DataStore.members, DataStore.complaints);
        const color = health.score >= 80 ? "green" : health.score >= 60 ? "blue" : health.score >= 40 ? "yellow" : "red";
        return `<tr><td>${d.name}</td><td>${d.head}</td><td>${d.members}</td><td>${d.projects}</td>
        <td style="width:180px;"><div class="flex items-center gap-8">${Components.createProgressBar(health.score, color==="red"?"red":color==="yellow"?"yellow":color==="blue"?"blue":"")}<span style="font-size:11.5px; color:var(--text-muted); white-space:nowrap;">${health.score}</span></div></td></tr>`;
      }).join("")}</tbody>`;
  }

  async function fillDeptManager(user) {
    const deptProjects = DataStore.projects.filter(p => p.department === user.department);
    const deptMembers = DataStore.members.filter(m => m.department === user.department);
    const deptComplaints = DataStore.complaints.filter(c => c.department === user.department);
    const health = AIEngine.departmentHealth(DataStore.getDepartmentByName(user.department), DataStore.projects, DataStore.members, DataStore.complaints);

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
    const myTasks = AIEngine.prioritizeTasks(DataStore.tasks.filter(t => t.assignee_id === user.id && t.status !== "Done")).slice(0,5);
    document.getElementById("topTasksList").innerHTML = myTasks.length ? myTasks.map(t => `
      <a class="dash-row boxed" href="tasks.html" aria-label="Open task: ${Utils.escapeHtml(t.title)}">
        <div style="flex:1; min-width:0;"><div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(t.title)}</div><div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(t.project_title)} · Due ${Utils.formatDate(t.due_date)}</div></div>
        ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
        <i class="fa-solid fa-chevron-right dash-row-go"></i>
      </a>`).join("") : Components.createEmptyState("fa-champagne-glasses", "No open tasks — you're all caught up!");

    document.getElementById("activityFeed").innerHTML = `
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-check"></i></div><div><div class="activity-text">Marked "Site safety inspection" complete</div><div class="activity-time">2h ago</div></div></div>
      <div class="activity-item"><div class="activity-icon"><i class="fa-solid fa-comment"></i></div><div><div class="activity-text">Submitted a complaint regarding material delivery</div><div class="activity-time">1d ago</div></div></div>`;
  }

  async function fillClient(user) {
    const myProjects = Roles.visibleProjects(user, DataStore.projects);
    const myComplaints = Roles.visibleComplaints(user, DataStore.complaints);
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
    DataStore.auditLogs.forEach(l => { buckets[Math.min(4, Math.floor(l.anomaly_score*5))]++; });
    charts.push(new Chart(document.getElementById("riskDistChart"), {
      type: "bar",
      data: { labels: ["0-20","20-40","40-60","60-80","80-100"], datasets: [{ label: "Logs", data: buckets, backgroundColor: ["#22C55E","#22C55E","#EAB308","#EF4444","#EF4444"], borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } } },
    }));
  }

  return { init };
})();
