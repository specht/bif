const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = new Set(['alert-triangle', 'check', 'chevron-down', 'chevron-up', 'focus-2', 'refresh', 'x']);

export function createIcon(name) {
    if (!ICONS.has(name)) throw new Error(`Unknown browser icon: ${name}`);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', new URL(`../assets/icons.svg#icon-${name}`, import.meta.url).href);
    svg.append(use);
    return svg;
}
