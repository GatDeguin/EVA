/**
 * Presentation only. Callers commit business state and own focus/modality.
 * No animation, timer, clone, or frame loop is needed to reach a final state.
 */
const fallback = Object.freeze({
  acknowledge: 120,
  status: 160,
  nearby: 220,
  context: 260,
  nearDistance: 8,
  contextDistance: 18,
  legibility: 0.74,
  emphasis: 0.7,
  settle: 'cubic-bezier(.2,.8,.2,1)',
});

const immediate = (reason) => Promise.resolve({ status: 'immediate', reason });

function appearance(element) {
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  const read = (name) => style?.getPropertyValue?.(name)?.trim() || '';
  const number = (name, backup, minimum, maximum) => {
    const value = Number.parseFloat(read(name));
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : backup;
  };
  const duration = (name, backup) => {
    const raw = read(name);
    const value = Number.parseFloat(raw) * (raw.endsWith('ms') ? 1 : raw.endsWith('s') ? 1000 : 1);
    return Number.isFinite(value) ? Math.min(1000, Math.max(0, value)) : backup;
  };
  const opacity = Number.parseFloat(style?.opacity);
  return {
    opacity: Number.isFinite(opacity) ? opacity : 1,
    transform: style?.transform && style.transform !== 'none' ? style.transform : 'none',
    acknowledge: duration('--motion-acknowledge-duration', fallback.acknowledge),
    status: duration('--motion-status-duration', fallback.status),
    nearby: duration('--motion-nearby-duration', fallback.nearby),
    context: duration('--motion-context-duration', fallback.context),
    nearDistance: number('--motion-near-distance', fallback.nearDistance, 0, 32),
    contextDistance: number('--motion-context-distance', fallback.contextDistance, 0, 32),
    legibility: number('--motion-legibility-opacity', fallback.legibility, 0.6, 1),
    emphasis: number('--motion-emphasis-opacity', fallback.emphasis, 0.6, 1),
    settle: read('--motion-settle') || fallback.settle,
  };
}

function presented(element) {
  return element && element.isConnected !== false && !element.hidden &&
    !element.ownerDocument?.hidden && !element.closest?.('[hidden]');
}

