import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import Ollama from "ollama";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  structure?: MessageStructure[];
}

interface MessageStructure {
  type: "think" | "answer" | "raw";
  content: string;
}

class ChatHistory {
  private messages: ChatMessage[] = [];
  private readonly storageKey = "stella-chat-history";

  async saveToStorage(context: vscode.ExtensionContext) {
    await context.globalState.update(this.storageKey, this.messages);
  }

  async loadFromStorage(context: vscode.ExtensionContext) {
    const stored = context.globalState.get<ChatMessage[]>(this.storageKey, []);
    this.messages = stored;
    return this.messages;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  addMessage(message: ChatMessage) {
    this.messages.push(message);
  }

  clear() {
    this.messages = [];
  }
}

export class StellaViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private chatHistory: ChatHistory;
  private isGenerating = false;
  private currentAbortController?: AbortController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.chatHistory = new ChatHistory();
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getWebviewContent();

    // Load chat history
    await this.chatHistory.loadFromStorage(this.context);
    await this.rebuildChatHistory();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "chat":
          if (this.isGenerating) {
            vscode.window.showWarningMessage(
              "Please wait for the current response to complete"
            );
            return;
          }
          await this.handleChatMessage(message.text);
          break;
        case "abort":
          this.currentAbortController?.abort();
          this.isGenerating = false;
          this.view?.webview.postMessage({ command: "hideTyping" });
          break;
        case "clearHistory":
          this.chatHistory.clear();
          await this.chatHistory.saveToStorage(this.context);
          this.view?.webview.postMessage({ command: "clearHistory" });
          break;
      }
    });
  }

  private async rebuildChatHistory() {
    if (!this.view) {
      return;
    }

    this.view.webview.postMessage({ command: "clearHistory" });
    const messages = this.chatHistory.getMessages();

    for (const msg of messages) {
      if (msg.role === "assistant" && msg.structure) {
        this.view.webview.postMessage({
          command: "addStructuredMessage",
          content: msg.content,
          structure: msg.structure,
        });
      } else {
        this.view.webview.postMessage({
          command: "addMessage",
          role: msg.role,
          content: msg.content,
        });
      }
    }
  }

  private async getProjectContext(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return "";
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = {
      include: ["**/*.js", "**/*.ts", "**/*.json", "**/*.css", "**/*.html"],
      exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      maxFiles: 25,
    };

    const files = await vscode.workspace.findFiles(
      `{${config.include.join(",")}}`,
      `{${config.exclude.join(",")}}`
    );

    let context = "Current Project Structure:\n```\n";
    files.slice(0, config.maxFiles).forEach((file) => {
      context += `${path.relative(rootPath, file.fsPath)}\n`;
    });
    context += "```\n";

    try {
      const packageJson = await fs.promises.readFile(
        path.join(rootPath, "package.json"),
        "utf-8"
      );
      context += `Package.json Dependencies:\n\`\`\`json\n${packageJson}\n\`\`\`\n`;
    } catch {
      context += "No package.json found\n";
    }

    return context;
  }

  private async handleChatMessage(userPrompt: string) {
    if (!this.view) {
      return;
    }

    const config = vscode.workspace.getConfiguration("stella");
    const model = config.get<string>("model", "deepseek-r1:70b");
    const hideThinking = config.get<boolean>("hideThinking", true);

    try {
      this.isGenerating = true;
      this.currentAbortController = new AbortController();

      const userMessage: ChatMessage = { role: "user", content: userPrompt };
      this.chatHistory.addMessage(userMessage);
      this.view.webview.postMessage({
        command: "addMessage",
        role: "user",
        content: userPrompt,
      });

      this.view.webview.postMessage({ command: "showTyping" });

      const systemPrompt = `You are Stella, the AI Coding Partner. Follow these rules:
1. Provide expert-level code assistance with clear explanations
2. Format responses in GitHub Flavored Markdown
3. When creating new projects:
  - Start with core files (package.json, main source files)
  - Follow language/framework conventions
  - Include necessary configuration files
  - Create proper directory structure`;

      const projectContext = await this.getProjectContext();
      const systemMessage = `${systemPrompt}\n\n${projectContext}`;

      let fullResponse = "";
      let buffer = "";
      let currentState: "thinking" | "answering" | "none" = "none";
      let thinkBuffer = "";
      let answerBuffer = "";
      const structure: MessageStructure[] = [];

      const stream = await Ollama.chat({
        model,
        messages: [
          { role: "system", content: systemMessage },
          ...this.chatHistory.getMessages(),
        ],
        stream: true,
        options: {
          temperature: 0.5,
          num_ctx: 8192,
        },
      });

      for await (const chunk of stream) {
        if (this.currentAbortController?.signal.aborted) {
          break;
        }

        fullResponse += chunk.message.content;
        buffer += chunk.message.content;

        // Process message structure
        while (true) {
          if (currentState === "none") {
            const thinkIndex = buffer.indexOf("<think>");
            const answerIndex = buffer.indexOf("<answer>");

            if (thinkIndex !== -1) {
              this.view.webview.postMessage({ command: "startThink" });
              buffer = buffer.slice(thinkIndex + 7);
              currentState = "thinking";
              continue;
            }

            if (answerIndex !== -1) {
              this.view.webview.postMessage({ command: "startAnswer" });
              buffer = buffer.slice(answerIndex + 8);
              currentState = "answering";
              continue;
            }
          }

          if (currentState === "thinking") {
            const endIndex = buffer.indexOf("</think>");
            if (endIndex !== -1) {
              thinkBuffer += buffer.slice(0, endIndex);
              structure.push({ type: "think", content: thinkBuffer });
              this.view.webview.postMessage({
                command: "appendThink",
                content: thinkBuffer,
                hide: hideThinking,
              });
              thinkBuffer = "";
              buffer = buffer.slice(endIndex + 8);
              currentState = "none";
            } else {
              thinkBuffer += buffer;
              buffer = "";
              break;
            }
          }

          if (currentState === "answering") {
            const endIndex = buffer.indexOf("</answer>");
            if (endIndex !== -1) {
              answerBuffer += buffer.slice(0, endIndex);
              structure.push({ type: "answer", content: answerBuffer });
              this.view.webview.postMessage({
                command: "appendAnswer",
                content: answerBuffer,
              });
              answerBuffer = "";
              buffer = buffer.slice(endIndex + 9);
              currentState = "none";
            } else {
              answerBuffer += buffer;
              buffer = "";
              break;
            }
          }

          if (currentState === "none") {
            break;
          }
        }

        if (buffer.length > 0 && currentState === "none") {
          structure.push({ type: "raw", content: buffer });
          this.view.webview.postMessage({
            command: "appendRaw",
            content: buffer,
          });
          buffer = "";
        }
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: fullResponse,
        structure,
      };
      this.chatHistory.addMessage(assistantMessage);
      await this.chatHistory.saveToStorage(this.context);
    } catch (err: any) {
      this.view.webview.postMessage({
        command: "showError",
        content: "Stella is unavailable. Check Ollama server.",
      });
    } finally {
      this.isGenerating = false;
      this.currentAbortController = undefined;
      this.view.webview.postMessage({ command: "hideTyping" });
    }
  }

  private getWebviewContent(): string {
    const nonce = getNonce();
    const scriptUri = this.getResourceUri("media/main.js");
    const styleUri = this.getResourceUri("media/main.css");
    const markedUri = this.getResourceUri("media/marked.min.js");
    const highlightUri = this.getResourceUri("media/highlight.min.js");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
      this.view!.webview.cspSource
    } data:; script-src 'nonce-${nonce}'; style-src ${
      this.view!.webview.cspSource
    } 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <script nonce="${nonce}" src="${markedUri}"></script>
    <script nonce="${nonce}" src="${highlightUri}"></script>
    <title>Stella AI</title>
</head>
<body>
    <div class="chat-container">
        <div id="messages"></div>
        <div id="typing-indicator" class="hidden">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
        <div class="input-container">
            <textarea id="input" placeholder="Ask Stella about your code..." rows="1"></textarea>
            <button id="sendBtn" title="Send message" aria-label="Send message"></button>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getResourceUri(resourcePath: string): vscode.Uri {
    return this.view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, resourcePath)
    );
  }
}

function getNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StellaViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("stellaView", provider),

    vscode.commands.registerCommand("stella-ext.clearHistory", () => {
      provider["chatHistory"].clear();
      vscode.window.showInformationMessage("Chat history cleared");
    }),

    vscode.commands.registerCommand("stella-ext.toggleHideThinking", () => {
      const config = vscode.workspace.getConfiguration("stella");
      const currentValue = config.get<boolean>("hideThinking", true);
      config.update("hideThinking", !currentValue, true);
    })
  );

  return {
    async toggleHideThinking() {
      const config = vscode.workspace.getConfiguration("stella");
      const current = config.get("hideThinking");
      await config.update(
        "hideThinking",
        !current,
        vscode.ConfigurationTarget.Global
      );
    },
  };
}
