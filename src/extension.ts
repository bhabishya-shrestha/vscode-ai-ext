import Ollama from "ollama";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface ChatMessage {
  role: "user" | "assistant" | "system";
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
  }

  private async _handleFileOperations(response: string) {
    const config = vscode.workspace.getConfiguration("stella");
    if (!config.get<boolean>("allowFileOperations", false)) {
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    const readRegex = /<read-file>(.*?)<\/read-file>/gs;
    let readMatch;
    while ((readMatch = readRegex.exec(response)) !== null) {
      const filePath = path.join(rootPath, readMatch[1]);
      if (this._isSafePath(rootPath, filePath)) {
        try {
          const content = await fs.promises.readFile(filePath, "utf-8");
          this._chatHistory.push({
            role: "system",
            content: `FILE CONTENT: ${readMatch[1]}\n\`\`\`\n${content}\n\`\`\``,
          });
        } catch (error) {
          this._chatHistory.push({
            role: "system",
            content: `ERROR READING FILE: ${readMatch[1]} - ${error}`,
          });
        }
      }
    }

    const writeRegex =
      /<write-file>(.*?)<\/write-file>([\s\S]*?)<\/write-file>/gs;
    const deleteRegex = /<delete-file>(.*?)<\/delete-file>/gs;

    const operations = [];

    let writeMatch;
    while ((writeMatch = writeRegex.exec(response)) !== null) {
      operations.push({
        type: "write",
        path: path.join(rootPath, writeMatch[1]),
        content: writeMatch[2].trim(),
      });
    }

    let deleteMatch;
    while ((deleteMatch = deleteRegex.exec(response)) !== null) {
      operations.push({
        type: "delete",
        path: path.join(rootPath, deleteMatch[1]),
      });
    }

    for (const op of operations) {
      if (this._isSafePath(rootPath, op.path)) {
        const approval = await vscode.window.showWarningMessage(
          `Stella wants to ${op.type} ${path.relative(rootPath, op.path)}`,
          "Approve",
          "Reject"
        );

        if (approval === "Approve") {
          try {
            if (op.type === "write") {
              const content = op.content || "";
              await fs.promises.mkdir(path.dirname(op.path), {
                recursive: true,
              });
              await fs.promises.writeFile(op.path, content);
              vscode.window.showInformationMessage(
                `File written: ${path.relative(rootPath, op.path)}`
              );
            } else if (op.type === "delete") {
              await fs.promises.unlink(op.path);
              vscode.window.showInformationMessage(
                `File deleted: ${path.relative(rootPath, op.path)}`
              );
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Operation failed: ${error}`);
          }
        }
      }
    }
  }

  private _isSafePath(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return (
      !!relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    );
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
      config.exclude.join(",")
    );
    const selectedFiles = files.slice(0, config.maxFiles);

    let context = "Current Project Structure:\n```\n";
    for (const file of selectedFiles) {
      const relativePath = path.relative(rootPath, file.fsPath);
      context += `${relativePath}\n`;
    }
    context += "```\n";

    try {
      const packageJson = await fs.promises.readFile(
        path.join(rootPath, "package.json"),
        "utf-8"
      );
      context += `Package.json Dependencies:\n\`\`\`json\n${packageJson}\n\`\`\`\n`;
    } catch (error) {
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
                            3. For complex answers, structure your response as:
                              <think>
                              Step-by-step reasoning...
                              </think>
                              <answer>
                              Final answer with code and explanation
                              </answer>
                            4. Always wrap code blocks with \`\`\` and language identifier
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

      const stream = await Ollama.chat({
        model,
        messages: [
          { role: "system", content: systemMessage },
          ...this._chatHistory,
        ],
        stream: true,
        options: {
          temperature: 0.5,
          num_ctx: 4096,
        } as any,
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
          webviewView.webview.postMessage({
            command: "appendRaw",
            content: buffer,
          });
          buffer = "";
        }
      }

      this._chatHistory.push({ role: "assistant", content: fullResponse });
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
    const scriptUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const styleUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.css")
    );
    const markedUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "marked.min.js")
    );
    const hljsUri = this._view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "highlight.min.js")
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
    <script nonce="${nonce}" src="${hljsUri}"></script>
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
      provider["_chatHistory"] = [];
      vscode.window.showInformationMessage("Chat history cleared");
    }),
    vscode.commands.registerCommand("stella-ext.toggleHideThinking", () => {
      const config = vscode.workspace.getConfiguration("stella");
      const currentValue = config.get<boolean>("hideThinking", true);
      config.update("hideThinking", !currentValue, true);
    })
  );
}
