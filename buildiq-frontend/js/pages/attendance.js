/* ============================================================
   BuildIQ — attendance.js  (#1 & #2)
   Workforce & Attendance: daily attendance supervision for both
   permanent organization staff and daily (casual) workers, plus an
   AI absence-ranking view that flags who is missing work most often.

   Access (see roles.js):
   - Super Admin / General Manager: full org-wide attendance, can take
     attendance for anyone.
   - Department Manager of "Workforce & Attendance": can take attendance
     for the whole organization (that's their department's job).
   - Other Department Managers: read-only view scoped to their own dept.
   - Auditor: read-only, org-wide (compliance visibility).
   - Engineer / Client: no access (enforced by router.js).
   ============================================================ */

const AttendancePage = (() => {
  let user;
  let scopedAttendance = [];
  let scopedStaff = [];
  let scopedWorkers = [];
  let activeTab = "take";
  let selectedDate = new Date().toISOString().slice(0, 10);
  const pendingMarks = {}; // person_id -> status, for the "take attendance" draft

  function subtitle() {
    if (Roles.canTakeAttendance(user)) return "Workforce & Attendance — you are responsible for taking the daily register";
    if (Roles.ORG_WIDE.includes(user.role)) return "Organization-wide attendance oversight (read-only register)";
    if (user.role === "Auditor") return "Read-only attendance and absence-reason review";
    if (user.role === "Department Manager") return `Attendance oversight — ${user.department}`;
    return "Your attendance record";
  }

  function shell() {
    const canTake = Roles.canTakeAttendance(user);
    const canOversee = Roles.canViewAttendance(user);
    const canSeeReasons = Roles.canViewAbsenceReasons(user);
    // Every role gets "My Attendance"; oversight tabs are added on top.
    const tabs = [];
    if (canTake) tabs.push({ key: "take", label: "Take Attendance" });
    tabs.push({ key: "mine", label: "My Attendance" });
    if (canSeeReasons) tabs.push({ key: "reasons", label: "Absence Reasons" });
    if (canOversee) {
      tabs.push({ key: "ranking", label: "AI Absence Ranking" });
      tabs.push({ key: "history", label: "History" });
      tabs.push({ key: "workers", label: "Daily Workers" });
    }
    activeTab = tabs[0].key;

    return `
      <div class="page-header">
        <div><h1>Attendance</h1><div class="page-sub">${Utils.escapeHtml(subtitle())}</div></div>
      </div>
      ${!canTake && canOversee ? `
        <div class="attendance-notice">
          <i class="fa-solid fa-circle-info"></i>
          <span>Attendance is taken exclusively by the <b>Workforce &amp; Attendance</b> department. You have full visibility here, but cannot mark the register.</span>
        </div>` : ""}
      <div class="attendance-stats" id="attStats"></div>
      <div class="tabs" id="attTabs">
        ${tabs.map((t, i) => `<div class="tab ${i === 0 ? "active" : ""}" data-tab="${t.key}">${t.label}</div>`).join("")}
      </div>
      <div id="attTabContent" style="margin-top:18px;"></div>`;
  }

  async function init() {
    // Load real server data before rendering.
    await DataStore.load(["attendance","members","dailyWorkers","departments","absenceReasons"]);
    user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("attTabContent").innerHTML = Components.skeletonGrid(4, "row");

    scopedAttendance = Roles.visibleAttendance(user, DataStore.attendance);
    scopedWorkers = Roles.visibleDailyWorkers(user, DataStore.dailyWorkers);
    // The Workforce & Attendance department registers EVERY internal member of
    // the organization, not just Engineers and Department Managers. Clients are
    // external and are never on the register.
    scopedStaff = Roles.canTakeAttendance(user)
      ? DataStore.members.filter(m => Roles.isRegisterable(m))
      : DataStore.members.filter(m => Roles.isRegisterable(m) && m.department === user.department);

    renderStats();
    renderTab(activeTab);

    Utils.qsa(".tab", document.getElementById("attTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("attTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      renderTab(activeTab);
    }));
  }

  function renderStats() {
    // Roles without register access see their own attendance summary instead.
    if (!Roles.canViewAttendance(user)) {
      const mine = Roles.ownAttendance(user, DataStore.attendance);
      const absences = mine.filter(a => a.status === "Absent");
      const unexplained = absences.filter(a => !a.reason).length;
      const pending = absences.filter(a => a.reason_status === "Pending").length;
      const accepted = absences.filter(a => a.reason_status === "Accepted").length;
      const rate = mine.length ? Math.round((mine.filter(a => a.status === "Present").length / mine.length) * 100) : 100;
      document.getElementById("attStats").innerHTML = [
        Components.createStatCard("Days Recorded", mine.length, null, "blue", "fa-calendar-days"),
        Components.createStatCard("My Absences", absences.length, null, "red", "fa-user-slash"),
        Components.createStatCard("Needs a Reason", unexplained, null, "yellow", "fa-circle-question"),
        Components.createStatCard("Awaiting Review", pending, null, "purple", "fa-hourglass-half"),
        Components.createStatCard("Excused", accepted, null, "green", "fa-circle-check"),
        Components.createStatCard("Attendance Rate", `${rate}%`, null, "accent", "fa-chart-line"),
      ].join("");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayRecords = scopedAttendance.filter(a => a.date === today);
    const presentToday = todayRecords.filter(a => a.status === "Present").length;
    const absentToday = todayRecords.filter(a => a.status === "Absent").length;
    const totalPeople = scopedStaff.length + scopedWorkers.length;
    const notMarkedToday = Math.max(0, totalPeople - todayRecords.length);
    const ranked = AIEngine.rankAbsences(scopedAttendance);
    const flagged = ranked.filter(r => r.ai_risk === "CRITICAL" || r.ai_risk === "HIGH").length;
    document.getElementById("attStats").innerHTML = [
      Components.createStatCard("Tracked People", totalPeople, null, "accent", "fa-users"),
      Components.createStatCard("Present Today", presentToday, null, "green", "fa-circle-check"),
      Components.createStatCard("Absent Today", absentToday, null, "red", "fa-user-slash"),
      Components.createStatCard("Not Marked Today", notMarkedToday, null, "yellow", "fa-clock"),
      Components.createStatCard("AI-Flagged (30d)", flagged, null, "purple", "fa-triangle-exclamation"),
    ].join("");
  }

  function renderTab(tab) {
    const el = document.getElementById("attTabContent");
    // Defence in depth: never render the register editor for a role that
    // isn't in the Workforce & Attendance department.
    if (tab === "take") {
      if (!Roles.canTakeAttendance(user)) {
        el.innerHTML = Components.createEmptyState("fa-lock", "Workforce & Attendance only",
          "Only members of the Workforce & Attendance department can take the daily register.");
        return;
      }
      renderTakeAttendance(el);
    }
    else if (tab === "mine") renderMyAttendance(el);
    else if (tab === "reasons") renderReasonsQueue(el);
    else if (tab === "ranking") renderRanking(el);
    else if (tab === "history") renderHistory(el);
    else renderWorkers(el);
  }

  // ---------------- My Attendance (every role) ----------------
  // Shows the signed-in user their own days and lets them explain absences.
  function reasonStatusBadge(rec) {
    if (!rec.reason) return Components.createBadge("Reason needed", "yellow");
    const map = { Pending: "blue", Accepted: "green", Rejected: "red" };
    return Components.createBadge(rec.reason_status, map[rec.reason_status] || "gray");
  }

  function renderMyAttendance(el) {
    const mine = Roles.ownAttendance(user, DataStore.attendance).sort((a, b) => b.date.localeCompare(a.date));
    if (!mine.length) {
      el.innerHTML = Components.createEmptyState("fa-calendar-xmark", "No attendance recorded yet",
        "Once the Workforce & Attendance department records your days, they'll appear here.");
      return;
    }
    const absences = mine.filter(a => a.status === "Absent");
    const needsReason = absences.filter(a => !a.reason || a.reason_status === "Rejected");

    el.innerHTML = `
      ${needsReason.length ? `
        <div class="attendance-notice warn">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>You have <b>${needsReason.length}</b> absence${needsReason.length > 1 ? "s" : ""} that still need${needsReason.length > 1 ? "" : "s"} an explanation.</span>
        </div>` : ""}
      <div class="my-attendance-list">
        ${mine.slice(0, 60).map(rec => {
          const isAbsent = rec.status === "Absent";
          const locked = rec.reason_status === "Accepted";
          return `
          <div class="my-att-row ${isAbsent ? "absent" : ""}">
            <div class="my-att-date">
              <b>${new Date(rec.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>
              <span>${new Date(rec.date).toLocaleDateString(undefined, { weekday: "short" })}</span>
            </div>
            <div class="my-att-main">
              <div class="flex items-center gap-8" style="flex-wrap:wrap;">
                ${Components.createBadge(rec.status, isAbsent ? "red" : "green")}
                ${isAbsent ? reasonStatusBadge(rec) : `<span style="font-size:12px;color:var(--text-muted);">Checked in ${rec.check_in || "—"}</span>`}
              </div>
              ${rec.reason ? `
                <div class="my-att-reason">
                  <span class="reason-cat">${Utils.escapeHtml(rec.reason_category || "Other")}</span>
                  <span>${Utils.escapeHtml(rec.reason)}</span>
                </div>
                ${rec.reason_review_note ? `<div class="my-att-review"><i class="fa-solid fa-gavel"></i> ${Utils.escapeHtml(rec.reason_review_note)}${rec.reason_reviewed_by ? ` — ${Utils.escapeHtml(rec.reason_reviewed_by)}` : ""}</div>` : ""}
              ` : ""}
            </div>
            <div class="my-att-actions">
              ${isAbsent && !locked
                ? `<button class="btn ${rec.reason ? "btn-secondary" : "btn-primary"} btn-sm add-reason-btn" data-date="${rec.date}">
                     <i class="fa-solid fa-pen"></i> ${rec.reason ? "Edit reason" : "Add reason"}
                   </button>`
                : isAbsent ? `<span class="locked-note"><i class="fa-solid fa-lock"></i> Excused</span>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>`;

    Utils.qsa(".add-reason-btn", el).forEach(btn =>
      btn.addEventListener("click", () => openReasonModal(btn.dataset.date, el)));
  }

  function openReasonModal(date, el) {
    const rec = DataStore.attendance.find(a => a.person_id === user.id && a.date === date);
    if (!rec) return;
    const cats = ReferenceData.ABSENCE_REASON_CATEGORIES;

    Components.createModal({
      title: `Explain your absence — ${new Date(date).toDateString()}`,
      bodyHtml: `
        ${rec.reason_status === "Rejected" ? `
          <div class="attendance-notice warn" style="margin-bottom:14px;">
            <i class="fa-solid fa-circle-xmark"></i>
            <span>Your previous reason was rejected${rec.reason_review_note ? `: ${Utils.escapeHtml(rec.reason_review_note)}` : "."} You can submit a revised explanation.</span>
          </div>` : ""}
        <div class="field"><label for="reasonCat">Category</label>
          ${Components.createTypedInput({ id: "reasonCat", value: rec.reason_category || "Sick Leave", placeholder: "Type a category...", options: cats })}
        </div>
        <div class="field"><label for="reasonText">Explanation</label>
          <textarea class="input" id="reasonText" rows="4" placeholder="Briefly explain why you were absent...">${Utils.escapeHtml(rec.reason || "")}</textarea>
        </div>
        <p style="font-size:12px;color:var(--text-muted);"><i class="fa-solid fa-circle-info"></i> Your department manager, the general manager, an auditor or an admin will review this.</p>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" id="saveReasonBtn"><i class="fa-solid fa-paper-plane"></i> Submit</button>`,
    });

    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#saveReasonBtn").addEventListener("click", async () => {
      const reason = overlay.querySelector("#reasonText").value.trim();
      if (!reason) { Components.createToast("Please describe why you were absent.", "error"); return; }
      const btn = overlay.querySelector("#saveReasonBtn");
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting...`;
      try {
        await API.submitAbsenceReason(date, { reason, reason_category: overlay.querySelector("#reasonCat").value });
        overlay.remove();
        Components.createToast("Reason submitted for review.", "success");
        renderStats();
        renderMyAttendance(el);
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Submit`;
        Components.createToast(err.message || "Could not submit that reason.", "error");
      }
    });
  }

  // ---------------- Absence Reasons queue (managers / GM / auditor / admin) ----------------
  function renderReasonsQueue(el) {
    const all = Roles.visibleAbsenceReasons(user, DataStore.attendance)
      .sort((a, b) => (b.reason_submitted_at || "").localeCompare(a.reason_submitted_at || ""));
    const readOnly = user.role === "Auditor";

    el.innerHTML = `
      <div class="attendance-toolbar">
        <select class="input filter-select" id="reasonStatusFilter">
          <option value="">All statuses</option><option>Pending</option><option>Accepted</option><option>Rejected</option>
        </select>
        <select class="input filter-select" id="reasonCatFilter">
          <option value="">All categories</option>${ReferenceData.ABSENCE_REASON_CATEGORIES.map(c => `<option>${c}</option>`).join("")}
        </select>
        ${readOnly ? `<span class="readonly-pill"><i class="fa-solid fa-eye"></i> Read-only</span>` : ""}
      </div>
      <div id="reasonsList"></div>`;

    function draw() {
      const st = document.getElementById("reasonStatusFilter").value;
      const cat = document.getElementById("reasonCatFilter").value;
      const rows = all.filter(r => (!st || r.reason_status === st) && (!cat || r.reason_category === cat));
      const list = document.getElementById("reasonsList");

      if (!rows.length) {
        list.innerHTML = Components.createEmptyState("fa-inbox", "No absence reasons match", "Submitted explanations will appear here for review.");
        return;
      }
      list.innerHTML = `<div class="reasons-list">${rows.map(r => {
        const canReview = !readOnly && Roles.canReviewAbsenceReason(user, r) && r.reason_status === "Pending";
        return `
        <div class="reason-card ${r.reason_status === "Pending" ? "is-pending" : ""}">
          <div class="reason-card-head">
            <div class="flex items-center gap-10">
              ${Components.createAvatar(r.person_name, "sm")}
              <div>
                <div class="flex items-center gap-8" style="flex-wrap:wrap;">
                  <b class="clickable-entity" data-entity="${r.person_type === "daily_worker" ? "daily_worker" : "member"}" data-id="${r.person_id}" style="cursor:pointer;font-size:13.5px;">${Utils.escapeHtml(r.person_name)}</b>
                  ${Components.createBadge(r.person_type === "daily_worker" ? "Daily Worker" : "Staff", "gray")}
                </div>
                <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">
                  ${Utils.escapeHtml(r.department || "—")} · absent ${new Date(r.date).toDateString()}
                </div>
              </div>
            </div>
            ${reasonStatusBadge(r)}
          </div>
          <div class="reason-card-body">
            <span class="reason-cat">${Utils.escapeHtml(r.reason_category || "Other")}</span>
            <p>${Utils.escapeHtml(r.reason)}</p>
            <div class="reason-meta">Submitted ${Utils.timeAgo(r.reason_submitted_at)}</div>
          </div>
          ${r.reason_review_note ? `<div class="reason-review"><i class="fa-solid fa-gavel"></i> ${Utils.escapeHtml(r.reason_review_note)}${r.reason_reviewed_by ? ` — ${Utils.escapeHtml(r.reason_reviewed_by)}, ${Utils.timeAgo(r.reason_reviewed_at)}` : ""}</div>` : ""}
          ${canReview ? `
            <div class="reason-card-actions">
              <button class="btn btn-primary btn-sm accept-reason-btn" data-person="${r.person_id}" data-date="${r.date}"><i class="fa-solid fa-check"></i> Accept</button>
              <button class="btn btn-outline btn-sm reject-reason-btn" data-person="${r.person_id}" data-date="${r.date}"><i class="fa-solid fa-xmark"></i> Reject</button>
            </div>` : ""}
        </div>`;
      }).join("")}</div>`;

      Utils.qsa(".accept-reason-btn", list).forEach(b =>
        b.addEventListener("click", () => decide(b.dataset.person, b.dataset.date, "Accepted", draw)));
      Utils.qsa(".reject-reason-btn", list).forEach(b =>
        b.addEventListener("click", () => decide(b.dataset.person, b.dataset.date, "Rejected", draw)));
      EntityDetail.bindAuto(list);
    }

    document.getElementById("reasonStatusFilter").addEventListener("change", draw);
    document.getElementById("reasonCatFilter").addEventListener("change", draw);
    draw();
  }

  function decide(personId, date, decision, redraw) {
    Components.createModal({
      title: `${decision === "Accepted" ? "Accept" : "Reject"} absence reason`,
      bodyHtml: `<div class="field"><label for="reviewNote">Note (optional)</label>
        <textarea class="input" id="reviewNote" rows="3" placeholder="${decision === "Accepted" ? "e.g. Documentation provided, absence excused." : "e.g. Insufficient notice given."}"></textarea></div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn ${decision === "Accepted" ? "btn-primary" : "btn-danger"}" id="confirmReviewBtn">${decision === "Accepted" ? "Accept" : "Reject"}</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#confirmReviewBtn").addEventListener("click", async () => {
      try {
        await API.reviewAbsenceReason(personId, date, { decision, note: overlay.querySelector("#reviewNote").value.trim() });
        overlay.remove();
        Components.createToast(`Reason ${decision.toLowerCase()}.`, decision === "Accepted" ? "success" : "info");
        redraw();
        if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      } catch (err) {
        Components.createToast(err.message || "Could not record that decision.", "error");
      }
    });
  }

  // ---------------- Take Attendance ----------------
  function renderTakeAttendance(el) {
    const people = [
      ...scopedStaff.map(m => ({ id: m.id, name: m.full_name, sub: `${m.job_title} · Staff`, avatar_color: m.avatar_color, type: "staff" })),
      ...scopedWorkers.map(w => ({ id: w.id, name: w.full_name, sub: `${w.trade} · Daily Worker`, avatar_color: w.avatar_color, type: "daily_worker" })),
    ];
    el.innerHTML = `
      <div class="attendance-toolbar">
        <div class="field" style="margin-bottom:0;"><label>Date</label><input class="input" type="date" id="attDate" value="${selectedDate}" max="${new Date().toISOString().slice(0,10)}"></div>
        <button class="btn btn-secondary btn-sm" id="markAllPresentBtn" style="align-self:flex-end;"><i class="fa-solid fa-check-double"></i> Mark All Present</button>
        <button class="btn btn-secondary btn-sm" id="markAllAbsentBtn" style="align-self:flex-end;"><i class="fa-solid fa-user-slash"></i> Mark All Absent</button>
        <button class="btn btn-secondary btn-sm" id="exportAttendanceBtn" style="align-self:flex-end; margin-left:auto;"><i class="fa-solid fa-file-csv"></i> Download CSV</button>
        <button class="btn btn-primary" id="saveAttendanceBtn" style="align-self:flex-end;"><i class="fa-solid fa-floppy-disk"></i> Save Attendance</button>
      </div>
      <div id="attendanceRows">${people.map(p => attendanceRowHtml(p)).join("")}</div>`;

    document.getElementById("attDate").addEventListener("change", (e) => { selectedDate = e.target.value; loadExistingMarksForDate(); renderTakeAttendance(el); });
    document.getElementById("markAllPresentBtn").addEventListener("click", () => {
      people.forEach(p => pendingMarks[p.id] = "Present");
      renderTakeAttendance(el);
    });
    document.getElementById("markAllAbsentBtn").addEventListener("click", () => {
      people.forEach(p => pendingMarks[p.id] = "Absent");
      renderTakeAttendance(el);
    });
    document.getElementById("saveAttendanceBtn").addEventListener("click", () => saveAttendance(people));
    document.getElementById("exportAttendanceBtn").addEventListener("click", () => downloadRegister(selectedDate));

    Utils.qsa(".attendance-status-toggle button", el).forEach(btn => btn.addEventListener("click", () => {
      pendingMarks[btn.dataset.person] = btn.dataset.status;
      renderTakeAttendance(el);
    }));
    loadExistingMarksForDate();
  }

  function attendanceRowHtml(p) {
    const existing = DataStore.attendance.find(a => a.person_id === p.id && a.date === selectedDate);
    const current = pendingMarks[p.id] || existing?.status || null;
    return `
      <div class="take-attendance-row">
        <div class="flex items-center gap-12">
          ${Components.createAvatar(p.name, "sm", p.avatar_color)}
          <div><div style="font-weight:600; font-size:13.5px;">${Utils.escapeHtml(p.name)}</div><div style="font-size:11.5px; color:var(--text-muted);">${Utils.escapeHtml(p.sub)}</div></div>
        </div>
        <div class="attendance-status-toggle">
          <button data-person="${p.id}" data-status="Present" class="${current === "Present" ? "active" : ""}"><i class="fa-solid fa-check"></i> Present</button>
          <button data-person="${p.id}" data-status="Absent" class="${current === "Absent" ? "active" : ""}"><i class="fa-solid fa-xmark"></i> Absent</button>
        </div>
      </div>`;
  }

  function loadExistingMarksForDate() {
    // Pre-fill pendingMarks with whatever's already recorded for the selected date so re-opening the page doesn't lose data
    DataStore.attendance.filter(a => a.date === selectedDate).forEach(a => { if (!(a.person_id in pendingMarks)) pendingMarks[a.person_id] = a.status; });
  }

  /**
   * Download the register for a day as a CSV file.
   *
   * The server scopes rows to what this user may already see, so the file can
   * never contain records they could not read on screen.
   */
  async function downloadRegister(date) {
    const btn = document.getElementById("exportAttendanceBtn");
    const original = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparing...`; }
    try {
      const blob = await API.exportAttendance({ date });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `buildiq-attendance-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick: revoking immediately can cancel the download
      // in some browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      Components.createToast(`Register for ${date} downloaded.`, "success");
      AppEvents.logAudit(user, "EXPORT_DATA", `attendance/export/${date}`);
    } catch (err) {
      Components.createToast(`Could not download the register: ${err.message}`, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  async function saveAttendance(people) {
    const marks = people
      .filter(p => pendingMarks[p.id])
      .map(p => ({ person_id: p.id, person_type: p.type, status: pendingMarks[p.id] }));
    if (!marks.length) { Components.createToast("Nothing to save — mark at least one person.", "info"); return; }

    let saved = 0;
    try {
      // Goes through the API so the Workforce-only rule is enforced centrally.
      ({ saved } = await API.saveAttendance(selectedDate, marks));
    } catch (err) {
      Components.createToast(err.message || "Could not save attendance.", "error");
      return;
    }
    scopedAttendance = Roles.visibleAttendance(user, DataStore.attendance);

    const absentees = people.filter(p => pendingMarks[p.id] === "Absent");
    AppEvents.logAudit(user, "UPDATE_RECORD", `attendance/${selectedDate}`);
    if (absentees.length) {
      AppEvents.notify({
        title: `${absentees.length} absence${absentees.length > 1 ? "s" : ""} recorded`,
        body: `${selectedDate}: ${absentees.slice(0, 3).map(p => p.name).join(", ")}${absentees.length > 3 ? ` +${absentees.length - 3} more` : ""}.`,
        icon: "fa-user-slash", type: "warning", link: "attendance.html",
        target: { roles: ["Super Admin", "General Manager"], departments: [Roles.WORKFORCE_DEPT] },
      });
    }

    Components.createToast(`Attendance saved for ${saved} people on ${selectedDate}.`, "success");
    renderStats();
    if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
  }

  // ---------------- AI Absence Ranking ----------------
  function renderRanking(el) {
    const ranked = AIEngine.rankAbsences(scopedAttendance);
    if (!ranked.length) { el.innerHTML = Components.createEmptyState("fa-chart-column", "No attendance data yet"); return; }
    el.innerHTML = `
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <p style="font-size:12.5px; color:var(--text-muted); max-width:560px;">Ranked by an AI absence-risk score combining 30-day absence rate, recent (7-day) absences, and late-arrival frequency.</p>
        <a href="reports.html" class="btn btn-secondary btn-sm"><i class="fa-solid fa-file-lines"></i> Generate Attendance Report</a>
      </div>
      <div class="ranking-list">${ranked.map((r, i) => `
        <div class="ranking-row">
          <div class="ranking-score-ring" style="background:conic-gradient(${r.ai_risk === "CRITICAL" ? "var(--red)" : r.ai_risk === "HIGH" ? "var(--accent)" : r.ai_risk === "MEDIUM" ? "var(--yellow)" : "var(--text-muted)"} ${Math.round(r.ai_score*3.6)}deg, var(--bg-input) 0);">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:10px;">${r.ai_score}</div>
          </div>
          <div>
            <div class="flex items-center gap-8">
              <span class="rank-badge">#${i+1}</span>
              <b class="clickable-entity" data-entity="${r.person_type === 'daily_worker' ? 'daily_worker' : 'member'}" data-id="${r.person_id}" style="cursor:pointer; font-size:13.5px;">${Utils.escapeHtml(r.person_name)}</b>
              ${Components.createBadge(r.person_type === "daily_worker" ? "Daily Worker" : "Staff", "gray")}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;"><i class="fa-solid fa-sparkles" style="color:var(--accent);"></i> ${Utils.escapeHtml(r.ai_reason)}</div>
          </div>
          <div style="text-align:center;"><div style="font-weight:700;">${r.absence_rate}%</div><div style="font-size:10.5px; color:var(--text-muted);">absence rate</div></div>
          ${Components.createBadge(r.ai_risk, Utils.priorityBadgeType(r.ai_risk))}
        </div>`).join("")}</div>`;
    EntityDetail.bindAuto(el);
  }

  // ---------------- History ----------------
  function renderHistory(el) {
    el.innerHTML = `
      <div class="attendance-toolbar">
        <select class="input filter-select" id="histStatus"><option value="">All Status</option><option>Present</option><option>Absent</option></select>
        <select class="input filter-select" id="histType"><option value="">All Types</option><option value="staff">Staff</option><option value="daily_worker">Daily Worker</option></select>
      </div>
      <div class="table-wrap"><table class="data-table" id="histTable">
        <thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Status</th><th>Check-in</th>${Roles.canViewAbsenceReasons(user) ? "<th>Reason</th>" : ""}</tr></thead>
        <tbody></tbody>
      </table></div>`;
    function renderRows() {
      const status = document.getElementById("histStatus").value;
      const type = document.getElementById("histType").value;
      const rows = scopedAttendance
        .filter(a => (!status || a.status === status) && (!type || a.person_type === type))
        .sort((a,b) => b.date.localeCompare(a.date))
        .slice(0, 100);
      document.querySelector("#histTable tbody").innerHTML = rows.length ? rows.map(a => `
        <tr>
          <td>${a.date}</td>
          <td><span class="clickable-entity" data-entity="${a.person_type === 'daily_worker' ? 'daily_worker' : 'member'}" data-id="${a.person_id}" style="cursor:pointer; font-weight:600;">${Utils.escapeHtml(a.person_name)}</span></td>
          <td>${Components.createBadge(a.person_type === "daily_worker" ? "Daily Worker" : "Staff", "gray")}</td>
          <td>${Components.createBadge(a.status, a.status === "Present" ? "green" : "red")}</td>
          <td class="mono">${a.check_in || "—"}</td>
          ${Roles.canViewAbsenceReasons(user) ? `<td>${
            a.status !== "Absent" ? "—"
              : a.reason
                ? `<span class="reason-inline" title="${Utils.escapeHtml(a.reason)}">${reasonStatusBadge(a)} <span>${Utils.escapeHtml(a.reason_category || "")}</span></span>`
                : Components.createBadge("Not submitted", "yellow")
          }</td>` : ""}
        </tr>`).join("") : `<tr><td colspan="${Roles.canViewAbsenceReasons(user) ? 6 : 5}" style="text-align:center; color:var(--text-muted); padding:20px;">No records match your filters.</td></tr>`;
      EntityDetail.bindAuto(document.getElementById("histTable"));
    }
    document.getElementById("histStatus").addEventListener("change", renderRows);
    document.getElementById("histType").addEventListener("change", renderRows);
    renderRows();
  }

  // ---------------- Daily Workers directory ----------------
  function renderWorkers(el) {
    if (!scopedWorkers.length) { el.innerHTML = Components.createEmptyState("fa-user-group", "No daily workers in scope"); return; }
    el.innerHTML = `<div class="members-grid">${scopedWorkers.map(w => `
      <div class="card card-hover clickable-entity" data-entity="daily_worker" data-id="${w.id}" style="cursor:pointer;">
        <div class="flex items-center gap-12" style="margin-bottom:12px;">
          ${Components.createAvatar(w.full_name, "lg", w.avatar_color)}
          <div><div style="font-weight:700; font-size:14.5px;">${Utils.escapeHtml(w.full_name)}</div><div style="font-size:12px; color:var(--text-muted);">${Utils.escapeHtml(w.trade)}</div></div>
        </div>
        <div class="flex items-center justify-between" style="font-size:12.5px; color:var(--text-secondary);">
          <span class="clickable-entity" data-entity="project" data-id="${w.project_id}">${Utils.escapeHtml(w.project_title)}</span>
          <b>${Utils.currency(w.daily_rate)}/day</b>
        </div>
      </div>`).join("")}</div>`;
    EntityDetail.bindAuto(el);
  }

  return { init };
})();
