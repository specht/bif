import markdownit from '/lib/markdown-it.js';
import markdownitAttrs from '/lib/markdown-it-attrs.js';
import { Graphviz } from '/lib/graphviz.min.js';

const ts = Date.now();
const { path, title } = await import(`/config.js?${ts}`);

document.title = title;

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
    content: document.getElementById('content'),
    storyStatus: document.getElementById('story-status'),
    clickedButton: null,
}

const cache_buster = `${Date.now()}`;

let history = [];
const context = {};

let devMode = (window.location.port.length > 0) || (window.location.search.indexOf('dev') > 0);
let printAnchor = el.content;
let nextPageLinks = {};
let deferred = null;
let choiceDiv = null;
const activeStoryTasks = new Set();
const pendingNavigations = new Map();
const replayNavigationRequests = new Map();
let navigationQueue = Promise.resolve();
let replayingHistory = false;
let currentPassageHasNavigation = false;
let storyRestartButton = null;
let keyboardNavigationPending = false;
let passageSerial = 0;
let currentPassage = null;
let sessionGeneration = 0;
let restoringSession = false;
let pendingSessionWrite = null;
let sessionWriteScheduled = false;

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
        block.textContent = 'This part of the story could not be displayed.';
    } else {
        const location = [error.pagePath, error.line ? `line ${error.line}` : null]
            .filter(Boolean).join(', ');
        const heading = document.createElement('strong');
        heading.textContent = `${errorLabels[error.kind] ?? 'Story error'}${location ? ` in ${location}` : ''}`;
        block.appendChild(heading);
        if (error.source) {
            const source = document.createElement('pre');
            source.textContent = error.source.trim();
            block.appendChild(source);
        }
        const message = document.createElement('div');
        const causeName = error.cause?.name && error.cause.name !== 'Error' ? `${error.cause.name}: ` : '';
        message.textContent = `${causeName}${error.message}`;
        block.appendChild(message);
        if (error.status) {
            const status = document.createElement('div');
            status.textContent = `HTTP ${error.status}`;
            block.appendChild(status);
        }
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
        } else if (key === 'forceTurnToPage') {
            // Legacy compatibility for existing stories. Prefer goToPage().
            return page => goToPage(page, generation);
        } else {
            return globalThis[key];
        }
    },
    set(target, key, value) {
        if (!sessionWasAbandoned(generation)) target[key] = value;
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

function trackStoryTask(promise, metadata, generation = sessionGeneration) {
    const task = Promise.resolve(promise);
    activeStoryTasks.add(task);
    task.catch(error => {
        if (error?.name === 'AbortError' || sessionWasAbandoned(generation)) return;
        const kind = metadata.hasAwait ? 'async-script' : 'page-script-runtime';
        reportStoryError(storyError(kind, metadata, error));
    }).finally(() => {
        activeStoryTasks.delete(task);
        if (!sessionWasAbandoned(generation)) {
            updateStateDisplay();
            updateRestartControl();
            scheduleSessionWrite();
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

function processDOM(inputRoot, outputRoot, pageMetadata, generation = sessionGeneration) {
    let scriptIndex = 0;

    function evaluate(expr) {
        return Function(...Object.keys(contextProxy), `return (${expr});`)(...Object.values(contextProxy));
    }

    function sourceMetadata(source) {
        return {
            pageId: pageMetadata.pageId,
            pagePath: pageMetadata.pagePath,
            line: markdownLine(pageMetadata.markdown, source),
            source,
        };
    }

    function checkCondition(node, outputParent) {
        if (!node.hasAttribute('condition')) return true;
        const source = node.getAttribute('condition');
        try {
            return Boolean(evaluate(source));
        } catch (cause) {
            reportStoryError(storyError('condition', sourceMetadata(source), cause), outputParent);
            return false;
        }
    }

    // Recursive processor
    function processNode(node, outputParent) {
        if (node.nodeType === Node.TEXT_NODE) {
            outputParent.appendChild(document.createTextNode(node.nodeValue));
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (!checkCondition(node, outputParent)) return; // Skip subtree

        if (node.hasAttribute('expression')) {
            const source = node.getAttribute('expression');
            try {
                const value = evaluate(source);
                outputParent.appendChild(document.createTextNode(value));
            } catch (cause) {
                reportStoryError(storyError('expression', sourceMetadata(source), cause), outputParent);
            }
            return;
        }

        if (node.tagName.toLowerCase() === 'script') {
            scriptIndex += 1;
            const code = node.textContent;
            const metadata = {
                ...sourceMetadata(code),
                scriptIndex,
                hasAwait: /\bawait\b/.test(code),
            };
            try {
                trackStoryTask(runInContext(code, metadata, generation, outputRoot), metadata, generation);
            } catch (error) {
                reportStoryError(error, outputParent);
            }
            return;
        }

        const clone = document.createElement(node.tagName);
        // Copy attributes (except 'expression' and 'condition')
        for (const attr of node.attributes) {
            if (attr.name !== 'expression' && attr.name !== 'condition') {
                clone.setAttribute(attr.name, attr.value);
            }
        }

        outputParent.appendChild(clone);

        for (const child of node.childNodes) {
            processNode(child, clone);
        }
    }

    for (const child of inputRoot.childNodes) {
        processNode(child, outputRoot);
    }
}

function encodeSession(session = history) {
    return lz.compress(session.join(','));
}

function decodeSession(hash = window.location.hash) {
    if (!hash) return null;
    const decompressed = lz.decompress(hash.replace(/^#/, ''));
    if (!decompressed) return null;
    const session = decompressed.split(',');
    const seed = Number.parseInt(session[0], 10);
    if (!Number.isFinite(seed) || session[1] !== '1') return null;
    return session;
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
        control.disabled = true;
    } else {
        control.removeAttribute('href');
        control.setAttribute('tabindex', '-1');
        control.setAttribute('aria-disabled', 'true');
        if (selected) control.setAttribute('aria-current', 'step');
        else control.setAttribute('aria-hidden', 'true');
    }
    if (!selected && container !== control) container.inert = true;
}

async function appendPage(page, generation = sessionGeneration) {
    const pagePath = `${path}/${page}.md`;
    let appendedPassage = null;
    await fetch(`/${pagePath}?${cache_buster}`)
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
        .then(data => {
            if (sessionWasAbandoned(generation)) throw abandonedSessionError();
            if (storyRestartButton) {
                storyRestartButton.remove();
                storyRestartButton = null;
            }
            currentPassageHasNavigation = false;
            if (history.length > 1) {
                el.content.appendChild(document.createElement('hr'));
            }

            appendedPassage = document.createElement('section');
            appendedPassage.classList.add('story-passage');
            appendedPassage.dataset.pageId = `${page}`;
            appendedPassage.setAttribute('tabindex', '-1');
            appendedPassage.setAttribute('aria-label', `Story passage ${page}`);
            appendedPassage.id = `story-passage-${++passageSerial}`;
            el.content.appendChild(appendedPassage);
            currentPassage = appendedPassage;

            const parser = new DOMParser();
            let html = md.render(data);
            let doc = parser.parseFromString('<div></div>' + html, 'text/html');
            replaceDoubleBrackets(doc);

            let count = 0;

            // collect all next page links for navigation
            nextPageLinks = {};
            for (let link of doc.querySelectorAll('a')) {
                let href = link.getAttribute('href');
                if (href.indexOf('/') < 0) {
                    let page = href;
                    nextPageLinks[page] = link;
                }
            }

            processDOM(doc.body, appendedPassage, { pageId: `${page}`, pagePath, markdown: data }, generation);

            const heading = appendedPassage.querySelector('h1, h2, h3, h4, h5, h6');
            if (heading) {
                heading.id ||= `${appendedPassage.id}-title`;
                appendedPassage.setAttribute('aria-labelledby', heading.id);
                appendedPassage.removeAttribute('aria-label');
            }

            history.push(page);

            for (let link of appendedPassage.querySelectorAll('a')) {
                let href = link.getAttribute('href') ?? '';
                if (href.indexOf('/') < 0) {
                    let page = link.getAttribute('href');
                    if (page) {
                        const control = link;
                        let parent = control.parentNode;
                        if ((parent.tagName ?? '').toLowerCase() === 'li') parent.classList.add('pagelink');
                        control.classList.add('story-choice');
                        nextPageLinks[page] = control;
                        currentPassageHasNavigation = true;
                        control.addEventListener('click', function (event) {
                            el.clickedButton = control;
                            if (control.classList.contains('chosen') || control.classList.contains('dismissed')) return;
                            keyboardNavigationPending = event.detail === 0;
                            event.preventDefault();
                            turnToPage(page, generation).catch(error => {
                                if (error?.name !== 'AbortError' && !error?.reported) {
                                    reportStoryError(storyError('navigation', { pageId: `${page}`, pagePath }, error));
                                }
                            });
                        });
                    }
                }
            }
            updateRestartControl();

            markNodesInGraph();
        })
        .then(() => {
            if (sessionWasAbandoned(generation)) return;
            scrollToElement(el.clickedButton);
            el.clickedButton = null;
            if (!replayingHistory && !restoringSession) {
                announcePassage(appendedPassage);
                if (keyboardNavigationPending) appendedPassage?.focus({ preventScroll: true });
                keyboardNavigationPending = false;
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
    const response = await fetch(`/${path}/${page}.md?${cache_buster}`);
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    return response.text();
}

function parsePage(text) {
    let group = null;
    let summary = null;

    let match = text.match(/<!--\s*(.*?)\s*--\s*(.*?)\s*-->/);
    if (match) {
        group = match[1].trim();
        summary = match[2].trim();
    } else {
        match = text.match(/<!--\s*(.*?)\s*-->/);
        if (match) {
            group = match[1].trim();
        }
    }
    let html = md.render(text);
    let dom = new DOMParser().parseFromString(html, 'text/html');
    let links = {};
    let linkLabels = {};
    for (let link of dom.querySelectorAll('a')) {
        let href = link.getAttribute('href');
        if (href.indexOf('/') < 0) {
            links[href] = link;
            if (link.hasAttribute('label')) {
                let label = link.getAttribute('label');
                linkLabels[href] = label.trim();
                if (linkLabels[href].length === 0)
                    linkLabels[href] = link.innerHTML.trim();
            }
        }
    }
    return {
        group: group,
        summary: summary,
        links: Object.keys(links),
        linkLabels: linkLabels,
    }
}

function getColorForGroup(groupLabel) {
    // Simple hash of string to integer
    let hash = 0;
    for (let i = 0; i < groupLabel.length; i++) {
        hash = groupLabel.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const saturation = 50;

    return [50, 70, 90].map(function (lightness) {
        // Convert HSL to RGB
        function hslToRgb(h, s, l) {
            s /= 100;
            l /= 100;
            const k = n => (n + h / 30) % 12;
            const a = s * Math.min(l, 1 - l);
            const f = n => {
                const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
                return Math.round(255 * v);
            };
            return [f(0), f(8), f(4)];
        }

        const [r, g, b] = hslToRgb(hue, saturation, lightness);
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        return hex;
    });
}

function markNodesInGraph() {
    if (!devMode) return;
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

function wordWrap(text, maxLength) {
    const words = text.split(' ');
    let line = '';
    let wrappedText = '';

    words.forEach(word => {
        if (line.length + word.length + 1 <= maxLength) {
            line += (line.length ? ' ' : '') + word;
        } else {
            wrappedText += line + '\n';
            line = word;
        }
    });
    wrappedText += line;

    return wrappedText;
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
            updateRestartControl();
            scheduleSessionWrite();
        }
    };
    navigation.then(clearPending, clearPending);
    return navigation;
}

function updateRestartControl() {
    const shouldShow = !currentPassageHasNavigation
        && activeStoryTasks.size === 0
        && pendingNavigations.size === 0;
    if (!shouldShow) {
        if (storyRestartButton) {
            storyRestartButton.remove();
            storyRestartButton = null;
        }
        return;
    }
    if (storyRestartButton) return;

    storyRestartButton = document.createElement('button');
    storyRestartButton.classList.add('pagelink', 'story-restart');
    el.content.appendChild(storyRestartButton);
    storyRestartButton.innerHTML = `<svg class="icon"><use href="#reload"></use></svg><span>Spiel neu starten</span>`;
    storyRestartButton.style.textAlign = 'center';
    storyRestartButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        window.location.href = '/';
    });
}

function goToPage(page, generation = sessionGeneration) {
    const pageId = `${page}`;
    if (sessionWasAbandoned(generation)) return Promise.reject(abandonedSessionError());
    if (!replayingHistory) {
        return navigateToPage(pageId, generation);
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
        if (!replayingHistory) requestSessionWrite('push');
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
        if (nextPageLinks[page].classList.contains('chosen')) {
            return pendingNavigations.get(`${page}`);
        }
        const selectedChoice = nextPageLinks[page];
        const choiceGroup = selectedChoice.closest('ul') ?? selectedChoice.parentElement;
        for (let control of choiceGroup.querySelectorAll('a.story-choice')) {
            deactivateChoice(control, control === selectedChoice);
        }
        if (!replayingHistory) requestSessionWrite('push');
        await navigateToPage(page, generation);
    }
}

function resetRuntimeForRestore() {
    if (deferred) deferred.reject(abandonedSessionError());
    deferred = null;
    if (choiceDiv) choiceDiv.remove();
    choiceDiv = null;
    nextPageLinks = {};
    for (const request of replayNavigationRequests.values()) {
        request.reject(abandonedSessionError());
    }
    replayNavigationRequests.clear();
    activeStoryTasks.clear();
    pendingNavigations.clear();
    navigationQueue = Promise.resolve();
    currentPassageHasNavigation = false;
    if (storyRestartButton) storyRestartButton.remove();
    storyRestartButton = null;
    el.clickedButton = null;
    el.content.innerHTML = '';
    currentPassage = null;
    keyboardNavigationPending = false;
    resetStoryContext();
    updateStateDisplay();
}

async function restoreSession(session) {
    const generation = ++sessionGeneration;
    restoringSession = true;
    pendingSessionWrite = null;
    const focusWasInTranscript = el.content.contains(document.activeElement);
    resetRuntimeForRestore();

    const seed = Number.parseInt(session[0], 10);
    const pages = session.slice(1);
    history = [`${seed}`];
    Math.random = mulberry32(seed);
    replayingHistory = true;
    try {
        await appendPage('1', generation);
        for (let i = 1; i < pages.length; i++) {
            await turnToPage(pages[i], generation);
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
            updateRestartControl();
            announcePassage(currentPassage, 'Current passage');
            if (focusWasInTranscript && currentPassage) {
                currentPassage.focus({ preventScroll: true });
            }
        }
    }
}

async function loadGraph() {
    let seenLinks = {};
    let wavefront = {};
    wavefront['1'] = true;
    let dotLinks = [];
    let subGraphs = {};
    let pageSummaries = {};
    let edgeSet = {};

    while (Object.keys(wavefront).length > 0) {
        let newWavefront = {};
        for (let pageCode of Object.keys(wavefront)) {
            seenLinks[pageCode] = true;
            let page = null;
            let pageData = null;
            try {
                page = await loadPage(pageCode);
                pageData = parsePage(page);
            } catch (e) {
                pageData = { links: [], missing: true };
            }
            pageData.group ??= '';
            subGraphs[pageData.group] ??= [];
            subGraphs[pageData.group].push(pageCode);
            pageData.summary ??= '';
            pageData.summary = `${pageCode} ${pageData.summary}`.trim();
            pageSummaries[pageCode] = pageData.summary;
            for (let link of pageData.links) {
                let edgeKey = `${pageCode}->${link}`;
                if (!edgeSet[edgeKey]) {
                    edgeSet[edgeKey] = true;
                    if (pageData.linkLabels[link]) {
                        dotLinks.push(`"${pageCode}" -> "${link}" [id="edge_${pageCode}_${link}", label="  ${wordWrap(pageData.linkLabels[link], 10)}"];`);
                    } else {
                        dotLinks.push(`"${pageCode}" -> "${link}" [id="edge_${pageCode}_${link}"];`);
                    }
                    if (seenLinks[link]) continue;
                    newWavefront[link] = true;
                }
            }
        }
        wavefront = newWavefront;
    }
    let dot = "";
    dot += `digraph Adventure {
    rankdir="TB"
    graph [fontname="Arial", fontsize=11, bgcolor="none"]
    node [shape=box, style=filled, fontname="Arial", fontsize=11, color="#000000"]
    edge [fontname="Arial", fontsize=11, penwidth=1, style="solid", color="#000000"]`;
    for (let group of Object.keys(subGraphs)) {
        if (group.length > 0) {
            const groupColor = getColorForGroup(group);
            dot += `subgraph cluster_${group.replace(/[^a-zA-Z0-9]/g, '_')} {
            label="${group}"
            labelloc="t"
            labeljust="l"
            style=filled
            color="${groupColor[0]}"
            fillcolor="${groupColor[2]}ff"
            node [style=filled, fillcolor="${groupColor[1]}", color="${groupColor[0]}"]
            ${subGraphs[group].map(page => `"${page}" [label="${wordWrap(pageSummaries[page] ?? '', 10).trim()}", id="node_${page}"]`).join('\n')}
        }`;
        } else {
            dot += `
            ${subGraphs[group].map(page => `"${page}" [label="${wordWrap(pageSummaries[page] ?? '', 10).trim()}", id="node_${page}", style=filled, fillcolor="#cccccc", color="#888888"]`).join('\n')}
            `;
        }
    }
    dot += dotLinks.join('\n');
    dot += `}`;
    Graphviz.load().then(graphviz => {
        const svg = graphviz.dot(dot);
        el.graphContainer.innerHTML = svg;
        el.graphContainer.querySelector('svg').removeAttribute('width');
        el.graphContainer.querySelector('svg').removeAttribute('height');
        for (let e of document.querySelectorAll('#graph-container svg title')) e.remove();
        markNodesInGraph();
        installPanAndZoomHandler(document.querySelector('#graph-container svg'));
        for (let e of document.querySelectorAll('svg g.node')) {
            e.addEventListener('click', async function (event) {
                let id = this.getAttribute('id');
                let page = id.substring(5);
                if (nextPageLinks[page]) {
                    // the node is one of the next pages, turn to that page
                    // find button that belongs to the node
                    el.clickedButton = nextPageLinks[page];
                    await turnToPage(page);
                } else {
                    // the node is in the history, turn to that page
                    let index = history.lastIndexOf(page);
                    if (index > 0 && index < history.length - 1) {
                        el.body.classList.add('skip-animations');
                        let new_history = history.slice(0, index + 1);
                        await restoreSession(new_history);
                        requestSessionWrite('push');
                        el.body.classList.remove('skip-animations');
                    }
                }
            });
        }

    });
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

export async function init() {
    setTimeout(() => {
        let width = el.devPane.clientWidth;
        el.devFixed.style.width = `${width}px`;
    }, 1);
    el.body.classList.add('skip-animations');
    if (devMode) {
        el.body.classList.add('dev');
        document.querySelector('#bu_reset_game').addEventListener('click', function () {
            window.location = '/';
        });
        document.querySelector('nav').style.display = 'unset';
        // document.querySelector('#bu_fit_zoom').addEventListener('click', function() {
        //     resetViewBox();
        // });
    }
    Math.w6 = () => Math.floor(Math.rand() * 6) + 1;
    Math.chance = (x) => Math.random() * 100 < x;
    const urlSession = decodeSession();
    if (urlSession) {
        await restoreSession(urlSession);
    } else {
        await restoreSession([`${randomSeed()}`, '1']);
        requestSessionWrite('replace');
    }

    if (devMode) {
        loadGraph();
        updateStateDisplay();
        initPaneSlider();
    }
    el.body.classList.remove('skip-animations');

    window.addEventListener('popstate', async () => {
        const session = decodeSession();
        if (!session) return;
        el.body.classList.add('skip-animations');
        try {
            await restoreSession(session);
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.error('Could not restore story session:', error);
                appendSection(`Fehler beim Wiederherstellen der Sitzung: ${error.message}`);
            }
        } finally {
            el.body.classList.remove('skip-animations');
        }
    });
}

function scrollToElement(e) {
    if (!e) return;
    const top = e.offsetTop - 10;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.body.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
}

function appendSection(text) {
    const section = document.createElement('div');
    section.classList.add('page');
    section.innerHTML = md.render(text);
    content.appendChild(section);
}

let isPanning = false;
let startPoint = { x: 0, y: 0 };
let viewBox = { x: 0, y: 0, width: 0, height: 0 };
let currentScale = 1;

let touchStartDistance = 0;
let isTouching = false;

function handlePan(e) {
    if (!isPanning) return;

    const dx = (e.clientX - startPoint.x) / currentScale;
    const dy = (e.clientY - startPoint.y) / currentScale;

    viewBox.x -= dx;
    viewBox.y -= dy;

    updateViewBox();
    startPoint = { x: e.clientX, y: e.clientY };
}

function startPan(e) {
    isPanning = true;
    startPoint = { x: e.clientX, y: e.clientY };
}

function pan(e) {
    if (!isPanning) return;

    const dx = (e.clientX - startPoint.x) / currentScale;
    const dy = (e.clientY - startPoint.y) / currentScale;

    viewBox.x -= dx;
    viewBox.y -= dy;

    updateViewBox();
    startPoint = { x: e.clientX, y: e.clientY };
}

function endPan() {
    isPanning = false;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function zoom(e) {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const wheelDelta = -e.deltaY;
    const zoomFactor = wheelDelta > 0 ? 1 - zoomIntensity : 1 + zoomIntensity;

    const mouseX = e.clientX - window.svg.getBoundingClientRect().left;
    const mouseY = e.clientY - window.svg.getBoundingClientRect().top;
    const mouseXPercent = mouseX / window.svg.clientWidth;
    const mouseYPercent = mouseY / window.svg.clientHeight;

    const prevWidth = viewBox.width;
    const prevHeight = viewBox.height;

    viewBox.width *= zoomFactor;
    viewBox.height *= zoomFactor;

    viewBox.x += mouseXPercent * (prevWidth - viewBox.width);
    viewBox.y += mouseYPercent * (prevHeight - viewBox.height);

    updateViewBox();
}

function handleTouchStart(e) {
    if (e.touches.length === 2) {
        touchStartDistance = getDistance(e.touches[0], e.touches[1]);
        isTouching = true;
    } else if (e.touches.length === 1) {
        startPan({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
        isTouching = true;
    }
}

function handleTouchMove(e) {
    if (!isTouching) return;
    e.preventDefault();

    if (e.touches.length === 2) {
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const zoomFactor = currentDistance / touchStartDistance;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        zoom({
            deltaY: zoomFactor < 1 ? 1 : -1,
            clientX: midX,
            clientY: midY,
            preventDefault: () => { }
        });
        touchStartDistance = currentDistance;
    } else if (e.touches.length === 1) {
        pan({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
}

function handleTouchEnd(e) {
    isTouching = false;
    endPan();
}


function getDistance(touch1, touch2) {
    return Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
    );
}

function updateViewBox() {
    window.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    currentScale = window.svg.clientWidth / viewBox.width;
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

    updateViewBox();
}

let animationFrameId = null;

function animateViewBox(target, duration = 300) {
    const start = { ...viewBox };
    const end = { ...target };
    const startTime = performance.now();

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = easeInOutQuad(t);

        viewBox.x = lerp(start.x, end.x, ease);
        viewBox.y = lerp(start.y, end.y, ease);
        viewBox.width = lerp(start.width, end.width, ease);
        viewBox.height = lerp(start.height, end.height, ease);

        updateViewBox();

        if (t < 1) {
            animationFrameId = requestAnimationFrame(step);
        } else {
            animationFrameId = null;
        }
    }

    requestAnimationFrame(step);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
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
    console.log('focusing on element', element);
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

function installPanAndZoomHandler(svg) {
    window.svg = svg;

    resetViewBox();

    window.svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isPanning = true;
        startPoint = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    });

    document.addEventListener('mousemove', handlePan);
    document.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        isPanning = false;
    });

    window.svg.addEventListener('mouseleave', (e) => {
        if (!isPanning) return;
    });
    window.svg.addEventListener('wheel', zoom);

    window.svg.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.svg.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.svg.addEventListener('touchend', handleTouchEnd);
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
