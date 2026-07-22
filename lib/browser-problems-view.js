import { buildSourceSnippet, renderSourceSnippet, safeSourcePath } from './browser-source-snippet.js';
import { createIcon } from './browser-icons.js';

function diagnosticKey(item) {
    return [item.severity, item.code, item.file, item.line, item.column, item.message].join('|');
}

const severityOrder = { error: 0, warning: 1, information: 2, info: 2, hint: 3 };

function compareDiagnostics(left, right) {
    const a = left.diagnostic;
    const b = right.diagnostic;
    return String(a.file || '').localeCompare(String(b.file || ''), undefined, { numeric: true })
        || (Number.isInteger(a.line) ? a.line : Number.MAX_SAFE_INTEGER) - (Number.isInteger(b.line) ? b.line : Number.MAX_SAFE_INTEGER)
        || (Number.isInteger(a.column) ? a.column : Number.MAX_SAFE_INTEGER) - (Number.isInteger(b.column) ? b.column : Number.MAX_SAFE_INTEGER)
        || (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)
        || String(a.code || '').localeCompare(String(b.code || ''))
        || String(a.message || '').localeCompare(String(b.message || ''));
}

function locationText(diagnostic) {
    return [diagnostic.file, diagnostic.line, diagnostic.column].filter(value => value !== undefined && value !== null && value !== '').join(':');
}

function displayMessage(diagnostic) {
    return Number.isInteger(diagnostic.line) ? `${diagnostic.message} (line ${diagnostic.line})` : diagnostic.message;
}

function accessibleDiagnosticText(diagnostic) {
    const location = [diagnostic.file, Number.isInteger(diagnostic.line) && `line ${diagnostic.line}`, Number.isInteger(diagnostic.column) && `column ${diagnostic.column}`].filter(Boolean).join(', ');
    return location ? `${location}: ${diagnostic.message}` : diagnostic.message;
}

