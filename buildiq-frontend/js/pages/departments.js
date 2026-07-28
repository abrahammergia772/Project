/* ============================================================
   BuildIQ — departments.js
   ============================================================ */

const DepartmentsPage = (() => {
  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header">
        <div><h1>Departments</h1><div class="page-sub">Organizational structure & department performance</div></div>
        <div class="page-header-actions"><button class="btn btn-primary" id="addDeptBtn"><i class="fa-solid fa-plus"></i> Add Department</button></div>
      </div>
      <div class="members-grid" id="deptGrid"></div>`;
    render();
    document.getElementById("addDeptBtn").addEventListener("click", () => {
      Components.createToast("Department creation requires Super Admin backend access.", "info");
    });
  }
  function render() {
    document.getElementById("deptGrid").innerHTML = MockData.departments.map(d => `
      <div class="card card-hover">
        <div class="flex items-center gap-12" style="margin-bottom:14px;">
          <div style="width:44px;height:44px;border-radius:10px;background:rgba(var(--accent-rgb),0.14); display:flex; align-items:center; justify-content:center; color:var(--accent); font-size:18px;"><i class="fa-solid fa-building"></i></div>
          <div><div style="font-weight:700; font-size:15px;">${d.name}</div><div style="font-size:12px;color:var(--text-muted);">Head: ${d.head}</div></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr; text-align:center; padding:10px 0; border-top:1px solid var(--border);">
          <div><div style="font-weight:700; font-size:17px;">${d.members}</div><div style="font-size:11px;color:var(--text-muted);">Members</div></div>
          <div><div style="font-weight:700; font-size:17px;">${d.projects}</div><div style="font-size:11px;color:var(--text-muted);">Projects</div></div>
        </div>
      </div>`).join("");
  }
  return { init };
})();
