function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function createCount(className) {
    const element = document.createElement('span');
    element.className = `project-analysis-count ${className}`;
    return element;
}

export function mountBrowserAnalysisSummary({ graphContainer, client }) {
    const devPane = graphContainer.closest('#dev_pane');
    const resizableChildren = graphContainer.closest('#resizable-children');
    resizableChildren.appendChild(devPane);

    const graphPanel = document.createElement('div');
    graphPanel.id = 'graph-panel';
    graphContainer.parentNode.insertBefore(graphPanel, graphContainer);

    const summary = document.createElement('section');
    summary.id = 'project-analysis-summary';
    summary.setAttribute('aria-label', 'Project analysis');

    const status = document.createElement('div');
    status.id = 'project-analysis-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');

    const message = document.createElement('span');
    message.className = 'project-analysis-message';
    message.textContent = 'Project analysis: loading…';

    const counts = document.createElement('span');
    counts.id = 'project-analysis-counts';
    counts.hidden = true;
    const title = document.createElement('span');
    title.id = 'project-analysis-title';
    title.className = 'project-analysis-title';
    const pages = createCount('project-analysis-pages');
    const choices = createCount('project-analysis-choices');
    const errors = createCount('project-analysis-errors');
    const warnings = createCount('project-analysis-warnings');
    const unreachable = createCount('project-analysis-unreachable');
    const missing = createCount('project-analysis-missing');
    for (const element of [title, pages, choices, errors, warnings, unreachable, missing]) {
        counts.appendChild(element);
    }

    const note = document.createElement('span');
    note.className = 'project-analysis-note';
    status.append(message, counts, note);

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'project-analysis-refresh';
    refresh.textContent = 'Refresh';
    refresh.title = 'Reload project analysis';
    refresh.setAttribute('aria-label', 'Refresh project analysis');
    refresh.setAttribute('aria-busy', 'false');
    summary.append(status, refresh);
    graphPanel.append(summary, graphContainer);

    let renderedHash = null;
    function render(state) {
        refresh.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
        if (state.model) {
            message.hidden = true;
            counts.hidden = false;
            if (state.model.contentHash !== renderedHash) {
                const model = state.model;
                title.textContent = `${model.project.title}:`;
                pages.textContent = countLabel(model.summary.pages, 'page');
                choices.textContent = countLabel(model.summary.choices, 'choice');
                errors.textContent = `✕ ${countLabel(model.summary.errors, 'error')}`;
                warnings.textContent = `⚠ ${countLabel(model.summary.warnings, 'warning')}`;
                unreachable.textContent = countLabel(model.summary.unreachablePages, 'unreachable page', 'unreachable pages');
                missing.textContent = countLabel(model.summary.missingTargets, 'missing target');
                renderedHash = model.contentHash;
            }
            note.textContent = ['unavailable', 'invalid', 'error'].includes(state.status)
                ? `Project analysis may be out of date. ${state.message}.`
                : '';
            return;
        }

        counts.hidden = true;
        note.textContent = '';
        message.hidden = false;
        if (state.status === 'loading' || state.status === 'idle') {
            message.textContent = 'Project analysis: loading…';
        } else if (state.status === 'unavailable') {
            message.textContent = 'Project analysis unavailable. Run the BIF extension or refresh diagnostics.';
        } else if (state.status === 'invalid') {
            message.textContent = `Project analysis could not be read: ${state.message}.`;
        } else {
            message.textContent = `Project analysis could not be loaded: ${state.message}.`;
        }
    }

    const unsubscribe = client.subscribe(render);
    const manualRefresh = () => client.requestRefresh('manual');
    refresh.addEventListener('click', manualRefresh);
    client.start();

    return {
        refresh: manualRefresh,
        dispose() {
            refresh.removeEventListener('click', manualRefresh);
            unsubscribe();
            client.dispose();
        },
    };
}
