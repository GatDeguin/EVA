import {
  ACESFilmicToneMapping, HalfFloatType, PCFShadowMap, PMREMGenerator as WebGLPMREMGenerator,
  SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderer, WebGLRenderTarget
} from 'three';
import {
  PMREMGenerator as WebGPUPMREMGenerator, RenderPipeline, WebGPURenderer
} from 'three/webgpu';
import { mix, pass, renderOutput, rtt, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const SOFTWARE_RENDERER = /SwiftShader|llvmpipe|lavapipe|softpipe|software rasterizer|Microsoft Basic Render|WARP/i;
const DEVICE_FEATURES = [
  'core-features-and-limits', 'depth-clip-control', 'depth32float-stencil8',
  'texture-compression-bc', 'texture-compression-etc2', 'texture-compression-astc',
  'timestamp-query', 'shader-f16', 'rg11b10ufloat-renderable', 'float32-filterable'
];
const DEFAULT_QUALITY = Object.freeze({ bloom: true, ao: false, samples: 4 });
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const timestamp = () => globalThis.performance?.now() ?? Date.now();

/** The returned value is an actual supported count, not the requested count. */
export function selectMSAASamples(requested, available = [0]) {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const counts = available.filter(value => Number.isFinite(value) && value > 1 && value <= 4).sort((a, b) => a - b);
  if (!counts.length) return 0;
  return counts.find(value => value >= requested) ?? counts[counts.length - 1];
}

/** Device memory is a coarse system-memory hint; browsers do not expose total VRAM. */
export function estimateDeviceProfile({ rendererName = '', adapterInfo = {}, mobile = false, systemMemoryGB = null } = {}) {
  const softwareRendering = adapterInfo.isFallbackAdapter === true || SOFTWARE_RENDERER.test([
    rendererName, adapterInfo.vendor, adapterInfo.architecture, adapterInfo.device, adapterInfo.description
  ].filter(Boolean).join(' '));
  const constrained = mobile || (Number.isFinite(systemMemoryGB) && systemMemoryGB <= 4);
  return {
    softwareRendering,
    softwareRenderingEstimate: true,
    gpuTier: softwareRendering ? 'software' : constrained ? 'low' : 'unknown',
    gpuTierEstimate: true,
    estimatedTextureBudgetMB: softwareRendering ? 64 : constrained ? 128 : 256,
    memoryEstimateBasis: 'Conservative application texture budget from device class; not measured available VRAM.'
  };
}

function readLimit(object, name, fallback = null) {
  try { return finite(object?.[name], fallback); } catch { return fallback; }
}

function readWebGLLimits(gl) {
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const hdr = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const sampleCounts = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, hdr ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES) || []);
  return {
    rendererName: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    hdr,
    sampleCounts: [0, ...sampleCounts.filter(value => value > 1 && value <= 4)],
    limits: {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCubeTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxAnisotropy: anisotropy ? gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1,
      maxUniformBufferSize: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
      maxBufferSize: null,
      maxSamples: gl.getParameter(gl.MAX_SAMPLES)
    },
    textureCompression: {
      bc: Boolean(gl.getExtension('WEBGL_compressed_texture_s3tc')),
      astc: Boolean(gl.getExtension('WEBGL_compressed_texture_astc')),
      etc2: Boolean(gl.getExtension('WEBGL_compressed_texture_etc'))
    },
    timerExtension: gl.getExtension('EXT_disjoint_timer_query_webgl2')
  };
}

function estimateRefreshRate(view) {
  if (!view.requestAnimationFrame || view.document?.hidden) return Promise.resolve(null);
  return new Promise(resolve => {
    const intervals = [];
    let previous = null;
    let frame = null;
    let complete = false;
    function finish() {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      if (frame !== null) view.cancelAnimationFrame(frame);
      if (intervals.length < 4) { resolve(null); return; }
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      resolve(Math.round(10000 / median) / 10);
    }
    function sample(now) {
      if (view.document?.hidden) { intervals.length = 0; finish(); return; }
      if (previous !== null && now - previous >= 4 && now - previous <= 100) intervals.push(now - previous);
      previous = now;
      if (intervals.length >= 8) finish();
      else frame = view.requestAnimationFrame(sample);
    }
    const deadline = setTimeout(finish, 250);
    frame = view.requestAnimationFrame(sample);
  });
}

