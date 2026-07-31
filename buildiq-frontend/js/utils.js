/* ============================================================
   BuildIQ — utils.js
   Helpers & formatters used across the app
   ============================================================ */

const Utils = (() => {

  function initials(name = "") {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  }

  // Deterministic color from a string (used for avatars without explicit color)
  function colorFromString(str = "") {
    const colors = ["#F97316", "#3B82F6", "#22C55E", "#A855F7", "#EAB308", "#EF4444"];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function roleColor(role = "") {
    const map = {
      "Super Admin": "orange",
      "General Manager": "cyan",
      "Department Manager": "blue",
      "Project Manager": "cyan",
      "Manager": "blue", // legacy alias
      "Engineer": "green",
      "Auditor": "purple",
      "Client": "teal",
    };
    return map[role] || "gray";
  }

  function roleColorHex(role = "") {
    const map = {
      "Super Admin": "var(--accent)",
      "General Manager": "var(--cyan)",
      "Department Manager": "var(--blue)",
      "Project Manager": "var(--cyan)",
      "Manager": "var(--blue)",
      "Engineer": "var(--green)",
      "Auditor": "var(--purple)",
      "Client": "var(--teal)",
    };
    return map[role] || "var(--text-muted)";
  }

  function riskBadgeType(risk = "") {
    const map = { CRITICAL: "red", HIGH: "red", MEDIUM: "yellow", LOW: "green" };
    return map[String(risk).toUpperCase()] || "gray";
  }

  function priorityBadgeType(priority = "") {
    const map = { CRITICAL: "red", HIGH: "orange", MEDIUM: "yellow", LOW: "gray" };
    return map[String(priority).toUpperCase()] || "gray";
  }

  function severityColor(sev = "") {
    const map = { critical: "red", high: "orange", medium: "yellow", low: "gray" };
    return map[String(sev).toLowerCase()] || "gray";
  }

  function formatDate(d, opts = {}) {
    if (!d) return "—";
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", ...opts });
  }

  function timeAgo(d) {
    if (!d) return "—";
    const date = new Date(d);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const steps = [
      [60, "just now"],
      [3600, "m ago", 60],
      [86400, "h ago", 3600],
      [2592000, "d ago", 86400],
      [31536000, "mo ago", 2592000],
    ];
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds/86400)}d ago`;
    if (seconds < 31536000) return `${Math.floor(seconds/2592000)}mo ago`;
    return `${Math.floor(seconds/31536000)}y ago`;
  }

  function currency(n) {
    if (n === null || n === undefined) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function pct(n, digits = 0) {
    if (n === null || n === undefined) return "—";
    return `${Number(n).toFixed(digits)}%`;
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Animate a number counting up (for stat cards)
  function countUp(el, target, duration = 900, formatter = (v) => Math.round(v)) {
    const start = 0;
    const startTime = performance.now();
    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatter(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = formatter(target);
    }
    requestAnimationFrame(step);
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  return {
    initials, colorFromString, roleColor, roleColorHex, riskBadgeType, priorityBadgeType, severityColor,
    formatDate, timeAgo, currency, pct, debounce, qs, qsa, escapeHtml, countUp, uid
  };
})();
