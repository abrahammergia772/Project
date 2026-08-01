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
              <div id="avatarPreview">${Components.createAvatar(user.name, "xl")}</div>
              <div>
                <button class="btn btn-secondary btn-sm" id="changePhotoBtn">
                  <i class="fa-solid fa-camera"></i> Change Photo
                </button>
                <input type="file" id="avatarFile" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden">
                <div class="text-muted" style="font-size:11.5px; margin-top:6px;">JPEG, PNG, WebP or GIF · max 2 MB</div>
              </div>
          </div>
          <div class="field"><label>Full Name</label><input class="input" value="${Utils.escapeHtml(user.name)}"></div>
          <div class="field"><label>Email</label><input class="input" value="${Utils.escapeHtml(user.email)}"></div>
          <div class="field"><label>Organization</label><input class="input" value="${Utils.escapeHtml(user.org_name)}" disabled></div>
          <div class="field"><label>Role</label><input class="input" value="${Utils.escapeHtml(user.role)}" disabled></div>
          <button class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
        </div>`;
      document.getElementById("saveProfileBtn").addEventListener("click", () => Components.createToast("Profile updated.", "success"));

        // "Change Photo" previously had no handler at all -- clicking it did
        // nothing. It now opens the file picker and uploads to the server.
        const photoBtn = document.getElementById("changePhotoBtn");
        const fileInput = document.getElementById("avatarFile");
        photoBtn.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;

          // Checked here too, so an oversized file fails instantly rather
          // than after a slow upload on a phone connection.
          if (file.size > 2 * 1024 * 1024) {
            Components.createToast(
              `That image is ${Math.round(file.size / 1024)} KB; the limit is 2 MB.`, "error");
            fileInput.value = "";
            return;
          }

          const original = photoBtn.innerHTML;
          photoBtn.disabled = true;
          photoBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading...`;

          // Show the chosen image straight away; revert if the upload fails.
          const preview = document.getElementById("avatarPreview");
          const previousHtml = preview.innerHTML;
          const localUrl = URL.createObjectURL(file);
          preview.innerHTML = `<img src="${localUrl}" alt="Profile photo" class="avatar avatar-xl" style="object-fit:cover;">`;

          try {
            await API.uploadAvatar(file);
            Components.createToast("Photo updated.", "success");
            AppEvents.logAudit(user, "UPDATE_RECORD", `members/${user.id}/avatar`);
          } catch (err) {
            preview.innerHTML = previousHtml;
            Components.createToast(`Could not upload: ${err.message}`, "error");
          } finally {
            URL.revokeObjectURL(localUrl);
            photoBtn.disabled = false;
            photoBtn.innerHTML = original;
            fileInput.value = "";
          }
        });
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

// Published for the single-page shell: a top-level `const` creates a
// script-scope binding, NOT a window property, so SPA's window[name]
// lookup would otherwise find nothing.
if (typeof window !== "undefined") window.SettingsPage = SettingsPage;
