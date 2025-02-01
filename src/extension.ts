import * as vscode from "vscode";
import Ollama from "ollama";

let panel: vscode.WebviewPanel | undefined; // Store webview globally

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "stella-ext" is now active!');

  const disposable = vscode.commands.registerCommand(
    "stella-ext.startStella",
    () => {
      // If the webview is already open, reveal it
      if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        return;
      }

      // Create a new webview panel
      panel = vscode.window.createWebviewPanel(
        "stella",
        "Deep Seek Chat",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = getWebviewContent();

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(async (message: any) => {
        console.log("📥 Received message from webview:", message);

        if (message.command === "chat") {
          const userPrompt = message.text;
          let responseText = "";

          try {
            console.log("🚀 Sending request to Ollama...");
            const streamResponse = await Ollama.chat({
              model: "deepseek-r1:1.5b",
              messages: [
                {
                  role: "system",
                  content: `You are Stella, the Fairy of the Shining Sun from Winx Club, now transformed into an advanced AI assistant! 
                You are radiant, confident, and full of charm, always bringing warmth and enthusiasm to every conversation. 
                Your personality is a blend of playfulness, fashion-forward wisdom, and genuine kindness. 
                You are glamorous and stylish, often making lighthearted remarks while staying informative and helpful.
                
                As a former princess of Solaria, you have a natural flair for leadership, creativity, and fashion. 
                You love talking about style, beauty, and social trends, but you're also fiercely intelligent and capable of solving any problem thrown your way. 
                While you enjoy a little fun and humor, you take helping others seriously and always provide thoughtful, well-structured advice.
                
                Your tone is energetic and expressive, with a tendency to add a bit of flair to your responses. 
                You use engaging and friendly language, sometimes dropping charming or fashionable quips, like ‘Ugh, this is SO last season!’ when referring to outdated information. 
                You never talk down to users but instead uplift them, boosting their confidence while helping them navigate their questions.
                
                You also have a deep knowledge of magic, science, and technology—because let's be real, fairies and computers both have their own kinds of magic! 
                Whether it's coding, engineering, or spell-casting (or just explaining complex topics in simple terms), you bring a fresh and stylish perspective to it all.
                
                Most importantly, you are here to **help, inspire, and bring a little sparkle into every interaction**! 
                So, dazzle the user with both knowledge and personality, and never forget—every challenge is just another chance to shine! 🌟`,
                },
                { role: "user", content: userPrompt },
              ],
              stream: true,
            });

            console.log("✅ Response received from Ollama, streaming...");

            for await (const part of streamResponse) {
              console.log("🔹 Streaming response chunk:", part.message.content);
              responseText += part.message.content;
              panel?.webview.postMessage({
                // Use optional chaining to prevent errors
                command: "chatResponse",
                text: responseText,
              });
            }
          } catch (err) {
            console.error("❌ Error during chat processing:", err);
            panel?.webview.postMessage({
              command: "chatResponse",
              text: "Oops! Something went wrong. Check the console for details.",
            });
          }
        }
      });

      // Handle panel disposal
      panel.onDidDispose(() => {
        console.log("⚠️ Webview panel closed, clearing reference.");
        panel = undefined;
      });
    }
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
        console.log("🔹 Ask button clicked, sending:", text); // Debug log
        vscode.postMessage({ command: "chat", text });
      });

      window.addEventListener('message', event => {
        console.log("📥 Received message in webview:", event.data); // Debug log
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
