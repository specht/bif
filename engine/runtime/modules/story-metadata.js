(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BifStoryMetadata = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    const FALLBACK_TITLE = 'Untitled story';

    const STORY_THEMES = Object.freeze({
        default: Object.freeze({ bodyFont: 'IBM Plex Sans', headingFont: 'IBM Plex Sans', generic: 'sans-serif' }),
        paper: Object.freeze({ bodyFont: 'Literata', headingFont: 'DM Serif Display', generic: 'serif' }),
        mystery: Object.freeze({ bodyFont: 'Libre Baskerville', headingFont: 'Special Elite', generic: 'serif' }),
        midnight: Object.freeze({ bodyFont: 'Inter', headingFont: 'Space Grotesk', generic: 'sans-serif' }),
        terminal: Object.freeze({ bodyFont: 'IBM Plex Mono', headingFont: 'IBM Plex Mono', generic: 'monospace' }),
        playful: Object.freeze({ bodyFont: 'Nunito', headingFont: 'Fredoka', generic: 'sans-serif' }),
    });

    const BUNDLED_FONTS = Object.freeze(new Set(['IBM Plex Sans', 'IBM Plex Mono']));
    const KNOWN_METADATA = new Set(['title', 'theme', 'font_body', 'font_heading']);

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

    function issue(code, message, line = 1, severity = 'warning') {
        return { code, message, line, column: 1, severity };
    }

    function validFontName(value) {
        return typeof value === 'string'
            && value.length > 0
            && value.length <= 100
            && !/[\u0000-\u001f\u007f]/.test(value);
    }

    function parseFrontMatter(markdown, sourcePath) {
        const issues = [];
        const values = {};
        if (!markdown.startsWith('---\n')) return { values, bodyMarkdown: markdown, issues, hasFrontMatter: false };
        const end = markdown.indexOf('\n---\n', 4);
        if (end < 0) {
            issues.push(issue('malformed-story-metadata', `Malformed story front matter in ${sourcePath}; expected a closing ---.`));
            return { values, bodyMarkdown: markdown, issues, hasFrontMatter: true };
        }

        const lines = markdown.slice(4, end).split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const lineNumber = index + 2;
            const line = lines[index];
            if (!line.trim() || /^\s*#/.test(line)) continue;
            const match = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
            if (!match) {
                issues.push(issue('malformed-story-metadata', `Malformed story metadata in ${sourcePath} on line ${lineNumber}.`, lineNumber));
                continue;
            }
            const key = match[1].toLowerCase();
            if (!KNOWN_METADATA.has(key)) {
                issues.push(issue('unknown-story-metadata', `Unknown story metadata setting '${match[1]}' in ${sourcePath}.`, lineNumber));
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(values, key)) {
                issues.push(issue('duplicate-story-metadata', `Story metadata setting '${key}' appears more than once in ${sourcePath}.`, lineNumber));
            }
            const value = unquote(match[2]);
            if (value === null || value === '') {
                issues.push(issue('malformed-story-metadata', `Malformed value for '${key}' in ${sourcePath}.`, lineNumber));
                continue;
            }
            values[key] = { value, line: lineNumber };
        }

        const prefix = markdown.slice(0, end + 5);
        const bodyMarkdown = '\n'.repeat((prefix.match(/\n/g) || []).length) + markdown.slice(end + 5);
        return { values, bodyMarkdown, issues, hasFrontMatter: true };
    }

    function effectiveAppearance(appearance = {}) {
        const theme = STORY_THEMES[appearance.theme] ? appearance.theme : 'default';
        const defaults = STORY_THEMES[theme];
        return {
            theme,
            fontBody: appearance.fontBody || defaults.bodyFont,
            fontHeading: appearance.fontHeading || defaults.headingFont,
            generic: defaults.generic,
        };
    }

    function googleFontFamilies(appearance = {}) {
        const effective = effectiveAppearance(appearance);
        return [...new Set([effective.fontBody, effective.fontHeading].filter(font => !BUNDLED_FONTS.has(font)))];
    }

    function resolveStoryMetadata(input, options = {}) {
        const sourcePath = options.sourcePath || '1.md';
        let markdown = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        const parsed = parseFrontMatter(markdown, sourcePath);
        markdown = parsed.bodyMarkdown;
        const issues = [...parsed.issues];

        const frontMatterTitle = parsed.values.title?.value || null;
        let theme = parsed.values.theme?.value?.toLowerCase() || 'default';
        if (!STORY_THEMES[theme]) {
            const line = parsed.values.theme?.line || 1;
            issues.push(issue('unknown-theme', `Unknown theme '${parsed.values.theme?.value}'. Choose one of: ${Object.keys(STORY_THEMES).join(', ')}. Using 'default'.`, line));
            theme = 'default';
        }

        let fontBody = parsed.values.font_body?.value || null;
        let fontHeading = parsed.values.font_heading?.value || null;
        if (fontBody && !validFontName(fontBody)) {
            issues.push(issue('invalid-font-name', `Invalid body font name in ${sourcePath}.`, parsed.values.font_body.line));
            fontBody = null;
        }
        if (fontHeading && !validFontName(fontHeading)) {
            issues.push(issue('invalid-font-name', `Invalid heading font name in ${sourcePath}.`, parsed.values.font_heading.line));
            fontHeading = null;
        }

        const heading = firstH1(markdown);
        const title = frontMatterTitle || heading || FALLBACK_TITLE;
        if (!frontMatterTitle && !heading) {
            issues.push(issue('missing-story-title', `No game title found in ${sourcePath}. Add a front-matter title or a level-one heading. Using “${FALLBACK_TITLE}”.`));
        }

        const appearance = { theme, fontBody, fontHeading };
        return {
            title,
            titleSource: frontMatterTitle ? 'front-matter' : heading ? 'h1' : 'fallback',
            bodyMarkdown: markdown,
            appearance,
            effectiveAppearance: effectiveAppearance(appearance),
            issues,
            warnings: issues.map(item => item.message),
        };
    }

    return {
        FALLBACK_TITLE,
        STORY_THEMES,
        BUNDLED_FONTS,
        resolveStoryMetadata,
        effectiveAppearance,
        googleFontFamilies,
    };
});
