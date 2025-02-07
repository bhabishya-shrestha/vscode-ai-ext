(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  let currentAiMessage = null;
  let markedInitialized = false;
  const messageBuffers = new WeakMap();
  const allThinkContainers = [];

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
    const { command, content, role, hide, structure } = event.data;

    switch (command) {
      case "addMessage":
        const element = createMessageElement(parseContent(content), role);
        messagesContainer.appendChild(element);
        scrollToBottom();
        break;

      case "addStructuredMessage":
        if (structure) {
          structure.forEach((part) => {
            switch (part.type) {
              case "think":
                handleThink(part.content, hide);
                break;
              case "answer":
                handleAnswer(part.content);
                break;
              case "raw":
                handleRaw(part.content);
                break;
            }
          });
        }
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
        allThinkContainers.length = 0;
        break;

      case "startThink":
        handleThink("", hide);
        break;

      case "appendThink":
        if (allThinkContainers.length > 0) {
          const lastThink = allThinkContainers[allThinkContainers.length - 1];
          const contentDiv = lastThink.querySelector(".think-content");
          let buffer = contentDiv.textContent + content;
          contentDiv.innerHTML = parseContent(buffer);

          if (!hide) {
            contentDiv.classList.add("visible");
            lastThink.querySelector(".toggle-icon").textContent = "▼";
            lastThink.dataset.visible = "true";
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

  function handleThink(content, hide) {
    const thinkContainer = document.createElement("div");
    thinkContainer.className = "think-container";
    thinkContainer.innerHTML = `
      <div class="think-toggle">
        <span class="toggle-icon">▶</span>
        <span class="toggle-text">Thought Process</span>
      </div>
      <div class="think-content">${parseContent(content)}</div>
    `;
    messagesContainer.appendChild(thinkContainer);
    allThinkContainers.push(thinkContainer);

    const toggle = thinkContainer.querySelector(".think-toggle");
    const contentDiv = thinkContainer.querySelector(".think-content");
    let isVisible = false;

    toggle.addEventListener("click", () => {
      isVisible = !isVisible;
      contentDiv.classList.toggle("visible");
      toggle.querySelector(".toggle-icon").textContent = isVisible ? "▼" : "▶";
      thinkContainer.dataset.visible = isVisible.toString();
    });

    if (!hide) {
      contentDiv.classList.add("visible");
      toggle.querySelector(".toggle-icon").textContent = "▼";
      thinkContainer.dataset.visible = "true";
    }

    hljs.highlightAllUnder(contentDiv);
    scrollToBottom();
  }

  function handleAnswer(content) {
    currentAiMessage = createMessageElement(parseContent(content), "ai");
    messagesContainer.appendChild(currentAiMessage);
    scrollToBottom();
  }

  function handleRaw(content) {
    if (!currentAiMessage) {
      currentAiMessage = createMessageElement("", "ai");
      messagesContainer.appendChild(currentAiMessage);
    }
    let buffer = messageBuffers.get(currentAiMessage) || "";
    buffer += content;
    messageBuffers.set(currentAiMessage, buffer);
    currentAiMessage.innerHTML = parseContent(buffer);
    scrollToBottom();
  }

  // Handle initial focus
  input.focus();
})();
