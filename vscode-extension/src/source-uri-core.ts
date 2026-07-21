import * as path from "node:path";

export const SOURCE_URI_AUTHORITY = "gymnasiumsteglitz.bif-authoring-tools";
export const SOURCE_URI_PATH = "/open-source";
const MAX_POSITION = 1_000_000;

export interface SourceRequest { file: string; line: number; column: number }
export interface SourceProject { name: string; root: string }
export interface SourceMatch { label: string; description: string; file: string }

export function parseSourceRequest(uri: { authority: string; path: string; query: string }): SourceRequest | undefined {
  if (uri.authority !== SOURCE_URI_AUTHORITY || uri.path !== SOURCE_URI_PATH) return undefined;
  const parameters = new URLSearchParams(uri.query);
  const file = parameters.get("file") || "";
  const line = Number(parameters.get("line"));
  const column = Number(parameters.get("column"));
  if (!file || path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || file.startsWith("\\\\") || /^[a-z][a-z\d+.-]*:/i.test(file)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(file); } catch { return undefined; }
  if (decoded.split(/[\\/]/).some(part => part === ".." || part === "")) return undefined;
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1 || line > MAX_POSITION || column > MAX_POSITION) return undefined;
  return { file: decoded, line, column };
}

export async function findSourceMatches(
  request: SourceRequest,
  projects: SourceProject[],
  exists: (file: string) => Promise<boolean>,
): Promise<SourceMatch[]> {
  const matches: SourceMatch[] = [];
  for (const project of projects) {
    const root = path.resolve(project.root);
    const candidate = path.resolve(root, request.file);
    if (!candidate.startsWith(`${root}${path.sep}`)) continue;
    if (await exists(candidate)) matches.push({ label: project.name, description: request.file, file: candidate });
  }
  return matches;
}
