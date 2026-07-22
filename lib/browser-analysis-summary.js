import { createIcon } from './browser-icons.js';

function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function createCount(className) {
    const element = document.createElement('span');
    element.className = `project-analysis-count ${className}`;
    return element;
}

function replaceIconText(element, iconName, label) {
    const text = document.createElement('span');
    text.className = 'icon-label';
    text.textContent = label;
    element.replaceChildren(createIcon(iconName), text);
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

    const titleRow = document.createElement('div');
    titleRow.className = 'development-title-row';
    const summaryItems = document.createElement('div');
    summaryItems.className = 'development-summary-items';

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
    const pages = createCount('project-analysis-pages');
    const choices = createCount('project-analysis-choices');
    const errors = createCount('project-analysis-errors');
    const warnings = createCount('project-analysis-warnings');
    const unreachable = createCount('project-analysis-unreachable');
    const missing = createCount('project-analysis-missing');
    const clean = createCount('project-analysis-clean severity-success');
    errors.classList.add('icon-text');
    warnings.classList.add('icon-text');
    clean.classList.add('icon-text');
    for (const element of [pages, choices, errors, warnings, unreachable, missing, clean]) {
        counts.appendChild(element);
    }

    const note = document.createElement('span');
    note.className = 'project-analysis-note';
    status.append(message, note);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'project-analysis-retry';
    retry.textContent = 'Retry';
    retry.title = 'Retry project analysis';
    retry.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'development-toolbar-actions';
    actions.append(retry);
    summaryItems.append(counts);
    titleRow.append(summaryItems, actions);
    summary.append(titleRow, status);
    graphPanel.append(summary, graphContainer);

    let renderedHash = null;
    function render(state) {
        retry.hidden = !['unavailable', 'invalid', 'error'].includes(state.status);
        if (state.model) {
            message.hidden = true;
            counts.hidden = false;
            const identity = state.model.analysisHash || state.lastHash;
            if (identity !== renderedHash) {
                const model = state.model;
                pages.textContent = countLabel(model.summary.pages, 'page');
                choices.textContent = countLabel(model.summary.choices, 'choice');
                replaceIconText(errors, 'x', countLabel(model.summary.errors, 'error'));
                replaceIconText(warnings, 'alert-triangle', countLabel(model.summary.warnings, 'warning'));
                unreachable.textContent = countLabel(model.summary.unreachablePages, 'unreachable page', 'unreachable pages');
                missing.textContent = countLabel(model.summary.missingTargets, 'missing target');
                errors.hidden = model.summary.errors === 0;
                warnings.hidden = model.summary.warnings === 0;
                unreachable.hidden = model.summary.unreachablePages === 0;
                missing.hidden = model.summary.missingTargets === 0;
                clean.hidden = [model.summary.errors, model.summary.warnings, model.summary.unreachablePages, model.summary.missingTargets].some(Boolean);
                replaceIconText(clean, 'check', 'No problems');
                renderedHash = identity;
            }
            note.textContent = ['unavailable', 'invalid', 'error'].includes(state.status)
                ? `Project analysis may be out of date. ${state.message}.`
                : '';
            status.hidden = note.textContent.length === 0;
            return;
        }

        status.hidden = false;
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
    retry.addEventListener('click', manualRefresh);
    client.start();

    return {
        refresh: manualRefresh,
        dispose() {
            retry.removeEventListener('click', manualRefresh);
            unsubscribe();
            client.dispose();
        },
    };
}
