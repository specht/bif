const CONTEXT_LINES = 2;

export function safeSourcePath(file) {
    if (typeof file !== 'string' || !file || file.startsWith('/') || file.startsWith('\\') || /^[a-z]:[\\/]/i.test(file) || /^[a-z][a-z\d+.-]*:/i.test(file)) return null;
    let decoded;
    try { decoded = decodeURIComponent(file); } catch { return null; }
    if (decoded.startsWith('//') || decoded.split(/[\\/]/).some(part => part === '..' || part === '')) return null;
    return decoded.split('/').map(encodeURIComponent).join('/');
}

function expandTabs(value, tabSize = 4) {
    let column = 0;
    let result = '';
    for (const character of value) {
        if (character === '\t') {
            const spaces = tabSize - (column % tabSize);
            result += ' '.repeat(spaces);
            column += spaces;
        } else {
            result += character;
            column += 1;
        }
    }
    return result;
}

export function buildSourceSnippet(source, diagnostic, contextLines = CONTEXT_LINES) {
    const sourceLines = String(source).replace(/\r\n?/g, '\n').split('\n');
    const requestedLine = Number.isInteger(diagnostic.line) ? diagnostic.line : 1;
    const stale = requestedLine < 1 || requestedLine > sourceLines.length;
    const diagnosticLine = Math.min(Math.max(requestedLine, 1), Math.max(sourceLines.length, 1));
    const startLine = Math.max(1, diagnosticLine - contextLines);
    const endLine = Math.min(sourceLines.length, diagnosticLine + contextLines);
    const rawColumn = Number.isInteger(diagnostic.column) ? Math.max(1, diagnostic.column) : 1;
    const rawEnd = Number.isInteger(diagnostic.endColumn) ? Math.max(rawColumn + 1, diagnostic.endColumn) : rawColumn + 1;
    const diagnosticSource = sourceLines[diagnosticLine - 1] || '';
    const visualColumn = expandTabs(diagnosticSource.slice(0, rawColumn - 1)).length + 1;
    const visualEndColumn = expandTabs(diagnosticSource.slice(0, rawEnd - 1)).length + 1;
    return {
        startLine,
        endLine,
        diagnosticLine,
        diagnosticColumn: visualColumn,
        diagnosticEndColumn: Math.max(visualColumn + 1, visualEndColumn),
        stale,
        lines: sourceLines.slice(startLine - 1, endLine).map(expandTabs),
    };
}

function appendToken(parent, text, className) {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    parent.append(span);
}

export function renderHighlightedSource(parent, text, file) {
    const markdown = /\.md$/i.test(file);
    const pattern = markdown
        ? /(^#{1,6}\s.*$|```[^`]*|`[^`]*`|\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|\/\/.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:await|const|let|var|if|else|return|async|function|true|false|null|new|throw|try|catch)\b|\b\d+(?:\.\d+)?\b)/gm
        : /(\/\/.*$|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:await|const|let|var|if|else|return|async|function|true|false|null|new|throw|try|catch)\b|\b\d+(?:\.\d+)?\b)/gm;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
        appendToken(parent, text.slice(offset, match.index));
        const token = match[0];
        const className = markdown
            ? token.startsWith('#') ? 'token-heading'
                : token.startsWith('`') ? 'token-code'
                    : token.startsWith('[') ? 'token-link'
                        : token.startsWith('**') ? 'token-emphasis'
                            : token.startsWith('//') ? 'token-comment'
                                : /^['"]/.test(token) ? 'token-string'
                                    : /^\d/.test(token) ? 'token-number'
                                        : 'token-keyword'
            : token.startsWith('//') || token.startsWith('/*') ? 'token-comment' : /^['"]/.test(token) ? 'token-string' : /^\d/.test(token) ? 'token-number' : 'token-keyword';
        appendToken(parent, token, className);
        offset = match.index + token.length;
    }
    appendToken(parent, text.slice(offset));
}

export function renderSourceSnippet(model, file) {
    const container = document.createElement('div');
    container.className = 'problem-source-snippet';
    if (model.stale) {
        const warning = document.createElement('p');
        warning.className = 'problem-source-note';
        warning.textContent = 'The reported line is outside the current file; showing the nearest available source.';
        container.append(warning);
    }
    const code = document.createElement('div');
    code.className = 'problem-source-code';
    model.lines.forEach((line, index) => {
        const lineNumber = model.startLine + index;
        const row = document.createElement('div');
        row.className = 'problem-source-line';
        const number = document.createElement('span');
        number.className = 'problem-source-line-number';
        number.textContent = String(lineNumber);
        const source = document.createElement('code');
        source.className = 'problem-source-text';
        renderHighlightedSource(source, line, file);
        row.append(number, source);
        code.append(row);
        if (lineNumber === model.diagnosticLine) {
            const marker = document.createElement('div');
            marker.className = 'problem-source-line problem-source-marker';
            const spacer = document.createElement('span');
            const caret = document.createElement('code');
            caret.textContent = `${' '.repeat(model.diagnosticColumn - 1)}${'^'.repeat(Math.max(1, model.diagnosticEndColumn - model.diagnosticColumn))}`;
            marker.append(spacer, caret);
            code.append(marker);
        }
    });
    container.append(code);
    return container;
}
