(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BifChoiceResults = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    function isInternalTarget(target) {
        return Boolean(target) && !target.startsWith('#') && !target.includes('/') && !/^[a-z][a-z\d+.-]*:/i.test(target);
    }

    function classifyChoiceTarget(rawTarget) {
        if (rawTarget === '.') return { kind: 'local', target: null, rawTarget: '.' };
        return { kind: 'page', target: rawTarget, rawTarget };
    }

    function matchingClose(tokens, start) {
        let depth = 0;
        for (let index = start; index < tokens.length; index += 1) {
            depth += tokens[index].nesting;
            if (depth === 0) return index;
        }
        return -1;
    }

    function choiceIdentity(pageId, line, ordinal) {
        return `choice-${encodeURIComponent(String(pageId))}-${line}-${ordinal}`;
    }

    function attrs(token) {
        return Object.fromEntries(token?.attrs || []);
    }

    function parseChoiceResults(source, tokens, pageId = '') {
        const lines = source.split('\n');
        const choices = [];
        let ordinal = 0;
        for (let open = 0; open < tokens.length; open += 1) {
            const item = tokens[open];
            if (item.type !== 'list_item_open') continue;
            const close = matchingClose(tokens, open);
            if (close < 0) continue;
            let inlineIndex = -1;
            let link = null;
            for (let index = open + 1; index < close; index += 1) {
                const token = tokens[index];
                if (token.type !== 'inline' || token.level !== item.level + 2) continue;
                inlineIndex = index;
                const children = token.children || [];
                const linkIndex = children.findIndex(child => child.type === 'link_open' && isInternalTarget(child.attrGet('href') || ''));
                if (linkIndex >= 0) {
                    const opening = children[linkIndex];
                    const text = [];
                    for (let cursor = linkIndex + 1; cursor < children.length && children[cursor].type !== 'link_close'; cursor += 1) text.push(children[cursor].content);
                    link = { token: opening, target: opening.attrGet('href') || '', text: text.join('') };
                }
                break;
            }
            if (!link) { open = close; continue; }

            ordinal += 1;
            const line = (item.map?.[0] ?? tokens[inlineIndex].map?.[0] ?? 0) + 1;
            const identity = choiceIdentity(pageId, line, ordinal);
            item.attrSet('data-bif-choice-id', identity);
            item.attrSet('data-bif-choice-target', link.target);
            const itemAttributes = attrs(item);
            const linkAttributes = attrs(link.token);
            const condition = linkAttributes.condition ?? itemAttributes.condition ?? null;
            const label = linkAttributes.label ?? itemAttributes.label ?? null;

            let leadClose = inlineIndex + 1;
            while (leadClose < close && tokens[leadClose].type !== 'paragraph_close') leadClose += 1;
            const resultStartIndex = leadClose < close ? leadClose + 1 : close;
            const resultTokens = tokens.slice(resultStartIndex, close);
            const mapped = resultTokens.filter(token => Array.isArray(token.map));
            const resultStart = mapped.length ? Math.min(...mapped.map(token => token.map[0])) : null;
            const resultEnd = mapped.length ? Math.max(...mapped.map(token => token.map[1])) : null;
            const resultMarkdown = resultStart === null ? '' : lines.slice(resultStart, resultEnd).map(value => value.replace(/^ {4}/, '')).join('\n').trimEnd();
            const nestedChoices = [];
            for (const token of resultTokens) {
                for (const child of token.children || []) {
                    if (child.type === 'link_open' && isInternalTarget(child.attrGet('href') || '')) nestedChoices.push(child.attrGet('href'));
                }
            }
            const classifiedTarget = classifyChoiceTarget(link.target);
            choices.push({
                identity, ordinal, line, ...classifiedTarget, text: link.text,
                local: classifiedTarget.kind === 'local', condition, label,
                resultMarkdown, resultStartLine: resultStart === null ? null : resultStart + 1,
                resultEndLine: resultEnd, hasResult: resultMarkdown.trim().length > 0,
                nestedChoices,
            });
            open = close;
        }
        return choices;
    }

    function tokensWithoutChoiceResults(tokens, choices) {
        const result = tokens.slice();
        for (let open = 0; open < result.length; open += 1) {
            if (result[open].type !== 'list_item_open' || !result[open].attrGet('data-bif-choice-id')) continue;
            const close = matchingClose(result, open);
            let paragraphClose = open + 1;
            while (paragraphClose < close && result[paragraphClose].type !== 'paragraph_close') paragraphClose += 1;
            if (paragraphClose < close) result.splice(paragraphClose + 1, close - paragraphClose - 1);
        }
        return result;
    }

    return { isInternalTarget, classifyChoiceTarget, choiceIdentity, parseChoiceResults, tokensWithoutChoiceResults };
});
