import Ollama from "ollama";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FileHandler } from "./utils/FileHandler";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  structure?: MessageStructure[];
}

interface MessageStructure {
  type: "think" | "answer" | "raw";
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
          webviewView.webview.postMessage({ command: "hideTyping" });
          break;
        case "clearHistory":
          this._chatHistory = [];
          webviewView.webview.postMessage({ command: "clearHistory" });
          break;
      }
    });

    this._rebuildChatHistory();
  }

  private async _rebuildChatHistory() {
    if (!this._view) {
      return;
    }

    this._view.webview.postMessage({ command: "clearHistory" });

    for (const msg of this._chatHistory) {
      if (msg.role === "assistant" && msg.structure) {
        this._view.webview.postMessage({
          command: "addStructuredMessage",
          content: msg.content,
          structure: msg.structure,
        });
      } else {
        this._view.webview.postMessage({
          command: "addMessage",
          role: msg.role,
          content: msg.content,
        });
      }
    }
  }

  private async _handleFileOperations(response: string) {
    const fileHandler = new FileHandler();

    try {
      // Improved regex patterns for file operations
      const writeRegex =
        /<write-file>(.*?)<\/write-file>\s*([\s\S]*?)\s*<\/write-file>/g;
      const deleteRegex = /<delete-file>(.*?)<\/delete-file>/g;

      // Process write operations
      let writeMatch;
      while ((writeMatch = writeRegex.exec(response)) !== null) {
        const [_, filePath, content] = writeMatch;
        try {
          await fileHandler.writeFile(filePath.trim(), content.trim());
          this._chatHistory.push({
            role: "system",
            content: `FILE CREATED: ${filePath}`,
          });
        } catch (err: any) {
          this._chatHistory.push({
            role: "system",
            content: `ERROR WRITING FILE: ${filePath} - ${err.message}`,
          });
        }
      }

      // Process delete operations
      let deleteMatch;
      while ((deleteMatch = deleteRegex.exec(response)) !== null) {
        const filePath = deleteMatch[1].trim();
        try {
          await fileHandler.deleteFile(filePath);
          this._chatHistory.push({
            role: "system",
            content: `FILE DELETED: ${filePath}`,
          });
        } catch (err: any) {
          this._chatHistory.push({
            role: "system",
            content: `ERROR DELETING FILE: ${filePath} - ${err.message}`,
          });
        }
      }
    } catch (err) {
      console.error("Error handling file operations:", err);
    }
  }

  private async _getProjectContext(): Promise<string> {
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

  private async _handleChatMessage(
    webviewView: vscode.WebviewView,
    userPrompt: string
  ) {
    const config = vscode.workspace.getConfiguration("stella");
    const model = config.get<string>("model", "deepseek-r1:70b");
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

      webviewView.webview.postMessage({ command: "showTyping" });

      const systemPrompt = `You are Stella, the AI Coding Partner. Follow these rules:
1. Provide expert-level code assistance with clear explanations
2. Format responses in GitHub Flavored Markdown
3. When creating new projects:
  - Start with core files (package.json, main source files)
  - Follow language/framework conventions
  - Include necessary configuration files
  - Create proper directory structure
4. For project generation, use these tags first:
  <project-structure>
  Recommended file paths:
  - src/index.js
  - package.json
  - README.md
  </project-structure>
5. Use these tags for file operations:
  <read-file>path</read-file>
  <write-file>path</write-file>content</write-file>
  <delete-file>path</delete-file>`;

      const projectContext = await this._getProjectContext();
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
          ...this._chatHistory,
        ],
        stream: true,
        options: {
          temperature: 0.5,
          num_ctx: 8192,
        },
      });

      for await (const chunk of stream) {
        if (this._currentAbortController?.signal.aborted) {
          break;
        }

        fullResponse += chunk.message.content;
        buffer += chunk.message.content;

        while (true) {
          if (currentState === "none") {
            const thinkIndex = buffer.indexOf("<think>");
            const answerIndex = buffer.indexOf("<answer>");

            if (thinkIndex !== -1) {
              webviewView.webview.postMessage({ command: "startThink" });
              buffer = buffer.slice(thinkIndex + 7);
              currentState = "thinking";
              continue;
            }

            if (answerIndex !== -1) {
              webviewView.webview.postMessage({ command: "startAnswer" });
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
              webviewView.webview.postMessage({
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
              webviewView.webview.postMessage({
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
          webviewView.webview.postMessage({
            command: "appendRaw",
            content: buffer,
          });
          buffer = "";
        }
      }

      this._chatHistory.push({
        role: "assistant",
        content: fullResponse,
        structure,
      });
      await this._handleFileOperations(fullResponse);
    } catch (err: any) {
      webviewView.webview.postMessage({
        command: "showError",
        content: "Stella is unavailable. Check Ollama server.",
      });
    } finally {
      this._isGenerating = false;
      this._currentAbortController = undefined;
      webviewView.webview.postMessage({ command: "hideTyping" });
    }
  }

  private _getWebviewContent(): string {
    const nonce = this._getNonce();
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
    <link rel="stylesheet" href="${this._getResourceUri("media/main.css")}">
    <script nonce="${nonce}" src="${this._getResourceUri(
      "media/marked.min.js"
    )}"></script>
    <script nonce="${nonce}" src="${this._getResourceUri(
      "media/highlight.min.js"
    )}"></script>
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
    <script nonce="${nonce}" src="${this._getResourceUri(
      "media/main.js"
    )}"></script>
</body>
</html>`;
  }

  private _getResourceUri(filePath: string): vscode.Uri {
    return this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, filePath)
    );
  }

  private _getNonce(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async generateProjectScaffold() {
    try {
      const config = vscode.workspace.getConfiguration("stella");
      await config.update("allowFileOperations", true, true);

      const prompt = `Generate a complete project structure for a [DESCRIBE PROJECT] in this empty folder.
                      Include all necessary configuration files, source files, and documentation.`;

      if (this._view) {
        await this._handleChatMessage(this._view, prompt);
      }
    } catch (err) {
      console.error("Error generating project scaffold:", err);
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new StellaViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("stellaView", provider),
    vscode.commands.registerCommand("stella-ext.clearHistory", () => {
      provider["_chatHistory"] = [];
      vscode.window.showInformationMessage("Chat history cleared");
    }),
    vscode.commands.registerCommand("stella-ext.toggleHideThinking", () => {
      const config = vscode.workspace.getConfiguration("stella");
      const currentValue = config.get<boolean>("hideThinking", true);
      config.update("hideThinking", !currentValue, true);
    }),
    vscode.commands.registerCommand("stella-ext.generateProject", async () => {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("Open a folder first");
        return;
      }
      await provider.generateProjectScaffold();
    })
  );
}
