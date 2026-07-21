import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const { publishProjectAnalysis } = require("../../../../tools/lib/publish-project-analysis") as {
  publishProjectAnalysis(root: string): Promise<any>;
};

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Timed out waiting for extension state");
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("gymnasiumsteglitz.bif-authoring-tools");
  assert.ok(extension, "extension is installed in the development host");
  const api: any = await extension.activate();
  await waitFor(() => api.manager.projects.length === 1 && api.manager.projects[0].result);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ["bif.refreshDiagnostics", "bif.openStoryGraph", "bif.showStorySummary", "bif.showOutput"]) assert.ok(commands.includes(command));
  const project = api.manager.projects[0];
  const allDiagnostics = () => vscode.languages.getDiagnostics().flatMap(([, values]) => values);
  await waitFor(() => allDiagnostics().length >= 4);
  const codes = allDiagnostics().map(item => String(item.code));
  for (const code of ["missing-page", "unreachable-page", "expression-syntax", "missing-image"]) assert.ok(codes.includes(code), `missing diagnostic ${code}`);
  assert.ok(allDiagnostics().some(item => item.severity === vscode.DiagnosticSeverity.Error && item.source === "BIF"));
  const root = project.root;
  const analysisPath = path.join(root, ".story-tools", "analysis.json");
  await waitFor(() => exists(analysisPath));
  const initialPublication = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  assert.equal(initialPublication.schemaVersion, 1);
  assert.equal(initialPublication.summary.pages, project.result.summary.pages);
  assert.equal(initialPublication.summary.errors, project.result.summary.errors);
  assert.equal(initialPublication.summary.warnings, project.result.summary.warnings);
  assert.ok(!JSON.stringify(initialPublication).includes(root));
  assert.ok(!JSON.stringify(initialPublication).includes("vscode://"));
  assert.ok(!JSON.stringify(initialPublication).includes("story-code-executed"));
  assert.ok(!(await exists(path.join(root, ".story-tools", "graph.html"))), "analysis must not generate a graph");
  const extensionBytes = await fs.readFile(analysisPath);
  const directPublication = await publishProjectAnalysis(root);
  const directBytes = await fs.readFile(analysisPath);
  assert.deepEqual(directBytes, extensionBytes, "extension and shared direct publication must be byte-identical");
  assert.equal(directPublication.contentHash, initialPublication.contentHash);
  await fs.writeFile(path.join(root, "pages", "99.md"), "# Created target\n", "utf8");
  await waitFor(() => !allDiagnostics().some(item => String(item.code) === "missing-page"));
  await waitFor(async () => JSON.parse(await fs.readFile(analysisPath, "utf8")).contentHash !== initialPublication.contentHash);
  const createdPublication = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  assert.equal(createdPublication.summary.pages, 3);
  assert.equal(createdPublication.summary.missingTargets, 0);
  assert.ok(createdPublication.nodes.some((node: any) => node.kind === "page" && node.pageId === "99"));
  assert.deepEqual((await fs.readdir(path.dirname(analysisPath))).filter(name => name.startsWith(".analysis.")), []);
  await fs.rm(path.join(root, "pages", "99.md"));
  await waitFor(() => allDiagnostics().some(item => String(item.code) === "missing-page"));
  await waitFor(async () => JSON.parse(await fs.readFile(analysisPath, "utf8")).contentHash !== createdPublication.contentHash);
  const deletedPublication = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  assert.equal(deletedPublication.summary.pages, 2);
  assert.equal(deletedPublication.summary.missingTargets, 1);
  assert.ok(deletedPublication.nodes.some((node: any) => node.kind === "missing" && node.pageId === "99"));
  await vscode.commands.executeCommand("bif.refreshDiagnostics");
  const graphPath = await api.generateGraph(project, false);
  assert.ok(await exists(graphPath));
  const html = await fs.readFile(graphPath, "utf8");
  assert.match(html, /<svg/); assert.match(html, /expression-syntax/);
  assert.ok(!html.includes("story-code-executed"));
}

async function exists(file: string): Promise<boolean> { try { await fs.access(file); return true; } catch { return false; } }
