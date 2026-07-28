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
  }

  async function login(email, password) {
    const res = await API.login(email, password);
    setSession(res);
    return res.user;
  }

  async function signup(payload) {
    const res = await API.signup(payload);
    setSession(res);
    return res.user;
  }

  function logout({ silent = false } = {}) {
    clearSession();
    if (!silent) window.location.href = "index.html";
  }

  function hasRole(...roles) {
    const user = getUser();
    return !!user && roles.includes(user.role);
  }

  // Auto-refresh stub: if token expiring in <5min, in mock mode just extend it.
  function maybeRefresh() {
    if (!isLoggedIn()) return;
    const msLeft = getExpiry() - Date.now();
    if (msLeft < 5 * 60 * 1000) {
      if (BUILDIQ_CONFIG.MOCK_MODE) {
        localStorage.setItem(EXPIRES_KEY, String(Date.now() + 1000 * 60 * 60 * 24));
      }
      // Real mode would call API.refresh() here.
    }
  }

  return { getToken, getUser, getExpiry, isLoggedIn, setSession, clearSession, login, signup, logout, hasRole, maybeRefresh };
})();
