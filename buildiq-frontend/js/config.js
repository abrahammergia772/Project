/* ============================================================
   BuildIQ — config.js
   Global runtime config: toggle MOCK_MODE to run without a backend.
   ============================================================ */

const BUILDIQ_CONFIG = {
  // true  -> use in-browser mock data (MockData), no network calls, works offline
  // false -> call the real FastAPI backend at API_BASE
  MOCK_MODE: true,
  API_BASE: (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:8000"
    : "https://buildiq-api.onrender.com",
};
