import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { findSourceMatches, parseSourceRequest } from "./source-uri-core";

export interface SourceUriDependencies {
  projectRoots(): Array<{ name: string; root: string }>;
  exists(file: string): Promise<boolean>;
  pick(items: Array<{ label: string; description: string; file: string }>): PromiseLike<{ file: string } | undefined>;
  open(file: string, line: number, column: number): Promise<void>;
  showError(message: string): void;
}

export function createSourceUriHandler(dependencies: SourceUriDependencies): vscode.UriHandler {
  return {
    async handleUri(uri: vscode.Uri): Promise<void> {
      const request = parseSourceRequest(uri);
      if (!request) { dependencies.showError("The BIF source link is invalid."); return; }
      const matches = await findSourceMatches(request, dependencies.projectRoots(), dependencies.exists);
      if (!matches.length) { dependencies.showError(`BIF source file not found: ${request.file}`); return; }
      const selected = matches.length === 1 ? matches[0] : await dependencies.pick(matches);
      if (!selected) return;
      await dependencies.open(selected.file, request.line - 1, request.column - 1);
    },
  };
}

export function vscodeSourceUriDependencies(manager: { projects: Array<{ folder: { name: string }; root: string }> }): SourceUriDependencies {
  return {
    projectRoots: () => manager.projects.map(project => ({ name: project.folder.name, root: project.root })),
    exists: async file => { try { return (await fs.stat(file)).isFile(); } catch { return false; } },
    pick: items => vscode.window.showQuickPick(items, { placeHolder: "Select the BIF project containing this source file" }),
    async open(file, line, column) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(Math.min(line, Math.max(0, document.lineCount - 1)), 0);
      const finalPosition = new vscode.Position(position.line, Math.min(column, document.lineAt(position.line).text.length));
      editor.selection = new vscode.Selection(finalPosition, finalPosition);
      editor.revealRange(new vscode.Range(finalPosition, finalPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    },
    showError: message => { void vscode.window.showErrorMessage(message); },
  };
}
