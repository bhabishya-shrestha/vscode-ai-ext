import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

export class FileHandler {
  private workspaceRoot: string;

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error("No workspace open");
    }
    this.workspaceRoot = workspaceFolders[0].uri.fsPath;
  }

  private isSafePath(filePath: string): boolean {
    const relative = path.relative(this.workspaceRoot, filePath);
    return (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.includes("../")
    );
  }

  async ensureDirectoryExists(filePath: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch (err) {
      // Check if it's an Error object and has a 'code' property
      if (typeof err === "object" && err !== null && "code" in err) {
        const errorWithCode = err as { code: string };
        if (!["EEXIST"].includes(errorWithCode.code)) {
          throw err;
        }
      } else {
        // Re-throw non-standard errors
        throw err;
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<void | never> {
    const safePath = path.join(this.workspaceRoot, filePath);

    if (!this.isSafePath(safePath)) {
      throw new Error("Invalid file path");
    }

    try {
      await this.ensureDirectoryExists(safePath);
      await fs.writeFile(safePath, content);
      return;
    } catch (err) {
      console.error(`Failed to write file ${filePath}:`, err);
      throw err;
    }
  }

  async deleteFile(filePath: string): Promise<void | never> {
    const safePath = path.join(this.workspaceRoot, filePath);

    if (!this.isSafePath(safePath)) {
      throw new Error("Invalid file path");
    }

    try {
      await fs.unlink(safePath);
      return;
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err);
      throw err;
    }
  }

  async copyFile(source: string, destination: string): Promise<void | never> {
    try {
      await this.ensureDirectoryExists(destination);
      const content = await fs.readFile(source, "utf-8");
      await this.writeFile(destination, content);
      return;
    } catch (err) {
      console.error(`Failed to copy file ${source} to ${destination}:`, err);
      throw err;
    }
  }
}
