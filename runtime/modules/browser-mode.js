const STORAGE_VERSION = 1;

export function isAuthoringEnvironment(locationObject = window.location) {
    return Boolean(locationObject.port);
}

export function modePreferenceKey(locationObject = window.location) {
    return `bif:view:v${STORAGE_VERSION}:${locationObject.origin}${locationObject.pathname}`;
}

function storageValue(storage, key) {
    try {
        const value = storage?.getItem(key);
        return value === 'dev' || value === 'game' ? value : null;
    } catch { return null; }
}

export function resolveBrowserMode(locationObject = window.location, storage = window.localStorage) {
    if (!isAuthoringEnvironment(locationObject)) return 'game';
    const requested = new URLSearchParams(locationObject.search).get('mode');
    const mode = requested === 'dev' || requested === 'game'
        ? requested
        : storageValue(storage, modePreferenceKey(locationObject)) || 'dev';
    if (requested === mode) rememberBrowserMode(mode, locationObject, storage);
    return mode;
}

export function rememberBrowserMode(mode, locationObject = window.location, storage = window.localStorage) {
    if (!isAuthoringEnvironment(locationObject) || !['dev', 'game'].includes(mode)) return false;
    try { storage?.setItem(modePreferenceKey(locationObject), mode); return true; }
    catch { return false; }
}

export function switchBrowserMode(mode, locationObject = window.location, storage = window.localStorage) {
    rememberBrowserMode(mode, locationObject, storage);
    const url = new URL(locationObject.href);
    url.searchParams.set('mode', mode);
    return `${url.pathname}${url.search}${url.hash}`;
}
