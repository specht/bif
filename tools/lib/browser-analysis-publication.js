const crypto = require("node:crypto");
const path = require("node:path");
const { buildAuthoringGraph } = require("./authoring-graph-model");
const { ANALYSIS_SCHEMA_VERSION, ANALYSIS_PUBLISHER_SOURCES } = require("./analysis-schema");

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
  if (item.choiceId !== undefined) result.choiceId = item.choiceId;
  for (const field of ["endLine", "endColumn", "scriptIndex", "scriptLine", "scriptColumn", "expressionLine", "expressionColumn", "rawMessage", "kind"]) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function buildBrowserAnalysisPublication(analysis, options = {}) {
  const model = buildAuthoringGraph(analysis);
  const content = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    inputManifest: analysis.inputManifest.map(entry => ({ path: entry.path, sha256: entry.sha256 })),
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
      pageChoices: model.summary.pageChoices,
      localChoices: model.summary.localChoices,
      resultBlocks: model.summary.resultBlocks,
      resultScripts: model.summary.resultScripts,
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
      choices: node.choices.map(choice => ({ ...choice })),
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
      choiceId: edge.choiceId,
      resultScriptCount: edge.resultScriptCount,
      hasVisibleResult: edge.hasVisibleResult,
    })),
    groups: model.groups.map(group => ({
      groupId: group.groupId,
      name: group.name,
      nodeIds: [...group.nodeIds],
    })),
    diagnostics: model.diagnostics.map(sanitizeDiagnostic),
  };
  const contentHash = /^[a-f0-9]{64}$/.test(analysis.contentHash || "")
    ? analysis.contentHash
    : crypto.createHash("sha256").update(canonicalJson({ project: analysis.project, graph: analysis.graph })).digest("hex");
  const analysisHash = crypto.createHash("sha256").update(canonicalJson(content)).digest("hex");
  const publication = {
    ...content,
    contentHash,
    analysisHash,
  };
  if (options.publisher) publication.publisher = sanitizePublisher(options.publisher);
  validateBrowserAnalysisPublication(publication);
  return publication;
}

function validateBrowserAnalysisPublication(publication) {
  if (publication.schemaVersion !== ANALYSIS_SCHEMA_VERSION) throw new Error("Unsupported browser analysis schema");
  if (publication.publisher) sanitizePublisher(publication.publisher);
  if (!Array.isArray(publication.inputManifest) || publication.inputManifest.length === 0) throw new Error("Browser analysis inputManifest must not be empty");
  for (const entry of publication.inputManifest) {
    if (!entry || typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid browser analysis manifest entry");
    const normalized = entry.path.split("/");
    if (path.isAbsolute(entry.path) || normalized.includes("..") || entry.path.includes("\\")) throw new Error(`Browser analysis manifest path must be project-relative: ${entry.path}`);
  }
  for (const field of ["nodes", "edges", "groups", "diagnostics"]) {
    if (!Array.isArray(publication[field])) throw new Error(`Browser analysis ${field} must be an array`);
  }
  if (!/^[a-f0-9]{64}$/.test(publication.contentHash)) throw new Error("Browser analysis contentHash must be SHA-256");
  if (!/^[a-f0-9]{64}$/.test(publication.analysisHash)) throw new Error("Browser analysis analysisHash must be SHA-256");
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

function sanitizePublisher(publisher) {
  if (!publisher || typeof publisher.name !== "string" || !publisher.name.trim()
      || typeof publisher.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(publisher.version)
      || !ANALYSIS_PUBLISHER_SOURCES.includes(publisher.source)) {
    throw new Error("Invalid browser analysis publisher metadata");
  }
  return { name: publisher.name, version: publisher.version, source: publisher.source };
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

module.exports = {
  buildBrowserAnalysisPublication,
  canonicalJson,
  sanitizeDiagnostic,
  validateBrowserAnalysisPublication,
  sanitizePublisher,
};
