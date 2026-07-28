/* ============================================================
   BuildIQ — projects.js  (A.9)
   ============================================================ */

const ProjectsPage = (() => {
  let allProjects = [];
  let viewMode = localStorage.getItem("buildiq_projects_view") || "cards";

  function shell() {
    const user = Auth.getUser();
    const canCreate = Roles.ORG_WIDE.includes(user.role) || user.role === "Department Manager";
    return `
      <div class="page-header">
        <div><h1>Projects <span class="text-muted" id="projCount" style="font-size:16px;"></span></h1><div class="page-sub">${user.role === "Client" ? "Status of your project(s)" : "Track progress, risk, and delivery across all sites"}</div></div>
        ${canCreate ? `<div class="page-header-actions"><button class="btn btn-primary" id="newProjectBtn"><i class="fa-solid fa-plus"></i> New Project</button></div>` : ""}
      </div>
      <div class="projects-toolbar">
        <div class="input-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="input" id="pSearch" placeholder="Search projects..."></div>
        <select class="input filter-select" id="pType"><option value="">All Types</option><option>Residential</option><option>Commercial</option><option>Infrastructure</option><option>Industrial</option><option>Renovation</option></select>
        <select class="input filter-select" id="pRegion"><option value="">All Regions</option></select>
        <select class="input filter-select" id="pRisk"><option value="">All Risk</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>
        <select class="input filter-select" id="pStatus"><option value="">All Status</option><option>Planning</option><option>In Progress</option><option>Completed</option></select>
        <div class="view-toggle">
          <button id="cardBtn" aria-label="Card view"><i class="fa-solid fa-table-cells-large"></i></button>
          <button id="tableBtn" aria-label="Table view"><i class="fa-solid fa-list"></i></button>
          <button id="ganttBtn" aria-label="Timeline view"><i class="fa-solid fa-chart-gantt"></i></button>
        </div>
      </div>
      <div id="projContainer"></div>`;
  }

  async function init() {
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    content.innerHTML += `<div id="loadingGrid" class="projects-grid">${Components.skeletonGrid(6)}</div>`;

    const regionSelect = document.getElementById("pRegion");
    [...new Set(MockData.projects.map(p => p.region))].forEach(r => regionSelect.innerHTML += `<option>${r}</option>`);

    const raw = await API.getProjects();
    allProjects = Roles.visibleProjects(user, raw);
    document.getElementById("loadingGrid")?.remove();
    document.getElementById("projCount").textContent = `(${allProjects.length})`;

    ["cardBtn","tableBtn","ganttBtn"].forEach(id => document.getElementById(id).classList.toggle("active", ({cardBtn:"cards",tableBtn:"table",ganttBtn:"gantt"})[id] === viewMode));

    render(allProjects);

    document.getElementById("newProjectBtn")?.addEventListener("click", openNewProjectModal);
    document.getElementById("cardBtn").addEventListener("click", () => setView("cards"));
    document.getElementById("tableBtn").addEventListener("click", () => setView("table"));
    document.getElementById("ganttBtn").addEventListener("click", () => setView("gantt"));

    const debounced = Utils.debounce(applyFilters, 250);
    ["pSearch","pType","pRegion","pRisk","pStatus"].forEach(id => {
      document.getElementById(id).addEventListener(id === "pSearch" ? "input" : "change", debounced);
    });
  }

  function setView(mode) {
    viewMode = mode;
    localStorage.setItem("buildiq_projects_view", mode);
    ["cardBtn","tableBtn","ganttBtn"].forEach(id => document.getElementById(id).classList.toggle("active", ({cardBtn:"cards",tableBtn:"table",ganttBtn:"gantt"})[id] === mode));
    applyFilters();
  }

  function applyFilters() {
    const q = document.getElementById("pSearch").value.toLowerCase();
    const type = document.getElementById("pType").value;
    const region = document.getElementById("pRegion").value;
    const risk = document.getElementById("pRisk").value;
    const status = document.getElementById("pStatus").value;
    const list = allProjects.filter(p =>
      (!q || p.title.toLowerCase().includes(q)) &&
      (!type || p.type === type) && (!region || p.region === region) &&
      (!risk || p.delay_risk === risk) && (!status || p.status === status));
    render(list);
  }

  function render(list) {
    const container = document.getElementById("projContainer");
    if (!list.length) { container.innerHTML = Components.createEmptyState("fa-diagram-project", "No projects found"); return; }

    if (viewMode === "cards") {
      container.innerHTML = `<div class="projects-grid">${list.map(Components.createProjectCard).join("")}</div>`;
    } else if (viewMode === "table") {
      container.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Project</th><th>Type</th><th>Region</th><th>Progress</th><th>Risk</th><th>Deadline</th><th>Budget</th><th></th></tr></thead>
        <tbody>${list.map(p => `<tr>
          <td>${Utils.escapeHtml(p.title)}</td><td>${p.type}</td><td>${p.region}</td>
          <td style="width:140px;">${Components.createProgressBar(p.progress, Utils.riskBadgeType(p.delay_risk) === "red" ? "red" : "")}</td>
          <td>${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</td>
          <td>${Utils.formatDate(p.deadline)}</td><td>${Utils.currency(p.budget)}</td>
          <td><button class="btn btn-ghost btn-sm view-project-btn" data-id="${p.id}"><i class="fa-solid fa-eye"></i></button></td>
        </tr>`).join("")}</tbody></table></div>`;
    } else {
      container.innerHTML = renderGantt(list);
    }

    Utils.qsa(".view-project-btn").forEach(b => b.addEventListener("click", () => openProjectDetail(b.dataset.id)));
    Utils.qsa(".analyze-project-btn").forEach(b => b.addEventListener("click", () => runAnalyze(b.dataset.id)));
    Utils.qsa(".gantt-bar").forEach(b => b.addEventListener("click", () => openProjectDetail(b.dataset.id)));
  }

  function renderGantt(list) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const now = new Date();
    return `
      <div class="card gantt-wrap">
        <div class="gantt-months"><div></div><div class="gantt-months-inner">${months.map(m=>`<span>${m}</span>`).join("")}</div></div>
        ${list.map(p => {
          const deadline = new Date(p.deadline);
          const startMonth = Math.max(0, deadline.getMonth() - Math.round(p.tasks_total/10));
          const span = Math.max(1, Math.min(12 - startMonth, Math.round(p.tasks_total/8)));
          const riskColor = Utils.riskBadgeType(p.delay_risk) === "red" ? "var(--red)" : Utils.riskBadgeType(p.delay_risk) === "yellow" ? "var(--yellow)" : "var(--green)";
          return `<div class="gantt-row">
            <div style="font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${Utils.escapeHtml(p.title)}">${Utils.escapeHtml(p.title)}</div>
            <div class="gantt-track">
              <div class="gantt-bar" data-id="${p.id}" title="${Utils.escapeHtml(p.title)} — ${p.progress}% — ${p.delay_risk}"
                style="left:${(startMonth/12)*100}%; width:${(span/12)*100}%; background:${riskColor};"></div>
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }

  function riskGauge(prob) {
    const deg = Math.round(prob * 360);
    const color = prob > 0.85 ? "var(--red)" : prob > 0.65 ? "var(--red)" : prob > 0.35 ? "var(--yellow)" : "var(--green)";
    return `<div class="risk-gauge-wrap"><div class="risk-gauge" style="background:conic-gradient(${color} ${deg}deg, var(--bg-input) 0);">
      <div class="risk-gauge-inner"><div style="font-size:22px; font-weight:700;">${Math.round(prob*100)}%</div><div style="font-size:10.5px; color:var(--text-muted);">delay risk</div></div>
    </div></div>`;
  }

  function openProjectDetail(id) {
    const p = allProjects.find(x => x.id === id);
    if (!p) return;
    const drawer = Components.createDrawer({
      side: "right",
      title: p.title,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:14px;">${Components.createBadge(p.type,"blue")}${Components.createBadge(p.region,"gray")}${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</div>
        <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:18px;">${Utils.escapeHtml(p.description)}</p>
        <div class="grid" style="grid-template-columns:repeat(2,1fr); margin-bottom:18px;">
          <div><div style="font-size:11.5px;color:var(--text-muted);">Budget</div><div style="font-weight:700;">${Utils.currency(p.budget)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Spent</div><div style="font-weight:700;">${Utils.currency(p.spent)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Deadline</div><div style="font-weight:700;">${Utils.formatDate(p.deadline)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Tasks</div><div style="font-weight:700;">${p.tasks_done}/${p.tasks_total}</div></div>
        </div>
        ${Components.createProgressBar(p.progress)}
        <div class="section-title" style="margin-top:20px;"><i class="fa-solid fa-users"></i> Team</div>
        <div class="flex-col gap-8" style="margin-bottom:18px;">${p.team.map(m => `<div class="flex items-center gap-8">${Components.createAvatar(m.full_name,"sm",m.avatar_color)}<span style="font-size:13px;">${Utils.escapeHtml(m.full_name)}</span>${Components.createBadge(m.role, Utils.roleColor(m.role))}</div>`).join("")}</div>
        <div class="section-title"><i class="fa-solid fa-brain"></i> AI Risk Analysis</div>
        <div id="drawerAnalysis"><button class="btn btn-primary btn-block" id="drawerAnalyzeBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Run AI Analysis</button></div>`,
    });
    drawer.body.querySelector("#drawerAnalyzeBtn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;
      const result = await API.analyzeProject(p.id);
      drawer.body.querySelector("#drawerAnalysis").innerHTML = `
        ${riskGauge(result.delay_probability)}
        <div class="flex gap-8" style="flex-wrap:wrap; justify-content:center; margin-bottom:14px;">${result.key_risk_factors.map(f => Components.createBadge(f,"gray")).join("")}</div>
        <div class="card" style="background:var(--bg-input); border-left:3px solid var(--accent);"><p style="font-size:13px; color:var(--text-secondary);">${Utils.escapeHtml(result.groq_explanation)}</p></div>`;
    });
  }

  async function runAnalyze(id) {
    Components.createToast("Running AI delay prediction...", "info");
    const result = await API.analyzeProject(id);
    Components.createModal({
      title: "AI Risk Analysis",
      bodyHtml: `${riskGauge(result.delay_probability)}
        <div class="flex gap-8" style="flex-wrap:wrap; justify-content:center; margin-bottom:14px;">${result.key_risk_factors.map(f => Components.createBadge(f,"gray")).join("")}</div>
        <div class="card" style="background:var(--bg-input); border-left:3px solid var(--accent);"><p style="font-size:13px; color:var(--text-secondary);">${Utils.escapeHtml(result.groq_explanation)}</p></div>`,
      actionsHtml: `<button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>`,
    });
  }

  function openNewProjectModal() {
    Components.createModal({
      title: "New Project",
      bodyHtml: `
        <div class="tabs" style="margin-bottom:18px;">
          <div class="tab active" data-tab="basic">Basic Info</div>
          <div class="tab" data-tab="team">Team & Timeline</div>
          <div class="tab" data-tab="ai">AI Configuration</div>
        </div>
        <div class="tab-panel" data-panel="basic">
          <div class="field"><label>Project Name</label><input class="input" id="npTitle" placeholder="e.g. Riverside Residences"></div>
          <div class="field"><label>Type</label><select class="input" id="npType"><option>Residential</option><option>Commercial</option><option>Infrastructure</option><option>Industrial</option><option>Renovation</option></select></div>
          <div class="field"><label>Region</label><input class="input" id="npRegion" placeholder="e.g. Wolaita Sodo"></div>
          <div class="field"><label>Budget (USD)</label><input class="input" type="number" id="npBudget" placeholder="500000"></div>
        </div>
        <div class="tab-panel hidden" data-panel="team">
          <div class="field"><label>Deadline</label><input class="input" type="date" id="npDeadline"></div>
          <div class="field"><label>Team Size</label><input class="input" type="number" id="npTeam" placeholder="6"></div>
        </div>
        <div class="tab-panel hidden" data-panel="ai">
          <label class="checkbox-row" style="margin-bottom:14px;"><input type="checkbox" checked id="npEnableAI"> Enable AI delay predictions for this project</label>
          <div class="field"><label>Risk Alert Threshold</label><input class="input" type="range" min="0" max="100" value="65" id="npThreshold"></div>
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="createProjBtn"><i class="fa-solid fa-check"></i> Create Project</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    Utils.qsa(".tab", overlay).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", overlay).forEach(t => t.classList.remove("active")); tab.classList.add("active");
      Utils.qsa(".tab-panel", overlay).forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
    }));
    overlay.querySelector("#createProjBtn").addEventListener("click", async () => {
      const title = overlay.querySelector("#npTitle").value.trim();
      if (!title) { Components.createToast("Project name is required.", "error"); return; }
      await API.createProject({ title, type: overlay.querySelector("#npType").value, region: overlay.querySelector("#npRegion").value, budget: Number(overlay.querySelector("#npBudget").value)||0 });
      Components.createToast(`${title} created.`, "success");
      overlay.remove();
      allProjects.unshift({ id: Utils.uid("proj"), title, type: overlay.querySelector("#npType").value, region: overlay.querySelector("#npRegion").value || "N/A",
        status: "Planning", progress: 0, expected_progress: 5, delay_risk: "LOW", budget: Number(overlay.querySelector("#npBudget").value)||0, spent: 0,
        deadline: overlay.querySelector("#npDeadline").value || new Date().toISOString(), team: [], tasks_total: 20, tasks_done: 0, delay_reasons: [], description: "Newly created project." });
      document.getElementById("projCount").textContent = `(${allProjects.length})`;
      applyFilters();
    });
  }

  return { init };
})();
