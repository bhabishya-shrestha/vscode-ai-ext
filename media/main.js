(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");

  // Global reference for the answer bubble.
  let answerElement = null;

  // Helper function: parse <think> tags and replace them with toggleable HTML.
  function parseContent(content) {
    // If the entire content is wrapped in <think> tags, unwrap it so it displays.
    if (/^\s*<think>[\s\S]+<\/think>\s*$/.test(content)) {
      content = content.replace(/^\s*<think>\s*|\s*<\/think>\s*$/g, "");
      return marked.parse(content);
    }
    // Otherwise, replace only the <think> parts with a toggleable container.
    const replaced = content.replace(
      /<think>([\s\S]*?)<\/think>/gi,
      (_match, p1) => {
        return `<span class="think-container">
                  <span class="think-toggle">[show thought]</span>
                  <span class="think-content hidden">${p1}</span>
                </span>`;
      }
    );
    return marked.parse(replaced);
  }

  // Adds a regular (non-answer) chat message.
  function addMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", role);
    messageElement.innerHTML = parseContent(content);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
  }

  // Creates the final answer bubble.
  function addAnswerMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", role);
    messageElement.innerHTML = parseContent(content);
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
  }

  // Updates the final answer bubble's content.
  function updateAnswerMessage(content) {
    if (answerElement) {
      answerElement.innerHTML = parseContent(content);
    }
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Sends the user's message to the extension.
  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
      // Reset the answer bubble for the next response.
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

  // Listen for messages from the extension.
  window.addEventListener("message", (event) => {
    const { command, content, role } = event.data;
    switch (command) {
      case "addMessage":
        addMessage(content, role);
        break;
      case "addAnswerMessage":
        // Create the answer bubble (for hide-thinking mode).
        answerElement = addAnswerMessage(content, role);
        scrollToBottom();
        break;
      case "appendResponse":
        // Live mode: update a single answer bubble.
        if (!answerElement) {
          answerElement = addAnswerMessage(content, "ai");
        } else {
          updateAnswerMessage(content);
        }
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

  // Use event delegation for toggling the "think" content.
  document.addEventListener("click", function (event) {
    if (event.target.classList.contains("think-toggle")) {
      const element = event.target;
      const thinkContent = element.nextElementSibling;
      if (thinkContent.classList.contains("hidden")) {
        thinkContent.classList.remove("hidden");
        element.textContent = "[hide thought]";
      } else {
        thinkContent.classList.add("hidden");
        element.textContent = "[show thought]";
      }
    }
  });
})();
