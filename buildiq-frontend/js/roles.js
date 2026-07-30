/* ============================================================
   BuildIQ — roles.js
   Centralized role-capability logic used across pages.
   Keeping this in one place avoids scattering "if role === ..."
   checks everywhere and makes the permission model easy to audit.
   ============================================================ */

const Roles = (() => {

  const ALL = ["Super Admin", "General Manager", "Department Manager", "Project Manager", "Engineer", "Auditor", "Client"];

  // Roles that see/manage the whole organization (not scoped to one department)
  const ORG_WIDE = ["Super Admin", "General Manager"];

  const PROJECT_MANAGER = "Project Manager";

  // ---------------- Complaints (#6) ----------------
  // Admin + General Manager: read & resolve ANY complaint.
  // Department Manager: read & resolve complaints routed to their own department only.
  // Everyone else (Engineer, Client): can submit + track their own complaints only, no resolving.
  // Auditor: no complaints access at all (matches original access matrix).
  function canResolveAllComplaints(role) { return ORG_WIDE.includes(role); }
  function canResolveDeptComplaints(role) { return role === "Department Manager"; }
  function canResolveComplaint(user, complaint, allProjects = null) {
    if (canResolveAllComplaints(user.role)) return true;
    if (canResolveDeptComplaints(user.role)) return complaint.department === user.department;
    // A Project Manager resolves complaints raised against their own projects.
    if (user.role === PROJECT_MANAGER) {
      const projects = allProjects || (window.MockData ? MockData.projects : []);
      return managedProjects(user, projects).some(p => p.title === complaint.project);
    }
    return false;
  }
  function isSubmitOnly(role) { return role === "Engineer" || role === "Client"; }
  function visibleComplaints(user, allComplaints, allProjects = null) {
    if (canResolveAllComplaints(user.role)) return allComplaints;
    if (canResolveDeptComplaints(user.role)) return allComplaints.filter(c => c.department === user.department);
    if (user.role === PROJECT_MANAGER) {
      const projects = allProjects || (window.MockData ? MockData.projects : []);
      const titles = new Set(managedProjects(user, projects).map(p => p.title));
      return allComplaints.filter(c => titles.has(c.project) || c.submitted_by === user.id);
    }
    // Submit-only roles only ever see complaints they personally filed
    return allComplaints.filter(c => c.submitted_by === user.id || c.customer_name === user.name);
  }

  // ---------------- Departments (#4) ----------------
  function canViewAllDepartments(role) { return ORG_WIDE.includes(role) || role === "Auditor"; }
  function canViewOwnDepartmentOnly(role) { return role === "Department Manager" || role === "Engineer"; }
  function visibleDepartments(user, allDepartments) {
    if (canViewAllDepartments(user.role)) return allDepartments;
    if (canViewOwnDepartmentOnly(user.role)) return allDepartments.filter(d => d.name === user.department);
    return [];
  }

  // ---------------- Reports (#7) ----------------
  // Each role only sees report types relevant to what they're allowed to act on.
  const REPORT_TYPES = {
    "Super Admin": ["Organization Summary", "Project Progress Summary", "Complaint Analysis", "Audit & Compliance", "Team Performance", "Financial Overview", "Attendance & Absence Report"],
    "General Manager": ["Organization Summary", "Project Progress Summary", "Complaint Analysis", "Audit & Compliance", "Team Performance", "Financial Overview", "Attendance & Absence Report"],
    "Department Manager": ["Department Performance", "Department Complaint Summary", "Department Team Report", "Attendance & Absence Report"],
    "Auditor": ["Audit & Compliance", "Anomaly Summary"],
    "Project Manager": ["My Projects Summary", "Project Progress Summary", "Team Performance", "Attendance & Absence Report"],
    "Client": ["My Project Status Report"],
    "Engineer": [],
  };
  function reportTypesFor(role) { return REPORT_TYPES[role] || []; }
  function reportScopeLocked(role) {
    return role === "Department Manager" || role === "Client" || role === PROJECT_MANAGER;
  }

  // ---------------- Projects / Members scoping ----------------
  // Super Admin, General Manager and Auditor see EVERY project in the
  // organization. Everyone else only sees the projects they actually work on.
  const FULL_PROJECT_ACCESS = ["Super Admin", "General Manager", "Auditor"];

  function hasFullProjectAccess(role) { return FULL_PROJECT_ACCESS.includes(role); }

  // Is this person actually working on this project?
  function worksOnProject(user, project) {
    if (!user || !project) return false;
    if (project.manager_id === user.id) return true;                       // they run it
    if ((project.team || []).some(m => m.id === user.id)) return true;      // they're on the team
    return false;
  }

  function visibleProjects(user, allProjects) {
    if (hasFullProjectAccess(user.role)) return allProjects;
    // A Department Manager works across their whole department, plus any
    // project they personally manage (which may sit outside it).
    if (user.role === "Department Manager") {
      return allProjects.filter(p => p.department === user.department || worksOnProject(user, p));
    }
    // Project Managers and Engineers see only the projects they run or are on.
    // A Project Manager's Projects tab shows the projects they manage — and
    // nothing else. Being listed on someone else's team doesn't put that
    // project in their portfolio.
    if (user.role === PROJECT_MANAGER) {
      return allProjects.filter(p => managesProject(user, p));
    }
    if (user.role === "Engineer") {
      return allProjects.filter(p => worksOnProject(user, p));
    }
    if (user.role === "Client") return allProjects.filter(p => p.client_id === (user.client_id || user.id));
    return [];
  }

  // ---------------- Project Manager ----------------
  // A PM has full operational control over the projects they manage:
  // assign tasks, manage materials, update progress, resolve complaints
  // raised against those projects, and see their team's attendance.
  function isProjectManager(user) { return !!user && user.role === PROJECT_MANAGER; }

  function managedProjects(user, allProjects) {
    if (!user) return [];
    return allProjects.filter(p => p.manager_id === user.id);
  }
  function managesProject(user, project) {
    return !!user && !!project && project.manager_id === user.id;
  }
  // Everyone working on a project this person manages.
  function managedTeam(user, allProjects) {
    const seen = new Map();
    managedProjects(user, allProjects).forEach(p =>
      (p.team || []).forEach(m => { if (m.id !== user.id) seen.set(m.id, m); }));
    return [...seen.values()];
  }
  function canUpdateProjectProgress(user, project) {
    if (!user || !project) return false;
    if (ORG_WIDE.includes(user.role)) return true;
    if (managesProject(user, project)) return true;
    return user.role === "Department Manager" && user.department === project.department;
  }

  // ---------------- Project management ----------------
  // Only Super Admin and General Manager create projects, appoint department
  // heads, place engineers into departments, and choose a project's manager.
  function canCreateProject(user) { return !!user && ORG_WIDE.includes(user.role); }
  function canAssignProjectManager(user) { return !!user && ORG_WIDE.includes(user.role); }
  function canAssignDepartmentHead(user) { return !!user && ORG_WIDE.includes(user.role); }
  function canAssignEngineerToDepartment(user) { return !!user && ORG_WIDE.includes(user.role); }

  // Who is eligible to manage a project: department managers and senior
  // engineers, optionally narrowed to the owning department.
  function eligibleProjectManagers(allMembers, department = null) {
    return allMembers.filter(m => {
      if (m.status !== "Active") return false;
      if (![PROJECT_MANAGER, "Department Manager", "Engineer"].includes(m.role)) return false;
      if (m.role === "Engineer" && (m.experience_years || 0) < 5) return false; // senior engineers only
      if (department && m.department !== department) return false;
      return true;
    });
  }

  // Who is eligible to head a department: that department's managers first,
  // then experienced engineers already inside it.
  function eligibleDepartmentHeads(allMembers, department) {
    return allMembers.filter(m =>
      m.status === "Active" && m.department === department &&
      (m.role === "Department Manager" || (m.role === "Engineer" && (m.experience_years || 0) >= 6)));
  }
  function visibleMembers(user, allMembers) {
    if (ORG_WIDE.includes(user.role)) return allMembers;
    if (user.role === "Department Manager") return allMembers.filter(m => m.department === user.department);
    if (user.role === PROJECT_MANAGER) {
      const projects = window.MockData ? MockData.projects : [];
      const ids = new Set(managedTeam(user, projects).map(m => m.id));
      ids.add(user.id);
      return allMembers.filter(m => ids.has(m.id));
    }
    return allMembers.filter(m => m.id === user.id);
  }

  // ---------------- Tasks (#5) ----------------
  function canViewTeamTasks(role) {
    return ORG_WIDE.includes(role) || role === "Department Manager"
      || role === "Auditor" || role === PROJECT_MANAGER;
  }
  // Department Manager, General Manager, Auditor (and Super Admin) can send
  // tasks to workers. Auditors are otherwise read-only, but assigning
  // remedial/compliance work is an explicit exception to that.
  function canAssignTasks(role) {
    return ORG_WIDE.includes(role) || role === "Department Manager"
      || role === "Auditor" || role === PROJECT_MANAGER;
  }
  // Who a given assigner is allowed to send a task to.
  function assignableWorkers(user, allMembers, allDailyWorkers = [], allProjects = null) {
    if (!canAssignTasks(user.role)) return [];
    // A Project Manager can only assign to people on the projects they run.
    if (user.role === PROJECT_MANAGER) {
      const projects = allProjects || (window.MockData ? MockData.projects : []);
      const mine = managedProjects(user, projects);
      const ids = new Set(mine.map(p => p.id));
      const team = managedTeam(user, projects).map(m => ({
        id: m.id, name: m.full_name, sub: `${m.job_title || m.role} · ${m.department || "—"}`,
        type: "staff", department: m.department, avatar_color: m.avatar_color,
      }));
      const daily = allDailyWorkers.filter(w => ids.has(w.project_id)).map(w => ({
        id: w.id, name: w.full_name, sub: `${w.trade} · Daily Worker`,
        type: "daily_worker", department: w.department, avatar_color: w.avatar_color,
      }));
      return [...team, ...daily];
    }
    const staff = ORG_WIDE.includes(user.role) || user.role === "Auditor"
      ? allMembers.filter(m => m.role !== "Client")
      : allMembers.filter(m => m.department === user.department && m.role !== "Client");
    const daily = ORG_WIDE.includes(user.role) || user.role === "Auditor"
      ? allDailyWorkers
      : allDailyWorkers.filter(w => w.department === user.department);
    return [
      ...staff.map(m => ({ id: m.id, name: m.full_name, sub: `${m.job_title || m.role} · ${m.department || "—"}`, type: "staff", department: m.department, avatar_color: m.avatar_color })),
      ...daily.map(w => ({ id: w.id, name: w.full_name, sub: `${w.trade} · Daily Worker`, type: "daily_worker", department: w.department, avatar_color: w.avatar_color })),
    ];
  }

  // ---------------- Materials (project cost tracking) ----------------
  // Super Admin, General Manager, and the Department Manager who owns the project's
  // department can add/edit/delete purchased materials on that project.
  function canManageMaterials(user, project) {
    if (!user || !project) return false;
    if (ORG_WIDE.includes(user.role)) return true;
    if (managesProject(user, project)) return true; // PM owns their project's costs
    return user.role === "Department Manager" && user.department === project.department;
  }

  // ---------------- Attendance (#1, #2) ----------------
  // TAKING attendance is the exclusive job of the Workforce & Attendance
  // department — every member of that department (manager and staff alike) can
  // mark Present/Absent. Nobody else can, not even Super Admin or the General
  // Manager: they retain full *visibility* but never edit the register, so the
  // record has a single accountable owner.
  const WORKFORCE_DEPT = "Workforce & Attendance";

  function isWorkforceDept(user) {
    return !!user && user.department === WORKFORCE_DEPT;
  }
  function canTakeAttendance(user) {
    // Clients are external and never part of the workforce department.
    return isWorkforceDept(user) && user.role !== "Client";
  }
  function canViewAttendance(user) {
    // Oversight roles, the workforce department, and PMs (for their own crew).
    return ORG_WIDE.includes(user.role) || user.role === "Department Manager"
      || user.role === "Auditor" || user.role === PROJECT_MANAGER || canTakeAttendance(user);
  }
  function visibleAttendance(user, allAttendance) {
    if (ORG_WIDE.includes(user.role) || user.role === "Auditor") return allAttendance;
    if (canTakeAttendance(user)) return allAttendance; // workforce dept oversees everyone
    if (user.role === "Department Manager") return allAttendance.filter(a => a.department === user.department);
    if (user.role === PROJECT_MANAGER) {
      const projects = window.MockData ? MockData.projects : [];
      const ids = new Set(managedTeam(user, projects).map(m => m.id));
      const projIds = new Set(managedProjects(user, projects).map(p => p.id));
      return allAttendance.filter(a => ids.has(a.person_id) || projIds.has(a.project_id));
    }
    return [];
  }

  // ---------------- Absence reasons ----------------
  // Every user — including Engineers, who have no attendance-page access — can
  // see their own absence days and submit a reason for each one.
  function ownAttendance(user, allAttendance) {
    if (!user) return [];
    return allAttendance.filter(a => a.person_id === user.id);
  }
  function ownAbsences(user, allAttendance) {
    return ownAttendance(user, allAttendance).filter(a => a.status === "Absent");
  }
  function canSubmitAbsenceReason(user, record) {
    // You may only explain your own absence.
    return !!user && !!record && record.person_id === user.id && record.status === "Absent";
  }
  // Who may read the reasons other people submitted:
  // Department Manager, General Manager, Auditor and Super Admin.
  function canViewAbsenceReasons(user) {
    return !!user && (ORG_WIDE.includes(user.role)
      || user.role === "Department Manager" || user.role === "Auditor");
  }
  // Reviewing (accept/reject) a submitted reason. Auditors are read-only, so
  // they can read reasons but not rule on them.
  function canReviewAbsenceReason(user, record) {
    if (!user || !record) return false;
    if (ORG_WIDE.includes(user.role)) return true;
    if (user.role === "Department Manager") {
      return isWorkforceDept(user) || record.department === user.department;
    }
    return false;
  }
  function visibleAbsenceReasons(user, allAttendance) {
    if (!canViewAbsenceReasons(user)) return [];
    const withReason = allAttendance.filter(a => a.status === "Absent" && a.reason);
    if (ORG_WIDE.includes(user.role) || user.role === "Auditor") return withReason;
    if (isWorkforceDept(user)) return withReason;
    return withReason.filter(a => a.department === user.department);
  }
  function visibleDailyWorkers(user, allWorkers) {
    if (ORG_WIDE.includes(user.role) || user.role === "Auditor") return allWorkers;
    if (user.role === "Department Manager") {
      if (user.department === WORKFORCE_DEPT) return allWorkers;
      return allWorkers.filter(w => w.department === user.department);
    }
    return [];
  }

  // ---------------- Display helpers ----------------
  const ROLE_DESCRIPTIONS = {
    "Super Admin": "Full system access. Manage all users, audit logs, AI models, reports, and system configuration.",
    "General Manager": "Organization-wide oversight. Full visibility into projects, teams, complaints, audit logs, and reports across every department.",
    "Department Manager": "Department management. Projects, complaints, team members, and reports for their own department.",
    "Project Manager": "Runs specific projects end to end — team, tasks, materials, progress, and complaints for the projects they manage.",
    "Engineer": "Personal access. View assigned tasks, team documents, submit complaints, manage own schedule.",
    "Auditor": "Read-only security access. Audit logs, compliance reports, anomaly review only.",
    "Client": "External client access. View their own project's status, submit complaints, and read project reports.",
  };

  return {
    ALL, ORG_WIDE,
    canResolveAllComplaints, canResolveDeptComplaints, canResolveComplaint, isSubmitOnly, visibleComplaints,
    canViewAllDepartments, canViewOwnDepartmentOnly, visibleDepartments,
    REPORT_TYPES, reportTypesFor, reportScopeLocked,
    PROJECT_MANAGER, isProjectManager, managedProjects, managesProject, managedTeam,
    canUpdateProjectProgress,
    FULL_PROJECT_ACCESS, hasFullProjectAccess, worksOnProject,
    visibleProjects, visibleMembers,
    canCreateProject, canAssignProjectManager, canAssignDepartmentHead,
    canAssignEngineerToDepartment, eligibleProjectManagers, eligibleDepartmentHeads,
    canViewTeamTasks, canAssignTasks, assignableWorkers, canManageMaterials,
    WORKFORCE_DEPT, isWorkforceDept, canTakeAttendance, canViewAttendance, visibleAttendance, visibleDailyWorkers,
    ownAttendance, ownAbsences, canSubmitAbsenceReason, canViewAbsenceReasons,
    canReviewAbsenceReason, visibleAbsenceReasons,
    ROLE_DESCRIPTIONS,
  };
})();
