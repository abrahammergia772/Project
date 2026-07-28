/* ============================================================
   BuildIQ — router.js
   Role-based access control. Runs on every protected page load.
   ============================================================ */

const Router = (() => {

  // Access matrix straight from the spec (A.6)
  // true = full access, "own" = read own data only, false = no access
  const ACCESS = {
    dashboard:        { "Super Admin": true, "Manager": true,  "Engineer": true,  "Auditor": true  },
    members:          { "Super Admin": true, "Manager": true,  "Engineer": "own", "Auditor": false },
    departments:      { "Super Admin": true, "Manager": true,  "Engineer": "own", "Auditor": false },
    projects:         { "Super Admin": true, "Manager": true,  "Engineer": "own", "Auditor": false },
    tasks:            { "Super Admin": true, "Manager": true,  "Engineer": true,  "Auditor": false },
    complaints:       { "Super Admin": true, "Manager": true,  "Engineer": true,  "Auditor": false },
    audit:            { "Super Admin": true, "Manager": false, "Engineer": false, "Auditor": true  },
    reports:          { "Super Admin": true, "Manager": true,  "Engineer": false, "Auditor": true  },
    chatbot:          { "Super Admin": true, "Manager": true,  "Engineer": true,  "Auditor": false },
    settings:         { "Super Admin": true, "Manager": false, "Engineer": false, "Auditor": false },
    user_management:  { "Super Admin": true, "Manager": false, "Engineer": false, "Auditor": false },
  };

  function pageKeyFromFile(file) {
    return file.replace(".html", "");
  }

  function currentPageKey() {
    const file = location.pathname.split("/").pop() || "index.html";
    return pageKeyFromFile(file);
  }

  function accessFor(pageKey, role) {
    const rule = ACCESS[pageKey];
    if (!rule) return true; // unlisted pages (index) are public/handled separately
    return rule[role] ?? false;
  }

  function canAccess(pageKey) {
    const user = Auth.getUser();
    if (!user) return false;
    return accessFor(pageKey, user.role) !== false;
  }

  // Call at top of every protected page's inline script
  function guard() {
    if (!Auth.isLoggedIn()) {
      window.location.href = "index.html";
      return false;
    }
    Auth.maybeRefresh();
    const pageKey = currentPageKey();
    if (pageKey === "index") return true;

    const access = accessFor(pageKey, Auth.getUser().role);
    if (access === false) {
      sessionStorage.setItem("buildiq_access_denied", "1");
      window.location.href = "dashboard.html";
      return false;
    }
    return true;
  }

  // Show "Access Denied" toast if redirected here because of it
  function showAccessDeniedIfNeeded() {
    if (sessionStorage.getItem("buildiq_access_denied")) {
      sessionStorage.removeItem("buildiq_access_denied");
      setTimeout(() => Components.createToast("Access denied — you don't have permission to view that page.", "error"), 300);
    }
  }

  return { ACCESS, canAccess, accessFor, guard, showAccessDeniedIfNeeded, currentPageKey };
})();