async function preflight(canvas, preferredBackend, onProgress, warnings) {
  const navigator = globalThis.navigator || {};
  const view = canvas.ownerDocument?.defaultView || globalThis;
  // Run this alongside adapter discovery, before scene construction loads the GPU.
  const refreshRate = estimateRefreshRate(view);
  const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const capabilities = {
    backend: null,
    webgpu: { apiAvailable: Boolean(navigator.gpu), adapterAvailable: false, initialized: false, features: [] },
    webgl2: { available: false, initialized: false },
    mobile,
    devicePixelRatio: finite(view.devicePixelRatio, 1),
    resolution: { width: view.innerWidth || canvas.width, height: view.innerHeight || canvas.height },
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    systemMemoryGB: navigator.deviceMemory || null,
    reducedMotion: view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    refreshRateHz: null,
    refreshRateEstimate: true,
    refreshRateBasis: 'Median idle RAF interval (250 ms maximum); an observed cadence estimate, not a hardware refresh-rate guarantee.',
    hdr: false,
    hdrFormat: null,
    outputColorSpace: 'sRGB / SDR',
    gpuTimingSupported: false,
    limits: {},
    textureCompression: { bc: false, astc: false, etc2: false },
    ...estimateDeviceProfile({ mobile, systemMemoryGB: navigator.deviceMemory || null })
  };
  onProgress?.(6, 'Detectando capacidades gráficas...');
  // A detached probe never claims the presentation canvas. It is explicitly released.
  const probe = canvas.ownerDocument?.createElement('canvas');
  if (probe) {
    try {
      const gl = probe.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
      capabilities.webgl2.available = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* The primary WebGPU path can remain available. */ }
  }
  let adapter = null;
  if (preferredBackend !== 'webgl2' && navigator.gpu) {
    try {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      capabilities.webgpu.adapterAvailable = Boolean(adapter);
      if (adapter) {
        let info = adapter.info;
        if (!info && adapter.requestAdapterInfo) info = await adapter.requestAdapterInfo();
        capabilities.webgpu.adapterInfo = {};
        for (const key of ['vendor', 'architecture', 'device', 'description']) {
          if (info?.[key]) capabilities.webgpu.adapterInfo[key] = String(info[key]);
        }
        capabilities.webgpu.adapterInfo.isFallbackAdapter = info?.isFallbackAdapter === true || adapter.isFallbackAdapter === true;
        capabilities.webgpu.features = Array.from(adapter.features || []);
      }
    } catch (error) {
      warnings.push(`WebGPU no pudo obtener un adaptador: ${error?.message || 'no disponible'}.`);
    }
  }
  capabilities.refreshRateHz = await refreshRate;
  return { adapter, capabilities };
}

/**
 * Startup fallback is isolated so a failed GPU initialization can never reuse a
 * canvas whose context type has already been fixed. Listeners belong on the
 * returned canvas after this promise resolves.
 */
export async function initializeWithFallback({ canvas, tryWebGPU, createWebGL, onWarning = () => {} }) {
  if (tryWebGPU) {
    try {
      const result = await tryWebGPU(canvas);
      return { ...result, canvas, backend: 'webgpu' };
    } catch (error) {
      onWarning(error);
      const replacement = canvas.cloneNode(false);
      replacement.width = canvas.width;
      replacement.height = canvas.height;
      canvas.replaceWith(replacement);
      canvas = replacement;
    }
  }
  const result = await createWebGL(canvas);
  return { ...result, canvas, backend: 'webgl2' };
}

function configureRenderer(renderer) {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.info.autoReset = false;
}

/**
 * Both backends are bundled into the exported HTML. No runtime imports, CDNs,
 * remote texture fetches, or native dependencies are used by this module.
 */
