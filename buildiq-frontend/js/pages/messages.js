/* ============================================================
   BuildIQ — messages.js

   Direct messages between members. Two panes: conversations on the left,
   the selected thread on the right.

   Anyone with an account can message anyone else with an account, Clients
   included. That is deliberately wider than the rest of the app: the
   directory hides people whose records you have no business managing, which
   is a different question from whether you may say something to them. A
   conversation is still only readable by its two participants.

   "New message" opens a searchable picker rather than a long <select>: type
   a name, email, role or department and matching people appear. Filtering
   happens locally first (instant) and the server is asked as well, so
   someone outside the first page of contacts is still findable.
   ============================================================ */

const MessagesPage = (() => {

  let user = null;
  let contacts = [];
  let conversations = [];
  let activeId = null;
  let poller = null;

  const esc = (v) => Utils.escapeHtml(String(v ?? ""));

  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { day: "numeric", month: "short" });
  }

  async function init() {
    user = Auth.getUser();

    document.getElementById("pageContent").innerHTML = `
      <div class="page-header">
        <div>
          <h1>Messages</h1>
          <div class="page-sub">Send and receive messages with your team</div>
        </div>
        <button class="btn btn-primary" id="newMsgBtn">
          <i class="fa-solid fa-pen-to-square"></i> New Message
        </button>
      </div>
      <div class="msg-layout">
        <aside class="msg-list card" id="msgList">${Components.skeletonGrid(3)}</aside>
        <section class="msg-thread card" id="msgThread"></section>
      </div>`;

    document.getElementById("newMsgBtn").addEventListener("click", () => openCompose());

    await Promise.all([loadContacts(), loadConversations()]);
    renderList();
    renderThread();

    // Light polling so an incoming message appears without a manual refresh.
    // Cleared on navigation to avoid stacking timers in the SPA shell.
    clearInterval(poller);
    poller = setInterval(refreshQuietly, 20000);
  }

  async function loadContacts() {
    try {
      const list = await API.getContacts();
      // Mock data calls the field full_name; the live API calls it name.
      contacts = list.map(c => ({ ...c, name: c.name || c.full_name }));
    }
    catch (err) { contacts = []; console.error("[messages] contacts:", err.message); }
  }

  async function loadConversations() {
    try { conversations = await API.getConversations(); }
    catch (err) { conversations = []; console.error("[messages] conversations:", err.message); }
  }

  /** Refresh without disturbing what the user is reading or typing. */
  async function refreshQuietly() {
    if (!document.getElementById("msgList")) { clearInterval(poller); return; }
    const draft = document.getElementById("msgInput")?.value || "";
    await loadConversations();
    renderList();
    if (activeId) {
      await renderThread();
      const box = document.getElementById("msgInput");
      if (box && draft) box.value = draft;
    }
  }

  function renderList() {
    const el = document.getElementById("msgList");
    if (!el) return;

    if (!conversations.length) {
      el.innerHTML = `
        <div class="msg-list-head">Conversations</div>
        ${Components.createEmptyState("fa-comments", "No messages yet",
          "Start a conversation with someone on your team.")}`;
      return;
    }

    el.innerHTML = `
      <div class="msg-list-head">Conversations</div>
      ${conversations.map(c => `
        <button class="msg-row${c.user_id === activeId ? " active" : ""}" data-id="${esc(c.user_id)}">
          ${Components.createAvatar(c.name || "?", "sm", null, c.user_id)}
          <div class="msg-row-main">
            <div class="msg-row-top">
              <span class="msg-row-name">${esc(c.name)}</span>
              <span class="msg-row-time">${when(c.last_at)}</span>
            </div>
            <div class="msg-row-preview">${esc(c.last_message).slice(0, 60)}</div>
          </div>
          ${c.unread ? `<span class="msg-unread">${c.unread}</span>` : ""}
        </button>`).join("")}`;

    Utils.qsa(".msg-row", el).forEach(b =>
      b.addEventListener("click", () => { activeId = b.dataset.id; renderList(); renderThread(); }));
  }

  async function renderThread() {
    const el = document.getElementById("msgThread");
    if (!el) return;

    if (!activeId) {
      el.innerHTML = Components.createEmptyState("fa-comment-dots", "Select a conversation",
        "Choose someone on the left, or start a new message.");
      return;
    }

    const who = contacts.find(c => c.id === activeId)
      || conversations.find(c => c.user_id === activeId)
      || { name: "Member" };
    const name = who.name || who.full_name || "Member";

    let msgs = [];
    try { msgs = await API.getThread(activeId); }
    catch (err) { console.error("[messages] thread:", err.message); }

    el.innerHTML = `
      <div class="msg-thread-head">
        ${Components.createAvatar(name, "sm", null, activeId)}
        <div>
          <div class="msg-thread-name">${esc(name)}</div>
          <div class="msg-thread-sub">${esc(who.role || "")}${who.department ? " · " + esc(who.department) : ""}</div>
        </div>
      </div>
      <div class="msg-bubbles" id="msgBubbles">
        ${msgs.length ? msgs.map(m => `
          <div class="msg-bubble ${m.sender_id === user.id ? "mine" : "theirs"}">
            <div class="msg-bubble-body">${esc(m.body)}</div>
            <div class="msg-bubble-time">${when(m.created_at)}</div>
          </div>`).join("")
          : `<div class="msg-empty-thread">No messages yet. Say hello.</div>`}
      </div>
      <form class="msg-compose" id="msgForm">
        <textarea class="input" id="msgInput" rows="1" placeholder="Write a message..."></textarea>
        <button class="btn btn-primary" type="submit" id="msgSend">
          <i class="fa-solid fa-paper-plane"></i>
        </button>
      </form>`;

    const bubbles = document.getElementById("msgBubbles");
    if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;

    const form = document.getElementById("msgForm");
    const input = document.getElementById("msgInput");

    // Enter sends, Shift+Enter makes a new line.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;

      const btn = document.getElementById("msgSend");
      btn.disabled = true;
      input.value = "";
      try {
        await API.sendMessage(activeId, body);
        await loadConversations();
        renderList();
        await renderThread();
      } catch (err) {
        input.value = body;               // don't lose what they typed
        Components.createToast(`Could not send: ${err.message}`, "error");
      } finally {
        const b = document.getElementById("msgSend");
        if (b) b.disabled = false;
      }
    });
  }

  // ---------------- New message: searchable recipient picker ----------------
  // A plain <select> of everyone in the organisation is unusable once there
  // are more than a couple of dozen accounts, so this is a search box with a
  // live result list underneath it.
  function personRow(c, selected) {
    return `
      <button type="button" class="compose-person${selected ? " selected" : ""}" data-id="${esc(c.id)}">
        ${Components.createAvatar(c.name || "?", "sm", null, c)}
        <span class="compose-person-main">
          <span class="compose-person-name">${esc(c.name)}</span>
          <span class="compose-person-sub">${esc(c.role || "")}${c.department ? " · " + esc(c.department) : ""}</span>
        </span>
        ${selected ? `<i class="fa-solid fa-check"></i>` : ""}
      </button>`;
  }

  function matches(c, q) {
    if (!q) return true;
    return [c.name, c.email, c.role, c.department, c.job_title]
      .some(v => String(v || "").toLowerCase().includes(q));
  }

  async function openCompose(preselectId = null) {
    const modal = Components.createModal({
      title: "New message",
      bodyHtml: `
        <div class="field">
          <label for="composeSearch">To</label>
          <div class="compose-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input class="input" id="composeSearch" type="search" autocomplete="off"
                   placeholder="Search by name, role or department...">
          </div>
          <div class="compose-results" id="composeResults" role="listbox"></div>
          <div class="compose-picked" id="composePicked"></div>
        </div>
        <div class="field">
          <label for="composeBody">Message</label>
          <textarea class="input" id="composeBody" rows="4" placeholder="Write your message..."></textarea>
        </div>`,
      actionsHtml: `
        <button class="btn btn-secondary" id="composeCancel">Cancel</button>
        <button class="btn btn-primary" id="composeSend" disabled>
          <i class="fa-solid fa-paper-plane"></i> Send
        </button>`,
    });

    const search = modal.el.querySelector("#composeSearch");
    const results = modal.el.querySelector("#composeResults");
    const picked = modal.el.querySelector("#composePicked");
    const sendBtn = modal.el.querySelector("#composeSend");
    let chosen = preselectId;
    // Everyone we know about so far: the initial contact load plus anyone a
    // server-side search has since turned up.
    let pool = contacts.slice();

    function paint(q) {
      const list = pool.filter(c => matches(c, q)).slice(0, 50);
      results.innerHTML = list.length
        ? list.map(c => personRow(c, c.id === chosen)).join("")
        : `<div class="compose-empty">No one matches “${esc(q)}”.</div>`;

      Utils.qsa(".compose-person", results).forEach(b =>
        b.addEventListener("click", () => {
          chosen = b.dataset.id;
          paint(search.value.trim().toLowerCase());
        }));

      const who = pool.find(c => c.id === chosen);
      picked.innerHTML = who
        ? `<span class="compose-chip">To: <b>${esc(who.name)}</b></span>`
        : "";
      sendBtn.disabled = !chosen;
      if (window.Avatars) Avatars.hydrate(results);
    }

    paint("");
    setTimeout(() => search.focus(), 30);

    // Local filter on every keystroke; the server is asked once typing
    // pauses, which is what makes people outside the first page findable.
    let timer = null;
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      paint(q);
      clearTimeout(timer);
      if (q.length < 2) return;
      timer = setTimeout(async () => {
        try {
          const found = await API.searchContacts(q);
          const known = new Set(pool.map(c => c.id));
          const extra = found.filter(c => !known.has(c.id));
          if (extra.length) {
            pool = pool.concat(extra);
            if (search.value.trim().toLowerCase() === q) paint(q);
          }
        } catch (err) { console.error("[messages] search:", err.message); }
      }, 250);
    });

    modal.el.querySelector("#composeCancel").addEventListener("click", modal.close);

    sendBtn.addEventListener("click", async (e) => {
      const body = modal.el.querySelector("#composeBody").value.trim();
      if (!chosen) { Components.createToast("Choose who to send it to.", "error"); return; }
      if (!body) { Components.createToast("Write a message first.", "error"); return; }

      e.target.disabled = true;
      try {
        await API.sendMessage(chosen, body);
        modal.close();
        activeId = chosen;
        await loadConversations();
        renderList();
        await renderThread();
        Components.createToast("Message sent.", "success");
      } catch (err) {
        e.target.disabled = false;
        Components.createToast(`Could not send: ${err.message}`, "error");
      }
    });
  }

  return { init };
})();

// Published for the single-page shell: a top-level `const` creates a
// script-scope binding, NOT a window property, so SPA's window[name]
// lookup would otherwise find nothing.
if (typeof window !== "undefined") window.MessagesPage = MessagesPage;
