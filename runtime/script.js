import markdownit from './vendor/markdown-it.js';
import markdownitAttrs from './vendor/markdown-it-attrs.js';
import { resolveBrowserMode, isAuthoringEnvironment, switchBrowserMode } from './modules/browser-mode.js';
import './modules/choice-result-model.js';
import { localTurnScrollTarget } from './modules/browser-story-scroll.js';
import { createStoryRevealController, planLocalTurnReveal, planPageReveal } from './modules/browser-story-reveal.js';
import { createIcon } from './modules/browser-icons.js';
import { createHoldToConfirmControl } from './modules/hold-to-confirm.js';

let Graphviz, createBrowserAnalysisClient, mountBrowserAnalysisSummary, matchRuntimeChoices,
    createRuntimeOverlay, createUnifiedGraphView, createProblemsView, createDevelopmentUiState,
    panViewBox, pinchViewBox, zoomViewBoxAt, interpolateViewBox;

const ts = Date.now();
const config = await import(new URL(`../config.js?v=${ts}`, import.meta.url));
const { path } = config;
const storyBaseUrl = new URL(`${path.replace(/^\.\//, '').replace(/\/$/, '')}/`, document.baseURI);

const md = markdownit({ html: true, typographer: true }).use(markdownitAttrs);

const lz = {
    compress: LZString.compressToEncodedURIComponent,
    decompress: LZString.decompressFromEncodedURIComponent
};

const el = {
    html: document.querySelector('html'),
    body: document.querySelector('body'),
    devPane: document.getElementById('dev_pane'),
    devFixed: document.getElementById('dev_fixed'),
    graphContainer: document.getElementById('graph-container'),
    stateContainer: document.getElementById('state-container'),
    divider: document.getElementById('divider'),
    gamePane: document.getElementById('game_pane'),
    storyControls: document.querySelector('.story-controls'),
    endingActions: document.querySelector('.story-ending-actions'),
    content: document.getElementById('content'),
    storyStatus: document.getElementById('story-status'),
    clickedButton: null,
}

const cache_buster = `${Date.now()}`;

let history = [];
let sessionEvents = [];
const context = {};

let devMode = resolveBrowserMode() === 'dev';
let printAnchor = el.content;
let nextPageLinks = {};
let unifiedGraphView = null;
let graphStructure = null;
let graphProblems = null;
let developmentUiState = null;
let routeEdgeIds = [];
const graphMappingWarnings = new Set();
const metadataWarnings = new Set();
let deferred = null;
let choiceDiv = null;
const activeStoryTasks = new Set();
const pendingNavigations = new Map();
const replayNavigationRequests = new Map();
let navigationQueue = Promise.resolve();
let replayingHistory = false;
let currentPassageHasNavigation = false;
let restartControl = null;
let restartHoldControl = null;
let playAgainHoldControl = null;
let contextProgress = false;
let keyboardNavigationPending = false;
let graphKeyboardNavigationPending = false;
let passageSerial = 0;
let currentPassage = null;
const settledPassages = new WeakSet();
let sessionGeneration = 0;
let restoringSession = false;
let pendingSessionWrite = null;
let sessionWriteScheduled = false;
let choiceTransaction = null;
let pageInstanceSerial = 0;
const storyReveal = createStoryRevealController({ eventTarget: el.gamePane });

function sessionWasAbandoned(generation) {
    return generation !== sessionGeneration;
}

function abandonedSessionError() {
    return new DOMException('Story session was replaced', 'AbortError');
}

class StoryRuntimeError extends Error {
    constructor(kind, details, cause) {
        super(cause?.message ?? details.message ?? 'Story runtime error');
        this.name = 'StoryRuntimeError';
        this.kind = kind;
        Object.assign(this, details);
        this.cause = cause;
        this.reported = false;
    }
}

const errorLabels = {
    'page-load': 'Missing page',
    'page-script-syntax': 'Script syntax error',
    'page-script-runtime': 'Script error',
    'async-script': 'Async script error',
    condition: 'Condition error',
    expression: 'Expression error',
    navigation: 'Navigation error',
    session: 'Session error',
};

function storyError(kind, details, cause) {
    return cause instanceof StoryRuntimeError ? cause : new StoryRuntimeError(kind, details, cause);
}

function reportStoryError(error, outputParent = el.content) {
    if (error.reported) return;
    error.reported = true;
    console.error(errorLabels[error.kind] ?? 'Story error', error);

    const block = document.createElement('div');
    block.classList.add('story-error');
    if (!devMode) {
        block.textContent = 'This part of the story could not be loaded.';
    } else {
        block.append('This passage could not be completed.');
        block.append(document.createElement('br'), 'See Problems below for details.');
    }
    outputParent.appendChild(block);
}

function markdownLine(text, source, fromIndex = 0) {
    const index = text.indexOf(source, fromIndex);
    if (index < 0) return null;
    return text.slice(0, index).split('\n').length;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function presentChoice(choices, generation = sessionGeneration, outputParent = printAnchor) {
    if (sessionWasAbandoned(generation)) return Promise.reject(abandonedSessionError());
    if (choiceDiv) {
        choiceDiv.remove();
        choiceDiv = null;
    }
    const request = { generation };
    deferred = request;
    request.promise = new Promise((resolve, reject) => {
        request.resolve = (value) => {
            cleanup(request);
            resolve(value);
        };
        request.reject = (reason) => {
            cleanup(request);
            reject(reason);
        };
    });

    function cleanup(completedRequest) {
        if (deferred === completedRequest) deferred = null;
    }

    choiceDiv = document.createElement('div');
    choiceDiv.classList.add('choice');
    outputParent.appendChild(choiceDiv);
    currentPassageHasNavigation = true;

    nextPageLinks = {};
    for (let i = 0; i < choices.length; i++) {
        let button = document.createElement('button');
        button.classList.add('pagelink');
        choiceDiv.appendChild(button);

        let choice = choices[i];
        button.innerHTML = choice[1];
        nextPageLinks[`${choice[0]}`] = button;

        button.addEventListener('click', function (event) {
            if (button.classList.contains('chosen') || button.classList.contains('dismissed')) return;
            el.clickedButton = button;
            keyboardNavigationPending = event.detail === 0;
            event.preventDefault();
            event.stopPropagation();
            turnToPage(`${choice[0]}`, generation);
        });
    }

    return request.promise;
}

function createContextProxy(generation = sessionGeneration, outputParent = printAnchor) {
    return new Proxy(context, {
    has(target, key) {
        return true;
    },
    get(target, key) {
        if (key in target) {
            return target[key];
        } else if (key === 'print') {
            return function (...args) {
                if (sessionWasAbandoned(generation)) return;
                let div = document.createElement('div');
                div.innerHTML = args.map((x) => md.render(x)).join(' ') + '\n';
                outputParent.appendChild(div);
            };
        } else if (key === 'presentChoice') {
            return choices => presentChoice(choices, generation, outputParent);
        } else if (key === 'goToPage') {
            return page => goToPage(page, generation);
        } else {
            return globalThis[key];
        }
    },
    set(target, key, value) {
        if (!sessionWasAbandoned(generation)) {
            if (!restoringSession && !replayingHistory && target[key] !== value) contextProgress = true;
            target[key] = value;
        }
        return true;
    },
    });
}

const contextProxy = createContextProxy();

function resetStoryContext() {
    for (const key of Object.keys(context)) {
        delete context[key];
    }
}

function updateStateDisplay() {
    el.stateContainer.innerHTML = jsyaml.dump(sortKeys(Object.fromEntries(
        Object.entries(context).filter(([key, value]) => typeof value !== "function")
    )));
}

function snapshotStoryContext() {
    const snapshot = new Map();
    for (const [key, value] of Object.entries(context)) {
        try { snapshot.set(key, structuredClone(value)); }
        catch { snapshot.set(key, value); }
    }
    return snapshot;
}

function restoreStoryContext(snapshot) {
    for (const key of Object.keys(context)) delete context[key];
    for (const [key, value] of snapshot) context[key] = value;
    updateStateDisplay();
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function runInContext(code, metadata, generation = sessionGeneration, outputParent = printAnchor) {
    const virtualSource = `${metadata.pagePath}#script-${metadata.scriptIndex}`;
    let executable;
    try {
        executable = AsyncFunction('ctx', `with (ctx) { ${code} }\n//# sourceURL=${virtualSource}`);
    } catch (error) {
        throw storyError('page-script-syntax', { ...metadata, source: code }, error);
    }
    let result = executable(createContextProxy(generation, outputParent));
    updateStateDisplay();
    return result;
}

function trackStoryTask(promise, metadata, generation = sessionGeneration, outputPassage = null) {
    const task = Promise.resolve(promise);
    activeStoryTasks.add(task);
    updateEndingAction();
    task.catch(error => {
        if (error?.name === 'AbortError' || sessionWasAbandoned(generation)) return;
        const kind = metadata.hasAwait ? 'async-script' : 'page-script-runtime';
        const transaction = outputPassage?.storyTransaction;
        if (transaction && outputPassage.isConnected) {
            restoreStoryContext(transaction.contextSnapshot);
            history.splice(transaction.historyLength);
            routeEdgeIds.splice(transaction.routeLength);
            sessionEvents.splice(transaction.sessionEventLength);
            const separator = outputPassage.previousElementSibling;
            outputPassage.remove();
            if (separator?.tagName === 'HR') separator.remove();
            currentPassage = transaction.previousPassage;
            nextPageLinks = transaction.previousLinks;
            currentPassageHasNavigation = transaction.previousNavigation;
            for (const control of currentPassage?.querySelectorAll('.story-choice') ?? []) {
                control.classList.remove('chosen', 'dismissed');
                control.closest('li')?.classList.remove('chosen', 'dismissed');
                control.closest('li')?.removeAttribute('inert');
                control.removeAttribute('aria-current');
                control.removeAttribute('aria-disabled');
                control.removeAttribute('aria-hidden');
                control.tabIndex = 0;
                if (control.dataset.pageTarget) control.setAttribute('href', control.dataset.pageTarget);
            }
            requestSessionWrite('replace');
            markNodesInGraph();
        }
        reportStoryError(storyError(kind, metadata, error));
    }).finally(() => {
        activeStoryTasks.delete(task);
        if (!sessionWasAbandoned(generation)) {
            updateStateDisplay();
            updateEndingAction();
            scheduleSessionWrite();
            if (!restoringSession && !replayingHistory && currentPassage === outputPassage && settledPassages.has(outputPassage)) {
                scrollToCurrentPassage();
            }
        }
    });
    return task;
}

function replaceDoubleBrackets(node) {
    if (node.nodeName.toLowerCase() === 'script') {
        return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const pattern = /\[\[\s*(.+?)\s*\]\]/g;
        let match;
        const parent = node.parentNode;
        let lastIndex = 0;
        const fragment = document.createDocumentFragment();

        while ((match = pattern.exec(node.textContent)) !== null) {
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(node.textContent.slice(lastIndex, match.index)));
            }

            const span = document.createElement('span');
            span.setAttribute('expression', match[1]);
            fragment.appendChild(span);

            lastIndex = pattern.lastIndex;
        }

        if (lastIndex < node.textContent.length) {
            fragment.appendChild(document.createTextNode(node.textContent.slice(lastIndex)));
        }

        if (fragment.childNodes.length > 0) {
            parent.replaceChild(fragment, node);
        }
    }

    for (const child of Array.from(node.childNodes)) {
        replaceDoubleBrackets(child);
    }
}

