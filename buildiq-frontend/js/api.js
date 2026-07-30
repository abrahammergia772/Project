/* ============================================================
   BuildIQ — api.js
   All fetch calls to the Python FastAPI backend.
   Standard fetch wrapper with Authorization header, 401 redirect,
   and error toast. Falls back to MockData when MOCK_MODE is on,
   so the whole UI works without any backend/keys.
   ============================================================ */

const API = (() => {
  // Read the base URL at call time rather than snapshotting it at load, so it
  // can be changed at runtime (tests, environment switching) and take effect.
  const base = () => BUILDIQ_CONFIG.API_BASE;

  async function request(path, { method = "GET", body, params, auth = true } = {}) {
    let url = `${base()}${path}`;
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
      else if (e.includes("project.manager") || e.startsWith("pm@")) role = "Project Manager";
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
    else if (role === "Project Manager") member = MockData.getMemberById("mem_pm_1");
    else if (role === "Auditor") member = MockData.getMemberById("mem_5");
    else member = MockData.getMemberById("mem_6"); // Engineer

    return {
      id: member.id, name: member.full_name, email: email || member.email, role: member.role,
      department: member.department, org_name: "Wolaita Construction Group", avatar: null,
      job_title: member.job_title || null,
      // Multi-role support: everything this person may act as.
      roles: Array.isArray(member.roles) && member.roles.length ? member.roles : [member.role],
      role_contexts: member.role_contexts || {},
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

    // ---- Project / department staffing (Super Admin + General Manager) ----
    async createProject(payload) {
      await wait(600);
      const user = Auth.getUser();
      if (!Roles.canCreateProject(user)) throw new Error("Only an admin or general manager can create projects.");
      if (!payload.title?.trim()) throw new Error("Project name is required.");

      const manager = payload.manager_id ? MockData.getMemberById(payload.manager_id) : null;
      if (payload.manager_id && !manager) throw new Error("The selected project manager was not found.");

      const team = (payload.team_ids || [])
        .map(id => MockData.getMemberById(id)).filter(Boolean);
      if (manager && !team.some(m => m.id === manager.id)) team.unshift(manager);

      const progress = Number(payload.progress) || 0;
      const project = {
        id: Utils.uid("proj"),
        title: payload.title.trim(),
        type: payload.type || "Residential",
        region: payload.region || "N/A",
        department: payload.department || null,
        manager_id: manager?.id || null,
        manager_name: manager?.full_name || null,
        manager_role: manager?.role || null,
        client_id: payload.client_id || null,
        client_name: MockData.getClientById(payload.client_id)?.company || null,
        status: progress > 0 ? "In Progress" : "Planning",
        progress,
        expected_progress: Number(payload.expected_progress) || 5,
        delay_risk: "LOW",
        budget: Number(payload.budget) || 0,
        spent: 0,
        deadline: payload.deadline ? new Date(payload.deadline).toISOString() : new Date(Date.now() + 90 * 86400000).toISOString(),
        team,
        tasks_total: 0,
        tasks_done: 0,
        delay_reasons: [],
        description: payload.description || "Newly created project.",
        materials: [],
        materials_total_cost: 0,
      };
      MockData.projects.unshift(project);
      MockData.logAuditEvent(user, "UPDATE_RECORD", `projects/${project.id}`);

      if (manager) {
        MockData.addNotification({
          title: "You were made project manager",
          body: `${user.name} assigned you to manage "${project.title}".`,
          icon: "fa-diagram-project", type: "info", link: "projects.html",
          target: { user_ids: [manager.id] },
        });
      }
      return project;
    },

    async createDepartment(payload) {
      await wait(450);
      const user = Auth.getUser();
      if (!Roles.canAssignDepartmentHead(user)) throw new Error("Only an admin or general manager can create departments.");
      const res = MockData.createDepartment(payload);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "UPDATE_RECORD", `departments/${res.department.id}`);
      if (res.department.head_id) {
        MockData.addNotification({
          title: "You were appointed department head",
          body: `${user.name} appointed you head of ${res.department.name}.`,
          icon: "fa-user-tie", type: "success", link: "departments.html",
          target: { user_ids: [res.department.head_id] },
        });
      }
      return res.department;
    },

    async createMemberRecord(payload) {
      await wait(450);
      const user = Auth.getUser();
      if (!Roles.canAssignEngineerToDepartment(user)) throw new Error("Only an admin or general manager can add members.");
      const res = MockData.createMember(payload);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "UPDATE_RECORD", `members/${res.member.id}`);
      return res.member;
    },

    async createClientRecord(payload) {
      await wait(400);
      const user = Auth.getUser();
      if (!Roles.canCreateProject(user)) throw new Error("Only an admin or general manager can add clients.");
      const res = MockData.createClient(payload);
      if (!res.ok) throw new Error(res.error);
      if (!res.existed) MockData.logAuditEvent(user, "UPDATE_RECORD", `clients/${res.client.id}`);
      return res.client;
    },

    async setProjectManager(projectId, memberId) {
      await wait(400);
      const user = Auth.getUser();
      if (!Roles.canAssignProjectManager(user)) throw new Error("Only an admin or general manager can change the project manager.");
      const res = MockData.setProjectManager(projectId, memberId);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "PERMISSION_CHANGE", `projects/${projectId}/manager`);
      MockData.addNotification({
        title: "You were made project manager",
        body: `${user.name} assigned you to manage "${res.project.title}".`,
        icon: "fa-diagram-project", type: "info", link: "projects.html",
        target: { user_ids: [memberId] },
      });
      return res.project;
    },

    async setDepartmentHead(departmentName, memberId) {
      await wait(400);
      const user = Auth.getUser();
      if (!Roles.canAssignDepartmentHead(user)) throw new Error("Only an admin or general manager can appoint a department head.");
      const res = MockData.setDepartmentHead(departmentName, memberId);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "PERMISSION_CHANGE", `departments/${departmentName}/head`);
      MockData.addNotification({
        title: "You were appointed department head",
        body: `${user.name} appointed you head of ${departmentName}.`,
        icon: "fa-user-tie", type: "success", link: "departments.html",
        target: { user_ids: [memberId] },
      });
      return res.department;
    },

    async assignMemberToDepartment(memberId, departmentName) {
      await wait(400);
      const user = Auth.getUser();
      if (!Roles.canAssignEngineerToDepartment(user)) throw new Error("Only an admin or general manager can move members between departments.");
      const res = MockData.assignMemberToDepartment(memberId, departmentName);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "UPDATE_RECORD", `members/${memberId}/department`);
      MockData.addNotification({
        title: "Your department changed",
        body: `${user.name} moved you to ${departmentName}.`,
        icon: "fa-building", type: "info", link: "departments.html",
        target: { user_ids: [memberId] },
      });
      return res.member;
    },

    // ---- Attendance: take register + absence reasons ----
    async saveAttendance(date, marks) {
      await wait(500);
      const user = Auth.getUser();
      if (!Roles.canTakeAttendance(user)) {
        throw new Error("Only the Workforce & Attendance department can take attendance.");
      }
      let saved = 0;
      marks.forEach(m => {
        const existing = MockData.attendance.find(a => a.person_id === m.person_id && a.date === date);
        if (existing) {
          existing.status = m.status;
          existing.check_in = m.status === "Absent" ? null : (existing.check_in || "08:00");
          existing.recorded_by = user.name;
          if (m.status === "Absent" && !existing.reason_status) existing.reason_status = "Not Submitted";
          if (m.status === "Present") existing.reason_status = null;
        } else {
          const staff = MockData.getMemberById(m.person_id);
          const worker = MockData.getDailyWorkerById(m.person_id);
          MockData.attendance.push({
            id: Utils.uid("att"),
            person_id: m.person_id,
            person_name: (staff || worker || {}).full_name || m.person_id,
            person_type: m.person_type,
            department: (staff || worker || {}).department || null,
            project_id: (worker || {}).project_id || null,
            project_title: (worker || {}).project_title || null,
            date, status: m.status,
            check_in: m.status === "Absent" ? null : "08:00",
            recorded_by: user.name,
            reason: null, reason_category: null, reason_submitted_at: null,
            reason_status: m.status === "Absent" ? "Not Submitted" : null,
            reason_reviewed_by: null, reason_reviewed_at: null, reason_review_note: null,
          });
        }
        saved++;
      });
      return { ok: true, saved };
    },

    async myAttendance() {
      await wait(300);
      const user = Auth.getUser();
      return Roles.ownAttendance(user, MockData.attendance)
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    async submitAbsenceReason(date, payload) {
      await wait(450);
      const user = Auth.getUser();
      const res = MockData.submitAbsenceReason(user.id, date, payload);
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "LATE_SUBMISSION", `attendance/${date}/reason`);
      // Let the reviewers know something is waiting for them.
      MockData.addNotification({
        title: "Absence reason submitted",
        body: `${user.name} explained their absence on ${date} (${res.record.reason_category}).`,
        icon: "fa-comment-dots", type: "info", link: "attendance.html",
        target: {
          roles: ["Super Admin", "General Manager"],
          departments: [res.record.department, Roles.WORKFORCE_DEPT].filter(Boolean),
        },
      });
      return res.record;
    },

    async reviewAbsenceReason(personId, date, payload) {
      await wait(400);
      const user = Auth.getUser();
      const record = MockData.attendance.find(a => a.person_id === personId && a.date === date);
      if (!Roles.canReviewAbsenceReason(user, record)) {
        throw new Error("You cannot review this absence reason.");
      }
      const res = MockData.reviewAbsenceReason(personId, date, { ...payload, reviewer: user });
      if (!res.ok) throw new Error(res.error);
      MockData.logAuditEvent(user, "APPROVAL_BYPASS", `attendance/${date}/reason/${payload.decision.toLowerCase()}`);
      MockData.addNotification({
        title: `Absence reason ${payload.decision.toLowerCase()}`,
        body: `Your reason for ${date} was ${payload.decision.toLowerCase()} by ${user.name}.`,
        icon: payload.decision === "Accepted" ? "fa-circle-check" : "fa-circle-xmark",
        type: payload.decision === "Accepted" ? "success" : "error",
        link: "attendance.html",
        target: { user_ids: [personId] },
      });
      return res.record;
    },

    // ---- Task assignment (Dept Manager / GM / Auditor / Super Admin) ----
    async assignTask(payload) {
      await wait(500);
      const user = Auth.getUser();
      if (!Roles.canAssignTasks(user.role)) throw new Error("You cannot assign tasks.");

      const targets = Roles.assignableWorkers(user, MockData.members, MockData.dailyWorkers);
      const target = targets.find(t => t.id === payload.assignee_id);
      if (!target) throw new Error("That worker is not in your assignable scope.");

      const project = MockData.getProjectById(payload.project_id);
      const task = {
        id: Utils.uid("task"),
        title: payload.title,
        category: payload.category || "Coordination",
        assignee_id: target.id,
        assignee_name: target.name,
        assignee_type: target.type,
        department: target.department,
        project_id: project?.id || null,
        project_title: project?.title || "General",
        project_risk: project?.delay_risk || "LOW",
        status: "To Do",
        blocking: !!payload.blocking,
        estimated_hours: Number(payload.estimated_hours) || 2,
        due_date: payload.due_date ? new Date(payload.due_date).toISOString() : new Date(Date.now() + 3 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
        assigned_by: user.name,
        assigned_by_role: user.role,
        note: payload.note || "",
      };
      MockData.tasks.unshift(task);
      MockData.logAuditEvent(user, "UPDATE_RECORD", `tasks/${task.id}`);
      MockData.addNotification({
        title: "New task assigned to you",
        body: `${user.name} (${user.role}) assigned "${task.title}" — due ${new Date(task.due_date).toDateString()}.`,
        icon: "fa-list-check", type: "info", link: "tasks.html",
        target: { user_ids: [target.id] },
      });
      return task;
    },

    // ---- Notifications ----
    async notifications() {
      await wait(200);
      const user = Auth.getUser();
      return MockData.notificationsFor(user).map(n => ({ ...n, read: n.read_by.includes(user.id) }));
    },
    async markNotificationRead(id) {
      await wait(120);
      MockData.markNotificationRead(Auth.getUser(), id);
      return { ok: true };
    },
    async markAllNotificationsRead() {
      await wait(150);
      MockData.markAllNotificationsRead(Auth.getUser());
      return { ok: true };
    },

    // ---- Documents ----
    async documents() {
      await wait(300);
      return MockData.documentsFor(Auth.getUser());
    },
    async uploadDocument(file) {
      await wait(600);
      const user = Auth.getUser();
      const doc = MockData.addDocument(file, user);
      MockData.logAuditEvent(user, "FILE_UPLOAD", `documents/${doc.name}`);
      return doc;
    },
    async deleteDocument(id) {
      await wait(300);
      const user = Auth.getUser();
      const doc = MockData.documents.find(d => d.id === id);
      MockData.removeDocument(id);
      if (doc) MockData.logAuditEvent(user, "DELETE_DOCUMENT", `documents/${doc.name}`);
      return { ok: true };
    },

    // ---- Password reset ----
    async requestPasswordReset(email) {
      await wait(600);
      const token = MockData.createPasswordResetToken(email);
      // Mock mode has no mail server, so we hand the link straight back to the UI.
      return { ok: true, demo_token: token, message: "If that email exists, a reset link has been sent." };
    },
    async resetPassword(token, newPassword) {
      await wait(600);
      const res = MockData.consumePasswordResetToken(token);
      if (!res.ok) { const e = new Error(res.error); e.__toasted = false; throw e; }
      return { ok: true, email: res.email };
    },

    async refreshToken() {
      await wait(150);
      const user = Auth.getUser();
      return {
        token: "mock." + btoa(JSON.stringify({ role: user?.role, email: user?.email, r: Date.now() })) + ".token",
        user,
        expires: Date.now() + 1000 * 60 * 60 * 24,
      };
    },
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

    refreshToken: () => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.refreshToken()
      : request("/auth/refresh", { method: "POST" }),

    requestPasswordReset: (email) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.requestPasswordReset(email)
      : request("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),

    resetPassword: (token, new_password) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.resetPassword(token, new_password)
      : request("/auth/reset-password", { method: "POST", body: { token, new_password }, auth: false }),

    // Notifications
    getNotifications: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.notifications() : request("/notifications"),
    markNotificationRead: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.markNotificationRead(id) : request(`/notifications/${id}/read`, { method: "PUT" }),
    markAllNotificationsRead: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.markAllNotificationsRead() : request("/notifications/read-all", { method: "PUT" }),

    // Documents
    getDocuments: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.documents() : request("/documents"),
    uploadDocument: (file) => {
      if (BUILDIQ_CONFIG.MOCK_MODE) return Mock.uploadDocument(file);
      const fd = new FormData();
      fd.append("file", file);
      return fetch(`${base()}/documents`, {
        method: "POST",
        headers: Auth.getToken() ? { Authorization: `Bearer ${Auth.getToken()}` } : {},
        body: fd,
      }).then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Upload failed");
        return res.json();
      });
    },
    downloadDocument: (id) => BUILDIQ_CONFIG.MOCK_MODE
      ? Promise.resolve(null) // handled locally from the stored Blob
      : fetch(`${base()}/documents/${id}/download`, {
          headers: Auth.getToken() ? { Authorization: `Bearer ${Auth.getToken()}` } : {},
        }).then(res => { if (!res.ok) throw new Error("Download failed"); return res.blob(); }),
    deleteDocument: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.deleteDocument(id) : request(`/documents/${id}`, { method: "DELETE" }),

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
    createProject: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.createProject(payload) : request("/projects", { method: "POST", body: payload }),
    createDepartment: (payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.createDepartment(payload)
      : request("/departments", { method: "POST", body: payload }),
    createMemberRecord: (payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.createMemberRecord(payload)
      : request("/members", { method: "POST", body: payload }),
    createClientRecord: (payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.createClientRecord(payload)
      : request("/clients", { method: "POST", body: payload }),
    setProjectManager: (projectId, memberId) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.setProjectManager(projectId, memberId)
      : request(`/projects/${projectId}/manager`, { method: "PUT", body: { manager_id: memberId } }),
    setDepartmentHead: (department, memberId) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.setDepartmentHead(department, memberId)
      : request(`/departments/${encodeURIComponent(department)}/head`, { method: "PUT", body: { member_id: memberId } }),
    assignMemberToDepartment: (memberId, department) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.assignMemberToDepartment(memberId, department)
      : request(`/members/${memberId}/department`, { method: "PUT", body: { department } }),
    updateProject: (id, payload) => BUILDIQ_CONFIG.MOCK_MODE ? Promise.resolve({ ...payload, id }) : request(`/projects/${id}`, { method: "PUT", body: payload }),
    analyzeProject: (id) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.analyzeProject(id) : request(`/projects/${id}/analyze`, { method: "POST" }),

    // Attendance (Workforce & Attendance dept takes it; everyone explains their own absences)
    saveAttendance: (date, marks) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.saveAttendance(date, marks)
      : request("/attendance", { method: "POST", body: { date, marks } }),
    getMyAttendance: () => BUILDIQ_CONFIG.MOCK_MODE ? Mock.myAttendance() : request("/attendance/me"),
    submitAbsenceReason: (date, payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.submitAbsenceReason(date, payload)
      : request(`/attendance/${date}/reason`, { method: "POST", body: payload }),
    reviewAbsenceReason: (personId, date, payload) => BUILDIQ_CONFIG.MOCK_MODE
      ? Mock.reviewAbsenceReason(personId, date, payload)
      : request(`/attendance/${personId}/${date}/reason/review`, { method: "PUT", body: payload }),

    // Tasks (#5 — AI priority + scheduling)
    getTasks: (params) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.tasks(params) : request("/tasks", { params }),
    assignTask: (payload) => BUILDIQ_CONFIG.MOCK_MODE ? Mock.assignTask(payload) : request("/tasks/assign", { method: "POST", body: payload }),
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
