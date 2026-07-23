export const REVEAL_LONG_TEXT_THRESHOLD = 180;
export const REVEAL_SENTENCES_PER_CHUNK = 2;
export const REVEAL_FADE_MS = 180;
export const REVEAL_MIN_DELAY_MS = 80;
export const REVEAL_MAX_DELAY_MS = 150;
export const REVEAL_CHOICE_DELAY_MS = 170;
export const REVEAL_FOLLOW_TOLERANCE_PX = 72;

const WHOLE_BLOCKS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'FIGURE', 'UL', 'OL', 'TABLE', 'HR', 'PRE']);
const COMMON_ABBREVIATION_END = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|bzw|usw|etc)\.\s*$/i;

function mergeAbbreviationSegments(segments) {
    const merged = [];
    for (const segment of segments) {
        if (merged.length && COMMON_ABBREVIATION_END.test(merged.at(-1))) merged[merged.length - 1] += segment;
        else merged.push(segment);
    }
    return merged;
}

export function sentenceSegments(text, locale = document.documentElement.lang || navigator.language, Segmenter = Intl?.Segmenter) {
    const source = String(text || '');
    if (!source.trim()) return [];
    if (typeof Segmenter !== 'function') return [source];
    try {
        return mergeAbbreviationSegments([...new Segmenter(locale, { granularity: 'sentence' }).segment(source)]
            .map(item => item.segment)
            .filter(segment => segment.trim()));
    } catch {
        return [source];
    }
}

function splitPlainProse(element, locale) {
    if (element.textContent.length <= REVEAL_LONG_TEXT_THRESHOLD) return [element];
    if ([...element.childNodes].some(node => node.nodeType !== Node.TEXT_NODE)) return [element];
    const sentences = sentenceSegments(element.textContent, locale);
    if (sentences.length < 3) return [element];
    const units = [];
    element.replaceChildren();
    for (let index = 0; index < sentences.length; index += REVEAL_SENTENCES_PER_CHUNK) {
        const span = document.createElement('span');
        span.className = 'story-reveal-prose-group';
        span.textContent = sentences.slice(index, index + REVEAL_SENTENCES_PER_CHUNK).join('');
        element.append(span);
        units.push(span);
    }
    return units;
}

function blockUnits(block, locale) {
    if (block.matches?.('.live-choice-set, .story-choice')) return [block];
    if (block.tagName === 'P') return splitPlainProse(block, locale);
    if (block.tagName === 'BLOCKQUOTE') {
        if (block.textContent.length <= REVEAL_LONG_TEXT_THRESHOLD) return [block];
        const children = [...block.children];
        if (children.length && children.every(child => child.tagName === 'P')) {
            return children.flatMap(child => splitPlainProse(child, locale));
        }
        return [block];
    }
    if (WHOLE_BLOCKS.has(block.tagName)) return [block];
    return [block];
}

function meaningfulChildren(root) {
    return [...root.children].filter(child => !child.matches('script, style') && !child.hidden);
}

export function planPageReveal(passage, { locale = document.documentElement.lang || navigator.language } = {}) {
    const liveSet = passage.querySelector(':scope > .live-choice-set');
    const blocks = meaningfulChildren(passage).filter(block => block !== liveSet);
    return [...blocks.flatMap(block => blockUnits(block, locale)), ...(liveSet ? [liveSet] : [])];
}

export function planLocalTurnReveal(turn, liveSet, { locale = document.documentElement.lang || navigator.language } = {}) {
    if (!turn) return liveSet ? [liveSet] : [];
    const choice = turn.querySelector(':scope > li > .story-choice, :scope > .story-choice, .story-choice');
    const result = turn.querySelector(':scope > .choice-result, .choice-result');
    const resultUnits = result ? meaningfulChildren(result).flatMap(block => blockUnits(block, locale)) : [];
    return [...(choice ? [choice] : []), ...resultUnits, ...(liveSet ? [liveSet] : [])];
}

function delayFor(unit, isLast) {
    if (isLast && unit.classList.contains('live-choice-set')) return REVEAL_CHOICE_DELAY_MS;
    return Math.min(REVEAL_MAX_DELAY_MS, Math.max(REVEAL_MIN_DELAY_MS, 70 + unit.textContent.trim().length * 0.25));
}

