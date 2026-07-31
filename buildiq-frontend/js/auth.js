/* ============================================================
   BuildIQ — auth.js
   Session management: login, signup, token storage, role helpers
   ============================================================ */

const Auth = (() => {
  const TOKEN_KEY = "buildiq_token";
  const USER_KEY = "buildiq_user";
  const EXPIRES_KEY = "buildiq_expires";

  function getToken() { return localStorage.getItem(TOKEN_KEY); }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch { return null; }
  }

  function getExpiry() { return Number(localStorage.getItem(EXPIRES_KEY)) || 0; }

  function isLoggedIn() {
    return !!getToken() && !!getUser() && Date.now() < getExpiry();
  }

  function setSession({ token, user, expires }) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(EXPIRES_KEY, String(expires));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    localStorage.removeItem("buildiq_active_role");
  }

  async function login(email, password, portal = null) {
    const res = await API.login(email, password, portal);
    setSession(res);
    return res.user;
  }

  async function signup(payload) {
    const res = await API.signup(payload);
    setSession(res);
    return res.user;
  }

  // Where a signed-out user should land. Oversight roles came in through the
  // unlisted administrator portal, so send them back there rather than
  // dumping them on the public staff page. Read the role BEFORE the session
  // is cleared, since that is the only place it is recorded.
  const STAFF_LOGIN = "index";
  const ADMIN_LOGIN = "admin";

  function loginPageFor(user) {
    const u = user || getUser();
    const roles = (u && Array.isArray(u.roles) && u.roles.length) ? u.roles : (u ? [u.role] : []);
    const privileged = window.Roles
      ? roles.some(r => Roles.usesPrivilegedLogin(r))
      : false;
    return privileged ? ADMIN_LOGIN : STAFF_LOGIN;
  }

  function logout({ silent = false } = {}) {
    const target = loginPageFor();
    clearSession();
    if (!silent) window.location.href = target;
  }

  // ---------------- Multi-role support ----------------
  // A person can hold several roles (e.g. a Department Manager who also runs
  // projects). `user.roles` lists them all; `user.role` is whichever one is
  // currently active. Every other module keeps reading `user.role`, so nothing
  // else needs to know about this.
  const ACTIVE_ROLE_KEY = "buildiq_active_role";

  function getRoles() {
    const user = getUser();
    if (!user) return [];
    const list = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role];
    // De-duplicate while preserving order, and drop anything falsy.
    return [...new Set(list.filter(Boolean))];
  }

  function hasMultipleRoles() { return getRoles().length > 1; }

  function getActiveRole() {
    const user = getUser();
    return user ? user.role : null;
  }

  // Per-role overrides (department differs by hat, e.g. a PM isn't
  // department-scoped). Stored on the user as `role_contexts`.
  function contextFor(user, role) {
    const ctx = (user.role_contexts || {})[role] || {};
    return {
      department: "department" in ctx ? ctx.department : user.department,
      job_title: ctx.job_title || user.job_title || null,
    };
  }

  function switchRole(role) {
    const user = getUser();
    if (!user) return false;
    const roles = getRoles();
    if (!roles.includes(role)) return false;      // never grant a role they don't hold
    if (user.role === role) return true;          // already active

    const ctx = contextFor(user, role);
    const updated = { ...user, role, department: ctx.department, job_title: ctx.job_title };

    localStorage.setItem(USER_KEY, JSON.stringify(updated));
    localStorage.setItem(ACTIVE_ROLE_KEY, role);

    // Leave a trail — switching hats is a permission-relevant action.
    try {
      if (window.MockData?.logAuditEvent) {
        AppEvents.logAudit(updated, "ROLE_MISUSE", `auth/role-switch/${role}`);
      }
    } catch { /* auditing must never block the switch */ }

    return true;
  }

  // Restore the last active role on load, if it's still one they hold.
  function restoreActiveRole() {
    const user = getUser();
    if (!user) return;
    const saved = localStorage.getItem(ACTIVE_ROLE_KEY);
    if (saved && saved !== user.role && getRoles().includes(saved)) {
      switchRole(saved);
    }
  }

  function hasRole(...roles) {
    const user = getUser();
    return !!user && roles.includes(user.role);
  }

  // True if the person holds the role at all, whether or not it's active.
  function holdsRole(role) { return getRoles().includes(role); }

  // If the token expires in under 5 minutes, refresh it. In mock mode this just
  // mints a new fake token; in real mode it calls POST /auth/refresh.
  let refreshing = null;
  function maybeRefresh() {
    if (!isLoggedIn()) return Promise.resolve(false);
    const msLeft = getExpiry() - Date.now();
    if (msLeft >= 5 * 60 * 1000) return Promise.resolve(false);
    if (refreshing) return refreshing;

    refreshing = API.refreshToken()
      .then(res => {
        // Keep the existing user object if the server didn't return one.
        setSession({ token: res.token, user: res.user || getUser(), expires: res.expires });
        return true;
      })
      .catch(() => {
        // Refresh failed — the session is no longer trustworthy.
        const target = loginPageFor();
        logout({ silent: true });
        window.location.href = target;
        return false;
      })
      .finally(() => { refreshing = null; });

    return refreshing;
  }

  return { getToken, getUser, getExpiry, isLoggedIn, setSession, clearSession, login, signup, logout,
    loginPageFor, STAFF_LOGIN, ADMIN_LOGIN,
    hasRole, holdsRole, maybeRefresh,
    getRoles, hasMultipleRoles, getActiveRole, switchRole, restoreActiveRole };
})();
