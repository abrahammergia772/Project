/* ============================================================
   BuildIQ — reference-data.js

   Shared taxonomies and vocabularies. These are NOT mock records -- they are
   fixed reference values that the backend uses too, and both sides must agree:

     * AUDIT_TYPES mirrors app/ai_engine.py AUDIT_TYPES (GET /audit/types)
     * ABSENCE_REASON_CATEGORIES mirrors GET /attendance/reason-categories
     * chatSuggestions are UI prompt chips, purely presentational

   They were previously bundled inside mock-data.js, which meant a deployment
   running against a real API still had to ship the entire fake dataset just to
   render an audit-type label. Extracting them lets mock-data.js be dropped
   from production pages entirely.

   AUDIT_TYPES is a safe local default; ReferenceData.loadAuditTypes() refreshes
   it from the server so the frontend follows the backend if it ever changes.
   ============================================================ */

const ReferenceData = (() => {

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

  const ABSENCE_REASON_CATEGORIES = [
    "Sick Leave", "Family Emergency", "Medical Appointment", "Transport Problem",
    "Bereavement", "Approved Leave", "Personal Matter", "Other",
  ];

  const chatSuggestions = [
    "Which projects are at risk?",
    "Summarize today's complaints",
    "Who is overloaded this week?",
    "Generate monthly report"
  ];

  // Object.VALUES, not keys: callers iterate objects and read .label/.icon/
  // .color/.actions. Returning bare key strings broke the audit page.
  const AUDIT_TYPE_LIST = Object.values(AUDIT_TYPES);

  function auditTypeMeta(key) {
    return AUDIT_TYPES[key] || { label: key || "Unknown", color: "blue", icon: "fa-circle-question" };
  }

  /** Refresh the taxonomy from the server so client and API never drift. */
  async function loadAuditTypes() {
    try {
      const rows = await API.getAuditTypes();
      if (Array.isArray(rows) && rows.length) {
        rows.forEach(r => {
          if (r.key) AUDIT_TYPES[r.key] = { ...(AUDIT_TYPES[r.key] || {}), ...r };
        });
      }
    } catch (err) {
      // Non-fatal: the bundled defaults already match the backend.
      console.warn("[ReferenceData] could not refresh audit types:", err.message);
    }
    return AUDIT_TYPES;
  }

  return {
    AUDIT_TYPES, AUDIT_TYPE_LIST, auditTypeMeta, loadAuditTypes,
    ABSENCE_REASON_CATEGORIES,
    chatSuggestions,
  };
})();

if (typeof window !== "undefined") window.ReferenceData = ReferenceData;
