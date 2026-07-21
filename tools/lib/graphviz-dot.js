function escapeDot(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n").replace(/</g, "\\<").replace(/>/g, "\\>");
}

function quoted(value) { return `"${escapeDot(value)}"`; }

function nodeLabel(node) {
  const lines = [node.kind === "missing" ? `Missing: ${node.pageId}` : node.pageId];
  if (node.kind === "page" && node.graphLabel) lines.push(node.graphLabel);
  if (node.start) lines.push("START");
  if (node.errorCount) lines.push(`ERROR ${node.errorCount}`);
  if (node.warningCount) lines.push(`WARNING ${node.warningCount}`);
  return lines.join("\n");
}

function edgeLabel(edge) {
  const value = edge.label || edge.text || "";
  return value.length > 42 ? `${value.slice(0, 39)}…` : value;
}

function generateDot(model) {
  const lines = [
    "digraph story {",
    "  graph [rankdir=TB, bgcolor=\"transparent\", pad=0.25, nodesep=0.35, ranksep=0.55];",
    "  node [shape=box, style=\"rounded,filled\", fontname=\"sans-serif\", fontsize=11, margin=\"0.12,0.08\"];",
    "  edge [fontname=\"sans-serif\", fontsize=9, arrowsize=0.7];",
  ];
  const grouped = new Set();
  for (const group of model.groups) {
    lines.push(`  subgraph ${quoted(group.groupId)} {`, `    label=${quoted(group.name)};`, `    id=${quoted(group.groupId)};`, "    class=\"authoring-cluster\";");
    for (const nodeId of group.nodeIds) {
      const node = model.nodes.find((item) => item.nodeId === nodeId);
      grouped.add(nodeId);
      lines.push(`    ${quoted(node.nodeId)} [id=${quoted(node.nodeId)}, class=${quoted(nodeClasses(node))}, label=${quoted(nodeLabel(node))}, tooltip=${quoted(node.path)}${node.start ? ", peripheries=2" : ""}${node.reachable ? "" : ", style=\"rounded,dashed,filled\""}];`);
    }
    lines.push("  }");
  }
  for (const node of model.nodes.filter((item) => !grouped.has(item.nodeId))) lines.push(`  ${quoted(node.nodeId)} [id=${quoted(node.nodeId)}, class=${quoted(nodeClasses(node))}, label=${quoted(nodeLabel(node))}, tooltip=${quoted(node.path)}${node.start ? ", peripheries=2" : ""}${node.reachable ? "" : ", style=\"rounded,dashed,filled\""}];`);
  for (const edge of model.edges) {
    const classes = ["authoring-edge", edge.condition ? "conditional" : "", edge.broken ? "broken" : ""].filter(Boolean).join(" ");
    lines.push(`  ${quoted(edge.sourceNodeId)} -> ${quoted(edge.targetNodeId)} [id=${quoted(edge.edgeId)}, class=${quoted(classes)}, label=${quoted(edgeLabel(edge))}, tooltip=${quoted(edge.text)}${edge.condition ? ", style=dashed" : ""}${edge.broken ? ", color=\"#b42318\", penwidth=2" : ""}];`);
  }
  lines.push("}");
  return lines.join("\n");
}

function nodeClasses(node) {
  return ["authoring-node", node.kind, node.reachable ? "reachable" : "unreachable", node.start ? "start" : "", node.errorCount ? "has-error" : "", node.warningCount ? "has-warning" : ""].filter(Boolean).join(" ");
}

async function renderDot(dot) {
  const { Graphviz } = await import("@hpcc-js/wasm");
  const graphviz = await Graphviz.load();
  return graphviz.dot(dot);
}

module.exports = { escapeDot, generateDot, renderDot };
