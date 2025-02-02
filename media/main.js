(function () {
  const vscode = acquireVsCodeApi();
  const messagesContainer = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const typingIndicator = document.getElementById("typing-indicator");
  let currentAiMessage = null;

  // Handle incoming messages from the extension
  window.addEventListener("message", (event) => {
    const { command, content, role } = event.data;

    switch (command) {
      case "addMessage":
        addMessage(content, role);
        break;
      case "appendResponse":
        if (!currentAiMessage) {
          currentAiMessage = addMessage(content, "ai");
        } else {
          currentAiMessage.innerHTML = marked.parse(content);
        }
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
        currentAiMessage = null;
        break;
    }
  });

  // Add a new message to the chat
  function addMessage(content, role) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", role);

    if (role === "error") {
      messageElement.innerHTML = `<div class="error-message">${content}</div>`;
    } else {
      messageElement.innerHTML = marked.parse(content);
    }

    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
  }

  // Scroll to the bottom of the chat
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Send message to the extension
  function sendMessage() {
    const text = input.value.trim();
    if (text) {
      vscode.postMessage({ command: "chat", text });
      input.value = "";
      currentAiMessage = null; // Reset for new response
    }
  }

  // Event listeners
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Focus the input when the webview loads
  input.focus();
})();
