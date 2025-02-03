(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  let currentAiMessage = null;
  let markedInitialized = false;

  function parseContent(content) {
    initializeMarked();
    return marked.parse(content);
  }

  function initializeMarked() {
    if (!markedInitialized) {
      marked.setOptions({
        sanitize: false,
        breaks: true, // Ensure line breaks are preserved
        highlight: (code) => hljs.highlightAuto(code).value,
      });
      markedInitialized = true;
    }
  }

  function createToggleElement(content) {
    const div = document.createElement("div");
    div.className = "think-container";
    div.innerHTML = `
      <div class="think-toggle">
        <span class="toggle-icon">▶</span>
        <span class="toggle-text">Show Thought Process</span>
      </div>
      <div class="think-content hidden">${parseContent(content)}</div>
    `;
    return div;
  }

  function createAnswerElement(content) {
    const div = document.createElement("div");
    div.className = "final-answer";
    div.innerHTML = parseContent(content);
    return div;
  }

  function addMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.className = `message ${role}`;
    messageElement.innerHTML = parseContent(content);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
    }
  }

  sendBtn.addEventListener("click", sendMessage);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  window.addEventListener("message", (event) => {
    const { command, content, role } = event.data;

    switch (command) {
      case "startAiMessage":
        currentAiMessage = document.createElement("div");
        currentAiMessage.className = "message ai";
        messagesContainer.appendChild(currentAiMessage);
        break;

      case "appendThink":
        let thinkContainer = currentAiMessage.querySelector(".think-container");
        if (!thinkContainer) {
          // Create the thought process container if it doesn't exist
          thinkContainer = createToggleElement("");
          currentAiMessage.appendChild(thinkContainer);
        }

        // Append the new content to the existing thought process
        const thinkContent = thinkContainer.querySelector(".think-content");
        thinkContent.textContent += content; // Append raw content
        thinkContent.innerHTML = parseContent(thinkContent.textContent); // Re-parse the entire content
        scrollToBottom();
        break;

      case "appendAnswer":
        const answerElement = createAnswerElement(content);
        currentAiMessage.appendChild(answerElement);
        scrollToBottom();
        break;

      case "appendRaw":
        if (currentAiMessage) {
          const tempDiv = document.createElement("div");
          tempDiv.textContent = content; // Append raw content
          tempDiv.innerHTML = parseContent(tempDiv.textContent); // Re-parse the entire content
          currentAiMessage.appendChild(tempDiv);
          scrollToBottom();
        }
        break;

      case "finalizeMessage":
        currentAiMessage = null;
        scrollToBottom();
        break;

      case "addMessage":
        addMessage(content, role);
        break;

      case "showError":
        addMessage(content, "error");
        break;

      case "clearHistory":
        messagesContainer.innerHTML = "";
        break;
    }
  });

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".think-toggle");
    if (toggle) {
      const container = toggle.closest(".think-container");
      const content = container.querySelector(".think-content");
      const icon = container.querySelector(".toggle-icon");
      const text = container.querySelector(".toggle-text");

      content.classList.toggle("hidden");
      icon.textContent = content.classList.contains("hidden") ? "▶" : "▼";
      text.textContent = content.classList.contains("hidden")
        ? "Show Thought Process"
        : "Hide Thought Process";
    }
  });

  input.focus();
})();
