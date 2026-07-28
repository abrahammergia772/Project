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
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    const canAdd = Roles.ORG_WIDE.includes(user.role);
    content.innerHTML = `
      <div class="page-header">
        <div><h1>Departments</h1><div class="page-sub">${Roles.canViewAllDepartments(user.role) ? "Organizational structure & department performance" : "Your department overview"}</div></div>
        ${canAdd ? `<div class="page-header-actions"><button class="btn btn-primary" id="addDeptBtn"><i class="fa-solid fa-plus"></i> Add Department</button></div>` : ""}
      </div>
      <div class="members-grid" id="deptGrid"></div>`;

    visibleDepts = Roles.visibleDepartments(user, MockData.departments);
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
      const health = AIEngine.departmentHealth(d, MockData.projects, MockData.members, MockData.complaints);
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
          <div><div style="font-weight:700; font-size:17px;">${d.members ?? MockData.members.filter(m=>m.department===d.name).length}</div><div style="font-size:11px;color:var(--text-muted);">Members</div></div>
          <div><div style="font-weight:700; font-size:17px;">${d.projects ?? MockData.projects.filter(p=>p.department===d.name).length}</div><div style="font-size:11px;color:var(--text-muted);">Projects</div></div>
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
        <span style="font-size:12px; color:var(--text-muted);">Head: ${Utils.escapeHtml(detail.head)}</span>
      </div>
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
  }

  return { init };
})();
