import { createFaceDetector } from '../vendor/face-detector.js';

/**
 * Fully local frontal-face tracking using the bundled MIT-licensed pico.js
 * runtime and PICO facefinder cascade. No network, identity recognition, native
 * FaceDetector dependency, landmarks, or inferred rotations are involved.
 *
 * Constructor: new FaceTracker({ video?, canvas?, onState?, onPose? })
 * start(): Promise<boolean> — the ONLY method requesting camera permission.
 * stop(): void — also cancels a pending start and closes late-arriving streams.
 * calibrate(): boolean — stores the current face center and apparent size.
 * setMirror(boolean): boolean — mirrors preview and horizontal movement.
 * state: idle | starting | searching | tracking | lost | error
 * running: boolean — true while requesting or using the camera.
 *
 * onState({state,message}) uses Spanish user-facing messages.
 * onPose({x,y,z,confidence,box}): x/y/z are clamped to [-1,1]. x is positive
 * toward the RIGHT of the preview; y is positive UP; z is positive CLOSER.
 * The default mirrored preview therefore behaves like a mirror. z is only a
 * relative distance proxy from face size, not a metric depth measurement.
 * confidence is a smoothed heuristic (0..1), not a calibrated probability.
 * box = {x,y,width,height,cx,cy}, normalized to the displayed preview, or null.
 * Canvas, if supplied, is the complete mirrored video preview with an oval;
 * do not apply another CSS mirror to it. The source video can remain hidden.
 */

export const FACE_TRACKER_TECHNOLOGY = 'Pico · centro y tamaño del rostro · 100 % local';

const INPUT_SIZE = 224;
const FRAME_INTERVAL = 1000 / 15;
const ACQUIRE_QUALITY = 28;
const RETAIN_QUALITY = 16;
const LOST_AFTER = 500;
const CONFIRM_FRAMES = 3;
const MAX_CADENCE = 1000;
const PAUSE_AFTER = 2500;

const clamp = (value, min = -1, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;
const alpha = (dt, timeConstant) => 1 - Math.exp(-dt / timeConstant);
const deadzone = (v, threshold = 0.024) =>
  Math.abs(v) <= threshold ? 0 : Math.sign(v) * (Math.abs(v) - threshold) / (1 - threshold);
const emptyPose = () => ({ x: 0, y: 0, z: 0, confidence: 0, box: null });

function safeCallback(callback, value) {
  if (typeof callback !== 'function') return;
  try { callback(value); }
  catch (error) { console.error('FaceTracker callback:', error); }
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* The device may already have disappeared. */ }
  }
}

function abortError() {
  return new DOMException('Camera start cancelled', 'AbortError');
}

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'La cámara está bloqueada. Permite el acceso en el navegador y vuelve a pulsar «Activar cámara».';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No se encontró una cámara. Conecta una webcam y vuelve a intentarlo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'No se puede leer la cámara. Cierra otras aplicaciones que la estén usando y vuelve a intentarlo.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'La cámara no admite este formato. Prueba otra webcam o un navegador compatible.';
    case 'SecurityError':
      return 'El navegador bloquea la cámara en esta página. Abre el HTML descargado directamente o úsalo desde localhost/HTTPS.';
    case 'NotSupportedError':
      return 'Este navegador no ofrece acceso a la cámara. Abre el archivo en una versión reciente de Chrome, Firefox, Edge o Safari.';
    default:
      return 'No se pudo iniciar el seguimiento. Comprueba la cámara y vuelve a intentarlo.';
  }
}

/** Resolve when an actual decoded video frame is available; always clean up. */
function playVideo(video, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('resize', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const ready = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const failed = () => finish(new DOMException('Camera video unavailable', 'NotReadableError'));
    const cancelled = () => finish(abortError());
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('resize', ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    timer = setTimeout(failed, 12000);
    if (signal.aborted) { cancelled(); return; }
    try {
      Promise.resolve(video.play()).then(ready, finish);
      ready();
    } catch (error) { finish(error); }
  });
}

