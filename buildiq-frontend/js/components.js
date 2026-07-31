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
  // `link` makes the whole card a target: either a plain href string, or
  // { href, hint } to also show a call-to-action line. Long values (currency,
  // percentages) get a smaller size class so nothing is ever clipped.
  function createStatCard(label, value, trend, color = "orange", icon = "fa-chart-line", link = null) {
    const id = Utils.uid("stat");
    const isNumeric = typeof value === "number";
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el && isNumeric) countUp(el, value);
    }, 30);

    const trendHtml = trend !== undefined && trend !== null ? `
      <span class="stat-trend ${trend >= 0 ? "up" : "down"}" title="${trend >= 0 ? "Up" : "Down"} ${Math.abs(trend)}% on last period">
        <i class="fa-solid ${trend >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}"></i> ${Math.abs(trend)}%
      </span>` : "";

    // Scale the number down as it gets longer so it always fits on one line.
    const text = String(value);
    const sizeClass = text.length > 11 ? "xs" : text.length > 8 ? "sm" : text.length > 5 ? "md" : "";

    const href = typeof link === "string" ? link : (link && link.href) || null;
    const hint = (link && link.hint) || null;
    const tag = href ? "a" : "div";
    const attrs = href
      ? `href="${escapeHtml(href)}" class="stat-card is-clickable" aria-label="${escapeHtml(label)}: ${escapeHtml(text)}. View details"`
      : `class="stat-card"`;

    return `
      <${tag} ${attrs} style="--stat-color: var(--${color}, var(--accent)); --stat-rgb: var(--${color}-rgb, var(--accent-rgb));">
        <span class="stat-accent" aria-hidden="true"></span>
        <div class="stat-top">
          <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
          ${trendHtml}
        </div>
        <div class="stat-value ${sizeClass}" id="${id}" title="${escapeHtml(text)}">${isNumeric ? 0 : escapeHtml(text)}</div>
        <div class="stat-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        ${href ? `<span class="stat-go">${escapeHtml(hint || "View details")} <i class="fa-solid fa-arrow-right"></i></span>` : ""}
      </${tag}>`;
  }

  // ---------------- Member card ----------------
  function createMemberCard(member) {
    const color = roleColorHex(member.role);
    return `
      <div class="card card-hover member-card" data-id="${member.id}" style="position:relative; overflow:hidden;">
        <div style="position:absolute; top:0; left:0; right:0; height:4px; background:${color};"></div>
        <div class="flex items-center gap-12 clickable-entity" data-entity="member" data-id="${member.id}" style="margin-top:6px; cursor:pointer;">
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
          <div class="clickable-entity" data-entity="project" data-id="${project.id}" style="cursor:pointer;">
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
        <div class="project-manager-row">
          ${project.manager_name ? `
            <span class="pm-label"><i class="fa-solid fa-user-tie"></i> Manager</span>
            <span class="pm-name clickable-entity" data-entity="member" data-id="${project.manager_id || ""}" style="cursor:pointer;">
              ${createAvatar(project.manager_name, "sm")}<b>${escapeHtml(project.manager_name)}</b>
            </span>`
          : `<span class="pm-label pm-unassigned"><i class="fa-solid fa-user-slash"></i> No manager assigned</span>`}
        </div>
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
    const entityAttr = c.submitted_by_type === "client" ? `data-entity="client" data-id="${c.submitted_by||''}"` : `data-entity="member" data-id="${c.submitted_by||''}"`;
    return `
      <div class="card complaint-card" data-id="${c.id}" style="border-left:4px solid var(--${sevType === 'gray' ? 'text-muted' : sevType});">
        <div class="flex justify-between items-center" style="margin-bottom:8px;">
          <div class="flex items-center gap-8">
            <span class="mono" style="font-size:12px; color:var(--text-muted);">${c.id}</span>
            <span class="clickable-entity" ${entityAttr} style="font-size:13px; font-weight:600; cursor:pointer;">${escapeHtml(c.customer_name)}</span>
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
    // Which of the 7 audit types this event belongs to (may be absent on legacy rows)
    const auditTypeMeta = (window.MockData && log.audit_type)
      ? MockData.auditTypeMeta(log.audit_type) : null;
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
            <div class="flex items-center gap-8 clickable-entity" data-entity="member" data-id="${(window.MockData && MockData.getMemberByName(log.user) || {}).id || ''}" style="cursor:pointer;">
              ${createAvatar(log.user, "sm")}
              <span style="font-weight:700; font-size:14px;">${escapeHtml(log.user)}</span>
              ${createBadge(log.user_role, roleColor(log.user_role))}
            </div>
            <div class="flex items-center gap-8" style="margin-top:6px; flex-wrap:wrap;">
              ${createBadge(log.action_label || log.action, log.is_flagged ? "red" : "gray")}
              <span style="font-size:12.5px; color:var(--text-muted);">${escapeHtml(log.resource)}</span>
            </div>
          </div>
          <span class="badge badge-${riskType}">${escapeHtml(log.risk_level)}</span>
        </div>
        ${auditTypeMeta ? `<div class="audit-card-type" style="--type-color:var(--${auditTypeMeta.color});">
          <span class="type-pill" style="--type-color:var(--${auditTypeMeta.color});"><i class="fa-solid ${auditTypeMeta.icon}"></i> ${escapeHtml(auditTypeMeta.label)}</span>
          <span class="audit-card-ml"><i class="fa-solid fa-brain"></i> ${escapeHtml(auditTypeMeta.ml_role)}</span>
        </div>` : ""}
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

  // ---------------- Combobox: dropdown + free typing ----------------
  // Any `<input list="...">` on the page is upgraded in place into a combobox:
  // a chevron opens the full option list, typing filters it, and (when the
  // field allows it) you can still enter a value that isn't on the list.
  // The <datalist> stays in the DOM as the data source and as a native
  // fallback if this script never runs.
  const Combo = (() => {
    const UPGRADED = "data-combo-ready";

    function optionsFor(input) {
      const list = document.getElementById(input.getAttribute("list"));
      if (!list) return [];
      return Array.from(list.querySelectorAll("option")).map(o => ({
        value: o.value,
        sub: (o.textContent || "").trim() && o.textContent.trim() !== o.value ? o.textContent.trim() : "",
      }));
    }

    function closeAll(except) {
      Utils.qsa(".combo.open").forEach(c => {
        if (c === except) return;
        c.classList.remove("open");
        const i = c.querySelector("input");
        if (i) i.setAttribute("aria-expanded", "false");
      });
    }

    function upgrade(input) {
      if (!input || input.hasAttribute(UPGRADED) || !input.getAttribute("list")) return;
      input.setAttribute(UPGRADED, "1");

      const wrap = document.createElement("div");
      wrap.className = "combo";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const panelId = `${input.id || Utils.uid("combo")}__panel`;
      wrap.insertAdjacentHTML("beforeend", `
        <button type="button" class="combo-toggle" tabindex="-1" aria-label="Show options">
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div class="combo-panel" id="${panelId}" role="listbox"></div>`);

      const toggle = wrap.querySelector(".combo-toggle");
      const panel = wrap.querySelector(".combo-panel");

      input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-controls", panelId);
      input.setAttribute("autocomplete", "off");

      let active = -1;

      // `filter = false` shows everything (used by the chevron), otherwise the
      // list narrows to what has been typed so far.
      function render(filter = true) {
        const q = filter ? input.value.trim().toLowerCase() : "";
        const opts = optionsFor(input).filter(o => !q || o.value.toLowerCase().includes(q));
        active = -1;
        panel.innerHTML = opts.length
          ? opts.map((o, i) => `
              <div class="combo-opt" role="option" data-i="${i}" data-value="${Utils.escapeHtml(o.value)}" aria-selected="false">
                <span>${Utils.escapeHtml(o.value)}</span>${o.sub ? `<small>${Utils.escapeHtml(o.sub)}</small>` : ""}
              </div>`).join("")
          : `<div class="combo-empty">${input.dataset.allowNew === "0" ? "No matches" : "No matches — press Enter to use what you typed"}</div>`;

        Utils.qsa(".combo-opt", panel).forEach(el => {
          // mousedown fires before blur, so the click isn't lost
          el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(el.dataset.value); });
        });
      }

      function open(filter = true) { render(filter); wrap.classList.add("open"); input.setAttribute("aria-expanded", "true"); closeAll(wrap); }
      function close() { wrap.classList.remove("open"); input.setAttribute("aria-expanded", "false"); }

      function choose(value) {
        input.value = value;
        close();
        // Let any existing listeners (hints, dependent lists) react.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.focus();
      }

      function setActive(next) {
        const items = Utils.qsa(".combo-opt", panel);
        if (!items.length) return;
        active = (next + items.length) % items.length;
        items.forEach((el, i) => {
          el.classList.toggle("active", i === active);
          el.setAttribute("aria-selected", i === active ? "true" : "false");
        });
        // Guarded: not implemented in every environment (older browsers, jsdom).
        items[active].scrollIntoView?.({ block: "nearest" });
      }

      // Set while the chevron is opening, so the focus handler that follows
      // doesn't immediately re-render the list with the filter applied.
      let browsing = false;

      toggle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (wrap.classList.contains("open")) { close(); return; }
        browsing = true;
        open(false);          // chevron always shows the full list
        input.focus();
        setTimeout(() => { browsing = false; }, 0);
      });

      input.addEventListener("input", () => open(true));
      input.addEventListener("focus", () => {
        if (browsing) return;                    // the chevron already opened it
        if (input.value.trim()) open(true);
      });
      input.addEventListener("blur", () => setTimeout(close, 120));

      input.addEventListener("keydown", (e) => {
        const isOpen = wrap.classList.contains("open");
        if (e.key === "ArrowDown") { e.preventDefault(); if (!isOpen) open(false); else setActive(active + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); if (isOpen) setActive(active - 1); }
        else if (e.key === "Enter") {
          const items = Utils.qsa(".combo-opt", panel);
          if (isOpen && active >= 0 && items[active]) { e.preventDefault(); choose(items[active].dataset.value); }
          else close();
        }
        else if (e.key === "Escape") { if (isOpen) { e.preventDefault(); close(); } }
        else if (e.key === "Tab") close();
      });
    }

    function upgradeAll(root = document) {
      Utils.qsa("input[list]", root).forEach(upgrade);
    }

    function init() {
      upgradeAll();
      // Modals and drawers are injected later — upgrade them as they appear.
      new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches?.("input[list]")) upgrade(n);
          else upgradeAll(n);
        }));
      }).observe(document.body, { childList: true, subtree: true });

      document.addEventListener("mousedown", (e) => {
        if (!e.target.closest(".combo")) closeAll();
      });
    }

    return { init, upgrade, upgradeAll };
  })();

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => Combo.init());
    else Combo.init();
  }

  // ---------------- Typed input with suggestions ----------------
  // A free-text <input> backed by a <datalist>: users can type anything, but
  // still get autocomplete for the known values. Use `resolveTypedValue` to
  // map what was typed back to an option id.
  function createTypedInput({ id, options = [], value = "", placeholder = "Type to search...", allowNew = true, required = false } = {}) {
    const listId = `${id}__list`;
    const opts = options.map(o => (typeof o === "string" ? { id: o, label: o } : o));
    const current = opts.find(o => o.id === value);
    return `
      <input class="input typed-input" id="${id}" list="${listId}"
             value="${escapeHtml(current ? current.label : value || "")}"
             placeholder="${escapeHtml(placeholder)}" autocomplete="off"
             ${required ? "required" : ""} data-allow-new="${allowNew ? "1" : "0"}">
      <datalist id="${listId}">
        ${opts.map(o => `<option value="${escapeHtml(o.label)}">${o.sub ? escapeHtml(o.sub) : ""}</option>`).join("")}
      </datalist>`;
  }

  // Given what the user typed, find the matching option (case-insensitive).
  // Returns { option, isNew, text }.
  function resolveTypedValue(inputEl, options = []) {
    const text = (inputEl?.value || "").trim();
    const opts = options.map(o => (typeof o === "string" ? { id: o, label: o } : o));
    const match = opts.find(o => o.label.toLowerCase() === text.toLowerCase());
    return { option: match || null, isNew: !!text && !match, text };
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
    createTypedInput, resolveTypedValue, Combo,
    createMemberCard, createProjectCard, createComplaintCard, createAuditCard,
    createSkeleton, skeletonGrid, createEmptyState, createModal, createConfirmDialog, createDrawer,
  };
})();
