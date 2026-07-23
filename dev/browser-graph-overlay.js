export function createRuntimeOverlay(structure, { history, routeEdgeIds, availableEdgeIds }) {
    const pages = history.slice(1).map(String);
    return {
        currentPage: pages.at(-1) ?? null,
        visitedPages: new Set(pages),
        rewindablePages: new Set(pages.slice(0, -1)),
        routeEdgeIds: new Set(routeEdgeIds.filter(id => structure.edgesById.has(id))),
        availableEdgeIds: new Set(availableEdgeIds.filter(id => structure.edgesById.has(id))),
    };
}
