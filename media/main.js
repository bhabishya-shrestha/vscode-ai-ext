(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  let currentAiMessage = null;
  let markedInitialized = false;
  const messageBuffers = new Map();
  const allThinkContainers = [];

  // Initialize marked with options
  function initializeMarked() {
    if (!markedInitialized) {
      marked.setOptions({
        gfm: true,
        breaks: true,
        smartypants: true,
        highlight: (code, lang) => {
          try {
            return hljs.highlightAuto(code).value;
          } catch (e) {
            return code;
          }
        },
      });
      markedInitialized = true;
    }
  }

  function parseContent(content) {
    initializeMarked();
    try {
      return marked.parse(content);
    } catch (e) {
      console.error("Markdown parsing error:", e);
      return content;
    }
  }

  function createMessageElement(content, role) {
    const messageElement = document.createElement("div");
    messageElement.className = `message ${role}`;
    messageElement.innerHTML = parseContent(content);
    messageBuffers.set(messageElement, content);
    return messageElement;
  }

  function scrollToBottom(smooth = true) {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
      input.style.height = "44px";
      currentAiMessage = null;
      scrollToBottom();
    }
  }

  function resizeInput() {
    // Reset height to minimum to get the correct scrollHeight
    input.style.height = "44px";

    // Set new height based on content, with a maximum height
    const maxHeight = 200;
    const newHeight = Math.min(input.scrollHeight, maxHeight);

    // Only update height if it's different from current
    if (input.offsetHeight !== newHeight) {
      input.style.height = `${newHeight}px`;
    }
  }

  // Event Listeners
  sendBtn.addEventListener("click", sendMessage);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  let resizeTimeout;
  input.addEventListener("input", () => {
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
    resizeTimeout = setTimeout(resizeInput, 10);
  });

  input.addEventListener("input", resizeInput);

  // Handle think containers
  function createThinkContainer(content = "", hide = true) {
    const container = document.createElement("div");
    container.className = "think-container";
    container.innerHTML = `
          <div class="think-toggle">
              <span class="toggle-icon">${hide ? "▶" : "▼"}</span>
              <span class="toggle-text">Thought Process</span>
          </div>
          <div class="think-content ${hide ? "" : "visible"}">${parseContent(
      content
    )}</div>
      `;

    const toggle = container.querySelector(".think-toggle");
    const contentDiv = container.querySelector(".think-content");
    const toggleIcon = toggle.querySelector(".toggle-icon");

    toggle.addEventListener("click", () => {
      const isVisible = contentDiv.classList.toggle("visible");
      toggleIcon.textContent = isVisible ? "▼" : "▶";
      container.dataset.visible = isVisible.toString();
      scrollToBottom();
    });

    return container;
  }

  // Message handling
  window.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.command) {
      case "addMessage":
        const element = createMessageElement(message.content, message.role);
        messagesContainer.appendChild(element);
        scrollToBottom();
        break;

      case "addStructuredMessage":
        if (message.structure) {
          message.structure.forEach((part) => {
            switch (part.type) {
              case "think":
                const container = createThinkContainer(
                  part.content,
                  message.hide
                );
                messagesContainer.appendChild(container);
                allThinkContainers.push(container);
                break;
              case "answer":
                currentAiMessage = createMessageElement(part.content, "ai");
                messagesContainer.appendChild(currentAiMessage);
                break;
              case "raw":
                if (!currentAiMessage) {
                  currentAiMessage = createMessageElement("", "ai");
                  messagesContainer.appendChild(currentAiMessage);
                }
                const buffer =
                  messageBuffers.get(currentAiMessage) + part.content;
                messageBuffers.set(currentAiMessage, buffer);
                currentAiMessage.innerHTML = parseContent(buffer);
                break;
            }
          });
          scrollToBottom();
        }
        break;

      case "showTyping":
        typingIndicator.classList.remove("hidden");
        scrollToBottom();
        break;

      case "hideTyping":
        typingIndicator.classList.add("hidden");
        break;

      case "showError":
        const errorElement = createMessageElement(
          `<div class="error-message">${message.content}</div>`,
          "error"
        );
        messagesContainer.appendChild(errorElement);
        scrollToBottom();
        break;

      case "clearHistory":
        messagesContainer.innerHTML = "";
        allThinkContainers.length = 0;
        currentAiMessage = null;
        break;

      case "startThink":
        const thinkContainer = createThinkContainer("", message.hide);
        messagesContainer.appendChild(thinkContainer);
        allThinkContainers.push(thinkContainer);
        scrollToBottom();
        break;

      case "appendThink":
        if (allThinkContainers.length > 0) {
          const lastThink = allThinkContainers[allThinkContainers.length - 1];
          const contentDiv = lastThink.querySelector(".think-content");
          contentDiv.innerHTML = parseContent(message.content);
          if (!message.hide) {
            contentDiv.classList.add("visible");
            lastThink.querySelector(".toggle-icon").textContent = "▼";
            lastThink.dataset.visible = "true";
          }
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
          const buffer = messageBuffers.get(currentAiMessage) + message.content;
          messageBuffers.set(currentAiMessage, buffer);
          currentAiMessage.innerHTML = parseContent(buffer);
          scrollToBottom();
        }
        break;

      case "appendRaw":
        if (!currentAiMessage) {
          currentAiMessage = createMessageElement("", "ai");
          messagesContainer.appendChild(currentAiMessage);
        }
        const buffer = messageBuffers.get(currentAiMessage) + message.content;
        messageBuffers.set(currentAiMessage, buffer);
        currentAiMessage.innerHTML = parseContent(buffer);
        scrollToBottom();
        break;
    }
  });

  // Initialize
  input.focus();
})();
