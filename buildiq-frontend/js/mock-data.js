/* ============================================================
   BuildIQ — mock-data.js
   Realistic sample data used when BUILDIQ_CONFIG.MOCK_MODE = true
   Lets the whole frontend run and look fully alive with zero backend.

   Data model notes (role rollout):
   - members[]     -> internal staff: Super Admin, General Manager,
                      Department Manager, Engineer, Auditor
   - clients[]      -> external Client accounts, each linked to project(s)
   - departments[]  -> now carries scope-of-work + budget for the detail view
   - projects[]     -> carries `department` (owning dept) + `client_id`
   - tasks[]        -> per-assignee tasks, later scored by ai-engine.js
   - scheduleSeed[] -> a few pre-placed calendar entries per demo user
   ============================================================ */

const MockData = (() => {

  const departments = [
    { id: "dep_1", name: "Site Operations", head: "Meron Tadesse",
      description: "Runs day-to-day construction activity across all active sites: scheduling crews, coordinating equipment, and ensuring work progresses to plan.",
      scope: ["Site scheduling & crew coordination", "Equipment & heavy machinery allocation", "Daily progress tracking", "On-site issue escalation"],
      budget: 2400000 },
    { id: "dep_2", name: "Engineering & Design", head: "Dawit Alemu",
      description: "Owns structural, architectural and MEP design across the portfolio, including drawing approvals and technical change control.",
      scope: ["Structural & architectural drawings", "BIM modeling", "Design change control", "Technical feasibility review"],
      budget: 1800000 },
    { id: "dep_3", name: "Finance & Budget", head: "Selam Getachew",
      description: "Manages project budgets, supplier payments, and financial reporting across the organization.",
      scope: ["Budget planning & tracking", "Invoice & payment processing", "Cost variance analysis", "Financial reporting"],
      budget: 900000 },
    { id: "dep_4", name: "Health & Safety", head: "Yonas Bekele",
      description: "Enforces safety compliance on every site and investigates incidents to prevent recurrence.",
      scope: ["Site safety audits", "PPE compliance", "Incident investigation", "Safety training"],
      budget: 520000 },
    { id: "dep_5", name: "Human Resources", head: "Hanna Girma",
      description: "Handles hiring, onboarding, and workforce administration for all departments.",
      scope: ["Recruitment & onboarding", "Payroll administration", "Employee relations", "Training & development"],
      budget: 380000 },
    { id: "dep_6", name: "Quality Control", head: "Abel Wondimu",
      description: "Inspects work quality against specification and manages the material testing pipeline.",
      scope: ["Material testing", "Work quality inspection", "Non-conformance tracking", "Standards compliance"],
      budget: 640000 },
    { id: "dep_7", name: "Procurement & Supply", head: "Rahel Solomon",
      description: "Sources materials and manages supplier relationships and delivery schedules across all sites.",
      scope: ["Supplier sourcing & contracts", "Purchase order management", "Delivery scheduling", "Inventory tracking"],
      budget: 1500000 },
    { id: "dep_8", name: "Client Relations", head: "Kaleb Mulugeta",
      description: "Acts as the primary liaison with clients, managing communication, expectations and satisfaction.",
      scope: ["Client communication", "Contract liaison", "Satisfaction tracking", "Onboarding new clients"],
      budget: 300000 },
    { id: "dep_9", name: "Workforce & Attendance", head: "Girma Assefa",
      description: "Supervises daily workforce presence across all sites — taking and verifying attendance for permanent organization staff and daily (casual) workers, and flagging absence patterns to site leadership.",
      scope: ["Daily attendance supervision", "Organization worker attendance", "Daily/casual worker attendance", "Absence pattern monitoring", "Workforce headcount reporting"],
      budget: 260000 },
  ];

  const skillsPool = ["AutoCAD", "Structural Analysis", "Project Scheduling", "Concrete Works",
    "Steel Fabrication", "BIM Modeling", "Cost Estimation", "Site Supervision", "Surveying",
    "Electrical Systems", "Plumbing", "HVAC", "Safety Compliance", "Procurement", "Client Relations"];

  const firstNames = ["Abebe","Bethelhem","Chala","Dagmawit","Ephrem","Frehiwot","Girma","Helen",
    "Israel","Jerusalem","Kidus","Liya","Mikias","Nardos","Oliyad","Paulos","Qedamawit","Rediet",
    "Samuel","Tigist","Umer","Veronica","Wubshet","Xavier","Yohannes","Zewditu"];
  const lastNames = ["Tesfaye","Mekonnen","Alemayehu","Gebre","Haile","Tadesse","Assefa","Bekele",
    "Girma","Wolde","Kebede","Desta","Fikru","Yimer","Negash"];

  function randOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pickSkills() {
    const n = randInt(2, 4);
    const shuffled = [...skillsPool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  const statuses = ["Active", "Active", "Active", "On Leave", "Inactive"];

  // ---------------- Members ----------------
  // Index 0-6 are fixed "demo" identities (one per role, plus dept heads) so that
  // logging in via a role chip always lands on a believable, fully-populated account.
  const members = [];

  members.push({ id: "mem_1", full_name: "Admin User", role: "Super Admin", department: "Executive",
    job_title: "System Administrator", experience_years: 12, skills: ["Systems Administration","Security","Governance"],
    status: "Active", projects_count: 15, on_time_pct: 96, phone: "+251911000001",
    joined: new Date(Date.now() - 900*86400000).toISOString(), avatar_color: Utils.colorFromString("Admin User"),
    email: "admin@buildiq.et" });

  members.push({ id: "mem_2", full_name: "Tsegaye Worku", role: "General Manager", department: "Executive",
    job_title: "General Manager", experience_years: 16, skills: ["Executive Leadership","Strategic Planning","Stakeholder Management"],
    status: "Active", projects_count: 15, on_time_pct: 91, phone: "+251911000002",
    joined: new Date(Date.now() - 1300*86400000).toISOString(), avatar_color: Utils.colorFromString("Tsegaye Worku"),
    email: "gm@buildiq.et" });

  // One Department Manager per department — head names match departments[] above
  departments.forEach((d, i) => {
    members.push({
      id: `mem_dm_${i+1}`, full_name: d.head, role: "Department Manager", department: d.name,
      job_title: `${d.name} Manager`, experience_years: randInt(8,15),
      skills: pickSkills(), status: "Active", projects_count: randInt(2,6),
      on_time_pct: randInt(80,97), phone: `+25191100${10+i}`,
      joined: new Date(Date.now() - randInt(400,1000)*86400000).toISOString(),
      avatar_color: Utils.colorFromString(d.head),
      email: `${d.head.toLowerCase().replace(/\s+/g,'.')}@buildiq.et`,
    });
  });

  // Some people genuinely wear two hats. The Site Operations manager also runs
  // projects directly, so they hold both roles and can switch between them.
  // `role_contexts` lets each hat carry its own department scope.
  const dualRoleMgr = members.find(m => m.id === "mem_dm_1");
  if (dualRoleMgr) {
    dualRoleMgr.roles = ["Department Manager", "Project Manager"];
    dualRoleMgr.role_contexts = {
      "Department Manager": { department: dualRoleMgr.department, job_title: `${dualRoleMgr.department} Manager` },
      "Project Manager":    { department: dualRoleMgr.department, job_title: "Project Manager" },
    };
  }

  // ---- Dedicated Project Managers (one per major delivery department) ----
  const pmSeed = [
    { id: "mem_pm_1", name: "Bruk Haile",      dept: "Site Operations" },
    { id: "mem_pm_2", name: "Saba Tesfaye",    dept: "Engineering & Design" },
    { id: "mem_pm_3", name: "Henok Girma",     dept: "Site Operations" },
    { id: "mem_pm_4", name: "Marta Wolde",     dept: "Quality Control" },
  ];
  pmSeed.forEach((pm, i) => {
    members.push({
      id: pm.id, full_name: pm.name, role: "Project Manager", department: pm.dept,
      job_title: "Project Manager", experience_years: randInt(7, 16),
      skills: ["Project Scheduling", "Cost Estimation", "Site Supervision", ...pickSkills()].slice(0, 4),
      status: "Active", projects_count: randInt(1, 3), on_time_pct: randInt(78, 96),
      phone: `+25191100${30 + i}`,
      joined: new Date(Date.now() - randInt(300, 900) * 86400000).toISOString(),
      avatar_color: Utils.colorFromString(pm.name),
      email: i === 0 ? "pm@buildiq.et" : `${pm.name.toLowerCase().replace(/\s+/g, '.')}@buildiq.et`,
    });
  });

  members.push({ id: "mem_5", full_name: "Nardos Fikru", role: "Auditor", department: "Compliance",
    job_title: "Compliance Auditor", experience_years: 9, skills: ["Risk Assessment","Compliance","Forensic Review"],
    status: "Active", projects_count: 0, on_time_pct: 98, phone: "+251911000005",
    joined: new Date(Date.now() - 700*86400000).toISOString(), avatar_color: Utils.colorFromString("Nardos Fikru"),
    email: "auditor@buildiq.et" });

  members.push({ id: "mem_6", full_name: "Samuel Alemayehu", role: "Engineer", department: "Site Operations",
    job_title: "Site Engineer", experience_years: 5, skills: ["Site Supervision","AutoCAD","Concrete Works"],
    status: "Active", projects_count: 3, on_time_pct: 88, phone: "+251911000006",
    joined: new Date(Date.now() - 500*86400000).toISOString(), avatar_color: Utils.colorFromString("Samuel Alemayehu"),
    email: "engineer@buildiq.et" });

  // Bulk-generate the rest of the org as Engineers (and a few extra Auditors) to populate lists
  for (let i = 0; i < 34; i++) {
    const name = `${randOf(firstNames)} ${randOf(lastNames)}`;
    const role = Math.random() < 0.1 ? "Auditor" : "Engineer";
    const dept = randOf(departments);
    members.push({
      id: `mem_${100+i}`,
      full_name: name,
      email: `${name.toLowerCase().replace(/\s+/g,'.')}@buildiq.et`,
      role,
      department: role === "Auditor" ? "Compliance" : dept.name,
      job_title: role === "Engineer" ? randOf(["Site Engineer","Structural Engineer","Civil Engineer","Electrical Engineer"]) : "Compliance Auditor",
      experience_years: randInt(1, 18),
      skills: pickSkills(),
      status: randOf(statuses),
      projects_count: randInt(0, 8),
      on_time_pct: randInt(62, 99),
      phone: `+2519${randInt(10000000,99999999)}`,
      joined: new Date(Date.now() - randInt(30, 1200) * 86400000).toISOString(),
      avatar_color: Utils.colorFromString(name),
    });
  }

  // ---------------- Clients (external, project-scoped) ----------------
  const clientCompanies = ["Horizon Real Estate PLC","Sodo Municipal Government","Nile Logistics Group",
    "Lakeside Hospitality Ltd","Unity Sports Federation","Millennium Holdings"];
  const clients = [];
  clientCompanies.forEach((company, i) => {
    const contact = i === 0 ? "Bereket Alemu" : `${randOf(firstNames)} ${randOf(lastNames)}`; // client_1 is the fixed demo identity
    clients.push({
      id: i === 0 ? "client_1" : `client_${i+1}`,
      company,
      contact_name: contact,
      email: i === 0 ? "client@buildiq.et" : `${contact.toLowerCase().replace(/\s+/g,'.')}@${company.toLowerCase().replace(/[^a-z]/g,'').slice(0,10)}.com`,
      phone: `+2519${randInt(10000000,99999999)}`,
      avatar_color: Utils.colorFromString(company),
    });
  });

  // ---------------- Projects ----------------
  const projectTypes = ["Residential", "Commercial", "Infrastructure", "Industrial", "Renovation"];
  const regions = ["Addis Ababa", "Wolaita Sodo", "Hawassa", "Bahir Dar", "Adama", "Mekelle"];
  const delayReasons = ["Material Delay", "Weather", "Permit Hold-up", "Labor Shortage", "Design Change", "Budget Constraint"];

  const engineers = members.filter(m => m.role === "Engineer");
  const projects = [];
  const projectNames = ["Sodo Tower Complex","Riverside Residences","Blue Nile Bridge Extension",
    "Adama Industrial Park","Hawassa Lakeside Mall","Mekelle Community Hospital","Addis Ring Road Phase 3",
    "Green Valley Housing","Sunrise Business Center","Sodo University Annex","Bahir Dar Marina Project",
    "Central Market Renovation","Highland Logistics Hub","Unity Sports Complex","Millennium Office Park"];
  for (let i = 0; i < projectNames.length; i++) {
    const progress = randInt(8, 98);
    const expected = Math.min(100, progress + randInt(-15, 20));
    const risk = progress < expected - 15 ? "HIGH" : progress < expected - 5 ? "MEDIUM" : "LOW";
    const dept = randOf(departments.filter(d => d.name !== "Human Resources" && d.name !== "Client Relations"));
    // De-duplicate the team so the same engineer isn't listed twice
    const team = [...new Map(
      Array.from({ length: randInt(3, 7) }, () => randOf(engineers)).map(m => [m.id, m])
    ).values()];
    const client = clients[i % clients.length];

    // Every project has exactly one accountable manager. Prefer a dedicated
    // Project Manager from the owning department, then that department's
    // manager, then the most senior engineer on the team.
    const dedicatedPMs = members.filter(m => m.role === "Project Manager" && m.department === dept.name);
    const deptManager = members.find(m => m.role === "Department Manager" && m.department === dept.name);
    const seniorOnTeam = [...team].sort((a, b) => (b.experience_years || 0) - (a.experience_years || 0))[0];
    const manager = (dedicatedPMs.length ? dedicatedPMs[i % dedicatedPMs.length] : null)
      || deptManager || seniorOnTeam || engineers[0];
    // The manager is always part of the project team.
    if (manager && !team.some(m => m.id === manager.id)) team.unshift(manager);

    projects.push({
      id: `proj_${i+1}`,
      title: projectNames[i],
      type: randOf(projectTypes),
      region: randOf(regions),
      department: dept.name,
      manager_id: manager ? manager.id : null,
      manager_name: manager ? manager.full_name : null,
      manager_role: manager ? manager.role : null,
      client_id: client.id,
      client_name: client.company,
      status: progress >= 100 ? "Completed" : progress > 0 ? "In Progress" : "Planning",
      progress,
      expected_progress: expected,
      delay_risk: progress >= 100 ? "LOW" : risk,
      budget: randInt(80000, 4200000),
      spent: 0,
      deadline: new Date(Date.now() + randInt(-30, 300) * 86400000).toISOString(),
      team,
      tasks_total: randInt(10, 60),
      tasks_done: 0,
      delay_reasons: risk !== "LOW" ? [randOf(delayReasons), randOf(delayReasons)].filter((v,i,a)=>a.indexOf(v)===i) : [],
      description: "A multi-phase construction initiative covering structural works, MEP installation, and finishing across coordinated site teams.",
    });
  }
  // Force the first project onto the demo client & demo engineer so their dashboards have real content
  projects[0].client_id = "client_1";
  projects[0].client_name = clients[0].company;
  if (!projects[0].team.some(m => m.id === "mem_6")) projects[0].team.unshift(members.find(m => m.id === "mem_6"));
  projects[0].department = "Site Operations";

  // Guarantee the demo Project Manager (mem_pm_1) runs a couple of projects so
  // signing in with that role always lands on a populated dashboard.
  const demoPM = members.find(m => m.id === "mem_pm_1");
  if (demoPM) {
    [projects[0], projects[2]].filter(Boolean).forEach(p => {
      p.manager_id = demoPM.id;
      p.manager_name = demoPM.full_name;
      p.manager_role = demoPM.role;
      if (!p.team.some(m => m.id === demoPM.id)) p.team.unshift(demoPM);
    });
  }

  // ---------------- Inline creation (used by the New Project form) ----------------
  function createDepartment({ name, head_id, description, scope, budget }) {
    const clean = String(name || "").trim();
    if (!clean) return { ok: false, error: "Department name is required." };
    if (departments.some(d => d.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: "A department with that name already exists." };
    }
    const head = head_id ? members.find(m => m.id === head_id) : null;
    const dept = {
      id: `dep_${departments.length + 1}_${Math.random().toString(36).slice(2, 6)}`,
      name: clean,
      head: head ? head.full_name : "Unassigned",
      head_id: head ? head.id : null,
      description: description || `${clean} department.`,
      scope: Array.isArray(scope) ? scope : String(scope || "").split(",").map(s => s.trim()).filter(Boolean),
      budget: Number(budget) || 0,
      members: 0,
      projects: 0,
    };
    departments.push(dept);
    // Moving the chosen head into the department they now lead.
    if (head) { head.department = clean; dept.members = 1; }
    return { ok: true, department: dept };
  }

  function createMember({ full_name, email, role, department, job_title, experience_years, phone, skills }) {
    const name = String(full_name || "").trim();
    if (!name) return { ok: false, error: "Full name is required." };
    const mail = String(email || "").trim().toLowerCase()
      || `${name.toLowerCase().replace(/\s+/g, ".")}@buildiq.et`;
    if (members.some(m => m.email.toLowerCase() === mail)) {
      return { ok: false, error: "Someone with that email already exists." };
    }
    const member = {
      id: `mem_${Math.random().toString(36).slice(2, 10)}`,
      full_name: name,
      email: mail,
      role: role || "Engineer",
      department: department || null,
      job_title: job_title || (role === "Project Manager" ? "Project Manager" : "Site Engineer"),
      experience_years: Number(experience_years) || 0,
      skills: Array.isArray(skills) ? skills : String(skills || "").split(",").map(s => s.trim()).filter(Boolean),
      status: "Active",
      projects_count: 0,
      on_time_pct: 90,
      phone: phone || "",
      joined: new Date().toISOString(),
      avatar_color: Utils.colorFromString(name),
    };
    members.push(member);
    departments.forEach(d => { d.members = members.filter(m => m.department === d.name).length; });
    return { ok: true, member };
  }

  function createClient({ company, contact_name, email, phone }) {
    const name = String(company || "").trim();
    if (!name) return { ok: false, error: "Company name is required." };
    const existing = clients.find(c => c.company.toLowerCase() === name.toLowerCase());
    if (existing) return { ok: true, client: existing, existed: true }; // reuse rather than duplicate
    const client = {
      id: `client_${Math.random().toString(36).slice(2, 10)}`,
      company: name,
      contact_name: contact_name || name,
      email: email || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}@example.com`,
      phone: phone || "",
      avatar_color: Utils.colorFromString(name),
    };
    clients.push(client);
    return { ok: true, client };
  }

  // Make sure the dual-role manager actually runs a project, so their
  // "Project Manager" hat has something to show.
  (function ensureDualRoleHasProject() {
    const dual = members.find(m => Array.isArray(m.roles) && m.roles.includes("Project Manager") && m.role === "Department Manager");
    if (!dual) return;
    if (projects.some(p => p.manager_id === dual.id)) return;
    const target = projects.find(p => p.department === dual.department) || projects[projects.length - 1];
    if (!target) return;
    target.manager_id = dual.id;
    target.manager_name = dual.full_name;
    target.manager_role = "Project Manager";
    if (!target.team.some(m => m.id === dual.id)) target.team.unshift(dual);
  })();

  function getProjectsManagedBy(memberId) {
    return projects.filter(p => p.manager_id === memberId);
  }

  // Reassigning a project's manager. Keeps the new manager on the team.
  function setProjectManager(projectId, memberId) {
    const project = projects.find(p => p.id === projectId);
    const member = members.find(m => m.id === memberId);
    if (!project) return { ok: false, error: "Project not found." };
    if (!member) return { ok: false, error: "That person is not a member of the organization." };
    if (member.status !== "Active") return { ok: false, error: "That member is not active." };

    project.manager_id = member.id;
    project.manager_name = member.full_name;
    project.manager_role = member.role;
    if (!project.team.some(m => m.id === member.id)) project.team.unshift(member);
    return { ok: true, project };
  }

  // Appointing the head of a department.
  function setDepartmentHead(departmentName, memberId) {
    const dept = departments.find(d => d.name === departmentName);
    const member = members.find(m => m.id === memberId);
    if (!dept) return { ok: false, error: "Department not found." };
    if (!member) return { ok: false, error: "Member not found." };
    if (member.department !== departmentName) {
      return { ok: false, error: "The head must already belong to that department." };
    }
    dept.head = member.full_name;
    dept.head_id = member.id;
    return { ok: true, department: dept };
  }

  // Moving an engineer into a department (or reassigning them).
  function assignMemberToDepartment(memberId, departmentName) {
    const member = members.find(m => m.id === memberId);
    const dept = departments.find(d => d.name === departmentName);
    if (!member) return { ok: false, error: "Member not found." };
    if (!dept) return { ok: false, error: "Department not found." };
    if (member.role === "Client") return { ok: false, error: "Clients do not belong to a department." };

    const previous = member.department;
    member.department = departmentName;
    // Keep department head-counts honest after the move.
    departments.forEach(d => {
      d.members = members.filter(m => m.department === d.name).length;
    });
    return { ok: true, member, previous };
  }

  projects.forEach(p => {
    p.spent = Math.round(p.budget * (p.progress/100) * (0.9 + Math.random()*0.3));
    p.tasks_done = Math.round(p.tasks_total * (p.progress/100));
  });

  // ---------------- Materials (#5 — bought materials + price per project) ----------------
  const materialCatalog = [
    { name: "Portland Cement (50kg bag)", unit: "bag", unitPrice: 12 },
    { name: "Reinforcement Steel Bar (12mm)", unit: "ton", unitPrice: 980 },
    { name: "Concrete Blocks", unit: "piece", unitPrice: 0.9 },
    { name: "Sand (fine, washed)", unit: "m³", unitPrice: 18 },
    { name: "Aggregate (coarse gravel)", unit: "m³", unitPrice: 22 },
    { name: "Structural Steel Beam (I-beam)", unit: "piece", unitPrice: 340 },
    { name: "Plywood Sheets (18mm)", unit: "sheet", unitPrice: 26 },
    { name: "Electrical Cable (per roll)", unit: "roll", unitPrice: 85 },
    { name: "PVC Pipes (4-inch)", unit: "piece", unitPrice: 14 },
    { name: "Paint (exterior, 20L)", unit: "bucket", unitPrice: 62 },
    { name: "Roofing Sheets (corrugated)", unit: "sheet", unitPrice: 21 },
    { name: "Glass Panels (tempered)", unit: "panel", unitPrice: 120 },
    { name: "Ceramic Floor Tiles", unit: "m²", unitPrice: 16 },
    { name: "HVAC Ducting", unit: "meter", unitPrice: 30 },
    { name: "Bitumen (asphalt binder)", unit: "ton", unitPrice: 560 },
  ];
  const suppliers = ["Sodo Building Materials PLC","Ethio Steel & Cement Supply","Rift Valley Aggregates",
    "National Hardware Distributors","Blue Nile Electrical Supplies","Abyssinia Construction Trading"];

  const materials = [];
  let materialSeq = 1;
  projects.forEach(p => {
    const itemCount = randInt(4, 8);
    const shuffled = [...materialCatalog].sort(() => Math.random() - 0.5).slice(0, itemCount);
    p.materials = shuffled.map(item => {
      const quantity = randInt(10, 500);
      const unitPrice = Number((item.unitPrice * (0.92 + Math.random() * 0.16)).toFixed(2));
      const totalCost = Number((quantity * unitPrice).toFixed(2));
      return {
        id: `mat_${materialSeq++}`,
        project_id: p.id,
        name: item.name,
        unit: item.unit,
        quantity,
        unit_price: unitPrice,
        total_cost: totalCost,
        supplier: randOf(suppliers),
        purchased_at: new Date(Date.now() - randInt(1, 180) * 86400000).toISOString(),
        purchased_by: randOf(p.team.length ? p.team : members).full_name,
      };
    });
    p.materials_total_cost = Number(p.materials.reduce((s, m) => s + m.total_cost, 0).toFixed(2));
  });

  function recalcMaterialsTotal(project) {
    project.materials_total_cost = Number((project.materials || []).reduce((s, m) => s + m.total_cost, 0).toFixed(2));
    return project.materials_total_cost;
  }
  function nextMaterialId() { return `mat_${materialSeq++}`; }

  // ---------------- Tasks (per-assignee, later scored by ai-engine.js) ----------------
  const taskTitlesByCategory = {
    "Site Work": ["Pour foundation slab","Install rebar mesh","Erect scaffolding","Excavate trench line","Compact sub-base layer"],
    "Inspection": ["Site safety inspection","Quality control walkthrough","Structural inspection sign-off","Material delivery inspection"],
    "Design": ["Review structural drawings","Update BIM model","Finalize interior finishing plan","Draft design change order"],
    "Coordination": ["Coordinate with electrical team","Client walkthrough","Schedule crane maintenance","Weekly progress sync"],
    "Admin": ["Submit weekly report","Order additional cement","Update progress photos","File permit renewal"],
  };
  const taskCategories = Object.keys(taskTitlesByCategory);

  const tasks = [];
  let taskSeq = 1;
  function makeTasksFor(member, count) {
    const memberProjects = projects.filter(p => p.team.some(t => t.id === member.id));
    const pool = memberProjects.length ? memberProjects : [randOf(projects)];
    for (let i = 0; i < count; i++) {
      const category = randOf(taskCategories);
      const title = randOf(taskTitlesByCategory[category]);
      const project = randOf(pool);
      const dueInDays = randInt(-2, 12); // negative = overdue
      const status = dueInDays < 0 ? randOf(["To Do","In Progress"]) : randOf(["To Do","To Do","In Progress","Done"]);
      tasks.push({
        id: `task_${taskSeq++}`,
        title, category,
        assignee_id: member.id,
        assignee_name: member.full_name,
        department: member.department,
        project_id: project.id,
        project_title: project.title,
        project_risk: project.delay_risk,
        status,
        blocking: Math.random() < 0.15,
        estimated_hours: randInt(1, 8),
        due_date: new Date(Date.now() + dueInDays * 86400000).toISOString(),
        created_at: new Date(Date.now() - randInt(1,20) * 86400000).toISOString(),
      });
    }
  }
  // Give every engineer + department manager a realistic task list
  members.filter(m => m.role === "Engineer" || m.role === "Department Manager").forEach(m => {
    makeTasksFor(m, m.role === "Department Manager" ? randInt(3,5) : randInt(4,8));
  });

  // ---------------- Daily Workers (#1 — casual/day labor, distinct from staff members) ----------------
  const dailyWorkerTrades = ["Mason","Carpenter","Rebar Fixer","General Laborer","Painter","Electrician's Helper",
    "Plumber's Helper","Welder","Scaffolder","Site Cleaner"];
  const dailyWorkers = [];
  for (let i = 0; i < 30; i++) {
    const name = `${randOf(firstNames)} ${randOf(lastNames)}`;
    const project = randOf(projects);
    dailyWorkers.push({
      id: `dw_${i+1}`,
      full_name: name,
      trade: randOf(dailyWorkerTrades),
      project_id: project.id,
      project_title: project.title,
      department: project.department,
      daily_rate: randInt(250, 650),
      phone: `+2519${randInt(10000000,99999999)}`,
      joined: new Date(Date.now() - randInt(10, 300) * 86400000).toISOString(),
      avatar_color: Utils.colorFromString(name),
      status: "Active",
    });
  }

  // ---------------- Attendance (#1 & #2 — daily attendance + AI absence ranking) ----------------
  // Generates the last 30 calendar days of attendance for every staff member (Engineers +
  // Department Managers, i.e. field-facing roles) and every daily worker. Weekends are
  // skipped for staff; daily workers can be scheduled any day since site work continues.
  const ATTENDANCE_DAYS = 30;
  const attendance = [];
  let attendanceSeq = 1;

  function isWeekend(date) { const d = date.getDay(); return d === 0 || d === 6; }

  function generateAttendanceFor(person, personType, absenceBias = 0.08) {
    for (let d = 0; d < ATTENDANCE_DAYS; d++) {
      const date = new Date(Date.now() - d * 86400000);
      if (personType === "staff" && isWeekend(date)) continue;
      const status = Math.random() < absenceBias ? "Absent" : "Present";
      attendance.push({
        id: `att_${attendanceSeq++}`,
        person_id: person.id,
        person_name: person.full_name,
        person_type: personType, // "staff" | "daily_worker"
        department: person.department,
        project_id: person.project_id || null,
        project_title: person.project_title || null,
        date: date.toISOString().slice(0, 10),
        status, // Present | Absent
        check_in: status === "Absent" ? null : `0${randInt(6,8)}:${randInt(0,59)}`.slice(0,5),
        recorded_by: "Workforce & Attendance",
        // Absence reason workflow — filled in by the absent person themselves
        reason: null,              // free-text explanation
        reason_category: null,     // Sick Leave | Family Emergency | ...
        reason_submitted_at: null,
        reason_status: status === "Absent" ? "Not Submitted" : null, // Not Submitted | Pending | Accepted | Rejected
        reason_reviewed_by: null,
        reason_reviewed_at: null,
        reason_review_note: null,
      });
    }
  }

  const fieldStaff = members.filter(m => m.role === "Engineer" || m.role === "Department Manager");
  fieldStaff.forEach(m => generateAttendanceFor(m, "staff", 0.07));
  // A handful of workers get a deliberately elevated absence bias so the AI ranking has
  // clear, believable standouts rather than uniform noise.
  dailyWorkers.forEach((w, i) => generateAttendanceFor(w, "daily_worker", i < 5 ? 0.32 : 0.09));

  // ---------------- Absence reason workflow ----------------
  const ABSENCE_REASON_CATEGORIES = [
    "Sick Leave", "Family Emergency", "Medical Appointment", "Transport Problem",
    "Bereavement", "Approved Leave", "Personal Matter", "Other",
  ];

  const SAMPLE_REASONS = {
    "Sick Leave": "Came down with a fever overnight and was advised to rest for the day.",
    "Family Emergency": "Had to attend to an urgent family matter at home.",
    "Medical Appointment": "Scheduled hospital appointment that could not be moved.",
    "Transport Problem": "No transport available from my area due to a road closure.",
    "Bereavement": "Attending a funeral for a close family member.",
    "Approved Leave": "Annual leave previously agreed with my supervisor.",
    "Personal Matter": "Unavoidable personal commitment; informed the site lead in advance.",
    "Other": "Unable to reach the site today; details shared with the supervisor.",
  };

  // Pre-fill roughly 60% of past absences with a submitted reason so the review
  // queue and the manager-facing "Reasons" tab have believable content.
  const REVIEW_OUTCOMES = ["Pending", "Pending", "Accepted", "Accepted", "Accepted", "Rejected"];
  attendance.filter(a => a.status === "Absent").forEach(a => {
    if (Math.random() > 0.6) return; // the rest stay "Not Submitted"
    const category = randOf(ABSENCE_REASON_CATEGORIES);
    const outcome = randOf(REVIEW_OUTCOMES);
    a.reason_category = category;
    a.reason = SAMPLE_REASONS[category];
    a.reason_submitted_at = new Date(new Date(a.date).getTime() + randInt(2, 30) * 3600000).toISOString();
    a.reason_status = outcome;
    if (outcome !== "Pending") {
      const reviewer = members.find(m => m.role === "Department Manager" && m.department === a.department)
        || members.find(m => m.id === "mem_dm_9") || members[0];
      a.reason_reviewed_by = reviewer.full_name;
      a.reason_reviewed_at = new Date(new Date(a.reason_submitted_at).getTime() + randInt(2, 48) * 3600000).toISOString();
      a.reason_review_note = outcome === "Accepted"
        ? "Reason accepted — absence recorded as excused."
        : "Insufficient notice given; absence recorded as unexcused.";
    }
  });

  function submitAbsenceReason(personId, date, { reason, reason_category }) {
    const record = attendance.find(a => a.person_id === personId && a.date === date);
    if (!record) return { ok: false, error: "No attendance record for that day." };
    if (record.status !== "Absent") return { ok: false, error: "You can only explain a day marked Absent." };
    if (record.reason_status === "Accepted") return { ok: false, error: "This reason was already accepted and is locked." };

    record.reason = reason;
    record.reason_category = reason_category || "Other";
    record.reason_submitted_at = new Date().toISOString();
    record.reason_status = "Pending";
    // Re-submitting after a rejection clears the previous review.
    record.reason_reviewed_by = null;
    record.reason_reviewed_at = null;
    record.reason_review_note = null;
    return { ok: true, record };
  }

  function reviewAbsenceReason(personId, date, { decision, note, reviewer }) {
    const record = attendance.find(a => a.person_id === personId && a.date === date);
    if (!record) return { ok: false, error: "No attendance record for that day." };
    if (!record.reason) return { ok: false, error: "No reason has been submitted for that day." };
    if (!["Accepted", "Rejected"].includes(decision)) return { ok: false, error: "Invalid decision." };

    record.reason_status = decision;
    record.reason_reviewed_by = reviewer?.name || reviewer?.full_name || "Unknown";
    record.reason_reviewed_at = new Date().toISOString();
    record.reason_review_note = note || (decision === "Accepted"
      ? "Reason accepted — absence recorded as excused."
      : "Reason rejected — absence recorded as unexcused.");
    return { ok: true, record };
  }

  // ---------------- Complaints ----------------
  const complaintCategories = ["Material Quality","Payment Delay","Safety Violation","Project Delay",
    "Staff Behavior","Technical Issue","Contract Dispute","Procurement Issue"];
  const severities = ["critical", "high", "medium", "low"];
  const sentiments = ["Angry", "Frustrated", "Neutral"];
  const complaintTexts = [
    "The concrete delivered to the site last week does not meet the specified grade and is already showing cracks.",
    "Our invoice for phase 2 completion has been pending for over 45 days despite multiple follow-ups.",
    "Workers on site were observed without proper harnesses while working at height on the east wing.",
    "The project has fallen three weeks behind the agreed schedule with no clear communication on the cause.",
    "A site supervisor was reported to be verbally abusive toward junior staff during the morning shift.",
    "The HVAC ducting installed does not match the approved design specifications and needs rework.",
    "There is a dispute over the scope of work defined in the latest contract addendum.",
    "The steel rebar shipment from the supplier arrived two weeks later than the agreed procurement schedule."
  ];

  const DEPARTMENT_ROUTING = {
    "Material Quality": "Quality Control", "Payment Delay": "Finance & Budget", "Safety Violation": "Health & Safety",
    "Project Delay": "Site Operations", "Staff Behavior": "Human Resources", "Technical Issue": "Engineering & Design",
    "Contract Dispute": "Client Relations", "Procurement Issue": "Procurement & Supply",
  };

  const complaints = [];
  const nonAuditorMembers = members.filter(m => m.role !== "Auditor");
  for (let i = 0; i < 26; i++) {
    const category = randOf(complaintCategories);
    const severity = randOf(severities);
    const proj = randOf(projects);
    const status = randOf(["pending","pending","in_progress","resolved","resolved"]);
    const department = DEPARTMENT_ROUTING[category];
    const isClientComplaint = Math.random() < 0.4;
    const submitter = isClientComplaint ? randOf(clients) : randOf(nonAuditorMembers);
    complaints.push({
      id: `CMP-${1000+i}`,
      submitted_by: submitter.id,
      submitted_by_type: isClientComplaint ? "client" : "member",
      customer_name: isClientComplaint ? submitter.contact_name : submitter.full_name,
      category,
      severity,
      status,
      department,
      project: proj.title,
      text: randOf(complaintTexts),
      sentiment: randOf(sentiments),
      ai_summary: "AI has identified this as a " + severity + " priority issue related to " + category.toLowerCase() + ", requiring coordination with the assigned department for resolution.",
      confidence: randInt(78, 98),
      created_at: new Date(Date.now() - randInt(0, 20) * 86400000).toISOString(),
      assignee: (members.find(m => m.role === "Department Manager" && m.department === department) || {}).full_name || "Unassigned",
      resolution_note: status === "resolved" ? "Issue reviewed and resolved after coordination with the responsible department." : "",
    });
  }
  // Guarantee the demo client has at least one complaint of their own to see
  complaints.unshift({
    id: "CMP-2001", submitted_by: "client_1", submitted_by_type: "client", customer_name: clients[0].contact_name,
    category: "Project Delay", severity: "medium", status: "pending", department: "Site Operations",
    project: projects[0].title, text: "We were told the east wing would be enclosed by now but there has been no visible progress in two weeks.",
    sentiment: "Frustrated", ai_summary: "AI has identified this as a medium priority issue related to project delay, requiring coordination with Site Operations.",
    confidence: 89, created_at: new Date(Date.now() - 2*86400000).toISOString(),
    assignee: (members.find(m => m.role === "Department Manager" && m.department === "Site Operations") || {}).full_name || "Unassigned",
    resolution_note: "",
  });

  // ---------------- Audit taxonomy (7 audit types) ----------------
  // Every audit event is classified into exactly one of seven audit types.
  // Each type declares the signals it watches for and the ML technique the
  // AI layer applies to it, so the Audit Intelligence page can explain
  // *why* something was flagged and *how* it was analyzed.
  const AUDIT_TYPES = {
    SECURITY: {
      key: "SECURITY", label: "Security Audit", icon: "fa-lock", color: "red",
      purpose: "Monitors who accesses the system and how",
      ml_role: "Anomaly detection",
      signals: [
        "Failed login attempts",
        "Logins at unusual hours",
        "Multiple IP address changes",
        "Unauthorized module access",
      ],
      actions: ["LOGIN", "LOGIN_FAILED", "LOGOUT", "IP_CHANGE", "UNAUTHORIZED_ACCESS", "PERMISSION_CHANGE"],
    },
    FINANCIAL: {
      key: "FINANCIAL", label: "Financial Audit", icon: "fa-coins", color: "yellow",
      purpose: "Tracks all money-related actions",
      ml_role: "Outlier scoring",
      signals: [
        "Payment approvals",
        "Budget modifications",
        "Invoice creation/deletion",
        "Expense claims above threshold",
      ],
      actions: ["PAYMENT_APPROVAL", "BUDGET_MODIFY", "INVOICE_CREATE", "INVOICE_DELETE", "EXPENSE_CLAIM"],
    },
    COMPLIANCE: {
      key: "COMPLIANCE", label: "Compliance Audit", icon: "fa-clipboard-check", color: "blue",
      purpose: "Ensures users follow company rules",
      ml_role: "Rule violation scoring",
      signals: [
        "Proper approval chains followed?",
        "Documents submitted on time?",
        "Required fields filled correctly?",
        "Policy violations flagged",
      ],
      actions: ["APPROVAL_BYPASS", "LATE_SUBMISSION", "INCOMPLETE_RECORD", "POLICY_VIOLATION"],
    },
    USER_ACTIVITY: {
      key: "USER_ACTIVITY", label: "User Activity Audit", icon: "fa-user-clock", color: "purple",
      purpose: "Tracks what every user does",
      ml_role: "Pattern detection",
      signals: [
        "Actions per session",
        "Bulk operations (mass delete/edit)",
        "Role misuse (doing things outside their role)",
        "Inactive accounts still accessing system",
      ],
      actions: ["BULK_DELETE", "BULK_EDIT", "ROLE_MISUSE", "DORMANT_ACCESS", "VIEW_SENSITIVE"],
    },
    DATA_INTEGRITY: {
      key: "DATA_INTEGRITY", label: "Data Integrity Audit", icon: "fa-database", color: "accent",
      purpose: "Detects unauthorized data changes",
      ml_role: "Change anomaly detection",
      signals: [
        "Record edits without approval",
        "Deleted records",
        "Duplicate entries",
        "Data imported from outside sources",
      ],
      actions: ["UPDATE_RECORD", "UNAPPROVED_EDIT", "RECORD_DELETE", "DUPLICATE_ENTRY", "EXTERNAL_IMPORT"],
    },
    PROJECT_RESOURCE: {
      key: "PROJECT_RESOURCE", label: "Project & Resource Audit", icon: "fa-helmet-safety", color: "cyan",
      purpose: "Construction-specific resource and delivery oversight",
      ml_role: "Predictive analytics",
      signals: [
        "Material usage vs budget",
        "Equipment assigned vs returned",
        "Project milestone delays",
        "Contractor performance tracking",
      ],
      actions: ["MATERIAL_OVERUSE", "EQUIPMENT_CHECKOUT", "EQUIPMENT_UNRETURNED", "MILESTONE_DELAY", "CONTRACTOR_REVIEW"],
    },
    REPORT_DOCUMENT: {
      key: "REPORT_DOCUMENT", label: "Report & Document Audit", icon: "fa-file-shield", color: "green",
      purpose: "Tracks report generation and document access activity",
      ml_role: "Access pattern analysis",
      signals: [
        "Who generated what report",
        "Reports downloaded or shared externally",
        "Modified reports after approval",
        "Frequency of report generation",
      ],
      actions: ["REPORT_GENERATE", "EXPORT_DATA", "EXTERNAL_SHARE", "POST_APPROVAL_EDIT", "FILE_UPLOAD", "DELETE_DOCUMENT"],
    },
  };

  const AUDIT_TYPE_LIST = Object.values(AUDIT_TYPES);

  // Reverse index: action -> audit type key
  const ACTION_TO_TYPE = {};
  AUDIT_TYPE_LIST.forEach(t => t.actions.forEach(a => { ACTION_TO_TYPE[a] = t.key; }));

  function auditTypeForAction(action) {
    return ACTION_TO_TYPE[action] || "USER_ACTIVITY";
  }
  function auditTypeMeta(key) {
    return AUDIT_TYPES[key] || AUDIT_TYPES.USER_ACTIVITY;
  }

  // Human-readable label for each raw action code
  const ACTION_LABELS = {
    LOGIN: "Login", LOGIN_FAILED: "Failed login", LOGOUT: "Logout",
    IP_CHANGE: "IP address change", UNAUTHORIZED_ACCESS: "Unauthorized module access",
    PERMISSION_CHANGE: "Permission change",
    PAYMENT_APPROVAL: "Payment approval", BUDGET_MODIFY: "Budget modification",
    INVOICE_CREATE: "Invoice created", INVOICE_DELETE: "Invoice deleted",
    EXPENSE_CLAIM: "Expense claim",
    APPROVAL_BYPASS: "Approval chain bypassed", LATE_SUBMISSION: "Late document submission",
    INCOMPLETE_RECORD: "Incomplete required fields", POLICY_VIOLATION: "Policy violation",
    BULK_DELETE: "Bulk delete", BULK_EDIT: "Bulk edit", ROLE_MISUSE: "Role misuse",
    DORMANT_ACCESS: "Dormant account access", VIEW_SENSITIVE: "Viewed sensitive data",
    UPDATE_RECORD: "Record updated", UNAPPROVED_EDIT: "Edit without approval",
    RECORD_DELETE: "Record deleted", DUPLICATE_ENTRY: "Duplicate entry",
    EXTERNAL_IMPORT: "External data import",
    MATERIAL_OVERUSE: "Material usage over budget", EQUIPMENT_CHECKOUT: "Equipment checked out",
    EQUIPMENT_UNRETURNED: "Equipment not returned", MILESTONE_DELAY: "Milestone delay",
    CONTRACTOR_REVIEW: "Contractor performance review",
    REPORT_GENERATE: "Report generated", EXPORT_DATA: "Data export",
    EXTERNAL_SHARE: "Shared externally", POST_APPROVAL_EDIT: "Report edited after approval",
    FILE_UPLOAD: "File upload", DELETE_DOCUMENT: "Document deleted",
  };
  function actionLabel(action) {
    return ACTION_LABELS[action] || String(action).replace(/_/g, " ").toLowerCase();
  }

  // ---------------- Audit logs ----------------
  const auditActions = AUDIT_TYPE_LIST.flatMap(t => t.actions);
  const auditLogs = [];
  const internalMembers = members.filter(m => m.role !== "Client");

  // Resources are drawn per audit type so each event reads plausibly
  const RESOURCES_BY_TYPE = {
    SECURITY: ["auth/login", "auth/session", "settings/permissions", "admin/console", "api/tokens"],
    FINANCIAL: ["finance/invoices", "finance/payments", "projects/budget", "finance/expense-claims", "finance/payroll"],
    COMPLIANCE: ["compliance/approvals", "documents/permits", "compliance/checklists", "contracts/addendum"],
    USER_ACTIVITY: ["members table", "complaints DB", "tasks/bulk", "users/roles", "attendance records"],
    DATA_INTEGRITY: ["projects/proj_12", "members table", "materials ledger", "attendance records", "imports/external"],
    PROJECT_RESOURCE: ["projects/proj_3/materials", "equipment/registry", "projects/milestones", "contractors/performance"],
    REPORT_DOCUMENT: ["reports/export", "documents/Structural_Drawings_v3.pdf", "reports/attendance", "documents/shared-link"],
  };

  // Highest-risk actions per type — these drive the anomaly score upward
  const HIGH_RISK_ACTIONS = new Set([
    "LOGIN_FAILED", "UNAUTHORIZED_ACCESS", "PERMISSION_CHANGE", "IP_CHANGE",
    "INVOICE_DELETE", "BUDGET_MODIFY",
    "APPROVAL_BYPASS", "POLICY_VIOLATION",
    "BULK_DELETE", "ROLE_MISUSE", "DORMANT_ACCESS",
    "UNAPPROVED_EDIT", "RECORD_DELETE", "EXTERNAL_IMPORT",
    "MATERIAL_OVERUSE", "EQUIPMENT_UNRETURNED",
    "EXTERNAL_SHARE", "POST_APPROVAL_EDIT", "EXPORT_DATA",
  ]);

  // Type-specific narrative for why the AI flagged this event
  function explainAuditEvent(type, actorName, action, score) {
    if (score <= 0.5) return "Access pattern consistent with role and history.";
    const label = actionLabel(action).toLowerCase();
    const by = {
      SECURITY: `Anomaly detection flagged ${actorName}: ${label} deviates from their established access baseline (device, hour, and location profile).`,
      FINANCIAL: `Outlier scoring flagged ${actorName}: this ${label} sits well outside the normal value distribution for their approval history.`,
      COMPLIANCE: `Rule violation scoring flagged ${actorName}: ${label} breaks a required approval or submission rule for this record type.`,
      USER_ACTIVITY: `Pattern detection flagged ${actorName}: ${label} is inconsistent with the volume and scope this role normally performs.`,
      DATA_INTEGRITY: `Change anomaly detection flagged ${actorName}: ${label} altered records without the expected approval trail.`,
      PROJECT_RESOURCE: `Predictive analytics flagged ${actorName}: ${label} projects a budget or schedule overrun against the plan baseline.`,
      REPORT_DOCUMENT: `Access pattern analysis flagged ${actorName}: ${label} is an unusual distribution pattern for reports of this sensitivity.`,
    };
    return by[type] || by.USER_ACTIVITY;
  }

  for (let i = 0; i < 84; i++) {
    const user = randOf(internalMembers);
    // Spread events evenly across all seven types so every tab has content
    const type = AUDIT_TYPE_LIST[i % AUDIT_TYPE_LIST.length];
    const action = randOf(type.actions);
    const hour = randInt(0, 23);
    const isOdd = hour < 6 || hour > 22;
    const riskBase = (HIGH_RISK_ACTIONS.has(action) ? 0.45 : 0.1) + (isOdd ? 0.3 : 0) + Math.random() * 0.3;
    const score = Math.min(0.99, riskBase);
    const risk_level = score > 0.85 ? "CRITICAL" : score > 0.65 ? "HIGH" : score > 0.45 ? "MEDIUM" : "LOW";
    auditLogs.push({
      id: `log_${i + 1}`,
      user: user.full_name,
      user_role: user.role,
      action,
      action_label: actionLabel(action),
      audit_type: type.key,
      ml_role: type.ml_role,
      resource: randOf(RESOURCES_BY_TYPE[type.key]),
      timestamp: new Date(Date.now() - randInt(0, 14) * 86400000 - hour * 3600000).toISOString(),
      anomaly_score: Number(score.toFixed(4)),
      risk_level,
      is_flagged: score > 0.5,
      context: isOdd
        ? `${['Sat', 'Sun'][randInt(0, 1)]} ${hour}:${randInt(10, 59)} ${hour < 12 ? 'AM' : 'PM'} — outside working hours`
        : "Normal business hours",
      explanation: explainAuditEvent(type.key, user.full_name, action, score),
      review_status: score > 0.5 ? randOf(["Under Review", "Under Review", "Confirmed Threat", "False Alarm"]) : "Cleared",
    });
  }

  // ---------------- Live audit trail ----------------
  // Called from every meaningful management action across the app so the Audit
  // Intelligence page reflects real activity, not just the seeded rows above.
  let auditSeq = auditLogs.length;
  function logAuditEvent(actor, action, resource, meta = {}) {
    const hour = new Date().getHours();
    const isOdd = hour < 6 || hour > 22;
    // Classify the live event into one of the seven audit types
    const typeKey = meta.audit_type || auditTypeForAction(action);
    const type = auditTypeMeta(typeKey);
    const base = (HIGH_RISK_ACTIONS.has(action) ? 0.45 : 0.08) + (isOdd ? 0.28 : 0);
    const score = Math.min(0.99, Number((base + Math.random() * 0.18).toFixed(4)));
    const actorName = actor?.name || actor?.full_name || "System";
    const entry = {
      id: `log_${++auditSeq}`,
      user: actorName,
      user_role: actor?.role || "System",
      action,
      action_label: actionLabel(action),
      audit_type: type.key,
      ml_role: type.ml_role,
      resource,
      timestamp: new Date().toISOString(),
      anomaly_score: score,
      risk_level: score > 0.85 ? "CRITICAL" : score > 0.65 ? "HIGH" : score > 0.45 ? "MEDIUM" : "LOW",
      is_flagged: score > 0.5,
      context: isOdd ? `Performed at ${String(hour).padStart(2, "0")}:00 — outside working hours` : "Normal business hours",
      explanation: explainAuditEvent(type.key, actorName, action, score),
      review_status: score > 0.5 ? "Under Review" : "Cleared",
      ...meta,
    };
    auditLogs.unshift(entry);
    return entry;
  }

  // ---------------- Notifications ----------------
  // Each notification targets some combination of explicit user ids, roles, and
  // departments. `read_by` holds the ids of users who have read it, so read-state
  // is per-user rather than global.
  let notificationSeq = 0;
  const notifications = [];

  function addNotification({ title, body, icon = "fa-bell", type = "info", link = null, target = {} }) {
    const n = {
      id: `ntf_${++notificationSeq}`,
      title, body, icon, type, link,
      target: { user_ids: target.user_ids || [], roles: target.roles || [], departments: target.departments || [] },
      created_at: new Date().toISOString(),
      read_by: [],
    };
    notifications.unshift(n);
    return n;
  }

  function notificationsFor(user) {
    if (!user) return [];
    return notifications.filter(n => {
      const t = n.target;
      if (t.user_ids.includes(user.id)) return true;
      if (t.departments.length && user.department && t.departments.includes(user.department)) return true;
      if (t.roles.length && t.roles.includes(user.role)) return true;
      return false;
    });
  }

  function unreadCountFor(user) {
    if (!user) return 0;
    return notificationsFor(user).filter(n => !n.read_by.includes(user.id)).length;
  }

  function markNotificationRead(user, id) {
    const n = notifications.find(x => x.id === id);
    if (n && user && !n.read_by.includes(user.id)) n.read_by.push(user.id);
    return n;
  }

  function markAllNotificationsRead(user) {
    notificationsFor(user).forEach(n => { if (!n.read_by.includes(user.id)) n.read_by.push(user.id); });
    return notificationsFor(user);
  }

  // Seed a believable inbox for every role
  (function seedNotifications() {
    const openComplaint = complaints.find(c => c.status !== "resolved") || complaints[0];
    const riskyProject = projects.find(p => p.delay_risk === "HIGH") || projects[0];
    const flagged = auditLogs.find(l => l.is_flagged);
    const workforceMgr = members.find(m => m.role === "Department Manager" && m.department === "Workforce & Attendance");

    addNotification({
      title: "New complaint awaiting triage",
      body: `${openComplaint.id} — ${openComplaint.category} on ${openComplaint.project}.`,
      icon: "fa-triangle-exclamation", type: "warning", link: "complaints.html",
      target: { roles: ["Super Admin", "General Manager"], departments: [openComplaint.department] },
    });
    addNotification({
      title: "Project flagged HIGH delay risk",
      body: `${riskyProject.title} is ${riskyProject.progress}% complete against an expected ${riskyProject.expected_progress}%.`,
      icon: "fa-diagram-project", type: "error", link: "projects.html",
      target: { roles: ["Super Admin", "General Manager"], departments: [riskyProject.department] },
    });
    if (flagged) {
      addNotification({
        title: "Audit anomaly detected",
        body: `${flagged.user} — ${flagged.action.replace(/_/g, " ").toLowerCase()} scored ${Math.round(flagged.anomaly_score * 100)}/100.`,
        icon: "fa-shield-halved", type: "error", link: "audit.html",
        target: { roles: ["Super Admin", "General Manager", "Auditor"] },
      });
    }
    addNotification({
      title: "Attendance not yet recorded",
      body: "Today's attendance has not been submitted for all tracked workers.",
      icon: "fa-clipboard-user", type: "info", link: "attendance.html",
      target: { roles: ["Super Admin", "General Manager"], departments: [workforceMgr ? workforceMgr.department : "Workforce & Attendance"] },
    });
    addNotification({
      title: "Tasks due this week",
      body: "You have open tasks ranked CRITICAL by the AI prioritizer.",
      icon: "fa-list-check", type: "warning", link: "tasks.html",
      target: { user_ids: ["mem_6"] },
    });
    addNotification({
      title: "Update on your complaint",
      body: "CMP-2001 has been received and routed to Site Operations.",
      icon: "fa-comment-dots", type: "info", link: "complaints.html",
      target: { user_ids: ["client_1"] },
    });
  })();

  // ---------------- Documents ----------------
  // Uploaded files keep their real bytes as a Blob so "Download" returns exactly
  // what was uploaded. Seeded rows synthesize a small placeholder blob on demand.
  let documentSeq = 0;
  const documents = [];

  function seedDocument(name, sizeLabel, by, date, icon, color, department) {
    documents.push({
      id: `doc_${++documentSeq}`,
      name, size_label: sizeLabel, uploaded_by: by, uploaded_by_id: (members.find(m => m.full_name === by) || {}).id || null,
      uploaded_at: date, icon, color, department, blob: null, seeded: true,
    });
  }
  seedDocument("Structural_Drawings_v3.pdf", "4.2 MB", "Dawit Alemu", "2026-07-20", "fa-file-pdf", "red", "Engineering & Design");
  seedDocument("Site_Safety_Checklist.docx", "180 KB", "Yonas Bekele", "2026-07-18", "fa-file-word", "blue", "Health & Safety");
  seedDocument("Q2_Budget_Report.xlsx", "890 KB", "Selam Getachew", "2026-07-15", "fa-file-excel", "green", "Finance & Budget");
  seedDocument("Site_Photos_June.zip", "22.4 MB", "Meron Tadesse", "2026-07-10", "fa-file-zipper", "yellow", "Site Operations");
  seedDocument("Contract_Addendum_2.pdf", "1.1 MB", "Kaleb Mulugeta", "2026-07-05", "fa-file-pdf", "red", "Client Relations");

  function iconForFile(name = "") {
    const ext = name.split(".").pop().toLowerCase();
    if (["pdf"].includes(ext)) return { icon: "fa-file-pdf", color: "red" };
    if (["doc", "docx"].includes(ext)) return { icon: "fa-file-word", color: "blue" };
    if (["xls", "xlsx", "csv"].includes(ext)) return { icon: "fa-file-excel", color: "green" };
    if (["zip", "rar", "7z"].includes(ext)) return { icon: "fa-file-zipper", color: "yellow" };
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return { icon: "fa-file-image", color: "purple" };
    if (["txt", "md", "log"].includes(ext)) return { icon: "fa-file-lines", color: "cyan" };
    return { icon: "fa-file", color: "gray" };
  }

  function formatBytes(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function addDocument(file, user) {
    const { icon, color } = iconForFile(file.name);
    const doc = {
      id: `doc_${++documentSeq}`,
      name: file.name,
      size_label: formatBytes(file.size),
      size_bytes: file.size,
      uploaded_by: user?.name || "Unknown",
      uploaded_by_id: user?.id || null,
      uploaded_at: new Date().toISOString(),
      icon, color,
      department: user?.department || null,
      blob: file,           // the real File object — bytes preserved
      seeded: false,
    };
    documents.unshift(doc);
    return doc;
  }

  function removeDocument(id) {
    const i = documents.findIndex(d => d.id === id);
    if (i === -1) return false;
    documents.splice(i, 1);
    return true;
  }

  function documentsFor(user) {
    if (!user) return [];
    if (window.Roles && Roles.ORG_WIDE.includes(user.role)) return documents;
    if (user.role === "Auditor") return documents;
    if (user.role === "Client") return documents.filter(d => d.uploaded_by_id === user.id);
    // Department Manager / Engineer: their department's documents + anything they uploaded
    return documents.filter(d => !d.department || d.department === user.department || d.uploaded_by_id === user.id);
  }

  // ---------------- Password reset tokens ----------------
  const passwordResetTokens = {}; // token -> { email, expires }

  function createPasswordResetToken(email) {
    const token = Utils.uid("prt") + Math.random().toString(36).slice(2, 10);
    passwordResetTokens[token] = { email, expires: Date.now() + 1000 * 60 * 30 }; // 30 min
    return token;
  }

  function consumePasswordResetToken(token) {
    const entry = passwordResetTokens[token];
    if (!entry) return { ok: false, error: "This reset link is invalid." };
    if (Date.now() > entry.expires) { delete passwordResetTokens[token]; return { ok: false, error: "This reset link has expired." }; }
    delete passwordResetTokens[token];
    return { ok: true, email: entry.email };
  }

  const chatSuggestions = [
    "Which projects are at risk?",
    "Summarize today's complaints",
    "Who is overloaded this week?",
    "Generate monthly report"
  ];

  function chatbotReply(message, user) {
    const m = message.toLowerCase();
    const scopedProjects = (window.Roles ? Roles.visibleProjects(user, projects) : projects);
    if (m.includes("risk") || m.includes("delay")) {
      const risky = scopedProjects.filter(p => p.delay_risk === "HIGH").slice(0, 4);
      if (!risky.length) return "Good news — none of your visible projects are currently flagged HIGH risk.";
      return `Based on current data, **${risky.length} project${risky.length===1?"":"s"}** ${risky.length===1?"is":"are"} flagged HIGH risk:\n\n` +
        risky.map(p => `• **${p.title}** — ${p.progress}% complete (expected ${p.expected_progress}%), region: ${p.region}`).join("\n") +
        `\n\nRecommend reallocating resources to the two most delayed sites and reviewing procurement timelines.`;
    }
    if (m.includes("complaint")) {
      const visible = window.Roles ? Roles.visibleComplaints(user, complaints) : complaints;
      const pending = visible.filter(c => c.status === "pending").length;
      const critical = visible.filter(c => c.severity === "critical").length;
      return `Complaint overview:\n\n• **${pending}** pending review\n• **${critical}** marked critical severity\n• Top category: ${complaintCategories[0]}\n\n${user.role === "Department Manager" ? "Scoped to " + user.department + "." : "Most complaints are routed to Site Operations and Quality Control this week."}`;
    }
    if (m.includes("overload") || m.includes("workload")) {
      const busy = members.filter(mm => mm.projects_count >= 5).slice(0, 3);
      return `These team members currently have the highest workload:\n\n` +
        busy.map(mm => `• **${mm.full_name}** (${mm.role}) — ${mm.projects_count} active projects`).join("\n") +
        `\n\nConsider redistributing tasks from these members over the next sprint.`;
    }
    if (m.includes("report")) {
      return `I can generate a report covering the areas you have access to. Head to the **Reports** page and click "Generate with AI", or tell me which section you'd like summarized here.`;
    }
    if (m.includes("schedule") || m.includes("task")) {
      return `I can prioritize your open tasks by urgency and project risk on the **Tasks** page — click "AI Prioritize" there to re-rank your list, or "Auto-Schedule" to place them on your weekly calendar.`;
    }
    return `I'm BuildIQ AI Assistant. I can help you analyze project risk, complaint trends, team workload, task priorities, and audit anomalies. This is a demo response generated in mock mode — connect the backend for live Groq-powered answers.`;
  }

  function dashboardStats(role) {
    return {
      active_projects: projects.filter(p => p.status === "In Progress").length,
      total_members: members.filter(m => m.role !== "Client").length,
      high_risk: projects.filter(p => p.delay_risk === "HIGH").length,
      open_complaints: complaints.filter(c => c.status !== "resolved").length,
      audit_flags: auditLogs.filter(l => l.is_flagged).length,
    };
  }

  function getMemberById(id) { return members.find(m => m.id === id); }
  function getMemberByName(name) { return members.find(m => m.full_name === name); }
  function getClientById(id) { return clients.find(c => c.id === id); }
  function getDepartmentByName(name) { return departments.find(d => d.name === name); }
  function getProjectById(id) { return projects.find(p => p.id === id); }
  function getDailyWorkerById(id) { return dailyWorkers.find(w => w.id === id); }

  // Backfill simple counts onto each department object now that members/projects exist,
  // so any legacy code referencing dept.members / dept.projects still works.
  departments.forEach(d => {
    d.members = members.filter(m => m.department === d.name).length;
    d.projects = projects.filter(p => p.department === d.name).length;
  });

  return {
    departments, members, clients, projects, tasks, complaints, auditLogs, chatSuggestions,
    dailyWorkers, attendance, materialCatalog, suppliers,
    // absence reason workflow
    ABSENCE_REASON_CATEGORIES, submitAbsenceReason, reviewAbsenceReason,
    chatbotReply, dashboardStats, complaintCategories, DEPARTMENT_ROUTING,
    // audit taxonomy (7 audit types)
    AUDIT_TYPES, AUDIT_TYPE_LIST, auditTypeForAction, auditTypeMeta, actionLabel,
    getMemberById, getMemberByName, getClientById, getDepartmentByName, getProjectById, getDailyWorkerById,
    // project manager / department staffing
    getProjectsManagedBy, setProjectManager, setDepartmentHead, assignMemberToDepartment,
    createDepartment, createMember, createClient,
    recalcMaterialsTotal, nextMaterialId,
    // live audit trail
    logAuditEvent,
    // notifications
    notifications, addNotification, notificationsFor, unreadCountFor,
    markNotificationRead, markAllNotificationsRead,
    // documents
    documents, addDocument, removeDocument, documentsFor, iconForFile, formatBytes,
    // password reset
    createPasswordResetToken, consumePasswordResetToken,
  };
})();
