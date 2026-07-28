/* ============================================================
   BuildIQ — api.js
   All fetch calls to the Python FastAPI backend.
   Standard fetch wrapper with Authorization header, 401 redirect,
   and error toast. Falls back to MockData when MOCK_MODE is on,
   so the whole UI works without any backend/keys.
   ============================================================ */

const API = (() => {
  const API_BASE = BUILDIQ_CONFIG.API_BASE;

  async function request(path, { method = "GET", body, params, auth = true } = {}) {
    let url = `${API_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== ""));
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }

    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = Auth.getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        Auth.logout({ silent: true });
        window.location.href = "index.html";
        throw new Error("Unauthorized");
      }

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        const message = (data && data.detail) || `Request failed (${res.status})`;
        if (window.Components) Components.createToast(message, "error");
        throw new Error(message);
      }
      return data;
    } catch (err) {
      if (err.message !== "Unauthorized" && window.Components && !err.__toasted) {
        Components.createToast(err.message || "Network error — is the backend running?", "error");
      }
      throw err;
    }
  }

  // ---------------- Mock-mode simulated latency ----------------
  const wait = (ms = 350) => new Promise(r => setTimeout(r, ms));

  const Mock = {
    async login(email, password) {
      await wait(500);
      const role = email.toLowerCase().includes("manager") ? "Manager" :
                   email.toLowerCase().includes("engineer") ? "Engineer" :
                   email.toLowerCase().includes("audit") ? "Auditor" : "Super Admin";
      return {
        token: "mock." + btoa(JSON.stringify({ role, email })) + ".token",
        user: {
          id: "mock_user_1",
          name: role === "Super Admin" ? "Admin User" : `${role} Demo`,
          email,
          role,
          department: role === "Manager" ? "Site Operations" : "General",
          org_name: "Wolaita Construction Group",
          avatar: null,
        },
        expires: Date.now() + 1000 * 60 * 60 * 24,
      };
    },
    async signup(payload) {
      await wait(600);
      return {
        token: "mock." + btoa(JSON.stringify({ role: payload.role || "Engineer" })) + ".token",
        user: {
          id: "mock_user_new",
          name: payload.full_name || "New User",
          email: payload.email,
          role: payload.role || "Engineer",
          department: payload.department || "General",
          org_name: payload.organization_name || "Wolaita Construction Group",
          avatar: null,
        },
        expires: Date.now() + 1000 * 60 * 60 * 24,
      };
    },
    async members(params = {}) {
      await wait();
      let list = [...MockData.members];
      if (params.department) list = list.filter(m => m.department === params.department);
      if (params.role) list = list.filter(m => m.role === params.role);
      if (params.status) list = list.filter(m => m.status === params.status);
      if (params.q) {
        const q = params.q.toLowerCase();
        list = list.filter(m => m.full_name.toLowerCase().includes(q) || m.skills.join(" ").toLowerCase().includes(q));
      }
      return list;
    },
    async smartSearchMembers(query) {
      await wait(700);
      const q = query.toLowerCase();
      const scored = MockData.members.map(m => {
        let score = 20 + Math.random() * 20;
        if (m.skills.join(" ").toLowerCase().includes(q)) score += 40;
        if (m.job_title.toLowerCase().includes(q)) score += 25;
        if (m.department.toLowerCase().includes(q)) score += 15;
        return { member: m, similarity_score: Math.min(99, Math.round(score)) };
      }).sort((a,b) => b.similarity_score - a.similarity_score).slice(0, 8);
      return scored;
    },
    async projects(params = {}) {
      await wait();
      let list = [...MockData.projects];
      if (params.type) list = list.filter(p => p.type === params.type);
      if (params.region) list = list.filter(p => p.region === params.region);
      if (params.risk) list = list.filter(p => p.delay_risk === params.risk);
      if (params.status) list = list.filter(p => p.status === params.status);
      if (params.q) {
        const q = params.q.toLowerCase();
        list = list.filter(p => p.title.toLowerCase().includes(q));
      }
      return list;
    },
    async analyzeProject(id) {
      await wait(900);
      const p = MockData.projects.find(p => p.id === id) || MockData.projects[0];
      const prob = Math.max(0.05, Math.min(0.97, (p.expected_progress - p.progress) / 60 + Math.random()*0.15));
      const risk_level = prob > 0.85 ? "CRITICAL" : prob > 0.65 ? "HIGH" : prob > 0.35 ? "MEDIUM" : "LOW";
      return {
        delay_probability: Number(prob.toFixed(2)),
        risk_level,
        key_risk_factors: ["Progress gap vs. schedule", "Material lead times", "Team allocation density"],
        groq_explanation: `${p.title} shows a ${(prob*100).toFixed(0)}% probability of delay based on current progress trends. The gap between actual (${p.progress}%) and expected (${p.expected_progress}%) completion is the primary driver. Recommend: (1) expedite pending material orders, (2) add a second shift on critical-path tasks, (3) review supplier SLAs for the coming two weeks.`,
      };
    },
    async complaints(params = {}) {
      await wait();
      let list = [...MockData.complaints];
      if (params.status) list = list.filter(c => c.status === params.status);
      if (params.severity) list = list.filter(c => c.severity === params.severity);
      return list;
    },
    async submitComplaintFeedback() { await wait(300); return { ok: true }; },
    async auditLogs(params = {}) {
      await wait();
      let list = [...MockData.auditLogs];
      if (params.flagged) list = list.filter(l => l.is_flagged);
      return list.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    },
    async auditAnomalies() {
      await wait();
      return MockData.auditLogs.filter(l => l.is_flagged).sort((a,b) => b.anomaly_score - a.anomaly_score);
    },
    async chat(message) {
      await wait(900);
      return { reply: MockData.chatbotReply(message) };
    },
    async searchGlobal(query) {
      await wait(300);
      const q = query.toLowerCase();
      return {
        members: MockData.members.filter(m => m.full_name.toLowerCase().includes(q)).slice(0,5),
        projects: MockData.projects.filter(p => p.title.toLowerCase().includes(q)).slice(0,5),
        complaints: MockData.complaints.filter(c => c.text.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)).slice(0,5),
      };
    },
  };

  // ---------------- Public API surface ----------------
  return {
    // Auth
    login: (email, password) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.login(email, password)
      : request("/auth/login", { method: "POST", body: { email, password }, auth: false }),

    signup: (payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.signup(payload)
      : request("/auth/signup", { method: "POST", body: payload, auth: false }),

    logout: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request("/auth/logout", { method: "POST" }),

    // Members
    getMembers: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.members(params) : request("/members", { params }),
    createMember: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id: Utils.uid("mem") }) : request("/members", { method: "POST", body: payload }),
    updateMember: (id, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id }) : request(`/members/${id}`, { method: "PUT", body: payload }),
    deleteMember: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request(`/members/${id}`, { method: "DELETE" }),
    smartSearchMembers: (query) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.smartSearchMembers(query) : request("/members/search/smart", { method: "POST", body: { query } }),

    // Departments
    getDepartments: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve(MockData.departments) : request("/departments"),

    // Projects
    getProjects: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.projects(params) : request("/projects", { params }),
    createProject: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id: Utils.uid("proj") }) : request("/projects", { method: "POST", body: payload }),
    updateProject: (id, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id }) : request(`/projects/${id}`, { method: "PUT", body: payload }),
    analyzeProject: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.analyzeProject(id) : request(`/projects/${id}/analyze`, { method: "POST" }),

    // Tasks
    getTasks: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve([]) : request("/tasks", { params }),

    // Complaints
    getComplaints: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.complaints(params) : request("/complaints", { params }),
    createComplaint: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id: "CMP-" + Utils.uid("") }) : request("/complaints", { method: "POST", body: payload }),
    resolveComplaint: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request(`/complaints/${id}/resolve`, { method: "PUT" }),
    complaintFeedback: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.submitComplaintFeedback() : request("/complaints/feedback", { method: "POST", body: payload }),

    // Audit
    getAuditLogs: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.auditLogs(params) : request("/audit/logs", { params }),
    getAuditAnomalies: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.auditAnomalies() : request("/audit/anomalies"),
    auditFeedback: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request("/audit/feedback", { method: "POST", body: payload }),
    getAuditStats: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({}) : request("/audit/stats"),

    // Reports
    generateReport: (payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Promise.resolve({ title: payload.type || "Report", generated_at: new Date().toISOString(), content: "This is a mock-generated report. Connect the backend (Groq + Supabase) for real AI-generated content." })
      : request("/reports/generate", { method: "POST", body: payload }),
    getReports: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve([]) : request("/reports"),

    // AI
    chat: (message, history = []) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.chat(message) : request("/ai/chat", { method: "POST", body: { message, history } }),
    aiSearch: (query) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.searchGlobal(query) : request("/ai/search", { method: "POST", body: { query } }),
    searchGlobal: (query) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.searchGlobal(query) : request("/ai/search", { method: "POST", body: { query } }),

    health: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ status: "online (mock)" }) : request("/health", { auth: false }),
  };
})();