function isStoryPageTarget(value) {
    return Boolean(value) && !value.startsWith('#') && !value.includes('/') && !value.includes('.')
        && !/^[a-z][a-z\d+.-]*:/i.test(value);
}

export function resolveStoryResourceUrl(value, baseUrl = storyBaseUrl) {
    const source = `${value ?? ''}`;
    if (!source || source.startsWith('/') || source.startsWith('#') || source.startsWith('//')
        || /^[a-z][a-z\d+.-]*:/i.test(source)) return source;
    return new URL(source, baseUrl).href;
}

async function processDOM(inputRoot, outputRoot, pageMetadata, generation = sessionGeneration, { executeScripts = true } = {}) {
    let scriptIndex = 0;
    const compiledExpressions = new WeakMap();
    const compiledScripts = new WeakMap();

    function compileExpression(node, source) {
        try {
            const executable = Function('ctx', `with (ctx) { return (${source}); }`);
            compiledExpressions.set(node, executable);
            return executable;
        } catch (cause) {
            const kind = node.hasAttribute('condition') ? 'condition' : 'expression';
            throw storyError(kind, sourceMetadata(source), cause);
        }
    }

    function sourceMetadata(source) {
        const sourceStartLine = markdownLine(pageMetadata.markdown, source);
        const leadingLineBreaks = (source.match(/^(?:[\t ]*\n)*/) ?? [''])[0].split('\n').length - 1;
        return {
            pageId: pageMetadata.pageId,
            pagePath: pageMetadata.pagePath,
            line: Number.isInteger(sourceStartLine) ? sourceStartLine + leadingLineBreaks + (pageMetadata.lineOffset || 0) : sourceStartLine,
            source,
        };
    }

    function preflight(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.hasAttribute('condition')) compileExpression(node, node.getAttribute('condition'));
        if (node.hasAttribute('expression')) compileExpression(node, node.getAttribute('expression'));
        if (node.tagName.toLowerCase() === 'script') {
            if (!executeScripts) return;
            scriptIndex += 1;
            const code = node.textContent;
            const metadata = { ...sourceMetadata(code), scriptIndex, hasAwait: /\bawait\b/.test(code) };
            try {
                compiledScripts.set(node, { executable: AsyncFunction('ctx', `with (ctx) { ${code} }\n//# sourceURL=${metadata.pagePath}#script-${scriptIndex}`), metadata, code });
            } catch (cause) {
                throw storyError('page-script-syntax', { ...metadata, source: code }, cause);
            }
        }
        for (const child of node.childNodes) preflight(child);
    }

    function checkCondition(node) {
        if (!node.hasAttribute('condition')) return true;
        const source = node.getAttribute('condition');
        try {
            return Boolean(compiledExpressions.get(node)(createContextProxy(generation, outputRoot)));
        } catch (cause) {
            throw storyError('condition', sourceMetadata(source), cause);
        }
    }

    async function processNode(node, outputParent) {
        if (node.nodeType === Node.TEXT_NODE) {
            outputParent.appendChild(document.createTextNode(node.nodeValue));
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (!checkCondition(node)) return;

        if (node.hasAttribute('expression')) {
            const source = node.getAttribute('expression');
            try {
                const value = compiledExpressions.get(node)(createContextProxy(generation, outputRoot));
                outputParent.appendChild(document.createTextNode(value));
            } catch (cause) {
                throw storyError('expression', sourceMetadata(source), cause);
            }
            return;
        }

        if (node.tagName.toLowerCase() === 'script') {
            if (!executeScripts) return;
            try {
                const { executable, metadata, code } = compiledScripts.get(node);
                const result = executable(createContextProxy(generation, outputRoot));
                if (/\bpresentChoice\b/.test(code)) {
                    trackStoryTask(result, metadata, generation, outputRoot);
                    return;
                }
                await result;
                updateStateDisplay();
            } catch (cause) {
                const metadata = compiledScripts.get(node)?.metadata ?? sourceMetadata(node.textContent);
                throw storyError(metadata.hasAwait ? 'async-script' : 'page-script-runtime', metadata, cause);
            }
            return;
        }

        const clone = document.createElement(node.tagName);
        // Copy attributes (except 'expression' and 'condition')
        for (const attr of node.attributes) {
            if (attr.name !== 'expression' && attr.name !== 'condition') {
                const resourceAttribute = attr.name === 'src' && ['IMG', 'AUDIO', 'VIDEO', 'SOURCE'].includes(node.tagName)
                    || attr.name === 'href' && node.tagName === 'A' && !isStoryPageTarget(attr.value);
                clone.setAttribute(attr.name, resourceAttribute ? resolveStoryResourceUrl(attr.value) : attr.value);
            }
        }

        outputParent.appendChild(clone);

        for (const child of node.childNodes) {
            await processNode(child, clone);
        }
    }

    preflight(inputRoot);
    scriptIndex = 0;
    for (const child of inputRoot.childNodes) {
        await processNode(child, outputRoot);
    }
}

function encodeSession() {
    return lz.compress(JSON.stringify({ version: 1, seed: history[0], events: sessionEvents }));
}

