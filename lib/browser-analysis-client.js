const SUPPORTED_SCHEMA_VERSION = 1;
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

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
} = {}) {
    let requestGeneration = 0;
    let requestToken = 0;
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

    function publish(nextState) {
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

    async function refresh() {
        const generation = ++requestGeneration;
        const lastValidModel = state.lastValidModel;
        const lastHash = state.lastHash;
        publish({
            status: 'loading',
            model: lastValidModel,
            lastValidModel,
            lastHash,
            message: null,
            changed: false,
        });

        const separator = url.includes('?') ? '&' : '?';
        const requestUrl = `${url}${separator}v=${++requestToken}`;
        let response;
        try {
            response = await fetchImplementation(requestUrl, { cache: 'no-store' });
        } catch (error) {
            if (generation !== requestGeneration) return state;
            const message = 'network request failed';
            logFailureOnce(`${message}:${error?.message}`, error);
            publish(failureState('error', message));
            return state;
        }
        if (generation !== requestGeneration) return state;
        if (!response.ok) {
            const unavailable = response.status === 404;
            const message = unavailable ? 'analysis file was not found' : `request failed (HTTP ${response.status})`;
            if (!unavailable) logFailureOnce(message, message);
            publish(failureState(unavailable ? 'unavailable' : 'error', message));
            return state;
        }

        let value;
        try {
            value = JSON.parse(await response.text());
        } catch (error) {
            if (generation !== requestGeneration) return state;
            const message = 'invalid JSON';
            logFailureOnce(message, error);
            publish(failureState('invalid', message));
            return state;
        }
        if (generation !== requestGeneration) return state;
        const validation = validateBrowserAnalysis(value);
        if (!validation.valid) {
            logFailureOnce(validation.reason, validation.reason);
            publish(failureState('invalid', validation.reason));
            return state;
        }

        const changed = validation.model.contentHash !== state.lastHash;
        publish({
            status: 'ready',
            model: validation.model,
            lastValidModel: validation.model,
            lastHash: validation.model.contentHash,
            message: null,
            changed,
        });
        return state;
    }

    return {
        getState: () => state,
        refresh,
        subscribe(listener) {
            listeners.add(listener);
            listener(state);
            return () => listeners.delete(listener);
        },
    };
}
