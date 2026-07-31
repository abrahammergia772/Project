/* verify_live_connection.js
 *
 * End-to-end check of the two deployed Render services:
 *   frontend  https://cmsai.onrender.com
 *   backend   https://constructionai-q9er.onrender.com
 *
 * Fetches the frontend's OWN JavaScript over HTTP and drives it against the
 * live API, so this tests what a browser actually runs -- not a local copy.
 *
 *   node verify_live_connection.js
 */
const { JSDOM } = require("jsdom");

const FE = process.env.FE || "https://cmsai.onrender.com";
const BE = process.env.BE || "https://constructionai-q9er.onrender.com";

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];
const ok = (n, c, d) => { c ? pass++ : (fail++, failures.push(n + (d ? `  →  ${d}` : ""))); };
const soft = (n, c, d) => { if (!c) { warn++; warnings.push(n + (d ? `  →  ${d}` : "")); } else pass++; };

(async () => {
  console.log(`frontend: ${FE}\nbackend : ${BE}\n`);

  // ---------------------------------------------------------- 1. reachable
  console.log("[1] Both services are up");
  for (const p of ["", "index.html", "admin.html", "js/config.js"]) {
    const r = await fetch(`${FE}/${p}`).catch(() => null);
    ok(`frontend serves /${p || "(root)"}`, r && r.ok, r ? `HTTP ${r.status}` : "no response");
  }
  const health = await fetch(`${BE}/health`).then(r => r.json()).catch(() => null);
  ok("backend /health responds", !!health);
  ok("backend reports online", health?.status === "online", health?.status);
  ok("backend database reachable", health?.database === "connected", health?.database);

  // ------------------------------------------------------------- 2. config
  console.log("[2] Frontend is pointed at the backend");
  const cfgSrc = await fetch(`${FE}/js/config.js`).then(r => r.text());
  ok("config.js defines API_BASE (not only API_BASE_URL)", /API_BASE:/.test(cfgSrc));
  ok("MOCK_MODE is false (live data, not in-browser mocks)", /MOCK_MODE:\s*false/.test(cfgSrc));
  ok("config points at this backend", cfgSrc.includes(new URL(BE).hostname),
    "frontend would call a different API");

  // --------------------------------------------------------------- 3. CORS
  // The browser-critical part: without the right headers every call fails
  // with an opaque "Failed to fetch", even though curl works fine.
  console.log("[3] CORS allows the frontend origin");
  const pre = await fetch(`${BE}/auth/login`, {
    method: "OPTIONS",
    headers: {
      "Origin": FE,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const allowOrigin = pre.headers.get("access-control-allow-origin");
  ok("preflight succeeds", pre.ok, `HTTP ${pre.status}`);
  ok("allow-origin names the frontend exactly", allowOrigin === FE,
    allowOrigin || "(header absent — browsers will block every request)");
  ok("allow-origin is not a wildcard", allowOrigin !== "*",
    "a wildcard cannot be combined with credentials");
  ok("POST + content-type is permitted",
    /POST/i.test(pre.headers.get("access-control-allow-methods") || "") &&
    /content-type/i.test(pre.headers.get("access-control-allow-headers") || ""));

  // ------------------------------------------- 4. real frontend JS -> API
  console.log("[4] The frontend's own code talks to the API");
  const FILES = ["js/config.js", "js/utils.js", "js/mock-data.js", "js/roles.js",
    "js/ai-engine.js", "js/entity-detail.js", "js/components.js",
    "js/auth.js", "js/api.js"];
  const srcs = [];
  let allFetched = true;
  for (const f of FILES) {
    const r = await fetch(`${FE}/${f}`);
    const good = r.ok;
    ok(`fetched ${f}`, good, `HTTP ${r.status}` + (r.status === 404
      ? " — file not deployed yet (push and redeploy the frontend)" : ""));
    if (!good) { allFetched = false; continue; }
    srcs.push(await r.text());
  }
  if (!allFetched) {
    console.log("\nSTOPPING: the deployed frontend is missing files, so the");
    console.log("remaining checks would test a stale build. Push and redeploy.");
    console.log(`\nFAILED — ${fail} of ${pass + fail} checks:`);
    failures.forEach(x => console.log("  x " + x));
    process.exit(1);
  }
  const w = new JSDOM("<!doctype html><body>",
    { url: `${FE}/index.html`, runScripts: "dangerously" }).window;
  w.fetch = (i, init) => globalThis.fetch(i, init);
  w.Response = Response; w.Request = Request; w.Headers = Headers;
  w.eval(srcs.join("\n;\n") +
    "\n;globalThis.API=API;globalThis.Auth=Auth;globalThis.Roles=Roles;globalThis.BUILDIQ_CONFIG=BUILDIQ_CONFIG;");

  const cfg = w.eval("BUILDIQ_CONFIG");
  ok("resolved API_BASE is absolute", /^https?:\/\//.test(cfg.API_BASE || ""), String(cfg.API_BASE));
  ok("resolved API_BASE is never 'undefined'",
    !String(cfg.API_BASE).includes("undefined"),
    "the API_BASE_URL/API_BASE name mismatch is back");

  console.log("[5] Every seeded role can sign in");
  for (const [email, role] of [
    ["admin@buildiq.et", "Super Admin"], ["gm@buildiq.et", "General Manager"],
    ["auditor@buildiq.et", "Auditor"], ["pm@buildiq.et", "Project Manager"],
    ["engineer@buildiq.et", "Engineer"], ["client@buildiq.et", "Client"]]) {
    try {
      const r = await w.eval("API").login(email, "Demo1234!");
      ok(`${role} signs in`, r.user.role === role, `got ${r.user.role}`);
    } catch (e) { ok(`${role} signs in`, false, e.message); }
  }

  console.log("[6] Authenticated endpoints return data");
  const sess = await w.eval("API").login("admin@buildiq.et", "Demo1234!");
  w.eval("Auth").setSession(sess);
  for (const [label, call] of [["projects", "getProjects()"], ["members", "getMembers()"],
    ["tasks", "getTasks()"], ["complaints", "getComplaints()"],
    ["documents", "getDocuments()"], ["notifications", "getNotifications()"],
    ["audit logs", "getAuditLogs()"], ["departments", "getDepartments()"]]) {
    try {
      const d = await w.eval(`API.${call}`);
      ok(`GET ${label}`, Array.isArray(d), typeof d);
    } catch (e) { ok(`GET ${label}`, false, e.message); }
  }

  // Rejecting a bad password proves auth is real, not stubbed.
  console.log("[7] Auth is genuinely enforced");
  let rejected = false;
  try { await w.eval("API").login("admin@buildiq.et", "wrong-password"); }
  catch { rejected = true; }
  ok("a wrong password is rejected", rejected);

  // ------------------------------------------------- 8. production posture
  // Soft checks: real problems, but they don't break the connection itself.
  console.log("[8] Production readiness (warnings only)");
  soft("ENV=production", health?.env === "production",
    `env=${health?.env} — /docs is public and forgot-password returns a live reset token`);
  soft("database is persistent", health?.data_persistent === true,
    health?.database_backend
      ? `backend=${health.database_backend}`
      : "backend running older code: /health has no database_backend field");
  const docs = await fetch(`${BE}/docs`).then(r => r.status).catch(() => 0);
  soft("/docs is not public", docs !== 200, `HTTP ${docs}`);
  const fp = await fetch(`${BE}/auth/forgot-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@buildiq.et" }),
  }).then(r => r.json()).catch(() => ({}));
  soft("forgot-password does not leak a reset token", !("demo_token" in fp),
    "any known email can be taken over");

  // ------------------------------------------------------------- summary
  console.log(`\n${"=".repeat(58)}`);
  if (warnings.length) {
    console.log(`\n${warn} WARNING(S) — connection works, deployment not production-ready:`);
    warnings.forEach(x => console.log("  ! " + x));
  }
  if (failures.length) {
    console.log(`\nFAILED — ${fail} of ${pass + fail} checks:`);
    failures.forEach(x => console.log("  x " + x));
    process.exit(1);
  }
  console.log(`\nCONNECTED — all ${pass} checks green.`);
})();
