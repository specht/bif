const VERSION = 1;

function safeStorage() {
    try { const storage = window.sessionStorage; storage.getItem('__bif_probe__'); return storage; }
    catch { return null; }
}

export function createDevelopmentUiState({ storyPath, mode }) {
    const key = `bif:development-ui:v${VERSION}:${location.origin}${location.pathname}:${mode}:${storyPath}`;
    const storage = safeStorage();
    let value = {};
    try {
        const parsed = JSON.parse(storage?.getItem(key) || '{}');
        if (parsed?.version === VERSION && parsed.value && typeof parsed.value === 'object') value = parsed.value;
    } catch { value = {}; }
    let timer = null;
    const flush = () => {
        timer = null;
        try { storage?.setItem(key, JSON.stringify({ version: VERSION, value })); } catch { /* optional storage */ }
    };
    const schedule = () => { if (timer === null) timer = window.setTimeout(flush, 100); };
    const onPageHide = () => flush();
    window.addEventListener('pagehide', onPageHide);
    return {
        key,
        get(name, fallback = null) { return value[name] ?? fallback; },
        set(name, next, { immediate = false } = {}) { value = { ...value, [name]: next }; immediate ? flush() : schedule(); },
        dispose() { if (timer !== null) window.clearTimeout(timer); flush(); window.removeEventListener('pagehide', onPageHide); },
    };
}