function decodeSession(hash = window.location.hash) {
    if (!hash) return null;
    const decompressed = lz.decompress(hash.replace(/^#/, ''));
    if (!decompressed) return null;
    try {
        const session = JSON.parse(decompressed);
        const seed = Number.parseInt(session.seed, 10);
        if (session.version !== 1 || !Number.isFinite(seed) || !Array.isArray(session.events)) return null;
        if (!session.events.every(event => event && typeof event === 'object' && typeof event.type === 'string')) return null;
        return { seed: `${seed}`, events: session.events };
    } catch { return null; }
}

function requestSessionWrite(mode = 'push') {
    if (restoringSession) return;
    if (mode === 'push' || pendingSessionWrite === null) pendingSessionWrite = mode;
    scheduleSessionWrite();
}

function scheduleSessionWrite() {
    if (sessionWriteScheduled || !pendingSessionWrite || restoringSession) return;
    sessionWriteScheduled = true;
    queueMicrotask(() => {
        sessionWriteScheduled = false;
        if (!pendingSessionWrite || restoringSession) return;
        if (pendingNavigations.size > 0) return;
        if (activeStoryTasks.size > 0 && !deferred) return;
        const mode = pendingSessionWrite;
        pendingSessionWrite = null;
        const url = `${window.location.pathname}${window.location.search}#${encodeSession()}`;
        window.history[`${mode}State`](null, '', url);
    });
}

function passageLabel(passage) {
    return passage?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent.trim()
        || passage?.getAttribute('aria-label')
        || 'New story passage';
}

function announcePassage(passage, prefix = 'New passage') {
    if (!passage || !el.storyStatus) return;
    el.storyStatus.textContent = `${prefix}: ${passageLabel(passage)}`;
}

function deactivateChoice(control, selected = false) {
    const container = control.closest('li') ?? control;
    control.classList.add(selected ? 'chosen' : 'dismissed');
    container.classList.add(selected ? 'chosen' : 'dismissed');
    if (control.tagName === 'BUTTON') {
        control.setAttribute('aria-disabled', 'true');
        control.setAttribute('tabindex', '-1');
    } else {
        control.removeAttribute('href');
        control.setAttribute('tabindex', '-1');
        control.setAttribute('aria-disabled', 'true');
        if (selected) control.setAttribute('aria-current', 'step');
        else control.setAttribute('aria-hidden', 'true');
    }
    if (!selected && container !== control) container.inert = true;
}

function removeTokenAttribute(token, name) {
    const index = token?.attrIndex?.(name) ?? -1;
    if (index >= 0) token.attrs.splice(index, 1);
}

function resultInsertionPoint(control) {
    return control.closest('.committed-choice-turn') ?? control.closest('li') ?? control;
}

async function renderChoiceResult(runtime, choice, generation) {
    const host = document.createElement('div');
    host.className = 'choice-result';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    if (!choice.hasResult) return host;
    const resultDocument = new DOMParser().parseFromString(`<div>${md.render(choice.resultMarkdown)}</div>`, 'text/html');
    replaceDoubleBrackets(resultDocument);
    await processDOM(resultDocument.body, host, {
        pageId: runtime.pageId,
        pagePath: runtime.pagePath,
        markdown: choice.resultMarkdown,
        lineOffset: (choice.resultStartLine || choice.line) - 1,
    }, generation);
    return host;
}

function installCommittedResult(control, committed) {
    deactivateChoice(control, true);
    control.setAttribute('aria-pressed', 'true');
    if (committed.result.childNodes.length) {
        resultInsertionPoint(control).appendChild(committed.result.cloneNode(true));
    }
}

function organizePageChoiceLayout(passage, runtime) {
    const items = new Map();
    const sourceLists = new Set();
    for (const item of passage.querySelectorAll('[data-bif-choice-id]')) {
        items.set(item.dataset.bifChoiceId, item);
        const list = item.closest('ul, ol');
        if (list) sourceLists.add(list);
        item.remove();
    }
    for (const list of sourceLists) {
        if (!list.querySelector('li')) list.remove();
    }

    let turns = null;
    for (const [choiceId] of runtime.committed) {
        const item = items.get(choiceId);
        if (!item) continue;
        if (!turns) {
            turns = document.createElement('div');
            turns.className = 'committed-choice-turns';
            passage.appendChild(turns);
        }
        const turn = document.createElement('div');
        turn.className = 'committed-choice-turn';
        const sourceControl = item.querySelector(':scope > p > a, :scope > a');
        const choice = runtime.choiceById.get(choiceId);
        const control = document.createElement('div');
        control.className = 'story-choice committed-choice chosen';
        control.setAttribute('role', 'button');
        control.innerHTML = sourceControl?.innerHTML || choice?.text || '';
        control.dataset.choiceId = choiceId;
        if (choice) control.dataset.pageTarget = choice.local ? choice.rawTarget : choice.target;
        control.setAttribute('aria-disabled', 'true');
        control.setAttribute('aria-current', 'step');
        control.setAttribute('aria-pressed', 'true');
        control.setAttribute('tabindex', '-1');
        turn.appendChild(control);
        const committed = runtime.committed.get(choiceId);
        if (committed?.result?.childNodes.length) turn.appendChild(committed.result.cloneNode(true));
        turns.appendChild(turn);
        items.delete(choiceId);
    }

    if (items.size) {
        const liveSet = document.createElement('ul');
        liveSet.className = 'live-choice-set';
        liveSet.setAttribute('aria-label', 'Choices');
        for (const choice of runtime.choices) {
            const item = items.get(choice.identity);
            if (item) liveSet.appendChild(item);
        }
        passage.appendChild(liveSet);
    }
}

function unwrapChoiceControlParagraph(item, control) {
    const paragraph = control.parentElement;
    if (paragraph?.tagName !== 'P' || paragraph.parentElement !== item) return;
    const containsOnlyControl = [...paragraph.childNodes].every(node =>
        node === control || (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()));
    if (!containsOnlyControl) return;
    paragraph.replaceWith(control);
}

function decoratePageChoices(passage, generation) {
    const runtime = passage.pageRuntime;
    organizePageChoiceLayout(passage, runtime);
    const dynamicChoiceActive = Boolean(deferred && choiceDiv);
    if (!dynamicChoiceActive) {
        nextPageLinks = {};
        currentPassageHasNavigation = false;
    }
    for (const item of passage.querySelectorAll('[data-bif-choice-id]')) {
        const choice = runtime.choiceById.get(item.dataset.bifChoiceId);
        if (!choice) continue;
        let control = item.querySelector(':scope > p > a, :scope > a');
        if (!control) continue;
        if (choice.local) {
            const button = document.createElement('button');
            button.type = 'button';
            button.innerHTML = control.innerHTML;
            for (const className of control.classList) button.classList.add(className);
            control.replaceWith(button);
            control = button;
        } else {
            item.classList.add('pagelink');
            if (!dynamicChoiceActive) nextPageLinks[choice.target] = control;
        }
        control.classList.add('story-choice');
        unwrapChoiceControlParagraph(item, control);
        control.dataset.choiceId = choice.identity;
        control.dataset.pageTarget = choice.local ? choice.rawTarget : choice.target;
        currentPassageHasNavigation = true;
        const committed = runtime.committed.get(choice.identity);
        if (committed) {
            installCommittedResult(control, committed);
            continue;
        }
        control.addEventListener('click', event => {
            if (control.classList.contains('chosen') || control.classList.contains('dismissed')) return;
            keyboardNavigationPending = event.detail === 0;
            event.preventDefault();
            processStaticChoice(control, generation).catch(error => {
                if (error?.name !== 'AbortError' && !error?.reported) reportStoryError(error);
            });
        });
    }
    for (const control of passage.querySelectorAll('a:not(.story-choice)')) {
        const target = control.getAttribute('href') ?? '';
        if (!BifChoiceResults.isInternalTarget(target)) continue;
        control.classList.add('story-choice');
        control.dataset.pageTarget = target;
        control.closest('li')?.classList.add('pagelink');
        if (!dynamicChoiceActive) nextPageLinks[target] = control;
        currentPassageHasNavigation = true;
        control.addEventListener('click', event => {
            if (control.classList.contains('chosen') || control.classList.contains('dismissed')) return;
            el.clickedButton = control;
            keyboardNavigationPending = event.detail === 0;
            event.preventDefault();
            turnToPage(target, generation).catch(error => {
                if (error?.name !== 'AbortError' && !error?.reported) reportStoryError(error);
            });
        });
    }
    mapPassageChoices(passage, runtime.pageId);
}

async function rebuildActivePage(runtime, generation) {
    const tokens = md.parse(runtime.markdown, {});
    const choices = BifChoiceResults.parseChoiceResults(runtime.markdown, tokens, runtime.pageId);
    for (const token of tokens) {
        const choiceId = token.attrGet?.('data-bif-choice-id');
        if (choiceId && runtime.committed.has(choiceId)) removeTokenAttribute(token, 'condition');
        for (const child of token.children || []) {
            if (child.type === 'link_open' && choiceId && runtime.committed.has(choiceId)) removeTokenAttribute(child, 'condition');
        }
    }
    const visibleTokens = BifChoiceResults.tokensWithoutChoiceResults(tokens, choices);
    const documentFragment = new DOMParser().parseFromString(`<div>${md.renderer.render(visibleTokens, md.options, {})}</div>`, 'text/html');
    replaceDoubleBrackets(documentFragment);
    const staging = document.createElement('section');
    await processDOM(documentFragment.body, staging, {
        pageId: runtime.pageId,
        pagePath: runtime.pagePath,
        markdown: runtime.markdown,
    }, generation, { executeScripts: false });
    runtime.passage.replaceChildren(...staging.childNodes);
    runtime.choices = choices;
    runtime.choiceById = new Map(choices.map(choice => [choice.identity, choice]));
    decoratePageChoices(runtime.passage, generation);
}

async function processStaticChoice(control, generation = sessionGeneration, { record = true } = {}) {
    if (choiceTransaction || sessionWasAbandoned(generation)) return;
    const passage = control.closest('.story-passage');
    const runtime = passage?.pageRuntime;
    const choice = runtime?.choiceById.get(control.dataset.choiceId);
    if (!runtime || !choice || runtime.committed.has(choice.identity)) return;
    const contextSnapshot = snapshotStoryContext();
    const previousHtml = passage.innerHTML;
    const previousLinks = nextPageLinks;
    const previousNavigation = currentPassageHasNavigation;
    choiceTransaction = { runtime, choice };
    let revealAfterCommit = null;
    passage.classList.add('choice-pending');
    for (const candidate of passage.querySelectorAll('.story-choice')) candidate.setAttribute('aria-disabled', 'true');
    try {
        const result = await renderChoiceResult(runtime, choice, generation);
        if (sessionWasAbandoned(generation)) throw abandonedSessionError();
        runtime.committed.set(choice.identity, { result: result.cloneNode(true) });
        if (choice.local) {
            await rebuildActivePage(runtime, generation);
            if (record) sessionEvents.push({ type: 'local', choiceId: choice.identity });
            if (record) requestSessionWrite('push');
            updateStateDisplay();
            const selected = passage.querySelector(`[data-choice-id="${CSS.escape(choice.identity)}"]`);
            await scrollToCommittedLocalTurn(passage, choice.identity, generation);
            revealAfterCommit = { kind: 'local', passage, choiceId: choice.identity, generation };
        } else {
            const edgeId = control.dataset.graphEdgeId ?? null;
            await navigateToPage(choice.target, generation);
            const destinationLinks = nextPageLinks;
            const destinationHasNavigation = currentPassageHasNavigation;
            await rebuildActivePage(runtime, generation);
            nextPageLinks = destinationLinks;
            currentPassageHasNavigation = destinationHasNavigation;
            passage.querySelector(':scope > .live-choice-set')?.remove();
            routeEdgeIds.push(edgeId);
            if (record) sessionEvents.push({ type: 'choice', choiceId: choice.identity, pageId: choice.target });
            if (record) requestSessionWrite('push');
            markNodesInGraph();
            revealAfterCommit = { kind: 'page', passage: currentPassage, generation };
        }
    } catch (error) {
        restoreStoryContext(contextSnapshot);
        runtime.committed.delete(choice.identity);
        passage.innerHTML = previousHtml;
        nextPageLinks = previousLinks;
        currentPassageHasNavigation = previousNavigation;
        decoratePageChoices(passage, generation);
        throw error instanceof StoryRuntimeError ? error : storyError('navigation', {
            pageId: runtime.pageId, pagePath: runtime.pagePath,
        }, error);
    } finally {
        passage.classList.remove('choice-pending');
        choiceTransaction = null;
        for (const candidate of passage.querySelectorAll('.story-choice:not(.chosen):not(.dismissed)')) candidate.removeAttribute('aria-disabled');
        updateEndingAction();
    }
    if (revealAfterCommit && record && !replayingHistory && !restoringSession) {
        if (revealAfterCommit.kind === 'local') startLocalReveal(revealAfterCommit.passage, revealAfterCommit.choiceId, generation);
        else startPageReveal(revealAfterCommit.passage, generation);
    }
}

async function appendPage(page, generation = sessionGeneration) {
    const pagePath = `${path}/${page}.md`;
    let appendedPassage = null;
    const pageUrl = new URL(`${encodeURIComponent(page)}.md`, storyBaseUrl);
    pageUrl.searchParams.set('v', cache_buster);
    await fetch(pageUrl)
        .then(response => {
            if (!response.ok) {
                throw storyError('page-load', {
                    message: `Page ${page} could not be loaded`,
                    pageId: `${page}`,
                    pagePath,
                    status: response.status,
                });
            }
            return response.text();
        })
        .then(async data => {
            if (sessionWasAbandoned(generation)) throw abandonedSessionError();
            data = resolvePageMetadata(page, data);
            const contextSnapshot = snapshotStoryContext();
            const previousLinks = nextPageLinks;
            const previousPassage = currentPassage;
            const previousNavigation = currentPassageHasNavigation;
            currentPassageHasNavigation = false;
            const separator = history.length > 1 ? document.createElement('hr') : null;

            appendedPassage = document.createElement('section');
            appendedPassage.classList.add('story-passage');
            appendedPassage.dataset.pageId = `${page}`;
            appendedPassage.setAttribute('tabindex', '-1');
            appendedPassage.setAttribute('aria-label', `Story passage ${page}`);
            appendedPassage.id = `story-passage-${++passageSerial}`;
            appendedPassage.storyTransaction = {
                contextSnapshot,
                previousLinks,
                previousPassage,
                previousNavigation,
                pageId: `${page}`,
                historyLength: history.length,
                routeLength: routeEdgeIds.length,
                sessionEventLength: sessionEvents.length,
            };

            const tokens = md.parse(data, {});
            const choices = BifChoiceResults.parseChoiceResults(data, tokens, `${page}`);
            const parser = new DOMParser();
            let html = md.renderer.render(BifChoiceResults.tokensWithoutChoiceResults(tokens, choices), md.options, {});
            let doc = parser.parseFromString('<div></div>' + html, 'text/html');
            replaceDoubleBrackets(doc);
            appendedPassage.pageRuntime = {
                pageId: `${page}`, pagePath, markdown: data, choices,
                choiceById: new Map(choices.map(choice => [choice.identity, choice])),
                committed: new Map(), instanceId: ++pageInstanceSerial,
                passage: appendedPassage,
            };

            try {
                await processDOM(doc.body, appendedPassage, { pageId: `${page}`, pagePath, markdown: data }, generation);
            } catch (error) {
                restoreStoryContext(contextSnapshot);
                nextPageLinks = previousLinks;
                currentPassage = previousPassage;
                currentPassageHasNavigation = previousNavigation;
                appendedPassage = null;
                throw error;
            }

            const heading = appendedPassage.querySelector('h1, h2, h3, h4, h5, h6');
            if (heading) {
                heading.id ||= `${appendedPassage.id}-title`;
                appendedPassage.setAttribute('aria-labelledby', heading.id);
                appendedPassage.removeAttribute('aria-label');
            }

            history.push(page);
            if (separator) el.content.appendChild(separator);
            el.content.appendChild(appendedPassage);
            currentPassage = appendedPassage;

            decoratePageChoices(appendedPassage, generation);
                updateEndingAction();

            markNodesInGraph();
        })
        .then(() => {
            if (sessionWasAbandoned(generation)) return;
            el.clickedButton = null;
            if (!replayingHistory && !restoringSession) {
                announcePassage(appendedPassage);
                const usedKeyboard = keyboardNavigationPending;
                if (usedKeyboard) appendedPassage?.focus({ preventScroll: true });
                keyboardNavigationPending = false;
                settledPassages.add(appendedPassage);
                scrollToCurrentPassage({ behavior: usedKeyboard ? 'auto' : undefined });
            }
        })
        .catch(error => {
            if (error?.name === 'AbortError') throw error;
            const normalized = error instanceof StoryRuntimeError
                ? error
                : storyError('navigation', { pageId: `${page}`, pagePath }, error);
            reportStoryError(normalized);
            throw normalized;
        });
}

function randomSeed() {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0];
}

async function loadPage(page) {
    const pageUrl = new URL(`${encodeURIComponent(page)}.md`, storyBaseUrl);
    pageUrl.searchParams.set('v', cache_buster);
    const response = await fetch(pageUrl);
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    return resolvePageMetadata(page, await response.text());
}

function resolvePageMetadata(page, source) {
    if (`${page}` !== '1') return source;
    const metadata = BifStoryMetadata.resolveStoryMetadata(source, { sourcePath: `${path}/1.md` });
    document.title = metadata.title;
    for (const warning of metadata.warnings) if (!metadataWarnings.has(warning)) {
        metadataWarnings.add(warning);
        console.warn(warning);
    }
    return metadata.bodyMarkdown;
}

function markNodesInGraph() {
    if (!devMode) return;
    if (unifiedGraphView && graphStructure) {
        unifiedGraphView.applyOverlay();
        return;
    }
    let graph = el.graphContainer;
    for (let e of graph.querySelectorAll('.node')) {
        e.classList.remove('active');
    }
    for (let e of graph.querySelectorAll('.edge')) {
        e.classList.remove('active');
    }
    let lastPage = '';
    for (let page of history.slice(1)) {
        let node = graph.querySelector(`#node_${page}`);
        if (node) {
            node.classList.add('active');
        }
        let edge = graph.querySelector(`#edge_${lastPage}_${page}`);
        if (edge) {
            edge.classList.add('active');
        }
        lastPage = page;
    }
    // focusOnElement(graph.querySelector(`#node_${history[history.length - 1]}`));
}

function mapPassageChoices(passage = currentPassage, sourcePage = history.at(-1)) {
    if (!graphStructure || !passage || !sourcePage) return;
    const controls = [...passage.querySelectorAll('.story-choice')].map(element => ({
        element,
        target: element.dataset.pageTarget,
        text: element.textContent,
    }));
    const { matches, ambiguities } = matchRuntimeChoices(graphStructure, sourcePage, controls);
    for (const [control, edgeId] of matches) control.dataset.graphEdgeId = edgeId;
    for (const ambiguity of ambiguities) {
        const key = `${ambiguity.source}->${ambiguity.target}:${ambiguity.text}`;
        if (!graphMappingWarnings.has(key)) {
            graphMappingWarnings.add(key);
            console.warn(`Project graph could not uniquely match runtime choice ${key}`);
        }
    }
}

function availableGraphEdgeIds() {
    return [...(currentPassage?.querySelectorAll('.story-choice:not(.chosen):not(.dismissed)') ?? [])]
        .map(control => control.dataset.graphEdgeId)
        .filter(Boolean);
}

function navigateToPage(page, generation = sessionGeneration) {
    const pageId = `${page}`;
    if (sessionWasAbandoned(generation)) return Promise.reject(abandonedSessionError());
    if (pageId.length === 0) {
        return Promise.reject(new Error('Could not navigate: page ID is empty'));
    }
    if (pendingNavigations.has(pageId)) {
        return pendingNavigations.get(pageId);
    }
    storyReveal.cancel();

    const navigation = navigationQueue.then(async () => {
        if (sessionWasAbandoned(generation)) throw abandonedSessionError();
        try {
            await appendPage(pageId, generation);
        } catch (error) {
            if (error instanceof StoryRuntimeError) throw error;
            throw storyError('navigation', {
                pageId,
                pagePath: `${path}/${pageId}.md`,
                message: `Could not navigate to page ${pageId}`,
            }, error);
        }
    });
    navigationQueue = navigation.catch(() => {});
    pendingNavigations.set(pageId, navigation);
    const clearPending = () => {
        if (pendingNavigations.get(pageId) === navigation) {
            pendingNavigations.delete(pageId);
        }
        if (!sessionWasAbandoned(generation)) {
            updateEndingAction();
            scheduleSessionWrite();
        }
    };
    navigation.then(clearPending, clearPending);
    return navigation;
}

function updateEndingAction() {
    if (!el.endingActions) return;
    const shouldShow = !currentPassageHasNavigation
        && activeStoryTasks.size === 0
        && pendingNavigations.size === 0;
    el.endingActions.hidden = !shouldShow;
}

function goToPage(page, generation = sessionGeneration) {
    const pageId = `${page}`;
    if (sessionWasAbandoned(generation)) return Promise.reject(abandonedSessionError());
    if (!replayingHistory) {
        return navigateToPage(pageId, generation).then(() => {
            sessionEvents.push({ type: 'page', pageId });
            requestSessionWrite('push');
            startPageReveal(currentPassage, generation);
        });
    }
    if (replayNavigationRequests.has(pageId)) {
        return replayNavigationRequests.get(pageId).promise;
    }

    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    replayNavigationRequests.set(pageId, { promise, resolve, reject });
    return promise;
}

async function turnToPage(page, generation = sessionGeneration) {
    if (sessionWasAbandoned(generation)) return;
    if (deferred) {
        const selectedChoice = nextPageLinks[page];
        if (!selectedChoice || selectedChoice.classList.contains('chosen')) return;
        for (let option of choiceDiv.querySelectorAll('.pagelink')) {
            deactivateChoice(option, option === selectedChoice);
        }
        choiceDiv = null;
        deferred.resolve(`${page}`);
        history.push(page);
        routeEdgeIds.push(null);
        if (!replayingHistory) {
            sessionEvents.push({ type: 'dynamic', value: `${page}` });
            requestSessionWrite('push');
        }
    } else if (replayingHistory && replayNavigationRequests.has(`${page}`)) {
        const request = replayNavigationRequests.get(`${page}`);
        replayNavigationRequests.delete(`${page}`);
        try {
            await navigateToPage(page, generation);
            request.resolve();
        } catch (error) {
            request.reject(error);
            throw error;
        }
    } else if (nextPageLinks[page]) {
        const clickedChoice = el.clickedButton?.dataset.pageTarget === `${page}` ? el.clickedButton : null;
        const selectedChoice = clickedChoice ?? nextPageLinks[page];
        if (selectedChoice.classList.contains('chosen')) {
            return pendingNavigations.get(`${page}`);
        }
        const choiceGroup = selectedChoice.closest('ul') ?? selectedChoice.parentElement;
        const edgeId = selectedChoice.dataset.graphEdgeId ?? null;
        el.clickedButton = null;
        await navigateToPage(page, generation);
        for (let control of choiceGroup.querySelectorAll('a.story-choice')) {
            deactivateChoice(control, control === selectedChoice);
        }
        if (!replayingHistory) requestSessionWrite('push');
        routeEdgeIds.push(edgeId);
        markNodesInGraph();
        updateEndingAction();
        if (!replayingHistory && !restoringSession) startPageReveal(currentPassage, generation);
    }
}

function resetRuntimeForRestore() {
    storyReveal.cancel();
    if (deferred) deferred.reject(abandonedSessionError());
    deferred = null;
    if (choiceDiv) choiceDiv.remove();
    choiceDiv = null;
    nextPageLinks = {};
    choiceTransaction = null;
    routeEdgeIds = [];
    for (const request of replayNavigationRequests.values()) {
        request.reject(abandonedSessionError());
    }
    replayNavigationRequests.clear();
    activeStoryTasks.clear();
    pendingNavigations.clear();
    navigationQueue = Promise.resolve();
    currentPassageHasNavigation = false;
    el.clickedButton = null;
    el.content.innerHTML = '';
    currentPassage = null;
    keyboardNavigationPending = false;
    contextProgress = false;
    resetStoryContext();
    updateStateDisplay();
}

async function restoreSession(session) {
    const generation = ++sessionGeneration;
    restoringSession = true;
    pendingSessionWrite = null;
    const focusWasInTranscript = el.content.contains(document.activeElement);
    resetRuntimeForRestore();

    const normalized = Array.isArray(session)
        ? { seed: session[0], events: session.slice(1).map(pageId => ({ type: 'page', pageId: `${pageId}` })) }
        : session;
    const seed = Number.parseInt(normalized.seed, 10);
    const events = normalized.events || [];
    history = [`${seed}`];
    sessionEvents = [];
    Math.random = mulberry32(seed);
    replayingHistory = true;
    try {
        await appendPage('1', generation);
        const replayEvents = events[0]?.type === 'page' && `${events[0].pageId}` === '1' ? events.slice(1) : events;
        for (const event of replayEvents) {
            if (event.type === 'local' || event.type === 'choice') {
                const control = currentPassage?.querySelector(`[data-choice-id="${CSS.escape(`${event.choiceId}`)}"]`);
                if (!control) continue;
                await processStaticChoice(control, generation, { record: false });
            } else if (event.type === 'dynamic') {
                await turnToPage(`${event.value}`, generation);
            } else if (event.type === 'page') {
                await turnToPage(`${event.pageId}`, generation);
            }
        }
        await Promise.resolve();
        replayingHistory = false;
        for (const [pageId, request] of Array.from(replayNavigationRequests)) {
            replayNavigationRequests.delete(pageId);
            try {
                await navigateToPage(pageId, generation);
                request.resolve();
            } catch (error) {
                request.reject(error);
                throw error;
            }
        }
    } finally {
        replayingHistory = false;
        if (!sessionWasAbandoned(generation)) {
            restoringSession = false;
            updateStateDisplay();
            markNodesInGraph();
            updateEndingAction();
            announcePassage(currentPassage, 'Current passage');
            if ((focusWasInTranscript || graphKeyboardNavigationPending) && currentPassage) {
                currentPassage.focus({ preventScroll: true });
            }
            graphKeyboardNavigationPending = false;
            scrollToCurrentPassage({ behavior: 'auto' });
        }
    }
    sessionEvents = events.map(event => ({ ...event }));
    contextProgress = events.some(event => event.type !== 'page' || `${event.pageId}` !== '1');
}

let graphvizInstancePromise = null;


function graphPaint(element, property, fallback = 'currentColor') {
    const attribute = element.getAttribute(property);
    if (attribute && attribute !== 'none') return attribute;
    const inline = element.style?.getPropertyValue(property)?.trim();
    return inline && inline !== 'none' ? inline : fallback;
}

function rememberGraphPaint(element, {
    fillProperty = '--graph-source-fill',
    strokeProperty = '--graph-source-stroke',
} = {}) {
    element.style.setProperty(fillProperty, graphPaint(element, 'fill', 'transparent'));
    element.style.setProperty(strokeProperty, graphPaint(element, 'stroke'));
}

function prepareGraphSvgForTheme(svg) {
    if (!svg) return;
    svg.classList.add('theme-aware-graph');

    for (const cluster of svg.querySelectorAll('g.cluster')) {
        cluster.classList.add('graph-cluster');
        for (const shape of cluster.querySelectorAll(':scope > polygon, :scope > path')) {
            shape.classList.add('graph-cluster-shape');
            rememberGraphPaint(shape, {
                fillProperty: '--graph-cluster-source-fill',
                strokeProperty: '--graph-group-color',
            });
        }
        for (const label of cluster.querySelectorAll(':scope > text')) {
            label.classList.add('graph-cluster-label');
        }
    }

    for (const node of svg.querySelectorAll('g.node')) {
        node.classList.add('graph-node');
        for (const shape of node.querySelectorAll(':scope > polygon, :scope > ellipse, :scope > path')) {
            shape.classList.add('graph-node-shape');
            rememberGraphPaint(shape, {
                fillProperty: '--graph-node-source-fill',
                strokeProperty: '--graph-group-color',
            });
        }
        for (const label of node.querySelectorAll(':scope > text')) {
            label.classList.add('graph-node-label');
        }
    }

    for (const edge of svg.querySelectorAll('g.edge')) {
        edge.classList.add('graph-edge');
        for (const path of edge.querySelectorAll(':scope > path')) {
            path.classList.add('graph-edge-path');
        }
        for (const arrow of edge.querySelectorAll(':scope > polygon')) {
            arrow.classList.add('graph-edge-arrow');
        }
        for (const label of edge.querySelectorAll(':scope > text')) {
            label.classList.add('graph-edge-label');
        }
    }
}

async function renderUnifiedGraphDot(dot) {
    graphvizInstancePromise ??= Graphviz.load();
    return (await graphvizInstancePromise).dot(dot);
}

function installUnifiedGraphSvg(svgText) {
    el.graphContainer.innerHTML = svgText;
    const svg = el.graphContainer.querySelector('svg');
    if (!svg) return;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    for (const title of svg.querySelectorAll('title')) title.remove();
    for (const anchor of svg.querySelectorAll('a')) anchor.replaceWith(...anchor.childNodes);
    for (const element of svg.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            if (attribute.name.startsWith('on') || ['href', 'xlink:href'].includes(attribute.name)) element.removeAttribute(attribute.name);
        }
    }
    prepareGraphSvgForTheme(svg);
    installPanAndZoomHandler(svg);
}

