function diagnosticKey(item) {
    return [item.severity, item.code, item.file, item.line, item.column, item.message].join('|');
}

export function createProblemsView({ graphContainer, onSelect }) {
    const panel = document.querySelector('#graph-panel');
    const summary = document.querySelector('#project-analysis-summary');
    const refresh = summary.querySelector('.project-analysis-refresh');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-problems-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'project-problems');
    button.textContent = 'Problems (0)';
    refresh.after(button);

    const drawer = document.createElement('section');
    drawer.id = 'project-problems';
    drawer.hidden = true;
    drawer.setAttribute('aria-label', 'Project problems');
    const list = document.createElement('ul');
    list.className = 'project-problems-list';
    drawer.append(list);
    panel.append(drawer);

    const limited = document.createElement('aside');
    limited.id = 'limited-analysis-notice';
    limited.hidden = true;
    limited.setAttribute('role', 'status');
    limited.tabIndex = 0;
    limited.textContent = 'Live project analysis unavailable — showing a limited play graph. Unreachable pages, missing targets, groups, and diagnostics may be incomplete. Enable the BIF extension or run: npm run analysis -- --watch';
    panel.insertBefore(limited, graphContainer);

    let problems = [];
    function selectProblem(structuralId) {
        const index = problems.findIndex(problem => problem.structuralId === structuralId);
        if (index < 0) return false;
        drawer.hidden = false;
        button.setAttribute('aria-expanded', 'true');
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
        button.textContent = `Problems (${problems.length})`;
        button.disabled = false;
        list.replaceChildren();
        for (const problem of problems) {
            const item = document.createElement('li');
            const control = document.createElement('button');
            control.type = 'button';
            control.className = `project-problem ${problem.diagnostic.severity}`;
            const icon = problem.diagnostic.severity === 'error' ? '✕' : '⚠';
            const location = `${problem.diagnostic.file}:${problem.diagnostic.line}:${problem.diagnostic.column}`;
            control.textContent = `${icon} ${problem.diagnostic.severity}: ${problem.diagnostic.message} — ${location}`;
            control.addEventListener('click', () => {
                for (const other of list.querySelectorAll('.project-problem')) other.classList.remove('selected');
                control.classList.add('selected');
                if (problem.structuralId) onSelect(problem.structuralId);
            });
            item.append(control);
            list.append(item);
        }
        if (!problems.length) {
            drawer.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        }
    }

    button.addEventListener('click', () => {
        if (button.disabled) return;
        drawer.hidden = !drawer.hidden;
        button.setAttribute('aria-expanded', String(!drawer.hidden));
    });

    return {
        render,
        selectProblem,
        showLimited(show) {
            limited.hidden = !show;
            button.disabled = show;
            if (show) {
                drawer.hidden = true;
                button.setAttribute('aria-expanded', 'false');
                button.textContent = 'Problems unavailable';
            }
        },
    };
}
