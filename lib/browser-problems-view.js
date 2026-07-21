function diagnosticKey(item) {
    return [item.severity, item.code, item.file, item.line, item.column, item.message].join('|');
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
        const associations = new Map();
        for (const node of structure.nodes.filter(node => node.kind === 'missing')) for (const diagnostic of node.diagnostics) associations.set(diagnosticKey(diagnostic), node.nodeId);
        for (const edge of structure.edges) for (const diagnostic of edge.diagnostics) if (!associations.has(diagnosticKey(diagnostic))) associations.set(diagnosticKey(diagnostic), edge.edgeId);
        for (const node of structure.nodes) for (const diagnostic of node.diagnostics) if (!associations.has(diagnosticKey(diagnostic))) associations.set(diagnosticKey(diagnostic), node.nodeId);
        problems = structure.diagnostics.map(diagnostic => ({ diagnostic, structuralId: associations.get(diagnosticKey(diagnostic)) ?? null }));
        problemsTab.textContent = `Problems (${problems.length})`;
        list.replaceChildren();
        for (const problem of problems) {
            const item = document.createElement('li');
            const control = document.createElement('button');
            control.type = 'button';
            control.className = `project-problem ${problem.diagnostic.severity}`;
            const icon = problem.diagnostic.severity === 'error' ? '✕' : '⚠';
            control.textContent = `${icon} ${problem.diagnostic.severity}: ${problem.diagnostic.message} — ${problem.diagnostic.file}:${problem.diagnostic.line}:${problem.diagnostic.column}`;
            control.addEventListener('click', () => {
                for (const other of list.querySelectorAll('.project-problem')) other.classList.remove('selected');
                control.classList.add('selected');
                if (problem.structuralId) onSelect(problem.structuralId);
            });
            item.append(control);
            list.append(item);
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
