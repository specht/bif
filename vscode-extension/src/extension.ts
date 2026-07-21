import * as path from "node:path";
import * as vscode from "vscode";
import { ProjectManager, ManagedProject } from "./project-manager";
import { summaryText } from "./core";
import { createSourceUriHandler, vscodeSourceUriDependencies } from "./source-uri-handler";

const { generateAuthoringGraph } = require("../../tools/story-graph") as { generateAuthoringGraph(options: { project: string; output: string }): Promise<any> };

export interface BifExtensionApi {
  manager: ProjectManager;
  generateGraph(project: ManagedProject, open?: boolean): Promise<string>;
  openSource(uri: vscode.Uri): Promise<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<BifExtensionApi> {
  const output = vscode.window.createOutputChannel("BIF Authoring Tools");
  const diagnostics = vscode.languages.createDiagnosticCollection("bif");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "bif.showStorySummary";
  const manager = new ProjectManager(diagnostics, status, output);
  context.subscriptions.push(output, diagnostics, status, manager);
  const sourceUriHandler = createSourceUriHandler(vscodeSourceUriDependencies(manager));
  context.subscriptions.push(vscode.window.registerUriHandler(sourceUriHandler));

  const generateGraph = async (project: ManagedProject, open = true): Promise<string> => {
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before generating or opening the BIF authoring graph.");
    const outputPath = path.join(project.root, ".story-tools", "graph.html");
    output.appendLine(`Generating authoring graph for ${project.folder.name}…`);
    await generateAuthoringGraph({ project: project.root, output: outputPath });
    output.appendLine(`Authoring graph written: ${outputPath}`);
    if (open) await vscode.env.openExternal(vscode.Uri.file(outputPath));
    return outputPath;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("bif.refreshDiagnostics", async () => manager.refresh()),
    vscode.commands.registerCommand("bif.openStoryGraph", async () => {
      const project = await manager.chooseProject(); if (!project) return;
      try { await generateGraph(project); if (project.result?.summary.errors) void vscode.window.showWarningMessage("The BIF graph contains story errors; details remain available in the graph."); }
      catch (error) { output.appendLine(String(error instanceof Error ? error.stack : error)); void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error), "Show Output").then(choice => { if (choice) output.show(); }); }
    }),
    vscode.commands.registerCommand("bif.showStorySummary", async () => {
      const project = await manager.chooseProject(); if (!project?.result) return;
      void vscode.window.showInformationMessage(`${project.result.project.title}: ${summaryText(project.result.summary)} · Graph: .story-tools/graph.html`);
    }),
    vscode.commands.registerCommand("bif.showOutput", () => output.show()),
    vscode.window.onDidChangeActiveTextEditor(() => manager.updateStatus()),
    vscode.workspace.onDidSaveTextDocument(document => { const project = manager.projects.find(item => manager.owns(item, document.uri)); if (project) project.scheduler.schedule(); }),
  );
  await manager.discover();
  return { manager, generateGraph, openSource: async uri => { await sourceUriHandler.handleUri(uri); } };
}

export function deactivate(): void {}
