export type Severity = "error" | "warning" | "info";

export interface AnalyzerDiagnostic {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface Summary {
  pages: number; reachablePages: number; unreachablePages: number; links: number;
  groups: number; errors: number; warnings: number;
}

export function severityNumber(severity: Severity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

export function zeroBasedLocation(diagnostic: AnalyzerDiagnostic): { line: number; column: number } {
  return { line: Math.max(0, (diagnostic.line || 1) - 1), column: Math.max(0, (diagnostic.column || 1) - 1) };
}

export function statusText(summary: Summary, name = ""): string {
  const unreachable = summary.unreachablePages ? ` · $(debug-disconnect) ${summary.unreachablePages}` : "";
  return `$(symbol-structure) BIF${name ? ` ${name}` : ""} ${summary.pages} pages · $(error) ${summary.errors} · $(warning) ${summary.warnings}${unreachable}`;
}

export function summaryText(summary: Summary): string {
  return `${summary.pages} pages · ${summary.reachablePages} reachable · ${summary.unreachablePages} unreachable · ${summary.links} choices · ${summary.groups} groups · ${summary.errors} errors · ${summary.warnings} warnings`;
}

export function ownsFile(projectRoot: string, pagesPath: string, filePath: string): boolean {
  const path = require("node:path") as typeof import("node:path");
  const relative = path.relative(projectRoot, filePath);
  return !isGeneratedFile(projectRoot, filePath) && (relative === "config.js" || (!relative.startsWith("..") && (relative === pagesPath || relative.startsWith(`${pagesPath}${path.sep}`))));
}

export function isGeneratedFile(projectRoot: string, filePath: string): boolean {
  const path = require("node:path") as typeof import("node:path");
  const relative = path.relative(projectRoot, filePath);
  return relative === ".story-tools" || relative.startsWith(`.story-tools${path.sep}`);
}

export function selectProject<T extends { root: string }>(projects: T[], activeFile?: string): T | undefined {
  const path = require("node:path") as typeof import("node:path");
  if (activeFile) {
    const candidates = projects.filter(project => { const relative = path.relative(project.root, activeFile); return !relative.startsWith("..") && !path.isAbsolute(relative); });
    if (candidates.length) return candidates.sort((a, b) => b.root.length - a.root.length)[0];
  }
  return projects.length === 1 ? projects[0] : undefined;
}

export class GenerationScheduler {
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;
  private running = false;
  private rerun = false;
  constructor(private readonly task: (generation: number) => Promise<void>, private readonly delay = 300) {}
  schedule(): void { this.generation += 1; clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(this.generation), this.delay); }
  async runNow(): Promise<void> { this.generation += 1; clearTimeout(this.timer); await this.run(this.generation); }
  private async run(current: number): Promise<void> {
    if (this.running) { this.rerun = true; return; }
    this.running = true;
    try { await this.task(current); }
    finally { this.running = false; if (this.rerun) { this.rerun = false; await this.run(this.generation); } }
  }
  isCurrent(generation: number): boolean { return generation === this.generation; }
  dispose(): void { clearTimeout(this.timer); }
}
