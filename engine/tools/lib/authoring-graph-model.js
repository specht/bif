const path = require("node:path");

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function token(value) {
  return Buffer.from(String(value), "utf8").toString("hex");
}

function buildAuthoringGraph(analysis) {
  const topologyEdges = analysis.graph.edges.filter((edge) => edge.target !== "." && edge.kind !== "local" && !edge.local);
  const unreachable = new Set(analysis.diagnostics.filter((item) => item.code === "unreachable-page").map((item) => item.file));
  const pageIds = new Set(analysis.graph.pages.map((page) => page.id));
  const missingTargets = [...new Set(topologyEdges.filter((edge) => !pageIds.has(edge.target)).map((edge) => edge.target))].sort(collator.compare);
  const diagnosticsForFile = (file) => analysis.diagnostics.filter((item) => item.file === file);

  const nodes = analysis.graph.pages.map((page) => {
    const diagnostics = diagnosticsForFile(page.file).filter((item) => item.code !== "missing-page");
    return {
      kind: "page",
      nodeId: `node-page-${token(page.id)}`,
      pageId: page.id,
      filename: page.filename,
      path: page.file,
      group: page.group,
      graphLabel: page.graphLabel,
      reachable: !unreachable.has(page.file),
      start: page.id === analysis.project.startPage,
      incomingCount: topologyEdges.filter((edge) => edge.target === page.id).length,
      outgoingCount: topologyEdges.filter((edge) => edge.source === page.id).length,
      counts: {
        scripts: page.scripts.length, pageScripts: page.pageScripts?.length || 0, resultScripts: page.resultScripts?.length || 0,
        conditions: page.conditions.length, expressions: page.expressions.length, images: page.images.length,
        pageChoices: page.choices?.filter(choice => !choice.local).length || 0,
        localChoices: page.choices?.filter(choice => choice.local).length || 0,
        resultBlocks: page.resultBlocks?.filter(block => block.hasResult).length || 0,
      },
      choices: (page.choices || []).map(choice => ({ ...choice })),
      errorCount: diagnostics.filter((item) => item.severity === "error").length,
      warningCount: diagnostics.filter((item) => item.severity === "warning").length,
      diagnostics,
      source: { file: page.file, line: 1, column: 1 },
    };
  });

  for (const target of missingTargets) {
    const diagnostics = analysis.diagnostics.filter((item) => item.code === "missing-page" && item.target === target);
    const incoming = topologyEdges.filter((edge) => edge.target === target);
    nodes.push({
      kind: "missing",
      nodeId: `node-missing-${token(target)}`,
      pageId: target,
      filename: `${target}.md`,
      path: path.posix.join(analysis.project.pagesPath, `${target}.md`),
      group: "Missing targets",
      graphLabel: `Missing: ${target}`,
      reachable: false,
      start: false,
      incomingCount: incoming.length,
      outgoingCount: 0,
      counts: { scripts: 0, pageScripts: 0, resultScripts: 0, conditions: 0, expressions: 0, images: 0, pageChoices: 0, localChoices: 0, resultBlocks: 0 },
      choices: [],
      errorCount: diagnostics.length || 1,
      warningCount: 0,
      diagnostics,
      source: null,
    });
  }

  const nodeByPage = new Map(nodes.map((node) => [node.pageId, node]));
  const edges = topologyEdges.map((edge, index) => {
    const broken = !pageIds.has(edge.target);
    const diagnostics = analysis.diagnostics.filter((item) => item.file === edge.file && item.line === edge.line && (!item.target || item.target === edge.target));
    return {
      edgeId: `edge-${token(edge.source)}-${token(edge.target)}-${String(index + 1).padStart(4, "0")}`,
      source: edge.source,
      target: edge.target,
      sourceNodeId: nodeByPage.get(edge.source).nodeId,
      targetNodeId: nodeByPage.get(edge.target).nodeId,
      text: edge.text,
      label: edge.label,
      condition: edge.condition,
      choiceId: edge.choiceId,
      resultScriptCount: edge.resultScriptCount || 0,
      hasVisibleResult: Boolean(edge.hasVisibleResult),
      file: edge.file,
      line: edge.line,
      column: edge.column,
      broken,
      diagnostics,
    };
  });

  const groups = [...new Set(nodes.filter((node) => node.kind === "page" && node.group).map((node) => node.group))]
    .sort(collator.compare)
    .map((name) => ({ groupId: `cluster-${token(name)}`, name, nodeIds: nodes.filter((node) => node.kind === "page" && node.group === name).map((node) => node.nodeId) }));
  if (missingTargets.length) groups.push({ groupId: "cluster-missing", name: "Missing targets", nodeIds: nodes.filter((node) => node.kind === "missing").map((node) => node.nodeId) });

  const attached = new Set(nodes.flatMap((node) => node.diagnostics).concat(edges.flatMap((edge) => edge.diagnostics)));
  return {
    version: 1,
    project: { ...analysis.project },
    summary: {
      pages: analysis.summary.pages,
      reachablePages: analysis.summary.reachablePages,
      unreachablePages: analysis.summary.unreachablePages,
      edges: analysis.summary.links,
      groups: analysis.summary.groups,
      missingTargets: missingTargets.length,
      errors: analysis.summary.errors,
      warnings: analysis.summary.warnings,
      pageChoices: analysis.summary.pageChoices || analysis.summary.links,
      localChoices: analysis.summary.localChoices || 0,
      resultBlocks: analysis.summary.resultBlocks || 0,
      resultScripts: analysis.summary.resultScripts || 0,
    },
    nodes,
    edges,
    groups,
    diagnostics: analysis.diagnostics,
    projectDiagnostics: analysis.diagnostics.filter((item) => !attached.has(item)),
  };
}

module.exports = { buildAuthoringGraph, token };