function runtimeGraphOverlay(structure) {
    graphStructure = structure;
    mapPassageChoices();
    if (!routeEdgeIds.length && history.length > 2) {
        for (let index = 1; index < history.length - 1; index++) {
            const candidates = (structure.outgoingByPage.get(`${history[index]}`) ?? []).filter(edge => `${edge.target}` === `${history[index + 1]}`);
            routeEdgeIds.push(candidates.length === 1 ? candidates[0].edgeId : null);
        }
    }
    return createRuntimeOverlay(structure, { history, routeEdgeIds, availableEdgeIds: availableGraphEdgeIds() });
}

async function navigateFromGraphEdge(edgeId, origin = 'pointer') {
    if (storyReveal.active) {
        storyReveal.finish();
        return;
    }
    keyboardNavigationPending = origin === 'keyboard';
    const control = [...el.content.querySelectorAll('.story-choice')].find(item => item.dataset.graphEdgeId === edgeId);
    if (control && !control.classList.contains('chosen') && !control.classList.contains('dismissed')) {
        control.click();
        if (origin !== 'keyboard') keyboardNavigationPending = false;
    }
}

async function rewindFromGraph(page, origin = 'pointer') {
    const index = history.lastIndexOf(`${page}`);
    if (index <= 0 || index >= history.length - 1) return false;
    el.body.classList.add('skip-animations');
    graphKeyboardNavigationPending = origin === 'keyboard';
    try {
        let routeCount = 1;
        let eventEnd = 0;
        for (; eventEnd < sessionEvents.length; eventEnd += 1) {
            if (eventEnd > 0 && ['page', 'choice', 'dynamic'].includes(sessionEvents[eventEnd].type)) routeCount += 1;
            if (routeCount > index) break;
        }
        await restoreSession({ seed: history[0], events: sessionEvents.slice(0, eventEnd) });
        requestSessionWrite('push');
    } finally {
        el.body.classList.remove('skip-animations');
    }
    return true;
}

