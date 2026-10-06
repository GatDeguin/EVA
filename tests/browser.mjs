import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Run after npm run build. No server, CDN, physical camera, or network is used.
// The optional executable is supplied by the caller, never by a workspace path.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: options } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' },
  'expected-sha': { type: 'string' }, help: { type: 'boolean' },
} });
if (options.help) {
  console.log('npm run test:browser -- [--input index.html] [--output docs/evidence/browser-results.json] [--expected-sha SHA256]\nOptional environment: EVA_BROWSER_EXECUTABLE, EVA_SOFTWARE_RENDERER=1. Otherwise Playwright uses its installed Chromium.');
  process.exit(0);
}
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const playwrightVersion = require('playwright/package.json').version;
const input = path.resolve(ROOT, options.input || 'index.html');
const output = path.resolve(ROOT, options.output || 'docs/evidence/browser-results.json');
const assetDir = path.join(path.dirname(output), 'browser');
const relative = value => path.relative(ROOT, value).split(path.sep).join('/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await fs.readFile(input);
const expectedHash = options['expected-sha'] || process.env.EVA_EXPECTED_SHA;
if (expectedHash && hash(source) !== expectedHash) throw new Error('The input SHA256 does not match the requested build.');
await fs.mkdir(assetDir, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'eva-browser-'));
const frozen = path.join(temporary, 'index.html');
await fs.writeFile(frozen, source);
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null,
  runner: { file: relative(fileURLToPath(import.meta.url)), sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) },
  input: { file: relative(input), sha256: hash(source), bytes: source.length, frozenForRun: true },
  browser: { playwrightVersion, executableOverride: Boolean(process.env.EVA_BROWSER_EXECUTABLE), forcedSoftwareRenderer: process.env.EVA_SOFTWARE_RENDERER === '1' },
  environment: {
    origin: 'file://', network: 'Context offline; all HTTP(S) requests additionally blocked and logged.',
    limitations: [
      'Results describe this browser and renderer. Software-renderer timings do not establish hardware FPS or reliable speedup percentages.',
      'Frame sampling stops at 60 intervals or an 8 second timer. A blocked browser task can delay the timer; sample counts are reported.',
      'renderer.render() wall time is synchronous method duration, not isolated CPU time, GPU time, or complete frame-submission time.',
      'A postprocessing pipeline can call renderer.render() several times per application frame. Method-call percentiles should not be compared as whole-frame CPU work against a different pipeline.',
      'Denied camera access is injected through getUserMedia. The preview/modality fixture invokes the existing tracker state publisher without a MediaStream; it does not test a physical permission prompt or detector accuracy.',
      'The fatal-recovery fixture injects a renderer-property failure during capture restoration. It verifies common failure presentation, not physical GPU device loss.',
      'Keyboard, focus, and compact-layout checks are targeted integration checks, not a full screen-reader or accessibility certification.',
      'Screenshot visual-review status is recorded separately from automated checks.',
    ],
  },
  sessions: [], cases: [], screenshots: [], downloads: [], timing: [],
  summary: { passed: 0, failed: 0 }, browserClosed: false,
};
let browser;
const contexts = new Set();
const now = () => new Date().toISOString();

