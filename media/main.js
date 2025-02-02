(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  let answerElement = null;

  function parseContent(content) {
    const replaced = content.replace(
      /<think>([\s\S]*?)<\/think>/gi,
      (_match, p1) => {
        return `<div class="think-container">
                  <div class="think-toggle">
                    <span class="toggle-icon">▶</span>
                    <span class="toggle-text">Show thought process</span>
                  </div>
                  <div class="think-content hidden">${marked.parse(
                    p1.trim()
                  )}</div>
                </div>`;
      }
    );
    marked.setOptions({ sanitize: false });
    return marked.parse(replaced);
  }

  function addMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", role);
    messageElement.innerHTML = parseContent(content);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
  }

  function addAnswerMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", role);
    messageElement.innerHTML = parseContent(content);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
  }

  function updateAnswerMessage(content) {
    if (answerElement) {
      answerElement.innerHTML = parseContent(content);
    }
  }

  function scrollToBottom() {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: "smooth",
    });
  }

  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
      answerElement = null;
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  input.focus();

  window.addEventListener("message", (event) => {
    const { command, content, role } = event.data;
    switch (command) {
      case "addMessage":
        addMessage(content, role);
        break;
      case "addAnswerMessage":
        answerElement = addAnswerMessage(content, role);
        scrollToBottom();
        break;
      case "appendResponse":
        if (!answerElement) {
          answerElement = addAnswerMessage("", "ai"); // Initialize with empty content
        }
        updateAnswerMessage(content);
        scrollToBottom();
        break;
      case "updateAnswer":
        updateAnswerMessage(content);
        scrollToBottom();
        break;
      case "showError":
        addMessage(content, "error");
        break;
      case "showTyping":
        typingIndicator.classList.remove("hidden");
        break;
      case "hideTyping":
        typingIndicator.classList.add("hidden");
        break;
      case "clearHistory":
        messagesContainer.innerHTML = "";
        answerElement = null;
        break;
    }
  });

  document.addEventListener("click", function (event) {
    const toggle = event.target.closest(".think-toggle");
    if (toggle) {
      const container = toggle.closest(".think-container");
      const content = container.querySelector(".think-content");
      const icon = container.querySelector(".toggle-icon");
      const text = container.querySelector(".toggle-text");

      container.classList.toggle("expanded");
      content.classList.toggle("hidden");

      if (content.classList.contains("hidden")) {
        text.textContent = "Show thought process";
        icon.textContent = "▶";
      } else {
        text.textContent = "Hide thought process";
        icon.textContent = "▼";
      }
    }
  });
})();
