// Procedural ambience with the Web Audio API. Nothing is downloaded: waves, rain, wind,
// birds, insects, chimes and pads are all synthesised. Audio starts only after a click.

const rand = (a, b) => a + Math.random() * (b - a);

function noiseBuffer(ctx, seconds, color) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
      } else d[i] = w * 0.5;
    }
  }
  return buf;
}

export class Ambience {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.wanted = [];
    this.layers = new Map();
    this.buffers = {};
  }

  _init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    // gentle glue: lowpass the whole mix a touch and add a short reverb-ish delay
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.ratio.value = 3;
    this.master.connect(this.comp).connect(this.ctx.destination);
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(2.6);
    this.verbGain = this.ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.buffers.white = noiseBuffer(this.ctx, 4, 'white');
    this.buffers.pink = noiseBuffer(this.ctx, 6, 'pink');
    this.buffers.brown = noiseBuffer(this.ctx, 6, 'brown');
  }

  _impulse(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }

  async enable() {
    this._init();
    if (!this.ctx) return false;
    await this.ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.8);
    this._sync();
    return true;
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => { if (!this.enabled) { for (const k of [...this.layers.keys()]) this._stop(k); } }, 1500);
  }

  /** Set the ambience layers by name, e.g. ['ocean', 'birds']. Crossfades. */
  set(names) {
    this.wanted = [...new Set(names || [])];
    if (this.enabled) this._sync();
  }

  _sync() {
    for (const k of [...this.layers.keys()]) if (!this.wanted.includes(k)) this._stop(k);
    for (const k of this.wanted) if (!this.layers.has(k) && LAYERS[k]) this._start(k);
  }

  _start(name) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.0; out.connect(send); send.connect(this.verb);
    const layer = { out, send, nodes: [], timers: [], alive: true };
    LAYERS[name](this, layer);
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    this.layers.set(name, layer);
  }

  _stop(name) {
    const layer = this.layers.get(name);
    if (!layer) return;
    layer.alive = false;
    for (const t of layer.timers) clearTimeout(t);
    const ctx = this.ctx;
    layer.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(() => { for (const n of layer.nodes) { try { n.stop?.(); } catch (e) {} try { n.disconnect(); } catch (e) {} } layer.out.disconnect(); }, 3000);
    this.layers.delete(name);
  }

  _noise(layer, color = 'pink') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[color];
    src.loop = true;
    src.start(0, Math.random() * 3);
    layer.nodes.push(src);
    return src;
  }

  _every(layer, minS, maxS, fn) {
    const tick = () => {
      if (!layer.alive) return;
      try { fn(); } catch (e) {}
      layer.timers.push(setTimeout(tick, rand(minS, maxS) * 1000));
    };
    layer.timers.push(setTimeout(tick, rand(0.2, maxS) * 1000));
  }

  _tone(dest, { type = 'sine', f0 = 440, f1 = null, t = 0, dur = 0.3, gain = 0.1, attack = 0.005, curve = 'exp' }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    else g.gain.linearRampToValueAtTime(0, now + dur);
    o.connect(g).connect(dest);
    o.start(now); o.stop(now + dur + 0.05);
  }

  /** One-shot effects: drop, splash, eat, chirp, chime, pop, tok */
  sfx(name) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const dest = ctx.createGain(); dest.gain.value = 0.8; dest.connect(this.master);
    const wet = ctx.createGain(); wet.gain.value = 0.25; dest.connect(wet).connect(this.verb);
    setTimeout(() => { dest.disconnect(); wet.disconnect(); }, 4000);
    switch (name) {
      case 'drop': this._tone(dest, { f0: 900, f1: 260, dur: 0.12, gain: 0.12 }); this._burst(dest, 1800, 0.05, 0.05); break;
      case 'splash': this._burst(dest, 1200, 0.35, 0.18); this._tone(dest, { f0: 600, f1: 180, dur: 0.15, gain: 0.08 }); break;
      case 'thud': this._burst(dest, 400, 0.08, 0.2); break;
      case 'eat': this._tone(dest, { f0: 240, f1: 620, dur: 0.09, gain: 0.12 }); this._tone(dest, { f0: 520, f1: 900, t: 0.07, dur: 0.07, gain: 0.05 }); break;
      case 'chirp': for (let i = 0; i < 3; i++) this._tone(dest, { f0: rand(2600, 3400), f1: rand(3800, 4600), t: i * 0.09, dur: 0.07, gain: 0.05 }); break;
      case 'chime': [880, 1318.5, 1760].forEach((f, i) => this._tone(dest, { f0: f, t: i * 0.06, dur: 2.2, gain: 0.05, attack: 0.01 })); break;
      case 'pop': this._tone(dest, { f0: 520, f1: 1200, dur: 0.06, gain: 0.08 }); break;
      case 'tok': this._tone(dest, { f0: 780, f1: 640, dur: 0.18, gain: 0.25 }); this._burst(dest, 2500, 0.02, 0.15); break;
      default: this._tone(dest, { f0: 660, dur: 0.1, gain: 0.05 });
    }
  }

  _burst(dest, freq, dur, gain) {
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.buffers.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(now, Math.random()); src.stop(now + dur + 0.02);
  }
}

