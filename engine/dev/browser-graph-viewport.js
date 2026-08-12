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
