const SUPPORTED_SCHEMA_VERSION = 2;
const SUMMARY_FIELDS = [
    'pages',
    'reachablePages',
    'unreachablePages',
    'choices',
    'groups',
    'missingTargets',
    'errors',
    'warnings',
];
const DIAGNOSTIC_SEVERITIES = new Set(['error', 'warning', 'information', 'info', 'hint']);
export const FAST_RETRY_DELAYS_MS = [250, 250, 500, 500, 1000];
export const MONITOR_INTERVAL_MS = 4000;
const DEFAULT_REFRESH_DEBOUNCE_MS = 300;
const ASSET_VERIFY_INTERVAL_MS = 60000;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function analysisIdentity(model) {
    return model.analysisHash;
}

export function validateBrowserAnalysis(value) {
    if (!isObject(value)) return { valid: false, reason: 'invalid top-level value' };
    if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        return {
            valid: false,
            reason: Number.isInteger(value.schemaVersion)
                ? `unsupported schema version ${value.schemaVersion}`
                : 'invalid schema version',
        };
    }
    if (typeof value.contentHash !== 'string' || value.contentHash.trim().length === 0) {
        return { valid: false, reason: 'invalid content hash' };
    }
    if (!/^[a-f0-9]{64}$/.test(value.analysisHash || '')) {
        return { valid: false, reason: 'invalid analysis hash' };
    }
    if (!Array.isArray(value.inputManifest) || value.inputManifest.length === 0) return { valid: false, reason: 'invalid input manifest' };
    for (const entry of value.inputManifest) {
        if (!isObject(entry) || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
            || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) {
            return { valid: false, reason: 'invalid input manifest entry' };
        }
    }
    if (!isObject(value.project)
        || typeof value.project.title !== 'string'
        || typeof value.project.pagesPath !== 'string'
        || typeof value.project.startPage !== 'string') {
        return { valid: false, reason: 'invalid project details' };
    }
    if (!isObject(value.summary)) return { valid: false, reason: 'invalid summary' };
    for (const field of SUMMARY_FIELDS) {
        if (!Number.isSafeInteger(value.summary[field]) || value.summary[field] < 0) {
            return { valid: false, reason: `invalid summary: ${field} must be a non-negative integer` };
        }
    }
    for (const field of ['nodes', 'edges', 'groups', 'diagnostics']) {
        if (!Array.isArray(value[field])) return { valid: false, reason: `invalid ${field} collection` };
    }
    for (const diagnostic of value.diagnostics) {
        if (!isObject(diagnostic) || !DIAGNOSTIC_SEVERITIES.has(diagnostic.severity)) {
            return { valid: false, reason: 'invalid diagnostic severity' };
        }
    }
    return { valid: true, model: value };
}