export async function createRenderRuntime({ canvas, onProgress, preferredBackend = 'auto' }) {
  if (!canvas?.getContext || !canvas?.cloneNode) throw new TypeError('Se requiere un canvas HTML válido.');
  if (!['auto', 'webgpu', 'webgl2'].includes(preferredBackend)) throw new RangeError('Backend gráfico desconocido.');
  const warnings = [];
  const { adapter, capabilities } = await preflight(canvas, preferredBackend, onProgress, warnings);
  let glDetails = null;
  const initialized = await initializeWithFallback({
    canvas,
    tryWebGPU: adapter ? async gpuCanvas => {
      let device;
      let renderer;
      let scopeOpen = false;
      try {
        onProgress?.(12, 'Inicializando WebGPU y verificando el dispositivo...');
        const requiredFeatures = DEVICE_FEATURES.filter(feature => adapter.features.has(feature));
        device = await adapter.requestDevice({ requiredFeatures });
        device.pushErrorScope('validation');
        scopeOpen = true;
        renderer = new WebGPURenderer({ canvas: gpuCanvas, device, alpha: false, antialias: false, trackTimestamp: device.features.has('timestamp-query') });
        await renderer.init();
        if (!renderer.backend.isWebGPUBackend) throw new Error('El backend WebGPU no pudo inicializarse.');
        configureRenderer(renderer);
        renderer.setSize(1, 1, false);
        // Verify a submitted canvas clear before compiling any material shaders.
        // A driver can return a valid adapter/device and still fail submission.
        const context = renderer.backend.context;
        const encoder = device.createCommandEncoder();
        const clearPass = encoder.beginRenderPass({ colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store'
        }] });
        clearPass.end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        const validationError = await device.popErrorScope();
        scopeOpen = false;
        if (validationError) throw new Error(validationError.message);
        capabilities.webgpu.initialized = true;
        capabilities.webgpu.compatibilityMode = renderer.backend.compatibilityMode;
        capabilities.webgpu.enabledFeatures = Array.from(device.features);
        capabilities.rendererName = Object.values(capabilities.webgpu.adapterInfo || {}).filter(value => typeof value === 'string').join(' ') || 'WebGPU adapter (identity unavailable)';
        capabilities.limits = {
          maxTextureSize: readLimit(device.limits, 'maxTextureDimension2D'),
          maxCubeTextureSize: readLimit(device.limits, 'maxTextureDimension2D'),
          maxAnisotropy: renderer.getMaxAnisotropy(),
          maxBufferSize: readLimit(device.limits, 'maxBufferSize'),
          maxUniformBufferSize: readLimit(device.limits, 'maxUniformBufferBindingSize'),
          maxStorageBufferSize: readLimit(device.limits, 'maxStorageBufferBindingSize'),
          maxSamples: renderer.backend.compatibilityMode ? 0 : 4
        };
        capabilities.textureCompression = {
          bc: device.features.has('texture-compression-bc'),
          astc: device.features.has('texture-compression-astc'),
          etc2: device.features.has('texture-compression-etc2')
        };
        capabilities.hdr = true;
        capabilities.hdrFormat = 'RGBA16F';
        capabilities.gpuTimingSupported = renderer.backend.trackTimestamp === true;
        return { renderer };
      } catch (error) {
        if (scopeOpen) { try { await device.popErrorScope(); } catch {} }
        // Await disposal before returning to the fallback; a late init cannot
        // claim the new canvas because every renderer owns a different element.
        // r186 dispose() retries init through setAnimationLoop on uninitialized
        // renderers. Do not invoke that path after a rejected initialization.
        try { if (renderer?.hasInitialized()) await renderer.dispose(); } catch {}
        device?.destroy();
        throw error;
      }
    } : null,
    createWebGL: async glCanvas => {
      onProgress?.(16, 'Inicializando la ruta compatible WebGL 2...');
      const context = glCanvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      if (!context) throw new Error('No se pudo activar WebGPU ni WebGL 2. Habilitá la aceleración gráfica o probá otro navegador moderno.');
      glDetails = readWebGLLimits(context);
      const renderer = new WebGLRenderer({ canvas: glCanvas, context, alpha: false, antialias: false });
      configureRenderer(renderer);
      capabilities.webgl2.available = true;
      capabilities.webgl2.initialized = true;
      capabilities.rendererName = glDetails.rendererName;
      capabilities.limits = glDetails.limits;
      capabilities.textureCompression = glDetails.textureCompression;
      capabilities.hdr = glDetails.hdr;
      capabilities.hdrFormat = glDetails.hdr ? 'RGBA16F' : 'RGBA8';
      capabilities.gpuTimingSupported = Boolean(glDetails.timerExtension);
      if (!glDetails.hdr) warnings.push('Este dispositivo usa buffers SDR; bloom y oclusión de pantalla están desactivados.');
      return { renderer };
    },
    onWarning: error => warnings.push(`WebGPU no pudo inicializarse; se activó WebGL 2: ${error?.message || 'error del dispositivo'}.`)
  });
  const { renderer, backend } = initialized;
  capabilities.backend = backend;
  Object.assign(capabilities, estimateDeviceProfile({
    rendererName: capabilities.rendererName,
    adapterInfo: backend === 'webgpu' ? capabilities.webgpu.adapterInfo : {},
    mobile: capabilities.mobile,
    systemMemoryGB: capabilities.systemMemoryGB
  }));
  const runtime = {
    ...initialized,
    capabilities,
    warnings,
    get gpuTimingSupported() { return capabilities.gpuTimingSupported; },
    createPipeline(scene, camera) {
      return backend === 'webgpu'
        ? createWebGPUPipeline(renderer, scene, camera, capabilities, warnings)
        : createWebGLPipeline(renderer, scene, camera, capabilities, glDetails);
    },
    async createEnvironment(environmentScene) {
      if (!capabilities.hdr) return { texture: null, dispose() {} };
      const generator = backend === 'webgpu' ? new WebGPUPMREMGenerator(renderer) : new WebGLPMREMGenerator(renderer);
      let target;
      try {
        target = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: capabilities.softwareRendering ? 64 : 128 });
        if (backend === 'webgpu') await renderer.backend.device.queue.onSubmittedWorkDone();
      } catch (error) {
        target?.dispose();
        throw error;
      } finally {
        generator.dispose();
      }
      let disposed = false;
      return { texture: target.texture, dispose() { if (!disposed) { disposed = true; target.dispose(); } } };
    }
  };
  return runtime;
}

