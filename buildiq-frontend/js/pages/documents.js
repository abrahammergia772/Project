/* ============================================================
   BuildIQ — documents.js
   ============================================================ */

const DocumentsPage = (() => {
  const docs = [
    { name: "Structural_Drawings_v3.pdf", size: "4.2 MB", by: "Dawit Alemu", date: "2026-07-20", icon: "fa-file-pdf", color: "red" },
    { name: "Site_Safety_Checklist.docx", size: "180 KB", by: "Yonas Bekele", date: "2026-07-18", icon: "fa-file-word", color: "blue" },
    { name: "Q2_Budget_Report.xlsx", size: "890 KB", by: "Selam Getachew", date: "2026-07-15", icon: "fa-file-excel", color: "green" },
    { name: "Site_Photos_June.zip", size: "22.4 MB", by: "Meron Tadesse", date: "2026-07-10", icon: "fa-file-zipper", color: "yellow" },
    { name: "Contract_Addendum_2.pdf", size: "1.1 MB", by: "Kaleb Mulugeta", date: "2026-07-05", icon: "fa-file-pdf", color: "red" },
  ];
  async function init() {
    const content = document.getElementById("pageContent");
    content.innerHTML = `
      <div class="page-header"><div><h1>Documents</h1><div class="page-sub">Shared files and AI-summarized attachments</div></div>
        <div class="page-header-actions"><button class="btn btn-primary" id="uploadBtn"><i class="fa-solid fa-upload"></i> Upload</button></div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Size</th><th>Uploaded By</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${docs.map(d => `<tr>
          <td><i class="fa-solid ${d.icon}" style="color:var(--${d.color}); margin-right:10px;"></i>${d.name}</td>
          <td>${d.size}</td><td>${d.by}</td><td>${Utils.formatDate(d.date)}</td>
          <td><button class="btn btn-ghost btn-sm"><i class="fa-solid fa-download"></i></button></td>
        </tr>`).join("")}</tbody></table></div>`;
    document.getElementById("uploadBtn").addEventListener("click", () => Components.createToast("File upload requires backend storage connection.", "info"));
  }
  return { init };
})();
