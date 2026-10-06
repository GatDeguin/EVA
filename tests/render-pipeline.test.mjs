import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectMSAASamples,
  estimateDeviceProfile,
  initializeWithFallback,
  createWebGLTimer,
} from '../src/render-pipeline.js';

// Model the browser's context-type lock without initializing a real renderer.
function canvasFixture({ width = 300, height = 150, attributes = {}, events = [] } = {}) {
  let context = null;
  return {
    width,
    height,
    attributes: { ...attributes },
    replacement: null,
    getContext(type) {
      if (context && context.type !== type) return null;
      context ??= { type, canvas: this };
      return context;
    },
    cloneNode(deep) {
      assert.equal(deep, false);
      events.push('clone');
      return canvasFixture({ attributes: this.attributes, events });
    },
    replaceWith(replacement) {
      events.push('replace');
      this.replacement = replacement;
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Query availability and GPU durations are controlled independently of wall time.
// Reading an unfinished result or nesting elapsed-time queries fails the mock.
function gpuTimerFixture({ allocationFails = false } = {}) {
  const extension = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  const queries = [];
  const submitted = [];
  const deleted = [];
  const resultReads = [];
  let active = null;
  let disjoint = false;
  let lost = false;
  let ended = 0;
  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    createQuery() {
      if (allocationFails) return null;
      const query = { id: queries.length, available: false, result: undefined, deleted: false };
      queries.push(query);
      return query;
    },
    beginQuery(target, query) {
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert.equal(active, null, 'elapsed-time queries must not overlap');
      assert.equal(query.deleted, false, 'a disposed query must not be reused');
      assert.ok(!query.submitted || query.available || query.invalidated,
        'pending results must not be overwritten');
      query.available = false;
      query.submitted = true;
      query.invalidated = false;
      active = query;
      submitted.push(query);
    },
    endQuery(target) {
      assert.equal(target, extension.TIME_ELAPSED_EXT);
      assert.notEqual(active, null, 'a query must be active before ending');
      active = null;
      ended += 1;
    },
    getParameter(parameter) {
      assert.equal(parameter, extension.GPU_DISJOINT_EXT);
      return disjoint;
    },
    getQueryParameter(query, parameter) {
      assert.equal(query.deleted, false);
      if (parameter === gl.QUERY_RESULT_AVAILABLE) return query.available;
      assert.equal(parameter, gl.QUERY_RESULT);
      assert.equal(query.available, true, 'GPU results must not be read before availability');
      resultReads.push(query);
      return query.result;
    },
    isContextLost() { return lost; },
    deleteQuery(query) {
      assert.equal(query.deleted, false, 'each allocated query must be deleted once');
      query.deleted = true;
      deleted.push(query);
    },
  };
  return {
    gl, extension, queries, submitted, deleted, resultReads,
    get active() { return active; },
    get ended() { return ended; },
    complete(query, nanoseconds) {
      query.available = true;
      query.result = nanoseconds;
    },
    setDisjoint(value) {
      disjoint = value;
      if (value) for (const query of queries) query.invalidated = true;
    },
    loseContext() { lost = true; },
  };
}

function clockFixture(t) {
  const clock = { now: 100 };
  t.mock.method(globalThis.performance, 'now', () => clock.now);
  return clock;
}

function renderFrames(timer, count = 1) {
  for (let index = 0; index < count; index += 1) {
    timer.begin();
    timer.end();
  }
}

function submitMeasurement(timer, gpu) {
  const previous = gpu.submitted.length;
  for (let index = 0; index < 32 && gpu.submitted.length === previous; index += 1) {
    renderFrames(timer);
  }
  assert.equal(gpu.submitted.length, previous + 1, 'an available timer slot should eventually sample a frame');
  return gpu.submitted.at(-1);
}

test('MSAA reports an available count and respects the supported ceiling without mutating capabilities', () => {
  const available = Object.freeze([8, 4, 0, 2, 1, Infinity, NaN, -1]);
  assert.equal(selectMSAASamples(2, available), 2);
  assert.equal(selectMSAASamples(3, available), 4);
  assert.equal(selectMSAASamples(8, available), 4);
  assert.equal(selectMSAASamples(2, [0, 4]), 4, 'a WebGPU request for 2 cannot be reported as actual 2×');
  assert.deepEqual(available, [8, 4, 0, 2, 1, Infinity, NaN, -1]);
});

test('disabled, malformed, and unsupported MSAA requests cannot advertise antialiasing', () => {
  for (const requested of [0, -1, NaN, Infinity, -Infinity, undefined, null, '4']) {
    assert.equal(selectMSAASamples(requested, [0, 2, 4]), 0);
  }
  assert.equal(selectMSAASamples(4), 0);
  assert.equal(selectMSAASamples(4, [0, 1, 8, NaN]), 0);
});

test('unknown desktop hardware remains explicitly estimated instead of inventing a GPU tier or VRAM', () => {
  const profile = estimateDeviceProfile();
  assert.equal(profile.softwareRendering, false);
  assert.equal(profile.gpuTier, 'unknown');
  assert.equal(profile.gpuTierEstimate, true);
  assert.equal(profile.softwareRenderingEstimate, true);
  assert.equal(profile.estimatedTextureBudgetMB, 256);
  assert.match(profile.memoryEstimateBasis, /not measured available VRAM/i);
});

test('software renderer identity and adapter fallback flags take priority over other device hints', () => {
  for (const input of [
    { rendererName: 'ANGLE (Google, Vulkan SwiftShader Device (Subzero))' },
    { adapterInfo: { description: 'Mesa llvmpipe (LLVM 18)' } },
    { adapterInfo: { architecture: 'lavapipe' } },
    { adapterInfo: { isFallbackAdapter: true, description: 'Unidentified adapter' } },
  ]) {
    const profile = estimateDeviceProfile({ ...input, mobile: true, systemMemoryGB: 32 });
    assert.equal(profile.softwareRendering, true);
    assert.equal(profile.gpuTier, 'software');
    assert.equal(profile.estimatedTextureBudgetMB, 64);
  }
});

test('mobile and small system-memory hints reduce the application budget without claiming measured GPU memory', () => {
  for (const input of [{ mobile: true }, { systemMemoryGB: 4 }, { systemMemoryGB: 2 }]) {
    const profile = estimateDeviceProfile(input);
    assert.equal(profile.softwareRendering, false);
    assert.equal(profile.gpuTier, 'low');
    assert.equal(profile.estimatedTextureBudgetMB, 128);
    assert.equal(profile.gpuTierEstimate, true);
  }
  for (const systemMemoryGB of [null, undefined, NaN, Infinity, 16]) {
    assert.equal(estimateDeviceProfile({ systemMemoryGB }).gpuTier, 'unknown');
  }
});

test('successful WebGPU initialization preserves the original canvas and never starts fallback', async () => {
  const canvas = canvasFixture();
  const renderer = {};
  const result = await initializeWithFallback({
    canvas,
    tryWebGPU: async candidate => {
      assert.equal(candidate, canvas);
      candidate.getContext('webgpu');
      return { renderer, startupToken: 'GPU ready' };
    },
    createWebGL: () => assert.fail('fallback must not run after successful GPU initialization'),
    onWarning: () => assert.fail('success must not produce a fallback warning'),
  });
  assert.equal(result.canvas, canvas);
  assert.equal(result.renderer, renderer);
  assert.equal(result.backend, 'webgpu');
  assert.equal(result.startupToken, 'GPU ready');
  assert.equal(canvas.replacement, null);
});

test('GPU failure after acquiring its context waits for rejection and replaces the canvas before WebGL', async () => {
  const events = [];
  const canvas = canvasFixture({ width: 1536, height: 864, attributes: { id: 'stage', class: 'exhibit-canvas' }, events });
  const pendingGPU = deferred();
  const gpuError = new Error('GPU device failed after context configuration');
  const warnings = [];
  let fallbackCalls = 0;
  const pending = initializeWithFallback({
    canvas,
    tryWebGPU: async candidate => {
      events.push('gpu');
      assert.ok(candidate.getContext('webgpu'));
      await pendingGPU.promise;
      return { renderer: {} };
    },
    createWebGL: async candidate => {
      events.push('webgl');
      fallbackCalls += 1;
      assert.notEqual(candidate, canvas);
      assert.equal(canvas.replacement, candidate, 'DOM replacement must precede fallback initialization');
      const context = candidate.getContext('webgl2');
      assert.ok(context, 'the replacement must be able to acquire a different context type');
      return { renderer: { context } };
    },
    onWarning: error => { events.push('warning'); warnings.push(error); },
  });
  await Promise.resolve();
  assert.equal(fallbackCalls, 0, 'fallback must not race unfinished GPU initialization');
  assert.equal(canvas.replacement, null);
  assert.equal(canvas.getContext('webgl2'), null, 'the original canvas is locked to WebGPU');
  pendingGPU.reject(gpuError);
  const result = await pending;
  assert.equal(result.backend, 'webgl2');
  assert.equal(result.canvas, canvas.replacement);
  assert.equal(result.renderer.context.canvas, result.canvas);
  assert.equal(result.canvas.width, 1536);
  assert.equal(result.canvas.height, 864);
  assert.deepEqual(result.canvas.attributes, canvas.attributes);
  assert.deepEqual(warnings, [gpuError]);
  assert.deepEqual(events, ['gpu', 'warning', 'clone', 'replace', 'webgl']);
  assert.equal(fallbackCalls, 1);
});

test('an explicitly selected WebGL path uses the existing unclaimed canvas', async () => {
  const canvas = canvasFixture();
  const renderer = {};
  const result = await initializeWithFallback({
    canvas,
    tryWebGPU: null,
    createWebGL: async candidate => {
      assert.equal(candidate, canvas);
      assert.ok(candidate.getContext('webgl2'));
      return { renderer };
    },
  });
  assert.equal(result.canvas, canvas);
  assert.equal(result.renderer, renderer);
  assert.equal(result.backend, 'webgl2');
  assert.equal(canvas.replacement, null);
});

test('when both backends fail the fallback failure reaches the caller and the GPU failure remains observable', async () => {
  const canvas = canvasFixture();
  const gpuError = new Error('Device request failed');
  const glError = new Error('WebGL2 context unavailable');
  const warnings = [];
  await assert.rejects(initializeWithFallback({
    canvas,
    tryWebGPU() { throw gpuError; },
    createWebGL(candidate) {
      assert.equal(candidate, canvas.replacement);
      throw glError;
    },
    onWarning: error => warnings.push(error),
  }), error => error === glError);
  assert.deepEqual(warnings, [gpuError]);
});

test('no GPU timer is created when elapsed-time queries are unsupported', () => {
  const gl = { createQuery: () => assert.fail('unsupported timing must not allocate queries') };
  assert.equal(createWebGLTimer(gl, null), null);
});

test('GPU timing remains unavailable until a query completes and reports nanoseconds as milliseconds', t => {
  const clock = clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  t.after(() => timer.dispose());
  assert.equal(timer.milliseconds, null);
  const query = submitMeasurement(timer, gpu);
  clock.now += 1200;
  renderFrames(timer);
  assert.equal(timer.milliseconds, null, 'elapsed CPU time must never stand in for an unfinished GPU query');
  assert.equal(gpu.resultReads.length, 0);
  gpu.complete(query, 7_250_000);
  renderFrames(timer);
  assert.equal(timer.milliseconds, 7.25);
  assert.deepEqual(gpu.resultReads, [query]);
});

test('nonpositive and nonfinite GPU query results cannot produce invented timings', t => {
  const clock = clockFixture(t);
  for (const result of [0, -1, NaN, Infinity, undefined]) {
    const gpu = gpuTimerFixture();
    const timer = createWebGLTimer(gpu.gl, gpu.extension);
    const query = submitMeasurement(timer, gpu);
    clock.now += 600;
    gpu.complete(query, result);
    renderFrames(timer);
    assert.equal(timer.milliseconds, null);
    timer.dispose();
  }
});

test('slow GPU query completion uses bounded slots without blocking or overwriting pending samples', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  t.after(() => timer.dispose());
  renderFrames(timer, 128);
  const capacity = gpu.queries.length;
  assert.ok(capacity > 0 && capacity <= 8, 'timing should retain a small bounded pool');
  assert.equal(gpu.submitted.length, capacity);
  assert.equal(new Set(gpu.submitted).size, capacity);
  assert.equal(gpu.resultReads.length, 0);
  assert.equal(timer.milliseconds, null);
  gpu.complete(gpu.submitted[0], 3_500_000);
  renderFrames(timer, 32);
  assert.equal(gpu.submitted.length, capacity + 1, 'a completed slot becomes reusable');
  assert.equal(timer.milliseconds, 3.5);
});

test('a disjoint event invalidates both the last GPU result and unfinished measurements', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  t.after(() => timer.dispose());
  const first = submitMeasurement(timer, gpu);
  gpu.complete(first, 2_000_000);
  renderFrames(timer);
  assert.equal(timer.milliseconds, 2);
  const invalidated = submitMeasurement(timer, gpu);
  gpu.setDisjoint(true);
  renderFrames(timer);
  assert.equal(timer.milliseconds, null);
  gpu.setDisjoint(false);
  gpu.complete(invalidated, 900_000_000);
  renderFrames(timer);
  assert.equal(timer.milliseconds, null, 'a late result from the disjoint interval must remain invalid');
  assert.ok(!gpu.resultReads.includes(invalidated));
  const fresh = submitMeasurement(timer, gpu);
  gpu.complete(fresh, 4_500_000);
  renderFrames(timer);
  assert.equal(timer.milliseconds, 4.5, 'fresh GPU queries can recover after the disjoint interval');
});

