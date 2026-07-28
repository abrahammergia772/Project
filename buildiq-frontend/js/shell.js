/* ============================================================
   BuildIQ — shell.js
   Renders the shared Sidebar + Topbar + Mobile nav into any
   authenticated page. Call Shell.render(activeKey) after Router.guard().
   ============================================================ */

const Shell = (() => {

  const NAV_GROUPS = [
    { label: "OVERVIEW", items: [
      { key: "dashboard", label: "Dashboard", icon: "fa-gauge-high", href: "dashboard.html" },
    ]},
    { label: "ORGANIZATION", items: [
      { key: "members", label: "Members", icon: "fa-users", href: "members.html" },
      { key: "departments", label: "Departments", icon: "fa-building", href: "departments.html" },
      { key: "documents", label: "Documents", icon: "fa-folder-open", href: "documents.html" },
    ]},
    { label: "OPERATIONS", items: [
      { key: "projects", label: "Projects", icon: "fa-diagram-project", href: "projects.html" },
      { key: "tasks", label: "Tasks", icon: "fa-list-check", href: "tasks.html" },
      { key: "complaints", label: "Complaints", icon: "fa-triangle-exclamation", href: "complaints.html", badgeKey: "open_complaints" },
    ]},
    { label: "AI INTELLIGENCE", items: [
      { key: "audit", label: "Audit Logs", icon: "fa-shield-halved", href: "audit.html", badgeKey: "audit_flags" },
      { key: "reports", label: "Reports", icon: "fa-file-lines", href: "reports.html" },
      { key: "chatbot", label: "AI Chatbot", icon: "fa-robot", href: "chatbot.html" },
    ]},
    { label: "SYSTEM", superAdminOnly: true, items: [
      { key: "settings", label: "Settings", icon: "fa-gear", href: "settings.html" },
      { key: "user_management", label: "User Management", icon: "fa-user-shield", href: "user_management.html" },
    ]},
  ];

  const MOBILE_NAV_ITEMS = ["dashboard", "projects", "complaints", "audit", "chatbot"];

  function badgeCounts() {
    if (BUILDIQ_CONFIG.MOCK_MODE) {
      return {
        open_complaints: MockData.complaints.filter(c => c.status !== "resolved").length,
        audit_flags: MockData.auditLogs.filter(l => l.is_flagged).length,
      };
    }
    return {};
  }

  function buildSidebar(activeKey, user) {
    const counts = badgeCounts();
    const groupsHtml = NAV_GROUPS
      .filter(g => !g.superAdminOnly || user.role === "Super Admin")
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

    return `
      <aside class="sidebar" id="sidebar">
        <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Toggle sidebar"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="sidebar-header">
          <a href="dashboard.html" class="sidebar-logo">
            <div class="logo-mark"><i class="fa-solid fa-building-columns"></i></div>
            <span class="logo-text">BuildIQ</span>
            <span class="version-badge">v2.1</span>
          </a>
        </div>
        <div class="sidebar-org">
          <div class="org-name">${Utils.escapeHtml(user.org_name || "Organization")}</div>
          <div class="org-type">Construction Management</div>
        </div>
        <div class="sidebar-divider"></div>
        <nav class="sidebar-nav" aria-label="Primary">${groupsHtml}</nav>
        <div class="sidebar-footer">
          ${Components.createAvatar(user.name, "md")}
          <div class="user-meta">
            <div class="user-name">${Utils.escapeHtml(user.name)}</div>
            <div class="user-role">${Utils.escapeHtml(user.role)}</div>
          </div>
          <div class="sidebar-footer-actions">
            <button class="icon-btn" id="logoutBtn" aria-label="Log out" title="Log out"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
          </div>
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
          <button class="icon-btn" id="notifBtn" aria-label="Notifications"><i class="fa-solid fa-bell"></i><span class="dot-badge"></span></button>
          <button class="icon-btn" id="themeToggleBtn" aria-label="Toggle theme"><i class="fa-solid fa-moon"></i></button>
          <div class="user-chip" id="userMenuBtn">
            ${Components.createAvatar(user.name, "sm")}
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
      window.location.href = "settings.html";
    });

    // Notifications
    const notifBtn = document.getElementById("notifBtn");
    if (notifBtn) notifBtn.addEventListener("click", () => {
      Components.createToast("You have 3 new notifications.", "info");
    });

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
        ${data.members.map(m => `<a href="members.html" class="spotlight-item">${Components.createAvatar(m.full_name,"sm")} <span>${Utils.escapeHtml(m.full_name)}</span> ${Components.createBadge(m.role, Utils.roleColor(m.role))}</a>`).join("")}
      `);
      if (data.projects?.length) sections.push(`
        <div class="spotlight-group-label">Projects</div>
        ${data.projects.map(p => `<a href="projects.html" class="spotlight-item"><i class="fa-solid fa-diagram-project" style="color:var(--text-muted)"></i> <span>${Utils.escapeHtml(p.title)}</span> ${Components.createBadge(p.delay_risk, Utils.riskBadgeType(p.delay_risk))}</a>`).join("")}
      `);
      if (data.complaints?.length) sections.push(`
        <div class="spotlight-group-label">Complaints</div>
        ${data.complaints.map(c => `<a href="complaints.html" class="spotlight-item"><i class="fa-solid fa-triangle-exclamation" style="color:var(--text-muted)"></i> <span>${Utils.escapeHtml(c.category)}</span> ${Components.createBadge(c.severity, Utils.severityColor(c.severity))}</a>`).join("")}
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
  }

  return { render, NAV_GROUPS };
})();