/** Real elapsed GPU queries. Results remain null until a valid query completes. */
export function createWebGLTimer(gl, extension) {
  if (!extension) return null;
  const slots = Array.from({ length: 4 }, () => ({ query: gl.createQuery(), pending: false }));
  let active = null;
  let frame = 0;
  let next = 0;
  let disposed = false;
  let latest = null;
  let updated = 0;
  let sequence = 0;
  let latestSequence = 0;
  function poll() {
    if (disposed || gl.isContextLost()) { latest = null; return; }
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
    for (const slot of slots) {
      if (!slot.pending) continue;
      if (disjoint) { slot.pending = false; continue; }
      if (gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) {
        const elapsed = gl.getQueryParameter(slot.query, gl.QUERY_RESULT) / 1e6;
        if (slot.sequence > latestSequence && Number.isFinite(elapsed) && elapsed > 0) {
          latest = elapsed;
          latestSequence = slot.sequence;
          updated = timestamp();
        }
        slot.pending = false;
      }
    }
    if (disjoint) latest = null;
  }
  return {
    get milliseconds() { return timestamp() - updated < 2500 ? latest : null; },
    begin() {
      poll();
      if (disposed || active || gl.isContextLost() || ++frame % 4) return;
      const slot = slots[next];
      if (!slot.query || slot.pending) return;
      gl.beginQuery(extension.TIME_ELAPSED_EXT, slot.query);
      slot.sequence = ++sequence;
      active = slot;
    },
    end() {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      active.pending = true;
      active = null;
      next = (next + 1) % slots.length;
    },
    dispose() {
      if (disposed) return;
      if (active) { try { gl.endQuery(extension.TIME_ELAPSED_EXT); } catch {} active = null; }
      disposed = true;
      latest = null;
      for (const slot of slots) if (slot.query) gl.deleteQuery(slot.query);
    }
  };
}

function createWebGPUTimer(renderer, capabilities, warnings) {
  if (!capabilities.gpuTimingSupported) return null;
  let pending = false;
  let disposed = false;
  let latest = null;
  let updated = 0;
  return {
    get milliseconds() { return timestamp() - updated < 2500 ? latest : null; },
    end() {
      if (pending || disposed || !capabilities.gpuTimingSupported) return;
      pending = true;
      renderer.resolveTimestampsAsync('render').then(value => {
        if (!disposed && Number.isFinite(value) && value > 0) { latest = value; updated = timestamp(); }
      }).catch(() => {
        latest = null;
        capabilities.gpuTimingSupported = false;
        warnings.push('El dispositivo dejó de proporcionar tiempos GPU válidos.');
      }).finally(() => { pending = false; });
    },
    dispose() { disposed = true; latest = null; }
  };
}

function getStats(renderer, backend) {
  const info = renderer.info;
  return {
    drawCalls: backend === 'webgpu' ? info.render.drawCalls : info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: backend === 'webgpu' ? info.memory.programs : info.programs?.length ?? null,
    textureBytes: backend === 'webgpu' ? info.memory.texturesSize : null
  };
}

