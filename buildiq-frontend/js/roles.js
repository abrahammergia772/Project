/* ============================================================
   BuildIQ — roles.js
   Centralized role-capability logic used across pages.
   Keeping this in one place avoids scattering "if role === ..."
   checks everywhere and makes the permission model easy to audit.
   ============================================================ */

const Roles = (() => {

  const ALL = ["Super Admin", "General Manager", "Department Manager", "Engineer", "Auditor", "Client"];

  // Roles that see/manage the whole organization (not scoped to one department)
  const ORG_WIDE = ["Super Admin", "General Manager"];

  // ---------------- Complaints (#6) ----------------
  // Admin + General Manager: read & resolve ANY complaint.
  // Department Manager: read & resolve complaints routed to their own department only.
  // Everyone else (Engineer, Client): can submit + track their own complaints only, no resolving.
  // Auditor: no complaints access at all (matches original access matrix).
  function canResolveAllComplaints(role) { return ORG_WIDE.includes(role); }
  function canResolveDeptComplaints(role) { return role === "Department Manager"; }
  function canResolveComplaint(user, complaint) {
    if (canResolveAllComplaints(user.role)) return true;
    if (canResolveDeptComplaints(user.role)) return complaint.department === user.department;
    return false;
  }
  function isSubmitOnly(role) { return role === "Engineer" || role === "Client"; }
  function visibleComplaints(user, allComplaints) {
    if (canResolveAllComplaints(user.role)) return allComplaints;
    if (canResolveDeptComplaints(user.role)) return allComplaints.filter(c => c.department === user.department);
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
    "Client": ["My Project Status Report"],
    "Engineer": [],
  };
  function reportTypesFor(role) { return REPORT_TYPES[role] || []; }
  function reportScopeLocked(role) { return role === "Department Manager" || role === "Client"; }

  // ---------------- Projects / Members scoping ----------------
  function visibleProjects(user, allProjects) {
    if (ORG_WIDE.includes(user.role)) return allProjects;
    if (user.role === "Department Manager") return allProjects.filter(p => p.department === user.department);
    if (user.role === "Engineer") return allProjects.filter(p => p.team.some(m => m.id === user.id) || p.department === user.department);
    if (user.role === "Client") return allProjects.filter(p => p.client_id === user.id);
    return [];
  }
  function visibleMembers(user, allMembers) {
    if (ORG_WIDE.includes(user.role)) return allMembers;
    if (user.role === "Department Manager") return allMembers.filter(m => m.department === user.department);
    return allMembers.filter(m => m.id === user.id);
  }

  // ---------------- Tasks (#5) ----------------
  function canViewTeamTasks(role) { return ORG_WIDE.includes(role) || role === "Department Manager"; }
  function canAssignTasks(role) { return ORG_WIDE.includes(role) || role === "Department Manager"; }

  // ---------------- Materials (project cost tracking) ----------------
  // Super Admin, General Manager, and the Department Manager who owns the project's
  // department can add/edit/delete purchased materials on that project.
  function canManageMaterials(user, project) {
    if (!user || !project) return false;
    if (ORG_WIDE.includes(user.role)) return true;
    return user.role === "Department Manager" && user.department === project.department;
  }

  // ---------------- Attendance (#1, #2) ----------------
  // Super Admin, General Manager, and the Workforce & Attendance department manager
  // can take/view attendance and see the AI absence ranking. Other Department Managers
  // see attendance for their own department's staff + daily workers (read-only).
  const WORKFORCE_DEPT = "Workforce & Attendance";
  function canTakeAttendance(user) {
    return ORG_WIDE.includes(user.role) || (user.role === "Department Manager" && user.department === WORKFORCE_DEPT);
  }
  function canViewAttendance(user) {
    return ORG_WIDE.includes(user.role) || user.role === "Department Manager" || user.role === "Auditor";
  }
  function visibleAttendance(user, allAttendance) {
    if (ORG_WIDE.includes(user.role) || user.role === "Auditor") return allAttendance;
    if (user.role === "Department Manager") {
      if (user.department === WORKFORCE_DEPT) return allAttendance; // workforce dept oversees everyone
      return allAttendance.filter(a => a.department === user.department);
    }
    return [];
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
    "Engineer": "Personal access. View assigned tasks, team documents, submit complaints, manage own schedule.",
    "Auditor": "Read-only security access. Audit logs, compliance reports, anomaly review only.",
    "Client": "External client access. View their own project's status, submit complaints, and read project reports.",
  };

  return {
    ALL, ORG_WIDE,
    canResolveAllComplaints, canResolveDeptComplaints, canResolveComplaint, isSubmitOnly, visibleComplaints,
    canViewAllDepartments, canViewOwnDepartmentOnly, visibleDepartments,
    REPORT_TYPES, reportTypesFor, reportScopeLocked,
    visibleProjects, visibleMembers,
    canViewTeamTasks, canAssignTasks, canManageMaterials,
    WORKFORCE_DEPT, canTakeAttendance, canViewAttendance, visibleAttendance, visibleDailyWorkers,
    ROLE_DESCRIPTIONS,
  };
})();
