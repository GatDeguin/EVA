/**
 * Application lifecycle coordination tests; these do NOT test native WebGPU.
 *
 * Both fixtures render the real application through the real WebGL2 runtime.
 * A build-only wrapper reports `backend: 'webgpu'` to exercise main's recovery
 * branches. The delivered source/HTML is never modified or given test hooks.
 *
 * Run after npm ci:
 *   EVA_BROWSER_EXECUTABLE=/path/to/chromium node tests/lifecycle-browser.mjs
 *
 * Optional: EVA_QA_OUTPUT (must be outside this repository),
 * EVA_SOFTWARE_RENDERER=1, EVA_BROWSER_ARGS (JSON array override),
 * EVA_BROWSER_TIMEOUT_MS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const out = path.resolve(process.env.EVA_QA_OUTPUT || path.join(root, '..', 'qa-output'), 'lifecycle-browser');
const relativeOutput = path.relative(root, out);
if (!relativeOutput || (!relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput))) {
  throw new Error('EVA_QA_OUTPUT must place lifecycle fixtures outside the repository.');
}
const timeout = Math.max(10000, Number(process.env.EVA_BROWSER_TIMEOUT_MS) || 120000);
const fixtureDescription = 'Lifecycle coordination fixture: real WebGL2 rendering with a simulated WebGPU backend label. Native WebGPU/WGSL is NOT tested.';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// This source exists only in the temporary esbuild bundle. Importing the actual
// module through a separate specifier avoids resolving the wrapper recursively.
const runtimeWrapper = `
import { createRenderRuntime as createRealRuntime } from 'eva-real-render-runtime';
const mode = new URLSearchParams(location.search).get('lifecycleFixture');
if (!['warmup-failure', 'device-lost'].includes(mode)) throw new Error('Unknown lifecycle fixture.');
const fixture = window.__EVA_LIFECYCLE_FIXTURE__ = {
  description: ${JSON.stringify(fixtureDescription)}, mode, nativeWebGPUTested: false,
  runtimeCalls: [], pipelines: [], events: [], renderCalls: 0, warmupRejections: 0
};
const watermark = document.createElement('div');
watermark.id = 'lifecycleFixtureLabel';
watermark.textContent = 'TEST DE COORDINACIÓN · WebGL2 real · etiqueta WebGPU simulada';
Object.assign(watermark.style, { position: 'fixed', left: '8px', bottom: '4px', zIndex: '1000',
  pointerEvents: 'none', background: '#111e', color: '#ffdca2', padding: '3px 6px', font: '10px monospace' });
document.body.append(watermark);

export async function createRenderRuntime(options) {
  const callNumber = fixture.runtimeCalls.length + 1;
  const reportedGPU = mode === 'device-lost' || callNumber === 1;
  const call = { number: callNumber, requested: options.preferredBackend || 'auto',
    actual: null, reported: null, canvas: options.canvas };
  fixture.runtimeCalls.push(call);
  const runtime = await createRealRuntime({ ...options, preferredBackend: 'webgl2' });
  call.actual = runtime.backend;
  call.reported = reportedGPU ? 'webgpu' : runtime.backend;
  if (runtime.backend !== 'webgl2' || runtime.renderer.isWebGLRenderer !== true) {
    throw new Error('Lifecycle fixture requires a real classic WebGL2 renderer.');
  }
  const createPipeline = runtime.createPipeline.bind(runtime);
  return {
    ...runtime,
    backend: call.reported,
    createPipeline(scene, camera) {
      const pipeline = createPipeline(scene, camera);
      const record = { runtimeCall: callNumber, renders: 0, realWarmups: 0, disposed: false };
      fixture.pipelines.push(record);
      const render = pipeline.render.bind(pipeline);
      const warmup = pipeline.warmup.bind(pipeline);
      const dispose = pipeline.dispose.bind(pipeline);
      pipeline.render = function () {
        record.renders++;
        fixture.renderCalls++;
        return render();
      };
      pipeline.warmup = async function () {
        await warmup();
        record.realWarmups++;
        fixture.events.push({ type: 'real-webgl2-warmup-completed', runtimeCall: callNumber,
          quality: document.getElementById('quality').value });
        if (mode === 'warmup-failure' && callNumber === 1 && fixture.warmupRejections === 0) {
          fixture.warmupRejections++;
          fixture.events.push({ type: 'controlled-warmup-rejection', runtimeCall: callNumber });
          throw new Error('EVA_LIFECYCLE_FIXTURE: controlled rejection after real WebGL2 warmup');
        }
      };
      pipeline.dispose = function () {
        record.disposeAttempted = true;
        try {
          const result = dispose();
          if (result && typeof result.then === 'function') {
            return result.then(() => { record.disposed = true; }, error => {
              record.disposeError = String(error); throw error;
            });
          }
          record.disposed = true;
          return result;
        } catch (error) {
          record.disposeError = String(error);
          throw error;
        }
      };
      return pipeline;
    }
  };
}
`;

async function buildFixture(esbuild) {
  const runtimePath = path.join(root, 'src', 'render-pipeline.js');
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    bundle: true, minify: true, format: 'iife', target: ['es2020'],
    legalComments: 'inline', write: false, metafile: true, logLevel: 'warning',
    plugins: [{
      name: 'explicit-lifecycle-coordination-fixture',
      setup(build) {
        build.onResolve({ filter: /^\.\/render-pipeline\.js$/ }, args => {
          if (path.resolve(args.resolveDir, args.path) === runtimePath) {
            return { path: 'runtime-wrapper', namespace: 'eva-lifecycle-fixture' };
          }
        });
        build.onResolve({ filter: /^eva-real-render-runtime$/ }, () => ({ path: runtimePath }));
        build.onLoad({ filter: /.*/, namespace: 'eva-lifecycle-fixture' }, () => ({
          contents: runtimeWrapper, loader: 'js', resolveDir: path.join(root, 'src')
        }));
      }
    }]
  });
  const [shell, motionCss] = await Promise.all([
    fs.readFile(path.join(root, 'shell.html'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'motion.css'), 'utf8')
  ]);
  const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = shell
    .replace('</style>', () => `${motionCss}\n.seq-progress span{width:100%;transform:scaleX(0);transform-origin:left;transition:none}\n</style>`)
    .replace('__APP_BUNDLE__', () => code);
  assert.ok(!html.includes('__APP_BUNDLE__'), 'the temporary fixture must contain a complete application bundle');
  const file = path.join(out, 'lifecycle-fixture.html');
  await fs.writeFile(file, html);
  return {
    file, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'),
    description: fixtureDescription,
    sourceModules: Object.keys(result.metafile.inputs).filter(name => !name.includes('node_modules'))
  };
}

