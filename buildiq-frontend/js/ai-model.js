/* ============================================================
   BuildIQ — ai-model.js

   Lets a user choose which AI model answers them, shared by the floating
   assistant and the full chatbot page so a choice made in one applies to both.

   The server holds an allowlist (settings.allowed_models). Anything this
   module sends that isn't on it is ignored and the configured default is used
   instead, so a stale preference in localStorage can never break chat or
   reach a model the deployment doesn't permit.
   ============================================================ */

const AIModel = (() => {

  const KEY = "buildiq_ai_model";

  let _models = [];      // [{id,label,context,supports_json,default}]
  let _loaded = false;

  /** Fetch the selectable list once per page. Failure is non-fatal. */
  async function load() {
    if (_loaded) return _models;
    try {
      const status = await API.getAIStatus();
      _models = status.selectable_models || [];
      // Drop a saved choice the server no longer offers.
      const saved = get();
      if (saved && !_models.some(m => m.id === saved)) clear();
    } catch (err) {
      console.warn("[AIModel] could not load model list:", err.message);
      _models = [];
    }
    _loaded = true;
    return _models;
  }

  function list() { return _models; }

  /** The user's chosen model id, or null to let the server decide. */
  function get() {
    try { return localStorage.getItem(KEY) || null; } catch { return null; }
  }

  function set(id) {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch { /* private browsing — fall back to the server default */ }
  }

  function clear() { set(null); }

  /** Short display name: strip the vendor prefix and the :free suffix. */
  function shortName(id) {
    if (!id) return "Default";
    return id.split("/").pop().replace(/:free$/, "");
  }

  /**
   * A <select> of the available models. Returns "" when there is nothing to
   * choose between, so the control simply doesn't appear on a single-model
   * deployment rather than showing a pointless dropdown.
   */
  function selectHtml(id = "aiModelSelect") {
    if (_models.length < 2) return "";
    const chosen = get();
    const opts = _models.map(m => {
      const sel = m.id === chosen ? " selected" : "";
      const json = m.supports_json === false ? " ·  basic JSON" : "";
      return `<option value="${Utils.escapeHtml(m.id)}"${sel}>${Utils.escapeHtml(shortName(m.id))}${json}</option>`;
    }).join("");
    return `<select class="input ai-model-select" id="${id}" title="Which AI model answers you">${opts}</select>`;
  }

  /** Wire a rendered <select> so changing it persists the choice. */
  function bind(id = "aiModelSelect", onChange = null) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      set(el.value);
      if (onChange) onChange(el.value);
    });
  }

  return { load, list, get, set, clear, shortName, selectHtml, bind };
})();

if (typeof window !== "undefined") window.AIModel = AIModel;