export function createProblemsView({ graphContainer, stateContainer, onSelect, uiState = null }) {
    const graphPanel = document.querySelector('#graph-panel');
    const inspector = document.createElement('section');
    inspector.id = 'development-inspector';
    inspector.setAttribute('aria-label', 'Development inspector');

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'development-inspector-resize';
    resizeHandle.tabIndex = 0;
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-label', 'Resize development inspector');
    resizeHandle.setAttribute('aria-orientation', 'horizontal');
    const header = document.createElement('div');
    header.className = 'development-inspector-header';
    const tabs = document.createElement('div');
    tabs.className = 'development-inspector-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Development information');
    const problemsTab = document.createElement('button');
    problemsTab.type = 'button';
    problemsTab.id = 'problems-tab';
    problemsTab.setAttribute('role', 'tab');
    problemsTab.setAttribute('aria-controls', 'project-problems');
    problemsTab.textContent = 'Problems (0)';
    const stateTab = document.createElement('button');
    stateTab.type = 'button';
    stateTab.id = 'state-tab';
    stateTab.setAttribute('role', 'tab');
    stateTab.setAttribute('aria-controls', 'development-state');
    stateTab.textContent = 'State';
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'development-inspector-collapse';
    collapse.setAttribute('aria-expanded', 'true');
    collapse.textContent = 'Collapse';
    tabs.append(problemsTab, stateTab);
    header.append(tabs, collapse);

    const problemsPanel = document.createElement('div');
    problemsPanel.id = 'project-problems';
    problemsPanel.setAttribute('role', 'tabpanel');
    problemsPanel.setAttribute('aria-labelledby', problemsTab.id);
    const list = document.createElement('ul');
    list.className = 'project-problems-list';
    problemsPanel.append(list);

    const statePanel = document.createElement('div');
    statePanel.id = 'development-state';
    statePanel.setAttribute('role', 'tabpanel');
    statePanel.setAttribute('aria-labelledby', stateTab.id);
    statePanel.append(stateContainer);
    inspector.append(resizeHandle, header, problemsPanel, statePanel);
    graphPanel.append(inspector);

    const limited = document.createElement('aside');
    limited.id = 'limited-analysis-notice';
    limited.hidden = true;
    limited.setAttribute('role', 'status');
    limited.tabIndex = 0;
    limited.textContent = 'Analysis unavailable — showing a limited graph. Unreachable pages, missing targets, groups, and diagnostics may be incomplete. Enable the BIF extension or run: npm run analysis -- --watch';
    graphPanel.insertBefore(limited, graphContainer);

    let problems = [];
    let selectedTab = ['problems', 'state'].includes(uiState?.get('selectedTab')) ? uiState.get('selectedTab') : 'state';
    let collapsed = Boolean(uiState?.get('collapsed', false));
    let diagnosticSignature = uiState?.get('diagnosticSignature', '');
    let analysisHash = null;
    let expandedHeight = Number(uiState?.get('inspectorHeight', 224)) || 224;
    const sourceCache = new Map();
    let pendingSources = [];

    async function loadSource(problem, host) {
        const safePath = safeSourcePath(problem.diagnostic.file);
        if (!safePath) {
            host.textContent = 'Source unavailable: invalid relative path.';
            return;
        }
        const key = `${analysisHash}:${problem.diagnostic.file}`;
        if (!sourceCache.has(key)) {
            sourceCache.set(key, fetch(`./${safePath}`, { cache: 'no-store' }).then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            }));
        }
        host.textContent = 'Loading source…';
        try {
            const source = await sourceCache.get(key);
            if (!host.isConnected) return;
            host.replaceChildren(renderSourceSnippet(buildSourceSnippet(source, problem.diagnostic), problem.diagnostic.file));
        } catch {
            sourceCache.delete(key);
            host.textContent = 'Source could not be loaded. The file may have changed since analysis.';
        }
    }

    function heightBounds() {
        const panelHeight = graphPanel.clientHeight;
        return { min: 160, max: Math.max(160, Math.floor(panelHeight * 0.65)) };
    }

    function setInspectorHeight(value) {
        const bounds = heightBounds();
        expandedHeight = Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
        inspector.style.setProperty('--inspector-height', `${expandedHeight}px`);
        resizeHandle.setAttribute('aria-valuemin', String(bounds.min));
        resizeHandle.setAttribute('aria-valuemax', String(bounds.max));
        resizeHandle.setAttribute('aria-valuenow', String(expandedHeight));
        uiState?.set('inspectorHeight', expandedHeight);
    }

    function updateView() {
        inspector.classList.toggle('collapsed', collapsed);
        resizeHandle.setAttribute('aria-disabled', String(collapsed));
        collapse.setAttribute('aria-expanded', String(!collapsed));
        collapse.textContent = collapsed ? 'Expand' : 'Collapse';
        for (const [name, tab, panel] of [['problems', problemsTab, problemsPanel], ['state', stateTab, statePanel]]) {
            const selected = name === selectedTab;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            panel.hidden = collapsed || !selected;
        }
        if (!collapsed && selectedTab === 'problems') {
            for (const entry of pendingSources) if (!entry.host.dataset.loading) {
                entry.host.dataset.loading = 'true';
                void loadSource(entry.problem, entry.host);
            }
        }
    }

    function chooseTab(name, { expand = true } = {}) {
        selectedTab = name;
        if (expand) collapsed = false;
        uiState?.set('selectedTab', selectedTab, { immediate: true });
        uiState?.set('collapsed', collapsed, { immediate: true });
        updateView();
    }

    function selectProblem(structuralId) {
        const index = problems.findIndex(problem => problem.structuralId === structuralId);
        if (index < 0) return false;
        chooseTab('problems');
        for (const item of list.querySelectorAll('.project-problem')) item.classList.remove('selected');
        const control = list.querySelectorAll('.project-problem')[index];
        control.classList.add('selected');
        control.scrollIntoView({ block: 'nearest' });
        return true;
    }

    function render(structure) {
        if (analysisHash !== structure.contentHash) sourceCache.clear();
        analysisHash = structure.contentHash;
        const associations = new Map();
        for (const node of structure.nodes.filter(node => node.kind === 'missing')) for (const diagnostic of node.diagnostics) associations.set(diagnosticKey(diagnostic), node.nodeId);
        for (const edge of structure.edges) for (const diagnostic of edge.diagnostics) if (!associations.has(diagnosticKey(diagnostic))) associations.set(diagnosticKey(diagnostic), edge.edgeId);
        for (const node of structure.nodes) for (const diagnostic of node.diagnostics) if (!associations.has(diagnosticKey(diagnostic))) associations.set(diagnosticKey(diagnostic), node.nodeId);
        problems = structure.diagnostics
            .map(diagnostic => ({ diagnostic, structuralId: associations.get(diagnosticKey(diagnostic)) ?? null }))
            .sort(compareDiagnostics);
        problemsTab.textContent = `Problems (${problems.length})`;
        list.replaceChildren();
        pendingSources = [];
        const groups = new Map();
        for (const problem of problems) {
            const file = problem.diagnostic.file || 'Project';
            if (!groups.has(file)) groups.set(file, []);
            groups.get(file).push(problem);
        }
        for (const [file, fileProblems] of groups) {
            const group = document.createElement('li');
            group.className = 'problem-file-group';
            const heading = document.createElement('div');
            heading.className = 'problem-file-header';
            const fileName = document.createElement('span');
            fileName.className = 'problem-file-name';
            fileName.textContent = file;
            const totals = document.createElement('span');
            totals.className = 'problem-file-counts';
            const errorCount = fileProblems.filter(problem => problem.diagnostic.severity === 'error').length;
            const warningCount = fileProblems.filter(problem => problem.diagnostic.severity === 'warning').length;
            totals.textContent = [errorCount && `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`, warningCount && `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(' · ');
            heading.append(fileName, totals);
            const rows = document.createElement('ul');
            rows.className = 'problem-file-rows';
            for (const problem of fileProblems) {
                const item = document.createElement('li');
                const rowHeading = document.createElement('div');
                rowHeading.className = 'problem-row-heading';
                const control = document.createElement('button');
                control.type = 'button';
                control.className = `project-problem severity-${problem.diagnostic.severity}`;
                const severity = document.createElement('span');
                severity.className = 'problem-severity icon-text';
                const error = problem.diagnostic.severity === 'error';
                const severityLabel = document.createElement('span');
                severityLabel.className = 'icon-label';
                severityLabel.textContent = error ? 'Error' : 'Warning';
                severity.append(createIcon(error ? 'x' : 'alert-triangle'), severityLabel);
                const message = document.createElement('span');
                message.className = 'problem-message';
                message.textContent = displayMessage(problem.diagnostic);
                control.title = accessibleDiagnosticText(problem.diagnostic);
                control.append(severity, message);
                rowHeading.append(control);
                const details = document.createElement('div');
                details.className = 'problem-details';
                const sourceHost = document.createElement('div');
                sourceHost.className = 'problem-source-host';
                details.append(sourceHost);
                control.addEventListener('click', () => {
                    for (const other of list.querySelectorAll('.project-problem')) other.classList.remove('selected');
                    control.classList.add('selected');
                    if (problem.structuralId) onSelect(problem.structuralId);
                });
                item.append(rowHeading, details);
                rows.append(item);
                pendingSources.push({ problem, host: sourceHost });
            }
            group.append(heading, rows);
            list.append(group);
        }
        const nextSignature = problems.map(problem => diagnosticKey(problem.diagnostic)).join('\n');
        if (nextSignature && nextSignature !== diagnosticSignature) chooseTab('problems');
        diagnosticSignature = nextSignature;
        uiState?.set('diagnosticSignature', diagnosticSignature);
        updateView();
    }

    for (const [tab, name] of [[problemsTab, 'problems'], [stateTab, 'state']]) {
        tab.addEventListener('click', () => chooseTab(name));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = name === 'problems' ? stateTab : problemsTab;
            chooseTab(name === 'problems' ? 'state' : 'problems');
            next.focus();
        });
    }
    collapse.addEventListener('click', () => {
        collapsed = !collapsed;
        uiState?.set('collapsed', collapsed, { immediate: true });
        updateView();
    });
    resizeHandle.addEventListener('keydown', event => {
        if (collapsed) return;
        const bounds = heightBounds();
        const step = event.shiftKey ? 40 : 10;
        const next = event.key === 'ArrowUp' ? expandedHeight + step
            : event.key === 'ArrowDown' ? expandedHeight - step
                : event.key === 'Home' ? bounds.min
                    : event.key === 'End' ? bounds.max : null;
        if (next === null) return;
        event.preventDefault();
        setInspectorHeight(next);
    });
    resizeHandle.addEventListener('pointerdown', event => {
        if (collapsed || event.button !== 0) return;
        const startY = event.clientY;
        const startHeight = expandedHeight;
        resizeHandle.setPointerCapture(event.pointerId);
        const move = moveEvent => setInspectorHeight(startHeight + startY - moveEvent.clientY);
        const finish = finishEvent => {
            if (resizeHandle.hasPointerCapture(finishEvent.pointerId)) resizeHandle.releasePointerCapture(finishEvent.pointerId);
            resizeHandle.removeEventListener('pointermove', move);
            resizeHandle.removeEventListener('pointerup', finish);
            resizeHandle.removeEventListener('pointercancel', finish);
        };
        resizeHandle.addEventListener('pointermove', move);
        resizeHandle.addEventListener('pointerup', finish);
        resizeHandle.addEventListener('pointercancel', finish);
    });
    window.addEventListener('resize', () => setInspectorHeight(expandedHeight));
    const restoreScroll = (element, name) => {
        element.scrollTop = Math.max(0, Number(uiState?.get(name, 0)) || 0);
        element.addEventListener('scroll', () => uiState?.set(name, element.scrollTop), { passive: true });
    };
    restoreScroll(problemsPanel, 'problemsScrollTop');
    restoreScroll(statePanel, 'stateScrollTop');
    restoreScroll(graphContainer, 'graphScrollTop');
    setInspectorHeight(expandedHeight);
    updateView();

    return {
        render,
        selectProblem,
        showLimited(show) {
            limited.hidden = !show;
            problemsTab.disabled = show;
            if (show && selectedTab === 'problems') chooseTab('state', { expand: false });
        },
    };
}