async function waitUntil(page, predicate, label, argument, limit = timeout) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    if (await page.evaluate(predicate, argument)) return;
    // Direct evaluations work with the product CSP; waitForFunction uses eval.
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const d = window.__DIORAMA__;
    const f = window.__EVA_LIFECYCLE_FIXTURE__;
    const media = window.__EVA_LIFECYCLE_MEDIA__;
    const byId = id => document.getElementById(id);
    return {
      readyFlag: d?.ready ?? false,
      state: d?.getState?.() ?? null,
      actualClassicWebGL: d?.renderer?.isWebGLRenderer === true,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      storageFixture: window.__EVA_LIFECYCLE_STORAGE__ || null,
      fixture: f ? {
        description: f.description, mode: f.mode, nativeWebGPUTested: f.nativeWebGPUTested,
        renderCalls: f.renderCalls, warmupRejections: f.warmupRejections,
        runtimeCalls: f.runtimeCalls.map(call => ({
          number: call.number, requested: call.requested, actual: call.actual, reported: call.reported,
          canvasConnected: call.canvas.isConnected, isCurrentCanvas: call.canvas === byId('viewport')
        })),
        pipelines: f.pipelines.map(item => ({ ...item })), events: f.events.map(item => ({ ...item }))
      } : null,
      tracker: d ? {
        running: d.tracker.running, state: d.tracker.state,
        videoReadyState: byId('cameraVideo').readyState,
        videoDetached: byId('cameraVideo').srcObject === null
      } : null,
      media: media ? {
        description: media.description, requests: media.requests,
        streams: media.streams.map(entry => ({
          stopCalls: entry.stopCalls,
          tracks: entry.stream.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState }))
        }))
      } : null,
      ui: {
        loadingHidden: byId('loading').hidden, loadingStatus: byId('loadingStatus').textContent,
        fatalHidden: byId('fatal').hidden, fatalInert: byId('fatal').inert,
        fatalRole: byId('fatal').getAttribute('role'), fatalAriaModal: byId('fatal').getAttribute('aria-modal'),
        fatalInInertSubtree: Boolean(byId('fatal').closest('[inert]')),
        fatalMessage: byId('fatalMessage').textContent,
        reloadInInertSubtree: Boolean(byId('reloadButton').closest('[inert]')),
        viewportInInertSubtree: Boolean(byId('viewport').closest('[inert]')),
        headerInert: (byId('appHeader') || document.querySelector('.masthead'))?.inert ?? null,
        footerInert: document.querySelector('.bottom-area')?.inert ?? null,
        focusedId: document.activeElement?.id || null,
        settingsHidden: byId('settingsPanel').hidden, helpHidden: byId('helpPanel').hidden,
        settingsExpanded: byId('settingsButton').getAttribute('aria-expanded'),
        backdropHidden: byId('panelBackdrop').hidden,
        modalOpen: document.body.classList.contains('modal-open'),
        quality: byId('quality').value,
        pausePressed: byId('pauseButton').getAttribute('aria-pressed'),
        soundPressed: byId('soundButton').getAttribute('aria-pressed'),
        cameraPressed: byId('cameraButton').getAttribute('aria-pressed')
      }
    };
  });
}