export class FaceTracker {
  constructor({ video, canvas = null, onState, onPose } = {}) {
    this.video = video || document.createElement('video');
    this.canvas = canvas;
    this.onState = onState;
    this.onPose = onPose;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    this._input = document.createElement('canvas');
    this._ctx = this._input.getContext('2d', { willReadFrequently: true, alpha: false });
    this._preview = canvas?.getContext('2d', { alpha: false }) || null;
    this._state = 'idle';
    this._message = 'Cámara apagada';
    this._running = false;
    this._mirror = true;
    this._session = 0;
    this._raf = 0;
    this._stream = null;
    this._startPromise = null;
    this._abort = null;
    this._trackListeners = [];
    this._detector = null;
    this._resetTracking();
    this._pagehide = () => this.stop();
    window.addEventListener('pagehide', this._pagehide);
    this._clearPreview();
  }

  get state() { return this._state; }
  get running() { return this._running; }

  /** Camera permission is requested here, only after the host calls start(). */
  async start() {
    if (this._running) return this._startPromise || true;
    const session = ++this._session;
    this._running = true;
    const controller = new AbortController();
    this._abort = controller;
    this._resetTracking();
    this._setState('starting', 'Esperando permiso para usar la cámara…');
    this._emitPose();
    const pending = this._open(session, controller.signal);
    if (this._isCurrent(session)) this._startPromise = pending;
    return pending;
  }

  async _open(session, signal) {
    let stream = null;
    try {
      if (!this._isCurrent(session) || signal.aborted) return false;
      if (globalThis.isSecureContext === false) {
        throw new DOMException('Secure context required', 'SecurityError');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera API unavailable', 'NotSupportedError');
      }
      if (!this._ctx) throw new Error('Canvas unavailable');
      this._detector ||= createFaceDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      // getUserMedia cannot itself be aborted. A cancelled permission prompt
      // may still resolve later, so those late streams must be stopped here.
      if (!this._isCurrent(session) || signal.aborted) {
        stopStream(stream);
        return false;
      }
      this._stream = stream;
      for (const track of stream.getVideoTracks()) {
        const ended = () => {
          if (this._isCurrent(session)) {
            this._fail(new DOMException('Camera disconnected', 'NotReadableError'));
          }
        };
        track.addEventListener('ended', ended);
        this._trackListeners.push([track, ended]);
      }
      this.video.srcObject = stream;
      await playVideo(this.video, signal);
      if (!this._isCurrent(session) || signal.aborted) {
        stopStream(stream);
        return false;
      }
      this._configureFrame();
      this._searchStarted = performance.now();
      this._setState('searching', 'Buscando tu rostro… Mira a la cámara, con luz frontal.');
      if (this._isCurrent(session)) this._schedule(session);
      return this._isCurrent(session);
    } catch (error) {
      if (!this._isCurrent(session) || signal.aborted) {
        stopStream(stream);
        return false;
      }
      this._fail(error);
      return false;
    } finally {
      if (this._session === session) this._startPromise = null;
    }
  }

  stop() {
    ++this._session;
    this._releaseCamera();
    this._resetTracking();
    this._setState('idle', 'Cámara apagada');
    this._emitPose();
    this._clearPreview();
  }

  /** Optional host cleanup if the tracker instance is permanently discarded. */
  dispose() {
    this.stop();
    window.removeEventListener('pagehide', this._pagehide);
  }

  calibrate() {
    if (this._state !== 'tracking' || !this._smooth || performance.now() - this._lastSeen > this._calibrationWindow()) {
      this._setState(this._state, this._running
        ? 'Espera a que se detecte tu rostro para guardar el centro.'
        : 'Activa la cámara para centrar el seguimiento.');
      return false;
    }
    this._baseline = { ...this._smooth };
    this._pose.x = this._pose.y = this._pose.z = 0;
    this._statusUntil = performance.now() + 1700;
    this._setState('tracking', 'Centro guardado. Mueve la cabeza suavemente.');
    this._emitPose();
    return true;
  }

