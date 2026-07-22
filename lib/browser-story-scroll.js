export function localTurnScrollTarget({
    scrollTop, clientHeight, scrollHeight, turnTop, turnBottom,
    liveBottom = null, paddingTop = 0, paddingBottom = 0, topInset = 20,
}) {
    const values = [scrollTop, clientHeight, scrollHeight, turnTop, turnBottom, paddingTop, paddingBottom, topInset];
    if (liveBottom !== null) values.push(liveBottom);
    if (!values.every(Number.isFinite) || clientHeight <= 0 || scrollHeight < 0) return null;
    const spanBottom = liveBottom === null ? turnBottom : Math.max(turnBottom, liveBottom);
    const viewportTop = scrollTop + paddingTop;
    const viewportBottom = scrollTop + clientHeight - paddingBottom;
    if (turnTop >= viewportTop && spanBottom <= viewportBottom) return null;
    const usableHeight = Math.max(0, clientHeight - paddingTop - paddingBottom);
    const spanHeight = Math.max(0, spanBottom - turnTop);
    const desired = spanHeight <= usableHeight
        ? spanBottom + paddingBottom - clientHeight
        : turnTop - paddingTop - topInset;
    return Math.min(Math.max(desired, 0), Math.max(0, scrollHeight - clientHeight));
}
