/* ============================================================
   BuildIQ — spa.js

   Single-page app router. Keeps the browser on ONE url —
   https://cmsai.onrender.com — while swapping page content in place.

   HOW IT WORKS
   ------------
   app.html loads every page module up front, then this module:

     1. reads the requested page from ?p= or a nav click,
     2. runs the same Router access check the old pages used,
     3. calls that page's init(), which renders into #pageContent.

   WHY THE URL IS SCRUBBED
   -----------------------
   The requirement was that the address bar shows only the bare domain. A real
   path (/dashboard) would show a path, and on a static host a deep path also
   needs a rewrite rule to survive a refresh. history.replaceState back to the
   origin keeps the visible url clean.

   THE TRADE-OFF, STATED PLAINLY
   -----------------------------
   Because no per-page url is exposed:
     * the browser Back button leaves the app instead of stepping back a page;
     * you cannot bookmark or share a link to a specific page.
   The current page is kept in sessionStorage, so a refresh returns you to the
   page you were on rather than always the dashboard.
   ============================================================ */

const SPA = (() => {

  const LAST_PAGE_KEY = "buildiq_spa_page";
  const DEFAULT_PAGE = "dashboard";

  // page key -> the global that exposes init()
  const PAGES = {
    dashboard:       "DashboardPage",
    projects:        "ProjectsPage",
    members:         "MembersPage",
    departments:     "DepartmentsPage",
    tasks:           "TasksPage",
    complaints:      "ComplaintsPage",
    attendance:      "AttendancePage",
    audit:           "AuditPage",
    reports:         "ReportsPage",
    documents:       "DocumentsPage",
    chatbot:         "ChatbotPage",
    ai_insights:     "AIInsightsPage",
    settings:        "SettingsPage",
    user_management: "UserManagementPage",
  };

  let current = null;

  /** Which page to open on load. */
  function initialPage() {
    const asked = new URLSearchParams(location.search).get("p");
    if (asked && PAGES[asked]) return asked;
    try {
      const last = sessionStorage.getItem(LAST_PAGE_KEY);
      if (last && PAGES[last]) return last;
    } catch (e) { /* private browsing */ }
    return DEFAULT_PAGE;
  }

  /** Strip path and query so the address bar shows just the origin. */
  function cleanUrl() {
    try {
      if (location.search || location.pathname !== "/") {
        history.replaceState(null, "", location.origin + "/");
      }
    } catch (e) { /* cosmetic only */ }
  }

  /**
   * Show a page.
   *
   * Access is re-checked on every navigation, not only at load: a user can
   * switch roles mid-session, and a role that loses access to the current
   * page must not keep seeing it.
   */
  async function go(page, opts) {
    const silent = !!(opts && opts.silent);
    if (!PAGES[page]) page = DEFAULT_PAGE;

    const user = Auth.getUser();
    if (!user) { Auth.logout(); return false; }

    if (Router.accessFor(page, user.role, user) === false) {
      if (!silent) {
        Components.createToast(
          "Access denied — you don't have permission to view that page.", "error");
      }
      if (page === DEFAULT_PAGE) return false;      // never loop
      return go(DEFAULT_PAGE, { silent: true });
    }

    current = page;
    try { sessionStorage.setItem(LAST_PAGE_KEY, page); } catch (e) { /* ignore */ }

    Shell.render(page);

    const mod = window[PAGES[page]];
    if (!mod || typeof mod.init !== "function") {
      document.getElementById("pageContent").innerHTML =
        Components.createEmptyState("fa-triangle-exclamation", "Page unavailable",
          "That module did not load. Please reload the app.");
      return false;
    }

    try {
      await mod.init();
    } catch (err) {
      console.error("[SPA] " + page + ".init() failed:", err);
      document.getElementById("pageContent").innerHTML =
        Components.createEmptyState("fa-triangle-exclamation", "Something went wrong",
          "This page could not be displayed. Please reload the app.");
    }

    cleanUrl();
    if (window.scrollTo) window.scrollTo(0, 0);
    return true;
  }

  function currentPage() { return current; }

  /**
   * Intercept in-app navigation.
   *
   * Links keep their href (e.g. href="projects?risk=HIGH") so they still work
   * if this script fails to load, and so no page markup needed changing.
   */
  function interceptLinks() {
    document.addEventListener("click", function (e) {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#" || a.target === "_blank") return;
      if (/^(https?:|mailto:|tel:|blob:|data:)/.test(href)) return;

      const parts = href.replace(/\.html$/, "").split("?");
      const page = parts[0].replace(/^\.?\//, "");
      const query = parts[1];
      if (!PAGES[page]) return;                     // index/admin fall through

      e.preventDefault();
      // Pages read their filters from location.search, so publish it first.
      if (query) {
        try { history.replaceState(null, "", "?" + query); } catch (err) { /* ignore */ }
      }
      go(page);
    });
  }

  async function start() {
    if (!Router.guard()) return;                    // redirects when signed out
    interceptLinks();
    await go(initialPage(), { silent: true });
  }

  return { PAGES, start, go, currentPage, initialPage };
})();

if (typeof window !== "undefined") window.SPA = SPA;