async function save() {
  report.summary = {
    passed: report.cases.filter(item => item.status === 'passed').length,
    failed: report.cases.filter(item => item.status === 'failed').length,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
}

// waitForFunction uses eval in this Playwright release, which the app's CSP
// forbids. Direct page.evaluate predicates preserve the delivered policy.
async function poll(page, predicate, { timeout = 45000, argument, label = 'browser condition' } = {}) {
  const deadline = Date.now() + timeout;
  do {
    if (await page.evaluate(predicate, argument)) return;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label} (${timeout} ms).`);
}
const state = page => page.evaluate(() => window.__DIORAMA__?.getState());
async function settle(page) {
  await poll(page, () => {
    const s = window.__DIORAMA__?.getState();
    return s?.paused && !s.renderScheduled && s.motion.active === 0;
  }, { label: 'paused render and presentation to reach rest' });
}
async function closePanel(page) {
  if ((await state(page))?.activePanel) await page.keyboard.press('Escape');
}
async function pause(page, value = true) {
  if ((await state(page)).paused !== value) await page.locator('#pauseButton').click();
  if (value) await settle(page);
}
async function dismissWelcome(page) {
  if (await page.locator('#welcomePanel').isVisible()) await page.locator('#welcomeExploreButton').click();
}
async function chooseQuality(page, value) {
  await closePanel(page);
  await page.locator('#settingsButton').click();
  await page.locator('#quality').selectOption(value);
  await page.keyboard.press('Escape');
}
async function shot(session, name, description) {
  const target = path.join(assetDir, `${name}.png`);
  await session.page.screenshot({ path: target, fullPage: false, timeout: 45000 });
  const capturedState = await state(session.page).catch(() => null);
  const item = { file: relative(target), description, viewport: session.page.viewportSize(), visualReview: 'pending',
    stateAfterCapture: capturedState ? { mode: capturedState.mode, paused: capturedState.paused, time: capturedState.time,
      quality: capturedState.quality, effectiveQuality: capturedState.effectiveQuality, viewport: capturedState.viewport,
      backend: capturedState.backend, drawCalls: capturedState.drawCalls, triangles: capturedState.triangles,
      geometries: capturedState.geometries, textures: capturedState.textures, programs: capturedState.programs } : null };
  report.screenshots.push(item);
  return item;
}

async function session(name, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1,
    acceptDownloads: true, serviceWorkers: 'block', ...contextOptions });
  contexts.add(context);
  const entry = { name, viewport: contextOptions.viewport || { width: 1440, height: 960 },
    reducedMotion: contextOptions.reducedMotion || 'no-preference', errors: [], warnings: [], externalRequests: [] };
  report.sessions.push(entry);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (/^https?:/i.test(url)) {
      if (!entry.externalRequests.includes(url)) entry.externalRequests.push(url);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await context.setOffline(true);
  await context.addInitScript(() => {
    window.__EVA_QA_CAMERA_REQUESTS__ = 0;
    const media = navigator.mediaDevices || {};
    Object.defineProperty(media, 'getUserMedia', { configurable: true, value: async () => {
      window.__EVA_QA_CAMERA_REQUESTS__++;
      throw new DOMException('Intentional denied-camera browser fixture', 'NotAllowedError');
    } });
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => entry.errors.push(error.stack || String(error)));
  page.on('console', message => {
    if (message.type() === 'error') entry.errors.push(message.text());
    if (message.type() === 'warning') entry.warnings.push(message.text());
  });
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/i.test(url) && !entry.externalRequests.includes(url)) entry.externalRequests.push(url);
  });
  return { page, context, entry,
    async open() {
      await page.goto(pathToFileURL(frozen).href, { waitUntil: 'load', timeout: 45000 });
      await poll(page, () => window.__DIORAMA__?.ready || !document.getElementById('fatal').hidden,
        { timeout: 120000, label: 'scene startup' });
      if (!(await state(page))?.ready) throw new Error(await page.locator('#fatalMessage').innerText());
      await poll(page, () => document.getElementById('loading').hidden && window.__DIORAMA__.getState().frames > 0,
        { label: 'first rendered frame' });
      entry.renderer = await page.evaluate(() => {
        const d = window.__DIORAMA__, s = d.getState();
        const result = { backend: s.backend, capabilities: s.capabilities, viewport: s.viewport,
          buffer: { width: d.renderer.domElement.width, height: d.renderer.domElement.height }, userAgent: navigator.userAgent };
        if (s.backend === 'webgl2') {
          const gl = d.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
          Object.assign(result, { webglVersion: gl.getParameter(gl.VERSION),
            renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
            vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) });
        }
        return result;
      });
    },
    async close() { await context.close(); contexts.delete(context); await save(); },
  };
}

async function runCase(s, id, title, body) {
  const item = { id, title, session: s.entry.name, status: 'running', startedAt: now(), checks: [], evidence: {} };
  report.cases.push(item); await save(); console.log(`START ${id}: ${title}`);
  const errorsBefore = s.entry.errors.length;
  const test = {
    evidence: item.evidence,
    check(condition, description, details) {
      item.checks.push({ pass: Boolean(condition), description, ...(details === undefined ? {} : { details }) });
      if (!condition) throw new Error(description);
    },
    shot: (name, description) => shot(s, name, description),
  };
  try {
    item.before = await state(s.page).catch(() => null);
    await body(test, s.page);
    test.check(s.entry.errors.length === errorsBefore, 'No new JavaScript or console errors', s.entry.errors.slice(errorsBefore));
    test.check(s.entry.externalRequests.length === 0, 'No external HTTP(S) requests', s.entry.externalRequests);
    item.status = 'passed';
  } catch (error) {
    item.status = 'failed'; item.error = error.stack || String(error);
    try { await test.shot(`failure-${id}`, 'Actual browser state at the failed assertion'); } catch (captureError) { item.captureError = String(captureError); }
  } finally {
    item.after = await state(s.page).catch(() => null); item.finishedAt = now();
    await save(); console.log(`${item.status.toUpperCase()} ${id}${item.error ? ': ' + item.error.split('\n')[0] : ''}`);
  }
  return item.status === 'passed';
}

async function crewSnapshot(page) {
  return page.evaluate(() => {
    const crew = window.__DIORAMA__.hangar.crew;
    return { time: crew.stats.time, rigs: crew.rigs.map(rig => ({
      id: rig.id, role: rig.role, visible: rig.root.visible, skinned: rig.mesh.isSkinnedMesh,
      bones: Object.keys(rig.bones).length, action: rig.root.userData.action,
      root: [...rig.root.position.toArray(), ...rig.root.quaternion.toArray()],
      transforms: Object.values(rig.bones).flatMap(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]),
    })) };
  });
}

async function measureFrames(page, name) {
  const result = await page.evaluate(() => new Promise(resolve => {
    const d = window.__DIORAMA__, renderer = d.renderer, original = renderer.render;
    const intervals = [], calls = []; let previous = null, raf = 0, ended = false;
    const started = performance.now(), initialFrames = d.getState().frames;
    renderer.render = function (...args) {
      const before = performance.now();
      try { return original.apply(this, args); } finally { calls.push(performance.now() - before); }
    };
    const distribution = values => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
      return { count: values.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
        min: sorted[0], worst: sorted.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
    };
    const finish = reason => {
      if (ended) return; ended = true; clearTimeout(timer); cancelAnimationFrame(raf); renderer.render = original;
      resolve({ reason, elapsedMs: performance.now() - started, applicationFrames: d.getState().frames - initialFrames,
        frameIntervalMs: distribution(intervals), renderMethodWallMs: distribution(calls),
        rawFrameIntervalMs: intervals, rawRenderMethodWallMs: calls, finalState: d.getState() });
    };
    const tick = timestamp => {
      if (previous !== null) intervals.push(timestamp - previous); previous = timestamp;
      if (intervals.length >= 60) finish('60 frame intervals');
      else if (performance.now() - started >= 8000) finish('8 second bound');
      else raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish('8 second timer'), 8000); raf = requestAnimationFrame(tick);
  }));
  report.timing.push({ name, ...result }); await save(); return result;
}

async function visibleCrewContributions(page) {
  return page.evaluate(async () => {
    const d = window.__DIORAMA__, canvas = d.renderer.domElement;
    const bitmap = document.createElement('canvas'); bitmap.width = canvas.width; bitmap.height = canvas.height;
    const context = bitmap.getContext('2d', { willReadFrequently: true });
    const pixels = async url => { const img = new Image(); img.src = url; await img.decode(); context.clearRect(0, 0, bitmap.width, bitmap.height); context.drawImage(img, 0, 0); return context.getImageData(0, 0, bitmap.width, bitmap.height).data; };
    const base = await pixels(d.capture()), results = [];
    for (const rig of d.hangar.crew.rigs) {
      const project = (x, y, z) => {
        const vector = rig.root.position.clone().set(x, y, z); rig.root.localToWorld(vector); vector.project(d.camera);
        return { x: (vector.x * .5 + .5) * bitmap.width, y: (-vector.y * .5 + .5) * bitmap.height };
      };
      const bounds = [project(-.27, 0, 0), project(.27, 0, 0), project(-.27, .72, 0), project(.27, .72, 0)];
      const rect = { left: Math.max(0, Math.floor(Math.min(...bounds.map(p => p.x)))), top: Math.max(0, Math.floor(Math.min(...bounds.map(p => p.y)))),
        right: Math.min(bitmap.width, Math.ceil(Math.max(...bounds.map(p => p.x)))), bottom: Math.min(bitmap.height, Math.ceil(Math.max(...bounds.map(p => p.y)))) };
      const prior = rig.root.visible;
      try {
        rig.root.visible = false;
        const other = await pixels(d.capture()); let changedPixels = 0, absoluteRGB = 0;
        for (let y = rect.top; y < rect.bottom; y++) for (let x = rect.left; x < rect.right; x++) {
          const i = (y * bitmap.width + x) * 4;
          const difference = Math.abs(base[i] - other[i]) + Math.abs(base[i + 1] - other[i + 1]) + Math.abs(base[i + 2] - other[i + 2]);
          absoluteRGB += difference; if (difference > 6) changedPixels++;
        }
        results.push({ id: rig.id, role: rig.role, rect, changedPixels, absoluteRGB });
      } finally { rig.root.visible = prior; d.capture(); }
    }
    return { method: 'Paused actual canvas PNG comparison; only each rig visibility is toggled, and comparisons are restricted to its projected body rectangle.', results };
  });
}

async function saveDownload(download, filename) {
  const target = path.join(assetDir, filename); await download.saveAs(target);
  const bytes = await fs.readFile(target);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const info = { file: relative(target), suggestedFilename: download.suggestedFilename(), bytes: bytes.length, sha256: hash(bytes),
    png, width: png ? bytes.readUInt32BE(16) : null, height: png ? bytes.readUInt32BE(20) : null };
  report.downloads.push(info); return info;
}
function nextDownload(page, timeout = 45000) {
  const promise = page.waitForEvent('download', { timeout });
  // An earlier assertion may abort the case before awaiting the event. Keep
  // that abandoned wait observed; awaiting this promise still propagates errors.
  promise.catch(() => {});
  return promise;
}
async function holdNextBlob(page) {
  await page.evaluate(() => {
    const canvas = window.__DIORAMA__.renderer.domElement, original = canvas.toBlob;
    const hold = window.__EVA_QA_BLOB__ = { ready: false, released: false, original, canvas };
    canvas.toBlob = function (callback, ...args) {
      return original.call(this, blob => {
        hold.ready = true;
        hold.release = () => { if (!hold.released) { hold.released = true; canvas.toBlob = original; callback(blob); } };
      }, ...args);
    };
  });
}
async function releaseBlob(page) {
  await page.evaluate(() => window.__EVA_QA_BLOB__?.release?.());
}

try {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (process.env.EVA_SOFTWARE_RENDERER === '1') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  browser = await chromium.launch({ headless: true, args, ...(process.env.EVA_BROWSER_EXECUTABLE ? { executablePath: process.env.EVA_BROWSER_EXECUTABLE } : {}) });
  report.browser.version = browser.version(); report.browser.args = args;
  const desktop = await session('desktop');
  const desktopReady = await runCase(desktop, 'startup', 'Standalone file, ready scene, no automatic permissions', async (t, p) => {
    await desktop.open(); const s = await state(p);
    t.check(s.ready && s.frames > 0, 'Application is ready and has rendered');
    t.check(await p.evaluate(() => window.__EVA_QA_CAMERA_REQUESTS__ === 0), 'Camera is not requested on startup');
    t.check(!s.sound && s.soundState === 'not-created', 'Audio is not created on startup');
    t.check(await p.locator('#welcomePanel').isVisible(), 'Fresh origin presents the introduction');
    t.evidence.state = s; await t.shot('01-entry-cine', 'Fresh offline entry, 1440 × 960'); await dismissWelcome(p);
  });
  if (desktopReady) {
    await runCase(desktop, 'crew-motion', 'All three rigs move and reach actual rendered pixels', async (t, p) => {
      await p.mouse.move(0, 0); await p.evaluate(() => window.__DIORAMA__.setPose(0, 0, 0));
      const before = await crewSnapshot(p);
      t.check(before.rigs.length === 3 && before.rigs.every(r => r.skinned && r.bones >= 15), 'Three articulated skinned figures are present', before.rigs.map(({ transforms, ...r }) => r));
      t.check(new Set(before.rigs.map(r => r.role)).size === 3, 'The three roles retain distinct identities');
      await measureFrames(p, 'default-cine-auto-quality');
      const after = await crewSnapshot(p);
      const changes = before.rigs.map((rig, index) => ({ id: rig.id, largestJointChange: Math.max(...rig.transforms.map((value, j) => Math.abs(value - after.rigs[index].transforms[j]))) }));
      t.check(changes.every(r => r.largestJointChange > .00001), 'Every rig changes articulated joint transforms during real application frames', changes);
      t.check(after.rigs.every(r => [...r.root, ...r.transforms].every(Number.isFinite)), 'All observed transforms remain finite');
      await pause(p); t.evidence.before = before; t.evidence.after = after;
      t.evidence.pixelContributions = await visibleCrewContributions(p);
      t.check(t.evidence.pixelContributions.results.every(r => r.changedPixels >= 8), 'Each crew member contributes visible pixels within its projected body region', t.evidence.pixelContributions.results);
      await t.shot('02-cine-neutral', 'Paused Cine view; all three rendered crew figures');
    });

    await runCase(desktop, 'pause-demand', 'Pause stops the render loop; input renders on demand and resume advances', async (t, p) => {
      await closePanel(p); await pause(p); const before = await state(p), rigs = await crewSnapshot(p);
      await p.waitForTimeout(900); const idle = await state(p);
      t.check(idle.frames === before.frames && idle.time === before.time && !idle.renderScheduled, 'A settled paused scene produces no extra frames', { before: { frames: before.frames, time: before.time }, after: { frames: idle.frames, time: idle.time } });
      t.check(JSON.stringify(await crewSnapshot(p)) === JSON.stringify(rigs), 'Paused crew transforms and clock remain unchanged');
      await p.locator('#viewport').focus(); await p.keyboard.press('ArrowRight');
      await poll(p, frames => window.__DIORAMA__.getState().frames > frames, { argument: idle.frames, label: 'paused keyboard input to draw' });
      await settle(p); const moved = await state(p);
      t.check(moved.pose.x > .03 && moved.time === idle.time, 'Keyboard parallax remains available without advancing simulation', moved.pose);
      await pause(p, false); const start = await state(p);
      await poll(p, target => window.__DIORAMA__.getState().frames >= target, { argument: start.frames + 2, label: 'resumed frames' });
      t.check((await state(p)).time > start.time, 'Resume advances the application clock');
      await pause(p); await p.evaluate(() => window.__DIORAMA__.setPose(0, 0, 0)); await settle(p);
    });

    await runCase(desktop, 'panels-20-cycles', 'Twenty native panel cycles preserve focus, modality and finite motion', async (t, p) => {
      await closePanel(p); await pause(p); const before = await state(p); const cycles = [];
      for (let i = 0; i < 20; i++) {
        const panelId = i % 2 ? 'helpPanel' : 'settingsPanel', triggerId = i % 2 ? 'helpButton' : 'settingsButton';
        await p.locator('#' + triggerId).click();
        const opened = await p.evaluate(id => ({ active: window.__DIORAMA__.getState().activePanel,
          hidden: document.getElementById(id).hidden, inert: document.getElementById(id).inert,
          canvasInert: document.getElementById('viewport').inert, focusedInside: document.getElementById(id).contains(document.activeElement) }), panelId);
        t.check(opened.active === panelId && !opened.hidden && !opened.inert && opened.canvasInert && opened.focusedInside, `Cycle ${i + 1}: open dialog owns focus and background is inert`, opened);
        if (i < 2) {
          await p.locator('#' + panelId).evaluate(panel => {
            const controls = [...panel.querySelectorAll('button,input,select,summary,a[href]')].filter(el => el.offsetParent !== null && !el.disabled);
            controls.at(-1).focus();
          });
          await p.keyboard.press('Tab');
          t.check(await p.locator('#' + panelId).evaluate(panel => document.activeElement === panel.querySelector('button')), 'Tab wraps inside the active dialog');
        }
        if (i % 3 === 0) await p.locator(`[data-close="${panelId}"]`).click(); else await p.keyboard.press('Escape');
        const closed = await p.evaluate(id => ({ active: window.__DIORAMA__.getState().activePanel,
          hidden: document.getElementById(id).hidden, inert: document.getElementById(id).inert,
          canvasInert: document.getElementById('viewport').inert, focusId: document.activeElement.id }), panelId);
        t.check(!closed.active && closed.hidden && closed.inert && !closed.canvasInert && closed.focusId === triggerId, `Cycle ${i + 1}: close is immediate and focus returns`, closed);
        cycles.push({ panelId, opened, closed });
      }
      await p.evaluate(() => { document.getElementById('settingsButton').click(); document.querySelector('[data-close="settingsPanel"]').click(); document.getElementById('settingsButton').click(); });
      await poll(p, () => window.__DIORAMA__.getState().motion.active === 0, { label: 'rapid reopen to settle' });
      t.check(await p.locator('#settingsPanel').isVisible(), 'A rapid close/reopen cannot stale-hide the new panel');
      await p.keyboard.press('Escape'); await settle(p); const after = await state(p);
      t.check(after.motion.active === 0 && after.motion.failed === 0, 'No live or failed presentation animations remain', after.motion);
      t.check(after.geometries === before.geometries && after.textures === before.textures, 'Panel cycles do not allocate renderer geometries or textures', { before: [before.geometries, before.textures], after: [after.geometries, after.textures] });
      t.evidence.cycles = cycles;
    });

    await runCase(desktop, 'reduced-during-entry', 'Changing reduced motion cancels a real drawer entry to its stable state', async (t, p) => {
      await closePanel(p); await pause(p);
      try {
        const held = await p.evaluate(() => {
          document.getElementById('settingsButton').click();
          const panel = document.getElementById('settingsPanel'), animations = panel.getAnimations();
          for (const animation of animations) { animation.pause(); animation.currentTime = 80; }
          return { count: animations.length, motion: window.__DIORAMA__.getState().motion };
        });
        t.evidence.fixture = 'Only the actual drawer WAAPI entry is held at 80 ms so the OS preference can change deterministically during it; application state is untouched.';
        t.check(held.count > 0 && held.motion.active > 0, 'A real unfinished drawer animation is present', held);
        await p.emulateMedia({ reducedMotion: 'reduce' });
        await poll(p, () => window.__DIORAMA__.getState().motion.reduced && window.__DIORAMA__.getState().motion.active === 0, { label: 'reduced motion to cancel entries' });
        const stable = await p.locator('#settingsPanel').evaluate(panel => ({ hidden: panel.hidden, inert: panel.inert, transform: getComputedStyle(panel).transform, opacity: Number(getComputedStyle(panel).opacity), containsFocus: panel.contains(document.activeElement) }));
        t.check(!stable.hidden && !stable.inert && stable.transform === 'none' && stable.opacity === 1 && stable.containsFocus, 'Reduced entry leaves the final usable dialog and focus', stable);
        await p.keyboard.press('Escape');
        await p.locator('[data-view="inspect"]').click(); await p.locator('[data-view="window"]').click();
        t.check(await p.evaluate(() => !window.__DIORAMA__.hangar.group.getObjectByName('Airborne dust').visible), 'Dust stays hidden after inspect → window under reduced motion');
        await settle(p); const frozenCrew = await crewSnapshot(p); await p.waitForTimeout(500);
        t.check(JSON.stringify(await crewSnapshot(p)) === JSON.stringify(frozenCrew), 'Reduced default scene remains static');
      } finally {
        // A failed assertion must not leave an animation held at 80 ms or a
        // changed media preference contaminating the following real UI cases.
        await p.emulateMedia({ reducedMotion: 'reduce' });
        await closePanel(p);
        await p.emulateMedia({ reducedMotion: 'no-preference' });
        await poll(p, () => !window.__DIORAMA__.getState().motion.reduced, { label: 'ordinary motion preference to return' });
      }
      await settle(p);
    });

    await runCase(desktop, 'camera-failure-and-modality', 'Denied camera recovery and preview revealed behind Settings', async (t, p) => {
      await closePanel(p); await p.locator('#cameraButton').click();
      await poll(p, () => window.__DIORAMA__.getState().tracking === 'error', { label: 'denied camera state' });
      t.check(await p.locator('#cameraPanel').isVisible(), 'Denied camera presents a recoverable panel');
      t.check((await p.locator('#cameraMessage').innerText()).includes('bloqueada'), 'Permission failure has an explicit message');
      t.check(await p.evaluate(() => window.__EVA_QA_CAMERA_REQUESTS__ === 1), 'Only the requested camera action calls getUserMedia');
      await p.locator('#stopCameraButton').click();
      t.check(!(await p.locator('#cameraPanel').isVisible()), 'Close returns to manual exploration');
      await p.locator('#settingsButton').click();
      // Publish through the tracker so its internal state agrees with the UI;
      // invoking onState alone would make stop() deduplicate a stale idle state.
      await p.evaluate(() => window.__DIORAMA__.tracker._setState('searching', 'QA presentation fixture: local preview state, no camera stream.'));
      const behind = await p.locator('#cameraPanel').evaluate(panel => ({ hidden: panel.hidden, inert: panel.inert }));
      t.check(!behind.hidden && behind.inert, 'Newly revealed preview stays inert behind the modal', behind);
      await p.keyboard.press('Escape');
      const front = await p.locator('#cameraPanel').evaluate(panel => ({ hidden: panel.hidden, inert: panel.inert, ancestorInert: Boolean(panel.closest('[inert]')) }));
      t.check(!front.hidden && !front.inert && !front.ancestorInert, 'Closing Settings restores interaction to the newly visible preview', front);
      t.evidence.fixture = 'The second half invokes the existing tracker state publisher (_setState), preserving internal/UI consistency. It verifies presentation/modality and does not simulate a detector, physical permission, or MediaStream.';
      await t.shot('03-camera-recovery-fixture', 'Visible preview presentation after the modal closes; synthetic UI state is labeled in its message');
      await p.locator('#stopCameraButton').click();
      t.check((await state(p)).tracking === 'idle' && !(await p.locator('#cameraPanel').isVisible()), 'The preview fixture cleans up to idle with its panel hidden');
      await pause(p);
    });

    await runCase(desktop, 'presets-and-orbit', 'Lighting presets settle and camera modes remain usable', async (t, p) => {
      await closePanel(p); await pause(p); await p.evaluate(() => window.__DIORAMA__.setPose(0, 0, 0));
      const presets = [];
      for (const [key, name] of [['night', '04-cine'], ['studio', '05-studio'], ['alarm', '06-alert']]) {
        await p.locator(`[data-light="${key}"]`).click(); await settle(p);
        const lights = await p.evaluate(() => { const d = window.__DIORAMA__; return { key: d.lightRig.key.intensity, front: d.lightRig.front.intensity, background: d.scene.background.getHex(), state: d.getState() }; });
        t.check(lights.state.preferences.lighting === key && await p.locator(`[data-light="${key}"]`).getAttribute('aria-pressed') === 'true', 'Selected preset is coherent: ' + key);
        presets.push({ key, keyIntensity: lights.key, frontIntensity: lights.front, background: lights.background });
        await t.shot(name, `Settled ${key} lighting; same neutral camera and paused simulation`);
        if (key === 'studio') { await pause(p, false); await measureFrames(p, 'studio-auto-quality'); await pause(p); }
      }
      t.check(new Set(presets.map(preset => preset.background)).size === 3 && new Set(presets.map(preset => preset.keyIntensity.toFixed(1))).size === 3, 'Presets have distinct settled lighting, not only changed labels', presets);
      await p.locator('[data-light="studio"]').click(); await settle(p);
      await p.locator('[data-view="inspect"]').click(); await p.locator('#viewport').focus();
      const before = await p.evaluate(() => window.__DIORAMA__.camera.position.toArray());
      await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Shift+Equal'); await settle(p);
      const after = await p.evaluate(() => window.__DIORAMA__.camera.position.toArray());
      t.check(Math.hypot(...after.map((n, i) => n - before[i])) > .1 && (await state(p)).source === 'orbit', 'Native keyboard input moves the orbit camera', { before, after });
      await t.shot('07-studio-inspect', 'Studio orbit after native keyboard interaction');
      await p.locator('[data-view="demo"]').click();
      t.check((await state(p)).source === 'auto', 'Demo mode owns the view');
      await p.locator('#viewport').focus(); await p.keyboard.press('ArrowLeft');
      t.check((await state(p)).mode === 'window', 'Manual keyboard input reclaims the view from demo');
      await p.evaluate(() => window.__DIORAMA__.setPose(0, 0, 0)); await settle(p);
      t.evidence.presets = presets;
    });

    await runCase(desktop, 'quality-profiles', 'All five quality profiles draw through the integrated application', async (t, p) => {
      await closePanel(p); await pause(p);
      const previousViewport = p.viewportSize(), previousQuality = (await state(p)).preferences.quality;
      const observations = [], features = { performance: [false, false], balanced: [true, false], quality: [true, true], ultra: [true, true], cinematic: [true, true] };
      try {
        await p.setViewportSize({ width: 640, height: 520 }); await settle(p);
        await p.locator('#settingsButton').click();
        for (const [profile, [bloom, ao]] of Object.entries(features)) {
          await p.evaluate(() => {
            window.__EVA_QA_QUALITY_COMMIT__ = null;
            document.getElementById('quality').addEventListener('change', () => {
              const s = window.__DIORAMA__.getState();
              window.__EVA_QA_QUALITY_COMMIT__ = { profile: s.quality, frames: s.frames };
            }, { once: true });
          });
          await p.locator('#quality').selectOption(profile);
          await poll(p, profile => {
            const s = window.__DIORAMA__.getState(), commit = window.__EVA_QA_QUALITY_COMMIT__;
            return commit?.profile === profile && s.quality === profile && s.frames > commit.frames;
          }, { argument: profile, label: 'frame rendered after the committed profile ' + profile });
          const observation = await p.evaluate(() => {
            const d = window.__DIORAMA__, s = d.getState();
            return { ...s, committedAtFrame: window.__EVA_QA_QUALITY_COMMIT__.frames,
              buffer: { width: d.renderer.domElement.width, height: d.renderer.domElement.height } };
          });
          t.check(observation.quality === profile && observation.preferences.quality === profile, 'Profile selection reaches the application renderer: ' + profile);
          t.check(observation.effectiveQuality.bloom === bloom && observation.effectiveQuality.ao === ao,
            'Effective feature budget is correct: ' + profile, observation.effectiveQuality);
          t.check(observation.bloomActive === Boolean(observation.hdr && observation.preferences.bloom && bloom)
            && observation.aoActive === Boolean(observation.hdr && observation.preferences.ao && ao), 'Bloom/AO match the profile and HDR capability: ' + profile,
            { hdr: observation.hdr, bloom: observation.bloomActive, ao: observation.aoActive });
          const { width, height } = observation.buffer, maxTexture = observation.capabilities.limits.maxTextureSize;
          t.check(width > 0 && height > 0 && width <= maxTexture && height <= maxTexture
            && observation.viewport.dpr > 0 && observation.viewport.dpr <= observation.effectiveQuality.maxPixelRatio + .001
            && width * height <= observation.effectiveQuality.pixelBudget + width + height,
            'Drawing buffer and DPR remain within declared resource limits: ' + profile, { buffer: observation.buffer, dpr: observation.viewport.dpr, maxTexture, pixelBudget: observation.effectiveQuality.pixelBudget });
          t.check(observation.paused && observation.photoMode === (profile === 'cinematic'), 'Photo mode and paused scene remain coherent: ' + profile);
          observations.push(observation);
        }
        await p.keyboard.press('Escape'); await settle(p);
        await t.shot('07b-cinematic-profile', 'Integrated Cinematic/Photo profile at 640 × 520; small viewport bounds software-renderer cost');
        const photoBefore = await p.evaluate(() => ({ state: window.__DIORAMA__.getState(), width: window.__DIORAMA__.renderer.domElement.width, height: window.__DIORAMA__.renderer.domElement.height }));
        const photoDownload = nextDownload(p); await p.locator('#screenshotButton').click();
        const photo = await saveDownload(await photoDownload, 'capture-cinematic.png');
        await poll(p, () => !window.__DIORAMA__.getState().screenshotPending, { label: 'cinematic PNG restoration' });
        const photoAfter = await state(p);
        t.check(photo.png && photo.width > photoBefore.width && photo.height > photoBefore.height
          && photo.width * photo.height <= 4_000_000 + photo.width + photo.height,
          'Cinematic capture produces a real larger PNG within its capture pixel budget', { before: [photoBefore.width, photoBefore.height], photo });
        t.check(photoAfter.photoMode && photoAfter.paused && Math.abs(photoAfter.viewport.dpr - photoBefore.state.viewport.dpr) < .001,
          'Cinematic PNG completion restores the viewing DPR and stays paused');
        t.evidence.cinematicPhoto = photo;
        t.evidence.profiles = observations;
      } finally {
        await closePanel(p); await p.setViewportSize(previousViewport); await chooseQuality(p, previousQuality); await pause(p); await settle(p);
      }
    });

    await runCase(desktop, 'capture-png', 'Native capture downloads an actual PNG of the scene', async (t, p) => {
      await closePanel(p); await pause(p);
      const dimensions = await p.evaluate(() => ({ width: window.__DIORAMA__.renderer.domElement.width, height: window.__DIORAMA__.renderer.domElement.height }));
      const downloadPromise = nextDownload(p); await p.locator('#screenshotButton').click();
      const downloaded = await saveDownload(await downloadPromise, 'capture-native.png');
      await poll(p, () => !window.__DIORAMA__.getState().screenshotPending, { label: 'capture completion' });
      t.check(downloaded.png && downloaded.width === dimensions.width && downloaded.height === dimensions.height && downloaded.bytes > 1024, 'PNG header, dimensions, and nonempty image payload are valid', downloaded);
      t.check(await p.locator('#screenshotButton').isEnabled(), 'Capture control becomes available again'); t.evidence.download = downloaded;
    });

    await runCase(desktop, 'capture-quality-resize-race', 'A pending PNG preserves the latest quality and viewport when it completes', async (t, p) => {
      await closePanel(p); await pause(p); await chooseQuality(p, 'performance');
      await p.setViewportSize({ width: 1800, height: 1250 }); await settle(p);
      const requested = await state(p); await holdNextBlob(p);
      const downloadPromise = nextDownload(p, 60000); await p.locator('#screenshotButton').click();
      await poll(p, () => window.__EVA_QA_BLOB__?.ready && window.__DIORAMA__.getState().screenshotPending, { label: 'held PNG callback' });
      t.check(!(await p.locator('#screenshotButton').isEnabled()), 'A second capture is disabled during PNG encoding');
      try {
        await p.locator('#settingsButton').click(); await p.locator('#quality').selectOption('balanced');
        await p.setViewportSize({ width: 1280, height: 860 });
        await poll(p, () => window.__DIORAMA__.getState().viewport.width < 1300, { label: 'new viewport during PNG encoding' });
        await p.keyboard.press('Escape'); const pending = await state(p);
        t.check(Math.abs(pending.viewport.dpr - requested.viewport.dpr) > .02, 'The fixture creates a materially different current DPR', { before: requested.viewport, pending: pending.viewport });
        await releaseBlob(p); const downloaded = await saveDownload(await downloadPromise, 'capture-delayed-race.png');
        await poll(p, () => !window.__DIORAMA__.getState().screenshotPending, { label: 'delayed capture completion' });
        const completed = await state(p);
        t.check(completed.quality === 'balanced' && completed.preferences.quality === 'balanced', 'The latest quality selection survives completion');
        t.check(Math.abs(completed.viewport.dpr - pending.viewport.dpr) < .001 && completed.viewport.width === pending.viewport.width && completed.viewport.height === pending.viewport.height, 'Completion does not restore stale DPR or dimensions', { pending: pending.viewport, completed: completed.viewport });
        t.check(downloaded.png && downloaded.bytes > 1024, 'Delayed callback still delivers a valid PNG', downloaded);
        t.evidence.fixture = 'Only the real canvas.toBlob callback is held. Native Settings selection and viewport resize run while the real snapshot operation is pending.';
        t.evidence.requested = requested.viewport; t.evidence.pending = pending.viewport; t.evidence.completed = completed.viewport; t.evidence.download = downloaded;
      } finally { await releaseBlob(p); }
      await chooseQuality(p, 'performance'); await p.setViewportSize({ width: 1440, height: 960 }); await pause(p); await settle(p);
    });
  }
  await desktop.close();

  // The prior page is closed before this context starts; software rendering is
  // deliberately serial even though the cases use different media preferences.
  const reduced = await session('compact-reduced', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const reducedReady = await runCase(reduced, 'reduced-before-startup', 'Reduced motion is respected before load on a compact touch viewport', async (t, p) => {
    await reduced.open(); const s = await state(p);
    t.check(s.paused && s.motion.reduced, 'Initial scene and presentation honor reduced motion');
    t.check(await p.evaluate(() => window.__EVA_QA_CAMERA_REQUESTS__ === 0), 'Compact startup does not request the camera');
    await dismissWelcome(p); await settle(p); const before = await state(p), rigs = await crewSnapshot(p);
    await p.waitForTimeout(700); const after = await state(p);
    t.check(after.frames === before.frames && after.time === before.time && JSON.stringify(await crewSnapshot(p)) === JSON.stringify(rigs), 'Reduced initial simulation and render loop reach rest');
    t.check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Compact page has no horizontal overflow');
    await p.locator('#settingsButton').click();
    const accessibility = await p.locator('#settingsPanel').evaluate(panel => ({ inert: panel.inert, hidden: panel.hidden, focusInside: panel.contains(document.activeElement), right: panel.getBoundingClientRect().right, viewport: innerWidth }));
    t.check(!accessibility.hidden && !accessibility.inert && accessibility.focusInside && accessibility.right <= accessibility.viewport + 1, 'Compact settings and focus remain reachable', accessibility);
    await poll(p, () => document.getElementById('toast').hidden, { timeout: 10000, label: 'initial reduced-motion notice to clear before the documentation capture' });
    await t.shot('08-compact-reduced-settings', '390 × 844 touch viewport, reduced motion active from startup');
    await p.keyboard.press('Escape'); await p.locator('[data-view="inspect"]').click(); await p.locator('[data-view="window"]').click(); await settle(p);
    t.check(await p.evaluate(() => !window.__DIORAMA__.hangar.group.getObjectByName('Airborne dust').visible), 'Reduced ambient particles remain hidden after view changes');
    await t.shot('09-compact-reduced-window', 'Compact window view after reduced-motion view changes');
  });
  if (reducedReady) await runCase(reduced, 'fatal-capture-recovery-fixture', 'Capture-restoration failure exposes the common accessible recovery UI', async (t, p) => {
    await closePanel(p); await pause(p);
    await p.locator('#soundButton').click();
    await poll(p, () => { const s = window.__DIORAMA__.getState(); return s.sound && s.soundState === 'running'; }, { timeout: 15000, label: 'user-requested real Web Audio context' });
    await p.evaluate(() => {
      const tracker = window.__DIORAMA__.tracker, original = tracker.stop;
      window.__EVA_QA_TRACKER_STOPS__ = 0;
      tracker.stop = function (...args) { window.__EVA_QA_TRACKER_STOPS__++; return original.apply(this, args); };
      tracker._setState('searching', 'QA recovery fixture: preview state only, no MediaStream.');
    });
    t.evidence.beforeFailure = await state(p);
    await holdNextBlob(p);
    const downloadPromise = nextDownload(p); await p.locator('#screenshotButton').click();
    await poll(p, () => window.__EVA_QA_BLOB__?.ready, { label: 'held recovery-fixture PNG' });
    await p.locator('#settingsButton').click();
    await p.evaluate(() => {
      const renderer = window.__DIORAMA__.renderer;
      window.__EVA_QA_ORIGINAL_RATIO__ = renderer.getPixelRatio;
      renderer.getPixelRatio = () => { throw new Error('Intentional capture-restoration failure fixture'); };
      window.__EVA_QA_BLOB__.release();
    });
    await poll(p, () => !document.getElementById('fatal').hidden, { label: 'fatal recovery presentation' });
    await p.evaluate(() => { window.__DIORAMA__.renderer.getPixelRatio = window.__EVA_QA_ORIGINAL_RATIO__; });
    await poll(p, () => window.__DIORAMA__.getState().soundState === 'suspended', { label: 'fatal recovery to suspend real audio' });
    await saveDownload(await downloadPromise, 'capture-before-recovery-failure.png');
    const recovery = await p.evaluate(() => ({ ready: window.__DIORAMA__.ready,
      modal: window.__DIORAMA__.getState().activePanel, hidden: document.getElementById('fatal').hidden,
      inert: Boolean(document.getElementById('fatal').closest('[inert]')),
      focusId: document.activeElement.id, reloadEnabled: !document.getElementById('reloadButton').disabled,
      role: document.getElementById('fatal').getAttribute('role'), message: document.getElementById('fatalMessage').textContent }));
    t.check(!recovery.ready && !recovery.modal && !recovery.hidden && !recovery.inert && recovery.focusId === 'reloadButton' && recovery.reloadEnabled, 'Fatal recovery closes the modal, remains interactive, and focuses reload', recovery);
    t.check(recovery.role === 'alertdialog', 'Fatal recovery declares its accessible dialog role');
    const stopped = await state(p);
    t.check(!stopped.sound && stopped.soundState === 'suspended' && await p.locator('#soundButton').getAttribute('aria-pressed') === 'false', 'Fatal recovery suspends the real audio context and updates its control');
    t.check(stopped.tracking === 'idle' && await p.evaluate(() => window.__EVA_QA_TRACKER_STOPS__ > 0 && window.__EVA_QA_CAMERA_REQUESTS__ === 0), 'Fatal recovery stops the tracker state fixture without requesting a physical camera');
    t.check(!stopped.renderScheduled && stopped.motion.active === 0, 'Fatal recovery owns no scheduled render or live presentation animation');
    await p.keyboard.press('h'); await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
    const afterKeys = await p.evaluate(() => ({ modal: window.__DIORAMA__.getState().activePanel,
      fatalInert: Boolean(document.getElementById('fatal').closest('[inert]')), focusId: document.activeElement.id }));
    t.check(!afterKeys.modal && !afterKeys.fatalInert && afterKeys.focusId === 'reloadButton', 'Help shortcut and forward/backward Tab cannot strand fatal recovery behind another panel', afterKeys);
    t.evidence.fixture = 'A renderer-property read throws only during the real PNG finally/restoration path. Audio is real and explicitly activated through its button; tracker state is published through its existing _setState method without a MediaStream. This tests common recovery/cleanup and is not a physical GPU-loss or WebGPU-device-loss test.';
    t.evidence.recovery = recovery; t.evidence.afterKeys = afterKeys; await t.shot('10-fatal-recovery-fixture', 'Injected capture-restoration failure: actual accessible recovery UI');
  });
  await reduced.close();
} catch (error) {
  report.runnerError = error.stack || String(error); console.error(report.runnerError);
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close(); report.browserClosed = true;
  report.input.sourceStillMatches = hash(await fs.readFile(input)) === report.input.sha256;
  report.finishedAt = now(); await save(); await fs.rm(temporary, { recursive: true, force: true });
  if (report.runnerError || report.summary.failed || !report.input.sourceStillMatches) process.exitCode = 1;
  console.log(JSON.stringify({ report: relative(output), ...report.summary, browserClosed: report.browserClosed,
    sourceStillMatches: report.input.sourceStillMatches, runnerError: report.runnerError || null }));
}
