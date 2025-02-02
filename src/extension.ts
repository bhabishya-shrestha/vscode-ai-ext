import Ollama from "ollama";
import * as vscode from "vscode";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

class StellaViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _chatHistory: ChatMessage[] = [];
  private _isGenerating = false;
  private _currentAbortController?: AbortController;

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

    webviewView.webview.html = this._getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      switch (message.command) {
        case "chat":
          if (this._isGenerating) {
            vscode.window.showWarningMessage(
              "Please wait for the current response to complete"
            );
            return;
          }
          await this._handleChatMessage(webviewView, message.text);
          break;
        case "abort":
          this._currentAbortController?.abort();
          this._isGenerating = false;
          break;
        case "clearHistory":
          this._chatHistory = [];
          webviewView.webview.postMessage({ command: "clearHistory" });
          break;
      }
    });
  }

  private async _handleChatMessage(
    webviewView: vscode.WebviewView,
    userPrompt: string
  ) {
    const config = vscode.workspace.getConfiguration("stella");
    const model = config.get<string>("model", "deepseek-r1:32b");
    const baseUrl = config.get<string>("ollamaUrl", "http://localhost:11434");
    const hideThinking = config.get<boolean>("hideThinking", false);

    console.log("🔍 Connecting to Ollama at:", baseUrl);
    console.log("📡 Model being used:", model);

    try {
      this._isGenerating = true;
      this._currentAbortController = new AbortController();

      // Add user message to chat history
      this._chatHistory.push({ role: "user", content: userPrompt });
      webviewView.webview.postMessage({
        command: "addMessage",
        role: "user",
        content: userPrompt,
      });

      if (!hideThinking) {
        // Add typing indicator
        webviewView.webview.postMessage({ command: "showTyping" });
      }

      const systemPrompt = `You are Stella, the Fairy of the Shining Sun from Winx Club. Respond as Stella would:
      - Be confident and slightly sassy
      - Use emojis occasionally 🌞
      - Keep responses concise but helpful
      - Format technical answers with markdown
      - Never apologize for being an AI`;

      let aiResponse = "";
      let lastUpdate = Date.now();

      console.log("🛠 Sending API request to Ollama...");

      const stream = await Ollama.chat({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...this._chatHistory.map((msg) => ({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content,
          })),
        ],
        stream: true,
        options: {
          temperature: 0.7,
          seed: 42,
        },
      });

      console.log("✅ API request sent successfully.");

      if (!hideThinking) {
        webviewView.webview.postMessage({
          command: "appendResponse",
          content: "", // Start with empty response
        });
      }

      for await (const chunk of stream) {
        if (this._currentAbortController?.signal.aborted) {
          break;
        }

        aiResponse += chunk.message.content;

        // Throttle UI updates to 60fps
        if (!hideThinking && Date.now() - lastUpdate > 16) {
          webviewView.webview.postMessage({
            command: "appendResponse",
            content: aiResponse, // Keep appending text
          });
          lastUpdate = Date.now();
        }
      }

      // Final update to ensure full response is shown
      webviewView.webview.postMessage({
        command: "appendResponse",
        content: aiResponse,
      });

      this._chatHistory.push({ role: "ai", content: aiResponse });
    } catch (err: any) {
      console.error("🔥 API Error:", err);

      let errorMessage =
        "Stella is unavailable. Please check your Ollama server.";
      if (err.message.includes("model not found")) {
        errorMessage = `Model not found. Please install it using: ollama pull ${model}`;
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage = `Could not connect to Ollama at ${baseUrl}. Make sure Ollama is running.`;
      }

      webviewView.webview.postMessage({
        command: "showError",
        content: errorMessage,
      });
    } finally {
      this._isGenerating = false;
      this._currentAbortController = undefined;
      webviewView.webview.postMessage({ command: "hideTyping" });
    }
  }

  private _getWebviewContent(): string {
    const nonce = this._getNonce();
    const scriptUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const styleUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.css")
    );
    const markedUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "marked.min.js")
    );

    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                              img-src ${this._view!.webview.cspSource} data:;
                              script-src 'nonce-${nonce}';
                              style-src ${
                                this._view!.webview.cspSource
                              } 'unsafe-inline';
                              font-src ${this._view!.webview.cspSource}">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" href="${styleUri}">
                <script nonce="${nonce}" src="${markedUri}"></script>
                <title>Stella AI</title>
            </head>
            <body>
                <div class="chat-container">
                    <div id="messages"></div>
                    <div id="typing-indicator" class="hidden">
                      <div class="dot-flashing"></div>
                    </div>
                    <div class="input-container">
                        <textarea 
                            id="input" 
                            placeholder="Spill the tea! What do you want to know from your favorite fairy fashionista?" 
                            rows="3"
                            ${this._isGenerating ? "disabled" : ""}
                        ></textarea>
                        <button id="sendBtn" class="${
                          this._isGenerating ? "disabled" : ""
                        }">
                            ${this._isGenerating ? "⏹ Stop" : "✨ Send"}
                        </button>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
  }

  private _getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StellaViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("stellaView", provider),
    vscode.commands.registerCommand("stella-ext.clearHistory", () => {
      vscode.window.showInformationMessage("Chat history cleared");
    }),
    vscode.commands.registerCommand("stella-ext.toggleHideThinking", () => {
      const config = vscode.workspace.getConfiguration("stella");
      const currentValue = config.get<boolean>("hideThinking", false);
      config.update("hideThinking", !currentValue, true);
      vscode.window.showInformationMessage(
        `Hide thinking portion ${!currentValue ? "enabled" : "disabled"}`
      );
    })
  );
}

export function deactivate() {}
