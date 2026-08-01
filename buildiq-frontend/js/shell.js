/* ============================================================
   BuildIQ — shell.js
   Renders the shared Sidebar + Topbar + Mobile nav into any
   authenticated page. Call Shell.render(activeKey) after Router.guard().
   ============================================================ */

const Shell = (() => {

  const NAV_GROUPS = [
    { label: "OVERVIEW", items: [
      { key: "dashboard", label: "Dashboard", icon: "fa-gauge-high", href: "dashboard" },
    ]},
    { label: "ORGANIZATION", items: [
      { key: "members", label: "Members", icon: "fa-users", href: "members" },
      { key: "departments", label: "Departments", icon: "fa-building", href: "departments" },
      { key: "documents", label: "Documents", icon: "fa-folder-open", href: "documents" },
      { key: "messages", label: "Messages", icon: "fa-comments", href: "messages", badgeKey: "unread_messages" },
    ]},
    { label: "OPERATIONS", items: [
      { key: "projects", label: "Projects", icon: "fa-diagram-project", href: "projects" },
      { key: "tasks", label: "Tasks", icon: "fa-list-check", href: "tasks" },
      { key: "complaints", label: "Complaints", icon: "fa-triangle-exclamation", href: "complaints", badgeKey: "open_complaints" },
      { key: "attendance", label: "Attendance", icon: "fa-clipboard-user", href: "attendance", badgeKey: "absent_today" },
    ]},
    { label: "AI INTELLIGENCE", items: [
      { key: "ai_insights", label: "AI Insights", icon: "fa-wand-magic-sparkles", href: "ai_insights" },
      { key: "audit", label: "Audit Logs", icon: "fa-shield-halved", href: "audit", badgeKey: "audit_flags" },
      { key: "reports", label: "Reports", icon: "fa-file-lines", href: "reports" },
      { key: "chatbot", label: "AI Chatbot", icon: "fa-robot", href: "chatbot" },
    ]},
    { label: "SYSTEM", items: [
      { key: "settings", label: "Settings", icon: "fa-gear", href: "settings" },
      { key: "user_management", label: "User Management", icon: "fa-user-shield", href: "user_management" },
    ]},
  ];

  const MOBILE_NAV_ITEMS = ["dashboard", "projects", "complaints", "audit", "chatbot"];

  function badgeCounts(user) {
    if (BUILDIQ_CONFIG.MOCK_MODE) {
      const scopedComplaints = Roles.visibleComplaints(user, DataStore.complaints);
      const scopedAttendance = Roles.visibleAttendance(user, DataStore.attendance);
      const today = new Date().toISOString().slice(0, 10);
      return {
        open_complaints: scopedComplaints.filter(c => c.status !== "resolved").length,
        audit_flags: DataStore.auditLogs.filter(l => l.is_flagged).length,
        absent_today: scopedAttendance.filter(a => a.date === today && a.status === "Absent").length,
      };
    }
    return {};
  }

  function buildSidebar(activeKey, user) {
    const counts = badgeCounts(user);
    const groupsHtml = NAV_GROUPS
      .map(g => {
        const items = g.items.filter(item => Router.accessFor(item.key, user.role) !== false);
        if (!items.length) return "";
        return `
          <div class="nav-group">
            <div class="nav-label">${g.label}</div>
            ${items.map(item => `
              <a href="${item.href}" class="nav-item ${item.key === activeKey ? "active" : ""}" data-key="${item.key}">
                <i class="fa-solid ${item.icon}"></i>
                <span>${item.label}</span>
                ${item.badgeKey && counts[item.badgeKey] ? `<span class="nav-badge">${counts[item.badgeKey]}</span>` : ""}
              </a>`).join("")}
          </div>`;
      }).join("");

    const orgSubLabel = user.role === Roles.PROJECT_MANAGER
      ? "Project Delivery"
      : user.role === "Department Manager" || user.role === "Engineer"
      ? `${user.department} Dept.`
      : user.role === "Client" ? "Client Account" : "Construction Management";

    return `
      <aside class="sidebar" id="sidebar">
        <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Toggle sidebar"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="sidebar-header">
          <a href="dashboard" class="sidebar-logo">
            <div class="logo-mark"><i class="fa-solid fa-building-columns"></i></div>
            <span class="logo-text">BuildIQ</span>
            <span class="version-badge">v2.1</span>
          </a>
        </div>
        <div class="sidebar-org">
          <div class="org-name">${Utils.escapeHtml(user.org_name || "Organization")}</div>
          <div class="org-type">${Utils.escapeHtml(orgSubLabel)}</div>
        </div>
        <div class="sidebar-divider"></div>
        <nav class="sidebar-nav" aria-label="Primary">${groupsHtml}</nav>
        <div class="sidebar-footer">
          ${Components.createAvatar(user.name, "md")}
          <div class="user-meta">
            <div class="user-name">${Utils.escapeHtml(user.name)}</div>
            ${Auth.hasMultipleRoles() ? `
              <button class="user-role role-switch-btn" id="roleSwitchBtn" aria-haspopup="true" aria-expanded="false"
                      title="Switch role">
                <span>${Utils.escapeHtml(user.role)}</span>
                <i class="fa-solid fa-repeat"></i>
              </button>`
            : `<div class="user-role">${Utils.escapeHtml(user.role)}</div>`}
          </div>
          <div class="sidebar-footer-actions">
            <button class="icon-btn" id="logoutBtn" aria-label="Log out" title="Log out"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
          </div>
          ${Auth.hasMultipleRoles() ? `
            <div class="role-switch-menu hidden" id="roleSwitchMenu" role="menu" aria-label="Switch role">
              <div class="role-switch-head">Switch role</div>
              ${Auth.getRoles().map(r => {
                const active = r === user.role;
                return `
                <button class="role-switch-opt ${active ? "active" : ""}" role="menuitem" data-role="${Utils.escapeHtml(r)}">
                  <span class="rs-dot" style="background:${Utils.roleColorHex(r)};"></span>
                  <span class="rs-label">
                    <b>${Utils.escapeHtml(r)}</b>
                    <small>${Utils.escapeHtml((Roles.ROLE_DESCRIPTIONS[r] || "").split(".")[0])}</small>
                  </span>
                  ${active ? `<i class="fa-solid fa-check"></i>` : ""}
                </button>`;
              }).join("")}
            </div>` : ""}
        </div>
      </aside>
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>`;
  }


  function buildTopbar(activeKey, user) {
    const pageLabel = (NAV_GROUPS.flatMap(g => g.items).find(i => i.key === activeKey) || { label: "Dashboard" }).label;
    return `
      <header class="topbar">
        <div class="flex items-center gap-16">
          <button class="icon-btn burger-btn" id="burgerBtn" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>
          <div class="breadcrumb">BuildIQ / <b>${pageLabel}</b></div>
        </div>
        <div class="topbar-search" id="spotlightTrigger" role="button" tabindex="0" aria-label="Open search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <span>Search members, projects, complaints...</span>
          <kbd>⌘K</kbd>
        </div>
        <div class="topbar-right">
          <div class="ai-status"><span class="pulse-dot"></span> AI Online</div>
          <div class="notif-wrap">
            <button class="icon-btn" id="notifBtn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-bell"></i><span class="dot-badge hidden" id="notifDot"></span></button>
            <div class="notif-dropdown hidden" id="notifDropdown" role="menu" aria-label="Notifications"></div>
          </div>
          <div class="topbar-notif-compose">
            <button class="icon-btn hidden" id="notifComposeBtn" aria-label="Send a notification" title="Send a notification"><i class="fa-solid fa-bullhorn"></i></button>
          </div>
          <button class="icon-btn" id="themeToggleBtn" aria-label="Toggle theme"><i class="fa-solid fa-moon"></i></button>
          <div class="user-chip" id="userMenuBtn">
            ${Components.createAvatar(user.name, "sm", null, user)}
            <i class="fa-solid fa-chevron-down"></i>
          </div>
        </div>
      </header>`;
  }

  function buildMobileNav(activeKey) {
    const items = NAV_GROUPS.flatMap(g => g.items).filter(i => MOBILE_NAV_ITEMS.includes(i.key));
    return `
      <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
        ${items.map(item => `
          <a href="${item.href}" class="${item.key === activeKey ? "active" : ""}">
            <i class="fa-solid ${item.icon}"></i>
            <span>${item.label}</span>
          </a>`).join("")}
      </nav>`;
  }

  function attachBehaviors() {
    // Sidebar collapse (desktop)
    const collapseBtn = document.getElementById("sidebarCollapseBtn");
    const sidebar = document.getElementById("sidebar");
    const mainWrap = document.getElementById("mainWrap");
    if (collapseBtn) {
      const collapsed = localStorage.getItem("buildiq_sidebar_collapsed") === "1";
      if (collapsed) { sidebar.classList.add("collapsed"); mainWrap.classList.add("collapsed"); }
      collapseBtn.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
        mainWrap.classList.toggle("collapsed");
        localStorage.setItem("buildiq_sidebar_collapsed", sidebar.classList.contains("collapsed") ? "1" : "0");
      });
    }

    // Mobile burger
    const burgerBtn = document.getElementById("burgerBtn");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (burgerBtn) {
      burgerBtn.addEventListener("click", () => {
        sidebar.classList.add("mobile-open");
        backdrop.classList.add("show");
      });
      backdrop.addEventListener("click", () => {
        sidebar.classList.remove("mobile-open");
        backdrop.classList.remove("show");
      });
    }

    // Logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => {
      Components.createConfirmDialog("You will be signed out of BuildIQ.", () => Auth.logout(), { title: "Log out?", confirmText: "Log out" });
    });

    // Theme toggle
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      const applyIcon = () => {
        const isLight = document.documentElement.getAttribute("data-theme") === "light";
        themeBtn.querySelector("i").className = `fa-solid ${isLight ? "fa-sun" : "fa-moon"}`;
      };
      applyIcon();
      themeBtn.addEventListener("click", () => {
        const isLight = document.documentElement.getAttribute("data-theme") === "light";
        if (isLight) { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("buildiq_theme", "dark"); }
        else { document.documentElement.setAttribute("data-theme", "light"); localStorage.setItem("buildiq_theme", "light"); }
        applyIcon();
      });
    }

    // User menu (simple dropdown → toast for demo)
    const userMenuBtn = document.getElementById("userMenuBtn");
    if (userMenuBtn) userMenuBtn.addEventListener("click", () => {
      window.location.href = "settings";
    });

    // Role switcher (only rendered when the person holds more than one role)
    initRoleSwitcher();

    // Notifications
    initNotifications();

    // Spotlight
    const spotlightTrigger = document.getElementById("spotlightTrigger");
    if (spotlightTrigger) {
      spotlightTrigger.addEventListener("click", openSpotlight);
      spotlightTrigger.addEventListener("keydown", (e) => { if (e.key === "Enter") openSpotlight(); });
    }
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSpotlight();
      }
    });
  }

  // ---------------- Role switcher ----------------
  function initRoleSwitcher() {
    const btn = document.getElementById("roleSwitchBtn");
    const menu = document.getElementById("roleSwitchMenu");
    if (!btn || !menu) return;

    const close = () => { menu.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !open);
      btn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    Utils.qsa(".role-switch-opt", menu).forEach(opt => opt.addEventListener("click", () => {
      const role = opt.dataset.role;
      if (role === Auth.getActiveRole()) { close(); return; }
      if (!Auth.switchRole(role)) { Components.createToast("You don't hold that role.", "error"); return; }

      // Stay on the current page if the new role can still see it; otherwise
      // fall back to the dashboard rather than bouncing off a denied page.
      const page = Router.currentPageKey();
      const stillAllowed = Router.accessFor(page, role) !== false;
      const target = stillAllowed ? `${page}.html` : "dashboard.html";

      Components.createToast(`Switched to ${role}.`, "success");
      setTimeout(() => { window.location.href = target; }, 350);
    }));
  }

  // ---------------- Notifications dropdown ----------------
  let notifCache = [];

  function notifTypeColor(type) {
    return type === "error" ? "var(--red)" : type === "warning" ? "var(--yellow)" : type === "success" ? "var(--green)" : "var(--blue)";
  }

  function renderNotifList() {
    // ---- Notification composer ----------------------------------------
    // Visibility is decided by the SERVER (/notifications/can-send), not by a
    // role list duplicated here: the two would drift, and a client-side copy
    // would be advisory anyway since the endpoint re-checks every request.
    const composeBtn = document.getElementById("notifComposeBtn");
    if (composeBtn && !composeBtn.dataset.wired) {
      composeBtn.dataset.wired = "1";
      API.canSendNotifications().then(perm => {
        if (!perm.can_send) return;
        composeBtn.classList.remove("hidden");
        composeBtn.addEventListener("click", () => openNotifCompose(perm));
      }).catch(() => { /* leave it hidden */ });
    }

    const dropdown = document.getElementById("notifDropdown");
    if (!dropdown) return;
    const unread = notifCache.filter(n => !n.read).length;

    dropdown.innerHTML = `
      <div class="notif-header">
        <span>Notifications${unread ? ` <span class="notif-count">${unread}</span>` : ""}</span>
        ${unread ? `<button class="notif-mark-all" id="notifMarkAll">Mark all read</button>` : ""}
      </div>
      <div class="notif-list">
        ${notifCache.length ? notifCache.map(n => `
          <a class="notif-item ${n.read ? "" : "unread"}" data-id="${n.id}" ${n.link ? `href="${n.link}"` : `href="#"`}>
            <span class="notif-icon" style="color:${notifTypeColor(n.type)};"><i class="fa-solid ${n.icon}"></i></span>
            <span class="notif-body">
              <span class="notif-title">${Utils.escapeHtml(n.title)}</span>
              <span class="notif-text">${Utils.escapeHtml(n.body)}</span>
              <span class="notif-time">${Utils.timeAgo(n.created_at)}</span>
            </span>
            ${n.read ? "" : `<span class="notif-unread-dot"></span>`}
          </a>`).join("")
        : `<div class="notif-empty"><i class="fa-solid fa-bell-slash"></i><span>You're all caught up</span></div>`}
      </div>`;

    const dot = document.getElementById("notifDot");
    if (dot) dot.classList.toggle("hidden", unread === 0);

    document.getElementById("notifMarkAll")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await API.markAllNotificationsRead();
      notifCache = notifCache.map(n => ({ ...n, read: true }));
      renderNotifList();
    });

    Utils.qsa(".notif-item", dropdown).forEach(item => item.addEventListener("click", async (e) => {
      const id = item.dataset.id;
      const n = notifCache.find(x => x.id === id);
      if (n && !n.read) {
        await API.markNotificationRead(id);
        n.read = true;
      }
      if (!n?.link) { e.preventDefault(); renderNotifList(); }
    }));
  }

  async function refreshNotifications() {
    try {
      notifCache = await API.getNotifications();
    } catch { notifCache = []; }
    renderNotifList();
  }

  function initNotifications() {
    const notifBtn = document.getElementById("notifBtn");
    const dropdown = document.getElementById("notifDropdown");
    if (!notifBtn || !dropdown) return;

    refreshNotifications();

    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = dropdown.classList.contains("hidden");
      dropdown.classList.toggle("hidden", !willOpen);
      notifBtn.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) refreshNotifications();
    });

    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && e.target !== notifBtn) {
        dropdown.classList.add("hidden");
        notifBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        dropdown.classList.add("hidden");
        notifBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function openSpotlight() {
    const overlay = document.createElement("div");
    overlay.className = "spotlight-overlay";
    overlay.innerHTML = `
      <div class="spotlight-box">
        <div class="spotlight-input-row">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" placeholder="Search members, projects, complaints, documents..." id="spotlightInput" autofocus />
          <kbd style="font-size:11px;color:var(--text-muted);border:1px solid var(--border);padding:2px 6px;border-radius:4px;">Esc</kbd>
        </div>
        <div class="spotlight-results" id="spotlightResults">
          <div style="padding:24px; text-align:center; color:var(--text-muted); font-size:13px;">Start typing to search…</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#spotlightInput");
    const results = overlay.querySelector("#spotlightResults");
    input.focus();

    function close() { overlay.remove(); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
    });

    const doSearch = Utils.debounce(async (q) => {
      if (!q.trim()) { results.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:13px;">Start typing to search…</div>`; return; }
      const data = await API.searchGlobal(q);
      const sections = [];
      if (data.members?.length) sections.push(`
        <div class="spotlight-group-label">Members</div>
        ${data.members.map(m => `<a href="members" class="spotlight-item">${Components.createAvatar(m.full_name,"sm")} <span>${Utils.escapeHtml(m.full_name)}</span> ${Components.createBadge(m.role, Utils.roleColor(m.role))}</a>`).join("")}
      `);
      if (data.projects?.length) sections.push(`
        <div class="spotlight-group-label">Projects</div>
        ${data.projects.map(p => `<a href="projects" class="spotlight-item"><i class="fa-solid fa-diagram-project" style="color:var(--text-muted)"></i> <span>${Utils.escapeHtml(p.title)}</span> ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</a>`).join("")}
      `);
      if (data.complaints?.length) sections.push(`
        <div class="spotlight-group-label">Complaints</div>
        ${data.complaints.map(c => `<a href="complaints" class="spotlight-item"><i class="fa-solid fa-triangle-exclamation" style="color:var(--text-muted)"></i> <span>${Utils.escapeHtml(c.category)}</span> ${Components.createBadge(c.severity, Utils.severityColor(c.severity))}</a>`).join("")}
      `);
      results.innerHTML = sections.length ? sections.join("") : `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:13px;">No results found.</div>`;
    }, 250);

    input.addEventListener("input", (e) => doSearch(e.target.value));
  }

  function render(activeKey) {
    const user = Auth.getUser();
    if (!user) return;

    // Apply saved theme
    const savedTheme = localStorage.getItem("buildiq_theme");
    if (savedTheme === "light") document.documentElement.setAttribute("data-theme", "light");

    const root = document.getElementById("appShell");
    root.innerHTML = `
      <div class="gradient-mesh"></div>
      ${buildSidebar(activeKey, user)}
      <div class="main-wrap" id="mainWrap">
        ${buildTopbar(activeKey, user)}
        <main class="page-content page-fade" id="pageContent"></main>
      </div>
      ${buildMobileNav(activeKey)}
    `;
    attachBehaviors();
    Router.showAccessDeniedIfNeeded();

    // Floating AI assistant — mounts itself on every page the user's role
    // allows, and skips the dedicated chatbot page.
    // Pull the selectable model list once so the picker can render.
    if (window.AIModel) AIModel.load();
    if (window.AIAssistant) AIAssistant.mount();
  }

  /**
   * Compose and send a notification.
   *
   * Which audience controls appear depends on what the server said this role
   * may do: Admin/GM can broadcast to a whole role, a Department Manager is
   * limited to their department, a Project Manager to named individuals.
   */
  async function openNotifCompose(perm) {
    const user = Auth.getUser();
    let people = [];
    try { people = await API.getContacts(); } catch (e) { /* individuals unavailable */ }

    const deptOptions = ((window.DataStore && DataStore.departments) || [])
      .filter(d => perm.can_broadcast_roles || d.name === user.department)
      .map(d => `<option value="${Utils.escapeHtml(d.name)}">${Utils.escapeHtml(d.name)}</option>`)
      .join("");

    const modal = Components.createModal({
      title: "Send a notification",
      bodyHtml: `
        <div class="field">
          <label for="ntfTitle">Title</label>
          <input class="input" id="ntfTitle" maxlength="200" placeholder="Site meeting moved to 9am">
        </div>
        <div class="field">
          <label for="ntfBody">Message</label>
          <textarea class="input" id="ntfBody" rows="3" maxlength="2000" placeholder="What do people need to know?"></textarea>
        </div>
        <div class="field">
          <label for="ntfAudience">Send to</label>
          <select class="input" id="ntfAudience">
            <option value="people">Specific people</option>
            ${perm.can_target_departments ? `<option value="dept">A department</option>` : ""}
            ${perm.can_broadcast_roles ? `<option value="role">Everyone with a role</option>` : ""}
          </select>
        </div>
        <div class="field" id="ntfPeopleWrap">
          <label for="ntfPeople">People <span class="text-muted">(ctrl/cmd-click for several)</span></label>
          <select class="input" id="ntfPeople" multiple size="5">
            ${people.map(c => `<option value="${Utils.escapeHtml(c.id)}">${Utils.escapeHtml(c.name || c.full_name)} — ${Utils.escapeHtml(c.role)}</option>`).join("")}
          </select>
        </div>
        <div class="field hidden" id="ntfDeptWrap">
          <label for="ntfDept">Department</label>
          <select class="input" id="ntfDept">${deptOptions}</select>
        </div>
        <div class="field hidden" id="ntfRoleWrap">
          <label for="ntfRole">Role</label>
          <select class="input" id="ntfRole">
            ${Roles.ALL.filter(r => r !== "Client").map(r => `<option value="${r}">${r}</option>`).join("")}
          </select>
        </div>
        <div class="field-hint"><i class="fa-solid fa-circle-info"></i>
          ${perm.scope === "organization" ? "You can notify anyone in the organization."
            : perm.scope === "department" ? "You can notify your own department."
            : "You can notify people on the projects you manage."}
        </div>`,
      actionsHtml: `
        <button class="btn btn-secondary" id="ntfCancel">Cancel</button>
        <button class="btn btn-primary" id="ntfSend"><i class="fa-solid fa-paper-plane"></i> Send</button>`,
    });

    const q = (sel) => modal.el.querySelector(sel);
    q("#ntfAudience").addEventListener("change", (e) => {
      const v = e.target.value;
      q("#ntfPeopleWrap").classList.toggle("hidden", v !== "people");
      q("#ntfDeptWrap").classList.toggle("hidden", v !== "dept");
      q("#ntfRoleWrap").classList.toggle("hidden", v !== "role");
    });
    q("#ntfCancel").addEventListener("click", modal.close);

    q("#ntfSend").addEventListener("click", async (e) => {
      const title = q("#ntfTitle").value.trim();
      const body = q("#ntfBody").value.trim();
      if (!title || !body) {
        Components.createToast("Add a title and a message.", "error");
        return;
      }
      const mode = q("#ntfAudience").value;
      const payload = { title, body, user_ids: [], roles: [], departments: [] };
      if (mode === "people") {
        payload.user_ids = Array.from(q("#ntfPeople").selectedOptions).map(o => o.value);
        if (!payload.user_ids.length) {
          Components.createToast("Choose at least one person.", "error");
          return;
        }
      } else if (mode === "dept") {
        payload.departments = [q("#ntfDept").value];
      } else {
        payload.roles = [q("#ntfRole").value];
      }

      e.target.disabled = true;
      try {
        await API.createNotification(payload);
        modal.close();
        Components.createToast("Notification sent.", "success");
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(`Could not send: ${err.message}`, "error");
      }
    });
  }

  return { render, NAV_GROUPS, refreshNotifications };
})();