async function installContextFixtures(context, mode) {
  await context.addInitScript(({ quality }) => {
    const media = window.__EVA_LIFECYCLE_MEDIA__ = {
      description: 'Synthetic local canvas video. No physical camera or microphone is accessed.',
      requests: 0, streams: []
    };
    const getUserMedia = async () => {
      media.requests++;
      const source = document.createElement('canvas');
      source.width = 320; source.height = 240;
      const drawing = source.getContext('2d');
      const stream = source.captureStream(12);
      const entry = { stream, source, stopCalls: 0, timer: null, frames: 0 };
      media.streams.push(entry);
      const draw = () => {
        drawing.fillStyle = '#586673'; drawing.fillRect(0, 0, 320, 240);
        drawing.fillStyle = '#c9ad87'; drawing.fillRect(45 + (++entry.frames % 30), 55, 145, 120);
        stream.getVideoTracks()[0]?.requestFrame?.();
      };
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { entry.stopCalls++; clearInterval(entry.timer); stop(); };
      }
      entry.timer = setInterval(draw, 80);
      draw();
      return stream;
    };
    const devices = navigator.mediaDevices || {};
    Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: getUserMedia });
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    const storage = window.__EVA_LIFECYCLE_STORAGE__ = { quality, seeded: false, error: null };
    try {
      localStorage.setItem('eva01.exhibition.v2', JSON.stringify({
        version: 2, welcomeSeen: true,
        // These explicit user settings keep a lifecycle test inexpensive. The
        // real renderer, environment, geometry, warmup and MSAA still execute.
        preferences: { quality, adaptiveResolution: false, shadows: false, bloom: false, ao: false }
      }));
      storage.seeded = JSON.parse(localStorage.getItem('eva01.exhibition.v2'))?.preferences?.quality === quality;
      if (!storage.seeded) storage.error = 'The saved quality preference could not be read back.';
    } catch (error) {
      storage.error = `${error.name}: ${error.message}`;
    }
  }, { quality: mode === 'warmup-failure' ? 'cinematic' : 'performance' });
}

async function awaitReady(page) {
  await waitUntil(page, () => window.__DIORAMA__?.ready || document.getElementById('fatal')?.hidden === false,
    'application readiness or an explicit initialization failure');
  const result = await snapshot(page);
  assert.equal(result.storageFixture?.seeded, true,
    `Fixture prerequisite failed: persisted quality could not be seeded (${result.storageFixture?.error || 'storage fixture unavailable'}).`);
  assert.equal(result.readyFlag, true, result.ui.fatalMessage);
  assert.equal(result.actualClassicWebGL, true, 'the fixture must actually render through classic WebGL2');
  assert.equal(result.state.capabilities.backend, 'webgl2', 'real capability reporting must remain WebGL2');
  assert.equal(result.reducedMotion, false, 'this regression requires no reduced-motion preference');
  assert.equal(result.media.requests, 0, 'initialization must not request a camera');
  return result;
}

