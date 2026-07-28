/* ============================================================
   BuildIQ — settings.js
   ============================================================ */

const SettingsPage = (() => {
  async function init() {
    const user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header"><div><h1>Settings</h1><div class="page-sub">Manage your account and system preferences</div></div></div>
      <div class="tabs" id="settingsTabs">
        <div class="tab active" data-tab="profile">Profile</div>
        <div class="tab" data-tab="security">Security</div>
        <div class="tab" data-tab="notifications">Notifications</div>
        <div class="tab" data-tab="system">System</div>
      </div>
      <div id="settingsContent" style="margin-top:20px; max-width:640px;"></div>`;
    render("profile", user);
    Utils.qsa(".tab", document.getElementById("settingsTabs")).forEach(tab => tab.addEventListener("click", () => {
      Utils.qsa(".tab", document.getElementById("settingsTabs")).forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      render(tab.dataset.tab, user);
    }));
  }

  function render(tab, user) {
    const el = document.getElementById("settingsContent");
    if (tab === "profile") {
      el.innerHTML = `
        <div class="card">
          <div class="flex items-center gap-16" style="margin-bottom:20px;">
            ${Components.createAvatar(user.name, "xl")}
            <div><button class="btn btn-secondary btn-sm">Change Photo</button></div>
          </div>
          <div class="field"><label>Full Name</label><input class="input" value="${Utils.escapeHtml(user.name)}"></div>
          <div class="field"><label>Email</label><input class="input" value="${Utils.escapeHtml(user.email)}"></div>
          <div class="field"><label>Organization</label><input class="input" value="${Utils.escapeHtml(user.org_name)}" disabled></div>
          <div class="field"><label>Role</label><input class="input" value="${Utils.escapeHtml(user.role)}" disabled></div>
          <button class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
        </div>`;
      document.getElementById("saveProfileBtn").addEventListener("click", () => Components.createToast("Profile updated.", "success"));
    } else if (tab === "security") {
      el.innerHTML = `
        <div class="card">
          <div class="field"><label>Current Password</label><input class="input" type="password"></div>
          <div class="field"><label>New Password</label><input class="input" type="password"></div>
          <div class="field"><label>Confirm New Password</label><input class="input" type="password"></div>
          <button class="btn btn-primary" id="updatePwBtn">Update Password</button>
        </div>`;
      document.getElementById("updatePwBtn").addEventListener("click", () => Components.createToast("Password updated.", "success"));
    } else if (tab === "notifications") {
      const opts = ["New complaint submitted","Project risk changes to HIGH","Audit anomaly flagged","Weekly summary email"];
      el.innerHTML = `<div class="card">${opts.map((o,i) => `
        <label class="flex items-center justify-between" style="padding:12px 0; border-bottom:1px solid var(--border);">
          <span style="font-size:13.5px;">${o}</span><input type="checkbox" ${i<3?"checked":""} style="accent-color:var(--accent); width:18px; height:18px;">
        </label>`).join("")}</div>`;
    } else {
      el.innerHTML = `
        <div class="card">
          <div class="field"><label>API Base URL</label><input class="input" value="${BUILDIQ_CONFIG.API_BASE}" disabled></div>
          <div class="field"><label>Mock Mode</label><input class="input" value="${BUILDIQ_CONFIG.MOCK_MODE ? "Enabled (no backend required)" : "Disabled — using live backend"}" disabled></div>
          <p style="font-size:12.5px; color:var(--text-muted);">To connect a live backend, set MOCK_MODE to false in js/config.js.</p>
        </div>`;
    }
  }

  return { init };
})();
