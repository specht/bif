import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { AnalyzerDiagnostic, severityNumber, zeroBasedLocation } from "./core";

const severities = [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information];

export async function toVsCodeDiagnostic(root: string, item: AnalyzerDiagnostic): Promise<{ uri: vscode.Uri; diagnostic: vscode.Diagnostic } | undefined> {
  if (!item.file || item.file === ".") return undefined;
  const filePath = path.resolve(root, item.file);
  let lines: string[] = [];
  try { lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/); } catch { return undefined; }
  const location = zeroBasedLocation(item);
  const line = Math.min(location.line, Math.max(0, lines.length - 1));
  const column = Math.min(location.column, lines[line]?.length || 0);
  const diagnostic = new vscode.Diagnostic(new vscode.Range(line, column, line, Math.min(column + 1, lines[line]?.length || column + 1)), item.message, severities[severityNumber(item.severity)]);
  diagnostic.code = item.code;
  diagnostic.source = "BIF";
  return { uri: vscode.Uri.file(filePath), diagnostic };
}

export async function groupedDiagnostics(root: string, items: AnalyzerDiagnostic[]): Promise<Map<string, [vscode.Uri, vscode.Diagnostic[]]>> {
  const grouped = new Map<string, [vscode.Uri, vscode.Diagnostic[]]>();
  for (const item of items) {
    const mapped = await toVsCodeDiagnostic(root, item);
    if (!mapped) continue;
    const key = mapped.uri.toString();
    const entry = grouped.get(key) || [mapped.uri, []];
    entry[1].push(mapped.diagnostic);
    grouped.set(key, entry);
  }
  return grouped;
}
