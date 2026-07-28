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

  // Maps a demo email/role-chip login to one of our pre-seeded fixed
  // identities in mock-data.js so every role lands on believable data.
  function resolveDemoUser(email, roleHint) {
    const e = (email || "").toLowerCase();
    let role = roleHint;
    if (!role) {
      if (e.includes("general") || e.includes("gm")) role = "General Manager";
      else if (e.includes("department") || e.includes("manager")) role = "Department Manager";
      else if (e.includes("engineer")) role = "Engineer";
      else if (e.includes("audit")) role = "Auditor";
      else if (e.includes("client")) role = "Client";
      else role = "Super Admin";
    }
    if (role === "Client") {
      const client = MockData.clients[0];
      return {
        id: client.id, name: client.contact_name, email: client.email, role: "Client",
        department: null, org_name: client.company, avatar: null, client_id: client.id,
      };
    }
    let member;
    if (role === "Super Admin") member = MockData.getMemberById("mem_1");
    else if (role === "General Manager") member = MockData.getMemberById("mem_2");
    else if (role === "Department Manager") member = MockData.getMemberById("mem_dm_1"); // Site Operations manager
    else if (role === "Auditor") member = MockData.getMemberById("mem_5");
    else member = MockData.getMemberById("mem_6"); // Engineer

    return {
      id: member.id, name: member.full_name, email: email || member.email, role: member.role,
      department: member.department, org_name: "Wolaita Construction Group", avatar: null,
    };
  }

  const Mock = {
    async login(email, password) {
      await wait(500);
      const user = resolveDemoUser(email, null);
      return {
        token: "mock." + btoa(JSON.stringify({ role: user.role, email: user.email })) + ".token",
        user,
        expires: Date.now() + 1000 * 60 * 60 * 24,
      };
    },
    async signup(payload) {
      await wait(600);
      const role = payload.role || "Engineer";
      return {
        token: "mock." + btoa(JSON.stringify({ role })) + ".token",
        user: {
          id: "mock_user_new",
          name: payload.full_name || "New User",
          email: payload.email,
          role,
          department: role === "Client" ? null : (payload.department || "General"),
          org_name: role === "Client" ? (payload.organization_name || "New Client Co.") : (payload.organization_name || "Wolaita Construction Group"),
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
      if (params.department) list = list.filter(p => p.department === params.department);
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
    async departmentDetail(id) {
      await wait(400);
      const dept = MockData.departments.find(d => d.id === id);
      if (!dept) return null;
      const deptMembers = MockData.members.filter(m => m.department === dept.name);
      const deptProjects = MockData.projects.filter(p => p.department === dept.name);
      const deptComplaints = MockData.complaints.filter(c => c.department === dept.name);
      const health = AIEngine.departmentHealth(dept, MockData.projects, MockData.members, MockData.complaints);
      return { ...dept, members: deptMembers, projects: deptProjects, complaints: deptComplaints, health };
    },
    async addMaterial(projectId, payload) {
      await wait(400);
      const project = MockData.getProjectById(projectId);
      if (!project) throw new Error("Project not found");
      const quantity = Number(payload.quantity) || 0;
      const unitPrice = Number(payload.unit_price) || 0;
      const material = {
        id: MockData.nextMaterialId(),
        project_id: projectId,
        name: payload.name,
        unit: payload.unit || "unit",
        quantity,
        unit_price: unitPrice,
        total_cost: Number((quantity * unitPrice).toFixed(2)),
        supplier: payload.supplier || "Unspecified",
        purchased_at: payload.purchased_at ? new Date(payload.purchased_at).toISOString() : new Date().toISOString(),
        purchased_by: payload.purchased_by || (Auth.getUser() || {}).name || "Unknown",
      };
      project.materials = project.materials || [];
      project.materials.unshift(material);
      MockData.recalcMaterialsTotal(project);
      return material;
    },
    async updateMaterial(projectId, materialId, payload) {
      await wait(400);
      const project = MockData.getProjectById(projectId);
      if (!project) throw new Error("Project not found");
      const material = (project.materials || []).find(m => m.id === materialId);
      if (!material) throw new Error("Material not found");
      Object.assign(material, {
        name: payload.name ?? material.name,
        unit: payload.unit ?? material.unit,
        quantity: payload.quantity !== undefined ? Number(payload.quantity) : material.quantity,
        unit_price: payload.unit_price !== undefined ? Number(payload.unit_price) : material.unit_price,
        supplier: payload.supplier ?? material.supplier,
        purchased_at: payload.purchased_at ? new Date(payload.purchased_at).toISOString() : material.purchased_at,
      });
      material.total_cost = Number((material.quantity * material.unit_price).toFixed(2));
      MockData.recalcMaterialsTotal(project);
      return material;
    },
    async deleteMaterial(projectId, materialId) {
      await wait(300);
      const project = MockData.getProjectById(projectId);
      if (!project) throw new Error("Project not found");
      project.materials = (project.materials || []).filter(m => m.id !== materialId);
      MockData.recalcMaterialsTotal(project);
      return { ok: true };
    },
    async tasks(params = {}) {
      await wait();
      let list = [...MockData.tasks];
      if (params.assignee_id) list = list.filter(t => t.assignee_id === params.assignee_id);
      if (params.department) list = list.filter(t => t.department === params.department);
      if (params.status) list = list.filter(t => t.status === params.status);
      return list;
    },
    async prioritizeTasks(tasks) {
      await wait(500);
      return AIEngine.prioritizeTasks(tasks);
    },
    async autoSchedule(tasks) {
      await wait(600);
      return AIEngine.autoSchedule(tasks);
    },
    async complaints(params = {}) {
      await wait();
      let list = [...MockData.complaints];
      if (params.status) list = list.filter(c => c.status === params.status);
      if (params.severity) list = list.filter(c => c.severity === params.severity);
      if (params.department) list = list.filter(c => c.department === params.department);
      return list;
    },
    async submitComplaintFeedback() { await wait(300); return { ok: true }; },
    async suggestComplaintSolution(complaint) {
      await wait(700);
      return { solution: AIEngine.suggestComplaintSolution(complaint) };
    },
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
    async chat(message, history, user) {
      await wait(900);
      return { reply: MockData.chatbotReply(message, user) };
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
    async generateReport(payload) {
      await wait(1000);
      const user = Auth.getUser();
      const scope = payload.scope || "Entire Organization";
      let projects = MockData.projects, complaints = MockData.complaints, members = MockData.members;
      if (user.role === "Department Manager") {
        projects = projects.filter(p => p.department === user.department);
        complaints = complaints.filter(c => c.department === user.department);
        members = members.filter(m => m.department === user.department);
      } else if (user.role === "Client") {
        projects = projects.filter(p => p.client_id === user.client_id || p.client_id === user.id);
        complaints = complaints.filter(c => c.submitted_by === user.id);
        members = [];
      } else if (scope !== "Entire Organization") {
        projects = projects.filter(p => p.department === scope);
        complaints = complaints.filter(c => c.department === scope);
        members = members.filter(m => m.department === scope);
      }

      let rankedAbsences = [];
      if (payload.type === "Attendance & Absence Report") {
        const attendanceScope = Roles.visibleAttendance(user, MockData.attendance)
          .filter(a => scope === "Entire Organization" || !Roles.ORG_WIDE.includes(user.role) ? true : a.department === scope);
        rankedAbsences = AIEngine.rankAbsences(attendanceScope);
      }

      const content = AIEngine.buildReportNarrative(payload.type, scope, { projects, complaints, members, department: user.department, rankedAbsences });
      return {
        title: payload.type, generated_at: new Date().toISOString(), content,
        stats: { projects: projects.length, complaints: complaints.length, members: members.length },
        rankedAbsences,
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
    getDepartmentDetail: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.departmentDetail(id) : request(`/departments/${id}`),

    // Materials (project cost tracking)
    addMaterial: (projectId, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.addMaterial(projectId, payload) : request(`/projects/${projectId}/materials`, { method: "POST", body: payload }),
    updateMaterial: (projectId, materialId, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.updateMaterial(projectId, materialId, payload) : request(`/projects/${projectId}/materials/${materialId}`, { method: "PUT", body: payload }),
    deleteMaterial: (projectId, materialId) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.deleteMaterial(projectId, materialId) : request(`/projects/${projectId}/materials/${materialId}`, { method: "DELETE" }),

    // Projects
    getProjects: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.projects(params) : request("/projects", { params }),
    createProject: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id: Utils.uid("proj") }) : request("/projects", { method: "POST", body: payload }),
    updateProject: (id, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id }) : request(`/projects/${id}`, { method: "PUT", body: payload }),
    analyzeProject: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.analyzeProject(id) : request(`/projects/${id}/analyze`, { method: "POST" }),

    // Tasks (#5 — AI priority + scheduling)
    getTasks: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.tasks(params) : request("/tasks", { params }),
    aiPrioritizeTasks: (tasks) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.prioritizeTasks(tasks) : request("/tasks/ai/prioritize", { method: "POST", body: { tasks } }),
    aiAutoSchedule: (tasks) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.autoSchedule(tasks) : request("/tasks/ai/schedule", { method: "POST", body: { tasks } }),

    // Complaints (#6 — role-scoped read/resolve, AI solution suggestion)
    getComplaints: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.complaints(params) : request("/complaints", { params }),
    createComplaint: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id: "CMP-" + Utils.uid("") }) : request("/complaints", { method: "POST", body: payload }),
    resolveComplaint: (id, note) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request(`/complaints/${id}/resolve`, { method: "PUT", body: { note } }),
    complaintFeedback: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.submitComplaintFeedback() : request("/complaints/feedback", { method: "POST", body: payload }),
    suggestComplaintSolution: (complaint) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.suggestComplaintSolution(complaint) : request("/complaints/ai/suggest-solution", { method: "POST", body: complaint }),

    // Audit
    getAuditLogs: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.auditLogs(params) : request("/audit/logs", { params }),
    getAuditAnomalies: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.auditAnomalies() : request("/audit/anomalies"),
    auditFeedback: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ok:true}) : request("/audit/feedback", { method: "POST", body: payload }),
    getAuditStats: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({}) : request("/audit/stats"),

    // Reports (#7 — role-scoped types + AI narrative)
    generateReport: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.generateReport(payload) : request("/reports/generate", { method: "POST", body: payload }),
    getReports: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve([]) : request("/reports"),

    // AI
    chat: (message, history = []) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.chat(message, history, Auth.getUser()) : request("/ai/chat", { method: "POST", body: { message, history } }),
    aiSearch: (query) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.searchGlobal(query) : request("/ai/search", { method: "POST", body: { query } }),
    searchGlobal: (query) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.searchGlobal(query) : request("/ai/search", { method: "POST", body: { query } }),

    health: () => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ status: "online (mock)" }) : request("/health", { auth: false }),
  };
})();
