/* ============================================================
   BuildIQ — tasks.js  (#5: AI task priority ranking + personal schedule)
   - "My Tasks": every assigned task, ranked by an AI priority score
     (urgency + project risk + blocking flag) with a plain-language reason.
   - "My Schedule": a Mon-Fri time-slot table. "AI Auto-Schedule" places
     the highest-priority open tasks into free slots; users can also
     click any empty slot to manually place a task themselves.
   - "Team Tasks" (Managers/Admins only): same ranking across the whole
     team/department, so leads can see what's most urgent org-wide.
   ============================================================ */

const TasksPage = (() => {
  let myTasks = [];
  let teamTasks = [];
  let scheduleGrid = {};
  let activeTab = "mine";
  const SCHEDULE_KEY_PREFIX = "buildiq_schedule_";

  function shell(user) {
    const showTeam = Roles.canViewTeamTasks(user.role);
    return `
      <div class="page-header">
        <div><h1>Tasks</h1><div class="page-sub">AI-ranked by urgency, project risk, and blocking impact</div></div>
        <div class="page-header-actions">
          <button class="btn btn-secondary" id="aiPrioritizeBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Prioritize</button>
          <button class="btn btn-primary" id="addTaskBtn"><i class="fa-solid fa-plus"></i> New Task</button>
        </div>
      </div>
      <div class="tabs" id="taskTabs">
        <div class="tab active" data-tab="mine">My Tasks</div>
        <div class="tab" data-tab="schedule">My Schedule</div>
        ${showTeam ? `<div class="tab" data-tab="team">${Roles.ORG_WIDE.includes(user.role) ? "All Tasks" : "Department Tasks"}</div>` : ""}
      </div>
      <div id="taskTabContent" style="margin-top:18px;"></div>`;
  }

  async function init() {
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = shell(user);
    document.getElementById("taskTabContent").innerHTML = Components.skeletonGrid(4, "row");

    const rawMine = await API.getTasks({ assignee_id: user.id });
    myTasks = AIEngine.prioritizeTasks(rawMine);

    if (Roles.canViewTeamTasks(user.role)) {
      const params = Roles.ORG_WIDE.includes(user.role) ? {} : { department: user.department };
      const rawTeam = await API.getTasks(params);
      teamTasks = AIEngine.prioritizeTasks(rawTeam);
    }

    loadSchedule(user);
    renderTab("mine", user);

    document.getElementById("aiPrioritizeBtn").addEventListener("click", async () => {
      Components.createToast("Re-ranking tasks with AI...", "info");
      myTasks = await API.aiPrioritizeTasks(myTasks);
      if (teamTasks.length) teamTasks = await API.aiPrioritizeTasks(teamTasks);
      renderTab(activeTab, user);
      Components.createToast("Tasks re-prioritized.", "success");
    });
    document.getElementById("addTaskBtn").addEventListener("click", () => openNewTaskModal(user));
    Utils.qsa(".tab", document.getElementById("taskTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("taskTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      renderTab(activeTab, user);
    }));
  }

  function loadSchedule(user) {
    const saved = localStorage.getItem(SCHEDULE_KEY_PREFIX + user.id);
    if (saved) { try { scheduleGrid = JSON.parse(saved); return; } catch {} }
    scheduleGrid = null; // trigger AI auto-schedule on first render
  }
  function persistSchedule(user) {
    localStorage.setItem(SCHEDULE_KEY_PREFIX + user.id, JSON.stringify(scheduleGrid));
  }

  function renderTab(tab, user) {
    const el = document.getElementById("taskTabContent");
    if (tab === "mine") el.innerHTML = renderTaskList(myTasks, true);
    else if (tab === "team") el.innerHTML = renderTaskList(teamTasks, false);
    else el.innerHTML = renderScheduleShell();

    if (tab === "schedule") {
      if (!scheduleGrid) {
        (async () => {
          scheduleGrid = await API.aiAutoSchedule(myTasks);
          persistSchedule(user);
          renderScheduleTable(user);
        })();
      } else {
        renderScheduleTable(user);
      }
    } else {
      bindTaskActions(user);
    }
  }

  function ringColor(priority) {
    return priority === "CRITICAL" ? "var(--red)" : priority === "HIGH" ? "var(--accent)" : priority === "MEDIUM" ? "var(--yellow)" : "var(--text-muted)";
  }

  function renderTaskList(list, isMine) {
    if (!list.length) return Components.createEmptyState("fa-list-check", "No tasks found");
    return `<div class="priority-list">${list.map(t => `
      <div class="task-row" data-id="${t.id}">
        <div class="task-score-ring" style="background:conic-gradient(${ringColor(t.ai_priority)} ${Math.round(t.ai_score*3.6)}deg, var(--bg-input) 0);">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:10.5px;">${t.ai_score}</div>
        </div>
        <div class="task-main">
          <div class="task-title">${Utils.escapeHtml(t.title)}</div>
          <div class="task-meta">${Utils.escapeHtml(t.project_title)} ${isMine ? "" : "· " + Utils.escapeHtml(t.assignee_name)} · Due ${Utils.formatDate(t.due_date)} ${t.days_until_due < 0 ? `(overdue)` : ""}</div>
          <div class="task-reason"><i class="fa-solid fa-sparkles"></i> ${Utils.escapeHtml(t.ai_reason)}</div>
        </div>
        ${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
        ${Components.createBadge(t.status, t.status === "Done" ? "green" : t.status === "In Progress" ? "blue" : "gray")}
        <div class="task-actions">
          ${t.status !== "Done" ? `<button class="btn btn-outline btn-sm mark-done-btn" data-id="${t.id}" title="Mark done"><i class="fa-solid fa-check"></i></button>` : ""}
        </div>
      </div>`).join("")}</div>`;
  }

  function bindTaskActions(user) {
    Utils.qsa(".mark-done-btn").forEach(btn => btn.addEventListener("click", () => {
      const task = myTasks.find(t => t.id === btn.dataset.id) || teamTasks.find(t => t.id === btn.dataset.id);
      if (task) task.status = "Done";
      Components.createToast("Task marked complete.", "success");
      renderTab(activeTab, user);
    }));
  }

  function renderScheduleShell() {
    return `
      <div class="flex items-center justify-between" style="margin-bottom:14px; flex-wrap:wrap; gap:10px;">
        <p style="font-size:12.5px; color:var(--text-muted); max-width:520px;">AI places your highest-priority open tasks into free weekly slots. Click any empty slot to place a task yourself, or click a scheduled block to remove it.</p>
        <button class="btn btn-secondary btn-sm" id="reAutoScheduleBtn"><i class="fa-solid fa-wand-magic-sparkles"></i> Re-run AI Auto-Schedule</button>
      </div>
      <div class="card schedule-table-wrap"><table class="schedule-table" id="scheduleTable"></table></div>`;
  }

  function renderScheduleTable(user) {
    const table = document.getElementById("scheduleTable");
    if (!table) return;
    table.innerHTML = `
      <thead><tr><th>Time</th>${AIEngine.WORK_DAYS.map(d => `<th>${d}</th>`).join("")}</tr></thead>
      <tbody>
        ${AIEngine.SLOTS.map(slot => `
          <tr>
            <td class="time-col">${slot}</td>
            ${AIEngine.WORK_DAYS.map(day => {
              const key = `${day}-${slot}`;
              const task = scheduleGrid[key];
              return `<td class="sched-cell" data-key="${key}">
                ${task
                  ? `<div class="sched-block priority-${task.ai_priority || "LOW"}" data-key="${key}" title="Click to remove">
                      <b>${Utils.escapeHtml(task.title)}</b><br><span style="color:var(--text-muted);">${Utils.escapeHtml(task.project_title)}</span>
                    </div>`
                  : `<div class="sched-empty-slot" data-key="${key}"><i class="fa-solid fa-plus"></i></div>`}
              </td>`;
            }).join("")}
          </tr>`).join("")}
      </tbody>`;

    Utils.qsa(".sched-block", table).forEach(b => b.addEventListener("click", () => {
      scheduleGrid[b.dataset.key] = null;
      persistSchedule(user);
      renderScheduleTable(user);
    }));
    Utils.qsa(".sched-empty-slot", table).forEach(b => b.addEventListener("click", () => openPlaceTaskModal(b.dataset.key, user)));

    document.getElementById("reAutoScheduleBtn")?.addEventListener("click", async () => {
      Components.createToast("Running AI auto-scheduler...", "info");
      scheduleGrid = await API.aiAutoSchedule(myTasks);
      persistSchedule(user);
      renderScheduleTable(user);
      Components.createToast("Schedule updated.", "success");
    });
  }

  function openPlaceTaskModal(key, user) {
    const openTasks = myTasks.filter(t => t.status !== "Done");
    if (!openTasks.length) { Components.createToast("No open tasks available to schedule.", "info"); return; }
    Components.createModal({
      title: `Place a task — ${key.replace("-", " ")}`,
      bodyHtml: `<div class="flex-col gap-8">${openTasks.map(t => `
        <button class="btn btn-outline btn-block place-task-option" data-id="${t.id}" style="justify-content:space-between;">
          <span>${Utils.escapeHtml(t.title)}</span>${Components.createBadge(t.ai_priority, Utils.priorityBadgeType(t.ai_priority))}
        </button>`).join("")}</div>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>`,
    });
    Utils.qsa(".place-task-option").forEach(btn => btn.addEventListener("click", () => {
      const task = openTasks.find(t => t.id === btn.dataset.id);
      scheduleGrid[key] = task;
      persistSchedule(user);
      Utils.qs(".modal-overlay")?.remove();
      renderScheduleTable(user);
      Components.createToast("Task placed on your schedule.", "success");
    }));
  }

  function openNewTaskModal(user) {
    const projectOptions = Roles.visibleProjects(user, MockData.projects);
    Components.createModal({
      title: "New Task",
      bodyHtml: `
        <div class="field"><label>Title</label><input class="input" id="ntTitle" placeholder="e.g. Inspect scaffolding"></div>
        <div class="field"><label>Project</label><select class="input" id="ntProject">${projectOptions.map(p=>`<option value="${p.id}">${p.title}</option>`).join("")}</select></div>
        <div class="field"><label>Due Date</label><input class="input" type="date" id="ntDue"></div>
        <div class="field"><label>Estimated Hours</label><input class="input" type="number" min="1" max="20" value="2" id="ntHours"></div>
        <label class="checkbox-row"><input type="checkbox" id="ntBlocking"> This task blocks other work</label>`,
      actionsHtml: `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="createTaskBtn"><i class="fa-solid fa-check"></i> Create</button>`,
    });
    const overlay = Utils.qs(".modal-overlay");
    overlay.querySelector("#createTaskBtn").addEventListener("click", () => {
      const title = overlay.querySelector("#ntTitle").value.trim();
      if (!title) { Components.createToast("Title is required.", "error"); return; }
      const project = projectOptions.find(p => p.id === overlay.querySelector("#ntProject").value) || projectOptions[0];
      const due = overlay.querySelector("#ntDue").value || new Date(Date.now()+3*86400000).toISOString();
      const newTask = {
        id: Utils.uid("task"), title, category: "Admin", assignee_id: user.id, assignee_name: user.name,
        department: user.department, project_id: project?.id, project_title: project?.title || "General",
        project_risk: project?.delay_risk || "LOW", status: "To Do",
        blocking: overlay.querySelector("#ntBlocking").checked,
        estimated_hours: Number(overlay.querySelector("#ntHours").value) || 2,
        due_date: new Date(due).toISOString(), created_at: new Date().toISOString(),
      };
      myTasks.push(AIEngine.scoreTask(newTask));
      myTasks = AIEngine.prioritizeTasks(myTasks);
      overlay.remove();
      Components.createToast("Task created and ranked by AI.", "success");
      renderTab(activeTab, user);
    });
  }

  return { init };
})();
