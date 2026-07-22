export function clientPointToWorld(viewBox, rectangle, clientPoint) {
    return {
        x: viewBox.x + ((clientPoint.x - rectangle.left) / rectangle.width) * viewBox.width,
        y: viewBox.y + ((clientPoint.y - rectangle.top) / rectangle.height) * viewBox.height,
    };
}

export function zoomViewBoxAt(viewBox, rectangle, clientPoint, factor, limits = {}) {
    const world = clientPointToWorld(viewBox, rectangle, clientPoint);
    const width = Math.min(limits.maxWidth ?? Infinity, Math.max(limits.minWidth ?? 1, viewBox.width * factor));
    const height = width * (viewBox.height / viewBox.width);
    const rx = (clientPoint.x - rectangle.left) / rectangle.width;
    const ry = (clientPoint.y - rectangle.top) / rectangle.height;
    return { x: world.x - rx * width, y: world.y - ry * height, width, height };
}

export function panViewBox(viewBox, rectangle, delta) {
    return {
        ...viewBox,
        x: viewBox.x - delta.x * viewBox.width / rectangle.width,
        y: viewBox.y - delta.y * viewBox.height / rectangle.height,
    };
}

export function pinchViewBox(viewBox, rectangle, previous, current, limits) {
    const moved = panViewBox(viewBox, rectangle, {
        x: current.midpoint.x - previous.midpoint.x,
        y: current.midpoint.y - previous.midpoint.y,
    });
    return zoomViewBoxAt(moved, rectangle, current.midpoint, previous.distance / current.distance, limits);
}

export function interpolateViewBox(start, end, t) {
    return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, start[key] + (end[key] - start[key]) * t]));
}

export function followViewBoxTarget(viewBox, bounds, {
    margin = 0.15,
    epsilon = 0.5,
    minWidth = 1,
    maxWidth = Infinity,
} = {}) {
    if (![viewBox.x, viewBox.y, viewBox.width, viewBox.height, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        || viewBox.width <= 0 || viewBox.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
    const innerRatio = Math.max(0.1, 1 - margin * 2);
    const aspect = viewBox.width / viewBox.height;
    const requiredWidth = Math.max(bounds.width / innerRatio, bounds.height * aspect / innerRatio);
    const width = Math.min(maxWidth, Math.max(minWidth, viewBox.width, requiredWidth));
    const height = width / aspect;
    let x = viewBox.x - (width - viewBox.width) / 2;
    let y = viewBox.y - (height - viewBox.height) / 2;
    const innerLeft = () => x + width * margin;
    const innerRight = () => x + width * (1 - margin);
    const innerTop = () => y + height * margin;
    const innerBottom = () => y + height * (1 - margin);
    if (bounds.x < innerLeft() - epsilon) x += bounds.x - innerLeft();
    else if (bounds.x + bounds.width > innerRight() + epsilon) x += bounds.x + bounds.width - innerRight();
    if (bounds.y < innerTop() - epsilon) y += bounds.y - innerTop();
    else if (bounds.y + bounds.height > innerBottom() + epsilon) y += bounds.y + bounds.height - innerBottom();
    const target = { x, y, width, height };
    return ['x', 'y', 'width', 'height'].every(key => Math.abs(target[key] - viewBox[key]) <= epsilon) ? null : target;
}