  setMirror(value) {
    const mirror = Boolean(value);
    if (mirror !== this._mirror) {
      this._mirror = mirror;
      this._pose.x *= -1;
      this._pose.box = this._smooth && this._state === 'tracking' ? this._box(this._smooth) : null;
      this._emitPose();
      this._drawPreview(performance.now());
    }
    return this._mirror;
  }

  _isCurrent(session) { return this._running && this._session === session; }

  _setState(state, message) {
    if (state === this._state && message === this._message) return;
    this._state = state;
    this._message = message;
    safeCallback(this.onState, { state, message });
  }

  _emitPose() {
    safeCallback(this.onPose, {
      ...this._pose,
      box: this._pose.box ? { ...this._pose.box } : null,
    });
  }

  _releaseCamera() {
    this._running = false;
    this._abort?.abort();
    this._abort = null;
    this._startPromise = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const [track, listener] of this._trackListeners) track.removeEventListener('ended', listener);
    this._trackListeners.length = 0;
    stopStream(this._stream);
    this._stream = null;
    try { this.video.pause(); } catch { /* A detached video may already be idle. */ }
    this.video.srcObject = null;
  }

  _fail(error) {
    ++this._session;
    this._releaseCamera();
    this._resetTracking();
    this._setState('error', cameraErrorMessage(error));
    this._emitPose();
    this._clearPreview();
  }

  _resetTracking() {
    this._lastFrame = -Infinity;
    this._lastObservation = -Infinity;
    this._cadence = FRAME_INTERVAL;
    this._lastVideoTime = -1;
    this._lastSeen = -Infinity;
    this._searchStarted = 0;
    this._candidate = null;
    this._lastDetection = null;
    this._smooth = null;
    this._baseline = null;
    this._pose = emptyPose();
    this._statusUntil = 0;
  }

  _configureFrame() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    this._videoDimensions = `${vw}x${vh}`;
    const scale = INPUT_SIZE / Math.max(vw, vh);
    this._width = Math.max(24, Math.round(vw * scale));
    this._height = Math.max(24, Math.round(vh * scale));
    this._input.width = this._width;
    this._input.height = this._height;
    this._gray = new Uint8Array(this._width * this._height);
    if (this.canvas) {
      this.canvas.width = Math.round(this._width * 1.5);
      this.canvas.height = Math.round(this._height * 1.5);
    }
  }

  _schedule(session) {
    this._raf = requestAnimationFrame((now) => this._frame(now, session));
  }

  _frame(now, session) {
    if (!this._isCurrent(session)) return;
    this._schedule(session);
    if (document.hidden || now - this._lastFrame < FRAME_INTERVAL) return;
    const dt = Number.isFinite(this._lastFrame) ? Math.max(16, now - this._lastFrame) : FRAME_INTERVAL;
    this._lastFrame = now;
    try {
      if (this.video.readyState < 2 || !this.video.videoWidth || this.video.currentTime === this._lastVideoTime) {
        this._miss(now, Math.min(dt, 1000));
        this._drawPreview(now);
        return;
      }
      this._lastVideoTime = this.video.currentTime;
      if (this._videoDimensions !== `${this.video.videoWidth}x${this.video.videoHeight}`) {
        // Rotation or a camera format change alters the coordinate system.
        this._resetTracking();
        this._searchStarted = now;
        this._configureFrame();
      }
      this._ctx.drawImage(this.video, 0, 0, this._width, this._height);
      const rgba = this._ctx.getImageData(0, 0, this._width, this._height).data;
      for (let i = 0, j = 0; i < this._gray.length; i++, j += 4) {
        this._gray[i] = (2 * rgba[j] + 7 * rgba[j + 1] + rgba[j + 2]) / 10;
      }
      this._processDetections(this._detector.detect(this._gray, this._width, this._height), now, dt);
      this._drawPreview(now);
    } catch (error) { this._fail(error); }
  }

  _processDetections(detections, now, dt = FRAME_INTERVAL) {
    this._observeCadence(now);
    const face = this._selectFace(detections, now);
    if (face) this._accept(face, now, clamp(dt, 16, 250));
    else this._miss(now, clamp(dt, 16, 1000));
  }

  _observeCadence(now) {
    const gap = now - this._lastObservation;
    this._lastObservation = now;
    if (!Number.isFinite(gap)) return;
    if (gap > PAUSE_AFTER) {
      // A suspended tab or long stall must not revive a partial confirmation.
      this._candidate = null;
      this._cadence = FRAME_INTERVAL;
      return;
    }
    const observed = clamp(gap, FRAME_INTERVAL, MAX_CADENCE);
    // Account for a delayed render immediately; relax back toward normal
    // cadence gradually. Timing grants another observation, never a face:
    // the same quality and spatial gates still apply to every candidate.
    this._cadence = Math.max(observed, mix(this._cadence, observed, 0.22));
  }

  _confirmationWindow() { return Math.max(260, this._cadence * 1.8); }
  _lossWindow() { return Math.max(LOST_AFTER, this._cadence * 2.2); }
  _calibrationWindow() { return Math.max(350, this._cadence * 1.5); }

  _selectFace(detections, now) {
    const faces = detections
      .filter(d => Number.isFinite(d.cx + d.cy + d.size + d.quality) && d.size > 0)
      .map(d => ({
        cx: d.cx / this._width,
        cy: d.cy / this._height,
        size: d.size / Math.min(this._width, this._height),
        quality: d.quality,
      }));

    const distance = (a, b) => {
      const dx = (a.cx - b.cx) * this._width;
      const dy = (a.cy - b.cy) * this._height;
      return Math.hypot(dx, dy) / (b.size * Math.min(this._width, this._height));
    };
    const consistent = (a, b, range = 0.72) =>
      distance(a, b) < range && a.size / b.size > 0.58 && a.size / b.size < 1.68;

    if (this._lastDetection && this._state !== 'lost' && now - this._lastSeen <= this._lossWindow()) {
      // While locked, continuity wins over a larger second person entering.
      // A single strong false positive elsewhere cannot jump the perspective.
      const matches = faces.filter(f => f.quality >= RETAIN_QUALITY && consistent(f, this._lastDetection));
      matches.sort((a, b) => {
        const cost = f => distance(f, this._lastDetection) +
          Math.abs(Math.log(f.size / this._lastDetection.size)) * 0.55 - Math.min(f.quality, 250) * 0.0005;
        return cost(a) - cost(b);
      });
      return matches[0] || null;
    }

    const credible = faces.filter(f => f.quality >= ACQUIRE_QUALITY);
    // Acquire the largest credible face. Score only breaks close-size ties.
    credible.sort((a, b) => b.size * (1 + Math.min(b.quality, 150) / 1000) -
      a.size * (1 + Math.min(a.quality, 150) / 1000));
    let chosen = credible[0];
    const confirmationWindow = this._confirmationWindow();
    if (!chosen) {
      if (this._candidate && now - this._candidate.seen > confirmationWindow) this._candidate = null;
      return null;
    }
    if (this._candidate && now - this._candidate.seen <= confirmationWindow) {
      const continuing = credible.find(f => consistent(f, this._candidate.face, 0.55));
      if (continuing) chosen = continuing;
    }
    if (this._candidate && consistent(chosen, this._candidate.face, 0.55) && now - this._candidate.seen <= confirmationWindow) {
      this._candidate.face = {
        cx: mix(this._candidate.face.cx, chosen.cx, 0.55),
        cy: mix(this._candidate.face.cy, chosen.cy, 0.55),
        size: mix(this._candidate.face.size, chosen.size, 0.55),
        quality: chosen.quality,
      };
      this._candidate.count++;
      this._candidate.seen = now;
    } else {
      this._candidate = { face: chosen, count: 1, seen: now };
    }
    if (this._candidate.count < CONFIRM_FRAMES) return null;
    const confirmed = this._candidate.face;
    this._candidate = null;
    return confirmed;
  }

  _accept(face, now, dt) {
    const wasLost = this._state === 'lost' || now - this._lastSeen > this._lossWindow();
    this._lastSeen = now;
    this._lastDetection = face;
    if (!this._smooth) this._smooth = { ...face };
    else {
      // Center responds faster than apparent scale, which is naturally noisier.
      this._smooth.cx = mix(this._smooth.cx, face.cx, alpha(dt, 105));
      this._smooth.cy = mix(this._smooth.cy, face.cy, alpha(dt, 125));
      this._smooth.size = mix(this._smooth.size, face.size, alpha(dt, 235));
      this._smooth.quality = face.quality;
    }
    if (!this._baseline) this._baseline = { ...this._smooth };
    const sx = this._mirror ? -1 : 1;
    const target = {
      x: deadzone(clamp(sx * (this._smooth.cx - this._baseline.cx) / 0.22)),
      y: deadzone(clamp((this._baseline.cy - this._smooth.cy) / 0.20)),
      z: deadzone(clamp(Math.log(this._smooth.size / this._baseline.size) / Math.log(1.7)), 0.035),
    };
    const response = alpha(dt, wasLost ? 230 : 65);
    this._pose.x = mix(this._pose.x, target.x, response);
    this._pose.y = mix(this._pose.y, target.y, response);
    this._pose.z = mix(this._pose.z, target.z, alpha(dt, 135));
    const confidence = clamp(1 - Math.exp(-face.quality / 65), 0, 1);
    this._pose.confidence = mix(this._pose.confidence, confidence, alpha(dt, 160));
    this._pose.box = this._box(this._smooth);
    if (now >= this._statusUntil || this._state !== 'tracking') {
      this._setState('tracking', 'Rostro detectado · seguimiento local');
    }
    this._emitPose();
  }

  _miss(now, dt) {
    this._pose.confidence *= Math.exp(-dt / 330);
    if (now - this._lastSeen > this._lossWindow()) {
      this._pose.box = null;
      const recenter = alpha(dt, 520);
      this._pose.x = mix(this._pose.x, 0, recenter);
      this._pose.y = mix(this._pose.y, 0, recenter);
      this._pose.z = mix(this._pose.z, 0, recenter);
      if (this._baseline) {
        this._setState('lost', 'He perdido el rostro. Mira de frente para recuperar el seguimiento.');
      } else {
        this._setState('searching', now - this._searchStarted > 5500
          ? 'No veo un rostro. Acércate un poco y procura tener luz frontal.'
          : 'Buscando tu rostro… Mira a la cámara, con luz frontal.');
      }
    }
    if (this._pose.confidence < 0.005) this._pose.confidence = 0;
    this._emitPose();
  }

  _box(face) {
    const side = Math.min(this._width, this._height);
    const width = face.size * side / this._width;
    const height = face.size * side / this._height;
    const cx = this._mirror ? 1 - face.cx : face.cx;
    const x = clamp(cx - width / 2, 0, 1);
    const y = clamp(face.cy - height / 2, 0, 1);
    return {
      x, y,
      width: Math.min(width, 1 - x),
      height: Math.min(height, 1 - y),
      cx, cy: face.cy,
    };
  }

  _clearPreview() {
    if (!this._preview) return;
    const ctx = this._preview;
    ctx.fillStyle = '#102025';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawPreview(now) {
    if (!this._preview || !this._running || this.video.readyState < 2) return;
    const ctx = this._preview;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    if (this._mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();
    ctx.save();
    const box = this._pose.box;
    if (box && now - this._lastSeen <= this._lossWindow()) {
      ctx.strokeStyle = '#94f1dc';
      ctx.lineWidth = 2;
      ctx.globalAlpha = clamp(this._pose.confidence + 0.35, 0.35, 1);
      ctx.beginPath();
      ctx.ellipse(box.cx * w, box.cy * h, box.width * w * 0.44, box.height * h * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // This dashed guide is fixed in the frame; it is never reported as a box.
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.48, Math.min(w * 0.20, h * 0.25), h * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
