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
    if (canTake) tabs.push({ key: "take", label: "Record Attendance" });
    tabs.push({ key: "mine", label: "My Attendance" });
    // Shift Management and Import are register-writing tools, so they follow
    // the same rule as taking attendance: Workforce & Attendance only.
    if (canTake) {
      tabs.push({ key: "shifts", label: "Shift Management" });
      tabs.push({ key: "import", label: "Import from Excel" });
    }
    // Overtime is visible to anyone with oversight (managers approve it) and
    // to the workforce team (they log it). Everyone else sees their own.
    tabs.push({ key: "overtime", label: "Overtime" });
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
    // Prefer the server's roster count. DataStore.members comes from
    // /members, which is record-visibility scoped -- an Engineer sees only
    // themselves there -- so counting it locally showed the Workforce &
    // Attendance team "2 tracked people" while the grid listed 75.
    const totalPeople = roster?.people?.length ?? (scopedStaff.length + scopedWorkers.length);
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
    else if (tab === "shifts") renderShifts(el);
    else if (tab === "import") renderImport(el);
    else if (tab === "overtime") renderOvertime(el);
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

  // ---------------- Record Attendance (monthly grid) ----------------
  /* People down the side, days of the month across the top -- the shape of a
     paper register, and the one thing the old one-day list could not do:
     see a whole month at once and back-fill a day that was missed.

     Rendered from ONE request (GET /attendance/roster?month=YYYY-MM) that
     returns the roster and every mark for the month together. A grid of ~46
     people x 31 days is 1,426 cells; fetching per cell, or even per person,
     would be hundreds of round trips. */

  let gridMonth = new Date().toISOString().slice(0, 7);   // YYYY-MM
  let roster = null;                                       // last server payload
  const gridEdits = {};                                    // "personId|date" -> status

  const STATUS_CYCLE = [null, "Present", "Absent"];
  const STATUS_MARK = { Present: "P", Absent: "A" };

  function monthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined,
      { month: "long", year: "numeric" });
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function cellKey(personId, date) { return `${personId}|${date}`; }

  function statusFor(personId, date) {
    const edited = gridEdits[cellKey(personId, date)];
    if (edited !== undefined) return edited;
    return roster?.marks?.[personId]?.[date] || null;
  }

  function dayMeta(ym, day) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1, day);
    return {
      date: `${ym}-${String(day).padStart(2, "0")}`,
      dow: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3),
      // Sunday only: Ethiopian construction weeks are six days, so Saturday
      // is a normal working day and must not be greyed out.
      isRest: d.getDay() === 0,
      isFuture: d > new Date(),
    };
  }

  async function renderTakeAttendance(el) {
    el.innerHTML = Components.skeletonGrid(4, "row");
    try {
      roster = await API.getAttendanceRoster(gridMonth);
    } catch (err) {
      el.innerHTML = Components.createEmptyState("fa-triangle-exclamation",
        "Could not load the register", err.message);
      return;
    }
    paintGrid(el);
    // The roster is the authoritative headcount; refresh the cards now that
    // it has landed.
    renderStats();
  }

  function paintGrid(el) {
    const days = Array.from({ length: roster.days }, (_, i) => dayMeta(gridMonth, i + 1));
    const people = roster.people;
    const today = new Date().toISOString().slice(0, 10);
    const pending = Object.keys(gridEdits).length;

    el.innerHTML = `
      <div class="attendance-toolbar">
        <div class="month-nav">
          <button class="icon-btn" id="gridPrev" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
          <b id="gridMonthLabel">${Utils.escapeHtml(monthLabel(gridMonth))}</b>
          <button class="icon-btn" id="gridNext" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <input class="input" id="gridSearch" type="search" placeholder="Search name, ID or department..." style="max-width:280px;">
        <button class="btn btn-secondary btn-sm" id="gridTodayPresent"><i class="fa-solid fa-check-double"></i> All present today</button>
        <button class="btn btn-secondary btn-sm" id="exportAttendanceBtn"><i class="fa-solid fa-file-csv"></i> Download CSV</button>
        <button class="btn btn-primary" id="saveAttendanceBtn" ${pending ? "" : "disabled"}>
          <i class="fa-solid fa-floppy-disk"></i> Save${pending ? ` (${pending})` : ""}
        </button>
      </div>

      <div class="grid-legend">
        <span><i class="cell-swatch present"></i> Present</span>
        <span><i class="cell-swatch absent"></i> Absent</span>
        <span><i class="cell-swatch unset"></i> Not marked</span>
        <span class="grid-hint">Click a cell to cycle · click a day number to mark the column</span>
      </div>

      <div class="att-grid-wrap">
        <table class="att-grid">
          <thead>
            <tr>
              <th class="att-grid-person">Employee Identity</th>
              ${days.map(d => `
                <th class="att-grid-day${d.isRest ? " rest" : ""}${d.date === today ? " today" : ""}"
                    data-date="${d.date}" title="Mark the whole column for ${d.date}">
                  <span class="dnum">${Number(d.date.slice(-2))}</span>
                  <span class="ddow">${d.dow}</span>
                </th>`).join("")}
            </tr>
          </thead>
          <tbody id="attGridBody">
            ${people.map(p => personRowHtml(p, days, today)).join("")}
          </tbody>
        </table>
      </div>
      ${people.length ? "" : Components.createEmptyState("fa-users-slash", "Nobody on the register", "No members are in scope for you.")}`;

    wireGrid(el);
  }

  function personRowHtml(p, days, today) {
    return `
      <tr class="att-grid-row" data-person="${p.id}"
          data-search="${Utils.escapeHtml(`${p.name} ${p.employee_id || ""} ${p.department || ""} ${p.job_title || ""}`.toLowerCase())}">
        <th class="att-grid-person">
          <div class="agp-name">${Utils.escapeHtml(p.name)}</div>
          <div class="agp-meta">${Utils.escapeHtml(p.employee_id || "—")} | ${Utils.escapeHtml(p.department || "—")}</div>
          <div class="agp-shift">Shift: ${Utils.escapeHtml(p.shift || "Regular Shift")}</div>
        </th>
        ${days.map(d => {
          const st = statusFor(p.id, d.date);
          const edited = gridEdits[cellKey(p.id, d.date)] !== undefined;
          return `<td class="att-cell${st ? " " + st.toLowerCase() : ""}${d.isRest ? " rest" : ""}${d.isFuture ? " future" : ""}${edited ? " edited" : ""}"
                      data-person="${p.id}" data-type="${p.person_type}" data-date="${d.date}"
                      ${d.isFuture ? "" : 'tabindex="0" role="button"'}
                      aria-label="${Utils.escapeHtml(p.name)} ${d.date}: ${st || "not marked"}">
                    ${st ? STATUS_MARK[st] : ""}
                  </td>`;
        }).join("")}
      </tr>`;
  }

  function cycleCell(td) {
    // Future days cannot be marked: recording attendance for a day that has
    // not happened is always a mistake, and the old date input already
    // capped at today.
    if (td.classList.contains("future")) return;
    const { person, date } = td.dataset;
    const current = statusFor(person, date);
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];

    const original = roster?.marks?.[person]?.[date] || null;
    if (next === original) delete gridEdits[cellKey(person, date)];
    else gridEdits[cellKey(person, date)] = next;

    // Repaint just this cell -- redrawing 1,400 cells on every click made the
    // grid feel sticky and lost the scroll position.
    td.className = `att-cell${next ? " " + next.toLowerCase() : ""}`
      + (td.dataset.rest === "1" ? " rest" : "")
      + (gridEdits[cellKey(person, date)] !== undefined ? " edited" : "");
    td.textContent = next ? STATUS_MARK[next] : "";
    td.setAttribute("aria-label", `${person} ${date}: ${next || "not marked"}`);
    refreshSaveButton();
  }

  function refreshSaveButton() {
    const btn = document.getElementById("saveAttendanceBtn");
    if (!btn) return;
    const n = Object.keys(gridEdits).length;
    btn.disabled = n === 0;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save${n ? ` (${n})` : ""}`;
  }

  function wireGrid(el) {
    document.getElementById("gridPrev").addEventListener("click", () => {
      if (!confirmDiscard()) return;
      gridMonth = shiftMonth(gridMonth, -1);
      renderTakeAttendance(el);
    });
    document.getElementById("gridNext").addEventListener("click", () => {
      if (!confirmDiscard()) return;
      gridMonth = shiftMonth(gridMonth, 1);
      renderTakeAttendance(el);
    });

    // Event delegation: one listener instead of ~1,400.
    const body = document.getElementById("attGridBody");
    body.addEventListener("click", (e) => {
      const td = e.target.closest(".att-cell");
      if (td) cycleCell(td);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const td = e.target.closest(".att-cell");
      if (!td) return;
      e.preventDefault();
      cycleCell(td);
    });

    // Clicking a day heading marks that whole column present.
    Utils.qsa(".att-grid-day", el).forEach(th => th.addEventListener("click", () => {
      const date = th.dataset.date;
      Utils.qsa(`.att-cell[data-date="${date}"]`, el).forEach(td => {
        if (td.classList.contains("future")) return;
        if (statusFor(td.dataset.person, date) === "Present") return;
        cycleCellTo(td, "Present");
      });
      refreshSaveButton();
    }));

    document.getElementById("gridTodayPresent").addEventListener("click", () => {
      const today = new Date().toISOString().slice(0, 10);
      const cells = Utils.qsa(`.att-cell[data-date="${today}"]`, el);
      if (!cells.length) {
        Components.createToast("Today is not in the month you are viewing.", "info");
        return;
      }
      cells.forEach(td => cycleCellTo(td, "Present"));
      refreshSaveButton();
    });

    const search = document.getElementById("gridSearch");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      Utils.qsa(".att-grid-row", el).forEach(tr => {
        tr.style.display = !q || tr.dataset.search.includes(q) ? "" : "none";
      });
    });

    document.getElementById("saveAttendanceBtn").addEventListener("click", () => saveGrid(el));
    document.getElementById("exportAttendanceBtn")
      .addEventListener("click", () => downloadRegister(new Date().toISOString().slice(0, 10)));
  }

  function cycleCellTo(td, status) {
    const { person, date } = td.dataset;
    const original = roster?.marks?.[person]?.[date] || null;
    if (status === original) delete gridEdits[cellKey(person, date)];
    else gridEdits[cellKey(person, date)] = status;
    td.className = `att-cell ${status.toLowerCase()}`
      + (gridEdits[cellKey(person, date)] !== undefined ? " edited" : "");
    td.textContent = STATUS_MARK[status];
  }

  function confirmDiscard() {
    if (!Object.keys(gridEdits).length) return true;
    const ok = window.confirm("You have unsaved marks. Leave the month and discard them?");
    if (ok) Object.keys(gridEdits).forEach(k => delete gridEdits[k]);
    return ok;
  }

  async function saveGrid(el) {
    const entries = Object.entries(gridEdits);
    if (!entries.length) return;

    // The save endpoint takes one date at a time, so group the edits by day.
    const byDate = {};
    entries.forEach(([key, status]) => {
      const [personId, date] = key.split("|");
      if (!status) return;                    // cleared cells are not sent
      const person = roster.people.find(p => p.id === personId);
      (byDate[date] ||= []).push({
        person_id: personId,
        person_type: person?.person_type || "staff",
        status,
      });
    });

    const btn = document.getElementById("saveAttendanceBtn");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    let saved = 0;
    const failed = [];
    for (const [date, marks] of Object.entries(byDate)) {
      try {
        const res = await API.saveAttendance(date, marks);
        saved += res?.saved ?? marks.length;
      } catch (err) {
        // Report which days failed rather than a blanket error: a partial
        // save is otherwise invisible and the user re-marks everything.
        failed.push(`${date} (${err.message})`);
      }
    }

    if (failed.length) {
      Components.createToast(`Saved ${saved}. Failed: ${failed.join("; ")}`, "error");
    } else {
      Components.createToast(`Saved ${saved} mark${saved === 1 ? "" : "s"}.`, "success");
      AppEvents.logAudit(user, "UPDATE_RECORD", `attendance/${gridMonth}`);

      // Carried over from the old one-day save: management is notified when
      // absences are recorded. Dropping this on the rewrite would have
      // silently removed a feature nobody asked me to remove.
      const absentees = entries
        .filter(([, status]) => status === "Absent")
        .map(([key]) => {
          const [personId, date] = key.split("|");
          return { name: roster.people.find(p => p.id === personId)?.name || personId, date };
        });
      if (absentees.length) {
        AppEvents.notify({
          title: `${absentees.length} absence${absentees.length > 1 ? "s" : ""} recorded`,
          body: `${absentees.slice(0, 3).map(a => `${a.name} (${a.date})`).join(", ")}`
                + `${absentees.length > 3 ? ` +${absentees.length - 3} more` : ""}.`,
          icon: "fa-user-slash", type: "warning", link: "attendance",
          target: { roles: ["Super Admin", "General Manager"], departments: [Roles.WORKFORCE_DEPT] },
        });
      }
      if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
      Object.keys(gridEdits).forEach(k => delete gridEdits[k]);
    }
    await DataStore.load(["attendance"], { force: true });
    scopedAttendance = Roles.visibleAttendance(user, DataStore.attendance);
    renderStats();
    await renderTakeAttendance(el);
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

  // ---------------- Shift Management ----------------
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  async function renderShifts(el) {
    el.innerHTML = Components.skeletonGrid(3, "row");
    let shifts = [];
    try { shifts = await API.getShifts(true); }
    catch (err) {
      el.innerHTML = Components.createEmptyState("fa-triangle-exclamation",
        "Could not load shifts", err.message);
      return;
    }

    el.innerHTML = `
      <div class="attendance-toolbar">
        <p style="font-size:12.5px;color:var(--text-muted);max-width:520px;margin:0;">
          Named working patterns. Hours shown are paid hours, after the unpaid break.
          A shift ending before it starts runs overnight.
        </p>
        <button class="btn btn-primary" id="newShiftBtn" style="margin-left:auto;">
          <i class="fa-solid fa-plus"></i> New Shift
        </button>
      </div>
      <div class="shift-grid">
        ${shifts.map(shiftCardHtml).join("") || Components.createEmptyState(
          "fa-clock", "No shifts yet", "Create one to get started.")}
      </div>`;

    document.getElementById("newShiftBtn").addEventListener("click", () => openShiftModal(null, el));
    Utils.qsa(".shift-edit", el).forEach(b => b.addEventListener("click", () =>
      openShiftModal(shifts.find(s => s.id === b.dataset.id), el)));
    Utils.qsa(".shift-assign", el).forEach(b => b.addEventListener("click", () =>
      openAssignModal(shifts.find(s => s.id === b.dataset.id), el)));
    Utils.qsa(".shift-delete", el).forEach(b => b.addEventListener("click", () =>
      removeShift(shifts.find(s => s.id === b.dataset.id), el)));
  }

  function shiftCardHtml(s) {
    return `
      <div class="shift-card${s.active ? "" : " inactive"}">
        <div class="shift-card-head">
          <span class="shift-dot" style="background:${Utils.escapeHtml(s.color || "var(--accent)")};"></span>
          <b>${Utils.escapeHtml(s.name)}</b>
          ${s.is_default ? Components.createBadge("Default", "green") : ""}
          ${s.active ? "" : Components.createBadge("Inactive", "gray")}
        </div>
        <div class="shift-times">${Utils.escapeHtml(s.start_time)} – ${Utils.escapeHtml(s.end_time)}
          <span class="shift-hours">${s.hours}h paid</span></div>
        <div class="shift-meta">${s.break_minutes} min break · ${s.assigned_count} assigned</div>
        <div class="shift-days">
          ${DAY_NAMES.map((d, i) => `<span class="${(s.work_days || []).includes(i) ? "on" : ""}">${d}</span>`).join("")}
        </div>
        <div class="shift-actions">
          <button class="btn btn-secondary btn-sm shift-assign" data-id="${s.id}"><i class="fa-solid fa-user-plus"></i> Assign</button>
          <button class="btn btn-secondary btn-sm shift-edit" data-id="${s.id}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="btn btn-outline btn-sm shift-delete" data-id="${s.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
  }

  function openShiftModal(shift, el) {
    const editing = !!shift;
    const days = shift?.work_days || [0, 1, 2, 3, 4, 5];
    const modal = Components.createModal({
      title: editing ? `Edit ${shift.name}` : "New shift",
      bodyHtml: `
        <div class="field"><label for="shName">Name</label>
          <input class="input" id="shName" value="${Utils.escapeHtml(shift?.name || "")}" placeholder="e.g. Night Shift"></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field"><label for="shStart">Starts</label>
            <input class="input" id="shStart" type="time" value="${shift?.start_time || "08:00"}"></div>
          <div class="field"><label for="shEnd">Ends</label>
            <input class="input" id="shEnd" type="time" value="${shift?.end_time || "17:00"}"></div>
        </div>
        <div class="field"><label for="shBreak">Unpaid break (minutes)</label>
          <input class="input" id="shBreak" type="number" min="0" max="480" value="${shift?.break_minutes ?? 60}"></div>
        <div class="field"><label>Working days</label>
          <div class="day-picker" id="shDays">
            ${DAY_NAMES.map((d, i) => `<button type="button" class="day-chip${days.includes(i) ? " on" : ""}" data-day="${i}">${d}</button>`).join("")}
          </div></div>
        <div class="field"><label for="shColor">Colour</label>
          <input class="input" id="shColor" type="color" value="${shift?.color || "#2563EB"}" style="height:40px;"></div>
        <label class="flex items-center gap-8" style="font-size:13px;">
          <input type="checkbox" id="shDefault" ${shift?.is_default ? "checked" : ""}>
          Make this the default for new people
        </label>
        <div id="shPreview" class="shift-preview"></div>`,
      actionsHtml: `
        <button class="btn btn-secondary" id="shCancel">Cancel</button>
        <button class="btn btn-primary" id="shSave">${editing ? "Save" : "Create"}</button>`,
    });

    const q = (id) => modal.el.querySelector(id);
    // Live preview, so the overnight case is obvious before saving rather
    // than a surprise afterwards.
    function preview() {
      const h = localShiftHours(q("#shStart").value, q("#shEnd").value, +q("#shBreak").value || 0);
      const overnight = toMinutes(q("#shEnd").value) <= toMinutes(q("#shStart").value);
      q("#shPreview").innerHTML = `<i class="fa-solid fa-clock"></i> ${h}h paid`
        + (overnight ? ` <span class="overnight">runs overnight</span>` : "");
    }
    ["#shStart", "#shEnd", "#shBreak"].forEach(id => q(id).addEventListener("input", preview));
    preview();

    Utils.qsa(".day-chip", modal.el).forEach(chip =>
      chip.addEventListener("click", () => chip.classList.toggle("on")));

    q("#shCancel").addEventListener("click", modal.close);
    q("#shSave").addEventListener("click", async (e) => {
      const payload = {
        name: q("#shName").value.trim(),
        start_time: q("#shStart").value,
        end_time: q("#shEnd").value,
        break_minutes: +q("#shBreak").value || 0,
        work_days: Utils.qsa(".day-chip.on", modal.el).map(c => +c.dataset.day),
        color: q("#shColor").value,
        is_default: q("#shDefault").checked,
      };
      if (!payload.name) { Components.createToast("Give the shift a name.", "error"); return; }
      if (!payload.work_days.length) { Components.createToast("Pick at least one working day.", "error"); return; }

      e.target.disabled = true;
      try {
        if (editing) await API.updateShift(shift.id, payload);
        else await API.createShift(payload);
        modal.close();
        Components.createToast(editing ? "Shift updated." : "Shift created.", "success");
        renderShifts(el);
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(err.message, "error");
      }
    });
  }

  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || "0:0").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  /** Mirrors shift_hours() in app/routers/shifts.py. An end at or before the
   *  start means the shift crosses midnight. */
  function localShiftHours(start, end, breakMinutes) {
    let span = toMinutes(end) - toMinutes(start);
    if (span <= 0) span += 24 * 60;
    return Math.round(Math.max(0, span - Math.max(0, breakMinutes)) / 60 * 100) / 100;
  }

  async function openAssignModal(shift, el) {
    const people = roster?.people || (await API.getAttendanceRoster(gridMonth)).people;
    const modal = Components.createModal({
      title: `Assign to ${shift.name}`,
      bodyHtml: `
        <input class="input" id="asSearch" type="search" placeholder="Search name, ID or department...">
        <div class="assign-list" id="asList">
          ${people.map(p => `
            <label class="assign-row" data-search="${Utils.escapeHtml(`${p.name} ${p.employee_id || ""} ${p.department || ""}`.toLowerCase())}">
              <input type="checkbox" value="${Utils.escapeHtml(p.id)}" ${p.shift === shift.name ? "checked" : ""}>
              <span><b>${Utils.escapeHtml(p.name)}</b>
                <small>${Utils.escapeHtml(p.employee_id || "—")} · ${Utils.escapeHtml(p.department || "—")}</small></span>
              <em>${Utils.escapeHtml(p.shift || "—")}</em>
            </label>`).join("")}
        </div>`,
      actionsHtml: `
        <button class="btn btn-secondary" id="asCancel">Cancel</button>
        <button class="btn btn-primary" id="asSave">Assign selected</button>`,
    });

    const search = modal.el.querySelector("#asSearch");
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      Utils.qsa(".assign-row", modal.el).forEach(row => {
        row.style.display = !query || row.dataset.search.includes(query) ? "" : "none";
      });
    });

    modal.el.querySelector("#asCancel").addEventListener("click", modal.close);
    modal.el.querySelector("#asSave").addEventListener("click", async (e) => {
      const ids = Utils.qsa("#asList input:checked", modal.el).map(i => i.value);
      if (!ids.length) { Components.createToast("Nobody selected.", "info"); return; }
      e.target.disabled = true;
      try {
        await API.assignShift(ids, shift.name);
        modal.close();
        Components.createToast(`${ids.length} assigned to ${shift.name}.`, "success");
        roster = null;                 // the grid's shift column is now stale
        renderShifts(el);
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(err.message, "error");
      }
    });
  }

  async function removeShift(shift, el) {
    // Signature is (message, onConfirm, options) -- positional, not an
    // options object.
    Components.createConfirmDialog(
      shift.assigned_count
        ? `${shift.assigned_count} people are on this shift, so it will be deactivated rather than deleted.`
        : "This shift is not in use and will be removed.",
      async () => {
        try {
          const res = await API.deleteShift(shift.id);
          Components.createToast(res.message || "Shift removed.", "success");
          renderShifts(el);
        } catch (err) { Components.createToast(err.message, "error"); }
      },
      { title: `Delete ${shift.name}?`, confirmText: "Delete" });
  }

  // ---------------- Import from Excel ----------------
  let importFile = null;

  function renderImport(el) {
    el.innerHTML = `
      <div class="import-panel">
        <div class="import-drop" id="importDrop">
          <i class="fa-solid fa-file-arrow-up"></i>
          <b>Drop a spreadsheet here, or click to choose</b>
          <span>.xlsx or .csv · needs Employee ID, Date and Status columns</span>
          <input type="file" id="importFile" accept=".xlsx,.xlsm,.csv,.txt" class="hidden">
        </div>
        <div class="import-help">
          <p><b>Headings are matched loosely</b> — “Employee ID”, “EMP ID” and “Name” all work,
             as do “Date”/“Day” and “Status”/“Attendance”.</p>
          <p><b>Status</b> accepts P, Present, Yes, 1 — or A, Absent, No, 0.</p>
          <p><b>Dates</b> accept 2026-08-01 and 01/08/2026.</p>
          <a href="#" id="templateLink"><i class="fa-solid fa-download"></i> Download a template</a>
        </div>
        <div id="importResult"></div>
      </div>`;

    const input = document.getElementById("importFile");
    const drop = document.getElementById("importDrop");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      if (e.dataTransfer.files?.[0]) handleImportFile(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => {
      if (input.files?.[0]) handleImportFile(input.files[0]);
    });

    document.getElementById("templateLink").addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(API.importTemplateUrl(), {
          headers: { Authorization: `Bearer ${Auth.getToken()}` },
        });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url; a.download = "attendance-template.csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) { Components.createToast(err.message, "error"); }
    });
  }

  async function handleImportFile(file) {
    importFile = file;
    const out = document.getElementById("importResult");
    out.innerHTML = `<div class="import-status"><i class="fa-solid fa-spinner fa-spin"></i> Checking ${Utils.escapeHtml(file.name)}...</div>`;

    let preview;
    try { preview = await API.previewAttendanceImport(file); }
    catch (err) {
      out.innerHTML = `<div class="attendance-notice warn"><i class="fa-solid fa-circle-xmark"></i>
        <span>${Utils.escapeHtml(err.message)}</span></div>`;
      return;
    }

    const bad = preview.rows.filter(r => !r.ok);
    out.innerHTML = `
      <div class="import-summary">
        <div><b>${preview.total_rows}</b><span>rows read</span></div>
        <div class="ok"><b>${preview.valid}</b><span>valid</span></div>
        <div class="${preview.invalid ? "bad" : ""}"><b>${preview.invalid}</b><span>skipped</span></div>
        <div><b>${preview.would_create}</b><span>new</span></div>
        <div><b>${preview.would_update}</b><span>updated</span></div>
      </div>
      ${bad.length ? `
        <div class="import-errors">
          <b>Rows that will be skipped</b>
          <ul>${bad.slice(0, 25).map(r => `<li>Row ${r.row}${r.person ? ` (${Utils.escapeHtml(r.person)})` : ""} — ${Utils.escapeHtml(r.error)}</li>`).join("")}</ul>
          ${bad.length > 25 ? `<small>...and ${bad.length - 25} more</small>` : ""}
        </div>` : ""}
      <div class="flex gap-8" style="margin-top:14px;">
        <button class="btn btn-primary" id="importConfirm" ${preview.valid ? "" : "disabled"}>
          <i class="fa-solid fa-check"></i> Import ${preview.valid} row${preview.valid === 1 ? "" : "s"}
        </button>
        <button class="btn btn-secondary" id="importCancel">Cancel</button>
      </div>`;

    document.getElementById("importCancel").addEventListener("click", () => {
      importFile = null;
      renderImport(document.getElementById("attTabContent"));
    });
    document.getElementById("importConfirm").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Importing...`;
      try {
        const res = await API.commitAttendanceImport(importFile, true);
        Components.createToast(
          `Imported ${res.imported} row${res.imported === 1 ? "" : "s"}`
          + (res.skipped ? `, skipped ${res.skipped}.` : "."), "success");
        AppEvents.logAudit(user, "EXTERNAL_IMPORT", `attendance/import/${res.imported}`);
        await DataStore.load(["attendance"], { force: true });
        scopedAttendance = Roles.visibleAttendance(user, DataStore.attendance);
        roster = null;                 // the grid must re-read from the server
        renderStats();
        importFile = null;
        renderImport(document.getElementById("attTabContent"));
      } catch (err) {
        e.target.disabled = false;
        e.target.innerHTML = `<i class="fa-solid fa-check"></i> Retry import`;
        Components.createToast(err.message, "error");
      }
    });
  }

  // ---------------- Overtime ----------------
  let otMonth = new Date().toISOString().slice(0, 7);

  async function renderOvertime(el) {
    el.innerHTML = Components.skeletonGrid(4, "row");
    const canLog = Roles.canTakeAttendance(user);
    const canReview = Roles.ORG_WIDE.includes(user.role) || user.role === "Department Manager";

    let rows = [], summary = null;
    try {
      rows = await API.getOvertime({ month: otMonth });
      if (Roles.canViewAttendance(user)) summary = await API.getOvertimeSummary(otMonth);
    } catch (err) {
      el.innerHTML = Components.createEmptyState("fa-triangle-exclamation",
        "Could not load overtime", err.message);
      return;
    }

    el.innerHTML = `
      <div class="attendance-toolbar">
        <div class="month-nav">
          <button class="icon-btn" id="otPrev" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
          <b>${Utils.escapeHtml(monthLabel(otMonth))}</b>
          <button class="icon-btn" id="otNext" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        ${canLog ? `<button class="btn btn-primary" id="otAdd" style="margin-left:auto;">
          <i class="fa-solid fa-plus"></i> Log Overtime</button>` : ""}
      </div>
      ${summary ? `
        <div class="ot-summary">
          <div><b>${summary.total_hours}</b><span>approved hours</span></div>
          <div><b>${summary.equivalent_hours}</b><span>paid equivalent</span></div>
          <div class="warn"><b>${summary.pending}</b><span>awaiting approval</span></div>
          <div><b>${summary.approved}</b><span>approved</span></div>
          <div><b>${summary.rejected}</b><span>rejected</span></div>
        </div>` : ""}
      ${rows.length ? `
        <div class="ot-list">
          ${rows.map(o => overtimeRowHtml(o, canReview, canLog)).join("")}
        </div>` : Components.createEmptyState("fa-clock", "No overtime this month",
            canLog ? "Log the first entry with the button above." : "")}`;

    document.getElementById("otPrev").addEventListener("click", () => {
      otMonth = shiftMonth(otMonth, -1); renderOvertime(el);
    });
    document.getElementById("otNext").addEventListener("click", () => {
      otMonth = shiftMonth(otMonth, 1); renderOvertime(el);
    });
    document.getElementById("otAdd")?.addEventListener("click", () => openOvertimeModal(el));

    Utils.qsa(".ot-approve", el).forEach(b => b.addEventListener("click", () =>
      reviewOvertime(b.dataset.id, "Approved", el)));
    Utils.qsa(".ot-reject", el).forEach(b => b.addEventListener("click", () =>
      reviewOvertime(b.dataset.id, "Rejected", el)));
    Utils.qsa(".ot-delete", el).forEach(b => b.addEventListener("click", async () => {
      try {
        await API.deleteOvertime(b.dataset.id);
        Components.createToast("Entry removed.", "success");
        renderOvertime(el);
      } catch (err) { Components.createToast(err.message, "error"); }
    }));
  }

  function overtimeRowHtml(o, canReview, canLog) {
    const tone = { Approved: "green", Rejected: "red", Pending: "yellow" }[o.status] || "gray";
    return `
      <div class="ot-row">
        <div class="ot-main">
          <div class="ot-who"><b>${Utils.escapeHtml(o.person_name || o.person_id)}</b>
            ${Components.createBadge(o.status, tone)}</div>
          <div class="ot-meta">${Utils.escapeHtml(o.date)} · ${o.hours}h × ${o.rate_multiplier}
            = <b>${o.equivalent_hours}h</b> paid${o.department ? ` · ${Utils.escapeHtml(o.department)}` : ""}</div>
          ${o.reason ? `<div class="ot-reason">${Utils.escapeHtml(o.reason)}</div>` : ""}
          ${o.reviewed_by ? `<div class="ot-review"><i class="fa-solid fa-gavel"></i>
            ${Utils.escapeHtml(o.status)} by ${Utils.escapeHtml(o.reviewed_by)}${o.review_note ? ` — ${Utils.escapeHtml(o.review_note)}` : ""}</div>` : ""}
        </div>
        <div class="ot-actions">
          ${canReview && o.status === "Pending" ? `
            <button class="btn btn-primary btn-sm ot-approve" data-id="${o.id}"><i class="fa-solid fa-check"></i> Approve</button>
            <button class="btn btn-secondary btn-sm ot-reject" data-id="${o.id}"><i class="fa-solid fa-xmark"></i> Reject</button>` : ""}
          ${canLog && o.status !== "Approved" ? `
            <button class="btn btn-outline btn-sm ot-delete" data-id="${o.id}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>` : ""}
        </div>
      </div>`;
  }

  async function reviewOvertime(id, decision, el) {
    const modal = Components.createModal({
      title: `${decision === "Approved" ? "Approve" : "Reject"} overtime`,
      bodyHtml: `<div class="field"><label for="otNote">Note (optional)</label>
        <textarea class="input" id="otNote" rows="3" placeholder="Why?"></textarea></div>`,
      actionsHtml: `<button class="btn btn-secondary" id="otRvCancel">Cancel</button>
        <button class="btn btn-primary" id="otRvOk">${decision}</button>`,
    });
    modal.el.querySelector("#otRvCancel").addEventListener("click", modal.close);
    modal.el.querySelector("#otRvOk").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        await API.reviewOvertime(id, decision, modal.el.querySelector("#otNote").value.trim() || null);
        modal.close();
        Components.createToast(`Overtime ${decision.toLowerCase()}.`, "success");
        renderOvertime(el);
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(err.message, "error");
      }
    });
  }

  async function openOvertimeModal(el) {
    const people = roster?.people || (await API.getAttendanceRoster(gridMonth)).people;
    const today = new Date().toISOString().slice(0, 10);
    const modal = Components.createModal({
      title: "Log overtime",
      bodyHtml: `
        <div class="field"><label for="otPerson">Person</label>
          <input class="input" id="otPerson" list="otPeople" placeholder="Search by name or ID...">
          <datalist id="otPeople">
            ${people.map(p => `<option value="${Utils.escapeHtml(p.name)}">${Utils.escapeHtml(p.employee_id || "")} · ${Utils.escapeHtml(p.department || "")}</option>`).join("")}
          </datalist></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;">
          <div class="field"><label for="otDate">Date</label>
            <input class="input" id="otDate" type="date" value="${today}" max="${today}"></div>
          <div class="field"><label for="otHours">Hours</label>
            <input class="input" id="otHours" type="number" step="0.5" min="0.5" max="16" value="2"></div>
        </div>
        <div class="field"><label for="otRate">Rate</label>
          <select class="input" id="otRate">
            <option value="1.5">1.5× — time and a half</option>
            <option value="2">2× — double time</option>
            <option value="1">1× — flat rate</option>
          </select></div>
        <div class="field"><label for="otReason">Reason</label>
          <textarea class="input" id="otReason" rows="3" placeholder="Why were the extra hours needed?"></textarea></div>`,
      actionsHtml: `<button class="btn btn-secondary" id="otCancel">Cancel</button>
        <button class="btn btn-primary" id="otSave">Log it</button>`,
    });

    modal.el.querySelector("#otCancel").addEventListener("click", modal.close);
    modal.el.querySelector("#otSave").addEventListener("click", async (e) => {
      const typed = modal.el.querySelector("#otPerson").value.trim().toLowerCase();
      const person = people.find(p => (p.name || "").toLowerCase() === typed);
      if (!person) { Components.createToast("Pick someone from the list.", "error"); return; }

      e.target.disabled = true;
      try {
        await API.logOvertime({
          person_id: person.id,
          person_type: person.person_type,
          date: modal.el.querySelector("#otDate").value,
          hours: +modal.el.querySelector("#otHours").value,
          rate_multiplier: +modal.el.querySelector("#otRate").value,
          reason: modal.el.querySelector("#otReason").value.trim() || null,
        });
        modal.close();
        Components.createToast("Overtime logged — awaiting approval.", "success");
        renderOvertime(el);
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(err.message, "error");
      }
    });
  }

  // ---------------- AI Absence Ranking ----------------
  function renderRanking(el) {
    const ranked = AIEngine.rankAbsences(scopedAttendance);
    if (!ranked.length) { el.innerHTML = Components.createEmptyState("fa-chart-column", "No attendance data yet"); return; }
    el.innerHTML = `
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <p style="font-size:12.5px; color:var(--text-muted); max-width:560px;">Ranked by an AI absence-risk score combining 30-day absence rate, recent (7-day) absences, and late-arrival frequency.</p>
        <a href="reports" class="btn btn-secondary btn-sm"><i class="fa-solid fa-file-lines"></i> Generate Attendance Report</a>
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

// Published for the single-page shell: a top-level `const` creates a
// script-scope binding, NOT a window property, so SPA's window[name]
// lookup would otherwise find nothing.
if (typeof window !== "undefined") window.AttendancePage = AttendancePage;
