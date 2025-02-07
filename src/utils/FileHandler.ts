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
    const normalizedPath = path.normalize(filePath);
    const relative = path.relative(this.workspaceRoot, normalizedPath);
    return (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.includes("..")
    );
  }

  async ensureDirectoryExists(filePath: string): Promise<void> {
    const safePath = path.join(this.workspaceRoot, path.dirname(filePath));

    if (!this.isSafePath(safePath)) {
      throw new Error("Invalid directory path");
    }

    try {
      await fs.mkdir(safePath, { recursive: true });
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err) {
        const errorWithCode = err as { code: string };
        if (errorWithCode.code !== "EEXIST") {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const safePath = path.join(this.workspaceRoot, filePath);

    if (!this.isSafePath(safePath)) {
      throw new Error("Invalid file path");
    }

    try {
      await this.ensureDirectoryExists(safePath);
      await fs.writeFile(safePath, content);
    } catch (err) {
      console.error(`Failed to write file ${filePath}:`, err);
      throw err;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const safePath = path.join(this.workspaceRoot, filePath);

    if (!this.isSafePath(safePath)) {
      throw new Error("Invalid file path");
    }

    try {
      await fs.unlink(safePath);
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err);
      throw err;
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const safeSource = path.join(this.workspaceRoot, source);
    const safeDestination = path.join(this.workspaceRoot, destination);

    if (!this.isSafePath(safeSource) || !this.isSafePath(safeDestination)) {
      throw new Error("Invalid source or destination path");
    }

    try {
      await this.ensureDirectoryExists(safeDestination);
      const content = await fs.readFile(safeSource, "utf-8");
      await this.writeFile(destination, content);
    } catch (err) {
      console.error(`Failed to copy file ${source} to ${destination}:`, err);
      throw err;
    }
  }
}
