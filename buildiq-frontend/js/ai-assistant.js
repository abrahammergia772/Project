/* ============================================================
   BuildIQ — ai-assistant.js
   Floating AI assistant available on every page.

   A launcher button sits bottom-right; clicking it opens a chat panel
   without leaving the current page. The conversation persists across
   navigation (sessionStorage), so an answer isn't lost when the user
   clicks through to the page it pointed them at.

   Visibility follows the same rule as the full chatbot page
   (Router.ACCESS.chatbot), so roles without AI access never see it.
   ============================================================ */

const AIAssistant = (() => {
  const STORAGE_KEY = "buildiq_assistant_history";
  const OPEN_KEY = "buildiq_assistant_open";
  const MAX_HISTORY = 40;          // keep the stored transcript bounded

  let history = [];
  let mounted = false;
  let busy = false;

  // ---------------- Persistence ----------------
  function load() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      history = raw ? JSON.parse(raw) : [];
    } catch { history = []; }
  }
  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch { /* storage full or unavailable — the chat still works in-memory */ }
  }

  function canUse() {
    const user = Auth.getUser();
    if (!user) return false;
    return Router.accessFor("chatbot", user.role) !== false;
  }

  // ---------------- Markup ----------------
  function template(user) {
    return `
      <button class="ai-fab" id="aiFab" aria-label="Open AI assistant" aria-expanded="false"
              title="Ask BuildIQ AI (Ctrl + /)">
        <i class="fa-solid fa-robot"></i>
        <span class="ai-fab-pulse" aria-hidden="true"></span>
      </button>

      <div class="ai-panel hidden" id="aiPanel" role="dialog" aria-modal="false"
           aria-label="BuildIQ AI Assistant">
        <header class="ai-panel-head">
          <div class="ai-panel-title">
            <span class="ai-panel-icon"><i class="fa-solid fa-robot"></i></span>
            <div>
              <b>BuildIQ Assistant</b>
              <small id="aiPanelStatus">Scoped to what you can see</small>
            </div>
          </div>
          <div class="ai-panel-actions">
            <button class="icon-btn" id="aiClearBtn" aria-label="Clear conversation" title="Clear conversation">
              <i class="fa-solid fa-eraser"></i>
            </button>
            <a href="chatbot" class="icon-btn" aria-label="Open full chat page" title="Open full page">
              <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
            </a>
            <button class="icon-btn" id="aiCloseBtn" aria-label="Close assistant" title="Close">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </header>

        <div class="ai-panel-body" id="aiMessages" aria-live="polite"></div>

        <div class="ai-panel-foot">
          <div class="ai-chips" id="aiChips"></div>
          <div class="ai-input-row">
            <textarea class="input" id="aiInput" rows="1" maxlength="1000"
                      placeholder="Ask about projects, risks, complaints..."></textarea>
            <button class="btn btn-primary ai-send" id="aiSendBtn" aria-label="Send">
              <i class="fa-solid fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ---------------- Messages ----------------
  function messageHtml(role, text) {
    const safe = Utils.escapeHtml(text)
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    return `
      <div class="ai-msg ${role}">
        <span class="ai-msg-avatar">
          <i class="fa-solid ${role === "user" ? "fa-user" : "fa-robot"}"></i>
        </span>
        <div class="ai-msg-bubble">${safe}</div>
      </div>`;
  }

  function renderMessages() {
    const box = document.getElementById("aiMessages");
    if (!box) return;

    if (!history.length) {
      const user = Auth.getUser();
      box.innerHTML = `
        <div class="ai-empty">
          <span class="ai-empty-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
          <b>Hello${user ? ", " + Utils.escapeHtml(user.name.split(" ")[0]) : ""}</b>
          <p>Ask me about project risk, complaints, team workload or your tasks.
             I only see what your role can see.</p>
        </div>`;
      return;
    }
    box.innerHTML = history.map(m => messageHtml(m.role === "user" ? "user" : "ai", m.content)).join("");
    box.scrollTop = box.scrollHeight;
  }

  function renderChips() {
    const el = document.getElementById("aiChips");
    if (!el) return;
    // Hide the prompts once a conversation is under way — they take up space.
    if (history.length) { el.innerHTML = ""; return; }

    const user = Auth.getUser();
    const prompts = suggestionsFor(user);
    el.innerHTML = prompts.map(p => `<button type="button" class="ai-chip">${Utils.escapeHtml(p)}</button>`).join("");
    Utils.qsa(".ai-chip", el).forEach(chip => chip.addEventListener("click", () => {
      const input = document.getElementById("aiInput");
      input.value = chip.textContent;
      send();
    }));
  }

  // Role-appropriate opening prompts — a Client shouldn't be offered
  // "who is overloaded this week?".
  function suggestionsFor(user) {
    const role = user?.role;
    if (role === "Client") {
      return ["How is my project progressing?", "What's the status of my complaints?"];
    }
    if (role === "Engineer") {
      return ["What should I work on first?", "Which of my tasks are overdue?"];
    }
    if (role === Roles.PROJECT_MANAGER) {
      return ["Which of my projects are at risk?", "Who on my team is overloaded?", "Summarize open complaints"];
    }
    if (role === "Auditor") {
      return ["Summarize recent anomalies", "Which audit type has the most flags?"];
    }
    return ["Which projects are at risk?", "Summarize today's complaints", "Who is overloaded this week?"];
  }

  function appendTyping() {
    const box = document.getElementById("aiMessages");
    if (!box) return;
    box.insertAdjacentHTML("beforeend", `
      <div class="ai-msg ai" id="aiTyping">
        <span class="ai-msg-avatar"><i class="fa-solid fa-robot"></i></span>
        <div class="ai-msg-bubble"><span class="ai-dots"><i></i><i></i><i></i></span></div>
      </div>`);
    box.scrollTop = box.scrollHeight;
  }

  async function send() {
    const input = document.getElementById("aiInput");
    const text = (input?.value || "").trim();
    if (!text || busy) return;

    busy = true;
    history.push({ role: "user", content: text });
    input.value = "";
    input.style.height = "auto";
    renderChips();
    renderMessages();
    appendTyping();

    const sendBtn = document.getElementById("aiSendBtn");
    if (sendBtn) sendBtn.disabled = true;

    try {
      const res = await API.chat(text, history.slice(0, -1), AIModel.get());
      history.push({ role: "assistant", content: res.reply });
    } catch (err) {
      // Surface the failure in-thread rather than only as a toast.
      history.push({
        role: "assistant",
        content: "I couldn't reach the assistant just now. Please try again in a moment.",
      });
    } finally {
      document.getElementById("aiTyping")?.remove();
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
      save();
      renderMessages();
      document.getElementById("aiInput")?.focus();
    }
  }

  // ---------------- Open / close ----------------
  function open() {
    const panel = document.getElementById("aiPanel");
    const fab = document.getElementById("aiFab");
    if (!panel) return;
    panel.classList.remove("hidden");
    fab?.classList.add("active");
    fab?.setAttribute("aria-expanded", "true");
    sessionStorage.setItem(OPEN_KEY, "1");
    renderMessages();
    renderChips();
    setTimeout(() => document.getElementById("aiInput")?.focus(), 60);
  }

  function close() {
    const panel = document.getElementById("aiPanel");
    const fab = document.getElementById("aiFab");
    panel?.classList.add("hidden");
    fab?.classList.remove("active");
    fab?.setAttribute("aria-expanded", "false");
    sessionStorage.removeItem(OPEN_KEY);
  }

  function toggle() {
    const panel = document.getElementById("aiPanel");
    if (!panel) return;
    panel.classList.contains("hidden") ? open() : close();
  }

  function clear() {
    history = [];
    save();
    renderMessages();
    renderChips();
  }

  // ---------------- Mount ----------------
  function mount() {
    // The full chat page already provides this — a floating copy would be noise.
    const onChatPage = Router.currentPageKey() === "chatbot";
    if (mounted || !canUse() || onChatPage) return;

    const user = Auth.getUser();
    const host = document.createElement("div");
    host.id = "aiAssistantRoot";
    host.innerHTML = template(user);
    document.body.appendChild(host);
    mounted = true;

    load();

    document.getElementById("aiFab").addEventListener("click", toggle);
    document.getElementById("aiCloseBtn").addEventListener("click", close);
    document.getElementById("aiClearBtn").addEventListener("click", clear);
    document.getElementById("aiSendBtn").addEventListener("click", send);

    const input = document.getElementById("aiInput");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(110, input.scrollHeight) + "px";
    });

    // Ctrl/Cmd + / toggles, Escape closes.
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); toggle(); }
      if (e.key === "Escape") {
        const panel = document.getElementById("aiPanel");
        if (panel && !panel.classList.contains("hidden")) close();
      }
    });

    // Reopen automatically if it was open before navigating.
    if (sessionStorage.getItem(OPEN_KEY) === "1") open();
    else { renderMessages(); renderChips(); }

    // Show whether live AI or local heuristics are answering.
    reportMode();
  }

  async function reportMode() {
    const el = document.getElementById("aiPanelStatus");
    if (!el) return;
    if (BUILDIQ_CONFIG.MOCK_MODE) { el.textContent = "Demo mode · scoped to your role"; return; }
    try {
      const res = await fetch(`${BUILDIQ_CONFIG.API_BASE}/ai/status`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      el.textContent = body.mode === "groq"
        ? "Live AI · scoped to your role"
        : "Scoped to what you can see";
    } catch { /* leave the default label */ }
  }

  return { mount, open, close, toggle, clear, canUse };
})();
