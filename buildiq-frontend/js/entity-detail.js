/* ============================================================
   BuildIQ — entity-detail.js  (#3: click any user or project, anywhere)
   A single, reusable "show detail" system so that clicking a member's
   name/avatar or a project's name opens a rich detail panel from any
   page in the app (tables, cards, spotlight search, audit logs, etc.),
   without every page having to reimplement its own modal/drawer logic.

   Usage:
     EntityDetail.openMember(memberId)
     EntityDetail.openProject(projectId)
     EntityDetail.openClient(clientId)
     EntityDetail.openDailyWorker(workerId)
     EntityDetail.bindAuto(rootEl)   // auto-wires any [data-entity] elements
   ============================================================ */

const EntityDetail = (() => {

  function openMember(id) {
    const m = MockData.getMemberById(id);
    if (!m) return;
    const myTasks = AIEngine.prioritizeTasks(MockData.tasks.filter(t => t.assignee_id === id));
    const myProjects = MockData.projects.filter(p => p.team.some(t => t.id === id) || p.department === m.department).slice(0, 5);
    const drawer = Components.createDrawer({
      side: "right",
      title: m.full_name,
      bodyHtml: `
        <div class="flex items-center gap-16" style="margin-bottom:18px;">
          ${Components.createAvatar(m.full_name, "xl", m.avatar_color)}
          <div>
            <div style="font-size:18px; font-weight:700;">${Utils.escapeHtml(m.full_name)}</div>
            <div style="color:var(--text-muted); font-size:13px;">${Utils.escapeHtml(m.job_title)} · ${Utils.escapeHtml(m.department)}</div>
            <div class="flex gap-8" style="margin-top:8px;">${Components.createBadge(m.role, Utils.roleColor(m.role))}${Components.createBadge(m.status, m.status==="Active"?"green":"yellow",true)}</div>
          </div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr); text-align:center; margin-bottom:18px;">
          <div><div style="font-weight:700; font-size:18px;">${m.projects_count}</div><div style="font-size:11.5px;color:var(--text-muted);">Projects</div></div>
          <div><div style="font-weight:700; font-size:18px;">${m.on_time_pct}%</div><div style="font-size:11.5px;color:var(--text-muted);">On-time</div></div>
          <div><div style="font-weight:700; font-size:18px;">${m.experience_years}y</div><div style="font-size:11.5px;color:var(--text-muted);">Experience</div></div>
        </div>
        <div class="field"><label>Skills</label><div class="flex gap-8" style="flex-wrap:wrap;">${(m.skills||[]).map(s=>Components.createBadge(s,"gray")).join("") || "<span style='color:var(--text-muted); font-size:12.5px;'>No skills on file</span>"}</div></div>
        <div class="field"><label>Contact</label><div style="font-size:13px;">${Utils.escapeHtml(m.email)}<br>${Utils.escapeHtml(m.phone||"—")}</div></div>
        <div class="field"><label>Joined</label><div style="font-size:13px;">${Utils.formatDate(m.joined)}</div></div>

        <div class="tabs" style="margin:18px 0 14px;">
          <div class="tab active" data-tab="tasks">Tasks (${myTasks.length})</div>
          <div class="tab" data-tab="projects">Projects (${myProjects.length})</div>
        </div>
        <div id="memberTabContent"></div>`,
    });

    function renderTab(tab) {
      const el = drawer.body.querySelector("#memberTabContent");
      if (tab === "tasks") {
        el.innerHTML = myTasks.length ? myTasks.slice(0,8).map(t => `
          <div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border); font-size:13px;">
            <div><b>${Utils.escapeHtml(t.title)}</b><div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(t.project_title)} · Due ${Utils.formatDate(t.due_date)}</div></div>
            ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
          </div>`).join("") : Components.createEmptyState("fa-list-check", "No tasks assigned");
      } else {
        el.innerHTML = myProjects.length ? myProjects.map(p => `
          <div class="flex items-center justify-between clickable-entity" data-entity="project" data-id="${p.id}" style="padding:10px 0; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer;">
            <span>${Utils.escapeHtml(p.title)}</span>${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}
          </div>`).join("") : Components.createEmptyState("fa-diagram-project", "No linked projects");
        bindAuto(el);
      }
    }
    renderTab("tasks");
    Utils.qsa(".tab", drawer.body).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", drawer.body).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTab(tab.dataset.tab);
    }));
  }

  function riskGauge(prob) {
    const deg = Math.round(prob * 360);
    const color = prob > 0.65 ? "var(--red)" : prob > 0.35 ? "var(--yellow)" : "var(--green)";
    return `<div class="risk-gauge-wrap"><div class="risk-gauge" style="background:conic-gradient(${color} ${deg}deg, var(--bg-input) 0);">
      <div class="risk-gauge-inner"><div style="font-size:22px; font-weight:700;">${Math.round(prob*100)}%</div><div style="font-size:10.5px; color:var(--text-muted);">delay risk</div></div>
    </div></div>`;
  }

  function openProject(id) {
    const p = MockData.getProjectById(id);
    if (!p) return;
    const user = Auth.getUser();
    const canManage = Roles.canManageMaterials(user, p);
    const drawer = Components.createDrawer({
      side: "right",
      title: p.title,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:14px; flex-wrap:wrap;">${Components.createBadge(p.type,"blue")}${Components.createBadge(p.region,"gray")}${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</div>
        <div class="detail-manager-card">
          <div class="dm-left">
            <span class="dm-label"><i class="fa-solid fa-user-tie"></i> Project Manager</span>
            ${p.manager_name ? `
              <span class="dm-person clickable-entity" data-entity="member" data-id="${p.manager_id||''}" style="cursor:pointer;">
                ${Components.createAvatar(p.manager_name, "sm")}
                <span><b>${Utils.escapeHtml(p.manager_name)}</b><small>${Utils.escapeHtml(p.manager_role||"")} · ${Utils.escapeHtml(p.department||"—")}</small></span>
              </span>`
            : `<span class="dm-unassigned">Not yet assigned</span>`}
          </div>
        </div>
        <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:18px;">${Utils.escapeHtml(p.description||"")}</p>
        <div class="grid" style="grid-template-columns:repeat(2,1fr); margin-bottom:18px;">
          <div><div style="font-size:11.5px;color:var(--text-muted);">Budget</div><div style="font-weight:700;">${Utils.currency(p.budget)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Spent</div><div style="font-weight:700;">${Utils.currency(p.spent)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Materials Cost</div><div style="font-weight:700;" id="materialsCostDisplay">${Utils.currency(p.materials_total_cost||0)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Client</div><div style="font-weight:700; cursor:pointer;" class="clickable-entity" data-entity="client" data-id="${p.client_id||''}">${Utils.escapeHtml(p.client_name||"N/A")}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Deadline</div><div style="font-weight:700;">${Utils.formatDate(p.deadline)}</div></div>
          <div><div style="font-size:11.5px;color:var(--text-muted);">Tasks</div><div style="font-weight:700;">${p.tasks_done}/${p.tasks_total}</div></div>
        </div>
        ${Components.createProgressBar(p.progress)}
        <div class="tabs" style="margin:18px 0 14px;">
          <div class="tab active" data-tab="team">Team (${(p.team||[]).length})</div>
          <div class="tab" data-tab="materials">Materials (${(p.materials||[]).length})</div>
          <div class="tab" data-tab="ai">AI Risk Analysis</div>
        </div>
        <div id="projTabContent"></div>`,
    });

    function renderMaterialsTab(el) {
      const materials = p.materials || [];
      el.innerHTML = `
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          <div style="font-size:12.5px; color:var(--text-muted);">${materials.length} item${materials.length===1?"":"s"} · <b style="color:var(--text-primary);">Total: ${Utils.currency(p.materials_total_cost||0)}</b></div>
          ${canManage ? `<button class="btn btn-primary btn-sm" id="addMaterialBtn"><i class="fa-solid fa-plus"></i> Add Material</button>` : ""}
        </div>
        <div id="materialsList">${materials.length ? materials.map(mat => `
          <div class="material-row" data-id="${mat.id}" style="padding:10px 0; border-bottom:1px solid var(--border); font-size:12.5px;">
            <div class="flex items-center justify-between">
              <b>${Utils.escapeHtml(mat.name)}</b>
              <div class="flex items-center gap-8">
                <span>${Utils.currency(mat.total_cost)}</span>
                ${canManage ? `
                  <button class="btn btn-ghost btn-sm edit-material-btn" data-id="${mat.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                  <button class="btn btn-ghost btn-sm delete-material-btn" data-id="${mat.id}" title="Delete"><i class="fa-solid fa-trash" style="color:var(--red);"></i></button>
                ` : ""}
              </div>
            </div>
            <div style="color:var(--text-muted); margin-top:3px;">${mat.quantity} ${Utils.escapeHtml(mat.unit)} × ${Utils.currency(mat.unit_price)} · ${Utils.escapeHtml(mat.supplier)} · ${Utils.formatDate(mat.purchased_at)}</div>
          </div>`).join("") : Components.createEmptyState("fa-boxes-stacked", "No materials logged for this project", canManage ? "Click \"Add Material\" to log the first purchase." : "")}</div>`;

      el.querySelector("#addMaterialBtn")?.addEventListener("click", () => openMaterialForm(p, null, () => { renderMaterialsTab(el); refreshCostDisplays(); }));
      Utils.qsa(".edit-material-btn", el).forEach(btn => btn.addEventListener("click", () => {
        const mat = (p.materials||[]).find(m => m.id === btn.dataset.id);
        openMaterialForm(p, mat, () => { renderMaterialsTab(el); refreshCostDisplays(); });
      }));
      Utils.qsa(".delete-material-btn", el).forEach(btn => btn.addEventListener("click", () => {
        const mat = (p.materials||[]).find(m => m.id === btn.dataset.id);
        Components.createConfirmDialog(`Remove "${mat?.name || "this material"}" from ${p.title}? This cannot be undone.`, async () => {
          await API.deleteMaterial(p.id, btn.dataset.id);
          MockData.logAuditEvent(Auth.getUser(), "UPDATE_RECORD", `projects/${p.id}/materials/${btn.dataset.id}`);
          Components.createToast("Material removed.", "success");
          renderMaterialsTab(el);
          refreshCostDisplays();
        }, { title: "Delete material?", confirmText: "Delete" });
      }));
      bindAuto(el);
    }

    function refreshCostDisplays() {
      const el = drawer.body.querySelector("#materialsCostDisplay");
      if (el) el.textContent = Utils.currency(p.materials_total_cost||0);
      const tabLabel = Utils.qsa(".tab", drawer.body).find(t => t.dataset.tab === "materials");
      if (tabLabel) tabLabel.textContent = `Materials (${(p.materials||[]).length})`;
    }

    function renderTab(tab) {
      const el = drawer.body.querySelector("#projTabContent");
      if (tab === "team") {
        el.innerHTML = (p.team||[]).length ? p.team.map(m => `
          <div class="flex items-center gap-8 clickable-entity" data-entity="member" data-id="${m.id}" style="padding:8px 0; border-bottom:1px solid var(--border); cursor:pointer;">
            ${Components.createAvatar(m.full_name,"sm",m.avatar_color)}<span style="font-size:13px;">${Utils.escapeHtml(m.full_name)}</span>${Components.createBadge(m.role, Utils.roleColor(m.role))}
          </div>`).join("") : Components.createEmptyState("fa-users-slash", "No team members assigned");
        bindAuto(el);
      } else if (tab === "materials") {
        renderMaterialsTab(el);
      } else {
        el.innerHTML = `<button class="btn btn-primary btn-block" id="drawerAnalyzeBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Run AI Analysis</button><div id="drawerAnalysisResult"></div>`;
        el.querySelector("#drawerAnalyzeBtn").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;
          const result = await API.analyzeProject(p.id);
          btn.remove();
          el.querySelector("#drawerAnalysisResult").innerHTML = `
            ${riskGauge(result.delay_probability)}
            <div class="flex gap-8" style="flex-wrap:wrap; justify-content:center; margin-bottom:14px;">${result.key_risk_factors.map(f => Components.createBadge(f,"gray")).join("")}</div>
            <div class="card" style="background:var(--bg-input); border-left:3px solid var(--accent);"><p style="font-size:13px; color:var(--text-secondary);">${Utils.escapeHtml(result.groq_explanation)}</p></div>`;
        });
        bindAuto(el);
      }
    }
    renderTab("team");
    Utils.qsa(".tab", drawer.body).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", drawer.body).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTab(tab.dataset.tab);
    }));
    bindAuto(drawer.body);
  }

  // Shared insert/edit form for a project's purchased materials (#2 — insert + edit place)
  function openMaterialForm(project, existing, onSaved) {
    const isEdit = !!existing;
    const catalog = MockData.materialCatalog || [];
    const suppliers = MockData.suppliers || [];
    Components.createModal({
      title: isEdit ? "Edit Material" : "Add Bought Material",
      bodyHtml: `
        <div class="field"><label>Material Name</label>
          <input class="input" id="matName" list="matNameOptions" value="${Utils.escapeHtml(existing?.name || "")}" placeholder="e.g. Portland Cement (50kg bag)">
          <datalist id="matNameOptions">${catalog.map(c => `<option value="${Utils.escapeHtml(c.name)}">`).join("")}</datalist>
        </div>
        <div class="two-col">
          <div class="field"><label>Quantity</label><input class="input" type="number" min="0" step="0.01" id="matQty" value="${existing?.quantity ?? ""}" placeholder="e.g. 200"></div>
          <div class="field"><label>Unit</label><input class="input" id="matUnit" value="${Utils.escapeHtml(existing?.unit || "")}" placeholder="e.g. bag, ton, m³, piece"></div>
        </div>
        <div class="field"><label>Unit Price (USD)</label><input class="input" type="number" min="0" step="0.01" id="matPrice" value="${existing?.unit_price ?? ""}" placeholder="e.g. 12.50"></div>
        <div class="field"><label>Supplier</label>
          <input class="input" id="matSupplier" list="matSupplierOptions" value="${Utils.escapeHtml(existing?.supplier || "")}" placeholder="e.g. Sodo Building Materials PLC">
          <datalist id="matSupplierOptions">${suppliers.map(s => `<option value="${Utils.escapeHtml(s)}">`).join("")}</datalist>
        </div>
        <div class="field"><label>Purchase Date</label><input class="input" type="date" id="matDate" value="${existing ? new Date(existing.purchased_at).toISOString().slice(0,10) : new Date().toISOString().slice(0,10)}"></div>
        <div class="card" style="background:var(--bg-input); display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:12.5px; color:var(--text-muted);">Total Cost</span>
          <b id="matTotalPreview" style="font-size:16px;">${Utils.currency((existing?.quantity||0) * (existing?.unit_price||0))}</b>
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="saveMaterialBtn"><i class="fa-solid fa-check"></i> ${isEdit ? "Save Changes" : "Add Material"}</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    const qtyInput = overlay.querySelector("#matQty");
    const priceInput = overlay.querySelector("#matPrice");
    const totalPreview = overlay.querySelector("#matTotalPreview");
    function updatePreview() {
      const total = (Number(qtyInput.value)||0) * (Number(priceInput.value)||0);
      totalPreview.textContent = Utils.currency(total);
    }
    qtyInput.addEventListener("input", updatePreview);
    priceInput.addEventListener("input", updatePreview);

    overlay.querySelector("#saveMaterialBtn").addEventListener("click", async () => {
      const name = overlay.querySelector("#matName").value.trim();
      const quantity = Number(overlay.querySelector("#matQty").value);
      const unitPrice = Number(overlay.querySelector("#matPrice").value);
      const unit = overlay.querySelector("#matUnit").value.trim();
      const supplier = overlay.querySelector("#matSupplier").value.trim();
      const purchasedAt = overlay.querySelector("#matDate").value;
      if (!name || !unit || !quantity || quantity <= 0 || !unitPrice || unitPrice <= 0) {
        Components.createToast("Please fill in name, unit, quantity and price (both > 0).", "error");
        return;
      }
      const btn = overlay.querySelector("#saveMaterialBtn");
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
      const payload = { name, unit, quantity, unit_price: unitPrice, supplier: supplier || "Unspecified", purchased_at: purchasedAt };
      try {
        if (isEdit) await API.updateMaterial(project.id, existing.id, payload);
        else await API.addMaterial(project.id, payload);
        MockData.logAuditEvent(
          Auth.getUser(), "UPDATE_RECORD",
          `projects/${project.id}/materials${isEdit ? "/" + existing.id : ""}`
        );
        Components.createToast(isEdit ? "Material updated." : "Material added.", "success");
        overlay.remove();
        onSaved && onSaved();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-check"></i> ${isEdit ? "Save Changes" : "Add Material"}`;
      }
    });
  }

  function openClient(id) {
    const c = MockData.getClientById(id);
    if (!c) return;
    const myProjects = MockData.projects.filter(p => p.client_id === id);
    Components.createModal({
      title: c.company,
      bodyHtml: `
        <div class="flex items-center gap-16" style="margin-bottom:16px;">
          ${Components.createAvatar(c.company, "xl", c.avatar_color)}
          <div><div style="font-size:16px; font-weight:700;">${Utils.escapeHtml(c.contact_name)}</div><div style="font-size:12.5px; color:var(--text-muted);">${Utils.escapeHtml(c.email)}</div><div style="font-size:12.5px; color:var(--text-muted);">${Utils.escapeHtml(c.phone)}</div></div>
        </div>
        <div class="field"><label>Linked Projects</label>
          ${myProjects.length ? myProjects.map(p => `<div class="flex items-center justify-between clickable-entity" data-entity="project" data-id="${p.id}" style="padding:8px 0; border-bottom:1px solid var(--border); cursor:pointer;"><span style="font-size:13px;">${Utils.escapeHtml(p.title)}</span>${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</div>`).join("") : `<div style="font-size:12.5px; color:var(--text-muted);">No projects linked</div>`}
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`,
    });
    bindAuto(Utils.qs(".modal-overlay"));
  }

  function openDailyWorker(id) {
    const w = MockData.getDailyWorkerById(id);
    if (!w) return;
    const records = MockData.attendance.filter(a => a.person_id === id).sort((a,b) => b.date.localeCompare(a.date));
    const ranked = AIEngine.rankAbsences(MockData.attendance).find(r => r.person_id === id);
    Components.createModal({
      title: w.full_name,
      bodyHtml: `
        <div class="flex items-center gap-16" style="margin-bottom:16px;">
          ${Components.createAvatar(w.full_name, "xl", w.avatar_color)}
          <div>
            <div style="font-size:16px; font-weight:700;">${Utils.escapeHtml(w.full_name)}</div>
            <div style="font-size:12.5px; color:var(--text-muted);">${Utils.escapeHtml(w.trade)} · Daily Worker</div>
            <div class="clickable-entity" data-entity="project" data-id="${w.project_id}" style="font-size:12.5px; color:var(--accent); cursor:pointer; margin-top:4px;">${Utils.escapeHtml(w.project_title)}</div>
          </div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr); text-align:center; margin-bottom:16px;">
          <div><div style="font-weight:700; font-size:17px;">${Utils.currency(w.daily_rate)}</div><div style="font-size:11px;color:var(--text-muted);">Daily Rate</div></div>
          <div><div style="font-weight:700; font-size:17px;">${ranked ? ranked.absence_rate : 0}%</div><div style="font-size:11px;color:var(--text-muted);">Absence Rate</div></div>
          <div><div style="font-weight:700; font-size:17px;">${ranked ? ranked.ai_risk : "LOW"}</div><div style="font-size:11px;color:var(--text-muted);">AI Risk</div></div>
        </div>
        <div class="field"><label>Recent Attendance</label>
          ${records.slice(0,10).map(r => `<div class="flex items-center justify-between" style="padding:6px 0; border-bottom:1px solid var(--border); font-size:12.5px;"><span>${r.date}</span>${Components.createBadge(r.status, r.status==="Present"?"green":"red")}</div>`).join("")}
        </div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`,
    });
    bindAuto(Utils.qs(".modal-overlay"));
  }

  // Auto-wires any element with data-entity="member|project|client|daily_worker" data-id="..."
  function bindAuto(root = document) {
    Utils.qsa("[data-entity]", root).forEach(el => {
      if (el.__entityBound) return;
      el.__entityBound = true;
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const type = el.dataset.entity;
        const id = el.dataset.id;
        if (!id) return;
        if (type === "member") openMember(id);
        else if (type === "project") openProject(id);
        else if (type === "client") openClient(id);
        else if (type === "daily_worker") openDailyWorker(id);
      });
    });
  }

  return { openMember, openProject, openClient, openDailyWorker, bindAuto };
})();
