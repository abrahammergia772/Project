/* ============================================================
   BuildIQ — mock-data.js
   Realistic sample data used when BUILDIQ_CONFIG.MOCK_MODE = true
   Lets the whole frontend run and look fully alive with zero backend.
   ============================================================ */

const MockData = (() => {

  const departments = [
    { id: "dep_1", name: "Site Operations", head: "Meron Tadesse", members: 24, projects: 6 },
    { id: "dep_2", name: "Engineering & Design", head: "Dawit Alemu", members: 18, projects: 5 },
    { id: "dep_3", name: "Finance & Budget", head: "Selam Getachew", members: 9, projects: 3 },
    { id: "dep_4", name: "Health & Safety", head: "Yonas Bekele", members: 7, projects: 2 },
    { id: "dep_5", name: "Human Resources", head: "Hanna Girma", members: 6, projects: 1 },
    { id: "dep_6", name: "Quality Control", head: "Abel Wondimu", members: 11, projects: 4 },
    { id: "dep_7", name: "Procurement & Supply", head: "Rahel Solomon", members: 8, projects: 3 },
    { id: "dep_8", name: "Client Relations", head: "Kaleb Mulugeta", members: 5, projects: 2 },
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

  const roles = ["Super Admin", "Manager", "Engineer", "Auditor"];
  const statuses = ["Active", "Active", "Active", "On Leave", "Inactive"];

  const members = [];
  for (let i = 0; i < 42; i++) {
    const name = `${randOf(firstNames)} ${randOf(lastNames)}`;
    const role = i === 0 ? "Super Admin" : randOf(roles.slice(1).concat(["Manager","Engineer","Engineer"]));
    const dept = randOf(departments);
    members.push({
      id: `mem_${i+1}`,
      full_name: name,
      email: `${name.toLowerCase().replace(/\s+/g,'.')}@buildiq.et`,
      role,
      department: dept.name,
      job_title: role === "Engineer" ? randOf(["Site Engineer","Structural Engineer","Civil Engineer","Electrical Engineer"]) :
                 role === "Manager" ? "Department Manager" : role === "Auditor" ? "Compliance Auditor" : "System Administrator",
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

  const projectTypes = ["Residential", "Commercial", "Infrastructure", "Industrial", "Renovation"];
  const regions = ["Addis Ababa", "Wolaita Sodo", "Hawassa", "Bahir Dar", "Adama", "Mekelle"];
  const delayReasons = ["Material Delay", "Weather", "Permit Hold-up", "Labor Shortage", "Design Change", "Budget Constraint"];

  const projects = [];
  const projectNames = ["Sodo Tower Complex","Riverside Residences","Blue Nile Bridge Extension",
    "Adama Industrial Park","Hawassa Lakeside Mall","Mekelle Community Hospital","Addis Ring Road Phase 3",
    "Green Valley Housing","Sunrise Business Center","Sodo University Annex","Bahir Dar Marina Project",
    "Central Market Renovation","Highland Logistics Hub","Unity Sports Complex","Millennium Office Park"];
  for (let i = 0; i < projectNames.length; i++) {
    const progress = randInt(8, 98);
    const expected = Math.min(100, progress + randInt(-15, 20));
    const risk = progress < expected - 15 ? "HIGH" : progress < expected - 5 ? "MEDIUM" : "LOW";
    const team = Array.from({length: randInt(3,7)}, () => randOf(members));
    projects.push({
      id: `proj_${i+1}`,
      title: projectNames[i],
      type: randOf(projectTypes),
      region: randOf(regions),
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
  projects.forEach(p => {
    p.spent = Math.round(p.budget * (p.progress/100) * (0.9 + Math.random()*0.3));
    p.tasks_done = Math.round(p.tasks_total * (p.progress/100));
  });

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

  const complaints = [];
  for (let i = 0; i < 26; i++) {
    const category = randOf(complaintCategories);
    const severity = randOf(severities);
    const proj = randOf(projects);
    const status = randOf(["pending","pending","in_progress","resolved","resolved"]);
    complaints.push({
      id: `CMP-${1000+i}`,
      customer_name: `${randOf(firstNames)} ${randOf(lastNames)}`,
      category,
      severity,
      status,
      department: randOf(departments).name,
      project: proj.title,
      text: randOf(complaintTexts),
      sentiment: randOf(sentiments),
      ai_summary: "AI has identified this as a " + severity + " priority issue related to " + category.toLowerCase() + ", requiring coordination with the assigned department for resolution.",
      confidence: randInt(78, 98),
      created_at: new Date(Date.now() - randInt(0, 20) * 86400000).toISOString(),
      assignee: randOf(members.filter(m => m.role === "Manager")).full_name,
    });
  }

  const auditActions = ["LOGIN","EXPORT_DATA","BULK_DELETE","UPDATE_RECORD","VIEW_SENSITIVE","PERMISSION_CHANGE","FILE_UPLOAD","LOGOUT"];
  const auditLogs = [];
  for (let i = 0; i < 60; i++) {
    const user = randOf(members);
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

  function chatbotReply(message) {
    const m = message.toLowerCase();
    if (m.includes("risk") || m.includes("delay")) {
      const risky = projects.filter(p => p.delay_risk === "HIGH").slice(0, 4);
      return `Based on current data, **${risky.length} projects** are flagged HIGH risk:\n\n` +
        risky.map(p => `• **${p.title}** — ${p.progress}% complete (expected ${p.expected_progress}%), region: ${p.region}`).join("\n") +
        `\n\nRecommend reallocating resources to the two most delayed sites and reviewing procurement timelines.`;
    }
    if (m.includes("complaint")) {
      const pending = complaints.filter(c => c.status === "pending").length;
      const critical = complaints.filter(c => c.severity === "critical").length;
      return `Today's complaint overview:\n\n• **${pending}** complaints pending review\n• **${critical}** marked critical severity\n• Top category: ${complaintCategories[0]}\n\nMost complaints are routed to Site Operations and Quality Control this week.`;
    }
    if (m.includes("overload") || m.includes("workload")) {
      const busy = members.filter(m => m.projects_count >= 5).slice(0, 3);
      return `These team members currently have the highest workload:\n\n` +
        busy.map(m => `• **${m.full_name}** (${m.role}) — ${m.projects_count} active projects`).join("\n") +
        `\n\nConsider redistributing tasks from these members over the next sprint.`;
    }
    if (m.includes("report")) {
      return `I can generate a monthly report covering project progress, complaint trends, and audit findings. Head to the **Reports** page and click "Generate with AI", or tell me which section you'd like summarized here.`;
    }
    return `I'm BuildIQ AI Assistant. I can help you analyze project risk, complaint trends, team workload, and audit anomalies. This is a demo response generated in mock mode — connect the backend for live Groq-powered answers.`;
  }

  function dashboardStats(role) {
    return {
      active_projects: projects.filter(p => p.status === "In Progress").length,
      total_members: members.length,
      high_risk: projects.filter(p => p.delay_risk === "HIGH").length,
      open_complaints: complaints.filter(c => c.status !== "resolved").length,
      audit_flags: auditLogs.filter(l => l.is_flagged).length,
    };
  }

  return {
    departments, members, projects, complaints, auditLogs, chatSuggestions,
    chatbotReply, dashboardStats, complaintCategories,
  };
})();
