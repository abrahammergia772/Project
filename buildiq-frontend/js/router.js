/* ============================================================
   BuildIQ — router.js
   Role-based access control. Runs on every protected page load.
   ============================================================ */

const Router = (() => {

  // Access matrix (updated for the 6-role model)
  // true = full access, "own" = read own/department data only, false = no access
  const ACCESS = {
    dashboard:        { "Super Admin": true, "General Manager": true, "Department Manager": true,  "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": true  },
    members:          { "Super Admin": true, "General Manager": true, "Department Manager": "own",  "Project Manager": "own", "Engineer": "own", "Auditor": false, "Client": false },
    departments:      { "Super Admin": true, "General Manager": true, "Department Manager": "own",  "Project Manager": "own", "Engineer": "own", "Auditor": true,  "Client": false },
    // Auditor now has full org-wide project visibility (read-only), alongside
    // Super Admin and General Manager. Everyone else sees only their own work.
    projects:         { "Super Admin": true, "General Manager": true, "Department Manager": "own",  "Project Manager": "own", "Engineer": "own", "Auditor": true,  "Client": "own" },
    // Auditor gets task access so they can assign remedial/compliance work.
    tasks:            { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": false },
    complaints:       { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": false, "Client": true  },
    // Engineers get "own" access: they can't take attendance or see the org
    // register, but they can review their own absence days and explain them.
    // Engineers get "own" by default (their own absence days). Engineers in
    // the Workforce & Attendance department also take the register for the
    // whole organization, so guard() upgrades them -- see workforceOverride().
    attendance:       { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": "own", "Engineer": "own", "Auditor": true,  "Client": false },
    audit:            { "Super Admin": true, "General Manager": true, "Department Manager": false,  "Project Manager": false, "Engineer": false, "Auditor": true,  "Client": false },
    reports:          { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": false, "Auditor": true,  "Client": true  },
    chatbot:          { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": false, "Client": true  },
    // AI Insights surfaces every AI feature, each tab scoped to the role.
    // Auditors get it (unlike the chatbot) because anomaly detection is theirs.
    ai_insights:      { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": true  },
    documents:        { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": true  },
    // Direct messages: every internal role. Clients reach the org through
    // complaints instead, so they have no inbox.
    messages:         { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": false },
    settings:         { "Super Admin": true, "General Manager": true, "Department Manager": true,   "Project Manager": true, "Engineer": true,  "Auditor": true,  "Client": true  },
    user_management:  { "Super Admin": true, "General Manager": true, "Department Manager": false,  "Project Manager": false, "Engineer": false, "Auditor": false, "Client": false },
  };

  function pageKeyFromFile(file) {
    return file.replace(".html", "");
  }

  function currentPageKey() {
    const file = location.pathname.split("/").pop() || "index.html";
    return pageKeyFromFile(file);
  }

  function accessFor(pageKey, role, user = null) {
    const rule = ACCESS[pageKey];
    if (!rule) return true; // unlisted pages (index) are public/handled separately
    const base = rule[role] ?? false;
    // Department overrides role: anyone in Workforce & Attendance runs the
    // register for the entire organization, whatever their job title.
    if (pageKey === "attendance" && base === "own") {
      const u = user || (window.Auth ? Auth.getUser() : null);
      if (u && window.Roles && Roles.canTakeAttendance(u)) return true;
    }
    return base;
  }

  function canAccess(pageKey) {
    const user = Auth.getUser();
    if (!user) return false;
    return accessFor(pageKey, user.role) !== false;
  }

  // Call at top of every protected page's inline script
  /**
   * Remove the auth cloak so the page becomes visible.
   *
   * Authenticated pages ship `body{visibility:hidden}` so nothing paints
   * before we know there is a valid session. Every path that returns true
   * from guard() must call this, and every path that returns false must NOT
   * -- the page stays blank while the browser navigates away.
   */
  function reveal() {
    const cloak = document.getElementById("authCloak");
    if (cloak) cloak.remove();
  }

  function guard() {
    if (!Auth.isLoggedIn()) {
      // Deliberately no reveal(): stay hidden through the redirect.
      window.location.href = Auth.loginPageFor ? Auth.loginPageFor() : "index.html";
      return false;
    }
    Auth.maybeRefresh();
    // Re-apply the role the user last switched to, before any access check.
    Auth.restoreActiveRole();
    const pageKey = currentPageKey();
    if (pageKey === "index") { reveal(); return true; }

    const access = accessFor(pageKey, Auth.getUser().role, Auth.getUser());
    if (access === false) {
      // Signed in, but not allowed here. Stay hidden while we bounce to the
      // dashboard so the forbidden page never paints.
      sessionStorage.setItem("buildiq_access_denied", "1");
      // Inside the SPA this is handled by SPA.go(); this line only
      // runs on the standalone pages, which are still served.
      window.location.href = "dashboard";
      return false;
    }
    reveal();
    return true;
  }

  // Safety net: if a page somehow never calls guard() -- a scripting error, a
  // page added without the standard footer -- the cloak would leave it blank
  // forever. Reveal on load for anyone already signed in, so a bug degrades to
  // "visible" rather than "permanently broken".
  if (typeof window !== "undefined") {
    window.addEventListener("load", () => {
      if (document.getElementById("authCloak") && Auth.isLoggedIn()) reveal();
    });
  }

  // Show "Access Denied" toast if redirected here because of it
  function showAccessDeniedIfNeeded() {
    if (sessionStorage.getItem("buildiq_access_denied")) {
      sessionStorage.removeItem("buildiq_access_denied");
      setTimeout(() => Components.createToast("Access denied — you don't have permission to view that page.", "error"), 300);
    }
  }

  return { ACCESS, canAccess, accessFor, guard, reveal, showAccessDeniedIfNeeded, currentPageKey };
})();
