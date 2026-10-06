import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotion } from '../src/motion.js';

// A controllable WAAPI clock: no machine-dependent sleeps, CSS snapshots, or
// production callbacks are duplicated. These tests exercise the owner itself.
function element({ hidden = false, transform = 'none', tokens = {}, icon } = {}) {
  const animations = [];
  const node = {
    hidden,
    inert: false,
    isConnected: true,
    textContent: '',
    currentOpacity: '1',
    animations,
    ownerDocument: {
      hidden: false,
      defaultView: {
        getComputedStyle(target) {
          return {
            opacity: target.currentOpacity,
            transform,
            getPropertyValue: (name) => tokens[name] || '',
          };
        },
      },
    },
    closest() { return null; },
    matches(selector) { return selector === 'button' && Boolean(icon); },
    querySelector(selector) { return selector === 'svg' ? icon : null; },
    animate(keyframes, options) {
      let resolve, reject;
      const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
      const animation = {
        keyframes,
        options,
        finished,
        currentTime: 0,
        cancellations: 0,
        finish() { resolve(); },
        fail(error) { reject(error); },
        cancel() {
          this.cancellations += 1;
          reject(new DOMException('Animation cancelled', 'AbortError'));
        },
      };
      animations.push(animation);
      return animation;
    },
  };
  return node;
}

test('reveal commits visibility and inertness before settling; an unchanged show is idempotent', async () => {
  const motion = createMotion();
  const panel = element({ hidden: true });
  panel.inert = true;
  const opened = motion.reveal(panel, { kind: 'drawer', show: true });
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(motion.getStats().active, 1);
  assert.equal(motion.reveal(panel, { kind: 'drawer', show: true }), opened);
  assert.equal(panel.animations.length, 1);
  panel.animations[0].finish();
  assert.equal((await opened).status, 'completed');
  assert.equal(motion.getStats().active, 0);
  assert.equal(panel.animations[0].cancellations, 1, 'finished effects are removed');
});

test('close/reopen at the start, middle, and end always preserves the latest visible state', async () => {
  for (const progress of [0.01, 0.5, 0.99]) {
    const motion = createMotion();
    const panel = element({ hidden: true });
    const first = motion.reveal(panel, { kind: 'drawer' });
    const earlier = panel.animations[0];
    earlier.currentTime = earlier.options.duration * progress;
    const closed = motion.reveal(panel, { show: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.inert, true);
    const latest = motion.reveal(panel, { kind: 'drawer' });
    earlier.finish(); // A stale completion cannot remove the new effect/state.
    assert.equal((await first).status, 'cancelled');
    assert.equal((await closed).reason, 'hidden');
    assert.equal(panel.hidden, false);
    assert.equal(panel.inert, false);
    assert.equal(motion.getStats().active, 1);
    panel.animations.at(-1).finish();
    await latest;
    assert.equal(motion.getStats().active, 0);
  }
});

test('status changes expose the new text immediately and redirect from the current opacity', async () => {
  const motion = createMotion();
  const label = element();
  label.textContent = 'Starting';
  const first = motion.text(label, 'Searching');
  assert.equal(label.textContent, 'Searching');
  label.currentOpacity = '0.89';
  const latest = motion.text(label, 'Tracking');
  assert.equal(label.textContent, 'Tracking');
  assert.equal(label.animations[1].keyframes[0].opacity, 0.89);
  assert.equal(label.animations[1].keyframes[1].opacity, 1);
  assert.equal((await first).status, 'cancelled');
  assert.equal(motion.text(label, 'Tracking'), latest, 'unchanged telemetry must not replay');
  label.animations[1].finish();
  await latest;
  assert.equal(label.textContent, 'Tracking');
  assert.equal(motion.getStats().active, 0);
});

test('reduced motion before entry and during entry reaches the same usable final state', async () => {
  const motion = createMotion({ reducedMotion: true });
  const panel = element({ hidden: true });
  await motion.reveal(panel);
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.animations.length, 0);
  await motion.reveal(panel, { show: false });
  motion.setReduced(false);
  const pending = motion.reveal(panel);
  motion.setReduced(true);
  assert.equal((await pending).reason, 'reduced');
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(motion.getStats().active, 0);
  await motion.text(panel, 'Ready without animation');
  assert.equal(panel.textContent, 'Ready without animation');
  assert.equal(panel.animations.length, 1);
});

test('twenty complete opening/closing cycles retain no running effects', async () => {
  const motion = createMotion();
  const panel = element({ hidden: true });
  for (let index = 0; index < 20; index += 1) {
    const pending = motion.reveal(panel, { kind: 'drawer' });
    if (index % 2 === 0) {
      panel.animations.at(-1).finish();
      await pending;
    }
    await motion.reveal(panel, { show: false });
    await pending;
    assert.equal(motion.getStats().active, 0);
    assert.equal(panel.hidden, true);
    assert.equal(panel.inert, true);
  }
  assert.equal(motion.getStats().created, 20);
  assert.equal(motion.getStats().completed, 10);
  assert.equal(motion.getStats().cancelled, 10);
  assert.ok(panel.animations.every((animation) => animation.cancellations === 1));
});

