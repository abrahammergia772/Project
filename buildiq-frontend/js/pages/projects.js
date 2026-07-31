/* ============================================================
   BuildIQ — projects.js  (A.9)
   ============================================================ */

const ProjectsPage = (() => {
  let allProjects = [];
  let viewMode = localStorage.getItem("buildiq_projects_view") || "cards";

  function subtitle(user) {
    if (Roles.hasFullProjectAccess(user.role)) {
      return user.role === "Auditor"
        ? "Read-only view of every project in the organization"
        : "Track progress, risk, and delivery across all sites";
    }
    if (user.role === "Client") return "Status of your project(s)";
    if (user.role === "Department Manager") return `Projects in ${user.department}, plus any you manage`;
    return "Projects you are assigned to or manage";
  }

  function shell() {
    const user = Auth.getUser();
    // Only Super Admin and General Manager may create projects.
    const canCreate = Roles.canCreateProject(user);
    return `
      <div class="page-header">
        <div><h1>Projects <span class="text-muted" id="projCount" style="font-size:16px;"></span></h1><div class="page-sub">${Utils.escapeHtml(subtitle(user))}</div></div>
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
    // Load real server data before rendering.
    await DataStore.load(["projects","members","departments","clients","tasks"]);
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    content.innerHTML += `<div id="loadingGrid" class="projects-grid">${Components.skeletonGrid(6)}</div>`;

    const regionSelect = document.getElementById("pRegion");
    [...new Set(DataStore.projects.map(p => p.region))].forEach(r => regionSelect.innerHTML += `<option>${r}</option>`);

    const raw = await API.getProjects();
    allProjects = Roles.visibleProjects(user, raw);
    document.getElementById("loadingGrid")?.remove();
    document.getElementById("projCount").textContent = `(${allProjects.length})`;

    ["cardBtn","tableBtn","ganttBtn"].forEach(id => document.getElementById(id).classList.toggle("active", ({cardBtn:"cards",tableBtn:"table",ganttBtn:"gantt"})[id] === viewMode));

    // Honour deep-links from the dashboard (e.g. projects.html?risk=HIGH)
    const params = new URLSearchParams(location.search);
    const preset = { pRisk: params.get("risk"), pStatus: params.get("status"),
                     pType: params.get("type"), pSearch: params.get("q") };
    let hasPreset = false;
    Object.entries(preset).forEach(([id, val]) => {
      if (!val) return;
      const el = document.getElementById(id);
      if (el) { el.value = val; hasPreset = true; }
    });

    if (hasPreset) applyFilters(); else render(allProjects);

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
      const canManage = Roles.canAssignProjectManager(Auth.getUser());
      container.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Project</th><th>Manager</th><th>Department</th><th>Progress</th><th>Risk</th><th>Deadline</th><th>Budget</th><th></th></tr></thead>
        <tbody>${list.map(p => `<tr>
          <td><span class="clickable-entity" data-entity="project" data-id="${p.id}" style="cursor:pointer; font-weight:600;">${Utils.escapeHtml(p.title)}</span>
              <div style="font-size:11.5px;color:var(--text-muted);">${Utils.escapeHtml(p.type)} · ${Utils.escapeHtml(p.region)}</div></td>
          <td>${p.manager_name
            ? `<span class="clickable-entity flex items-center gap-8" data-entity="member" data-id="${p.manager_id || ""}" style="cursor:pointer;">${Components.createAvatar(p.manager_name, "sm")}<span>${Utils.escapeHtml(p.manager_name)}</span></span>`
            : Components.createBadge("Unassigned", "yellow")}</td>
          <td>${Utils.escapeHtml(p.department || "—")}</td>
          <td style="width:140px;">${Components.createProgressBar(p.progress, Utils.riskBadgeType(p.delay_risk) === "red" ? "red" : "")}</td>
          <td>${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</td>
          <td>${Utils.formatDate(p.deadline)}</td><td>${Utils.currency(p.budget)}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm view-project-btn" data-id="${p.id}" title="View"><i class="fa-solid fa-eye"></i></button>
            ${canManage ? `<button class="btn btn-ghost btn-sm change-manager-btn" data-id="${p.id}" title="Change manager"><i class="fa-solid fa-user-tie"></i></button>` : ""}
          </td>
        </tr>`).join("")}</tbody></table></div>`;
    } else {
      container.innerHTML = renderGantt(list);
    }

    Utils.qsa(".view-project-btn").forEach(b => b.addEventListener("click", () => openProjectDetail(b.dataset.id)));
    Utils.qsa(".change-manager-btn").forEach(b => b.addEventListener("click", () => openChangeManagerModal(b.dataset.id)));
    Utils.qsa(".analyze-project-btn").forEach(b => b.addEventListener("click", () => runAnalyze(b.dataset.id)));
    Utils.qsa(".gantt-bar").forEach(b => b.addEventListener("click", () => openProjectDetail(b.dataset.id)));
    EntityDetail.bindAuto(container);
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

  // Delegates to the shared EntityDetail system (#3) so "view project" behaves the
  // same everywhere in the app — including materials, team, and AI risk analysis tabs.
  function openProjectDetail(id) {
    EntityDetail.openProject(id);
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

  // ---------------- New project (Super Admin / General Manager) ----------------
  // Everything is typed rather than picked from a fixed list: departments,
  // engineers, the client and the project manager can all be created inline
  // without leaving the form.
  function openNewProjectModal() {
    Components.createModal({
      title: "New Project",
      bodyHtml: `
        <div class="tabs" style="margin-bottom:18px;">
          <div class="tab active" data-tab="basic">Basic Info</div>
          <div class="tab" data-tab="dept">Department</div>
          <div class="tab" data-tab="people">Manager &amp; Team</div>
        </div>

        <!-- ---------- Basic ---------- -->
        <div class="tab-panel" data-panel="basic">
          <div class="field"><label for="npTitle">Project Name <span class="req">*</span></label>
            <input class="input" id="npTitle" placeholder="Type a project name..." autocomplete="off"></div>
          <div class="field"><label for="npType">Type</label>
            <input class="input" id="npType" list="npTypeList" placeholder="Type or pick a type..." value="Residential" autocomplete="off">
            <datalist id="npTypeList">${["Residential","Commercial","Infrastructure","Industrial","Renovation"].map(t=>`<option value="${t}">`).join("")}</datalist></div>
          <div class="field"><label for="npRegion">Region</label>
            <input class="input" id="npRegion" list="npRegionList" placeholder="Type a region..." autocomplete="off">
            <datalist id="npRegionList">${[...new Set(DataStore.projects.map(p=>p.region))].filter(Boolean).map(r=>`<option value="${Utils.escapeHtml(r)}">`).join("")}</datalist></div>

          <div class="field"><label for="npClient">Client <span class="hint-inline">type a new name to create one</span></label>
            <input class="input" id="npClient" list="npClientList" placeholder="Type a client company..." autocomplete="off">
            <datalist id="npClientList">${DataStore.clients.map(c=>`<option value="${Utils.escapeHtml(c.company)}">`).join("")}</datalist>
            <div class="field-hint hidden" id="npClientNew"><i class="fa-solid fa-plus"></i> <span></span></div></div>

          <div class="two-col">
            <div class="field"><label for="npBudget">Budget (USD)</label>
              <input class="input" type="number" min="0" id="npBudget" placeholder="e.g. 500000"></div>
            <div class="field"><label for="npDeadline">Deadline</label>
              <input class="input" type="date" id="npDeadline"></div>
          </div>
          <div class="field"><label for="npDescription">Description</label>
            <textarea class="input" id="npDescription" rows="2" placeholder="Type a short description..."></textarea></div>
        </div>

        <!-- ---------- Department ---------- -->
        <div class="tab-panel hidden" data-panel="dept">
          <div class="field"><label for="npDept">Owning Department <span class="hint-inline">type a new name to create one</span></label>
            <input class="input" id="npDept" list="npDeptList" placeholder="Type a department..." autocomplete="off">
            <datalist id="npDeptList">${DataStore.departments.map(d=>`<option value="${Utils.escapeHtml(d.name)}">`).join("")}</datalist></div>

          <div class="inline-create hidden" id="npDeptCreate">
            <div class="inline-create-head"><i class="fa-solid fa-building-circle-arrow-right"></i> Create department <b id="npDeptName"></b></div>
            <div class="field"><label for="npDeptHead">Department Head</label>
              <input class="input" id="npDeptHead" list="npHeadList" placeholder="Type a person's name..." autocomplete="off">
              <datalist id="npHeadList">${DataStore.members.filter(m=>m.role!=="Client").map(m=>`<option value="${Utils.escapeHtml(m.full_name)}">`).join("")}</datalist>
              <div class="field-hint"><i class="fa-solid fa-circle-info"></i> Unknown name? They'll be created as the department's manager.</div></div>
            <div class="two-col">
              <div class="field"><label for="npDeptBudget">Budget (USD)</label><input class="input" type="number" min="0" id="npDeptBudget" placeholder="e.g. 800000"></div>
              <div class="field"><label for="npDeptScope">Scope (comma separated)</label><input class="input" id="npDeptScope" placeholder="e.g. Site works, Inspection"></div>
            </div>
          </div>

          <div class="section-title" style="margin-top:18px;"><i class="fa-solid fa-user-plus"></i> Add engineers to this department</div>
          <div class="add-person-row">
            <input class="input" id="npEngName" placeholder="Type engineer's full name..." autocomplete="off">
            <input class="input" id="npEngTitle" placeholder="Job title" autocomplete="off">
            <input class="input" type="number" min="0" max="50" id="npEngExp" placeholder="Yrs">
            <button type="button" class="btn btn-secondary btn-sm" id="npAddEngBtn"><i class="fa-solid fa-plus"></i> Add</button>
          </div>
          <div id="npNewEngineers" class="chip-list"></div>

          <div class="section-title" style="margin-top:16px;"><i class="fa-solid fa-users"></i> Existing engineers in this department</div>
          <div class="member-picker" id="npTeamPicker"></div>
        </div>

        <!-- ---------- Manager & team ---------- -->
        <div class="tab-panel hidden" data-panel="people">
          <div class="field"><label for="npManager">Project Manager <span class="req">*</span> <span class="hint-inline">type a new name to create one</span></label>
            <input class="input" id="npManager" list="npManagerList" placeholder="Type the manager's name..." autocomplete="off">
            <datalist id="npManagerList"></datalist>
            <div class="field-hint hidden" id="npManagerNew"><i class="fa-solid fa-plus"></i> <span></span></div>
            <div class="field-hint"><i class="fa-solid fa-user-tie"></i> Every project needs one accountable manager. They're added to the team automatically.</div>
          </div>
          <div class="two-col">
            <div class="field"><label for="npMgrPhone">Manager phone <span class="hint-inline">new managers only</span></label>
              <input class="input" id="npMgrPhone" placeholder="+251 9XX XXX XXX" autocomplete="off"></div>
            <div class="field"><label for="npMgrExp">Manager experience (yrs)</label>
              <input class="input" type="number" min="0" max="50" id="npMgrExp" placeholder="e.g. 8"></div>
          </div>
          <div class="summary-box" id="npSummary"></div>
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="createProjBtn"><i class="fa-solid fa-check"></i> Create Project</button>`,
    });

    const overlay = Utils.qs(".modal-overlay");
    const $ = (sel) => overlay.querySelector(sel);
    const newEngineers = []; // engineers typed in but not yet persisted

    Utils.qsa(".tab", overlay).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", overlay).forEach(t => t.classList.remove("active")); tab.classList.add("active");
      Utils.qsa(".tab-panel", overlay).forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
      if (tab.dataset.tab === "people") renderSummary();
    }));

    const findDept = (name) => DataStore.departments.find(d => d.name.toLowerCase() === String(name||"").trim().toLowerCase());
    const findMember = (name) => DataStore.members.find(m => m.full_name.toLowerCase() === String(name||"").trim().toLowerCase());
    const findClient = (name) => DataStore.clients.find(c => c.company.toLowerCase() === String(name||"").trim().toLowerCase());

    // --- Client: flag when the typed name will create a new record
    $("#npClient").addEventListener("input", () => {
      const v = $("#npClient").value.trim();
      const box = $("#npClientNew");
      if (v && !findClient(v)) {
        box.classList.remove("hidden");
        box.querySelector("span").textContent = `"${v}" will be created as a new client.`;
      } else box.classList.add("hidden");
    });

    // --- Department: reveal the inline-create panel for unknown names
    function refreshDeptState() {
      const v = $("#npDept").value.trim();
      const existing = findDept(v);
      const createBox = $("#npDeptCreate");
      if (v && !existing) {
        createBox.classList.remove("hidden");
        $("#npDeptName").textContent = `"${v}"`;
      } else createBox.classList.add("hidden");
      refreshTeamPicker(existing ? existing.name : null);
      refreshManagerList(v);
    }
    function refreshTeamPicker(deptName) {
      const picker = $("#npTeamPicker");
      if (!deptName) { picker.innerHTML = `<div class="picker-empty">Choose or create a department first.</div>`; return; }
      const engineers = DataStore.members.filter(m => m.department === deptName && m.status === "Active" && m.role !== "Client");
      picker.innerHTML = engineers.length ? engineers.map(e => `
        <label class="member-pick">
          <input type="checkbox" value="${e.id}">
          ${Components.createAvatar(e.full_name, "sm", e.avatar_color)}
          <span><b>${Utils.escapeHtml(e.full_name)}</b><small>${Utils.escapeHtml(e.job_title || e.role)} · ${e.experience_years}y</small></span>
        </label>`).join("") : `<div class="picker-empty">No one in ${Utils.escapeHtml(deptName)} yet — add engineers above.</div>`;
    }
    function refreshManagerList(deptName) {
      const dept = findDept(deptName);
      const pool = Roles.eligibleProjectManagers(DataStore.members, dept ? dept.name : null);
      const fallback = pool.length ? pool : Roles.eligibleProjectManagers(DataStore.members);
      $("#npManagerList").innerHTML = [
        ...fallback.map(m => `<option value="${Utils.escapeHtml(m.full_name)}">`),
        ...newEngineers.map(e => `<option value="${Utils.escapeHtml(e.full_name)}">`),
      ].join("");
    }
    $("#npDept").addEventListener("input", refreshDeptState);
    $("#npDept").addEventListener("change", refreshDeptState);
    refreshDeptState();

    // --- Add engineers by typing
    $("#npAddEngBtn").addEventListener("click", () => {
      const name = $("#npEngName").value.trim();
      if (!name) { Components.createToast("Type the engineer's name first.", "error"); return; }
      if (findMember(name) || newEngineers.some(e => e.full_name.toLowerCase() === name.toLowerCase())) {
        Components.createToast(`${name} is already in the system.`, "info"); return;
      }
      newEngineers.push({
        full_name: name,
        job_title: $("#npEngTitle").value.trim() || "Site Engineer",
        experience_years: Number($("#npEngExp").value) || 0,
      });
      $("#npEngName").value = ""; $("#npEngTitle").value = ""; $("#npEngExp").value = "";
      renderNewEngineers(); refreshManagerList($("#npDept").value);
    });
    function renderNewEngineers() {
      $("#npNewEngineers").innerHTML = newEngineers.map((e, i) => `
        <span class="new-chip">${Utils.escapeHtml(e.full_name)}<small>${Utils.escapeHtml(e.job_title)}</small>
          <button type="button" data-i="${i}" aria-label="Remove ${Utils.escapeHtml(e.full_name)}">&times;</button></span>`).join("");
      Utils.qsa(".new-chip button", overlay).forEach(b => b.addEventListener("click", () => {
        newEngineers.splice(Number(b.dataset.i), 1); renderNewEngineers(); refreshManagerList($("#npDept").value);
      }));
    }

    // --- Manager: flag unknown names as new
    $("#npManager").addEventListener("input", () => {
      const v = $("#npManager").value.trim();
      const box = $("#npManagerNew");
      const known = findMember(v) || newEngineers.some(e => e.full_name.toLowerCase() === v.toLowerCase());
      if (v && !known) {
        box.classList.remove("hidden");
        box.querySelector("span").textContent = `"${v}" will be created as a new Project Manager.`;
      } else box.classList.add("hidden");
    });

    function renderSummary() {
      const dept = $("#npDept").value.trim();
      const existingDept = findDept(dept);
      const picked = Utils.qsa("#npTeamPicker input:checked", overlay).length;
      const client = $("#npClient").value.trim();
      $("#npSummary").innerHTML = `
        <div class="summary-title">About to create</div>
        <ul>
          <li><b>${Utils.escapeHtml($("#npTitle").value.trim() || "Untitled project")}</b></li>
          <li>Department: ${Utils.escapeHtml(dept || "—")} ${dept && !existingDept ? `<span class="new-tag">new</span>` : ""}</li>
          <li>Client: ${Utils.escapeHtml(client || "—")} ${client && !findClient(client) ? `<span class="new-tag">new</span>` : ""}</li>
          <li>New engineers: ${newEngineers.length} · Existing selected: ${picked}</li>
        </ul>`;
    }

    // --- Submit: create dependencies first, then the project itself
    $("#createProjBtn").addEventListener("click", async () => {
      const title = $("#npTitle").value.trim();
      if (!title) { Components.createToast("Project name is required.", "error"); return; }
      const deptName = $("#npDept").value.trim();
      if (!deptName) { Components.createToast("Choose or type an owning department.", "error"); return; }
      const managerName = $("#npManager").value.trim();
      if (!managerName) { Components.createToast("A project manager is required.", "error"); return; }

      const btn = $("#createProjBtn");
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating...`;
      try {
        // 1. Department (create if the typed name is new)
        let dept = findDept(deptName);
        if (!dept) {
          let headId = null;
          const headName = $("#npDeptHead").value.trim();
          if (headName) {
            const existingHead = findMember(headName);
            headId = existingHead ? existingHead.id
              : (await API.createMemberRecord({ full_name: headName, role: "Department Manager", department: deptName, job_title: `${deptName} Manager`, experience_years: 8 })).id;
          }
          dept = await API.createDepartment({
            name: deptName, head_id: headId,
            budget: $("#npDeptBudget").value, scope: $("#npDeptScope").value,
          });
        }

        // 2. Engineers typed into the form
        for (const eng of newEngineers) {
          await API.createMemberRecord({ ...eng, role: "Engineer", department: dept.name });
        }

        // 3. Client (create if typed name is new)
        let clientId = null;
        const clientName = $("#npClient").value.trim();
        if (clientName) clientId = (await API.createClientRecord({ company: clientName })).id;

        // 4. Project manager (create as a Project Manager if unknown)
        let manager = findMember(managerName);
        if (!manager) {
          manager = await API.createMemberRecord({
            full_name: managerName, role: Roles.PROJECT_MANAGER, department: dept.name,
            job_title: "Project Manager", phone: $("#npMgrPhone").value.trim(),
            experience_years: Number($("#npMgrExp").value) || 5,
          });
        }

        // 5. Team = existing picks + everyone just created in this department
        const picked = Utils.qsa("#npTeamPicker input:checked", overlay).map(c => c.value);
        const createdIds = newEngineers
          .map(e => DataStore.members.find(m => m.full_name === e.full_name))
          .filter(Boolean).map(m => m.id);

        const project = await API.createProject({
          title,
          type: $("#npType").value.trim() || "Residential",
          region: $("#npRegion").value.trim(),
          department: dept.name,
          client_id: clientId,
          budget: Number($("#npBudget").value) || 0,
          deadline: $("#npDeadline").value || null,
          description: $("#npDescription").value.trim(),
          manager_id: manager.id,
          team_ids: [...new Set([...picked, ...createdIds])],
        });

        overlay.remove();
        Components.createToast(`${project.title} created — managed by ${project.manager_name}.`, "success");
        allProjects = Roles.visibleProjects(Auth.getUser(), DataStore.projects);
        document.getElementById("projCount").textContent = `(${allProjects.length})`;
        applyFilters();
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-check"></i> Create Project`;
        Components.createToast(err.message || "Could not create that project.", "error");
      }
    });
  }

  // ---------------- Change a project's manager ----------------
  function openChangeManagerModal(projectId) {
    const project = DataStore.getProjectById(projectId);
    if (!project) return;
    const candidates = Roles.eligibleProjectManagers(DataStore.members, project.department);
    const pool = candidates.length ? candidates : Roles.eligibleProjectManagers(DataStore.members);

    Components.createModal({
      title: `Project manager — ${project.title}`,
      bodyHtml: `
        <div class="field">
          <label for="cmManager">Manager</label>
          ${Components.createTypedInput({ id: "cmManager", value: project.manager_name || "", placeholder: "Type the manager's name...", allowNew: false, options: pool.map(m => ({ id: m.id, label: m.full_name, sub: `${m.role}${m.department !== project.department ? " · " + m.department : ""}` })) })}
        </div>
        <div class="field-hint"><i class="fa-solid fa-circle-info"></i> The new manager is added to the project team automatically and will be notified.</div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="saveManagerBtn"><i class="fa-solid fa-check"></i> Save</button>`,
    });

    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#saveManagerBtn").addEventListener("click", async () => {
      try {
        const pickedMgr = Components.resolveTypedValue(overlay.querySelector("#cmManager"), pool.map(m => ({ id: m.id, label: m.full_name })));
        if (!pickedMgr.option) { Components.createToast("Pick a manager from the suggestions.", "error"); return; }
        const updated = await API.setProjectManager(projectId, pickedMgr.option.id);
        overlay.remove();
        Components.createToast(`${updated.title} is now managed by ${updated.manager_name}.`, "success");
        allProjects = Roles.visibleProjects(Auth.getUser(), DataStore.projects);
        applyFilters();
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        Components.createToast(err.message || "Could not update the manager.", "error");
      }
    });
  }

  return { init };
})();
