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
    const team = Array.from({length: randInt(3,7)}, () => randOf(engineers));
    const client = clients[i % clients.length];
    projects.push({
      id: `proj_${i+1}`,
      title: projectNames[i],
      type: randOf(projectTypes),
      region: randOf(regions),
      department: dept.name,
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

  projects.forEach(p => {
    p.spent = Math.round(p.budget * (p.progress/100) * (0.9 + Math.random()*0.3));
    p.tasks_done = Math.round(p.tasks_total * (p.progress/100));
  });

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

  // ---------------- Audit logs ----------------
  const auditActions = ["LOGIN","EXPORT_DATA","BULK_DELETE","UPDATE_RECORD","VIEW_SENSITIVE","PERMISSION_CHANGE","FILE_UPLOAD","LOGOUT"];
  const auditLogs = [];
  const internalMembers = members.filter(m => m.role !== "Client");
  for (let i = 0; i < 60; i++) {
    const user = randOf(internalMembers);
    const action = randOf(auditActions);
    const hour = randInt(0, 23);
    const isOdd = hour < 6 || hour > 22;
    const riskBase = (action === "BULK_DELETE" || action === "EXPORT_DATA" ? 0.45 : 0.1) + (isOdd ? 0.3 : 0) + Math.random()*0.3;
    const score = Math.min(0.99, riskBase);
    const risk_level = score > 0.85 ? "CRITICAL" : score > 0.65 ? "HIGH" : score > 0.45 ? "MEDIUM" : "LOW";
    auditLogs.push({
      id: `log_${i+1}`,
      user: user.full_name,
      user_role: user.role,
      action,
      resource: randOf(["members table","projects/proj_12","complaints DB","audit_logs","reports/export","settings"]),
      timestamp: new Date(Date.now() - randInt(0, 14)*86400000 - hour*3600000).toISOString(),
      anomaly_score: Number(score.toFixed(4)),
      risk_level,
      is_flagged: score > 0.5,
      context: isOdd ? `${['Sat','Sun'][randInt(0,1)]} ${hour}:${randInt(10,59)} ${hour<12?'AM':'PM'} — outside working hours` : "Normal business hours",
      explanation: score > 0.5 ? `${user.full_name} performed ${action} on ${randOf(['a weekend','a holiday','an unusual hour'])}, which deviates from their typical access pattern.` : "Access pattern consistent with role and history.",
      review_status: score > 0.5 ? randOf(["Under Review","Under Review","Confirmed Threat","False Alarm"]) : "Cleared",
    });
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
  function getClientById(id) { return clients.find(c => c.id === id); }
  function getDepartmentByName(name) { return departments.find(d => d.name === name); }

  // Backfill simple counts onto each department object now that members/projects exist,
  // so any legacy code referencing dept.members / dept.projects still works.
  departments.forEach(d => {
    d.members = members.filter(m => m.department === d.name).length;
    d.projects = projects.filter(p => p.department === d.name).length;
  });

  return {
    departments, members, clients, projects, tasks, complaints, auditLogs, chatSuggestions,
    chatbotReply, dashboardStats, complaintCategories, DEPARTMENT_ROUTING,
    getMemberById, getClientById, getDepartmentByName,
  };
})();
