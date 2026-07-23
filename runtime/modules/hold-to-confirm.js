export const HOLD_CONFIRM_DURATION_MS = 900;

export function createHoldToConfirmControl({
    button,
    durationMs = HOLD_CONFIRM_DURATION_MS,
    shouldRequireHold = () => true,
    onConfirm,
    labels = {},
}) {
    const idleLabel = labels.idle || 'Hold to confirm';
    const holdingLabel = labels.holding || 'Release to cancel';
    const confirmingLabel = labels.confirming || 'Confirming';
    let timer = null;
    let frame = null;
    let startedAt = 0;
    let pointerId = null;
    let key = null;
    let confirmed = false;
    let suppressClick = false;

    function setLabel(label) {
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function setProgress(value) {
        button.style.setProperty('--hold-progress', `${Math.max(0, Math.min(1, value))}turn`);
    }

    function reset() {
        if (timer !== null) window.clearTimeout(timer);
        if (frame !== null) window.cancelAnimationFrame(frame);
        if (pointerId !== null && button.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId);
        timer = null;
        frame = null;
        pointerId = null;
        key = null;
        startedAt = 0;
        confirmed = false;
        button.classList.remove('is-holding', 'is-confirming');
        button.removeAttribute('aria-busy');
        setProgress(0);
        setLabel(idleLabel);
    }

    function finish() {
        if (timer === null || confirmed) return;
        confirmed = true;
        suppressClick = true;
        button.classList.remove('is-holding');
        button.classList.add('is-confirming');
        button.setAttribute('aria-busy', 'true');
        setProgress(1);
        setLabel(confirmingLabel);
        timer = null;
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        Promise.resolve(onConfirm()).finally(reset);
    }

    function draw(now) {
        if (timer === null) return;
        setProgress((now - startedAt) / durationMs);
        frame = window.requestAnimationFrame(draw);
    }

    function start(nextPointerId = null, nextKey = null) {
        if (timer !== null || confirmed || !shouldRequireHold()) return false;
        pointerId = nextPointerId;
        key = nextKey;
        suppressClick = true;
        startedAt = performance.now();
        button.classList.add('is-holding');
        setLabel(holdingLabel);
        setProgress(0);
        if (pointerId !== null) button.setPointerCapture?.(pointerId);
        timer = window.setTimeout(finish, durationMs);
        frame = window.requestAnimationFrame(draw);
        return true;
    }

    function cancel() {
        if (timer !== null && !confirmed) {
            reset();
            window.setTimeout(() => { suppressClick = false; }, 0);
        }
    }

    const onPointerDown = event => {
        if (event.button !== 0 || !event.isPrimary) return;
        start(event.pointerId);
    };
    const onPointerUp = event => {
        if (pointerId === event.pointerId) cancel();
    };
    const onPointerCancel = event => {
        if (pointerId === event.pointerId) cancel();
    };
    const onPointerMove = event => {
        if (pointerId !== event.pointerId) return;
        const bounds = button.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
    };
    const onPointerLeave = event => {
        if (pointerId === event.pointerId) cancel();
    };
    const onKeyDown = event => {
        if (event.key === 'Escape') { cancel(); return; }
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat && start(null, event.key)) event.preventDefault();
    };
    const onKeyUp = event => {
        if (key === event.key) { event.preventDefault(); cancel(); }
    };
    const onClick = event => {
        if (suppressClick) {
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (!shouldRequireHold()) void onConfirm();
    };
    const onBlur = () => cancel();

    setLabel(idleLabel);
    setProgress(0);
    button.addEventListener('pointerdown', onPointerDown);
    button.addEventListener('pointerup', onPointerUp);
    button.addEventListener('pointercancel', onPointerCancel);
    button.addEventListener('pointermove', onPointerMove);
    button.addEventListener('pointerleave', onPointerLeave);
    button.addEventListener('keydown', onKeyDown);
    button.addEventListener('keyup', onKeyUp);
    button.addEventListener('click', onClick);
    button.addEventListener('blur', onBlur);

    return {
        cancel,
        destroy() {
            reset();
            button.removeEventListener('pointerdown', onPointerDown);
            button.removeEventListener('pointerup', onPointerUp);
            button.removeEventListener('pointercancel', onPointerCancel);
            button.removeEventListener('pointermove', onPointerMove);
            button.removeEventListener('pointerleave', onPointerLeave);
            button.removeEventListener('keydown', onKeyDown);
            button.removeEventListener('keyup', onKeyUp);
            button.removeEventListener('click', onClick);
            button.removeEventListener('blur', onBlur);
        },
    };
}
