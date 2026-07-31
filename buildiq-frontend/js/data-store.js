/* ============================================================
   BuildIQ — data-store.js

   A single in-memory cache of server data, loaded once per page.

   WHY THIS EXISTS
   ---------------
   Pages used to read `MockData.projects`, `MockData.members` and friends
   directly. Those reads were unconditional -- they ignored MOCK_MODE -- so a
   deployment pointed at a real API still rendered fabricated numbers on the
   dashboard, AI Insights, attendance and user management screens. The page
   would fetch real data via `API.*` for its table, then compute its summary
   cards from mock arrays sitting in the bundle.

   `DataStore.load()` pulls the collections a page needs from the API once,
   then exposes them synchronously (`DataStore.projects`) so the existing
   render code -- much of which is synchronous -- keeps working unchanged.

   In MOCK_MODE the API layer already returns MockData, so this works for the
   offline demo too, without any page needing to know which mode it is in.
   ============================================================ */

const DataStore = (() => {

  // Every collection starts empty. A page that renders before load()
  // resolves sees zeroes, never invented data.
  const state = {
    projects: [],
    members: [],
    departments: [],
    tasks: [],
    complaints: [],
    clients: [],
    dailyWorkers: [],
    attendance: [],
    absenceReasons: [],
    documents: [],
    auditLogs: [],
    notifications: [],
    stats: null,
  };

  // Which API call backs each collection.
  const LOADERS = {
    projects:       () => API.getProjects(),
    members:        () => API.getMembers(),
    departments:    () => API.getDepartments(),
    tasks:          () => API.getTasks(),
    complaints:     () => API.getComplaints(),
    clients:        () => API.getClients(),
    dailyWorkers:   () => API.getDailyWorkers(),
    attendance:     () => API.getAttendance(),
    absenceReasons: () => API.getAbsenceReasons(),
    documents:      () => API.getDocuments(),
    auditLogs:      () => API.getAuditLogs(),
    notifications:  () => API.getNotifications(),
    stats:          () => API.getDashboardStats(),
  };

  const loaded = new Set();
  const inflight = new Map();

  /**
   * Fetch the named collections in parallel.
   *
   * Failures are logged and leave the collection empty rather than throwing:
   * one unavailable endpoint should degrade a single card, not blank the page.
   *
   * @param {string[]} keys  collections to load
   * @param {object}   opts  { force: true } to bypass the cache
   */
  async function load(keys, { force = false } = {}) {
    const wanted = keys.filter(k => LOADERS[k] && (force || !loaded.has(k)));
    await Promise.all(wanted.map(async (key) => {
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          const data = await LOADERS[key]();
          state[key] = data ?? (key === "stats" ? null : []);
          loaded.add(key);
        } catch (err) {
          console.error(`[DataStore] failed to load "${key}":`, err.message);
          // Leave the previous value (usually []) in place.
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    }));
    return state;
  }

  /** Drop caches so the next load() re-fetches. Call after a mutation. */
  function invalidate(...keys) {
    if (!keys.length) { loaded.clear(); return; }
    keys.forEach(k => loaded.delete(k));
  }

  /** True once a collection has been fetched at least once. */
  function isLoaded(key) { return loaded.has(key); }

  // ---- Lookup helpers, mirroring the old MockData.getXById signatures ----
  const byId = (list, id) => state[list].find(x => x.id === id) || null;

  return {
    load, invalidate, isLoaded,

    get projects()       { return state.projects; },
    get members()        { return state.members; },
    get departments()    { return state.departments; },
    get tasks()          { return state.tasks; },
    get complaints()     { return state.complaints; },
    get clients()        { return state.clients; },
    get dailyWorkers()   { return state.dailyWorkers; },
    get attendance()     { return state.attendance; },
    get absenceReasons() { return state.absenceReasons; },
    get documents()      { return state.documents; },
    get auditLogs()      { return state.auditLogs; },
    get notifications()  { return state.notifications; },
    get stats()          { return state.stats; },

    getMemberById:      (id) => byId("members", id),
    getProjectById:     (id) => byId("projects", id),
    getClientById:      (id) => byId("clients", id),
    getDailyWorkerById: (id) => byId("dailyWorkers", id),
    getMemberByName:    (name) => state.members.find(m => m.full_name === name) || null,
    getDepartmentByName: (name) =>
      state.departments.find(d => (d.name || "").toLowerCase() === String(name || "").toLowerCase()) || null,
    getProjectsManagedBy: (userId) => state.projects.filter(p => p.manager_id === userId),
  };
})();

if (typeof window !== "undefined") window.DataStore = DataStore;
