(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  let currentAiMessage = null;
  let currentThinkContainer = null;
  let markedInitialized = false;
  const messageBuffers = new WeakMap();
  const thinkStates = new WeakMap();

  function parseContent(content) {
    initializeMarked();
    try {
      return marked.parse(content, {
        gfm: true,
        breaks: false,
        highlight: (code, lang) => {
          return hljs.highlightAuto(code).value;
        },
      });
    } catch (e) {
      return content;
    }
  }

  function initializeMarked() {
    if (!markedInitialized) {
      marked.setOptions({
        smartypants: true,
        silent: true,
      });
      markedInitialized = true;
    }
  }

  function createMessageElement(content, role) {
    const messageElement = document.createElement("div");
    messageElement.className = `message ${role}`;
    messageElement.innerHTML = content;
    messageBuffers.set(messageElement, "");
    return messageElement;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
      input.style.height = "44px";
      currentAiMessage = null;
      currentThinkContainer = null;
    }
  }

  sendBtn.addEventListener("click", sendMessage);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  });

  window.addEventListener("message", (event) => {
    const { command, content, role, hide } = event.data;

    switch (command) {
      case "addMessage":
        const element = createMessageElement(parseContent(content), role);
        messagesContainer.appendChild(element);
        scrollToBottom();
        break;

      case "showTyping":
        typingIndicator.classList.remove("hidden");
        break;

      case "hideTyping":
        typingIndicator.classList.add("hidden");
        break;

      case "showError":
        const errorElement = createMessageElement(
          `<div class="error-message">${content}</div>`,
          "error"
        );
        messagesContainer.appendChild(errorElement);
        scrollToBottom();
        break;

      case "clearHistory":
        messagesContainer.innerHTML = "";
        break;

      case "startThink":
        currentThinkContainer = document.createElement("div");
        currentThinkContainer.className = "think-container";
        currentThinkContainer.innerHTML = `
          <div class="think-toggle">
            <span class="toggle-icon">▶</span>
            <span class="toggle-text">Thought Process</span>
          </div>
          <div class="think-content"></div>
        `;
        messagesContainer.appendChild(currentThinkContainer);
        thinkStates.set(currentThinkContainer, false);

        currentThinkContainer
          .querySelector(".think-toggle")
          .addEventListener("click", () => {
            const content =
              currentThinkContainer.querySelector(".think-content");
            const icon = currentThinkContainer.querySelector(".toggle-icon");
            const isVisible = thinkStates.get(currentThinkContainer);

            content.classList.toggle("visible");
            icon.textContent = isVisible ? "▶" : "▼";
            thinkStates.set(currentThinkContainer, !isVisible);
          });

        scrollToBottom();
        break;

      case "appendThink":
        if (currentThinkContainer) {
          const contentDiv =
            currentThinkContainer.querySelector(".think-content");
          let buffer = contentDiv.textContent + content;
          contentDiv.innerHTML = parseContent(buffer);

          if (!hide) {
            contentDiv.classList.add("visible");
            currentThinkContainer.querySelector(".toggle-icon").textContent =
              "▼";
            thinkStates.set(currentThinkContainer, true);
          }

          hljs.highlightAllUnder(contentDiv);
          scrollToBottom();
        }
        break;

      case "startAnswer":
        currentAiMessage = createMessageElement("", "ai");
        messagesContainer.appendChild(currentAiMessage);
        scrollToBottom();
        break;

      case "appendAnswer":
        if (currentAiMessage) {
          let buffer = messageBuffers.get(currentAiMessage) || "";
          buffer += content;
          messageBuffers.set(currentAiMessage, buffer);
          currentAiMessage.innerHTML = parseContent(buffer);
          hljs.highlightAllUnder(currentAiMessage);
          scrollToBottom();
        }
        break;

      case "appendRaw":
        if (!currentAiMessage) {
          currentAiMessage = createMessageElement("", "ai");
          messagesContainer.appendChild(currentAiMessage);
        }
        let buffer = messageBuffers.get(currentAiMessage) || "";
        buffer += content;
        messageBuffers.set(currentAiMessage, buffer);
        currentAiMessage.innerHTML = parseContent(buffer);
        scrollToBottom();
        break;
    }
  });

  // Handle initial focus
  input.focus();
})();
