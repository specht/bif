function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function createGraphStructure(publication) {
    const nodes = publication.nodes.map(node => ({ ...node }));
    const edges = publication.edges.map(edge => ({ ...edge }));
    const groups = publication.groups.map(group => ({ ...group, nodeIds: [...group.nodeIds] }));
    const nodesById = new Map(nodes.map(node => [node.nodeId, node]));
    const nodesByPage = new Map(nodes.map(node => [String(node.pageId), node]));
    const edgesById = new Map(edges.map(edge => [edge.edgeId, edge]));
    const outgoingByPage = new Map();
    for (const edge of edges) {
        const source = String(edge.source);
        if (!outgoingByPage.has(source)) outgoingByPage.set(source, []);
        outgoingByPage.get(source).push(edge);
    }
    for (const outgoing of outgoingByPage.values()) {
        outgoing.sort((left, right) => left.line - right.line || left.column - right.column || left.edgeId.localeCompare(right.edgeId));
    }
    return {
        contentHash: publication.contentHash,
        analysisHash: publication.analysisHash,
        project: publication.project,
        diagnostics: publication.diagnostics,
        nodes, edges, groups, nodesById, nodesByPage, edgesById, outgoingByPage,
    };
}

export function matchRuntimeChoices(structure, sourcePage, controls) {
    const matches = new Map();
    const ambiguities = [];
    const controlsByTarget = new Map();
    for (const control of controls) {
        const target = String(control.target);
        if (!controlsByTarget.has(target)) controlsByTarget.set(target, []);
        controlsByTarget.get(target).push(control);
    }
    for (const [target, targetControls] of controlsByTarget) {
        const candidates = (structure?.outgoingByPage.get(String(sourcePage)) ?? [])
            .filter(edge => String(edge.target) === target);
        for (let index = 0; index < targetControls.length; index++) {
            const control = targetControls[index];
            const textMatches = candidates.filter(edge => normalizeText(edge.text) === normalizeText(control.text));
            let edge = textMatches.length === 1 ? textMatches[0] : null;
            if (!edge && candidates.length === targetControls.length) edge = candidates[index] ?? null;
            if (edge && ![...matches.values()].includes(edge.edgeId)) matches.set(control.element, edge.edgeId);
            else if (candidates.length) ambiguities.push({ source: String(sourcePage), target, text: normalizeText(control.text) });
        }
    }
    return { matches, ambiguities };
}

export { normalizeText };
