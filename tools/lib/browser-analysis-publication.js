const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { buildAuthoringGraph } = require("./authoring-graph-model");

function sanitizeDiagnostic(item) {
  const result = {
    severity: item.severity,
    code: item.code,
    file: item.file,
    line: item.line,
    column: item.column,
    message: item.message,
  };
  if (item.target !== undefined) result.target = item.target;
  return result;
}

function buildBrowserAnalysisPublication(analysis) {
  const model = buildAuthoringGraph(analysis);
  const content = {
    schemaVersion: 1,
    project: {
      title: model.project.title,
      pagesPath: model.project.pagesPath,
      startPage: model.project.startPage,
    },
    summary: {
      pages: model.summary.pages,
      reachablePages: model.summary.reachablePages,
      unreachablePages: model.summary.unreachablePages,
      choices: model.summary.edges,
      groups: model.summary.groups,
      missingTargets: model.summary.missingTargets,
      errors: model.summary.errors,
      warnings: model.summary.warnings,
    },
    nodes: model.nodes.map(node => ({
      kind: node.kind,
      nodeId: node.nodeId,
      pageId: node.pageId,
      filename: node.filename,
      path: node.path,
      group: node.group,
      graphLabel: node.graphLabel,
      reachable: node.reachable,
      start: node.start,
      incomingCount: node.incomingCount,
      outgoingCount: node.outgoingCount,
      counts: { ...node.counts },
      errorCount: node.errorCount,
      warningCount: node.warningCount,
      diagnostics: node.diagnostics.map(sanitizeDiagnostic),
      source: node.source ? { ...node.source } : null,
    })),
    edges: model.edges.map(edge => ({
      edgeId: edge.edgeId,
      source: edge.source,
      target: edge.target,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      text: edge.text,
      label: edge.label,
      condition: edge.condition,
      file: edge.file,
      line: edge.line,
      column: edge.column,
      broken: edge.broken,
      diagnostics: edge.diagnostics.map(sanitizeDiagnostic),
    })),
    groups: model.groups.map(group => ({
      groupId: group.groupId,
      name: group.name,
      nodeIds: [...group.nodeIds],
    })),
    diagnostics: model.diagnostics.map(sanitizeDiagnostic),
  };
  const canonicalContent = canonicalJson(content);
  const publication = {
    ...content,
    contentHash: crypto.createHash("sha256").update(canonicalContent).digest("hex"),
  };
  validateBrowserAnalysisPublication(publication);
  return publication;
}

function validateBrowserAnalysisPublication(publication) {
  if (publication.schemaVersion !== 1) throw new Error("Unsupported browser analysis schema");
  for (const field of ["nodes", "edges", "groups", "diagnostics"]) {
    if (!Array.isArray(publication[field])) throw new Error(`Browser analysis ${field} must be an array`);
  }
  if (!/^[a-f0-9]{64}$/.test(publication.contentHash)) throw new Error("Browser analysis contentHash must be SHA-256");
  const locations = [
    ...publication.nodes.map(node => node.source),
    ...publication.edges,
    ...publication.diagnostics,
  ].filter(Boolean);
  for (const source of locations) {
    if (source.file && (path.isAbsolute(source.file) || /^[a-z]:[\\/]/i.test(source.file))) {
      throw new Error(`Browser analysis source path must be relative: ${source.file}`);
    }
  }
  if (canonicalJson(publication).includes("vscode://")) throw new Error("Browser analysis must not contain VS Code URIs");
}

function canonicalJson(value) {
  return `${serialize(value)}\n`;
}

function serialize(value) {
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${safeString(key)}:${serialize(value[key])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return safeString(value);
}

function safeString(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function publishBrowserAnalysis(projectRoot, publication, generation, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const isCurrent = options.isCurrent || (() => true);
  const directory = path.join(projectRoot, ".story-tools");
  const output = path.join(directory, "analysis.json");
  const temporary = path.join(directory, `.analysis.${process.pid}.${generation}.tmp`);
  await fileSystem.mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await fileSystem.open(temporary, "wx");
    await handle.writeFile(canonicalJson(publication), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!isCurrent(generation)) return { output, published: false };
    if (options.beforeRename) await options.beforeRename({ temporary, output });
    await fileSystem.rename(temporary, output);
    return { output, published: true };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.unlink(temporary).catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

module.exports = {
  buildBrowserAnalysisPublication,
  canonicalJson,
  publishBrowserAnalysis,
  sanitizeDiagnostic,
  validateBrowserAnalysisPublication,
};