function sortKeys(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sortKeys);
    } else if (obj && typeof obj === "object") {
        return Object.keys(obj)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sortKeys(obj[key]);
                return acc;
            }, {});
    }
    return obj;
}

async function loadAuthoringModules() {
    const [graphviz, client, summary, structure, overlay, view, problems, uiState, viewport] = await Promise.all([
        import('../dev/graphviz.min.js'),
        import('../dev/browser-analysis-client.js'),
        import('../dev/browser-analysis-summary.js'),
        import('../dev/browser-graph-structure.js'),
        import('../dev/browser-graph-overlay.js'),
        import('../dev/browser-graph-view.js'),
        import('../dev/browser-problems-view.js'),
        import('../dev/browser-development-state.js'),
        import('../dev/browser-graph-viewport.js'),
    ]);
    Graphviz = graphviz.Graphviz;
    createBrowserAnalysisClient = client.createBrowserAnalysisClient;
    mountBrowserAnalysisSummary = summary.mountBrowserAnalysisSummary;
    matchRuntimeChoices = structure.matchRuntimeChoices;
    createRuntimeOverlay = overlay.createRuntimeOverlay;
    createUnifiedGraphView = view.createUnifiedGraphView;
    createProblemsView = problems.createProblemsView;
    createDevelopmentUiState = uiState.createDevelopmentUiState;
    ({ panViewBox, pinchViewBox, zoomViewBoxAt, interpolateViewBox } = viewport);
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('../dev/authoring.css', import.meta.url).href;
    document.head.appendChild(stylesheet);
}

