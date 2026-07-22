export function getPublicDiagnosticMessage(diagnostic) {
    let message = String(diagnostic?.message || '');
    const scriptIndex = diagnostic?.scriptIndex;
    if (Number.isInteger(scriptIndex)) {
        message = message.replace(new RegExp(`^Script ${scriptIndex}:\\s*`), '');
    }
    const scriptLine = diagnostic?.scriptLine;
    const scriptColumn = diagnostic?.scriptColumn;
    if (Number.isInteger(scriptLine) && Number.isInteger(scriptColumn)) {
        message = message.replace(new RegExp(`\\s*\\(${scriptLine}:${scriptColumn}\\)$`), '');
    }
    return message;
}

export function normalizeBrowserDiagnostic(diagnostic) {
    const message = getPublicDiagnosticMessage(diagnostic);
    return message === diagnostic.message ? diagnostic : { ...diagnostic, message };
}

export function normalizeBrowserAnalysisDiagnostics(model) {
    const normalizeCollection = collection => collection.map(item => ({
        ...item,
        diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.map(normalizeBrowserDiagnostic) : item.diagnostics,
    }));
    return {
        ...model,
        diagnostics: model.diagnostics.map(normalizeBrowserDiagnostic),
        nodes: normalizeCollection(model.nodes),
        edges: normalizeCollection(model.edges),
    };
}
