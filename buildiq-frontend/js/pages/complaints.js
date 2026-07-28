/* ============================================================
   BuildIQ — complaints.js  (#6: role-scoped complaint handling)

   - Super Admin & General Manager: see & resolve ALL complaints, with
     an AI-suggested solution they can send as the resolution.
   - Department Manager: see & resolve only complaints routed to their
     own department.
   - Engineer & Client: "submit only" — they see just their own
     submitted complaints and their status, no resolve controls.
   - Auditor: no access (enforced by router.js).
   ============================================================ */

const ComplaintsPage = (() => {
  let allComplaints = [];
  let visible = [];
  let user;

  function shell() {
    const submitOnly = Roles.isSubmitOnly(user.role);
    return `
      <div class="page-header">
        <div><h1>Complaints</h1><div class="page-sub">${
          Roles.canResolveAllComplaints(user.role) ? "AI-classified, routed, and tracked to resolution — organization-wide" :
          Roles.canResolveDeptComplaints(user.role) ? `Scoped to ${user.department} — read & resolve` :
          "Submit a complaint and track its status"
        }</div></div>
        <div class="page-header-actions"><button class="btn btn-primary" id="submitComplaintBtn"><i class="fa-solid fa-plus"></i> Submit Complaint</button></div>
      </div>
      <div class="complaints-stats" id="complaintsStats"></div>
      <div class="complaints-layout">
        <div>
          <div class="members-toolbar">
            <select class="input filter-select" id="statusFilter"><option value="">All Status</option><option value="pending">Open</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option></select>
            <select class="input filter-select" id="sevFilter"><option value="">All Severity</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select>
          </div>
          <div id="complaintsContainer"></div>
        </div>
        <div class="card trend-panel" id="trendPanel"></div>
      </div>`;
  }

  async function init() {
    user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("complaintsContainer").innerHTML = Components.skeletonGrid(4);

    allComplaints = await API.getComplaints();
    visible = Roles.visibleComplaints(user, allComplaints);
    renderStats();
    render(visible);
    renderTrendPanel();

    document.getElementById("submitComplaintBtn").addEventListener("click", openSubmitModal);
    document.getElementById("statusFilter").addEventListener("change", applyFilters);
    document.getElementById("sevFilter").addEventListener("change", applyFilters);
  }

  function renderStats() {
    const open = visible.filter(c => c.status === "pending").length;
    const inProgress = visible.filter(c => c.status === "in_progress").length;
    const resolved = visible.filter(c => c.status === "resolved").length;
    const critical = visible.filter(c => c.severity === "critical").length;
    document.getElementById("complaintsStats").innerHTML = [
      Components.createStatCard("Open", open, null, "yellow", "fa-envelope-open"),
      Components.createStatCard("In Progress", inProgress, null, "blue", "fa-spinner"),
      Components.createStatCard("Resolved", resolved, null, "green", "fa-circle-check"),
      Components.createStatCard("Critical", critical, null, "red", "fa-triangle-exclamation"),
      Components.createStatCard("Avg. Resolution", "2.4d", null, "accent", "fa-clock"),
    ].join("");
  }

  function applyFilters() {
    const status = document.getElementById("statusFilter").value;
    const sev = document.getElementById("sevFilter").value;
    render(visible.filter(c => (!status || c.status === status) && (!sev || c.severity === sev)));
  }

  function render(list) {
    const container = document.getElementById("complaintsContainer");
    if (!list.length) { container.innerHTML = Components.createEmptyState("fa-comments", "No complaints found"); return; }
    container.innerHTML = `<div class="complaints-grid">${list.map(c => complaintCardWithRole(c)).join("")}</div>`;
    Utils.qsa(".view-complaint-btn").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.id)));
    Utils.qsa(".resolve-complaint-btn").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.id, true)));
    EntityDetail.bindAuto(container);
  }

  // Wraps the shared component card but swaps the footer action based on role
  function complaintCardWithRole(c) {
    const canResolve = Roles.canResolveComplaint(user, c);
    const html = Components.createComplaintCard(c);
    if (canResolve || c.status === "resolved") return html;
    // Submit-only roles: replace Resolve button with a status badge, keep Details
    return html.replace(/<button class="btn btn-primary btn-sm btn-block resolve-complaint-btn"[^>]*>Resolve<\/button>/,
      `${Components.createBadge(c.status === "in_progress" ? "In Progress" : "Awaiting Review", c.status === "in_progress" ? "blue" : "yellow")}`);
  }

  function renderTrendPanel() {
    const catCounts = {};
    visible.forEach(c => catCounts[c.category] = (catCounts[c.category]||0)+1);
    const top = Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).slice(0,4);
    document.getElementById("trendPanel").innerHTML = `
      <div class="section-title"><i class="fa-solid fa-chart-line"></i> Complaints Trend</div>
      <canvas id="trendCanvas" height="140"></canvas>
      <div class="section-title" style="margin-top:18px;"><i class="fa-solid fa-ranking-star"></i> Top Categories</div>
      ${top.length ? top.map(([cat,count]) => `<div class="flex items-center justify-between" style="padding:6px 0; font-size:13px;"><span>${cat}</span><b>${count}</b></div>`).join("") : `<div style="font-size:12.5px; color:var(--text-muted);">No data yet.</div>`}
      <div class="card" style="background:rgba(var(--accent-rgb),0.08); border-left:3px solid var(--accent); margin-top:14px;">
        <div style="font-size:12.5px; color:var(--accent); font-weight:700; margin-bottom:4px;"><i class="fa-solid fa-robot"></i> AI Pattern Detected</div>
        <p style="font-size:12.5px; color:var(--text-secondary);">${top[0] ? `${top[0][0]} complaints are the most frequent category in your current view.` : "Not enough data to detect a pattern yet."}</p>
      </div>`;
    setTimeout(() => {
      Chart.defaults.color = "#94A3B8"; Chart.defaults.font.family = "Inter";
      new Chart(document.getElementById("trendCanvas"), {
        type: "line",
        data: { labels: ["W1","W2","W3","W4"], datasets: [{ data: [4,7,5,9].map(v=>Math.max(0,Math.round(v*(visible.length/26||1)))), borderColor: "#F97316", backgroundColor: "rgba(249,115,22,0.12)", fill: true, tension: 0.4 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }, 30);
  }

  function openDetail(id, focusResolve = false) {
    const c = allComplaints.find(x => x.id === id);
    if (!c) return;
    const canResolve = Roles.canResolveComplaint(user, c);
    Components.createModal({
      title: `Complaint ${c.id}`,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:12px; flex-wrap:wrap;">${Components.createBadge(c.category,"blue")}${Components.createBadge(c.severity, Utils.severityColor(c.severity))}${Components.createBadge(c.status,"gray")}${Components.createBadge(c.department,"gray")}</div>
        <p style="font-size:13.5px; color:var(--text-secondary); margin-bottom:16px;">${Utils.escapeHtml(c.text)}</p>
        <div class="card" style="background:var(--bg-input); border-left:3px solid var(--accent); margin-bottom:16px;">
          <div style="font-weight:700; font-size:12.5px; color:var(--accent); margin-bottom:6px;"><i class="fa-solid fa-robot"></i> AI Analysis</div>
          <div style="font-size:13px; color:var(--text-secondary);">Classification confidence: <b>${c.confidence}%</b><br>Sentiment: <b>${c.sentiment}</b><br>${Utils.escapeHtml(c.ai_summary)}</div>
        </div>
        ${c.status === "resolved" && c.resolution_note ? `
        <div class="card" style="background:rgba(var(--green-rgb),0.08); border-left:3px solid var(--green); margin-bottom:16px;">
          <div style="font-weight:700; font-size:12.5px; color:var(--green); margin-bottom:6px;"><i class="fa-solid fa-circle-check"></i> Resolution</div>
          <div style="font-size:13px; color:var(--text-secondary);">${Utils.escapeHtml(c.resolution_note)}</div>
        </div>` : ""}
        ${canResolve && c.status !== "resolved" ? `
        <div class="field">
          <label>Resolution / Solution</label>
          <textarea class="input" id="resolutionText" rows="4" placeholder="Describe how this was resolved..."></textarea>
        </div>
        <button class="btn btn-secondary btn-sm btn-block" id="aiSuggestBtn" style="margin-bottom:14px;"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest Solution with AI</button>
        ` : ""}
        ${Roles.isSubmitOnly(user.role) ? `
        <div class="field"><label>Was the AI classification correct?</label>
          <div class="flex gap-8"><button class="btn btn-secondary btn-sm" id="fbYes"><i class="fa-solid fa-thumbs-up"></i> Yes</button><button class="btn btn-secondary btn-sm" id="fbNo"><i class="fa-solid fa-thumbs-down"></i> No</button></div>
        </div>` : ""}`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
        ${canResolve && c.status !== "resolved" ? `<button class="btn btn-primary" id="markResolvedBtn"><i class="fa-solid fa-check"></i> Mark Resolved</button>` : ""}`,
    });
    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#fbYes")?.addEventListener("click", async () => { await API.complaintFeedback({ id: c.id, correct: true }); Components.createToast("Thanks for the feedback!", "success"); });
    overlay.querySelector("#fbNo")?.addEventListener("click", async () => { await API.complaintFeedback({ id: c.id, correct: false }); Components.createToast("Feedback recorded — this helps retrain the model.", "info"); });

    overlay.querySelector("#aiSuggestBtn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Thinking...`;
      const { solution } = await API.suggestComplaintSolution(c);
      overlay.querySelector("#resolutionText").value = solution;
      btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Suggest Solution with AI`;
      Components.createToast("AI solution suggested — edit as needed.", "success");
    });

    overlay.querySelector("#markResolvedBtn")?.addEventListener("click", async () => {
      const note = overlay.querySelector("#resolutionText")?.value.trim();
      if (!note) { Components.createToast("Please add a resolution note (or use AI Suggest Solution).", "error"); return; }
      await API.resolveComplaint(c.id, note);
      c.status = "resolved";
      c.resolution_note = note;
      Components.createToast(`${c.id} marked as resolved.`, "success");
      overlay.remove();
      renderStats(); applyFilters();
    });
  }

  function openSubmitModal() {
    Components.createModal({
      title: "Submit a Complaint",
      bodyHtml: `
        <div class="field"><label>Related Project</label><select class="input" id="cProject">${Roles.visibleProjects(user, MockData.projects).map(p=>`<option value="${p.id}">${p.title}</option>`).join("") || MockData.projects.map(p=>`<option value="${p.id}">${p.title}</option>`).join("")}</select></div>
        <div class="field"><label>Initial Severity</label><select class="input" id="cSeverity"><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div>
        <div class="field"><label>Complaint Details</label><textarea class="input" id="cText" rows="4" placeholder="Describe the issue in detail..."></textarea></div>
        <div class="field"><label>Attachment (optional)</label><input class="input" type="file" id="cFile"></div>
        <p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-info"></i> AI will auto-classify and route this complaint to the right department.</p>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="submitBtn"><i class="fa-solid fa-paper-plane"></i> Submit</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#submitBtn").addEventListener("click", async () => {
      const text = overlay.querySelector("#cText").value.trim();
      if (!text) { Components.createToast("Please describe the issue.", "error"); return; }
      const btn = overlay.querySelector("#submitBtn");
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Classifying...`;
      const projectId = overlay.querySelector("#cProject").value;
      const project = MockData.projects.find(p => p.id === projectId);
      await API.createComplaint({ text, submitted_by: user.id });
      Components.createToast("Complaint submitted and routed by AI.", "success");
      overlay.remove();
      const newComplaint = { id: "CMP-" + Math.floor(Math.random()*9000+1000), submitted_by: user.id, submitted_by_type: user.role === "Client" ? "client" : "member",
        customer_name: user.name, category: "Technical Issue", severity: overlay.querySelector("#cSeverity").value,
        status: "pending", department: project?.department || "Engineering & Design", project: project?.title || "N/A", text, sentiment: "Neutral",
        ai_summary: "Newly submitted complaint pending AI triage review.", confidence: 82, created_at: new Date().toISOString(), assignee: "Unassigned", resolution_note: "" };
      allComplaints.unshift(newComplaint);
      visible = Roles.visibleComplaints(user, allComplaints);
      renderStats(); applyFilters();
    });
  }

  return { init };
})();