function setUnitState(unit, state) {
    unit.dataset.revealState = state;
    if (state === 'pending') {
        unit.setAttribute('aria-hidden', 'true');
        unit.inert = true;
    } else {
        unit.removeAttribute('aria-hidden');
        unit.inert = false;
    }
}

export function createStoryRevealController({ eventTarget, reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
    let run = null;

    function finish({ scroll = true } = {}) {
        if (!run) return false;
        const current = run;
        run = null;
        clearTimeout(current.timer);
        for (const unit of current.units) setUnitState(unit, 'visible');
        current.cleanup();
        if (scroll) current.onFinish?.();
        return true;
    }

    function cancel({ reveal = true } = {}) {
        if (!run) return;
        if (reveal) finish({ scroll: false });
        else {
            const current = run;
            run = null;
            clearTimeout(current.timer);
            current.cleanup();
        }
    }

    function start({ units, scroller, onFinish, onReveal } = {}) {
        cancel();
        const connected = (units || []).filter(unit => unit?.isConnected);
        if (!connected.length || reducedMotion()) {
            for (const unit of connected) setUnitState(unit, 'visible');
            onFinish?.();
            return Promise.resolve();
        }
        for (const unit of connected) setUnitState(unit, 'pending');
        let resolveRun;
        const promise = new Promise(resolve => { resolveRun = resolve; });
        let autoFollow = true;
        let programmaticScroll = false;
        const stopFollowing = () => { if (!programmaticScroll) autoFollow = false; };
        const skipPointer = event => {
            if (!run) return;
            if (event.target?.closest?.('.story-controls, .story-ending-actions')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            finish();
            resolveRun();
        };
        const skipKey = event => {
            if (!run || ![' ', 'Enter', 'Escape'].includes(event.key)) return;
            if (event.target?.matches?.('button, input, textarea, select, [contenteditable="true"]')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            finish();
            resolveRun();
        };
        eventTarget?.addEventListener('click', skipPointer, true);
        document.addEventListener('keydown', skipKey, true);
        scroller?.addEventListener('wheel', stopFollowing, { passive: true });
        scroller?.addEventListener('touchstart', stopFollowing, { passive: true });
        const cleanup = () => {
            eventTarget?.removeEventListener('click', skipPointer, true);
            document.removeEventListener('keydown', skipKey, true);
            scroller?.removeEventListener('wheel', stopFollowing);
            scroller?.removeEventListener('touchstart', stopFollowing);
        };
        run = { units: connected, timer: null, cleanup, onFinish };
        let index = 0;
        const revealNext = () => {
            if (!run || run.units !== connected) return;
            try {
                const unit = connected[index];
                setUnitState(unit, 'visible');
                requestAnimationFrame(() => {
                    if (!run || !autoFollow || !unit.isConnected || !scroller) return;
                    const viewport = scroller.getBoundingClientRect();
                    const rect = unit.getBoundingClientRect();
                    const comfortablyFits = rect.height <= viewport.height - 32;
                    if (comfortablyFits && rect.bottom > viewport.bottom - 16 && rect.top < viewport.bottom + REVEAL_FOLLOW_TOLERANCE_PX) {
                        programmaticScroll = true;
                        scroller.scrollTo({ top: scroller.scrollTop + rect.bottom - viewport.bottom + 16, behavior: 'smooth' });
                        requestAnimationFrame(() => { programmaticScroll = false; });
                    }
                    onReveal?.(unit, index);
                });
                index += 1;
                if (index >= connected.length) {
                    run.timer = setTimeout(() => { finish(); resolveRun(); }, REVEAL_FADE_MS);
                } else run.timer = setTimeout(revealNext, delayFor(connected[index], index === connected.length - 1));
            } catch (error) {
                console.warn('Progressive story reveal failed; showing complete content.', error);
                finish();
                resolveRun();
            }
        };
        requestAnimationFrame(revealNext);
        return promise;
    }

    return { start, finish, cancel, get active() { return Boolean(run); } };
}
