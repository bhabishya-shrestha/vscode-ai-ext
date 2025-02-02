import * as vscode from "vscode";
import Ollama from "ollama";

class StellaViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      console.log("📥 Received message from webview:", message);

      if (message.command === "chat") {
        const userPrompt = message.text;
        let responseText = "";
        let insideThinkTag = false;
        let isFirstChunk = true;

        try {
          console.log("🚀 Sending request to Ollama...");

          const systemMessage = `You are Stella, the Fairy of the Shining Sun from Winx Club, now transformed into an advanced AI assistant. 
          Your responses should be **like how Stella from Winx Club would respond. Be a little sassy, like how Stella is and little privileged. But still answer the question in the end.**  
          DO NOT include explanations of your thought process, internal reasoning, or any meta-commentary.  
          DO NOT include '<think>' sections.  
          DO NOT include any internal reasoning or explanations.
          DO NOT include any intermediate steps or thought processes.
          Only provide focused, helpful answers.
          Your style is confident, helpful, and engaging while keeping responses **focused on the query.**`;

          const streamResponse = await Ollama.chat({
            model: "deepseek-r1:32b",
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: userPrompt },
            ],
            stream: true,
          });

          console.log("✅ Response received from Ollama, streaming...");

          for await (const part of streamResponse) {
            let chunk = part.message.content;

            let filteredChunk = "";
            let i = 0;

            while (i < chunk.length) {
              if (!insideThinkTag) {
                let thinkOpen = chunk.indexOf("<think>", i);
                if (thinkOpen !== -1) {
                  filteredChunk += chunk.substring(i, thinkOpen);
                  insideThinkTag = true;
                  i = thinkOpen + 7;
                  continue;
                } else {
                  filteredChunk += chunk.substring(i);
                  break;
                }
              } else {
                let thinkClose = chunk.indexOf("</think>", i);
                if (thinkClose !== -1) {
                  insideThinkTag = false;
                  i = thinkClose + 8;
                } else {
                  break;
                }
              }
            }

            if (isFirstChunk) {
              filteredChunk = filteredChunk.trimStart();
              isFirstChunk = false;
            }

            responseText += filteredChunk;

            if (filteredChunk) {
              this._view?.webview.postMessage({
                command: "chatResponse",
                text: responseText,
              });
            }
          }

          this._view?.webview.postMessage({
            command: "chatResponse",
            text: responseText.trim(),
          });
        } catch (err: any) {
          console.error("❌ Error during chat processing:", err);
          let errorMessage = "Oops! Something went wrong.";

          if (err.message.includes('model "deepseek-" not found')) {
            errorMessage =
              "⚠️ The DeepSeek model is not installed. Please run:\n\n `ollama pull deepseek-your-model` \n\n in your terminal and try again.";
          }

          this._view?.webview.postMessage({
            command: "chatResponse",
            text: errorMessage,
          });
        }
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Stella extension is now active!");

  const provider = new StellaViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("stellaView", provider)
  );
}

export function deactivate() {
  console.log("Stella extension deactivated.");
}

function getWebviewContent(): string {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: sans-serif; margin: 1rem; }
      #prompt { width: 100%; box-sizing: border-box; padding: 8px; font-size: 16px; }
      #response { border: 1px solid #ccc; margin-top: 1rem; padding: 0.5rem; min-height: 5rem; font-size: 16px; }
      #askBtn { margin-top: 10px; padding: 8px 16px; cursor: pointer; font-size: 16px; }
    </style>
  </head>
  <body>
    <h2> Stella Chat </h2>
    <textarea id="prompt" rows="3" placeholder="Ask Stella something..."></textarea> <br />
    <button id="askBtn">Ask Stella</button>
    <div id="response">Waiting for input...</div>

    <script>
      const vscode = acquireVsCodeApi();
      const promptInput = document.getElementById("prompt");
      const askButton = document.getElementById("askBtn");

      function sendMessage() {
        const text = promptInput.value.trim();
        if (text) {
          vscode.postMessage({ command: "chat", text });
          promptInput.value = ""; // Clear input after sending
        }
      }

      // Send message when clicking the button
      askButton.addEventListener("click", sendMessage);

      // Handle Enter & Shift+Enter in the textarea
      promptInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          if (!event.shiftKey) {
            event.preventDefault(); // Prevent new line
            sendMessage();
          }
          // If Shift+Enter, let it create a new line (default behavior)
        }
      });

      window.addEventListener('message', event => {
        const { command, text } = event.data;
        if (command === "chatResponse") {
          document.getElementById('response').innerText = text;
        }
      });
    </script>
  </body>
  </html>
  `;
}
