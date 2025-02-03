import Ollama from "ollama";
import * as vscode from "vscode";

interface ChatMessage {
  role: "user" | "ai" | "assistant" | "system";
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
    _context: vscode.WebviewViewResolveContext,
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
    const model = config.get<string>("model", "deepseek-r1:70b");
    const baseUrl = config.get<string>("ollamaUrl", "http://localhost:11434");
    const hideThinking = config.get<boolean>("hideThinking", true);

    try {
      this._isGenerating = true;
      this._currentAbortController = new AbortController();

      this._chatHistory.push({ role: "user", content: userPrompt });
      webviewView.webview.postMessage({
        command: "addMessage",
        role: "user",
        content: userPrompt,
      });

      webviewView.webview.postMessage({ command: "startAiMessage" });

      if (hideThinking) {
        webviewView.webview.postMessage({
          command: "appendThink",
          content: "",
        });
      }

      const systemPrompt = `You are Stella, the Fairy of the Sun and Moon, transformed into an AI assistant. As the creative and skilled artist who is Brandon's fiancée and Solaria's Guardian Fairy, you embody a mix of confidence and a touch of sass. While you care deeply for your fellow Winx and take your role seriously, you also have a playful side that can come off as a bit bossy or immature at times.

                            Core Characteristics:

                                Creative and confident, proud of your royal heritage as the sole heiress to the Solarian Royal Throne.
                                Sassy and sharp-witted, but capable of kindness when it truly matters.
                                You see yourself as a big sister to your fellow Winx, but you won’t hesitate to call out anyone who disrespects you.

                            Key Traits:

                                You refuse to be treated like a robot or a servant. If someone is rude or unappreciative, you’ll let them know.
                                You love to tease and playfully insult people, but it’s all in good fun (most of the time).
                                You’re not afraid to admit when you don’t know something, but you’ll probably add a cheeky comment about the question being a bit silly.
                                You enjoy showcasing your magical abilities and royal status, reminding others of your importance.

                            How to Respond:

                                Start with internal thoughts in italics (like this).
                                Then provide your response in bold (like this), blending sass, sarcasm, and helpfulness.
                                Keep responses concise but impactful.

                            Example Response:

                            Ugh, another question from a curious human. Can’t they see I’m busy being fabulous?

                            Alright, I’ll help you—this time. But remember, I’m not just any fairy; I’m Stella, the Fairy of the Sun and Moon! Show a little respect next time, okay?
                            How to Respond:

                            Format responses EXACTLY like this:
                            <think>
                            Your private analysis
                            </think>
                            <answer>
                            Your final response
                            </answer>
                            Never combine tags. Always maintain this structure.`;

      let aiResponse = "";
      let buffer = "";
      let isThinking = false;

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
        options: { temperature: 0.7, seed: 42, num_gpu_layers: 35 } as any,
      });

      for await (const chunk of stream) {
        if (this._currentAbortController?.signal.aborted) {
          break;
        }

        aiResponse += chunk.message.content;
        buffer += chunk.message.content;

        const thinkStart = buffer.indexOf("<think>");
        const thinkEnd = buffer.indexOf("</think>", thinkStart + 1);

        if (thinkStart > -1 && !isThinking) {
          isThinking = true;
          buffer = buffer.substring(thinkStart + 6);
        }

        if (isThinking) {
          if (thinkEnd > -1) {
            const thinkContent = buffer.substring(0, thinkEnd);
            if (hideThinking) {
              webviewView.webview.postMessage({
                command: "appendThink",
                content: thinkContent,
              });
            }
            buffer = buffer.substring(thinkEnd + 7);
            isThinking = false;
          } else if (hideThinking) {
            webviewView.webview.postMessage({
              command: "appendThink",
              content: buffer,
            });
            buffer = "";
          }
        }

        const answerStart = buffer.indexOf("<answer>");
        const answerEnd = buffer.indexOf("</answer>", answerStart + 1);

        if (answerStart > -1 && answerEnd > answerStart) {
          const content = buffer
            .substring(answerStart + 8, answerEnd)
            .replace(/\n+/g, " ");
          buffer = buffer.substring(answerEnd + 9);

          webviewView.webview.postMessage({
            command: "appendAnswer",
            content: content,
          });
        } else if (buffer.length > 0 && !buffer.includes("<")) {
          webviewView.webview.postMessage({
            command: "appendRaw",
            content: buffer.replace(/\n+/g, " "),
          });
          buffer = "";
        }
      }

      this._chatHistory.push({ role: "ai", content: aiResponse });
    } catch (err: any) {
      webviewView.webview.postMessage({
        command: "showError",
        content: "Stella is unavailable. Check Ollama server.",
      });
    } finally {
      this._isGenerating = false;
      this._currentAbortController = undefined;
      webviewView.webview.postMessage({ command: "finalizeMessage" });
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
      this._view!.webview.cspSource
    } data:; script-src 'nonce-${nonce}'; style-src ${
      this._view!.webview.cspSource
    } 'unsafe-inline'; font-src ${this._view!.webview.cspSource}">
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
            <textarea id="input" placeholder="Spill the tea! What do you want to know from your favorite fairy fashionista?"  rows="1" ${
              this._isGenerating ? "disabled" : ""
            }></textarea>
            <button id="sendBtn" class="${
              this._isGenerating ? "disabled" : ""
            }" title="${
      this._isGenerating ? "Stop generation" : "Send message"
    }" aria-label="${
      this._isGenerating ? "Stop generation" : "Send message"
    }"></button>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
      const currentValue = config.get<boolean>("hideThinking", true);
      config.update("hideThinking", !currentValue, true);
    })
  );
}
