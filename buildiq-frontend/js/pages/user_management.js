/* ============================================================
   BuildIQ — user_management.js
   ============================================================ */

const UserManagementPage = (() => {
  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header"><div><h1>User Management</h1><div class="page-sub">Super Admin — manage system-wide user accounts and permissions</div></div>
        <div class="page-header-actions"><button class="btn btn-primary" id="inviteBtn"><i class="fa-solid fa-user-plus"></i> Invite User</button></div></div>
      <div class="table-wrap"><table class="data-table" id="userTable">
        <thead><tr><th>User</th><th>Role</th><th>Department</th><th>Status</th><th>Last Active</th><th>Actions</th></tr></thead>
        <tbody></tbody></table></div>`;
    render();
    document.getElementById("inviteBtn").addEventListener("click", () => Components.createToast("Invitation sent (mock).", "success"));
  }
  function render() {
    document.querySelector("#userTable tbody").innerHTML = MockData.members.slice(0,20).map(m => `
      <tr>
        <td><div class="flex items-center gap-8">${Components.createAvatar(m.full_name,"sm",m.avatar_color)}<span>${Utils.escapeHtml(m.full_name)}</span></div></td>
        <td>${Components.createBadge(m.role, Utils.roleColor(m.role))}</td>
        <td>${m.department}</td>
        <td>${Components.createBadge(m.status, m.status==="Active"?"green":"yellow", true)}</td>
        <td>${Utils.timeAgo(m.joined)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" title="Edit role"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-ghost btn-sm suspend-user-btn" data-id="${m.id}" title="Suspend"><i class="fa-solid fa-user-slash"></i></button>
        </td>
      </tr>`).join("");
    Utils.qsa(".suspend-user-btn").forEach(b => b.addEventListener("click", () => {
      Components.createConfirmDialog("This user will lose access to BuildIQ immediately.", () => Components.createToast("User suspended.", "success"), { title: "Suspend user?" });
    }));
  }
  return { init };
})();