function hasMeaningfulProgress() {
    const committedLocalChoice = Array.from(el.content.querySelectorAll('.story-passage'))
        .some(passage => (passage.pageRuntime?.committed.size ?? 0) > 0);
    const recordedProgress = sessionEvents.some(event => event.type !== 'page' || `${event.pageId}` !== '1');
    return contextProgress || recordedProgress || history.length > 2 || committedLocalChoice;
}

export async function restartStory() {
    el.body.classList.add('skip-animations');
    try {
        await restoreSession({ seed: `${randomSeed()}`, events: [{ type: 'page', pageId: '1' }] });
        requestSessionWrite('replace');
        await Promise.resolve();
        getTranscriptScroller().scrollTo({ top: 0, behavior: 'auto' });
        restartControl?.focus({ preventScroll: true });
        return true;
    } finally {
        el.body.classList.remove('skip-animations');
    }
}

function iconButton({ className, label, icon }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `story-icon-button ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(createIcon(icon));
    return button;
}

function createStoryControls(mode) {
    restartHoldControl?.destroy();
    playAgainHoldControl?.destroy();
    el.storyControls.replaceChildren();
    restartControl = iconButton({ className: 'story-restart-control hold-confirm-control', label: 'Hold to restart story', icon: 'refresh' });
    restartHoldControl = createHoldToConfirmControl({
        button: restartControl,
        shouldRequireHold: hasMeaningfulProgress,
        onConfirm: restartStory,
        labels: {
            idle: 'Hold to restart story',
            holding: 'Release to cancel restart',
            confirming: 'Restarting story',
        },
    });
    el.storyControls.append(restartControl);

    if (isAuthoringEnvironment()) {
        const label = mode === 'dev' ? 'Open game view' : 'Open authoring view';
        const button = iconButton({
            className: 'story-view-toggle', label,
            icon: mode === 'dev' ? 'book-2' : 'hierarchy-2',
        });
        button.id = 'bif-view-switch';
        button.addEventListener('click', () => {
            window.location.assign(switchBrowserMode(mode === 'dev' ? 'game' : 'dev'));
        });
        el.storyControls.append(button);
    }

    const playAgain = document.createElement('button');
    playAgain.type = 'button';
    playAgain.className = 'story-play-again hold-confirm-control';
    playAgain.textContent = 'Hold to play again';
    playAgainHoldControl = createHoldToConfirmControl({
        button: playAgain,
        onConfirm: restartStory,
        labels: {
            idle: 'Hold to play again',
            holding: 'Release to cancel play again',
            confirming: 'Restarting story',
        },
    });
    el.endingActions.replaceChildren(playAgain);
}

export async function init() {
    setTimeout(() => {
        let width = el.devPane.clientWidth;
        el.devFixed.style.width = `${width}px`;
    }, 1);
    el.body.classList.add('skip-animations');
    if (devMode) {
        await loadAuthoringModules();
        el.body.classList.add('dev');
        developmentUiState = createDevelopmentUiState({ storyPath: path, mode: 'dev' });
        const analysisClient = createBrowserAnalysisClient();
        mountBrowserAnalysisSummary({
            graphContainer: el.graphContainer,
            client: analysisClient,
        });
        createGraphToolbar();
        graphProblems = createProblemsView({
            graphContainer: el.graphContainer,
            stateContainer: el.stateContainer,
            uiState: developmentUiState,
        });
        unifiedGraphView = createUnifiedGraphView({
            container: el.graphContainer,
            analysisClient,
            renderDot: renderUnifiedGraphDot,
            installSvg: installUnifiedGraphSvg,
            getOverlay: runtimeGraphOverlay,
            onStructure(structure) {
                graphStructure = structure;
                mapPassageChoices();
                graphProblems.render(structure);
            },
            onNavigateEdge: navigateFromGraphEdge,
            onRewindPage: rewindFromGraph,
            onInspect: structuralId => graphProblems.selectProblem(structuralId),
        });
        updateStateDisplay();
        initPaneSlider();
    }
    createStoryControls(devMode ? 'dev' : 'game');

    Math.w6 = () => Math.floor(Math.rand() * 6) + 1;
    Math.chance = (x) => Math.random() * 100 < x;
    const urlSession = decodeSession();
    try {
        if (urlSession) {
            await restoreSession(urlSession);
        } else {
            await restoreSession({ seed: `${randomSeed()}`, events: [{ type: 'page', pageId: '1' }] });
            requestSessionWrite('replace');
        }
    } catch (error) {
        if (!(error instanceof StoryRuntimeError) && error?.name !== 'AbortError') throw error;
        if (!urlSession && error instanceof StoryRuntimeError) requestSessionWrite('replace');
    }
    el.body.classList.remove('skip-animations');

    window.addEventListener('popstate', async () => {
        const session = decodeSession();
        if (!session) return;
        el.body.classList.add('skip-animations');
        try {
            await restoreSession(session);
        } catch (error) {
            if (error?.name !== 'AbortError' && !(error instanceof StoryRuntimeError)) {
                console.error('Could not restore story session:', error);
                appendSection(`Fehler beim Wiederherstellen der Sitzung: ${error.message}`);
            }
        } finally {
            el.body.classList.remove('skip-animations');
        }
    });
}

function getTranscriptScroller() {
    return devMode ? el.gamePane : el.body;
}

function startReveal(units, generation, onFinish) {
    if (sessionWasAbandoned(generation) || replayingHistory || restoringSession) return;
    void storyReveal.start({
        units,
        scroller: getTranscriptScroller(),
        onFinish,
    });
}

function startPageReveal(passage, generation) {
    if (!passage?.isConnected) return;
    startReveal(planPageReveal(passage), generation, () => scrollToCurrentPassage());
}

function startLocalReveal(passage, choiceId, generation) {
    if (!passage?.isConnected) return;
    const selected = passage.querySelector(`[data-choice-id="${CSS.escape(choiceId)}"]`);
    const turn = selected?.closest('.committed-choice-turn');
    const liveSet = passage.querySelector(':scope > .live-choice-set');
    startReveal(planLocalTurnReveal(turn, liveSet), generation, () => {
        void scrollToCommittedLocalTurn(passage, choiceId, generation);
    });
}

async function scrollToCommittedLocalTurn(passage, choiceId, generation) {
    if (restoringSession || replayingHistory || sessionWasAbandoned(generation)) return;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (restoringSession || replayingHistory || sessionWasAbandoned(generation)) return;
    const selected = passage.querySelector(`[data-choice-id="${CSS.escape(choiceId)}"]`);
    const turn = selected?.closest('.committed-choice-turn');
    if (!turn) return;
    const liveSet = passage.querySelector(':scope > .live-choice-set');
    const scroller = getTranscriptScroller();
    const scrollerRect = devMode ? scroller.getBoundingClientRect() : { top: 0 };
    const turnRect = turn.getBoundingClientRect();
    const liveRect = liveSet?.getBoundingClientRect() ?? null;
    const style = getComputedStyle(scroller);
    const contentTop = rect => rect.top - scrollerRect.top + scroller.scrollTop;
    const target = localTurnScrollTarget({
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        turnTop: contentTop(turnRect),
        turnBottom: contentTop(turnRect) + turnRect.height,
        liveBottom: liveRect ? contentTop(liveRect) + liveRect.height : null,
        paddingTop: Number.parseFloat(style.paddingTop) || 0,
        paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
    });
    if (target === null) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: target, behavior: reducedMotion ? 'auto' : 'smooth' });
}

function scrollToCurrentPassage({ behavior } = {}) {
    if (!currentPassage) return;
    const scroller = getTranscriptScroller();
    const scrollerTop = devMode ? scroller.getBoundingClientRect().top : 0;
    const top = currentPassage.getBoundingClientRect().top - scrollerTop + scroller.scrollTop - 10;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top, behavior: behavior ?? (reducedMotion ? 'auto' : 'smooth') });
}

function appendSection(text) {
    const section = document.createElement('div');
    section.classList.add('page');
    section.innerHTML = md.render(text);
    content.appendChild(section);
}

let viewBox = { x: 0, y: 0, width: 0, height: 0 };
let currentScale = 1;
let viewportLimits = { minWidth: 1, maxWidth: Infinity };

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function zoom(e) {
    e.preventDefault();
    cancelViewportAnimation();
    const factor = Math.exp(clamp(e.deltaY, -120, 120) * 0.0015);
    viewBox = zoomViewBoxAt(viewBox, window.svg.getBoundingClientRect(), { x: e.clientX, y: e.clientY }, factor, viewportLimits);
    updateViewBox();
}

function updateViewBox() {
    window.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    currentScale = window.svg.clientWidth / viewBox.width;
    developmentUiState?.set('graphViewBox', { ...viewBox });
}

function resetViewBox() {
    const bbox = window.svg.getBBox();
    const padding = 10;
    const maxZoom = 1.5;

    let containerWidth = window.svg.clientWidth;
    let containerHeight = window.svg.clientHeight;
    if (containerWidth < 1) containerWidth = 1;
    if (containerHeight < 1) containerHeight = 1;

    const minWidth = containerWidth / maxZoom;
    const minHeight = containerHeight / maxZoom;

    const containerRatio = containerWidth / containerHeight;
    const contentRatio = bbox.width / bbox.height;

    if (contentRatio > containerRatio) {
        viewBox.width = Math.max(bbox.width + padding * 2, minWidth);
        viewBox.height = viewBox.width / containerRatio;
    } else {
        viewBox.height = Math.max(bbox.height + padding * 2, minHeight);
        viewBox.width = viewBox.height * containerRatio;
    }

    viewBox.x = bbox.x - (viewBox.width - bbox.width) / 2;
    viewBox.y = bbox.y - (viewBox.height - bbox.height) / 2;

    viewportLimits = { minWidth: viewBox.width / 8, maxWidth: viewBox.width * 8 };

    updateViewBox();
}

let animationFrameId = null;

function cancelViewportAnimation() {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
}

function animateViewBox(target, duration = 300) {
    const start = { ...viewBox };
    const end = { ...target };
    const startTime = performance.now();

    cancelViewportAnimation();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        viewBox = end;
        updateViewBox();
        return;
    }

    function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = easeInOutQuad(t);

        viewBox = interpolateViewBox(start, end, ease);

        updateViewBox();

        if (t < 1) {
            animationFrameId = requestAnimationFrame(step);
        } else {
            animationFrameId = null;
        }
    }

    animationFrameId = requestAnimationFrame(step);
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function getBBoxInSVGCoords(element, svg) {
    const bbox = element.getBBox();
    const matrix = element.getCTM();

    const points = [
        svg.createSVGPoint(), svg.createSVGPoint(),
        svg.createSVGPoint(), svg.createSVGPoint()
    ];

    points[0].x = bbox.x; points[0].y = bbox.y;
    points[1].x = bbox.x + bbox.width; points[1].y = bbox.y;
    points[2].x = bbox.x; points[2].y = bbox.y + bbox.height;
    points[3].x = bbox.x + bbox.width; points[3].y = bbox.y + bbox.height;

    const transformedPoints = points.map(p => p.matrixTransform(matrix));

    const xs = transformedPoints.map(p => p.x);
    const ys = transformedPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function isElementWellInView(elementBBox, margin = 20) {
    const boxLeft = elementBBox.x - margin;
    const boxRight = elementBBox.x + elementBBox.width + margin;
    const boxTop = elementBBox.y - margin;
    const boxBottom = elementBBox.y + elementBBox.height + margin;

    const viewLeft = viewBox.x;
    const viewRight = viewBox.x + viewBox.width;
    const viewTop = viewBox.y;
    const viewBottom = viewBox.y + viewBox.height;

    return (
        boxLeft >= viewLeft &&
        boxRight <= viewRight &&
        boxTop >= viewTop &&
        boxBottom <= viewBottom
    );
}

function focusOnElement(element) {
    if (window.svg === undefined || element === null) return;
    let graphGroup = window.svg.querySelector('g.graph');
    const svg = window.svg;
    const containerWidth = svg.clientWidth;
    const containerHeight = svg.clientHeight;
    const containerRatio = containerWidth / containerHeight;

    const elementBBox = getBBoxInSVGCoords(element, svg);
    const graphBBox = getBBoxInSVGCoords(graphGroup, svg);

    const padding = 10;
    const focusMargin = 40;
    const maxZoom = 1.5;

    const minWidth = containerWidth / maxZoom;
    const minHeight = containerHeight / maxZoom;

    if (isElementWellInView(elementBBox)) {
        return;
    }

    const fitsHorizontally = graphBBox.width + padding * 2 <= minWidth;
    const fitsVertically = graphBBox.height + padding * 2 <= minHeight;
    const graphIsSmall = fitsHorizontally && fitsVertically;

    let targetViewBox = {};

    if (graphIsSmall) {
        const contentRatio = graphBBox.width / graphBBox.height;
        if (contentRatio > containerRatio) {
            targetViewBox.width = Math.max(graphBBox.width + padding * 2, minWidth);
            targetViewBox.height = targetViewBox.width / containerRatio;
        } else {
            targetViewBox.height = Math.max(graphBBox.height + padding * 2, minHeight);
            targetViewBox.width = targetViewBox.height * containerRatio;
        }

        targetViewBox.x = graphBBox.x - (targetViewBox.width - graphBBox.width) / 2;
        targetViewBox.y = graphBBox.y - (targetViewBox.height - graphBBox.height) / 2;
    } else {
        const focusWidth = Math.max(elementBBox.width + padding * 2, minWidth);
        const focusHeight = Math.max(elementBBox.height + padding * 2, minHeight);

        let viewWidth, viewHeight;
        if (focusWidth / focusHeight > containerRatio) {
            viewWidth = focusWidth;
            viewHeight = viewWidth / containerRatio;
        } else {
            viewHeight = focusHeight;
            viewWidth = viewHeight * containerRatio;
        }

        const centerX = elementBBox.x + elementBBox.width / 2;
        const viewX = centerX - viewWidth / 2;
        const viewY = elementBBox.y - focusMargin;

        targetViewBox = {
            x: viewX,
            y: viewY,
            width: viewWidth,
            height: viewHeight
        };
    }

    animateViewBox(targetViewBox);
}

function createGraphToolbar() {
    const fit = document.createElement('button');
    fit.type = 'button';
    fit.className = 'icon-text';
    fit.title = 'Fit graph';
    fit.append(createIcon('focus-2'), Object.assign(document.createElement('span'), { className: 'icon-label', textContent: 'Fit graph' }));
    fit.addEventListener('click', () => {
        if (!window.svg) return;
        const previous = { ...viewBox };
        resetViewBox();
        const target = { ...viewBox };
        viewBox = previous;
        animateViewBox(target);
    });
    document.querySelector('.development-toolbar-actions').append(fit);
}

let removePanAndZoomHandlers = () => {};

function installPanAndZoomHandler(svg) {
    removePanAndZoomHandlers();
    window.svg = svg;

    const savedViewBox = developmentUiState?.get('graphViewBox');
    resetViewBox();
    if (savedViewBox && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(savedViewBox[key])) && savedViewBox.width > 0 && savedViewBox.height > 0) {
        viewBox = { ...savedViewBox };
        updateViewBox();
    }

    const pointers = new Map();
    const pointerOrigins = new Map();
    let previousGesture = null;
    let dragged = false;
    let suppressClick = false;
    const gesture = () => {
        const values = [...pointers.values()];
        if (values.length === 1) return { type: 'pan', point: values[0] };
        if (values.length >= 2) {
            const [a, b] = values;
            return {
                type: 'pinch',
                midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
            };
        }
        return null;
    };
    const pointerDown = event => {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        cancelViewportAnimation();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        pointerOrigins.set(event.pointerId, { x: event.clientX, y: event.clientY });
        previousGesture = gesture();
        dragged = false;
        event.preventDefault();
    };
    const pointerMove = event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const origin = pointerOrigins.get(event.pointerId);
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) dragged = true;
        if (dragged && !svg.hasPointerCapture(event.pointerId)) svg.setPointerCapture(event.pointerId);
        const current = gesture();
        if (!previousGesture || !current || previousGesture.type !== current.type) {
            previousGesture = current;
            return;
        }
        const rectangle = svg.getBoundingClientRect();
        if (current.type === 'pan') {
            const delta = { x: current.point.x - previousGesture.point.x, y: current.point.y - previousGesture.point.y };
            viewBox = panViewBox(viewBox, rectangle, delta);
        } else {
            dragged = true;
            viewBox = pinchViewBox(viewBox, rectangle, previousGesture, current, viewportLimits);
        }
        previousGesture = current;
        updateViewBox();
        event.preventDefault();
    };
    const pointerEnd = event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        pointerOrigins.delete(event.pointerId);
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        suppressClick ||= dragged;
        previousGesture = gesture();
        dragged = false;
    };
    const clickCapture = event => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    svg.addEventListener('pointerdown', pointerDown);
    svg.addEventListener('pointermove', pointerMove);
    svg.addEventListener('pointerup', pointerEnd);
    svg.addEventListener('pointercancel', pointerEnd);
    svg.addEventListener('click', clickCapture, true);
    svg.addEventListener('wheel', zoom, { passive: false });
    const installedSvg = window.svg;
    removePanAndZoomHandlers = () => {
        cancelViewportAnimation();
        installedSvg.removeEventListener('pointerdown', pointerDown);
        installedSvg.removeEventListener('pointermove', pointerMove);
        installedSvg.removeEventListener('pointerup', pointerEnd);
        installedSvg.removeEventListener('pointercancel', pointerEnd);
        installedSvg.removeEventListener('click', clickCapture, true);
        installedSvg.removeEventListener('wheel', zoom);
    };
}

function initPaneSlider() {
    const leftPanel = el.devPane;
    const rightPanel = el.gamePane;
    const container = document.querySelector('#resizable-children');
    let isDragging = false;

    function initPanel() {
        const savedPercent = localStorage.getItem('leftPanelPercent');
        const containerWidth = container.clientWidth;

        if (savedPercent) {
            let percent = parseFloat(savedPercent);
            percent = clamp(percent, 20, 80);
            leftPanel.style.flex = `${percent}`;
            rightPanel.style.flex = `${100 - percent}`;
        } else {
            leftPanel.style.flex = `70`;
            rightPanel.style.flex = `30`;
        }
        setTimeout(() => {
            let width = el.devPane.clientWidth;
            el.devFixed.style.width = `${width}px`;
        }, 1);
    }

    el.divider.addEventListener('mousedown', (e) => {
        isDragging = true;
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        if (!isDragging) return;

        const containerRect = container.getBoundingClientRect();
        const newWidthPx = containerRect.right - e.clientX;
        const containerWidth = containerRect.width;
        const newPercent = 100 - (newWidthPx / containerWidth) * 100;
        leftPanel.style.flex = `${newPercent}`;
        rightPanel.style.flex = `${100 - newPercent}`;
        setTimeout(() => {
            let width = el.devPane.clientWidth;
            el.devFixed.style.width = `${width}px`;
        }, 1);
    }

    function onMouseUp() {
        isDragging = false;
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const containerWidth = container.clientWidth;
        const leftPanelWidth = leftPanel.clientWidth;
        const percent = (leftPanelWidth / containerWidth) * 100;
        localStorage.setItem('leftPanelPercent', percent);
    }

    function handleResize() {
        const savedPercent = localStorage.getItem('leftPanelPercent');
        if (savedPercent) {
            const percent = parseFloat(savedPercent);
            leftPanel.style.flex = `${percent}`;
            rightPanel.style.flex = `${percent}`;
        }
        setTimeout(() => {
            let width = el.devPane.clientWidth;
            el.devFixed.style.width = `${width}px`;
        }, 1);
    }

    initPanel();
    window.addEventListener('resize', handleResize);
}
