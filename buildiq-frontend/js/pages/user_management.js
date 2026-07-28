/* ============================================================
   BuildIQ — user_management.js
   Super Admin + General Manager: manage internal staff accounts
   and external Client accounts (roles, suspension, invitations).
   ============================================================ */

const UserManagementPage = (() => {
  let activeTab = "staff";

  async function init() {
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header"><div><h1>User Management</h1><div class="page-sub">${user.role} — manage system-wide accounts and permissions</div></div>
        <div class="page-header-actions"><button class="btn btn-primary" id="inviteBtn"><i class="fa-solid fa-user-plus"></i> Invite User</button></div></div>
      <div class="tabs" id="umTabs" style="margin-bottom:18px;">
        <div class="tab active" data-tab="staff">Staff Accounts</div>
        <div class="tab" data-tab="clients">Client Accounts</div>
      </div>
      <div id="umContent"></div>`;
    render();
    document.getElementById("inviteBtn").addEventListener("click", () => {
      Components.createToast(activeTab === "clients" ? "Client invitation sent (mock)." : "Invitation sent (mock).", "success");
    });
    Utils.qsa(".tab", document.getElementById("umTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("umTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      render();
    }));
  }

  function render() {
    const el = document.getElementById("umContent");
    if (activeTab === "staff") {
      const staff = MockData.members;
      el.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>User</th><th>Role</th><th>Department</th><th>Status</th><th>Last Active</th><th>Actions</th></tr></thead>
        <tbody>${staff.map(m => `
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
        </tr>`).join("")}</tbody></table></div>`;
    } else {
      const clients = MockData.clients;
      el.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Linked Project(s)</th><th>Actions</th></tr></thead>
        <tbody>${clients.map(c => {
          const projects = MockData.projects.filter(p => p.client_id === c.id);
          return `<tr>
          <td><div class="flex items-center gap-8">${Components.createAvatar(c.company,"sm",c.avatar_color)}<span>${Utils.escapeHtml(c.company)}</span></div></td>
          <td>${Utils.escapeHtml(c.contact_name)}</td>
          <td>${Utils.escapeHtml(c.email)}</td>
          <td>${projects.length ? projects.map(p=>Components.createBadge(p.title,"gray")).join(" ") : "—"}</td>
          <td><button class="btn btn-ghost btn-sm" title="Edit"><i class="fa-solid fa-pen"></i></button></td>
        </tr>`;
        }).join("")}</tbody></table></div>`;
    }
    Utils.qsa(".suspend-user-btn").forEach(b => b.addEventListener("click", () => {
      Components.createConfirmDialog("This user will lose access to BuildIQ immediately.", () => Components.createToast("User suspended.", "success"), { title: "Suspend user?" });
    }));
  }
  return { init };
})();