export function createMotion({ reducedMotion = false, onError } = {}) {
  const active = new Map();
  const counts = { created: 0, completed: 0, cancelled: 0, failed: 0 };
  let reduced = Boolean(reducedMotion);
  let disposed = false;

  function report(error) {
    // Unexpected failures remain observable; cancellation is handled separately.
    try {
      if (onError) onError(error);
      else console.error('EVA presentation transition failed:', error);
    } catch (reportingError) {
      console.error('EVA motion error reporter failed:', reportingError);
    }
  }

  function settle(record, status, reason) {
    if (record.done) return;
    record.done = true;
    if (active.get(record.element) === record) active.delete(record.element);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    // Underlying DOM/CSS already contains the final state. Removing the effect
    // reaches that state on completion, interruption, reduction, and teardown.
    try {
      record.animation?.cancel();
      // Some lifecycle changes replace WAAPI's finished promise. Observe that
      // replacement as well when removing a naturally completed effect.
      const remaining = record.animation?.finished;
      if (remaining && remaining !== record.finished) remaining.catch((error) => {
        if (error?.name !== 'AbortError') report(error);
      });
    } catch (error) { report(error); }
    record.resolve({ status, reason });
  }

  function cancel(element, reason = 'replaced') {
    const record = active.get(element);
    if (record) settle(record, 'cancelled', reason);
  }

  function run(element, keyframes, duration, easing, restOpacity) {
    cancel(element);
    if (disposed || reduced || !presented(element) || typeof element.animate !== 'function' || duration === 0) {
      return immediate(disposed ? 'disposed' : reduced ? 'reduced' : 'not-animated');
    }
    let resolve;
    const completion = new Promise((done) => { resolve = done; });
    const record = { element, animation: null, done: false, completion, resolve, restOpacity };
    active.set(element, record);
    try {
      record.animation = element.animate(keyframes, { duration, easing, fill: 'none', iterations: 1 });
      counts.created += 1;
      // Attach both handlers before cancellation can happen. A cancelled WAAPI
      // finished promise rejects with AbortError, which is an expected outcome.
      record.finished = record.animation.finished;
      record.finished.then(
        () => settle(record, 'completed', 'finished'),
        (error) => {
          if (record.done) return;
          if (error?.name === 'AbortError') settle(record, 'cancelled', 'external-cancel');
          else {
            report(error);
            settle(record, 'failed', 'animation-error');
          }
        },
      );
    } catch (error) {
      if (error?.name === 'NotSupportedError') settle(record, 'cancelled', 'unsupported');
      else {
        report(error);
        settle(record, 'failed', 'animation-error');
      }
    }
    return completion;
  }

  /**
   * Visibility is synchronous. Dismissal cancels immediately: no exit clones or
   * hidden controls await an effect. Repeated show calls never replay an entry.
   * Pass inert:true when revealing content behind the application's modal.
   */
  function reveal(element, { kind = 'panel', show = true, inert } = {}) {
    if (!element || disposed) return immediate(disposed ? 'disposed' : 'missing-element');
    const wasHidden = Boolean(element.hidden);
    element.hidden = !show;
    if (!show) {
      element.inert = true;
      cancel(element, 'hidden');
      return immediate('hidden');
    }
    if (inert !== undefined) element.inert = Boolean(inert);
    else if (wasHidden) element.inert = false;
    if (!wasHidden) return active.get(element)?.completion || immediate('already-visible');
    if (reduced || !presented(element)) return immediate(reduced ? 'reduced' : 'not-presented');
    const style = appearance(element);
    const opening = { opacity: style.opacity * style.legibility };
    const resting = { opacity: style.opacity };
    const isDrawer = kind === 'drawer';
    if (kind !== 'status') {
      const offset = isDrawer ? `${style.contextDistance}px,0,0` : `0,${style.nearDistance}px,0`;
      const base = style.transform === 'none' ? '' : ` ${style.transform}`;
      opening.transform = `translate3d(${offset})${base}`;
      resting.transform = style.transform;
    }
    const duration = kind === 'status' ? style.status : isDrawer ? style.context : style.nearby;
    return run(element, [opening, resting], duration, style.settle, style.opacity);
  }

  function opacitySettle(element, acknowledgement = false) {
    if (!presented(element) || disposed || reduced) {
      cancel(element, reduced ? 'reduced' : 'not-presented');
      return immediate(disposed ? 'disposed' : 'not-animated');
    }
    // Read the current visual state before canceling the previous generation.
    // Repeated labels settle from there, instead of flashing back to the start.
    const style = appearance(element);
    const previous = active.get(element);
    const restOpacity = previous?.restOpacity ?? style.opacity;
    const from = previous ? style.opacity : restOpacity * (acknowledgement ? style.emphasis : style.legibility);
    return run(element, [{ opacity: from }, { opacity: restOpacity }],
      acknowledgement ? style.acknowledge : style.status, style.settle, restOpacity);
  }

  /** One accessible text node; the actual new status is available immediately. */
  function text(element, value) {
    if (!element || disposed) return immediate(disposed ? 'disposed' : 'missing-element');
    const next = String(value);
    if (element.textContent === next) return active.get(element)?.completion || immediate('unchanged');
    element.textContent = next;
    return opacitySettle(element);
  }

  /** Feedback lives inside the unchanged button hit area. CSS owns icon scale. */
  function feedback(element) {
    if (!element || disposed) return immediate(disposed ? 'disposed' : 'missing-element');
    const icon = element.matches?.('button') ? element.querySelector('svg') : element;
    return icon ? opacitySettle(icon, true) : immediate('no-icon');
  }

  function cancelAll(reason = 'cancel-all') {
    for (const record of [...active.values()]) settle(record, 'cancelled', reason);
  }

  return {
    reveal,
    text,
    feedback,
    setReduced(value) {
      reduced = Boolean(value);
      if (reduced) cancelAll('reduced');
    },
    cancelAll,
    getStats() { return { ...counts, active: active.size, reduced, disposed }; },
    dispose() {
      cancelAll('disposed');
      disposed = true;
    },
  };
}
