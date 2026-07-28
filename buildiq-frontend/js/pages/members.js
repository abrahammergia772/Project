/* ============================================================
   BuildIQ — members.js  (A.8)
   ============================================================ */

const MembersPage = (() => {
  let allMembers = [];
  let viewMode = localStorage.getItem("buildiq_members_view") || "cards";

  function shell() {
    return `
      <div class="page-header">
        <div><h1>Members <span class="text-muted" id="memberCount" style="font-size:16px;"></span></h1><div class="page-sub">Manage your organization's people</div></div>
        <div class="page-header-actions">
          <button class="btn btn-secondary" id="smartSearchBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Smart Search</button>
          <button class="btn btn-primary" id="addMemberBtn"><i class="fa-solid fa-plus"></i> Add Member</button>
        </div>
      </div>

      <div class="members-toolbar">
        <div class="input-wrap"><i class="fa-solid fa-magnifying-glass"></i><input class="input" id="searchInput" placeholder="Search members..."></div>
        <select class="input filter-select" id="deptFilter"><option value="">All Departments</option></select>
        <select class="input filter-select" id="roleFilter">
          <option value="">All Roles</option>
          <option>Super Admin</option><option>Manager</option><option>Engineer</option><option>Auditor</option>
        </select>
        <select class="input filter-select" id="statusFilter">
          <option value="">All Status</option><option>Active</option><option>On Leave</option><option>Inactive</option>
        </select>
        <div class="view-toggle">
          <button id="cardViewBtn" aria-label="Card view"><i class="fa-solid fa-table-cells-large"></i></button>
          <button id="tableViewBtn" aria-label="Table view"><i class="fa-solid fa-list"></i></button>
        </div>
      </div>

      <div id="membersContainer"></div>`;
  }

  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    content.innerHTML += `<div id="membersLoading" class="members-grid">${Components.skeletonGrid(8)}</div>`;

    const deptFilter = document.getElementById("deptFilter");
    MockData.departments.forEach(d => deptFilter.innerHTML += `<option>${d.name}</option>`);

    document.getElementById("cardViewBtn").classList.toggle("active", viewMode === "cards");
    document.getElementById("tableViewBtn").classList.toggle("active", viewMode === "table");

    await loadMembers();

    document.getElementById("addMemberBtn").addEventListener("click", openAddMemberModal);
    document.getElementById("smartSearchBtn").addEventListener("click", openSmartSearchDrawer);
    document.getElementById("cardViewBtn").addEventListener("click", () => setView("cards"));
    document.getElementById("tableViewBtn").addEventListener("click", () => setView("table"));

    const debouncedFilter = Utils.debounce(applyFilters, 250);
    document.getElementById("searchInput").addEventListener("input", debouncedFilter);
    document.getElementById("deptFilter").addEventListener("change", applyFilters);
    document.getElementById("roleFilter").addEventListener("change", applyFilters);
    document.getElementById("statusFilter").addEventListener("change", applyFilters);
  }

  async function loadMembers() {
    allMembers = await API.getMembers();
    document.getElementById("membersLoading")?.remove();
    document.getElementById("memberCount").textContent = `(${allMembers.length})`;
    render(allMembers);
  }

  function setView(mode) {
    viewMode = mode;
    localStorage.setItem("buildiq_members_view", mode);
    document.getElementById("cardViewBtn").classList.toggle("active", mode === "cards");
    document.getElementById("tableViewBtn").classList.toggle("active", mode === "table");
    applyFilters();
  }

  function applyFilters() {
    const q = document.getElementById("searchInput").value.toLowerCase();
    const dept = document.getElementById("deptFilter").value;
    const role = document.getElementById("roleFilter").value;
    const status = document.getElementById("statusFilter").value;
    let list = allMembers.filter(m =>
      (!q || m.full_name.toLowerCase().includes(q) || m.skills.join(" ").toLowerCase().includes(q)) &&
      (!dept || m.department === dept) &&
      (!role || m.role === role) &&
      (!status || m.status === status)
    );
    render(list);
  }

  function render(list) {
    const container = document.getElementById("membersContainer");
    if (!list.length) {
      container.innerHTML = Components.createEmptyState("fa-users-slash", "No members found", "Try adjusting your filters or search terms.");
      return;
    }
    if (viewMode === "cards") {
      container.innerHTML = `<div class="members-grid">${list.map(Components.createMemberCard).join("")}</div>`;
    } else {
      container.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Projects</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>${list.map(m => `
          <tr>
            <td><div class="flex items-center gap-8">${Components.createAvatar(m.full_name,"sm",m.avatar_color)}<span>${Utils.escapeHtml(m.full_name)}</span></div></td>
            <td>${Components.createBadge(m.role, Utils.roleColor(m.role))}</td>
            <td>${Utils.escapeHtml(m.department)}</td>
            <td>${m.projects_count}</td>
            <td>${Components.createBadge(m.status, m.status === "Active" ? "green" : m.status === "On Leave" ? "yellow" : "gray", true)}</td>
            <td>${Utils.formatDate(m.joined)}</td>
            <td><button class="btn btn-ghost btn-sm view-profile-btn" data-id="${m.id}"><i class="fa-solid fa-eye"></i></button></td>
          </tr>`).join("")}</tbody>
      </table></div>`;
    }
    Utils.qsa(".view-profile-btn").forEach(btn => btn.addEventListener("click", () => openProfile(btn.dataset.id)));
  }

  function openProfile(id) {
    const m = allMembers.find(x => x.id === id);
    if (!m) return;
    Components.createModal({
      title: "Member Profile",
      bodyHtml: `
        <div class="flex items-center gap-16" style="margin-bottom:18px;">
          ${Components.createAvatar(m.full_name, "xl", m.avatar_color)}
          <div>
            <div style="font-size:18px; font-weight:700;">${Utils.escapeHtml(m.full_name)}</div>
            <div style="color:var(--text-muted); font-size:13px;">${Utils.escapeHtml(m.job_title)} · ${Utils.escapeHtml(m.department)}</div>
            <div class="flex gap-8" style="margin-top:8px;">${Components.createBadge(m.role, Utils.roleColor(m.role))}${Components.createBadge(m.status, m.status==="Active"?"green":"yellow",true)}</div>
          </div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr); text-align:center; margin-bottom:16px;">
          <div><div style="font-weight:700; font-size:18px;">${m.projects_count}</div><div style="font-size:11.5px;color:var(--text-muted);">Projects</div></div>
          <div><div style="font-weight:700; font-size:18px;">${m.on_time_pct}%</div><div style="font-size:11.5px;color:var(--text-muted);">On-time</div></div>
          <div><div style="font-weight:700; font-size:18px;">${m.experience_years}y</div><div style="font-size:11.5px;color:var(--text-muted);">Experience</div></div>
        </div>
        <div class="field"><label>Skills</label><div class="flex gap-8" style="flex-wrap:wrap;">${m.skills.map(s=>Components.createBadge(s,"gray")).join("")}</div></div>
        <div class="field"><label>Email</label><div>${Utils.escapeHtml(m.email)}</div></div>
        <div class="field"><label>Phone</label><div>${Utils.escapeHtml(m.phone)}</div></div>
        <div class="field"><label>Joined</label><div>${Utils.formatDate(m.joined)}</div></div>`,
      actionsHtml: `<button class="btn btn-secondary" id="closeProfileBtn">Close</button><button class="btn btn-primary"><i class="fa-solid fa-envelope"></i> Message</button>`,
    });
    setTimeout(() => document.getElementById("closeProfileBtn")?.addEventListener("click", () => Utils.qs(".modal-overlay")?.remove()), 0);
  }

  function openSmartSearchDrawer() {
    const drawer = Components.createDrawer({
      side: "right",
      title: "AI Smart Search",
      bodyHtml: `
        <div class="field"><textarea class="input" id="smartQuery" rows="3" placeholder="Describe who you're looking for... e.g. 'experienced structural engineer available for a new project'"></textarea></div>
        <div class="smart-search-examples">
          <span class="example-chip" data-q="structural engineer with 5+ years">Structural engineer 5+ yrs</span>
          <span class="example-chip" data-q="site supervisor for safety compliance">Site safety supervisor</span>
          <span class="example-chip" data-q="cost estimation specialist">Cost estimator</span>
        </div>
        <button class="btn btn-primary btn-block" id="runSmartSearch"><i class="fa-solid fa-wand-magic-sparkles"></i> Search with AI</button>
        <div class="divider"></div>
        <div id="smartResults"></div>`,
    });
    Utils.qsa(".example-chip", drawer.body).forEach(chip => chip.addEventListener("click", () => {
      drawer.body.querySelector("#smartQuery").value = chip.dataset.q;
    }));
    drawer.body.querySelector("#runSmartSearch").addEventListener("click", async () => {
      const q = drawer.body.querySelector("#smartQuery").value.trim();
      if (!q) return;
      const resultsEl = drawer.body.querySelector("#smartResults");
      resultsEl.innerHTML = Components.skeletonGrid(3, "row");
      const results = await API.smartSearchMembers(q);
      resultsEl.innerHTML = results.map(r => `
        <div class="smart-result-item">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-8">${Components.createAvatar(r.member.full_name,"sm",r.member.avatar_color)}<b>${Utils.escapeHtml(r.member.full_name)}</b></div>
            <span class="match-score">${r.similarity_score}% match</span>
          </div>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:6px;">${Utils.escapeHtml(r.member.job_title)} · ${Utils.escapeHtml(r.member.department)}</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Matched on: ${r.member.skills.slice(0,2).join(", ")}</div>
        </div>`).join("") || Components.createEmptyState("fa-magnifying-glass", "No matches found");
    });
  }

  function openAddMemberModal() {
    Components.createModal({
      title: "Add Member",
      bodyHtml: `
        <div class="tabs" style="margin-bottom:18px;">
          <div class="tab active" data-tab="personal">Personal</div>
          <div class="tab" data-tab="organization">Organization</div>
          <div class="tab" data-tab="security">Security</div>
        </div>
        <div class="tab-panel" data-panel="personal">
          <div class="field"><label>Full Name</label><input class="input" id="nmName" placeholder="Full name"></div>
          <div class="field"><label>Email</label><input class="input" type="email" id="nmEmail" placeholder="email@company.com"></div>
          <div class="field"><label>Phone</label><input class="input" id="nmPhone" placeholder="+251 9XX XXX XXX"></div>
        </div>
        <div class="tab-panel hidden" data-panel="organization">
          <div class="field"><label>Department</label><select class="input" id="nmDept">${MockData.departments.map(d=>`<option>${d.name}</option>`).join("")}</select></div>
          <div class="field"><label>Role</label><select class="input" id="nmRole"><option>Engineer</option><option>Manager</option><option>Auditor</option><option>Super Admin</option></select></div>
          <div class="field"><label>Job Title</label><input class="input" id="nmTitle" placeholder="e.g. Site Engineer"></div>
        </div>
        <div class="tab-panel hidden" data-panel="security">
          <div class="field"><label>Temporary Password</label><input class="input" type="password" id="nmPassword" placeholder="Auto-generated if left blank"></div>
          <p style="font-size:12.5px; color:var(--text-muted);">The member will be prompted to change their password on first login.</p>
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" id="cancelAddBtn">Cancel</button><button class="btn btn-primary" id="saveAddBtn"><i class="fa-solid fa-check"></i> Add Member</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    Utils.qsa(".tab", overlay).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", overlay).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      Utils.qsa(".tab-panel", overlay).forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
    }));
    overlay.querySelector("#cancelAddBtn").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#saveAddBtn").addEventListener("click", async () => {
      const name = overlay.querySelector("#nmName").value.trim();
      if (!name) { Components.createToast("Full name is required.", "error"); return; }
      await API.createMember({
        full_name: name,
        email: overlay.querySelector("#nmEmail").value.trim(),
        department: overlay.querySelector("#nmDept").value,
        role: overlay.querySelector("#nmRole").value,
        job_title: overlay.querySelector("#nmTitle").value.trim(),
      });
      Components.createToast(`${name} added to BuildIQ.`, "success");
      overlay.remove();
      // Reflect locally in mock mode
      allMembers.unshift({ id: Utils.uid("mem"), full_name: name, email: overlay.querySelector("#nmEmail").value, role: overlay.querySelector("#nmRole").value,
        department: overlay.querySelector("#nmDept").value, job_title: overlay.querySelector("#nmTitle").value || "New Member",
        experience_years: 0, skills: [], status: "Active", projects_count: 0, on_time_pct: 100, phone: "", joined: new Date().toISOString(), avatar_color: Utils.colorFromString(name) });
      document.getElementById("memberCount").textContent = `(${allMembers.length})`;
      applyFilters();
    });
  }

  return { init };
})();
