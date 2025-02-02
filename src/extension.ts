import * as vscode from "vscode";
import Ollama from "ollama";

let panel: vscode.WebviewPanel | undefined; // Store webview globally

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "stella-ext" is now active!');

  function openStellaPanel() {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      return;
    }

    panel = vscode.window.createWebviewPanel(
      "stella",
      "Deep Seek Chat",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = getWebviewContent();

    panel.webview.onDidReceiveMessage(async (message: any) => {
      console.log("📥 Received message from webview:", message);

      if (message.command === "chat") {
        const userPrompt = message.text;
        let responseText = "";
        let insideThinkTag = false;
        let isFirstChunk = true; // ✅ Track the first chunk

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

            // Process the chunk to remove <think> sections
            let filteredChunk = "";
            let i = 0;

            while (i < chunk.length) {
              if (!insideThinkTag) {
                let thinkOpen = chunk.indexOf("<think>", i);
                if (thinkOpen !== -1) {
                  filteredChunk += chunk.substring(i, thinkOpen); // Add only content before <think>
                  insideThinkTag = true;
                  i = thinkOpen + 7; // Move past "<think>"
                  continue;
                } else {
                  filteredChunk += chunk.substring(i);
                  break;
                }
              } else {
                let thinkClose = chunk.indexOf("</think>", i);
                if (thinkClose !== -1) {
                  insideThinkTag = false;
                  i = thinkClose + 8; // Move past "</think>"
                } else {
                  break; // Still inside <think>, discard this part
                }
              }
            }

            // ✅ Trim only the first chunk to avoid space issues
            if (isFirstChunk) {
              filteredChunk = filteredChunk.trimStart();
              isFirstChunk = false;
            }

            responseText += filteredChunk;

            if (filteredChunk) {
              panel?.webview.postMessage({
                command: "chatResponse",
                text: responseText, // Stream the updated response
              });
            }
          }

          // ✅ Ensure the final response is fully cleaned before sending
          panel?.webview.postMessage({
            command: "chatResponse",
            text: responseText.trim(), // Final trim for any extra space at the end
          });
        } catch (err: any) {
          console.error("❌ Error during chat processing:", err);
          let errorMessage = "Oops! Something went wrong.";

          if (err.message.includes('model "deepseek-" not found')) {
            errorMessage =
              "⚠️ The DeepSeek model is not installed. Please run:\n\n `ollama pull deepseek-your-model` \n\n in your terminal and try again.";
          }

          panel?.webview.postMessage({
            command: "chatResponse",
            text: errorMessage,
          });
        }
      }
    });

    panel.onDidDispose(() => {
      console.log("⚠️ Webview panel closed, clearing reference.");
      panel = undefined;
    });
  }

  // ✅ Automatically open Stella on activation
  openStellaPanel();

  // ✅ Still allow manual opening via command
  const disposable = vscode.commands.registerCommand(
    "stella-ext.startStella",
    openStellaPanel
  );

  context.subscriptions.push(disposable);
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
		<h2> Stella VS Code Extension </h2>
		<textarea id="prompt" rows="3" placeholder="Politely ask Stella something, then hit enter"></textarea> <br />
		<button id="askBtn">Ask Stella</button>
		<div id="response"></div>

    <script>
      const vscode = acquireVsCodeApi();

      document.getElementById("askBtn").addEventListener("click", () => {
        const text = document.getElementById("prompt").value;
        console.log("🔹 Ask button clicked, sending:", text);
        vscode.postMessage({ command: "chat", text });
      });

      window.addEventListener('message', event => {
        console.log("📥 Received message in webview:", event.data);
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

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("Stella extension deactivated.");
}
