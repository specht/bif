(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BifStoryMetadata = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    const FALLBACK_TITLE = 'Untitled story';

    function unquote(value) {
        const trimmed = value.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            try { return JSON.parse(trimmed); } catch { return null; }
        }
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
        return trimmed;
    }

    function firstH1(markdown) {
        let fenced = false;
        let comment = false;
        const lines = markdown.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
            if (fenced) continue;
            if (line.includes('<!--')) comment = true;
            if (!comment) {
                const atx = line.match(/^ {0,3}#(?!#)\s+(.+?)\s*#*\s*$/);
                if (atx) return atx[1].trim();
                if (line.trim() && /^ {0,3}=+\s*$/.test(lines[index + 1] || '')) return line.trim();
            }
            if (line.includes('-->')) comment = false;
        }
        return null;
    }

    function resolveStoryMetadata(input, options = {}) {
        const sourcePath = options.sourcePath || '1.md';
        let markdown = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        const warnings = [];
        let frontMatterTitle = null;
        if (markdown.startsWith('---\n')) {
            const end = markdown.indexOf('\n---\n', 4);
            if (end < 0) warnings.push(`Malformed title front matter in ${sourcePath}; expected a closing ---.`);
            else {
                const metadata = markdown.slice(4, end).split('\n');
                const titleLine = metadata.find(line => /^title\s*:/.test(line));
                if (titleLine) frontMatterTitle = unquote(titleLine.replace(/^title\s*:/, ''));
                if (titleLine && !frontMatterTitle) warnings.push(`Malformed title value in ${sourcePath}.`);
                const prefix = markdown.slice(0, end + 5);
                markdown = '\n'.repeat((prefix.match(/\n/g) || []).length) + markdown.slice(end + 5);
            }
        }
        const heading = firstH1(markdown);
        const title = frontMatterTitle || heading || FALLBACK_TITLE;
        if (!frontMatterTitle && !heading) warnings.push(`No game title found in ${sourcePath}. Add a front-matter title or a level-one heading. Using “${FALLBACK_TITLE}”.`);
        return { title, titleSource: frontMatterTitle ? 'front-matter' : heading ? 'h1' : 'fallback', bodyMarkdown: markdown, warnings };
    }
    return { FALLBACK_TITLE, resolveStoryMetadata };
});
