export function escapeDot(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n').replace(/</g, '\\<').replace(/>/g, '\\>');
}

function wrap(text, maximum = 10) {
    const words = String(text ?? '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
        if (!word) continue;
        if (!line || line.length + word.length + 1 <= maximum) line += `${line ? ' ' : ''}${word}`;
        else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.join('\n');
}

function colorsForGroup(label) {
    let hash = 0;
    for (const character of label) hash = character.charCodeAt(0) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const saturation = 50;
    return [50, 70, 90].map(lightness => {
        const s = saturation / 100;
        const l = lightness / 100;
        const k = n => (n + hue / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
        return `#${[f(0), f(8), f(4)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    });
}

function nodeStatement(node) {
    const marker = node.errorCount ? ' Error' : node.warningCount ? ' Warning' : '';
    const label = node.kind === 'missing' ? `${node.pageId} Missing` : `${node.pageId} ${node.graphLabel ?? ''}${marker}`.trim();
    const classes = ['node', node.kind, node.reachable ? 'reachable' : 'unreachable', node.start ? 'start' : '', node.errorCount ? 'has-error' : '', node.warningCount ? 'has-warning' : ''].filter(Boolean).join(' ');
    return `"${escapeDot(node.nodeId)}" [label="${escapeDot(wrap(label))}", id="node_${escapeDot(node.pageId)}", class="${classes}"]`;
}

export function buildPlayerGraphDot(structure) {
    const lines = [
        'digraph Adventure {', 'rankdir="TB"',
        'graph [fontname="Arial", fontsize=11, bgcolor="none"]',
        'node [shape=box, style=filled, fontname="Arial", fontsize=11, color="#000000"]',
        'edge [fontname="Arial", fontsize=11, penwidth=1, style="solid", color="#000000"]',
    ];
    const grouped = new Set();
    for (const group of structure.groups) {
        const nodes = group.nodeIds.map(id => structure.nodesById.get(id)).filter(Boolean);
        if (!nodes.length) continue;
        const colors = colorsForGroup(group.name);
        lines.push(`subgraph "${escapeDot(group.groupId)}" {`, `label="${escapeDot(group.name)}"`, 'labelloc="t"', 'labeljust="l"', 'style=filled', `color="${colors[0]}"`, `fillcolor="${colors[2]}ff"`, `node [style=filled, fillcolor="${colors[1]}", color="${colors[0]}"]`);
        for (const node of nodes) { grouped.add(node.nodeId); lines.push(nodeStatement(node)); }
        lines.push('}');
    }
    for (const node of structure.nodes.filter(node => !grouped.has(node.nodeId))) {
        lines.push(nodeStatement(node).replace(']', ', fillcolor="#cccccc", color="#888888"]'));
    }
    for (const edge of structure.edges) {
        const classes = ['edge', edge.broken ? 'broken' : '', edge.condition ? 'conditional' : '', edge.diagnostics.some(item => item.severity === 'error') ? 'has-error' : '', edge.diagnostics.some(item => item.severity === 'warning') ? 'has-warning' : ''].filter(Boolean).join(' ');
        const marker = edge.broken || edge.diagnostics.some(item => item.severity === 'error') ? ', xlabel="Error"' : edge.diagnostics.some(item => item.severity === 'warning') ? ', xlabel="Warning"' : '';
        lines.push(`"${escapeDot(edge.sourceNodeId)}" -> "${escapeDot(edge.targetNodeId)}" [id="${escapeDot(edge.edgeId)}", class="${classes}"${marker}]`);
    }
    lines.push('}');
    return lines.join('\n');
}
