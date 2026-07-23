import * as vscode from "vscode";
import { ProjectManager } from "./project-manager";
import { summaryText } from "./core";

export interface BifExtensionApi {
  manager: ProjectManager;
}

export async function activate(context: vscode.ExtensionContext): Promise<BifExtensionApi> {
  const output = vscode.window.createOutputChannel("BIF Authoring Tools");
  const diagnostics = vscode.languages.createDiagnosticCollection("bif");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "bif.showStorySummary";
  const manager = new ProjectManager(diagnostics, status, output);
  context.subscriptions.push(output, diagnostics, status, manager);
  context.subscriptions.push(
    vscode.commands.registerCommand("bif.refreshDiagnostics", async () => manager.refresh()),
    vscode.commands.registerCommand("bif.showStorySummary", async () => {
      const project = await manager.chooseProject(); if (!project?.result) return;
      void vscode.window.showInformationMessage(`${project.result.project.title}: ${summaryText(project.result.summary)}`);
    }),
    vscode.commands.registerCommand("bif.showOutput", () => output.show()),
    vscode.window.onDidChangeActiveTextEditor(() => manager.updateStatus()),
    vscode.workspace.onDidSaveTextDocument(document => { const project = manager.projects.find(item => manager.owns(item, document.uri)); if (project) project.scheduler.schedule(); }),
  );
  await manager.discover();
  return { manager };
}

export function deactivate(): void {}
