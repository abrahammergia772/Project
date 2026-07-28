/* ============================================================
   BuildIQ — components.js (js/pages consumers use these)
   Reusable UI-building functions: cards, badges, modals, toasts,
   drawers, avatars, skeletons, empty states, confirm dialogs.
   ============================================================ */

const Components = (() => {
  const { escapeHtml, initials, colorFromString, roleColor, roleColorHex, riskBadgeType, severityColor, formatDate, timeAgo, currency, countUp } = Utils;

  // ---------------- Toasts ----------------
  function getToastContainer() {
    let el = document.querySelector(".toast-container");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast-container";
      document.body.appendChild(el);
    }
    return el;
  }

  const toastIcons = { success: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info", warning: "fa-triangle-exclamation" };

  function createToast(message, type = "info") {
    const container = getToastContainer();
    // Cap stack at 3
    while (container.children.length >= 3) container.removeChild(container.firstElementChild);

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="fa-solid ${toastIcons[type] || toastIcons.info} toast-icon"></i>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("leaving");
      setTimeout(() => toast.remove(), 220);
    }, 3500);
    return toast;
  }

  // ---------------- Avatar ----------------
  function createAvatar(name = "?", size = "md", color) {
    const bg = color || colorFromString(name);
    return `<div class="avatar avatar-${size}" style="background:${bg}">${escapeHtml(initials(name) || "?")}</div>`;
  }

  // ---------------- Badge ----------------
  function createBadge(text, type = "gray", dot = false) {
    return `<span class="badge badge-${type} ${dot ? "badge-dot" : ""}">${escapeHtml(text)}</span>`;
  }

  // ---------------- Progress bar ----------------
  function createProgressBar(pct = 0, color = "") {
    const id = Utils.uid("pb");
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) requestAnimationFrame(() => { el.style.width = `${Math.min(100, pct)}%`; });
    }, 30);
    return `<div class="progress-bar"><div id="${id}" class="progress-bar-fill ${color}" style="width:0%"></div></div>`;
  }

  // ---------------- Stat card ----------------
  function createStatCard(label, value, trend, color = "orange", icon = "fa-chart-line") {
    const id = Utils.uid("stat");
    const isNumeric = typeof value === "number";
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el && isNumeric) countUp(el, value);
    }, 30);
    const trendHtml = trend !== undefined && trend !== null ? `
      <span class="stat-trend ${trend >= 0 ? "up" : "down"}">
        <i class="fa-solid ${trend >= 0 ? "fa-arrow-up" : "fa-arrow-down"}"></i> ${Math.abs(trend)}%
      </span>` : "";
    return `
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(var(--${color}-rgb, var(--accent-rgb)),0.14); color:var(--${color}, var(--accent));">
          <i class="fa-solid ${icon}"></i>
        </div>
        <div class="stat-value" id="${id}">${isNumeric ? 0 : escapeHtml(String(value))}</div>
        <div class="flex items-center justify-between">
          <span class="stat-label">${escapeHtml(label)}</span>
          ${trendHtml}
        </div>
      </div>`;
  }

  // ---------------- Member card ----------------
  function createMemberCard(member) {
    const color = roleColorHex(member.role);
    return `
      <div class="card card-hover member-card" data-id="${member.id}" style="position:relative; overflow:hidden;">
        <div style="position:absolute; top:0; left:0; right:0; height:4px; background:${color};"></div>
        <div class="flex items-center gap-12" style="margin-top:6px;">
          ${createAvatar(member.full_name, "lg", member.avatar_color)}
          <div style="min-width:0;">
            <div style="font-weight:700; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(member.full_name)}</div>
            <div style="font-size:12.5px; color:var(--text-muted);">${escapeHtml(member.job_title)}</div>
          </div>
        </div>
        <div class="flex gap-8" style="margin:12px 0 10px; flex-wrap:wrap;">
          ${createBadge(member.role, roleColor(member.role))}
          ${createBadge(member.department, "gray")}
        </div>
        <div class="flex gap-8" style="flex-wrap:wrap; margin-bottom:12px;">
          ${member.skills.slice(0,3).map(s => `<span class="badge badge-gray">${escapeHtml(s)}</span>`).join("")}
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr); text-align:center; padding:10px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); margin-bottom:12px;">
          <div><div style="font-weight:700;">${member.projects_count}</div><div style="font-size:11px; color:var(--text-muted);">Projects</div></div>
          <div><div style="font-weight:700;">${member.on_time_pct}%</div><div style="font-size:11px; color:var(--text-muted);">On-time</div></div>
          <div><div style="font-weight:700;">${member.experience_years}y</div><div style="font-size:11px; color:var(--text-muted);">Exp.</div></div>
        </div>
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          ${createBadge(member.status, member.status === "Active" ? "green" : member.status === "On Leave" ? "yellow" : "gray", true)}
          <span style="font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px;">${escapeHtml(member.email)}</span>
        </div>
        <button class="btn btn-outline btn-block btn-sm view-profile-btn" data-id="${member.id}">View Profile</button>
      </div>`;
  }

  // ---------------- Project card ----------------
  function createProjectCard(project) {
    const riskType = riskBadgeType(project.delay_risk);
    const pulsing = project.delay_risk === "HIGH" ? "animation:pulseDot 1.6s infinite;" : "";
    return `
      <div class="card card-hover project-card" data-id="${project.id}">
        <div class="flex justify-between items-center" style="margin-bottom:10px;">
          <div>
            <div style="font-weight:700; font-size:15.5px;">${escapeHtml(project.title)}</div>
            <div class="flex gap-8" style="margin-top:6px;">
              ${createBadge(project.type, "blue")}
              ${createBadge(project.region, "gray")}
            </div>
          </div>
          <span class="badge badge-${riskType}" style="${pulsing}">${escapeHtml(project.delay_risk)}</span>
        </div>
        <div style="margin-bottom:6px; display:flex; justify-content:space-between; font-size:12.5px; color:var(--text-secondary);">
          <span>${project.progress}% complete</span><span>Expected ${project.expected_progress}%</span>
        </div>
        ${createProgressBar(project.progress, riskType === "red" ? "red" : riskType === "yellow" ? "yellow" : "")}
        <div class="grid" style="grid-template-columns:repeat(4,1fr); gap:8px; margin:14px 0;">
          <div><div style="font-size:11px;color:var(--text-muted);">Team</div><div style="font-weight:600; font-size:13px;">${project.team.length}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Deadline</div><div style="font-weight:600; font-size:13px;">${formatDate(project.deadline)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Budget</div><div style="font-weight:600; font-size:13px;">${currency(project.budget)}</div></div>
          <div><div style="font-size:11px;color:var(--text-muted);">Tasks</div><div style="font-weight:600; font-size:13px;">${project.tasks_done}/${project.tasks_total}</div></div>
        </div>
        ${project.delay_reasons.length ? `<div class="flex gap-8" style="flex-wrap:wrap; margin-bottom:12px;">${project.delay_reasons.map(r => createBadge(r,"yellow")).join("")}</div>` : ""}
        <div class="flex items-center justify-between" style="margin-bottom:12px;">
          <div class="avatar-group">${project.team.slice(0,4).map(m => createAvatar(m.full_name, "sm", m.avatar_color)).join("")}</div>
          <span style="font-size:12px; color:var(--text-muted);">${escapeHtml(project.status)}</span>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-outline btn-sm btn-block view-project-btn" data-id="${project.id}">View Details</button>
          <button class="btn btn-primary btn-sm btn-block analyze-project-btn" data-id="${project.id}"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Analyze</button>
        </div>
      </div>`;
  }

  // ---------------- Complaint card ----------------
  function createComplaintCard(c) {
    const sevType = severityColor(c.severity);
    const sentimentIcon = c.sentiment === "Angry" ? "fa-face-angry" : c.sentiment === "Frustrated" ? "fa-face-frown" : "fa-face-meh";
    return `
      <div class="card complaint-card" data-id="${c.id}" style="border-left:4px solid var(--${sevType === 'gray' ? 'text-muted' : sevType});">
        <div class="flex justify-between items-center" style="margin-bottom:8px;">
          <div class="flex items-center gap-8">
            <span class="mono" style="font-size:12px; color:var(--text-muted);">${c.id}</span>
            <span style="font-size:13px; font-weight:600;">${escapeHtml(c.customer_name)}</span>
          </div>
          <span style="font-size:12px; color:var(--text-muted);">${timeAgo(c.created_at)}</span>
        </div>
        <div class="flex gap-8" style="margin-bottom:10px; flex-wrap:wrap;">
          ${createBadge(c.category, "blue")}
          ${createBadge(c.department, "gray")}
          ${createBadge(c.severity, sevType)}
        </div>
        <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:12px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(c.text)}</p>
        <div class="card" style="background:var(--bg-input); border-left:3px solid var(--accent); padding:12px 14px; margin-bottom:12px;">
          <div class="flex items-center gap-8" style="margin-bottom:6px; color:var(--accent); font-size:12.5px; font-weight:700;">
            <i class="fa-solid fa-robot"></i> AI Summary
          </div>
          <p style="font-size:13px; color:var(--text-secondary);">${escapeHtml(c.ai_summary)}</p>
        </div>
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-8" style="font-size:12.5px; color:var(--text-secondary);">
            <i class="fa-solid ${sentimentIcon}"></i> ${c.sentiment}
          </span>
          <span style="font-size:12px; color:var(--text-muted);">${escapeHtml(c.assignee)}</span>
        </div>
        <div class="divider"></div>
        <div class="flex gap-8">
          <button class="btn btn-secondary btn-sm btn-block view-complaint-btn" data-id="${c.id}">Details</button>
          ${c.status !== "resolved" ? `<button class="btn btn-primary btn-sm btn-block resolve-complaint-btn" data-id="${c.id}">Resolve</button>` : createBadge("Resolved","green")}
        </div>
      </div>`;
  }

  // ---------------- Audit card ----------------
  function createAuditCard(log) {
    const riskType = riskBadgeType(log.risk_level);
    const gaugeDeg = Math.round(log.anomaly_score * 360);
    return `
      <div class="card audit-card" data-id="${log.id}">
        <div class="flex items-center gap-16">
          <div style="width:56px;height:56px;border-radius:50%; flex-shrink:0;
               background:conic-gradient(var(--${riskType === 'gray' ? 'text-muted' : riskType}) ${gaugeDeg}deg, var(--bg-input) 0);
               display:flex; align-items:center; justify-content:center;">
            <div style="width:42px;height:42px;border-radius:50%; background:var(--bg-card); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">
              ${Math.round(log.anomaly_score*100)}
            </div>
          </div>
          <div style="flex:1; min-width:0;">
            <div class="flex items-center gap-8">
              ${createAvatar(log.user, "sm")}
              <span style="font-weight:700; font-size:14px;">${escapeHtml(log.user)}</span>
              ${createBadge(log.user_role, roleColor(log.user_role))}
            </div>
            <div class="flex items-center gap-8" style="margin-top:6px;">
              ${createBadge(log.action, (log.action === "BULK_DELETE" || log.action === "EXPORT_DATA") ? "red" : "gray")}
              <span style="font-size:12.5px; color:var(--text-muted);">${escapeHtml(log.resource)}</span>
            </div>
          </div>
          <span class="badge badge-${riskType}">${escapeHtml(log.risk_level)}</span>
        </div>
        <div style="margin:12px 0; font-size:12.5px; color:var(--text-muted);">
          <i class="fa-solid fa-clock"></i> ${formatDate(log.timestamp)} — ${escapeHtml(log.context)}
        </div>
        <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:14px;">${escapeHtml(log.explanation)}</p>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="btn btn-danger btn-sm suspend-btn" data-id="${log.id}"><i class="fa-solid fa-user-slash"></i> Suspend</button>
          <button class="btn btn-secondary btn-sm revoke-btn" data-id="${log.id}"><i class="fa-solid fa-ban"></i> Revoke</button>
          <button class="btn btn-secondary btn-sm confirm-threat-btn" data-id="${log.id}"><i class="fa-solid fa-triangle-exclamation"></i> Confirm Threat</button>
          <button class="btn btn-outline btn-sm false-alarm-btn" data-id="${log.id}"><i class="fa-solid fa-check"></i> False Alarm</button>
        </div>
      </div>`;
  }

  // ---------------- Skeleton ----------------
  function createSkeleton(type = "card") {
    if (type === "text") return `<div class="skeleton skeleton-text"></div>`;
    if (type === "circle") return `<div class="skeleton skeleton-circle" style="width:40px;height:40px;"></div>`;
    if (type === "row") return `<div class="skeleton" style="height:52px; width:100%; margin-bottom:8px;"></div>`;
    return `<div class="skeleton skeleton-card"></div>`;
  }
  function skeletonGrid(n = 6, type = "card") {
    return Array.from({length: n}).map(() => createSkeleton(type)).join("");
  }

  // ---------------- Empty state ----------------
  function createEmptyState(icon = "fa-inbox", title = "Nothing here yet", description = "", actionHtml = "") {
    return `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
        <h4>${escapeHtml(title)}</h4>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        ${actionHtml}
      </div>`;
  }

  // ---------------- Modal ----------------
  function createModal({ title, bodyHtml, actionsHtml = "", onClose } = {}) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>${escapeHtml(title || "")}</h3>
          <button class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">${bodyHtml || ""}</div>
        ${actionsHtml ? `<div class="modal-footer">${actionsHtml}</div>` : ""}
      </div>`;
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
      if (onClose) onClose();
    }
    overlay.querySelector(".modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });
    return { el: overlay, close };
  }

  // ---------------- Confirm dialog ----------------
  function createConfirmDialog(message, onConfirm, { title = "Are you sure?", confirmText = "Confirm", danger = true } = {}) {
    const modal = createModal({
      title,
      bodyHtml: `
        <div class="confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <p style="color:var(--text-secondary); font-size:14px;">${escapeHtml(message)}</p>`,
      actionsHtml: `
        <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirm-ok">${escapeHtml(confirmText)}</button>`,
    });
    modal.el.querySelector("#confirm-cancel").addEventListener("click", modal.close);
    modal.el.querySelector("#confirm-ok").addEventListener("click", () => { onConfirm && onConfirm(); modal.close(); });
    return modal;
  }

  // ---------------- Drawer ----------------
  function createDrawer({ side = "right", title = "", bodyHtml = "" } = {}) {
    const overlay = document.createElement("div");
    overlay.className = "drawer-overlay";
    const drawer = document.createElement("div");
    drawer.className = `drawer ${side}`;
    drawer.innerHTML = `
      <div class="drawer-header">
        <h3 style="font-size:16px;">${escapeHtml(title)}</h3>
        <button class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="drawer-body">${bodyHtml}</div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    function close() { overlay.remove(); drawer.remove(); }
    overlay.addEventListener("click", close);
    drawer.querySelector(".modal-close").addEventListener("click", close);
    return { overlay, drawer, close, body: drawer.querySelector(".drawer-body") };
  }

  return {
    createToast, createAvatar, createBadge, createProgressBar, createStatCard,
    createMemberCard, createProjectCard, createComplaintCard, createAuditCard,
    createSkeleton, skeletonGrid, createEmptyState, createModal, createConfirmDialog, createDrawer,
  };
})();
