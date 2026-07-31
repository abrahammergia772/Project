/* ============================================================
   BuildIQ — chatbot page logic (A.12)
   ============================================================ */

const ChatbotPage = (() => {
  let history = [];
  const conversations = [
    { id: "c1", title: "Project risk overview", active: true },
    { id: "c2", title: "Weekly complaint summary" },
    { id: "c3", title: "Team workload check" },
  ];

  function shell() {
    return `
      <div class="page-header"><div><h1>AI Chatbot</h1><div class="page-sub">Ask BuildIQ AI Assistant about your organization</div></div></div>
      <div class="chatbot-layout">
        <div class="conv-list" id="convList"></div>
        <div class="chat-window">
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-input-bar">
            <div class="suggestion-chips" id="suggestionChips"></div>
            <div class="chat-input-row">
              <button class="icon-btn" aria-label="Attach file"><i class="fa-solid fa-paperclip"></i></button>
              <button class="icon-btn" aria-label="Voice input"><i class="fa-solid fa-microphone"></i></button>
              <textarea class="input" id="chatInput" rows="1" placeholder="Message BuildIQ AI Assistant..."></textarea>
              <button class="btn btn-primary" id="sendBtn"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function init() {
    // Load real server data before rendering.
    await DataStore.load(["projects"]);
    const content = document.getElementById("pageContent");
    content.innerHTML = shell();
    renderConvList();
    renderSuggestions();
    addMessage("ai", "Hello! I'm BuildIQ AI Assistant. Ask me about project risk, complaints, team workload, or request a report.");

    document.getElementById("sendBtn").addEventListener("click", sendMessage);
    const input = document.getElementById("chatInput");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
  }

  function renderConvList() {
    document.getElementById("convList").innerHTML = conversations.map(c => `
      <div class="conv-item ${c.active ? "active" : ""}" data-id="${c.id}"><i class="fa-solid fa-message" style="margin-right:8px;"></i>${Utils.escapeHtml(c.title)}</div>`).join("");
  }

  function renderSuggestions() {
    document.getElementById("suggestionChips").innerHTML = ReferenceData.chatSuggestions.map(s => `<span class="example-chip" style="cursor:pointer;">${s}</span>`).join("");
    Utils.qsa(".example-chip").forEach(chip => chip.addEventListener("click", () => {
      document.getElementById("chatInput").value = chip.textContent;
      sendMessage();
    }));
  }

  function addMessage(role, text) {
    const messages = document.getElementById("chatMessages");
    const row = document.createElement("div");
    row.className = `msg-row ${role}`;
    row.innerHTML = `
      <div class="msg-avatar">${role === "user" ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>'}</div>
      <div class="msg-bubble">${Utils.escapeHtml(text).replace(/\n/g,"<br>").replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")}</div>`;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function addTyping() {
    const messages = document.getElementById("chatMessages");
    const row = document.createElement("div");
    row.className = "msg-row ai";
    row.id = "typingRow";
    row.innerHTML = `<div class="msg-avatar"><i class="fa-solid fa-robot"></i></div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (!text) return;
    addMessage("user", text);
    history.push({ role: "user", content: text });
    input.value = ""; input.style.height = "auto";
    addTyping();
    const res = await API.chat(text, history);
    document.getElementById("typingRow")?.remove();
    addMessage("ai", res.reply);
    history.push({ role: "assistant", content: res.reply });
  }

  return { init };
})();