export function createBrowserAnalysisClient({
    url = '.story-tools/analysis.json',
    fetchImplementation = window.fetch.bind(window),
    fastRetryDelaysMs,
    monitorIntervalMs,
    pollIntervalMs,
    refreshDebounceMs = DEFAULT_REFRESH_DEBOUNCE_MS,
    documentObject = document,
    windowObject = window,
    setTimeoutImplementation = window.setTimeout.bind(window),
    clearTimeoutImplementation = window.clearTimeout.bind(window),
    cryptoObject = globalThis.crypto,
    now = Date.now,
} = {}) {
    let requestGeneration = 0;
    let requestToken = 0;
    let activeRequest = null;
    let activeController = null;
    let pendingRefresh = false;
    let pendingReason = null;
    let pollTimer = null;
    let focusTimer = null;
    let visibilityGuardTimer = null;
    let syncIndex = 0;
    let syncObservedHash = null;
    let schedulingMode = 'syncing';
    let started = false;
    let disposed = false;
    let lastAssetVerification = 0;
    let state = {
        status: 'idle',
        model: null,
        lastValidModel: null,
        lastHash: null,
        message: null,
        changed: false,
    };
    const listeners = new Set();
    const loggedFailures = new Set();
    const fastDelays = fastRetryDelaysMs ?? (pollIntervalMs == null ? FAST_RETRY_DELAYS_MS : [pollIntervalMs]);
    const monitorDelay = monitorIntervalMs ?? pollIntervalMs ?? MONITOR_INTERVAL_MS;

    function publish(nextState) {
        if (disposed) return;
        state = nextState;
        for (const listener of listeners) listener(state);
    }

    function logFailureOnce(key, detail) {
        if (loggedFailures.has(key)) return;
        loggedFailures.add(key);
        console.warn('Project analysis could not be read:', detail);
    }

    function failureState(status, message) {
        return {
            status,
            model: state.lastValidModel,
            lastValidModel: state.lastValidModel,
            lastHash: state.lastHash,
            message,
            changed: false,
        };
    }

    function publishFailure(status, message) {
        if (state.status === status && state.message === message) return;
        publish(failureState(status, message));
    }

    async function sha256(bytes) {
        const digest = await cryptoObject.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    }

    async function verifyManifest(model, reason) {
        const verifyAssets = ['initial', 'manual', 'focus', 'visibility'].includes(reason)
            || now() - lastAssetVerification >= ASSET_VERIFY_INTERVAL_MS;
        const entries = model.inputManifest.filter(entry => /\.(?:md|js)$/i.test(entry.path) || verifyAssets);
        if (verifyAssets) lastAssetVerification = now();
        for (const entry of entries) {
            const requestUrl = new URL(entry.path, documentObject.baseURI || windowObject.location.href);
            requestUrl.searchParams.set('bif_verify', `${++requestToken}`);
            let response;
            try { response = await fetchImplementation(requestUrl.href, { cache: 'no-store', signal: activeController.signal }); }
            catch { return { current: false, reason: `input could not be read: ${entry.path}` }; }
            if (!response.ok) return { current: false, reason: `input is missing: ${entry.path}` };
            if (await sha256(await response.arrayBuffer()) !== entry.sha256) return { current: false, reason: `input changed: ${entry.path}` };
        }
        return { current: true };
    }

    async function performRefresh(reason) {
        const generation = ++requestGeneration;
        const lastValidModel = state.lastValidModel;
        const lastHash = state.lastHash;
        if (reason === 'initial' || reason === 'manual') {
            publish({
                status: 'loading',
                model: lastValidModel,
                lastValidModel,
                lastHash,
                message: null,
                changed: false,
            });
        }

        const separator = url.includes('?') ? '&' : '?';
        const requestUrl = `${url}${separator}v=${++requestToken}`;
        activeController = new AbortController();
        let response;
        try {
            response = await fetchImplementation(requestUrl, {
                cache: 'no-store',
                signal: activeController.signal,
            });
        } catch (error) {
            if (disposed || generation !== requestGeneration) return state;
            const message = 'network request failed';
            logFailureOnce(`${message}:${error?.message}`, error);
            publishFailure('error', message);
            return state;
        }
        if (disposed || generation !== requestGeneration) return state;
        if (!response.ok) {
            const unavailable = response.status === 404;
            const message = unavailable ? 'analysis file was not found' : `request failed (HTTP ${response.status})`;
            if (!unavailable) logFailureOnce(message, message);
            publishFailure(unavailable ? 'unavailable' : 'error', message);
            return state;
        }

        let value;
        try {
            value = JSON.parse(await response.text());
        } catch (error) {
            if (disposed || generation !== requestGeneration) return state;
            const message = 'invalid JSON';
            logFailureOnce(message, error);
            publishFailure('invalid', message);
            return state;
        }
        if (disposed || generation !== requestGeneration) return state;
        const validation = validateBrowserAnalysis(value);
        if (!validation.valid) {
            logFailureOnce(validation.reason, validation.reason);
            publishFailure('invalid', validation.reason);
            return state;
        }

        const manifest = await verifyManifest(validation.model, reason);
        if (disposed || generation !== requestGeneration) return state;

        const identity = analysisIdentity(validation.model);
        const changed = identity !== state.lastHash;
        if (!changed && state.status === (manifest.current ? 'ready' : 'stale')) return state;
        if (schedulingMode === 'syncing') {
            if (syncObservedHash === null) syncObservedHash = identity;
            else if (identity !== syncObservedHash) schedulingMode = 'monitoring';
        }
        publish({
            status: manifest.current ? 'ready' : 'stale',
            model: validation.model,
            lastValidModel: validation.model,
            lastHash: identity,
            message: manifest.current ? null : manifest.reason,
            changed,
        });
        return state;
    }

    function clearPollTimer() {
        if (pollTimer !== null) clearTimeoutImplementation(pollTimer);
        pollTimer = null;
    }

    function beginSyncWindow() {
        schedulingMode = 'syncing';
        syncIndex = 0;
        syncObservedHash = state.lastHash;
    }

    function scheduleNextPoll() {
        clearPollTimer();
        if (!started || disposed || documentObject.hidden) return;
        let delay = monitorDelay;
        let reason = 'monitor';
        if (schedulingMode === 'syncing' && syncIndex < fastDelays.length) {
            delay = fastDelays[syncIndex++];
            reason = 'fast-retry';
        } else {
            schedulingMode = 'monitoring';
        }
        pollTimer = setTimeoutImplementation(() => {
            pollTimer = null;
            void requestRefresh(reason);
        }, delay);
    }

    function launchRefresh(reason) {
        clearPollTimer();
        const request = performRefresh(reason);
        activeRequest = request;
        request.finally(() => {
            if (activeRequest !== request) return;
            activeRequest = null;
            activeController = null;
            if (disposed) return;
            if (pendingRefresh && !documentObject.hidden) {
                const nextReason = pendingReason || 'coalesced';
                pendingRefresh = false;
                pendingReason = null;
                launchRefresh(nextReason);
            } else {
                pendingRefresh = false;
                pendingReason = null;
                scheduleNextPoll();
            }
        });
        return request;
    }

    function requestRefresh(reason = 'manual') {
        if (disposed) return Promise.resolve(state);
        if (documentObject.hidden && !['initial', 'manual'].includes(reason)) return Promise.resolve(state);
        if (['initial', 'manual', 'focus', 'visibility'].includes(reason)) beginSyncWindow();
        clearPollTimer();
        if (activeRequest) {
            pendingRefresh = true;
            if (reason === 'manual' || !pendingReason) pendingReason = reason;
            return activeRequest;
        }
        return launchRefresh(reason);
    }

    function clearFocusTimer() {
        if (focusTimer !== null) clearTimeoutImplementation(focusTimer);
        focusTimer = null;
    }

    function onFocus() {
        if (disposed || documentObject.hidden || visibilityGuardTimer !== null) return;
        clearFocusTimer();
        focusTimer = setTimeoutImplementation(() => {
            focusTimer = null;
            void requestRefresh('focus');
        }, refreshDebounceMs);
    }

    function onVisibilityChange() {
        if (documentObject.hidden) {
            clearPollTimer();
            clearFocusTimer();
            return;
        }
        clearFocusTimer();
        if (visibilityGuardTimer !== null) clearTimeoutImplementation(visibilityGuardTimer);
        visibilityGuardTimer = setTimeoutImplementation(() => {
            visibilityGuardTimer = null;
        }, refreshDebounceMs);
        void requestRefresh('visibility');
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        requestGeneration += 1;
        clearPollTimer();
        clearFocusTimer();
        if (visibilityGuardTimer !== null) clearTimeoutImplementation(visibilityGuardTimer);
        visibilityGuardTimer = null;
        activeController?.abort();
        activeController = null;
        pendingRefresh = false;
        pendingReason = null;
        windowObject.removeEventListener('focus', onFocus);
        windowObject.removeEventListener('pagehide', dispose);
        documentObject.removeEventListener('visibilitychange', onVisibilityChange);
        listeners.clear();
    }

    function start() {
        if (started || disposed) return activeRequest || Promise.resolve(state);
        started = true;
        windowObject.addEventListener('focus', onFocus);
        windowObject.addEventListener('pagehide', dispose);
        documentObject.addEventListener('visibilitychange', onVisibilityChange);
        return requestRefresh('initial');
    }

    return {
        getState: () => state,
        start,
        requestRefresh,
        refresh: () => requestRefresh('manual'),
        dispose,
        subscribe(listener) {
            if (disposed) return () => {};
            listeners.add(listener);
            listener(state);
            return () => listeners.delete(listener);
        },
    };
}
