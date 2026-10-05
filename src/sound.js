// A small, fully local soundscape. Nothing is created before a user gesture.
// The gain is deliberately conservative; muting also suspends the audio graph.
export class HangarSound {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.requestedEnabled = false;
    this.generation = 0;
  }

  async setEnabled(enabled) {
    this.requestedEnabled = Boolean(enabled);
    const generation = ++this.generation;
    if (!enabled) {
      this.enabled = false;
      if (this.context) {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setTargetAtTime(0, this.context.currentTime, .06);
        await this.context.suspend();
      }
      return false;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Este navegador no ofrece audio ambiental.');
    if (!this.context) this.build(new AudioContext());
    await this.context.resume();
    if (generation !== this.generation) {
      if (!this.requestedEnabled) await this.context.suspend();
      return this.enabled;
    }
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(.12, this.context.currentTime, .7);
    return true;
  }

  build(context) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 18;
    limiter.ratio.value = 8;
    this.master.connect(limiter);
    limiter.connect(context.destination);

    // Deep electrical fundamental with a quiet fifth: no recognizable music.
    for (const [frequency, level] of [[55,.22],[82.41,.07],[110.13,.04]]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = level;
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start();
    }
    const length = context.sampleRate * 4;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < length; index++) {
      brown = (brown + (Math.random()*2-1)*.025)/1.025;
      data[index] = brown;
    }
    const air = context.createBufferSource();
    air.buffer = buffer;
    air.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    const airGain = context.createGain();
    airGain.gain.value = .22;
    air.connect(filter);
    filter.connect(airGain);
    airGain.connect(this.master);
    air.start();
    const pulse = context.createOscillator();
    const pulseGain = context.createGain();
    pulse.frequency.value = .115;
    pulseGain.gain.value = .055;
    pulse.connect(pulseGain);
    pulseGain.connect(airGain.gain);
    pulse.start();
  }

  cue() {
    if (!this.enabled || this.context?.state !== 'running') return;
    const context = this.context;
    const start = context.currentTime;
    for (const [delay, frequency] of [[0,220],[.18,330],[.4,440]]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start + delay);
      oscillator.frequency.exponentialRampToValueAtTime(frequency*.5, start + delay + .7);
      gain.gain.setValueAtTime(0, start + delay);
      gain.gain.linearRampToValueAtTime(.12, start + delay + .04);
      gain.gain.exponentialRampToValueAtTime(.001, start + delay + .9);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start + delay);
      oscillator.stop(start + delay + 1);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }

  suspend() {
    this.enabled = false;
    this.requestedEnabled = false;
    ++this.generation;
    if (this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.value = 0;
      this.context.suspend().catch(() => {});
    }
  }
}