async function testWarmupRecovery(page, record) {
  record.initial = await awaitReady(page);
  const initial = record.initial;
  assert.equal(initial.fixture.nativeWebGPUTested, false);
  assert.equal(initial.fixture.warmupRejections, 1, 'exactly one controlled warmup must reject');
  assert.equal(initial.fixture.runtimeCalls.length, 2, 'main must restart the complete runtime once');
  assert.deepEqual(initial.fixture.runtimeCalls.map(call => call.actual), ['webgl2', 'webgl2']);
  assert.deepEqual(initial.fixture.runtimeCalls.map(call => call.reported), ['webgpu', 'webgl2']);
  assert.equal(initial.fixture.runtimeCalls[1].requested, 'webgl2', 'main must explicitly request its fallback');
  assert.equal(initial.fixture.runtimeCalls[0].canvasConnected, false, 'the abandoned canvas must be replaced');
  assert.equal(initial.fixture.runtimeCalls[1].isCurrentCanvas, true);
  assert.equal(initial.fixture.pipelines[0].realWarmups, 1, 'the rejection must follow a completed real warmup');
  assert.equal(initial.fixture.pipelines[0].disposed, true, 'the failed pipeline must be disposed');
  assert.equal(initial.fixture.pipelines[1].realWarmups, 1, 'the replacement must also finish real warmup');
  assert.equal(initial.state.backend, 'webgl2');
  assert.equal(initial.state.quality, 'cinematic');
  assert.equal(initial.state.photoMode, true);
  assert.equal(initial.state.paused, true);
  await page.screenshot({ path: path.join(out, '01-cinematic-after-warmup-recovery.png') });

  await page.locator('#settingsButton').click();
  await page.locator('#quality').selectOption('balanced');
  await waitUntil(page, () => {
    const state = window.__DIORAMA__?.getState();
    return state?.quality === 'balanced' && !state.photoMode && !state.paused;
  }, 'leaving cinematic mode to restore the original unpaused state');
  await waitUntil(page, previous => {
    const state = window.__DIORAMA__.getState();
    return state.frames >= previous.frames + 2 && state.time > previous.time;
  }, 'actual animation frames to advance after recovery', { frames: initial.state.frames, time: initial.state.time });
  record.resumed = await snapshot(page);
  assert.equal(record.resumed.state.ready, true);
  assert.equal(record.resumed.ui.pausePressed, 'false');
  assert.equal(record.resumed.state.preferences.quality, 'balanced');
  assert.equal(record.resumed.fixture.runtimeCalls.length, 2, 'quality selection must not recreate the renderer again');
  assert.equal(record.resumed.ui.fatalHidden, true);
  await page.screenshot({ path: path.join(out, '02-balanced-resumed-after-recovery.png') });
}

