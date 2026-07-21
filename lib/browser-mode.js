export function resolveBrowserMode(locationObject = window.location) {
    const requested = new URLSearchParams(locationObject.search).get('mode');
    if (requested === 'game') return 'game';
    if (requested === 'dev') return 'dev';
    return locationObject.port.length > 0 || locationObject.search.indexOf('dev') > 0 ? 'dev' : 'game';
}
