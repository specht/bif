import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  GenerationScheduler,
  isGeneratedFile,
  ownsFile,
  ProjectAnalysisPublisher,
  publishCurrentGeneration,
  selectProject,
  stateAfterAnalysisFailure,
  statusText,
  summaryText,
} from "./core";
import { groupedDiagnostics } from "./diagnostics-adapter";

const { publishProjectAnalysis } = require("../../tools/lib/publish-project-analysis") as {
  publishProjectAnalysis: ProjectAnalysisPublisher;
};

export interface ManagedProject {
  folder: vscode.WorkspaceFolder;
  root: string;
  result?: any;
  diagnosticUris: Set<string>;
  watchers: vscode.Disposable[];
  scheduler: GenerationScheduler;
  state: "idle" | "analysing" | "error";
  lastError?: Error;
}

export class ProjectManager implements vscode.Disposable {
  readonly projects: ManagedProject[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  constructor(
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly status: vscode.StatusBarItem,
    private readonly output: vscode.OutputChannel,
    private readonly publishAnalysis: ProjectAnalysisPublisher = publishProjectAnalysis,
  ) {}

  async discover(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const config = path.join(folder.uri.fsPath, "config.js");
      try { await fs.access(config); } catch { continue; }
      if (this.projects.some(project => project.root === folder.uri.fsPath)) continue;
      let project!: ManagedProject;
      const scheduler = new GenerationScheduler(async generation => this.analyse(project, generation), 300);
      project = { folder, root: folder.uri.fsPath, diagnosticUris: new Set(), watchers: [], scheduler, state: "idle" };
      this.projects.push(project);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*.{md,png,jpg,jpeg,gif,webp,svg}"));
      const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "config.js"));
      for (const event of [watcher.onDidCreate, watcher.onDidChange, watcher.onDidDelete, configWatcher.onDidCreate, configWatcher.onDidChange, configWatcher.onDidDelete]) {
        project.watchers.push(event.call(watcher, (uri: vscode.Uri) => {
          if (!isGeneratedFile(project.root, uri.fsPath)) scheduler.schedule();
        }));
      }
      project.watchers.push(watcher, configWatcher);
      this.output.appendLine(`Discovered BIF project: ${folder.name}`);
      await scheduler.runNow();
    }
    this.updateStatus();
  }

  private async analyse(project: ManagedProject, generation: number): Promise<void> {
    project.state = "analysing"; this.updateStatus(project); this.output.appendLine(`Analysing ${project.folder.name}…`);
    try {
      const published = await publishCurrentGeneration(
        this.publishAnalysis,
        project.root,
        generation,
        value => project.scheduler.isCurrent(value),
      );
      if (!published) return;
      const result = published.analysis;
      const grouped = await groupedDiagnostics(project.root, result.diagnostics);
      if (!project.scheduler.isCurrent(generation)) return;
      const nextUris = new Set(grouped.keys());
      for (const old of project.diagnosticUris) if (!nextUris.has(old)) this.diagnostics.delete(vscode.Uri.parse(old));
      for (const [, [uri, diagnostics]] of grouped) this.diagnostics.set(uri, diagnostics);
      project.diagnosticUris = nextUris;
      project.result = result; project.state = "idle"; project.lastError = undefined;
      this.output.appendLine(`${project.folder.name}: ${summaryText(result.summary)} · analysis ${published.contentHash.slice(0, 12)}`);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
      project.state = stateAfterAnalysisFailure(Boolean(project.result), code);
      project.lastError = error instanceof Error ? error : new Error(String(error));
      const label = code === "publication-failed" ? "Analysis publication failed" : "Analysis failed";
      this.output.appendLine(`${label} for ${project.folder.name}: ${project.lastError.stack || project.lastError.message}`);
    } finally { this.updateStatus(project); }
  }

  async refresh(project?: ManagedProject): Promise<void> { await (project || await this.chooseProject())?.scheduler.runNow(); }
  currentProject(): ManagedProject | undefined { return selectProject(this.projects, vscode.window.activeTextEditor?.document.uri.fsPath); }
  async chooseProject(): Promise<ManagedProject | undefined> {
    const current = this.currentProject(); if (current) return current;
    if (!this.projects.length) { void vscode.window.showInformationMessage("No BIF project found. Open a folder with an analyzer-compatible config.js."); return undefined; }
    const picked = await vscode.window.showQuickPick(this.projects.map(project => ({ label: project.folder.name, description: project.root, project })), { placeHolder: "Select a BIF project" });
    return picked?.project;
  }
  updateStatus(preferred?: ManagedProject): void {
    const project = preferred || this.currentProject() || (this.projects.length === 1 ? this.projects[0] : undefined);
    if (!project) { this.status.hide(); return; }
    this.status.show();
    if (project.state === "analysing") { this.status.text = "$(sync~spin) BIF analysing…"; return; }
    if (project.state === "error") { this.status.text = "$(error) BIF extension error"; this.status.tooltip = "BIF analysis failed. Show output for details."; return; }
    if (project.result) { this.status.text = statusText(project.result.summary, this.projects.length > 1 ? project.folder.name : ""); this.status.tooltip = `${project.folder.name}\n${summaryText(project.result.summary)}`; }
  }
  owns(project: ManagedProject, uri: vscode.Uri): boolean { return ownsFile(project.root, project.result?.project?.pagesPath || "pages", uri.fsPath); }
  dispose(): void { for (const project of this.projects) { project.scheduler.dispose(); project.watchers.forEach(item => item.dispose()); for (const uri of project.diagnosticUris) this.diagnostics.delete(vscode.Uri.parse(uri)); } this.disposables.forEach(item => item.dispose()); }
}
