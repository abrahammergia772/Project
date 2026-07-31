/* ============================================================
   BuildIQ — config.js
   Global runtime config: toggle MOCK_MODE to run without a backend.
   ============================================================ */

const BUILDIQ_CONFIG = {
  // true  -> use in-browser mock data (MockData), no network calls, works offline
  // false -> call the real FastAPI backend at API_BASE
  MOCK_MODE: false,

  // The deployed API. Frontend and backend are separate Render services, so
  // this must be the FULL origin of the API service -- no trailing slash and
  // no path.
  //
  // NOTE: the key is API_BASE, not API_BASE_URL. Every call site reads
  // BUILDIQ_CONFIG.API_BASE; a mismatched name silently yields `undefined`
  // and every request goes to "undefined/auth/login".
  API_BASE: (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:8000"
    : "https://constructionai-q9er.onrender.com",
};

// ---- Compatibility + validation -------------------------------------------
// Accept API_BASE_URL as an alias so an older/hand-edited config keeps working
// instead of failing with an opaque "Failed to fetch".
(function normalizeConfig(cfg) {
  if (!cfg.API_BASE && cfg.API_BASE_URL) cfg.API_BASE = cfg.API_BASE_URL;
  if (typeof cfg.API_BASE === "string") {
    // A trailing slash produces "//auth/login"; some proxies 404 on that.
    cfg.API_BASE = cfg.API_BASE.trim().replace(/\/+$/, "");
  }
  // Keep the alias in sync for anything that reads the other spelling.
  cfg.API_BASE_URL = cfg.API_BASE;

  if (!cfg.MOCK_MODE && !cfg.API_BASE) {
    console.error(
      "[BuildIQ] MOCK_MODE is false but API_BASE is not set. " +
      "Every API call will fail. Set API_BASE to your backend URL, " +
      "or set MOCK_MODE: true to run without a backend."
    );
  }
})(BUILDIQ_CONFIG);
