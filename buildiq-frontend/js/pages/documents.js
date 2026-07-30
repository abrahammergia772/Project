/* ============================================================
   BuildIQ — documents.js
   Real file upload/download. Uploaded files keep their actual bytes
   (the File/Blob is retained), so downloading returns exactly what was
   uploaded. Upload and delete are role-scoped and both write an audit
   log entry via MockData.logAuditEvent (real mode: the backend logs it).
   ============================================================ */

const DocumentsPage = (() => {
  let user;
  let docs = [];

  function canUpload() {
    // Everyone except read-only Auditors can contribute documents.
    return user.role !== "Auditor";
  }
  function canDelete(doc) {
    if (Roles.ORG_WIDE.includes(user.role)) return true;
    if (user.role === "Department Manager") return doc.department === user.department || doc.uploaded_by_id === user.id;
    return doc.uploaded_by_id === user.id;
  }

  async function init() {
    user = Auth.getUser();
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header">
        <div><h1>Documents</h1><div class="page-sub">Shared files${Roles.ORG_WIDE.includes(user.role) || user.role === "Auditor" ? "" : ` — ${user.department || "your"} scope`}</div></div>
        <div class="page-header-actions">
          ${canUpload() ? `
            <input type="file" id="docFileInput" class="hidden" multiple>
            <button class="btn btn-primary" id="uploadBtn"><i class="fa-solid fa-upload"></i> Upload</button>` : ""}
        </div>
      </div>
      <div id="dropZone" class="doc-dropzone ${canUpload() ? "" : "hidden"}">
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <div><b>Drag &amp; drop files here</b><span>or click Upload to browse</span></div>
      </div>
      <div id="docsTableWrap"></div>`;

    if (canUpload()) {
      const input = document.getElementById("docFileInput");
      document.getElementById("uploadBtn").addEventListener("click", () => input.click());
      input.addEventListener("change", (e) => handleFiles(Array.from(e.target.files || [])));

      const dz = document.getElementById("dropZone");
      dz.addEventListener("click", () => input.click());
      ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, (e) => {
        e.preventDefault(); dz.classList.add("dragging");
      }));
      ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, (e) => {
        e.preventDefault(); dz.classList.remove("dragging");
      }));
      dz.addEventListener("drop", (e) => handleFiles(Array.from(e.dataTransfer?.files || [])));
    }

    await load();
  }

  async function load() {
    document.getElementById("docsTableWrap").innerHTML = Components.skeletonGrid(4, "row");
    docs = await API.getDocuments();
    renderTable();
  }

  function renderTable() {
    const wrap = document.getElementById("docsTableWrap");
    if (!docs.length) {
      wrap.innerHTML = Components.createEmptyState("fa-folder-open", "No documents yet", canUpload() ? "Upload a file to get started." : "No documents are shared with your account.");
      return;
    }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>Size</th><th>Uploaded By</th><th>Date</th><th style="text-align:right;">Actions</th></tr></thead>
      <tbody>${docs.map(d => `<tr>
        <td><i class="fa-solid ${d.icon}" style="color:var(--${d.color}); margin-right:10px;"></i>${Utils.escapeHtml(d.name)}</td>
        <td>${d.size_label}</td>
        <td>${Utils.escapeHtml(d.uploaded_by)}</td>
        <td>${Utils.formatDate(d.uploaded_at)}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-ghost btn-sm download-doc-btn" data-id="${d.id}" title="Download" aria-label="Download ${Utils.escapeHtml(d.name)}"><i class="fa-solid fa-download"></i></button>
          ${canDelete(d) ? `<button class="btn btn-ghost btn-sm delete-doc-btn" data-id="${d.id}" title="Delete" aria-label="Delete ${Utils.escapeHtml(d.name)}"><i class="fa-solid fa-trash"></i></button>` : ""}
        </td>
      </tr>`).join("")}</tbody></table></div>`;

    Utils.qsa(".download-doc-btn").forEach(b => b.addEventListener("click", () => download(b.dataset.id)));
    Utils.qsa(".delete-doc-btn").forEach(b => b.addEventListener("click", () => confirmDelete(b.dataset.id)));
  }

  async function handleFiles(files) {
    if (!files.length) return;
    for (const file of files) {
      Components.createToast(`Uploading ${file.name}...`, "info");
      try {
        await API.uploadDocument(file);
      } catch (err) {
        Components.createToast(`Failed to upload ${file.name}.`, "error");
        continue;
      }
    }
    Components.createToast(`${files.length} file${files.length > 1 ? "s" : ""} uploaded.`, "success");
    document.getElementById("docFileInput").value = "";
    await load();
    if (window.Shell?.refreshNotifications) Shell.refreshNotifications();
  }

  async function download(id) {
    const doc = docs.find(d => d.id === id);
    if (!doc) return;

    let blob = doc.blob;
    if (!blob && !BUILDIQ_CONFIG.MOCK_MODE) {
      try { blob = await API.downloadDocument(id); }
      catch { Components.createToast("Download failed.", "error"); return; }
    }
    if (!blob) {
      // Seeded demo rows have no real bytes behind them — generate a placeholder
      // so the button still produces a genuine file rather than doing nothing.
      blob = new Blob(
        [`BuildIQ demo document\n\nName: ${doc.name}\nUploaded by: ${doc.uploaded_by}\nDate: ${doc.uploaded_at}\n\n` +
         `This is seeded demo content. Files you upload yourself download byte-for-byte as the original.`],
        { type: "text/plain" }
      );
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Components.createToast(`Downloading ${doc.name}`, "success");
  }

  function confirmDelete(id) {
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    Components.createConfirmDialog(
      `"${doc.name}" will be permanently removed.`,
      async () => {
        await API.deleteDocument(id);
        Components.createToast("Document deleted.", "success");
        await load();
      },
      { title: "Delete document?", confirmText: "Delete" }
    );
  }

  return { init };
})();
