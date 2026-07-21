import { createGraphStructure } from './browser-graph-structure.js';
import { buildPlayerGraphDot } from './browser-graph-dot.js';

export function createUnifiedGraphView({
    container,
    analysisClient,
    renderDot,
    installSvg,
    getOverlay,
    onStructure,
    onNavigateEdge,
    onRewindPage,
    onInspect = () => {},
    loadFallback,
    onLimitedState,
    limitedDelayMs = 5000,
}) {
    let structure = null;
    let renderedHash = null;
    let renderGeneration = 0;
    let fallbackStarted = false;
    let selectedId = null;
    let limitedTimer = null;

    function setSelected(id) {
        container.querySelector('.graph-selected')?.classList.remove('graph-selected');
        selectedId = id;
        const element = id ? container.querySelector(`[data-structural-id="${CSS.escape(id)}"]`) : null;
        element?.classList.add('graph-selected');
        return element;
    }

    function applyOverlay() {
        if (!structure) return;
        const overlay = getOverlay(structure);
        for (const node of structure.nodes) {
            const element = container.querySelector(`#node_${CSS.escape(String(node.pageId))}`);
            if (!element) continue;
            element.classList.toggle('active', overlay.visitedPages.has(String(node.pageId)));
            element.classList.toggle('current', overlay.currentPage === String(node.pageId));
            element.classList.toggle('rewindable', overlay.rewindablePages.has(String(node.pageId)));
            element.classList.toggle('available', structure.edges.some(edge => String(edge.target) === String(node.pageId) && overlay.availableEdgeIds.has(edge.edgeId)));
        }
        for (const edge of structure.edges) {
            const element = container.querySelector(`#${CSS.escape(edge.edgeId)}`);
            if (!element) continue;
            element.classList.toggle('active', overlay.routeEdgeIds.has(edge.edgeId));
            element.classList.toggle('available', overlay.availableEdgeIds.has(edge.edgeId));
        }
    }

    async function renderStructure(model) {
        const next = createGraphStructure(model);
        const generation = ++renderGeneration;
        const svgText = await renderDot(buildPlayerGraphDot(next));
        if (generation !== renderGeneration) return;
        structure = next;
        renderedHash = model.contentHash;
        installSvg(svgText);
        container.dataset.graphSource = 'analysis';
        for (const node of structure.nodes) {
            const element = container.querySelector(`#node_${CSS.escape(String(node.pageId))}`);
            if (element) {
                element.dataset.structuralId = node.nodeId;
                element.tabIndex = 0;
                element.setAttribute('role', 'button');
                element.addEventListener('click', onClick);
                element.addEventListener('keydown', onKeyDown);
            }
        }
        for (const edge of structure.edges) {
            const element = container.querySelector(`#${CSS.escape(edge.edgeId)}`);
            if (element) {
                element.dataset.structuralId = edge.edgeId;
                element.tabIndex = 0;
                element.setAttribute('role', 'button');
                element.addEventListener('click', onClick);
                element.addEventListener('keydown', onKeyDown);
            }
        }
        onStructure(structure);
        applyOverlay();
        if (selectedId && (structure.nodesById.has(selectedId) || structure.edgesById.has(selectedId))) setSelected(selectedId);
        else selectedId = null;
        onLimitedState(false);
    }

    function scheduleLimitedNotice() {
        if (limitedTimer !== null || structure) return;
        limitedTimer = setTimeout(() => { limitedTimer = null; if (!structure) onLimitedState(true); }, limitedDelayMs);
    }

    async function onAnalysisState(state) {
        if (state.model?.nodes?.length) {
            if (limitedTimer !== null) clearTimeout(limitedTimer);
            limitedTimer = null;
            if (state.model.contentHash !== renderedHash) await renderStructure(state.model);
            return;
        }
        const lacksUsableStructure = state.status === 'ready' || !state.lastValidModel;
        if (lacksUsableStructure && ['unavailable', 'invalid', 'error', 'ready'].includes(state.status)) {
            scheduleLimitedNotice();
            if (!fallbackStarted) {
                fallbackStarted = true;
                await loadFallback();
                container.dataset.graphSource = 'recursive';
            }
        }
    }

    async function activateItem(item, origin = 'pointer') {
        if (!structure) return;
        if (!item || !container.contains(item)) return;
        const pageId = item.classList.contains('node') ? item.id.replace(/^node_/, '') : null;
        const structuralId = item.dataset.structuralId
            || (pageId ? structure.nodesByPage.get(pageId)?.nodeId : item.id);
        if (item.classList.contains('edge')) {
            const edge = structure.edgesById.get(structuralId);
            if (edge?.broken || edge?.diagnostics?.length) {
                setSelected(structuralId);
                onInspect(structuralId);
            } else if (item.classList.contains('available')) await onNavigateEdge(structuralId, origin);
            else {
                setSelected(structuralId);
                onInspect(structuralId);
            }
            return;
        }
        const node = structure.nodesById.get(structuralId);
        if (!node) return;
        if (node.kind === 'missing') {
            setSelected(structuralId);
            onInspect(structuralId);
            return;
        }
        const overlay = getOverlay(structure);
        if (overlay.availableEdgeIds.size && structure.edges.some(edge => edge.targetNodeId === structuralId && overlay.availableEdgeIds.has(edge.edgeId))) {
            const available = structure.edges.filter(edge => edge.targetNodeId === structuralId && overlay.availableEdgeIds.has(edge.edgeId));
            if (available.length === 1) await onNavigateEdge(available[0].edgeId, origin);
            else setSelected(structuralId);
        } else if (!(await onRewindPage(node.pageId, origin))) {
            setSelected(structuralId);
            onInspect(structuralId);
        }
    }

    function onClick(event) {
        void activateItem(event.target.closest('g.node, g.edge'), 'pointer');
    }

    function onKeyDown(event) {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        void activateItem(event.currentTarget, 'keyboard');
    }

    const unsubscribe = analysisClient.subscribe(onAnalysisState);
    return {
        applyOverlay,
        select: setSelected,
        getStructure: () => structure,
        dispose() {
            renderGeneration += 1;
            if (limitedTimer !== null) clearTimeout(limitedTimer);
            unsubscribe();
        },
    };
}
