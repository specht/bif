import { buildSourceSnippet, renderSourceSnippet, safeSourcePath } from './browser-source-snippet.js';

function diagnosticKey(item) {
    return [item.severity, item.code, item.file, item.line, item.column, item.message].join('|');
}

const severityOrder = { error: 0, warning: 1, information: 2, info: 2, hint: 3 };
const VS_CODE_EXTENSION_ID = 'gymnasiumsteglitz.bif-authoring-tools';

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

export function diagnosticSourceUri(diagnostic) {
    if (!safeSourcePath(diagnostic.file) || !Number.isInteger(diagnostic.line) || diagnostic.line < 1 || !Number.isInteger(diagnostic.column) || diagnostic.column < 1) return null;
    const parameters = new URLSearchParams({ file: diagnostic.file, line: String(diagnostic.line), column: String(diagnostic.column) });
    return `vscode://${VS_CODE_EXTENSION_ID}/open-source?${parameters}`;
}

export function createProblemsView({ graphContainer, stateContainer, onSelect }) {
    const graphPanel = document.querySelector('#graph-panel');
    const inspector = document.createElement('section');
    inspector.id = 'development-inspector';
    inspector.setAttribute('aria-label', 'Development inspector');

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
    inspector.append(header, problemsPanel, statePanel);
    graphPanel.append(inspector);

    const limited = document.createElement('aside');
    limited.id = 'limited-analysis-notice';
    limited.hidden = true;
    limited.setAttribute('role', 'status');
    limited.tabIndex = 0;
    limited.textContent = 'Analysis unavailable — showing a limited graph. Unreachable pages, missing targets, groups, and diagnostics may be incomplete. Enable the BIF extension or run: npm run analysis -- --watch';
    graphPanel.insertBefore(limited, graphContainer);

    let problems = [];
    let selectedTab = 'state';
    let collapsed = false;
    let diagnosticSignature = '';
    let analysisHash = null;
    const sourceCache = new Map();

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

    function updateView() {
        inspector.classList.toggle('collapsed', collapsed);
        collapse.setAttribute('aria-expanded', String(!collapsed));
        collapse.textContent = collapsed ? 'Expand' : 'Collapse';
        for (const [name, tab, panel] of [['problems', problemsTab, problemsPanel], ['state', stateTab, statePanel]]) {
            const selected = name === selectedTab;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            panel.hidden = collapsed || !selected;
        }
    }

    function chooseTab(name, { expand = true } = {}) {
        selectedTab = name;
        if (expand) collapsed = false;
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
                const control = document.createElement('button');
                control.type = 'button';
                control.className = `project-problem severity-${problem.diagnostic.severity}`;
                const severity = document.createElement('span');
                severity.className = 'problem-severity';
                severity.textContent = problem.diagnostic.severity === 'error' ? '✕ Error' : '⚠ Warning';
                const message = document.createElement('span');
                message.className = 'problem-message';
                message.textContent = problem.diagnostic.message;
                const location = document.createElement('span');
                location.className = 'problem-location';
                location.textContent = locationText(problem.diagnostic);
                control.append(severity, message, location);
                control.setAttribute('aria-expanded', 'false');
                const details = document.createElement('div');
                details.className = 'problem-details';
                details.hidden = true;
                const sourceHost = document.createElement('div');
                sourceHost.className = 'problem-source-host';
                const actions = document.createElement('div');
                actions.className = 'problem-actions';
                const sourceUri = diagnosticSourceUri(problem.diagnostic);
                if (sourceUri) {
                    const open = document.createElement('a');
                    open.className = 'problem-open-source';
                    open.href = sourceUri;
                    open.textContent = 'Open in VS Code';
                    open.title = 'Requires BIF Authoring Tools in VS Code';
                    open.setAttribute('aria-label', `Open ${locationText(problem.diagnostic)} in VS Code`);
                    actions.append(open);
                }
                const copy = document.createElement('button');
                copy.type = 'button';
                copy.className = 'problem-copy-location';
                copy.textContent = 'Copy location';
                copy.addEventListener('click', async event => {
                    event.stopPropagation();
                    await navigator.clipboard.writeText(locationText(problem.diagnostic));
                    copy.textContent = 'Copied';
                });
                actions.append(copy);
                details.append(actions, sourceHost);
                control.addEventListener('click', async () => {
                    for (const other of list.querySelectorAll('.project-problem')) other.classList.remove('selected');
                    control.classList.add('selected');
                    if (problem.structuralId) onSelect(problem.structuralId);
                    const opening = details.hidden;
                    details.hidden = !opening;
                    control.setAttribute('aria-expanded', String(opening));
                    if (opening && !sourceHost.hasChildNodes() && !sourceHost.textContent) await loadSource(problem, sourceHost);
                });
                item.append(control, details);
                rows.append(item);
            }
            group.append(heading, rows);
            list.append(group);
        }
        const nextSignature = problems.map(problem => diagnosticKey(problem.diagnostic)).join('\n');
        if (nextSignature && nextSignature !== diagnosticSignature) chooseTab('problems');
        diagnosticSignature = nextSignature;
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
    collapse.addEventListener('click', () => { collapsed = !collapsed; updateView(); });
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