test('cancelAll and dispose resolve every owner without hiding visible content', async () => {
  const motion = createMotion();
  const drawer = element({ hidden: true });
  const panel = element({ hidden: true });
  const pending = [motion.reveal(drawer), motion.reveal(panel)];
  motion.cancelAll('hidden-document');
  assert.ok((await Promise.all(pending)).every((result) => result.reason === 'hidden-document'));
  assert.equal(drawer.hidden, false);
  assert.equal(panel.hidden, false);
  const text = motion.text(panel, 'Latest content');
  motion.dispose();
  motion.dispose();
  assert.equal((await text).reason, 'disposed');
  assert.equal(motion.getStats().active, 0);
  assert.equal(motion.getStats().disposed, true);
  const count = panel.animations.length;
  await motion.text(panel, 'Too late');
  assert.equal(panel.textContent, 'Latest content');
  assert.equal(panel.animations.length, count);
});

test('missing WAAPI, detached elements, and hidden documents keep functional results', async () => {
  const motion = createMotion();
  const unsupported = element({ hidden: true });
  delete unsupported.animate;
  await motion.reveal(unsupported);
  assert.equal(unsupported.hidden, false);
  assert.equal(unsupported.inert, false);
  const detached = element();
  detached.isConnected = false;
  await motion.text(detached, 'Current value');
  assert.equal(detached.textContent, 'Current value');
  assert.equal(detached.animations.length, 0);
  const invisible = element();
  invisible.ownerDocument.hidden = true;
  await motion.text(invisible, 'Camera stopped');
  assert.equal(invisible.textContent, 'Camera stopped');
  assert.equal(invisible.animations.length, 0);
  assert.equal(motion.getStats().active, 0);
});

test('external AbortError cancellation is expected; genuine animation failures are observable', async () => {
  const errors = [];
  const motion = createMotion({ onError: (error) => errors.push(error) });
  const label = element();
  const cancelled = motion.text(label, 'Opening');
  label.animations[0].cancel();
  assert.equal((await cancelled).reason, 'external-cancel');
  assert.equal(errors.length, 0);
  const pending = motion.text(label, 'Failed operation is still readable');
  const failure = new Error('A rendering failure');
  label.animations[1].fail(failure);
  assert.equal((await pending).status, 'failed');
  assert.deepEqual(errors, [failure]);
  assert.equal(label.textContent, 'Failed operation is still readable');
  assert.equal(motion.getStats().active, 0);
  assert.equal(motion.getStats().failed, 1);
});

test('cleanup also observes a replacement finished promise after natural completion', async () => {
  const errors = [];
  const motion = createMotion({ onError: (error) => errors.push(error) });
  const label = element();
  const pending = motion.text(label, 'Ready');
  const animation = label.animations[0];
  animation.cancel = function () {
    this.cancellations += 1;
    this.finished = Promise.reject(new DOMException('New finished promise', 'AbortError'));
  };
  animation.finish();
  assert.equal((await pending).status, 'completed');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(motion.getStats().active, 0);
  assert.equal(errors.length, 0);
});

test('status feedback does not overwrite existing centering transforms or button geometry', async () => {
  const motion = createMotion();
  const toast = element({ hidden: true, transform: 'matrix(1,0,0,1,-100,0)' });
  const pending = motion.reveal(toast, { kind: 'status' });
  assert.ok(toast.animations[0].keyframes.every((frame) => !('transform' in frame)));
  toast.animations[0].finish();
  await pending;
  const icon = element();
  const button = element({ icon });
  const feedback = motion.feedback(button);
  assert.equal(button.animations.length, 0);
  assert.equal(icon.animations.length, 1);
  assert.ok(icon.animations[0].keyframes.every((frame) => !('transform' in frame)), 'CSS owns icon scale');
  icon.animations[0].finish();
  await feedback;
});

test('caller-specified inertness survives revealing content behind a modal', async () => {
  const motion = createMotion({ reducedMotion: true });
  const camera = element({ hidden: true });
  await motion.reveal(camera, { show: true, inert: true });
  assert.equal(camera.hidden, false);
  assert.equal(camera.inert, true);
  await motion.reveal(camera, { show: true });
  assert.equal(camera.inert, true, 'an idempotent update must not clear application modality');
  await motion.reveal(camera, { show: false });
  await motion.reveal(camera, { show: true, inert: false });
  assert.equal(camera.inert, false);
});

test('zero CSS duration omits the effect without changing the operation result', async () => {
  const motion = createMotion();
  const panel = element({ hidden: true, tokens: { '--motion-nearby-duration': '0ms' } });
  await motion.reveal(panel);
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.animations.length, 0);
});
