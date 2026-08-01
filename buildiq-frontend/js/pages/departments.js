/* ============================================================
   BuildIQ — departments.js  (#4: full department detail view)
   Click a department card -> slide-in panel showing:
   scope of work, budget, AI health score, all members, and full
   project info for that department. Visibility itself is scoped
   by role via Roles.visibleDepartments().
   ============================================================ */

const DepartmentsPage = (() => {
  let visibleDepts = [];

  async function init() {
    // Load real server data before rendering.
    await DataStore.load(["departments","members","projects","complaints"]);
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    const canAdd = Roles.ORG_WIDE.includes(user.role);
    content.innerHTML = `
      <div class="page-header">
        <div><h1>Departments</h1><div class="page-sub">${Roles.canViewAllDepartments(user.role) ? "Organizational structure & department performance" : "Your department overview"}</div></div>
        ${canAdd ? `<div class="page-header-actions"><button class="btn btn-primary" id="addDeptBtn"><i class="fa-solid fa-plus"></i> Add Department</button></div>` : ""}
      </div>
      <div class="members-grid" id="deptGrid"></div>`;

    visibleDepts = Roles.visibleDepartments(user, DataStore.departments);
    render(user);

    document.getElementById("addDeptBtn")?.addEventListener("click", () => {
      Components.createToast("Department creation requires Super Admin backend access.", "info");
    });
  }

  function render(user) {
    const grid = document.getElementById("deptGrid");
    if (!visibleDepts.length) {
      grid.innerHTML = Components.createEmptyState("fa-building", "No department assigned", "Your account isn't linked to a department yet.");
      return;
    }
    grid.innerHTML = visibleDepts.map(d => {
      const health = AIEngine.departmentHealth(d, DataStore.projects, DataStore.members, DataStore.complaints);
      const healthColor = health.score >= 80 ? "green" : health.score >= 60 ? "blue" : health.score >= 40 ? "yellow" : "red";
      return `
      <div class="card card-hover dept-card" data-id="${d.id}" style="cursor:pointer;">
        <div class="flex items-center justify-between" style="margin-bottom:14px;">
          <div class="flex items-center gap-12">
            <div style="width:44px;height:44px;border-radius:10px;background:rgba(var(--accent-rgb),0.14); display:flex; align-items:center; justify-content:center; color:var(--accent); font-size:18px;"><i class="fa-solid fa-building"></i></div>
            <div><div style="font-weight:700; font-size:15px;">${d.name}</div><div style="font-size:12px;color:var(--text-muted);">Head: ${d.head}</div></div>
          </div>
          <span class="badge badge-${healthColor}">${health.status}</span>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; text-align:center; padding:10px 0; border-top:1px solid var(--border); margin-bottom:10px;">
          <div><div style="font-weight:700; font-size:17px;">${d.members ?? DataStore.members.filter(m=>m.department===d.name).length}</div><div style="font-size:11px;color:var(--text-muted);">Members</div></div>
          <div><div style="font-weight:700; font-size:17px;">${d.projects ?? DataStore.projects.filter(p=>p.department===d.name).length}</div><div style="font-size:11px;color:var(--text-muted);">Projects</div></div>
        </div>
        <div class="flex items-center justify-between" style="font-size:12px; color:var(--text-muted);">
          <span><i class="fa-solid fa-brain" style="color:var(--accent);"></i> AI health score</span><b style="color:var(--text-primary);">${health.score}/100</b>
        </div>
        ${Components.createProgressBar(health.score, healthColor === "red" ? "red" : healthColor === "yellow" ? "yellow" : healthColor === "blue" ? "blue" : "")}
      </div>`;
    }).join("");

    Utils.qsa(".dept-card").forEach(card => card.addEventListener("click", () => openDeptDetail(card.dataset.id, user)));
  }

  async function openDeptDetail(id, user) {
    const drawer = Components.createDrawer({ side: "right", title: "Loading…", bodyHtml: Components.skeletonGrid(3, "row") });
    const detail = await API.getDepartmentDetail(id);
    if (!detail) { drawer.close(); return; }

    const healthColor = detail.health.score >= 80 ? "green" : detail.health.score >= 60 ? "blue" : detail.health.score >= 40 ? "yellow" : "red";
    drawer.drawer.querySelector(".drawer-header h3").textContent = detail.name;
    drawer.body.innerHTML = `
      <div class="flex items-center justify-between" style="margin-bottom:10px;">
        <span class="badge badge-${healthColor}">${detail.health.status} · AI score ${detail.health.score}/100</span>
        <span style="font-size:12px; color:var(--text-muted);">Head: <b>${Utils.escapeHtml(detail.head || "Unassigned")}</b></span>
      </div>
      ${Roles.canAssignDepartmentHead(user) ? `
        <div class="dept-admin-actions">
          <button class="btn btn-secondary btn-sm" id="changeHeadBtn"><i class="fa-solid fa-user-tie"></i> Change Head</button>
          <button class="btn btn-secondary btn-sm" id="addEngineerBtn"><i class="fa-solid fa-user-plus"></i> Add Engineers</button>
        </div>` : ""}
      <div class="card" style="background:rgba(var(--accent-rgb),0.08); border-left:3px solid var(--accent); margin-bottom:16px;">
        <div style="font-weight:700; font-size:12.5px; color:var(--accent); margin-bottom:6px;"><i class="fa-solid fa-robot"></i> AI Department Insight</div>
        <p style="font-size:13px; color:var(--text-secondary);">${Utils.escapeHtml(detail.health.summary)}</p>
      </div>

      <div class="section-title"><i class="fa-solid fa-circle-info"></i> Overview</div>
      <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:14px;">${Utils.escapeHtml(detail.description)}</p>
      <div class="grid" style="grid-template-columns:repeat(3,1fr); text-align:center; margin-bottom:18px;">
        <div><div style="font-weight:700; font-size:17px;">${detail.members.length}</div><div style="font-size:11px;color:var(--text-muted);">Members</div></div>
        <div><div style="font-weight:700; font-size:17px;">${detail.projects.length}</div><div style="font-size:11px;color:var(--text-muted);">Projects</div></div>
        <div><div style="font-weight:700; font-size:17px;">${Utils.currency(detail.budget)}</div><div style="font-size:11px;color:var(--text-muted);">Budget</div></div>
      </div>

      <div class="section-title"><i class="fa-solid fa-list-check"></i> Scope of Work</div>
      <div class="flex gap-8" style="flex-wrap:wrap; margin-bottom:20px;">${detail.scope.map(s => Components.createBadge(s, "gray")).join("")}</div>

      <div class="tabs" id="deptTabs" style="margin-bottom:14px;">
        <div class="tab active" data-tab="members">Members (${detail.members.length})</div>
        <div class="tab" data-tab="projects">Projects (${detail.projects.length})</div>
        <div class="tab" data-tab="complaints">Complaints (${detail.complaints.length})</div>
      </div>
      <div id="deptTabContent"></div>`;

    function renderDeptTab(tab) {
      const el = drawer.body.querySelector("#deptTabContent");
      if (tab === "members") {
        el.innerHTML = detail.members.length ? detail.members.map(m => `
          <div class="flex items-center gap-12 clickable-entity" data-entity="member" data-id="${m.id}" style="padding:10px 0; border-bottom:1px solid var(--border); cursor:pointer;">
            ${Components.createAvatar(m.full_name,"sm",m.avatar_color)}
            <div style="flex:1;"><div style="font-size:13.5px; font-weight:600;">${Utils.escapeHtml(m.full_name)}</div><div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(m.job_title)}</div></div>
            ${Components.createBadge(m.role, Utils.roleColor(m.role))}
          </div>`).join("") : Components.createEmptyState("fa-users-slash", "No members in this department");
      } else if (tab === "projects") {
        el.innerHTML = detail.projects.length ? detail.projects.map(p => `
          <div class="card clickable-entity" data-entity="project" data-id="${p.id}" style="padding:14px; margin-bottom:10px; cursor:pointer;">
            <div class="flex items-center justify-between" style="margin-bottom:8px;">
              <b style="font-size:13.5px;">${Utils.escapeHtml(p.title)}</b>
              ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
            </div>
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">${p.type} · ${p.region} · Client: ${Utils.escapeHtml(p.client_name || "N/A")}</div>
            ${Components.createProgressBar(p.progress, Utils.riskBadgeType(p.delay_risk)==="red"?"red":"")}
            <div class="flex items-center justify-between" style="margin-top:8px; font-size:12px; color:var(--text-muted);">
              <span>${p.progress}% complete</span><span>${Utils.currency(p.budget)}</span>
            </div>
          </div>`).join("") : Components.createEmptyState("fa-diagram-project", "No projects in this department");
      } else {
        el.innerHTML = detail.complaints.length ? detail.complaints.map(c => `
          <div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border); font-size:13px;">
            <div><b>${c.id}</b> — ${Utils.escapeHtml(c.category)}</div>
            ${Components.createBadge(c.status === "resolved" ? "Resolved" : "Open", c.status === "resolved" ? "green" : "yellow")}
          </div>`).join("") : Components.createEmptyState("fa-comments", "No complaints for this department");
      }
      EntityDetail.bindAuto(el);
    }
    renderDeptTab("members");
    Utils.qsa(".tab", drawer.body).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", drawer.body).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderDeptTab(tab.dataset.tab);
    }));

    // Admin actions: appoint a head, move engineers in.
    drawer.body.querySelector("#changeHeadBtn")?.addEventListener("click", () => openHeadModal(detail, user, drawer));
    drawer.body.querySelector("#addEngineerBtn")?.addEventListener("click", () => openAddEngineersModal(detail, user, drawer));
  }

  // ---------------- Choose a department head (Super Admin / GM) ----------------
  function openHeadModal(detail, user, drawer) {
    const candidates = Roles.eligibleDepartmentHeads(DataStore.members, detail.name);
    Components.createModal({
      title: `Head of ${detail.name}`,
      bodyHtml: candidates.length ? `
        <div class="field">
          <label for="dhSelect">Department Head</label>
          ${Components.createTypedInput({ id: "dhSelect", value: detail.head || "", placeholder: "Type a person's name...", allowNew: false, options: candidates.map(m => ({ id: m.id, label: m.full_name, sub: `${m.role} · ${m.experience_years}y` })) })}
        </div>
        <div class="field-hint"><i class="fa-solid fa-circle-info"></i> Only active managers and senior engineers already in this department can lead it.</div>`
        : `<p style="font-size:13px;color:var(--text-muted);">There is nobody eligible in ${Utils.escapeHtml(detail.name)} yet. Add engineers to the department first.</p>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        ${candidates.length ? `<button class="btn btn-primary" id="saveHeadBtn"><i class="fa-solid fa-check"></i> Appoint</button>` : ""}`,
    });
    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#saveHeadBtn")?.addEventListener("click", async () => {
      try {
        const pickedHead = Components.resolveTypedValue(overlay.querySelector("#dhSelect"), candidates.map(m => ({ id: m.id, label: m.full_name })));
        if (!pickedHead.option) { Components.createToast("Pick a person from the suggestions.", "error"); return; }
        const updated = await API.setDepartmentHead(detail.name, pickedHead.option.id);
        overlay.remove();
        Components.createToast(`${updated.head} now heads ${detail.name}.`, "success");
        drawer.close();
        init();
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        Components.createToast(err.message || "Could not appoint that head.", "error");
      }
    });
  }

  // ---------------- Move engineers into a department ----------------
  function openAddEngineersModal(detail, user, drawer) {
    // Anyone not already in this department is a candidate.
    const candidates = DataStore.members.filter(m =>
      m.role !== "Client" && m.department !== detail.name && m.status === "Active");

    Components.createModal({
      title: `Add engineers to ${detail.name}`,
      bodyHtml: `
        <div class="input-wrap" style="margin-bottom:12px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="input" id="aeSearch" placeholder="Search people...">
        </div>
        <div class="member-picker" id="aePicker">
          ${candidates.map(m => `
            <label class="member-pick" data-name="${Utils.escapeHtml(m.full_name.toLowerCase())}">
              <input type="checkbox" value="${m.id}">
              ${Components.createAvatar(m.full_name, "sm", m.avatar_color)}
              <span><b>${Utils.escapeHtml(m.full_name)}</b><small>${Utils.escapeHtml(m.role)} · currently ${Utils.escapeHtml(m.department || "unassigned")}</small></span>
            </label>`).join("") || `<div class="picker-empty">Everyone is already in this department.</div>`}
        </div>
        <div class="field-hint" style="margin-top:12px;"><i class="fa-solid fa-circle-info"></i> Moving someone reassigns them from their current department.</div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="saveEngineersBtn"><i class="fa-solid fa-check"></i> Add Selected</button>`,
    });

    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#aeSearch").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      Utils.qsa(".member-pick", overlay).forEach(row =>
        row.classList.toggle("hidden", !!q && !row.dataset.name.includes(q)));
    });

    overlay.querySelector("#saveEngineersBtn").addEventListener("click", async () => {
      const ids = Utils.qsa("#aePicker input:checked", overlay).map(c => c.value);
      if (!ids.length) { Components.createToast("Select at least one person.", "error"); return; }
      const btn = overlay.querySelector("#saveEngineersBtn");
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding...`;
      try {
        for (const id of ids) await API.assignMemberToDepartment(id, detail.name);
        overlay.remove();
        Components.createToast(`${ids.length} member${ids.length > 1 ? "s" : ""} moved to ${detail.name}.`, "success");
        drawer.close();
        init();
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-check"></i> Add Selected`;
        Components.createToast(err.message || "Could not move those members.", "error");
      }
    });
  }

  return { init };
})();

// Published for the single-page shell: a top-level `const` creates a
// script-scope binding, NOT a window property, so SPA's window[name]
// lookup would otherwise find nothing.
if (typeof window !== "undefined") window.DepartmentsPage = DepartmentsPage;