function normalizeQuality(quality, previous, capabilities) {
  return {
    bloom: (quality.bloom ?? previous.bloom) === true && capabilities.hdr,
    ao: (quality.ao ?? previous.ao) === true && capabilities.hdr,
    samples: finite(quality.samples, previous.samples)
  };
}

function createWebGLPipeline(renderer, scene, camera, capabilities, details) {
  const target = new WebGLRenderTarget(1, 1, { type: capabilities.hdr ? HalfFloatType : UnsignedByteType, samples: 0 });
  target.texture.name = 'EVA linear scene';
  const composer = new EffectComposer(renderer, target);
  const scenePass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.2, 0.55, 1.15);
  const outputPass = new OutputPass();
  const fxaaPass = new ShaderPass(FXAAShader);
  let aoPass = null;
  let quality = normalizeQuality(DEFAULT_QUALITY, DEFAULT_QUALITY, capabilities);
  let samples = 0;
  let disposed = false;
  let pixelWidth = 1;
  let pixelHeight = 1;
  const timer = createWebGLTimer(renderer.getContext(), details.timerExtension);
  composer.addPass(scenePass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  // FXAA explicitly follows tone mapping: it expects display-referred colors.
  composer.addPass(fxaaPass);
  function configure() {
    const selected = selectMSAASamples(quality.samples, details.sampleCounts);
    if (selected !== samples) {
      samples = selected;
      for (const buffer of [composer.renderTarget1, composer.renderTarget2]) {
        buffer.samples = samples;
        buffer.dispose();
      }
    }
    if (quality.ao && !aoPass) {
      aoPass = new GTAOPass(scene, camera, 1, 1, undefined,
        { radius: 0.55, thickness: 0.5, distanceExponent: 1.5, distanceFallOff: 1, scale: 0.7, samples: 12, screenSpaceRadius: false },
        { radius: 3, samples: 8, rings: 2, lumaPhi: 8, depthPhi: 2, normalPhi: 3 });
      aoPass.blendIntensity = 0.38;
      // Keep the denoised AO at half resolution even when the composer resizes.
      const resizeAO = aoPass.setSize.bind(aoPass);
      aoPass.setSize = (width, height) => resizeAO(Math.max(1, Math.round(width * 0.5)), Math.max(1, Math.round(height * 0.5)));
      composer.insertPass(aoPass, 1);
    }
    if (aoPass) aoPass.enabled = quality.ao;
    bloomPass.enabled = quality.bloom;
    fxaaPass.enabled = samples === 0;
    fxaaPass.material.uniforms.resolution.value.set(1 / pixelWidth, 1 / pixelHeight);
  }
  configure();
  return {
    get bloomActive() { return bloomPass.enabled; },
    get aoActive() { return aoPass?.enabled === true; },
    get samples() { return samples; },
    get hdr() { return capabilities.hdr; },
    get aaMethod() { return samples ? `MSAA ${samples}×` : 'FXAA'; },
    get gpuTimeMs() { return timer?.milliseconds ?? null; },
    getStats: () => getStats(renderer, 'webgl2'),
    render() {
      if (disposed) return;
      renderer.info.reset();
      timer?.begin();
      try { composer.render(); } finally { timer?.end(); }
    },
    resize(width, height, dpr = 1) {
      const ratio = clamp(finite(dpr, 1), 0.1, 4);
      width = Math.max(1, finite(width, 1));
      height = Math.max(1, finite(height, 1));
      pixelWidth = Math.max(1, Math.floor(width * ratio));
      pixelHeight = Math.max(1, Math.floor(height * ratio));
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      fxaaPass.material.uniforms.resolution.value.set(1 / pixelWidth, 1 / pixelHeight);
    },
    setQuality(next) { quality = normalizeQuality(next, quality, capabilities); configure(); },
    setBloomStrength(value) { bloomPass.strength = clamp(finite(value, 0.2), 0, 1.2); },
    async warmup() { await renderer.compileAsync(scene, camera); this.render(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      timer?.dispose();
      scenePass.dispose();
      bloomPass.dispose();
      outputPass.dispose();
      fxaaPass.dispose();
      if (aoPass) {
        aoPass.dispose();
        // r186 GTAOPass.dispose does not dispose these two owned materials.
        aoPass.gtaoMaterial.dispose();
        aoPass.blendMaterial.dispose();
      }
      composer.dispose();
    }
  };
}

function createWebGPUPipeline(renderer, scene, camera, capabilities, warnings) {
  const scenePass = pass(scene, camera, { samples: 0, type: HalfFloatType });
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const bloomPass = bloom(color, 0.2, 0.55, 1.15);
  bloomPass.setResolutionScale(0.5);
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  let aoPass = null;
  let denoisePass = null;
  let filteredAO = null;
  let displayTexture = null;
  let antialiasing = null;
  let quality = { ...DEFAULT_QUALITY };
  let samples = 0;
  let disposed = false;
  const timer = createWebGPUTimer(renderer, capabilities, warnings);
  function configure() {
    // r186 GTAO gathers sampleable depth. Multisampled depth cannot be gathered;
    // AO therefore uses spatial FXAA, not a falsely advertised MSAA/TAA route.
    const selected = quality.ao ? 0 : selectMSAASamples(quality.samples, capabilities.limits.maxSamples ? [0, 4] : [0]);
    if (samples !== selected) {
      samples = selected;
      scenePass.options.samples = samples;
      scenePass.renderTarget.samples = samples;
      scenePass.renderTarget.dispose();
    }
    let radiance = color.rgb;
    if (quality.ao) {
      if (!aoPass) {
        aoPass = ao(depth, null, camera);
        aoPass.resolutionScale = 0.5;
        aoPass.radius.value = 0.55;
        aoPass.samples.value = 12;
        aoPass.scale.value = 0.7;
        aoPass.useTemporalFiltering = false;
        denoisePass = denoise(aoPass.getTextureNode(), depth, null, camera);
        denoisePass.radius.value = 3;
        filteredAO = rtt(denoisePass, null, null, { resolutionScale: 0.5, depthBuffer: false });
      }
      // Small post-lighting contact cue. This is not indirect-light-only GI.
      radiance = radiance.mul(mix(1, filteredAO.r, 0.38));
    }
    if (quality.bloom) radiance = radiance.add(bloomPass.rgb);
    const display = renderOutput(vec4(radiance, color.a));
    antialiasing?.dispose();
    displayTexture?.dispose();
    displayTexture = null;
    antialiasing = null;
    if (samples === 0) {
      // Own the RTT explicitly; FXAA would otherwise create a hidden input RTT.
      displayTexture = rtt(display, null, null, { depthBuffer: false, type: UnsignedByteType });
      antialiasing = fxaa(displayTexture);
    }
    pipeline.outputNode = antialiasing || display;
    pipeline.needsUpdate = true;
  }
  configure();
  return {
    get bloomActive() { return quality.bloom; },
    get aoActive() { return quality.ao; },
    get samples() { return samples; },
    get hdr() { return true; },
    get aaMethod() { return samples ? `MSAA ${samples}×` : 'FXAA'; },
    get gpuTimeMs() { return timer?.milliseconds ?? null; },
    getStats: () => getStats(renderer, 'webgpu'),
    render() {
      if (disposed) return;
      renderer.info.reset();
      pipeline.render();
      timer?.end();
    },
    resize(width, height, dpr = 1) {
      const ratio = clamp(finite(dpr, 1), 0.1, 4);
      renderer.setPixelRatio(ratio);
      renderer.setSize(Math.max(1, finite(width, 1)), Math.max(1, finite(height, 1)), false);
    },
    setQuality(next) {
      const normalized = normalizeQuality(next, quality, capabilities);
      if (normalized.bloom === quality.bloom && normalized.ao === quality.ao && normalized.samples === quality.samples) return;
      quality = normalized;
      configure();
    },
    setBloomStrength(value) { bloomPass.strength.value = clamp(finite(value, 0.2), 0, 1.2); },
    async warmup() {
      const device = renderer.backend.device;
      device.pushErrorScope('validation');
      try {
        await scenePass.compileAsync(renderer);
        this.render();
        await device.queue.onSubmittedWorkDone();
      } finally {
        const error = await device.popErrorScope();
        if (error) throw new Error(`Error al preparar shaders WebGPU: ${error.message}`);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timer?.dispose();
      pipeline.dispose();
      antialiasing?.dispose();
      displayTexture?.dispose();
      bloomPass.dispose();
      aoPass?.dispose();
      denoisePass?.dispose();
      filteredAO?.dispose();
      scenePass.dispose();
    }
  };
}