async function testDeviceLoss(page, record) {
  record.initial = await awaitReady(page);
  assert.equal(record.initial.state.backend, 'webgpu', 'only the coordination label is simulated');
  assert.equal(record.initial.fixture.runtimeCalls.length, 1);
  assert.equal(record.initial.fixture.warmupRejections, 0);
  assert.equal(record.initial.state.paused, false);

  await page.locator('#cameraButton').click();
  await waitUntil(page, () => {
    const d = window.__DIORAMA__;
    const video = document.getElementById('cameraVideo');
    return d?.tracker.running && d.tracker.state !== 'starting' && video.readyState >= 2 &&
      video.srcObject?.getVideoTracks().some(track => track.readyState === 'live');
  }, 'a real video element playing the synthetic local MediaStream');
  await page.locator('#soundButton').click();
  await waitUntil(page, () => {
    const state = window.__DIORAMA__.getState();
    return state.sound && state.soundState === 'running';
  }, 'audio to become active after the sound-button user gesture');
  await page.locator('#settingsButton').click();
  await waitUntil(page, () => window.__DIORAMA__.getState().activePanel === 'settingsPanel' &&
    document.body.classList.contains('modal-open'), 'Settings to establish its modal inert state');
  record.beforeLoss = await snapshot(page);
  assert.equal(record.beforeLoss.tracker.running, true);
  assert.equal(record.beforeLoss.state.sound, true);
  assert.equal(record.beforeLoss.ui.fatalInInertSubtree, true, 'the test must exercise recovery from an inert fatal overlay');
  await page.screenshot({ path: path.join(out, '03-active-media-settings-before-device-loss.png') });

  await page.evaluate(() => {
    const renderer = window.__DIORAMA__.renderer;
    if (typeof renderer.onDeviceLost !== 'function') throw new Error('main did not install its device-loss handler');
    window.__EVA_LIFECYCLE_FIXTURE__.events.push({ type: 'simulated-device-loss-callback', nativeWebGPUTested: false });
    renderer.onDeviceLost({ reason: 'unknown', message: 'EVA lifecycle coordination fixture' });
  });
  await waitUntil(page, () => {
    const d = window.__DIORAMA__;
    const state = d.getState();
    const fatal = document.getElementById('fatal');
    return !d.ready && !state.ready && !state.renderScheduled && !d.tracker.running &&
      !state.sound && state.soundState === 'suspended' && state.activePanel === null &&
      !fatal.hidden && !fatal.closest('[inert]') && document.getElementById('settingsPanel').hidden &&
      document.getElementById('panelBackdrop').hidden && document.activeElement?.id === 'reloadButton';
  }, 'device-loss cleanup, accessible fatal state and reload focus');
  record.afterLoss = await snapshot(page);
  assert.equal(record.afterLoss.readyFlag, false);
  assert.equal(record.afterLoss.state.ready, false);
  assert.equal(record.afterLoss.state.renderScheduled, false);
  assert.equal(record.afterLoss.tracker.running, false);
  assert.equal(record.afterLoss.tracker.videoDetached, true);
  assert.ok(record.afterLoss.media.requests >= 1, 'cleanup must have an actual synthetic camera session to stop');
  assert.ok(record.afterLoss.media.streams.every(entry => entry.stopCalls >= 1 &&
    entry.tracks.length > 0 && entry.tracks.every(track => track.readyState === 'ended')), 'every acquired video track must be stopped');
  assert.equal(record.afterLoss.state.sound, false);
  assert.equal(record.afterLoss.state.soundState, 'suspended');
  assert.equal(record.afterLoss.ui.soundPressed, 'false');
  assert.equal(record.afterLoss.ui.cameraPressed, 'false');
  assert.equal(record.afterLoss.state.activePanel, null);
  assert.equal(record.afterLoss.ui.settingsExpanded, 'false');
  assert.equal(record.afterLoss.ui.modalOpen, false);
  assert.equal(record.afterLoss.ui.settingsHidden, true);
  assert.equal(record.afterLoss.ui.helpHidden, true);
  assert.equal(record.afterLoss.ui.fatalHidden, false);
  assert.equal(record.afterLoss.ui.fatalRole, 'alertdialog');
  assert.equal(record.afterLoss.ui.fatalAriaModal, 'true');
  assert.equal(record.afterLoss.ui.fatalInert, false);
  assert.equal(record.afterLoss.ui.fatalInInertSubtree, false);
  assert.equal(record.afterLoss.ui.reloadInInertSubtree, false);
  assert.equal(record.afterLoss.ui.viewportInInertSubtree, true);
  assert.equal(record.afterLoss.ui.headerInert, true);
  assert.equal(record.afterLoss.ui.footerInert, true);
  assert.equal(record.afterLoss.ui.focusedId, 'reloadButton');
  await delay(700);
  record.settled = await snapshot(page);
  assert.equal(record.settled.state.frames, record.afterLoss.state.frames, 'application frames must stay stopped');
  assert.equal(record.settled.fixture.renderCalls, record.afterLoss.fixture.renderCalls, 'the pipeline must not submit hidden renders after loss');
  assert.equal(record.settled.state.renderScheduled, false);
  assert.equal(record.settled.ui.focusedId, 'reloadButton', 'panel exit animation must not steal recovery focus');
  record.keyboard = [];
  for (const key of ['h', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    const state = await snapshot(page);
    assert.equal(state.state.activePanel, null, 'shortcuts must not open a panel behind the fatal dialog');
    assert.equal(state.ui.helpHidden, true);
    assert.equal(state.ui.focusedId, 'reloadButton', 'fatal recovery must retain keyboard focus');
    assert.equal(state.ui.fatalHidden, false);
    assert.equal(state.state.renderScheduled, false);
    assert.equal(state.fixture.renderCalls, record.afterLoss.fixture.renderCalls);
    record.keyboard.push({ key, focusedId: state.ui.focusedId, activePanel: state.state.activePanel,
      fatalHidden: state.ui.fatalHidden, renderScheduled: state.state.renderScheduled });
  }
  await page.screenshot({ path: path.join(out, '04-device-loss-accessible-recovery.png') });
}

await fs.mkdir(out, { recursive: true });
const report = {
  description: fixtureDescription, nativeWebGPUTested: false,
  startedAt: new Date().toISOString(),
  environment: { origin: 'file://', network: 'Offline context; all HTTP(S) requests aborted and recorded',
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference',
    softwareRendererRequested: process.env.EVA_SOFTWARE_RENDERER === '1' },
  cases: [], browserClosed: false
};
let browser = null;
try {
  const esbuild = require('esbuild');
  const { chromium } = require('playwright');
  report.versions = { esbuild: esbuild.version, playwright: require('playwright/package.json').version };
  report.fixture = await buildFixture(esbuild);
  const args = process.env.EVA_BROWSER_ARGS ? JSON.parse(process.env.EVA_BROWSER_ARGS) :
    ['--no-sandbox', '--disable-dev-shm-usage', ...(process.env.EVA_SOFTWARE_RENDERER === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
  assert.ok(Array.isArray(args) && args.every(value => typeof value === 'string'), 'EVA_BROWSER_ARGS must be a JSON array of strings');
  const executablePath = process.env.EVA_BROWSER_EXECUTABLE || chromium.executablePath();
  report.browser = { executable: executablePath, args };
  browser = await chromium.launch({ executablePath, headless: true, args });
  report.browser.version = browser.version();
  for (const [mode, run] of [['warmup-failure', testWarmupRecovery], ['device-lost', testDeviceLoss]]) {
    const record = { name: mode, description: fixtureDescription, passed: false, errors: [], warnings: [], networkRequests: [] };
    report.cases.push(record);
    const context = await browser.newContext({ viewport: report.environment.viewport, deviceScaleFactor: 1,
      reducedMotion: 'no-preference', serviceWorkers: 'block' });
    let page;
    let watchdogClose = null;
    const watchdog = setTimeout(() => {
      record.watchdogExpired = true;
      // A blocked renderer can leave page.evaluate pending indefinitely; closing
      // the context from the Node side also interrupts those pending commands.
      watchdogClose = context.close().catch(error => { record.watchdogCloseFailure = String(error); });
    }, timeout);
    try {
      await context.setOffline(true);
      await context.route('**/*', route => /^https?:/i.test(route.request().url()) ? route.abort('blockedbyclient') : route.continue());
      await installContextFixtures(context, mode);
      page = await context.newPage();
      page.setDefaultTimeout(Math.min(timeout, 45000));
      page.on('request', request => { if (/^https?:/i.test(request.url())) record.networkRequests.push(request.url()); });
      page.on('pageerror', error => record.errors.push(error.stack || String(error)));
      page.on('console', message => {
        if (message.type() === 'error') record.errors.push(message.text());
        if (message.type() === 'warning') record.warnings.push(message.text());
      });
      const url = pathToFileURL(report.fixture.file);
      url.searchParams.set('lifecycleFixture', mode);
      await page.goto(url.href, { waitUntil: 'load', timeout });
      await run(page, record);
      assert.deepEqual(record.networkRequests, [], 'the complete lifecycle fixture must work without remote requests');
      assert.deepEqual(record.errors, [], 'unexpected page, shader or renderer errors invalidate the fixture');
      record.passed = true;
    } catch (error) {
      record.failure = (record.watchdogExpired ? `Lifecycle case exceeded ${timeout} ms; its context was closed.\n` : '') +
        (error.stack || String(error));
      if (page && !page.isClosed() && !record.watchdogExpired) {
        try { record.failureState = await snapshot(page); } catch {}
        try { await page.screenshot({ path: path.join(out, `${mode}-failure.png`), timeout: 10000 }); } catch {}
      }
    } finally {
      clearTimeout(watchdog);
      if (watchdogClose) await watchdogClose;
      else await context.close();
    }
    console.log(JSON.stringify({ case: mode, passed: record.passed, nativeWebGPUTested: false,
      failure: record.failure || null, errors: record.errors.length, remoteRequests: record.networkRequests.length }));
  }
} catch (error) {
  report.failure = error.stack || String(error);
} finally {
  if (browser) {
    try { await browser.close(); report.browserClosed = true; }
    catch (error) { report.browserCloseFailure = error.stack || String(error); }
  } else report.browserClosed = true;
  report.finishedAt = new Date().toISOString();
  report.passed = !report.failure && !report.browserCloseFailure && report.cases.length === 2 && report.cases.every(record => record.passed);
  const reportFile = path.join(out, 'report.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, browserClosed: report.browserClosed, nativeWebGPUTested: false, report: reportFile }));
  if (!report.passed) process.exitCode = 1;
}