const LAYERS = {
  underwater(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.3;
    const g = ctx.createGain(); g.gain.value = 0.55;
    n.connect(lp).connect(g).connect(L.out);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 120;
    lfo.connect(lg).connect(lp.frequency); lfo.start(); L.nodes.push(lfo);
    L.send.gain.value = 0.4;
    A._every(L, 0.8, 4, () => { const k = Math.floor(rand(1, 4)); for (let i = 0; i < k; i++) A._tone(L.out, { f0: rand(260, 420), f1: rand(700, 1300), t: i * rand(0.05, 0.15), dur: 0.07, gain: 0.03 }); });
  },
  ocean(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'pink');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g = ctx.createGain(); g.gain.value = 0.15;
    n.connect(lp).connect(g).connect(L.out);
    L.send.gain.value = 0.2;
    A._every(L, 6, 10, () => {
      const t = ctx.currentTime, up = rand(2.2, 3.4), down = rand(3.5, 5.5), peak = rand(0.35, 0.6);
      g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(peak, t, up / 3); g.gain.setTargetAtTime(0.12, t + up, down / 3);
      lp.frequency.cancelScheduledValues(t); lp.frequency.setTargetAtTime(rand(1400, 2200), t, up / 3); lp.frequency.setTargetAtTime(500, t + up, down / 3);
    });
  },
  wind(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'pink');
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.18;
    n.connect(bp).connect(g).connect(L.out);
    A._every(L, 2, 5, () => { const t = ctx.currentTime; bp.frequency.setTargetAtTime(rand(300, 900), t, 1.5); g.gain.setTargetAtTime(rand(0.08, 0.3), t, 1.8); });
  },
  rain(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'white');
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const g = ctx.createGain(); g.gain.value = 0.16;
    n.connect(hp).connect(lp).connect(g).connect(L.out);
    const n2 = A._noise(L, 'brown'); const g2 = ctx.createGain(); g2.gain.value = 0.25; n2.connect(g2).connect(L.out);
    A._every(L, 0.05, 0.4, () => A._burst(L.out, rand(2500, 5000), 0.015, rand(0.02, 0.06)));
  },
  stream(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'pink');
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.22;
    n.connect(bp).connect(g).connect(L.out);
    A._every(L, 0.08, 0.35, () => A._tone(L.out, { f0: rand(900, 2200), f1: rand(1500, 3200), dur: rand(0.03, 0.08), gain: rand(0.006, 0.02) }));
  },
  waterfall(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'pink');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.value = 0.32;
    n.connect(lp).connect(g).connect(L.out);
    const n2 = A._noise(L, 'brown'); const g2 = ctx.createGain(); g2.gain.value = 0.35; n2.connect(g2).connect(L.out);
  },
  birds(A, L) {
    L.send.gain.value = 0.3;
    A._every(L, 2.5, 8, () => {
      const kind = Math.floor(rand(0, 3));
      if (kind === 0) for (let i = 0, k = Math.floor(rand(2, 5)); i < k; i++) A._tone(L.out, { f0: rand(2800, 3600), f1: rand(4000, 5200), t: i * rand(0.08, 0.14), dur: 0.06, gain: 0.03 });
      else if (kind === 1) { A._tone(L.out, { f0: 2200, f1: 3400, dur: 0.18, gain: 0.03 }); A._tone(L.out, { f0: 3300, f1: 2100, t: 0.22, dur: 0.22, gain: 0.025 }); }
      else for (let i = 0; i < 6; i++) A._tone(L.out, { f0: 4200 + (i % 2) * 400, t: i * 0.05, dur: 0.035, gain: 0.018 });
    });
  },
  gulls(A, L) {
    L.send.gain.value = 0.5;
    A._every(L, 5, 14, () => { for (let i = 0, k = Math.floor(rand(1, 4)); i < k; i++) A._tone(L.out, { type: 'sawtooth', f0: rand(1300, 1600), f1: rand(900, 1100), t: i * 0.28, dur: 0.24, gain: 0.012 }); });
  },
  insects(A, L) {
    A._every(L, 0.35, 0.9, () => {
      const f = rand(4200, 4800);
      for (let i = 0; i < 3; i++) A._tone(L.out, { f0: f, t: i * 0.045, dur: 0.03, gain: 0.008 });
    });
  },
  frogs(A, L) {
    L.send.gain.value = 0.4;
    A._every(L, 1.5, 6, () => { const f = rand(140, 260); for (let i = 0, k = Math.floor(rand(2, 5)); i < k; i++) A._tone(L.out, { type: 'square', f0: f, f1: f * 0.8, t: i * 0.12, dur: 0.08, gain: 0.01 }); });
  },
  chimes(A, L) {
    L.send.gain.value = 0.7;
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
    A._every(L, 3, 9, () => { for (let i = 0, k = Math.floor(rand(1, 4)); i < k; i++) { const f = scale[Math.floor(rand(0, scale.length))]; A._tone(L.out, { type: 'sine', f0: f, t: i * rand(0.1, 0.4), dur: rand(2.5, 4.5), gain: 0.025, attack: 0.004 }); A._tone(L.out, { type: 'sine', f0: f * 2.76, t: i * 0.2, dur: 1.2, gain: 0.006 }); } });
  },
  pad(A, L) {
    const ctx = A.ctx;
    L.send.gain.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = ctx.createGain(); g.gain.value = 0.05; lp.connect(g).connect(L.out);
    const chords = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 392]];
    let ci = 0;
    const play = () => {
      if (!L.alive) return;
      const now = ctx.currentTime;
      for (const f of chords[ci % chords.length]) {
        for (const det of [-4, 4]) {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
          og.gain.setValueAtTime(0, now); og.gain.linearRampToValueAtTime(0.18, now + 4); og.gain.linearRampToValueAtTime(0, now + 11);
          o.connect(og).connect(lp); o.start(now); o.stop(now + 11.2);
        }
      }
      ci++;
      L.timers.push(setTimeout(play, 8000));
    };
    play();
    A._every(L, 1.5, 4, () => A._tone(L.out, { f0: [1567.98, 1760, 2093, 2349.3][Math.floor(rand(0, 4))], dur: 2.5, gain: 0.008, attack: 0.3 }));
  },
  shishi(A, L) {
    A._every(L, 18, 40, () => A.sfx('tok'));
  },
  fire(A, L) {
    const ctx = A.ctx;
    const n = A._noise(L, 'brown'); const g = ctx.createGain(); g.gain.value = 0.2; n.connect(g).connect(L.out);
    A._every(L, 0.05, 0.5, () => A._burst(L.out, rand(1500, 4000), 0.01, rand(0.02, 0.08)));
  },
};
