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

  function shell() {
    const canTake = Roles.canTakeAttendance(user);
    return `
      <div class="page-header">
        <div><h1>Attendance</h1><div class="page-sub">${canTake ? "Supervise daily attendance for staff and daily workers" : "Attendance overview" + (user.role === "Department Manager" ? ` — ${user.department}` : "")}</div></div>
      </div>
      <div class="attendance-stats" id="attStats"></div>
      <div class="tabs" id="attTabs">
        ${canTake ? `<div class="tab active" data-tab="take">Take Attendance</div>` : ""}
        <div class="tab ${canTake ? "" : "active"}" data-tab="ranking">AI Absence Ranking</div>
        <div class="tab" data-tab="history">History</div>
        <div class="tab" data-tab="workers">Daily Workers</div>
      </div>
      <div id="attTabContent" style="margin-top:18px;"></div>`;
  }

  async function init() {
    user = Auth.getUser();
    activeTab = Roles.canTakeAttendance(user) ? "take" : "ranking";
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    document.getElementById("attTabContent").innerHTML = Components.skeletonGrid(4, "row");

    scopedAttendance = Roles.visibleAttendance(user, MockData.attendance);
    scopedWorkers = Roles.visibleDailyWorkers(user, MockData.dailyWorkers);
    scopedStaff = (Roles.ORG_WIDE.includes(user.role) || (user.role === "Department Manager" && user.department === Roles.WORKFORCE_DEPT))
      ? MockData.members.filter(m => m.role === "Engineer" || m.role === "Department Manager")
      : MockData.members.filter(m => (m.role === "Engineer" || m.role === "Department Manager") && m.department === user.department);

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
    if (tab === "take") renderTakeAttendance(el);
    else if (tab === "ranking") renderRanking(el);
    else if (tab === "history") renderHistory(el);
    else renderWorkers(el);
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
        <button class="btn btn-primary" id="saveAttendanceBtn" style="align-self:flex-end; margin-left:auto;"><i class="fa-solid fa-floppy-disk"></i> Save Attendance</button>
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

    Utils.qsa(".attendance-status-toggle button", el).forEach(btn => btn.addEventListener("click", () => {
      pendingMarks[btn.dataset.person] = btn.dataset.status;
      renderTakeAttendance(el);
    }));
    loadExistingMarksForDate();
  }

  function attendanceRowHtml(p) {
    const existing = MockData.attendance.find(a => a.person_id === p.id && a.date === selectedDate);
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
    MockData.attendance.filter(a => a.date === selectedDate).forEach(a => { if (!(a.person_id in pendingMarks)) pendingMarks[a.person_id] = a.status; });
  }

  function saveAttendance(people) {
    let saved = 0;
    people.forEach(p => {
      const status = pendingMarks[p.id];
      if (!status) return;
      const existing = MockData.attendance.find(a => a.person_id === p.id && a.date === selectedDate);
      if (existing) { existing.status = status; }
      else {
        MockData.attendance.push({
          id: Utils.uid("att"), person_id: p.id, person_name: p.name, person_type: p.type,
          department: (MockData.getMemberById(p.id) || MockData.getDailyWorkerById(p.id) || {}).department,
          project_id: (MockData.getDailyWorkerById(p.id) || {}).project_id || null,
          project_title: (MockData.getDailyWorkerById(p.id) || {}).project_title || null,
          date: selectedDate, status,
          check_in: status === "Absent" ? null : "08:00",
          recorded_by: user.name,
        });
      }
      saved++;
    });
    scopedAttendance = Roles.visibleAttendance(user, MockData.attendance);
    Components.createToast(`Attendance saved for ${saved} people on ${selectedDate}.`, "success");
    renderStats();
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
        <thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Status</th><th>Check-in</th></tr></thead>
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
        </tr>`).join("") : `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">No records match your filters.</td></tr>`;
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