test('stale GPU timings expire even when no more render frames are submitted', t => {
  const clock = clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  t.after(() => timer.dispose());
  gpu.complete(submitMeasurement(timer, gpu), 1_250_000);
  renderFrames(timer);
  clock.now += 2499;
  assert.equal(timer.milliseconds, 1.25);
  clock.now += 2;
  assert.equal(timer.milliseconds, null);
});

test('context loss invalidates the last GPU result and prevents new query submissions', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  t.after(() => timer.dispose());
  gpu.complete(submitMeasurement(timer, gpu), 1_500_000);
  renderFrames(timer);
  assert.equal(timer.milliseconds, 1.5);
  const submissions = gpu.submitted.length;
  gpu.loseContext();
  renderFrames(timer, 32);
  assert.equal(timer.milliseconds, null);
  assert.equal(gpu.submitted.length, submissions);
});

test('disposing an active timer ends its query, frees every slot once, and makes future calls inert', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  for (let index = 0; index < 32 && !gpu.active; index += 1) timer.begin();
  assert.notEqual(gpu.active, null);
  timer.begin(); // Repeated entry cannot nest another GL elapsed-time query.
  const submissions = gpu.submitted.length;
  timer.dispose();
  timer.dispose();
  timer.begin();
  timer.end();
  assert.equal(gpu.active, null);
  assert.equal(gpu.ended, 1);
  assert.equal(gpu.submitted.length, submissions);
  assert.deepEqual(gpu.deleted, gpu.queries);
  assert.equal(timer.milliseconds, null);
});

test('a query that completes after timer disposal cannot publish a stale GPU measurement', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture();
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  const query = submitMeasurement(timer, gpu);
  timer.dispose();
  gpu.complete(query, 12_000_000);
  renderFrames(timer, 16);
  assert.equal(timer.milliseconds, null);
  assert.equal(gpu.resultReads.length, 0);
  assert.deepEqual(gpu.deleted, gpu.queries);
});

test('query allocation failure leaves timing unavailable without breaking the render loop or disposal', t => {
  clockFixture(t);
  const gpu = gpuTimerFixture({ allocationFails: true });
  const timer = createWebGLTimer(gpu.gl, gpu.extension);
  renderFrames(timer, 32);
  assert.equal(timer.milliseconds, null);
  assert.equal(gpu.submitted.length, 0);
  timer.dispose();
  timer.dispose();
  assert.equal(gpu.deleted.length, 0);
});
