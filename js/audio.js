/* ==========================================================================
 * audio.js — procedural sound for "Arena Showrunner" (WebAudio only).
 *
 *   GM.Audio.unlock()                        create / resume the AudioContext (user gesture)
 *   GM.Audio.play(name, opts) -> bool        opts {pos, volume=1, rate=1, delay, variant, pan}
 *   GM.Audio.setMuted(bool) / .muted         persisted in localStorage
 *   GM.Audio.setVolume(0..1) / .volume       persisted in localStorage
 *   GM.Audio.toggleMute(), stopAll(), duck(level, seconds), names, has(name), status()
 *
 * No sample files: every sound is synthesised from oscillators, noise buffers,
 * filters and envelopes, with a small delay-network reverb ("the arena").
 * Positional sounds are attenuated by the distance to the main camera (and its
 * ground focus point) and panned in stereo. Ambient beds (wind, rain, storm,
 * crickets, cicadas, fire crackle) follow weather / time of day and
 * cross-fade; birds sing by day, an owl calls at night.
 * Event driven: knell on every death, gong at the start, countdown beeps,
 * combat, hazards, beasts, betrayals, announcements, anthem, victory fanfare.
 * Owner: CAMERA.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  if (!GM) return;
  const U = GM.U;
  const CFG = GM.CFG;

  // ------------------------------------------------------------------ i18n
  if (GM.i18n && typeof GM.i18n.add === 'function') {
    GM.i18n.add({
      en: {
        'audio.on': 'Sound on',
        'audio.off': 'Sound off',
        'audio.volume': 'Volume',
        'audio.enable': 'Click anywhere to turn on the sound',
        'audio.unsupported': 'This browser cannot play the sound',
      },
      hu: {
        'audio.on': 'Hang be',
        'audio.off': 'Hang ki',
        'audio.volume': 'Hangerő',
        'audio.enable': 'Kattints bárhova a hang bekapcsolásához',
        'audio.unsupported': 'Ez a böngésző nem tudja lejátszani a hangot',
      },
    });
  }

  // ------------------------------------------------------------- constants
  const STORE_KEY = 'gmArena.audio';
  const MAX_VOICES_HIGH = 36;
  const MAX_VOICES_LOW = 22;
  const AMB_STEP = 0.25;          // ambience update period (real s)
  const FIRE_STEP = 0.5;          // fire proximity sampling period (real s)
  const AMB_LEVEL = 0.85;         // ambient bus level
  const KNELL_GAP = 1.7;         // seconds between queued knell shots
  const KNELL_QUEUE_MAX = 9;     // never queue knells further ahead than this
  const COMBAT_RATE = 10;         // combat sounds per real second (token bucket)
  const COMBAT_BURST = 6;
  const EMPTY = {};

  // ----------------------------------------------------------------- state
  let ctx = null;
  let resuming = false;
  let unlocked = false;
  let muted = false;
  let volume = 0.8;
  let maxVoices = MAX_VOICES_HIGH;
  let canPan = false;
  let master = null, mix = null;
  let busFx = null, busUi = null, busMusic = null, busAmb = null;
  let reverbIn = null;
  let curves = null;
  let suspendTimer = 0;
  let nextKnell = 0;
  let tokens = COMBAT_BURST, tokenTime = 0;
  let duckUntil = 0;
  const buffers = Object.create(null);
  const voices = [];
  let cur = null;                 // voice / bed being built: collects its sources

  // ----------------------------------------------------------- persistence
  function loadPrefs() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && typeof o.muted === 'boolean') muted = o.muted;
      if (o && typeof o.volume === 'number' && o.volume === o.volume) volume = U.clamp01(o.volume);
    } catch (e) { /* storage blocked or corrupt: keep defaults */ }
  }
  function savePrefs() {
    try {
      if (window.localStorage) window.localStorage.setItem(STORE_KEY, JSON.stringify({ muted: muted, volume: volume }));
    } catch (e) { /* storage blocked: ignore */ }
  }
  loadPrefs();

  // ---------------------------------------------------------- node helpers
  function clampF(f) { return f < 10 ? 10 : f > 16000 ? 16000 : f; }
  function rnd(a, b) { return a + (b - a) * Math.random(); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function track(src) { if (cur) cur.srcs.push(src); return src; }

  /** GainNode with value v, optionally connected to a node or AudioParam. */
  function G(v, dest) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }
  /** BiquadFilterNode. */
  function F(type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clampF(freq);
    if (q != null) f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }
  /** Oscillator started at t0 (and stopped at t1 unless null). */
  function O(type, freq, t0, t1, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (dest) o.connect(dest);
    o.start(t0);
    if (t1 != null) o.stop(t1);
    return track(o);
  }
  /** Looping noise-buffer source with a random start offset. */
  function N(name, t0, t1, dest, rate) {
    const b = buf(name);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    if (rate) s.playbackRate.setValueAtTime(rate, t0);
    if (dest) s.connect(dest);
    s.start(t0, Math.random() * b.duration * 0.9);
    if (t1 != null) s.stop(t1);
    return track(s);
  }
  /** Attack to peak, then exponential decay to silence. */
  function AD(p, t, peak, a, d) {
    peak = Math.max(peak, 0.0002);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  /** Attack, hold at peak, exponential release. */
  function ASR(p, t, peak, a, hold, r) {
    peak = Math.max(peak, 0.0002);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + a + Math.max(0, hold));
    p.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0, hold) + r);
  }
  /** Exponential crescendo that ends abruptly (incoming objects). */
  function cresc(p, t, peak, len) {
    p.setValueAtTime(0.01 * peak, t);
    p.exponentialRampToValueAtTime(peak, t + len - 0.1);
    p.linearRampToValueAtTime(0.0001, t + len + 0.05);
  }
  /** Exponential glide of a frequency param. */
  function glide(p, t, f0, f1, dur) {
    p.setValueAtTime(clampF(f0), t);
    p.exponentialRampToValueAtTime(clampF(f1), t + dur);
  }
  function makeCurves() {
    const n = 1024;
    const soft = new Float32Array(n), hard = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      soft[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
      hard[i] = Math.tanh(6 * x) / Math.tanh(6);
    }
    return { soft: soft, hard: hard };
  }
  function shaper(curve, dest) {
    const s = ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = '2x';
    if (dest) s.connect(dest);
    return s;
  }

  // --------------------------------------------------------- noise buffers
  // Generated lazily on first use and cached. Each generator factory takes the
  // sample rate and returns a stateful next() producing one sample.
  function buf(name) {
    let b = buffers[name];
    if (!b) b = buffers[name] = makeBuffer(name);
    return b;
  }
  function makeBuffer(name) {
    switch (name) {
      case 'white': return noiseBuf(1, 2, whiteGen);
      case 'pink': return noiseBuf(1, 3, pinkGen);
      case 'brown': return noiseBuf(1, 4, brownGen);
      case 'pinkS': return noiseBuf(2, 3, pinkGen);
      case 'brownS': return noiseBuf(2, 4, brownGen);
      case 'crackle': return noiseBuf(1, 2, crackleGen(55));
      case 'crackleS': return noiseBuf(2, 3, crackleGen(38));
      case 'dropsS': return noiseBuf(2, 2, dropsGen);
      case 'crickets': return cricketBuf();
      case 'cicadas': return cicadaBuf();
      default: return noiseBuf(1, 1, whiteGen);
    }
  }
  /** Seamlessly looping, peak-normalised noise buffer. */
  function noiseBuf(chs, secs, factory) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * secs);
    const fade = Math.floor(sr * 0.05);
    const b = ctx.createBuffer(chs, len, sr);
    const tmp = new Float32Array(len + fade);
    for (let c = 0; c < chs; c++) {
      const next = factory(sr);
      for (let i = 0; i < tmp.length; i++) tmp[i] = next();
      const d = b.getChannelData(c);
      let peak = 0;
      for (let i = 0; i < len; i++) {
        let v = tmp[i];
        // cross-fade the head with the samples that follow the tail -> no click at the loop point
        if (i < fade) { const w = i / fade; v = v * w + tmp[len + i] * (1 - w); }
        d[i] = v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      if (peak > 0) { const k = 0.9 / peak; for (let i = 0; i < len; i++) d[i] *= k; }
    }
    return b;
  }
  function whiteGen() { return function () { return Math.random() * 2 - 1; }; }
  function pinkGen() {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return function () {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return o * 0.11;
    };
  }
  function brownGen() {
    let last = 0;
    return function () {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      return last * 3.5;
    };
  }
  /** Burning wood: sparse pops of decaying filtered noise, a few big snaps. */
  function crackleGen(density) {
    return function (sr) {
      let env = 0, dec = 0, lp = 0, prev = 0, tone = 0.6;
      const p = density / sr;
      return function () {
        if (Math.random() < p) {
          const big = Math.random() < 0.12;
          env = big ? 0.6 + Math.random() * 0.4 : 0.08 + Math.pow(Math.random(), 2) * 0.5;
          dec = Math.exp(-1 / (sr * (big ? 0.003 + Math.random() * 0.009 : 0.0004 + Math.random() * 0.003)));
          tone = big ? 0.3 : 0.75;
        }
        const w = (Math.random() * 2 - 1) * env;
        env *= dec;
        lp += (w - lp) * tone;
        const o = lp - prev * 0.55;
        prev = lp;
        return o;
      };
    };
  }
  /** Rain drops on leaves: dense tiny clicks over a faint hiss. */
  function dropsGen(sr) {
    let env = 0, dec = 0, prev = 0;
    const p = 170 / sr;
    return function () {
      if (Math.random() < p) {
        env = 0.1 + Math.pow(Math.random(), 2.5) * 0.9;
        dec = Math.exp(-1 / (sr * (0.0002 + Math.random() * 0.0012)));
      }
      const w = (Math.random() * 2 - 1) * env;
      env *= dec;
      const o = w - prev * 0.85;
      prev = w;
      return o + (Math.random() * 2 - 1) * 0.015;
    };
  }
  /** Three crickets at different pitches, rhythms and stereo places (4 s loop). */
  function cricketBuf() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 4);
    const b = ctx.createBuffer(2, len, sr);
    const L = b.getChannelData(0), R = b.getChannelData(1);
    const bugs = [
      { f: 4400, pan: 0.2, per: 0.62, vol: 0.55, pulses: 3 },
      { f: 4780, pan: 0.8, per: 0.81, vol: 0.45, pulses: 4 },
      { f: 3950, pan: 0.5, per: 0.47, vol: 0.2, pulses: 3 },
    ];
    const pulseLen = Math.floor(sr * 0.016), pulseGap = Math.floor(sr * 0.027);
    for (let k = 0; k < bugs.length; k++) {
      const bug = bugs[k];
      const gl = Math.cos(bug.pan * Math.PI / 2), gr = Math.sin(bug.pan * Math.PI / 2);
      const chirpLen = bug.pulses * pulseGap + pulseLen;
      let t = Math.random() * bug.per;
      for (;;) {
        const start = Math.floor(t * sr);
        if (start + chirpLen >= len) break;
        const amp = bug.vol * (0.75 + Math.random() * 0.25);
        const fj = bug.f * (1 + (Math.random() - 0.5) * 0.01);
        const w = 2 * Math.PI * fj / sr;
        for (let pI = 0; pI < bug.pulses; pI++) {
          const s0 = start + pI * pulseGap;
          for (let i = 0; i < pulseLen; i++) {
            const e = Math.sin(Math.PI * i / pulseLen);
            const v = Math.sin(w * (s0 + i)) * e * e * amp;
            L[s0 + i] += v * gl;
            R[s0 + i] += v * gr;
          }
        }
        t += bug.per * (0.85 + Math.random() * 0.3);
        if (Math.random() < 0.08) t += bug.per * 2; // a short pause now and then
      }
    }
    for (let i = 0; i < len; i++) { const n = (Math.random() * 2 - 1) * 0.004; L[i] += n; R[i] += n * 0.8; }
    return b;
  }
  /** Heat-wave cicadas: pulsed high tone. All rates are whole cycles per 2 s -> seamless loop. */
  function cicadaBuf() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 2);
    const b = ctx.createBuffer(2, len, sr);
    const chans = [[b.getChannelData(0), 4600, 80, 0], [b.getChannelData(1), 4750, 76, 1.3]];
    for (let c = 0; c < chans.length; c++) {
      const d = chans[c][0], f = chans[c][1], am = chans[c][2], ph = chans[c][3];
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * am * t + ph);
        const swell = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.5 * t + ph);
        const car = Math.sin(2 * Math.PI * f * t + 0.8 * Math.sin(2 * Math.PI * 9.5 * t));
        d[i] = car * pulse * pulse * pulse * swell * 0.5 + (Math.random() * 2 - 1) * 0.01;
      }
    }
    return b;
  }

  // ------------------------------------------------------------ instruments
  /** Brass-like note: two detuned saws through an opening low-pass ("blat"). */
  function brass(d, t, dur, midi, vel, bright, vib) {
    const f = mtof(midi);
    const end = t + dur + 0.45;
    const g = G(0, d);
    const lp = F('lowpass', f * 1.2, 1.4, g);
    const o1 = O('sawtooth', f, t, end, lp);
    const o2 = O('sawtooth', f, t, end, lp);
    o1.detune.setValueAtTime(-7, t);
    o2.detune.setValueAtTime(6, t);
    const peakF = Math.min(f * (bright || 6), 9000);
    lp.frequency.setValueAtTime(clampF(f * 1.1), t);
    lp.frequency.linearRampToValueAtTime(clampF(peakF), t + 0.07);
    lp.frequency.setTargetAtTime(clampF(peakF * 0.5), t + 0.07, 0.25);
    const short = dur < 0.3;
    const sus = vel * (short ? 0.9 : 0.72);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.045);
    g.gain.setTargetAtTime(sus, t + 0.045, short ? 1 : 0.25);
    g.gain.setValueAtTime(sus, t + Math.max(dur, 0.06));
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    if (vib) {
      const lg = G(0);
      O('sine', 5.2 + Math.random() * 0.6, t, end, lg);
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.5, dur));
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
    }
  }
  /** Timpani hit. */
  function timp(d, t, f, vel) {
    const g = G(0, d);
    const o = O('sine', f * 1.08, t, t + 1.8, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    AD(g.gain, t, vel, 0.004, 1.4);
    const g2 = G(0, d);
    O('triangle', f * 1.51, t, t + 0.6, g2);
    AD(g2.gain, t, vel * 0.25, 0.003, 0.35);
    const g3 = G(0, d);
    N('white', t, t + 0.12, F('lowpass', 500, 0.7, g3));
    AD(g3.gain, t, vel * 0.5, 0.001, 0.08);
  }
  /** Crash cymbal. */
  function cymbal(d, t, vel, len) {
    const g = G(0, d);
    N('white', t, t + len + 0.1, F('highpass', 4200, 0.5, g));
    AD(g.gain, t, vel, 0.004, len);
    const g2 = G(0, d);
    N('white', t, t + 0.5, F('bandpass', 9000, 1.5, g2));
    AD(g2.gain, t, vel * 0.6, 0.001, 0.4);
  }
  const BELL_PARTS = [[1, 1, 1], [2, 0.35, 0.6], [2.76, 0.22, 0.4], [5.4, 0.08, 0.2]];
  /** Struck bell / chime with inharmonic partials. */
  function bell(d, t, f, vel, dec) {
    for (let i = 0; i < BELL_PARTS.length; i++) {
      const pp = BELL_PARTS[i];
      const g = G(0, d);
      O('sine', f * pp[0], t, t + dec * pp[2] + 0.1, g);
      AD(g.gain, t, vel * pp[1], 0.003, dec * pp[2]);
    }
  }

  // ---------------------------------------------------------------- sounds
  // Each recipe: (dest, startTime, params {rate, vol, variant, dist}) -> duration (s).

  /** The Hunger Show knell: a deep boom that rolls around the arena. */
  function sKnell(d, t, p) {
    const r = p.rate;
    const cg = G(0, d);
    const cf = F('lowpass', 3000, 0.7, cg);
    N('white', t, t + 0.3, cf);
    glide(cf.frequency, t, 3200 * r, 240, 0.22);
    AD(cg.gain, t, 0.8, 0.002, 0.2);
    const bg = G(0, d);
    const bo = O('sine', 92 * r, t, t + 2.8, shaper(curves.soft, bg));
    bo.frequency.exponentialRampToValueAtTime(33 * r, t + 1.0);
    AD(bg.gain, t, 1.0, 0.004, 2.4);
    const sg = G(0, d);
    const so = O('sine', 50 * r, t, t + 2.6, sg);
    so.frequency.exponentialRampToValueAtTime(28 * r, t + 1.8);
    AD(sg.gain, t, 0.9, 0.012, 2.3);
    const rg = G(0, d);
    const rf = F('lowpass', 600, 0.4, rg);
    N('brown', t, t + 6, rf);
    glide(rf.frequency, t, 700 * r, 80, 4.5);
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.linearRampToValueAtTime(1.4, t + 0.03);
    rg.gain.setTargetAtTime(0.0001, t + 0.12, 1.15);
    for (let i = 0; i < 3; i++) { // echoes from the hills
      const et = t + 0.62 + i * 0.83 + Math.random() * 0.1;
      const eg = G(0, d);
      N('brown', et, et + 2.2, F('lowpass', 300 - i * 60, 0.6, eg));
      AD(eg.gain, et, 0.55 / (i + 1), 0.04, 1.6);
    }
    return 6.2;
  }

  // [ratio, level, decay, attack] — the slow attacks of the middle partials make the gong "bloom"
  const GONG = [[1, 1, 7, 0.004], [1.48, 0.5, 5.5, 0.12], [2.03, 0.45, 4.8, 0.25], [2.59, 0.35, 4, 0.3],
    [3.16, 0.28, 3.2, 0.2], [4.23, 0.2, 2.4, 0.05], [5.41, 0.14, 1.8, 0.004], [6.94, 0.09, 1.2, 0.004]];
  function sGong(d, t, p) {
    const f0 = 92 * p.rate;
    const m = G(0.55, d);
    for (let i = 0; i < GONG.length; i++) {
      const gp = GONG[i];
      const gg = G(0, m);
      const f = f0 * gp[0];
      const o = O('sine', f * 1.012, t, t + gp[2] + 0.3, gg);
      o.frequency.exponentialRampToValueAtTime(f, t + 1.2);
      if (i < 4) {
        const o2 = O('sine', f * 1.016, t, t + gp[2] + 0.3, gg);
        o2.frequency.exponentialRampToValueAtTime(f * 1.004, t + 1.2);
      }
      AD(gg.gain, t, gp[1] * (i < 4 ? 0.6 : 1), gp[3], gp[2]);
    }
    const sg = G(0, d);
    N('white', t, t + 0.2, F('bandpass', 1300, 1.1, sg));
    AD(sg.gain, t, 0.5, 0.002, 0.12);
    const tg = G(0, d);
    const to = O('sine', 70, t, t + 0.7, tg);
    to.frequency.exponentialRampToValueAtTime(45, t + 0.4);
    AD(tg.gain, t, 0.8, 0.004, 0.5);
    return 7.5;
  }

  function sCountdown(d, t, p) {
    const f = 880 * p.rate;
    const g = G(0, d);
    O('sine', f, t, t + 0.4, g);
    AD(g.gain, t, 0.7, 0.003, p.rate > 1.1 ? 0.34 : 0.22);
    const g2 = G(0, d);
    O('triangle', f * 2, t, t + 0.2, g2);
    AD(g2.gain, t, 0.12, 0.002, 0.1);
    const hg = G(0, d); // heartbeat thump under the beep
    const ho = O('sine', 75, t, t + 0.25, hg);
    ho.frequency.exponentialRampToValueAtTime(48, t + 0.15);
    AD(hg.gain, t, 0.6, 0.004, 0.16);
    return 0.45;
  }

  function sThunder(d, t, p) {
    const far = p.variant === 'far' || p.dist > 220;
    const near = !far && (p.variant === 'near' || p.dist < 70);
    if (near) {
      const cg = G(0, d);
      N('white', t, t + 0.6, F('highpass', 900, 0.5, cg));
      AD(cg.gain, t, 1.0, 0.002, 0.45);
      const mg = G(0, d);
      N('pink', t + 0.02, t + 1, F('bandpass', 380, 0.7, mg));
      AD(mg.gain, t + 0.02, 0.9, 0.005, 0.7);
    }
    const len = far ? 4.5 : 5.5;
    const rg = G(0, d);
    const rf = F('lowpass', far ? 220 : 420, 0.5, rg);
    N('brown', t, t + len + 0.5, rf);
    glide(rf.frequency, t, far ? 260 : 700, 90, len);
    rg.gain.setValueAtTime(0.0001, t);
    const bumps = 3 + Math.floor(Math.random() * 3);
    const step = (len * 0.6) / bumps;
    let tt = t + (near ? 0.05 : 0.15);
    for (let i = 0; i < bumps; i++) { // rolling peaks
      const lvl = (near ? 1.3 : 0.9) * (1 - i / (bumps + 1)) * rnd(0.6, 1);
      rg.gain.linearRampToValueAtTime(lvl, tt + rnd(0.05, 0.2));
      tt += step * rnd(0.7, 1.2);
      rg.gain.linearRampToValueAtTime(lvl * 0.35, tt);
    }
    rg.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const sg = G(0, d);
    N('brown', t, t + len, F('lowpass', 70, 0.7, sg));
    AD(sg.gain, t, near ? 1.2 : 0.8, 0.08, len * 0.7);
    return len + 0.5;
  }

  function sExplosion(d, t, p) {
    const r = p.rate;
    const bg = G(0, d);
    const bf = F('lowpass', 5000, 0.6, bg);
    N('white', t, t + 1.4, bf);
    glide(bf.frequency, t, 6000 * r, 160, 0.9);
    AD(bg.gain, t, 1.0, 0.003, 1.1);
    const og = G(0, d);
    const o = O('sine', 85 * r, t, t + 1.6, shaper(curves.hard, og));
    o.frequency.exponentialRampToValueAtTime(26, t + 0.9);
    AD(og.gain, t, 0.9, 0.004, 1.2);
    const rg = G(0, d);
    N('brown', t, t + 3.2, F('lowpass', 160, 0.5, rg));
    AD(rg.gain, t, 1.1, 0.02, 2.8);
    const dg = G(0, d); // falling debris
    N('crackle', t + 0.12, t + 2, F('highpass', 1400, 0.5, dg));
    AD(dg.gain, t + 0.12, 0.45, 0.06, 1.5);
    return 3.3;
  }

  /** Incoming fireball: a rising roar that ends where the explosion begins. */
  function sFireball(d, t, p) {
    const r = p.rate, L = 1.35;
    const wg = G(0, d);
    const wf = F('bandpass', 400, 1.3, wg);
    N('pink', t, t + L + 0.1, wf);
    glide(wf.frequency, t, 350 * r, 2600 * r, L);
    cresc(wg.gain, t, 0.9, L);
    const rg = G(0, d);
    N('brown', t, t + L + 0.1, F('lowpass', 500, 0.6, rg));
    cresc(rg.gain, t, 0.8, L);
    const cg = G(0, d);
    N('crackle', t, t + L + 0.1, F('bandpass', 2200, 0.8, cg));
    cresc(cg.gain, t, 0.5, L);
    const tg = G(0, d);
    const o = O('sawtooth', 420 * r, t, t + L + 0.1, F('lowpass', 900, 1, tg));
    o.frequency.exponentialRampToValueAtTime(150 * r, t + L);
    cresc(tg.gain, t, 0.12, L);
    return L + 0.2;
  }

  /** Fire catching: a soft "fwoomp" and crackles. */
  function sFire(d, t, p) {
    const r = p.rate;
    const wg = G(0, d);
    const wf = F('lowpass', 300, 0.8, wg);
    N('pink', t, t + 1.6, wf);
    wf.frequency.setValueAtTime(220 * r, t);
    wf.frequency.exponentialRampToValueAtTime(1500 * r, t + 0.25);
    wf.frequency.exponentialRampToValueAtTime(500, t + 1.4);
    AD(wg.gain, t, 1.0, 0.14, 1.2);
    const cg = G(0, d);
    N('crackle', t + 0.05, t + 2.2, F('highpass', 900, 0.5, cg));
    ASR(cg.gain, t + 0.05, 0.6, 0.15, 0.9, 0.9);
    return 2.3;
  }

  /** Body hit (non-graphic thud). variant 'blunt' | 'blade' | 'body'. */
  function sHit(d, t, p) {
    const r = p.rate, v = p.variant;
    const heavy = v === 'blunt';
    const g = G(0, d);
    const o = O('sine', (heavy ? 120 : 160) * r, t, t + 0.3, g);
    o.frequency.exponentialRampToValueAtTime(50 * r, t + 0.14);
    AD(g.gain, t, heavy ? 1 : 0.8, 0.002, heavy ? 0.24 : 0.16);
    const ng = G(0, d);
    N('white', t, t + 0.12, F('bandpass', (heavy ? 900 : 1700) * r, 0.9, ng));
    AD(ng.gain, t, 0.7, 0.001, 0.06);
    if (v === 'blade') {
      const sg = G(0, d);
      N('white', t, t + 0.15, F('highpass', 3800, 0.7, sg));
      AD(sg.gain, t, 0.3, 0.001, 0.1);
    }
    return 0.32;
  }

  const CLASH = [1, 1.483, 1.932, 2.546, 3.11];
  /** Metal on metal. */
  function sClash(d, t, p) {
    const base = rnd(1050, 1400) * p.rate;
    for (let i = 0; i < CLASH.length; i++) {
      const g = G(0, d);
      O('sine', base * CLASH[i], t, t + 0.8, g);
      AD(g.gain, t, 0.28 / (1 + i * 0.3), 0.001, 0.55 - i * 0.07);
    }
    const ng = G(0, d);
    N('white', t, t + 0.1, F('highpass', 3200, 0.6, ng));
    AD(ng.gain, t, 0.6, 0.0008, 0.05);
    const sg = G(0, d); // sparks
    N('white', t + 0.02, t + 0.3, F('highpass', 6500, 0.5, sg));
    AD(sg.gain, t + 0.02, 0.18, 0.002, 0.2);
    return 0.8;
  }

  /** Weapon swing whoosh. */
  function sSwing(d, t, p) {
    const r = p.rate, L = 0.3 / Math.sqrt(r);
    const g = G(0, d);
    const f = F('bandpass', 600, 2.2, g);
    N('pink', t, t + L + 0.05, f);
    f.frequency.setValueAtTime(500 * r, t);
    f.frequency.exponentialRampToValueAtTime(clampF(2400 * r), t + L * 0.4);
    f.frequency.exponentialRampToValueAtTime(700 * r, t + L);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + L * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + L);
    return L + 0.05;
  }

  /** Bow: string twang + arrow leaving. */
  function sBow(d, t, p) {
    const r = p.rate;
    const g = G(0, d);
    const o = O('triangle', 200 * r, t, t + 0.45, F('lowpass', 2400, 1, g));
    o.frequency.exponentialRampToValueAtTime(176 * r, t + 0.3);
    AD(g.gain, t, 0.7, 0.002, 0.38);
    const bg = G(0, d);
    O('sawtooth', 400 * r, t, t + 0.25, F('lowpass', 1300, 2, bg));
    AD(bg.gain, t, 0.2, 0.002, 0.18);
    const ng = G(0, d);
    N('white', t, t + 0.1, F('highpass', 2500, 0.7, ng));
    AD(ng.gain, t, 0.5, 0.001, 0.06);
    const wg = G(0, d);
    const wf = F('bandpass', 3500, 3, wg);
    N('pink', t + 0.03, t + 0.5, wf);
    glide(wf.frequency, t + 0.03, 3800, 1100, 0.4);
    wg.gain.setValueAtTime(0.0001, t + 0.03);
    wg.gain.exponentialRampToValueAtTime(0.5, t + 0.1);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    return 0.55;
  }

  /** Arrow strikes: thunk + shaft wobble. */
  function sArrowHit(d, t, p) {
    const r = p.rate;
    const g = G(0, d);
    const o = O('sine', 280 * r, t, t + 0.2, g);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.08);
    AD(g.gain, t, 0.9, 0.001, 0.13);
    const ng = G(0, d);
    N('white', t, t + 0.08, F('bandpass', 950 * r, 2.5, ng));
    AD(ng.gain, t, 0.8, 0.0008, 0.05);
    const wg = G(0, d);
    const wo = O('triangle', 150 * r, t + 0.01, t + 0.36, wg);
    const lg = G(22, wo.frequency);
    O('sine', 26, t + 0.01, t + 0.36, lg);
    AD(wg.gain, t + 0.01, 0.18, 0.002, 0.28);
    return 0.4;
  }

  const HOWL_CURVE = [[0, 0.8], [0.16, 1.3], [0.55, 1.42], [0.8, 1.3], [1, 0.88]];
  function howlVoice(d, t, f, vol, L) {
    const g = G(0, d);
    const o1 = O('sine', f, t, t + L + 0.1, g);
    const hg = G(0.22, g);
    const o2 = O('triangle', f * 2, t, t + L + 0.1, F('lowpass', 1800, 0.7, hg));
    for (let i = 0; i < HOWL_CURVE.length; i++) {
      const tt = t + HOWL_CURVE[i][0] * L, m = HOWL_CURVE[i][1];
      if (i === 0) {
        o1.frequency.setValueAtTime(f * m, tt);
        o2.frequency.setValueAtTime(2 * f * m, tt);
      } else {
        o1.frequency.exponentialRampToValueAtTime(f * m, tt);
        o2.frequency.exponentialRampToValueAtTime(2 * f * m, tt);
      }
    }
    const vg = G(0);
    O('sine', rnd(5, 6.2), t, t + L + 0.1, vg);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.02, t + L * 0.4);
    vg.connect(o1.frequency);
    vg.connect(G(2, o2.frequency));
    const hold = Math.max(0.2, L - 0.95);
    ASR(g.gain, t, vol, 0.3, hold, 0.65);
    const bg = G(0, d); // breath
    N('pink', t, t + L + 0.1, F('bandpass', 1300, 1.5, bg));
    ASR(bg.gain, t, vol * 0.12, 0.3, hold, 0.65);
  }
  /** Wolf howl; loud calls get a pack answering in harmony. */
  function sHowl(d, t, p) {
    const f = 390 * p.rate * rnd(0.94, 1.06);
    const L = rnd(2.4, 3.1);
    howlVoice(d, t, f, 0.6, L);
    if (p.vol >= 0.85 && p.variant !== 'solo') {
      howlVoice(d, t + rnd(0.35, 0.7), f * rnd(1.15, 1.25), 0.38, L * 0.9);
      if (Math.random() < 0.5) howlVoice(d, t + rnd(0.9, 1.3), f * 0.84, 0.3, L * 0.8);
    }
    return L + 1.5;
  }

  function sGrowl(d, t, p) {
    const r = p.rate, L = rnd(0.7, 1.0) / r;
    const env = G(0, d);
    const am = G(0.55, env);
    O('sine', rnd(22, 30), t, t + L + 0.1, G(0.45, am.gain)); // rattle
    const lp = F('lowpass', 520 * r, 3, am);
    const o = O('sawtooth', 70 * r, t, t + L + 0.1, lp);
    o.frequency.linearRampToValueAtTime(92 * r, t + L * 0.45);
    o.frequency.linearRampToValueAtTime(74 * r, t + L);
    O('sine', 7, t, t + L + 0.1, G(6, o.frequency));
    N('brown', t, t + L + 0.1, F('bandpass', 360 * r, 1.4, G(0.9, am)));
    ASR(env.gain, t, 0.9, 0.08, L - 0.3, 0.22);
    return L + 0.15;
  }

  /** Killer wasp swarm passing by. */
  function sBuzz(d, t, p) {
    const r = p.rate, L = 1.9;
    const env = G(0, d);
    const bp = F('bandpass', 950 * r, 1.1, env);
    const hp = F('highpass', 260, 0.7, bp);
    const lfo = G(14);
    O('sine', rnd(7, 10), t, t + L + 0.1, lfo);
    const lfo2 = G(9);
    O('sine', rnd(11, 15), t, t + L + 0.1, lfo2);
    for (let i = 0; i < 4; i++) {
      const f = (200 + i * 13 + rnd(-5, 5)) * r;
      const o = O('sawtooth', f, t, t + L + 0.1, hp);
      o.frequency.linearRampToValueAtTime(f * 1.08, t + L * 0.45);
      o.frequency.linearRampToValueAtTime(f * 0.92, t + L);
      (i & 1 ? lfo2 : lfo).connect(o.frequency);
    }
    ASR(env.gain, t, 0.35, 0.35, L - 0.85, 0.5);
    return L + 0.1;
  }

  /** Force-field siren through a loudspeaker. */
  function sAlarm(d, t, p) {
    const r = p.rate, L = 2.8;
    const env = G(0, d);
    const pa = F('bandpass', 1300, 0.6, env);
    const lp = F('lowpass', 2400, 1.5, pa);
    const lfo = G(190 * r);
    O('triangle', 0.75, t, t + L + 0.1, lfo);
    const o1 = O('sawtooth', 700 * r, t, t + L + 0.1, lp);
    const o2 = O('sawtooth', 703 * r, t, t + L + 0.1, lp);
    const o3 = O('square', 350 * r, t, t + L + 0.1, G(0.25, lp));
    lfo.connect(o1.frequency);
    lfo.connect(o2.frequency);
    lfo.connect(G(0.5, o3.frequency));
    ASR(env.gain, t, 0.5, 0.08, L - 0.5, 0.35);
    return L + 0.1;
  }

  function sClick(d, t, p) {
    const g = G(0, d);
    const o = O('sine', 1900 * p.rate, t, t + 0.06, g);
    o.frequency.exponentialRampToValueAtTime(1150 * p.rate, t + 0.025);
    AD(g.gain, t, 0.5, 0.001, 0.035);
    const ng = G(0, d);
    N('white', t, t + 0.02, F('highpass', 5000, 0.7, ng));
    AD(ng.gain, t, 0.12, 0.0005, 0.01);
    return 0.07;
  }
  function sHover(d, t, p) {
    const g = G(0, d);
    O('sine', 2700 * p.rate, t, t + 0.05, g);
    AD(g.gain, t, 0.25, 0.002, 0.03);
    return 0.06;
  }

  /** Crate hits the ground, bounces once. */
  function sDrop(d, t, p) {
    const r = p.rate;
    for (let k = 0; k < 2; k++) {
      const tt = t + k * 0.19, a = k ? 0.35 : 1;
      const g = G(0, d);
      const o = O('sine', 100 * r, tt, tt + 0.45, g);
      o.frequency.exponentialRampToValueAtTime(42 * r, tt + 0.2);
      AD(g.gain, tt, a, 0.003, 0.32);
      const kg = G(0, d);
      N('pink', tt, tt + 0.2, F('bandpass', 430 * r, 2, kg));
      AD(kg.gain, tt, 0.8 * a, 0.002, 0.13);
    }
    const rg = G(0, d);
    N('crackle', t + 0.04, t + 0.5, F('bandpass', 2400, 0.9, rg));
    AD(rg.gain, t + 0.04, 0.25, 0.01, 0.3);
    return 0.7;
  }

  /** Silver parachute: canopy flap + the sponsor chime. */
  function sParachute(d, t, p) {
    const g = G(0, d);
    const am = G(0.6, g);
    O('sine', 13, t, t + 0.8, G(0.4, am.gain));
    const lf = F('lowpass', 900, 0.8, am);
    N('pink', t, t + 0.8, lf);
    glide(lf.frequency, t, 300, 1100, 0.12);
    AD(g.gain, t, 0.8, 0.03, 0.6);
    bell(d, t + 0.15, 1568 * p.rate, 0.28, 1.3);
    bell(d, t + 0.36, 2093 * p.rate, 0.24, 1.5);
    return 2.0;
  }

  const HEAL_NOTES = [1046.5, 1318.5, 1568, 2093];
  function sHeal(d, t, p) {
    for (let i = 0; i < HEAL_NOTES.length; i++) {
      const tt = t + i * 0.075, f = HEAL_NOTES[i] * p.rate;
      const g = G(0, d);
      O('triangle', f, tt, tt + 1.1, g);
      AD(g.gain, tt, 0.28, 0.005, 0.95);
      const g2 = G(0, d);
      O('sine', f * 2, tt, tt + 0.6, g2);
      AD(g2.gain, tt, 0.06, 0.003, 0.5);
    }
    const sg = G(0, d); // shimmer
    N('white', t, t + 1.2, F('bandpass', 7000, 2, sg));
    ASR(sg.gain, t, 0.05, 0.25, 0.2, 0.6);
    return 1.4;
  }

  function sEat(d, t, p) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.17 + Math.random() * 0.04;
      const g = G(0, d);
      N('white', tt, tt + 0.1, F('bandpass', rnd(1500, 3200) * p.rate, 1.1, g));
      AD(g.gain, tt, rnd(0.4, 0.6), 0.002, 0.065);
      const cg = G(0, d);
      N('crackle', tt, tt + 0.1, F('highpass', 1200, 0.5, cg));
      AD(cg.gain, tt, 0.35, 0.002, 0.07);
      const mg = G(0, d);
      O('sine', 170 * p.rate, tt, tt + 0.12, mg);
      AD(mg.gain, tt, 0.25, 0.005, 0.07);
    }
    return 0.65;
  }
  function sDrink(d, t, p) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.24;
      const g = G(0, d);
      const o = O('sine', 260 * p.rate, tt, tt + 0.15, F('lowpass', 1200, 1, g));
      o.frequency.exponentialRampToValueAtTime(560 * p.rate, tt + 0.07);
      AD(g.gain, tt, 0.45, 0.01, 0.1);
      const ng = G(0, d);
      N('pink', tt, tt + 0.1, F('bandpass', 700, 1.2, ng));
      AD(ng.gain, tt, 0.25, 0.01, 0.07);
    }
    return 0.8;
  }

  /** Splash; variant 'big' adds the roar of rising water (flood). */
  function sSplash(d, t, p) {
    const r = p.rate, big = p.variant === 'big';
    const pg = G(0, d);
    const po = O('sine', 430 * r, t, t + 0.2, pg);
    po.frequency.exponentialRampToValueAtTime(140 * r, t + 0.12);
    AD(pg.gain, t, 0.6, 0.002, 0.14);
    const wg = G(0, d);
    const wf = F('bandpass', 3000, 0.7, wg);
    N('white', t, t + 1.3, wf);
    glide(wf.frequency, t, 3200 * r, 700 * r, 0.75);
    AD(wg.gain, t, 0.8, 0.01, big ? 1.1 : 0.75);
    const sg = G(0, d);
    N('white', t, t + 0.7, F('highpass', 4200, 0.5, sg));
    AD(sg.gain, t, 0.3, 0.005, 0.5);
    for (let i = 0; i < 5; i++) { // droplets
      const tt = t + rnd(0.12, 0.75), f = rnd(1100, 2600) * r;
      const g = G(0, d);
      const o = O('sine', f, tt, tt + 0.08, g);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, tt + 0.05);
      AD(g.gain, tt, rnd(0.06, 0.14), 0.002, 0.05);
    }
    if (big) {
      const bg = G(0, d);
      N('brown', t, t + 3, F('lowpass', 320, 0.5, bg));
      ASR(bg.gain, t, 0.9, 0.3, 1.0, 1.4);
      return 3.1;
    }
    return 1.3;
  }

  /** Earthquake rumble with breaking rock; variant 'small' for terraforming. */
  function sQuake(d, t, p) {
    const small = p.variant === 'small';
    const L = small ? 1.6 : 4.2;
    const rg = G(0, d);
    const am = G(0.65, rg);
    O('sine', 3.3, t, t + L + 0.2, G(0.25, am.gain));
    O('sine', 7.1, t, t + L + 0.2, G(0.15, am.gain));
    N('brown', t, t + L + 0.2, F('lowpass', 120, 0.7, am));
    ASR(rg.gain, t, 1.3, small ? 0.1 : 0.45, L * 0.45, L * 0.45);
    const sg = G(0, d);
    const so = O('sine', 34, t, t + L + 0.2, sg);
    so.frequency.linearRampToValueAtTime(28, t + L);
    ASR(sg.gain, t, 0.7, small ? 0.1 : 0.4, L * 0.4, L * 0.45);
    const cracks = small ? 1 : 4;
    for (let i = 0; i < cracks; i++) {
      const tt = t + rnd(0.1, L * 0.6);
      const cg = G(0, d);
      N('white', tt, tt + 0.2, F('bandpass', rnd(500, 1400), 1.2, cg));
      AD(cg.gain, tt, rnd(0.35, 0.6), 0.002, 0.12);
    }
    const tg = G(0, d); // tumbling stones
    N('crackle', t + 0.2, t + L, F('lowpass', 1200, 0.6, tg));
    ASR(tg.gain, t + 0.2, 0.35, 0.3, L * 0.4, L * 0.3);
    return L + 0.3;
  }

  /** Electric zap (force field, Studio strike, gas release). */
  function sZap(d, t, p) {
    const r = p.rate, L = 0.45;
    const g = G(0, d);
    const o = O('sawtooth', 120 * r, t, t + L, F('highpass', 280, 0.7, g));
    O('square', 47, t, t + L, G(70 * r, o.frequency));
    AD(g.gain, t, 0.5, 0.002, 0.38);
    const cg = G(0, d);
    const am = G(0.5, cg);
    O('square', 61, t, t + L, G(0.5, am.gain));
    N('white', t, t + L, F('bandpass', 3400 * r, 0.8, am));
    AD(cg.gain, t, 0.7, 0.001, 0.35);
    const sg = G(0, d);
    const so = O('sine', 2600 * r, t, t + 0.3, sg);
    so.frequency.exponentialRampToValueAtTime(280, t + 0.25);
    AD(sg.gain, t, 0.25, 0.002, 0.25);
    return L + 0.05;
  }

  // Solemn anthem in D minor: Dm - Bb - A - Dm, brass choir + horn melody.
  // [start (beats of 0.9 s), duration, bass midi, upper voices]
  const ANTHEM_CHORDS = [[0, 1.8, 38, [57, 62, 65]], [1.8, 1.8, 34, [58, 62, 65]],
    [3.6, 1.8, 33, [57, 61, 64]], [5.4, 3.0, 38, [57, 62, 65, 69]]];
  const ANTHEM_MELODY = [[0, 0.9, 69], [0.9, 0.9, 74], [1.8, 0.9, 74], [2.7, 0.9, 70],
    [3.6, 0.9, 69], [4.5, 0.9, 73], [5.4, 3.0, 74]];
  function sAnthem(d, t, p) {
    const somber = p.variant === 'somber';
    const semi = Math.round(12 * Math.log(p.rate) / Math.LN2) + (somber ? -3 : 0);
    const sp = somber ? 1.15 : 1;
    for (let i = 0; i < ANTHEM_CHORDS.length; i++) {
      const c = ANTHEM_CHORDS[i];
      const ct = t + c[0] * sp, cd = c[1] * sp;
      brass(d, ct, cd, c[2] + semi, 0.34, 5, false);
      for (let k = 0; k < c[3].length; k++) brass(d, ct + 0.02, cd, c[3][k] + semi, 0.16, 4, false);
    }
    for (let i = 0; i < ANTHEM_MELODY.length; i++) {
      const m = ANTHEM_MELODY[i];
      brass(d, t + m[0] * sp, m[1] * sp - 0.04, m[2] + semi, 0.3, 6, true);
    }
    timp(d, t, mtof(38 + semi), 0.7);
    timp(d, t + 3.6 * sp, mtof(33 + semi), 0.5);
    timp(d, t + 5.4 * sp, mtof(38 + semi), 0.8);
    return 8.4 * sp + 0.8;
  }

  // Victory fanfare in Bb major: [time, dur, melody midi, harmony midi]
  const FANFARE = [[0, 0.11, 65, 62], [0.14, 0.11, 65, 62], [0.28, 0.11, 65, 62], [0.42, 0.42, 70, 65],
    [0.92, 0.2, 74, 70], [1.16, 0.2, 72, 69], [1.42, 1.9, 77, 74]];
  function sVictory(d, t, p) {
    const semi = Math.round(12 * Math.log(p.rate) / Math.LN2);
    for (let i = 0; i < FANFARE.length; i++) {
      const n = FANFARE[i];
      brass(d, t + n[0], n[1], n[2] + semi, 0.34, 9, n[1] > 0.3);
      brass(d, t + n[0], n[1], n[3] + semi, 0.2, 7, false);
    }
    const ct = t + 1.42;
    brass(d, ct, 2.1, 46 + semi, 0.3, 5, false);
    brass(d, ct, 2.1, 53 + semi, 0.14, 5, false);
    brass(d, ct, 2.1, 58 + semi, 0.14, 5, false);
    brass(d, ct, 2.1, 62 + semi, 0.12, 6, false);
    timp(d, t + 0.42, mtof(46 + semi), 0.6);
    for (let i = 0; i < 6; i++) timp(d, t + 1.0 + i * 0.07, mtof(41 + semi), 0.12 + i * 0.05); // roll
    timp(d, ct, mtof(41 + semi), 0.9);
    cymbal(d, ct, 0.32, 2.6);
    return 4.4;
  }

  /** Betrayal sting: rising swell into a dissonant brass stab. */
  function sBetray(d, t, p) {
    const semi = Math.round(12 * Math.log(p.rate) / Math.LN2);
    const sg = G(0, d);
    const sf = F('bandpass', 400, 1.5, sg);
    N('pink', t, t + 0.45, sf);
    glide(sf.frequency, t, 300, 2600, 0.38);
    sg.gain.setValueAtTime(0.001, t);
    sg.gain.exponentialRampToValueAtTime(0.5, t + 0.38);
    sg.gain.linearRampToValueAtTime(0.0001, t + 0.42);
    const st = t + 0.4;
    brass(d, st, 0.5, 40 + semi, 0.3, 4, false);
    brass(d, st, 0.5, 52 + semi, 0.2, 6, false);
    brass(d, st, 0.5, 53 + semi, 0.2, 6, false);
    brass(d, st, 0.5, 58 + semi, 0.2, 6, false);
    timp(d, st, 55, 0.8);
    const wg = G(0, d);
    const wo = O('sine', 740, st + 0.1, st + 1.5, wg);
    wo.frequency.exponentialRampToValueAtTime(330, st + 1.3);
    O('sine', 6, st + 0.1, st + 1.5, G(12, wo.frequency));
    ASR(wg.gain, st + 0.1, 0.12, 0.1, 0.8, 0.45);
    return 2.1;
  }

  /** Announcement chime. variant = announce style: info | danger | gold | gm. */
  function sAnnounce(d, t, p) {
    const v = p.variant, r = p.rate;
    if (v === 'danger') {
      bell(d, t, 440 * r, 0.3, 1.4);
      bell(d, t + 0.34, 311.1 * r, 0.32, 1.8);
      const g = G(0, d);
      O('sawtooth', 55 * r, t, t + 2, F('lowpass', 300, 1, g));
      ASR(g.gain, t, 0.18, 0.1, 1.1, 0.7);
      return 2.2;
    }
    if (v === 'gold') {
      bell(d, t, 523.25 * r, 0.26, 1.2);
      bell(d, t + 0.16, 659.25 * r, 0.26, 1.2);
      bell(d, t + 0.32, 783.99 * r, 0.3, 1.8);
      return 2.1;
    }
    if (v === 'gm') {
      const g = G(0, d);
      const o = O('sine', 520 * r, t, t + 0.35, g);
      o.frequency.exponentialRampToValueAtTime(880 * r, t + 0.18);
      AD(g.gain, t, 0.22, 0.01, 0.3);
      bell(d, t + 0.14, 1174.7 * r, 0.22, 1.2);
      return 1.4;
    }
    bell(d, t, 659.25 * r, 0.3, 1.3);
    bell(d, t + 0.32, 523.25 * r, 0.3, 1.6);
    return 1.9;
  }

  /** Snare trap snapping shut. */
  function sTrap(d, t, p) {
    const r = p.rate;
    const ng = G(0, d);
    N('white', t, t + 0.05, F('highpass', 2200, 0.7, ng));
    AD(ng.gain, t, 0.9, 0.0005, 0.025);
    const mg = G(0, d);
    O('square', 880 * r, t, t + 0.25, F('bandpass', 1500 * r, 4, mg));
    O('sine', 1510 * r, t, t + 0.25, mg);
    AD(mg.gain, t, 0.35, 0.001, 0.18);
    const tg = G(0, d);
    const to = O('sine', 160 * r, t, t + 0.2, tg);
    to.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    AD(tg.gain, t, 0.8, 0.001, 0.12);
    const rg = G(0, d); // spring rattle
    const am = G(0.5, rg);
    O('square', 38, t, t + 0.35, G(0.5, am.gain));
    N('white', t + 0.01, t + 0.35, F('bandpass', 2800, 2, am));
    AD(rg.gain, t + 0.01, 0.25, 0.005, 0.25);
    return 0.4;
  }

  function sBeep(d, t, p) {
    const g = G(0, d);
    O('square', 1000 * p.rate, t, t + 0.16, F('lowpass', 2600, 0.7, g));
    ASR(g.gain, t, 0.3, 0.004, 0.08, 0.04);
    return 0.18;
  }

  /** Short, non-graphic yelp ("ah!"). variant 'f' | 'm'. */
  function sScream(d, t, p) {
    const f = (p.variant === 'f' ? 430 : 285) * p.rate * rnd(0.94, 1.08);
    const L = rnd(0.38, 0.5);
    const env = G(0, d);
    const src = G(1);
    const o = O('sawtooth', f * 0.9, t, t + L + 0.05, src);
    o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(f * 1.12, t + L * 0.7);
    o.frequency.exponentialRampToValueAtTime(f * 0.78, t + L);
    O('sine', 7.5, t, t + L + 0.05, G(f * 0.03, o.frequency));
    src.connect(F('bandpass', 800, 5, G(1.6, env)));    // "ah" formants
    src.connect(F('bandpass', 1250, 7, G(1.0, env)));
    src.connect(F('bandpass', 2700, 9, G(0.5, env)));
    ASR(env.gain, t, 0.55, 0.025, L - 0.16, 0.13);
    const bg = G(0, d);
    N('white', t, t + L, F('bandpass', 1900, 1, bg));
    AD(bg.gain, t, 0.08, 0.01, L * 0.8);
    return L + 0.1;
  }

  /** Gas hiss (poison / madness cloud released). */
  function sGas(d, t, p) {
    const g = G(0, d);
    const f = F('highpass', 2500, 0.5, g);
    N('white', t, t + 2.3, f);
    glide(f.frequency, t, 1800 * p.rate, 4200 * p.rate, 1.5);
    ASR(g.gain, t, 0.45, 0.25, 0.8, 1.1);
    const lg = G(0, d);
    N('pink', t, t + 2.3, F('lowpass', 500, 0.7, lg));
    ASR(lg.gain, t, 0.35, 0.3, 0.6, 1.2);
    return 2.3;
  }

  /** Showrunner console confirm (a power was used). */
  function sPower(d, t, p) {
    const r = p.rate;
    const g = G(0, d);
    const o = O('triangle', 330 * r, t, t + 0.5, F('lowpass', 3000, 1, g));
    o.frequency.exponentialRampToValueAtTime(990 * r, t + 0.18);
    AD(g.gain, t, 0.35, 0.01, 0.4);
    const g2 = G(0, d);
    O('sine', 1320 * r, t + 0.12, t + 0.7, g2);
    AD(g2.gain, t + 0.12, 0.18, 0.005, 0.5);
    const wg = G(0, d);
    const wf = F('bandpass', 800, 1.5, wg);
    N('pink', t, t + 0.4, wf);
    glide(wf.frequency, t, 500, 3500, 0.3);
    AD(wg.gain, t, 0.3, 0.12, 0.2);
    return 0.8;
  }

  /** Time rushing past (time skip). */
  function sWhoosh(d, t, p) {
    const L = 1.1 / p.rate;
    const g = G(0, d);
    const f = F('bandpass', 400, 1.2, g);
    N('pink', t, t + L + 0.05, f);
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + L * 0.55);
    f.frequency.exponentialRampToValueAtTime(600, t + L);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + L * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + L);
    const tg = G(0, d);
    const o = O('sine', 200, t, t + L, tg);
    o.frequency.exponentialRampToValueAtTime(1600, t + L);
    ASR(tg.gain, t, 0.1, L * 0.4, 0.05, L * 0.5);
    return L + 0.1;
  }

  /** Wolf beast dying (short whimper). */
  function sWhimper(d, t, p) {
    const g = G(0, d);
    const o = O('sine', 950 * p.rate, t, t + 0.6, F('lowpass', 2500, 1, g));
    o.frequency.exponentialRampToValueAtTime(620 * p.rate, t + 0.5);
    O('sine', 9, t, t + 0.6, G(40, o.frequency));
    ASR(g.gain, t, 0.3, 0.03, 0.3, 0.2);
    return 0.65;
  }

  /** Songbirds: 4 simple species (variant 0..3, random when omitted). */
  function sBird(d, t, p) {
    const sp = p.variant == null ? Math.floor(Math.random() * 4) : (p.variant | 0) & 3;
    const hp = F('highpass', 1400, 0.7, d);
    const r = p.rate * rnd(0.9, 1.12);
    const g = G(0, hp);
    if (sp === 0) { // falling whistle, twice
      const f = 3300 * r;
      const o = O('sine', f, t, t + 0.7, g);
      for (let k = 0; k < 2; k++) {
        const tt = t + k * 0.36;
        o.frequency.setValueAtTime(f, tt);
        o.frequency.exponentialRampToValueAtTime(f * 0.68, tt + 0.24);
        AD(g.gain, tt, 0.3, 0.02, 0.22);
      }
      return 0.8;
    }
    if (sp === 1) { // trill
      const n = 6 + Math.floor(Math.random() * 5), f = 4100 * r;
      const o = O('sine', f, t, t + n * 0.058 + 0.05, g);
      for (let i = 0; i < n; i++) {
        const tt = t + i * 0.058;
        o.frequency.setValueAtTime(f * 0.85, tt);
        o.frequency.exponentialRampToValueAtTime(f * 1.12, tt + 0.035);
        AD(g.gain, tt, 0.26, 0.006, 0.034);
      }
      return n * 0.058 + 0.1;
    }
    if (sp === 2) { // "tee-oo"
      const f = 3000 * r;
      const o = O('sine', f, t, t + 0.55, g);
      o.frequency.exponentialRampToValueAtTime(f * 1.05, t + 0.14);
      o.frequency.setValueAtTime(f * 0.78, t + 0.2);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.48);
      AD(g.gain, t, 0.25, 0.02, 0.13);
      AD(g.gain, t + 0.2, 0.28, 0.02, 0.28);
      return 0.6;
    }
    const o = O('sine', 2900 * r, t, t + 0.7, g); // warble
    O('sine', rnd(10, 16), t, t + 0.7, G(480 * r, o.frequency));
    ASR(g.gain, t, 0.2, 0.05, 0.4, 0.2);
    return 0.75;
  }

  const OWL_NOTES = [[0, 0.32], [0.55, 0.16], [0.78, 0.5]];
  function sOwl(d, t, p) {
    const f = 370 * p.rate;
    const lp = F('lowpass', 900, 0.7, d);
    for (let i = 0; i < OWL_NOTES.length; i++) {
      const tt = t + OWL_NOTES[i][0], len = OWL_NOTES[i][1];
      const g = G(0, lp);
      const o = O('sine', f * 1.04, tt, tt + len + 0.1, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.96, tt + len);
      ASR(g.gain, tt, 0.35, 0.05, len - 0.1, 0.1);
    }
    return 1.5;
  }

  // ----------------------------------------------------------- sound table
  // bus: fx | ui | music | amb. global: ignores pos (always full level).
  // ref / max: distance model in metres. limit: concurrent voices of this sound.
  // gap: min seconds between two starts (gapDist: only when closer than this, m).
  // prio: 1..10 for voice stealing. send: reverb amount. minAtt: level floor for
  // sounds that carry across the arena. sonic: delay by distance (speed of sound).
  // duck / duckFor: lower the ambience while it plays.
  function D(fn, o) {
    return {
      fn: fn,
      bus: o.bus || 'fx',
      global: !!o.global,
      ref: o.ref || 10,
      max: o.max || 200,
      limit: o.limit || 3,
      gap: o.gap || 0,
      gapDist: o.gapDist || 0,
      prio: o.prio || 3,
      gain: o.gain == null ? 1 : o.gain,
      send: o.send || 0,
      minAtt: o.minAtt || 0,
      sonic: !!o.sonic,
      duck: o.duck || 0,
      duckFor: o.duckFor || 0,
      lt: -1e9, lx: 0, lz: 0, lpos: false,   // last start (for de-duplication)
    };
  }
  const DEFS = {
    knell: D(sKnell, { global: true, limit: 8, gap: 0.3, prio: 10, gain: 1, send: 0.55, duck: 0.35, duckFor: 3 }),
    gong: D(sGong, { bus: 'music', global: true, limit: 1, gap: 2, prio: 10, gain: 0.9, send: 0.6, duck: 0.4, duckFor: 4 }),
    countdown: D(sCountdown, { bus: 'ui', global: true, limit: 2, gap: 0.25, prio: 9, gain: 0.55, send: 0.15 }),
    thunder: D(sThunder, { ref: 70, max: 3000, limit: 3, gap: 0.35, gapDist: 30, prio: 8, gain: 1, send: 0.4, minAtt: 0.22, sonic: true }),
    explosion: D(sExplosion, { ref: 25, max: 700, limit: 4, gap: 0.08, gapDist: 6, prio: 8, gain: 1, send: 0.35, minAtt: 0.05 }),
    fireball: D(sFireball, { ref: 30, max: 500, limit: 5, gap: 0.1, gapDist: 5, prio: 6, gain: 0.7, send: 0.25 }),
    fire: D(sFire, { ref: 14, max: 250, limit: 3, gap: 0.4, gapDist: 20, prio: 5, gain: 0.7, send: 0.2 }),
    hit: D(sHit, { ref: 7, max: 110, limit: 5, gap: 0.03, prio: 4, gain: 0.8, send: 0.12 }),
    clash: D(sClash, { ref: 8, max: 130, limit: 4, gap: 0.05, prio: 4, gain: 0.55, send: 0.2 }),
    swing: D(sSwing, { ref: 5, max: 70, limit: 4, gap: 0.04, prio: 2, gain: 0.45, send: 0.05 }),
    bow: D(sBow, { ref: 7, max: 110, limit: 4, gap: 0.05, prio: 3, gain: 0.6, send: 0.1 }),
    arrowHit: D(sArrowHit, { ref: 7, max: 110, limit: 4, gap: 0.04, prio: 3, gain: 0.7, send: 0.1 }),
    howl: D(sHowl, { ref: 35, max: 800, limit: 2, gap: 1.2, prio: 7, gain: 0.75, send: 0.55, minAtt: 0.12 }),
    growl: D(sGrowl, { ref: 8, max: 120, limit: 3, gap: 0.25, prio: 4, gain: 0.7, send: 0.12 }),
    buzz: D(sBuzz, { ref: 10, max: 160, limit: 3, gap: 0.35, gapDist: 8, prio: 5, gain: 0.6, send: 0.1 }),
    alarm: D(sAlarm, { ref: 40, max: 5000, limit: 1, gap: 2.5, prio: 8, gain: 0.55, send: 0.35, minAtt: 0.45 }),
    click: D(sClick, { bus: 'ui', global: true, limit: 3, gap: 0.03, prio: 1, gain: 0.4 }),
    hover: D(sHover, { bus: 'ui', global: true, limit: 2, gap: 0.045, prio: 1, gain: 0.25 }),
    drop: D(sDrop, { ref: 14, max: 260, limit: 3, gap: 0.15, gapDist: 4, prio: 4, gain: 0.8, send: 0.2 }),
    parachute: D(sParachute, { ref: 18, max: 400, limit: 2, gap: 0.6, gapDist: 6, prio: 5, gain: 0.7, send: 0.3, minAtt: 0.15 }),
    heal: D(sHeal, { ref: 10, max: 150, limit: 2, gap: 0.4, prio: 3, gain: 0.5, send: 0.25 }),
    eat: D(sEat, { ref: 5, max: 60, limit: 2, gap: 0.3, prio: 2, gain: 0.6, send: 0.05 }),
    drink: D(sDrink, { ref: 5, max: 60, limit: 2, gap: 0.3, prio: 2, gain: 0.55, send: 0.05 }),
    splash: D(sSplash, { ref: 10, max: 220, limit: 3, gap: 0.15, gapDist: 4, prio: 4, gain: 0.7, send: 0.2 }),
    quake: D(sQuake, { ref: 60, max: 3000, limit: 2, gap: 0.6, gapDist: 20, prio: 8, gain: 1, send: 0.25, minAtt: 0.3 }),
    zap: D(sZap, { ref: 14, max: 300, limit: 3, gap: 0.1, prio: 5, gain: 0.6, send: 0.2 }),
    anthem: D(sAnthem, { bus: 'music', global: true, limit: 1, gap: 10, prio: 9, gain: 0.5, send: 0.5, duck: 0.45, duckFor: 8 }),
    victory: D(sVictory, { bus: 'music', global: true, limit: 1, gap: 5, prio: 10, gain: 0.6, send: 0.45, duck: 0.45, duckFor: 4 }),
    betray: D(sBetray, { bus: 'music', global: true, limit: 1, gap: 1.2, prio: 7, gain: 0.5, send: 0.4 }),
    announce: D(sAnnounce, { bus: 'ui', global: true, limit: 2, gap: 0.6, prio: 6, gain: 0.45, send: 0.35 }),
    trap: D(sTrap, { ref: 8, max: 140, limit: 3, gap: 0.1, prio: 5, gain: 0.8, send: 0.15 }),
    scream: D(sScream, { ref: 10, max: 160, limit: 3, gap: 0.3, prio: 5, gain: 0.5, send: 0.3 }),
    beep: D(sBeep, { ref: 10, max: 200, limit: 3, gap: 0.08, prio: 3, gain: 0.4, send: 0.15 }),
    gas: D(sGas, { ref: 18, max: 300, limit: 2, gap: 0.5, gapDist: 10, prio: 5, gain: 0.5, send: 0.15 }),
    power: D(sPower, { bus: 'ui', global: true, limit: 2, gap: 0.15, prio: 6, gain: 0.4, send: 0.25 }),
    whoosh: D(sWhoosh, { bus: 'ui', global: true, limit: 2, gap: 0.3, prio: 5, gain: 0.5, send: 0.3 }),
    whimper: D(sWhimper, { ref: 8, max: 120, limit: 2, gap: 0.3, prio: 3, gain: 0.5, send: 0.15 }),
    bird: D(sBird, { bus: 'amb', global: true, limit: 2, gap: 0.4, prio: 1, gain: 0.35, send: 0.3 }),
    owl: D(sOwl, { bus: 'amb', global: true, limit: 1, gap: 5, prio: 1, gain: 0.35, send: 0.45 }),
  };

  // ------------------------------------------------------------- the graph
  const COMBS = [0.0482, 0.0534, 0.0568, 0.0615];
  const COMBS_LOW = [0.0508, 0.0591];

  function build() {
    const low = !!(GM.state.settings && GM.state.settings.quality === 'low');
    maxVoices = low ? MAX_VOICES_LOW : MAX_VOICES_HIGH;
    canPan = typeof ctx.createStereoPanner === 'function';
    curves = makeCurves();
    master = G(0, ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(master);
    mix = G(0.9, comp);
    busFx = G(1, mix);
    busUi = G(0.9, mix);
    busMusic = G(0.85, mix);
    busAmb = G(AMB_LEVEL, mix);
    buildReverb(low);
    // warm up the common buffers so the first sounds do not stutter
    buf('white'); buf('pink'); buf('brown'); buf('crackle');
    makeBeds();
    amb.base = -1;
    tokenTime = ctx.currentTime;
  }

  /** Small outdoor reverb: parallel damped comb filters + a ping-pong "valley" echo. */
  function buildReverb(low) {
    reverbIn = G(1);
    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.02;
    reverbIn.connect(pre);
    const tone = F('lowpass', 5000, 0.4);
    pre.connect(tone);
    const out = G(low ? 0.35 : 0.28, mix);
    const merger = ctx.createChannelMerger(2);
    merger.connect(out);
    const combs = low ? COMBS_LOW : COMBS;
    for (let ch = 0; ch < 2; ch++) {
      const sum = G(1 / combs.length);
      for (let i = 0; i < combs.length; i++) {
        const dl = ctx.createDelay(0.5);
        dl.delayTime.value = combs[i] + ch * 0.0023;
        const damp = F('lowpass', 3000, 0.3);
        const fb = G(0.8);
        tone.connect(dl);
        dl.connect(damp);
        damp.connect(fb);
        fb.connect(dl);
        dl.connect(sum);
      }
      const ap1 = F('allpass', 900 + ch * 170, 0.7);
      const ap2 = F('allpass', 2600 + ch * 310, 0.7);
      sum.connect(ap1);
      ap1.connect(ap2);
      ap2.connect(merger, 0, ch);
    }
    const eL = ctx.createDelay(1), eR = ctx.createDelay(1);
    eL.delayTime.value = 0.31;
    eR.delayTime.value = 0.43;
    const lpL = F('lowpass', 1500, 0.5), lpR = F('lowpass', 1300, 0.5);
    const oL = G(0.45), oR = G(0.45);
    tone.connect(eL);
    eL.connect(lpL); lpL.connect(oL); oL.connect(merger, 0, 0); lpL.connect(G(0.32, eR));
    eR.connect(lpR); lpR.connect(oR); oR.connect(merger, 0, 1); lpR.connect(G(0.32, eL));
  }

  function busOf(def) {
    return def.bus === 'ui' ? busUi : def.bus === 'music' ? busMusic : def.bus === 'amb' ? busAmb : busFx;
  }

  // -------------------------------------------------------------- listener
  const LS = { d: 0, pan: 0 };
  function groundY(x, z) {
    const T = GM.Terrain;
    if (T && typeof T.heightAt === 'function') {
      const y = T.heightAt(x, z);
      if (y === y) return y + 1;
    }
    return 1;
  }
  /**
   * Effective distance from the main camera and stereo pan for a world point.
   * The distance also considers the camera's ground focus point, so things the
   * camera looks at stay audible from high views (overhead / director).
   */
  function listen(pos) {
    const C = GM.Cameras;
    const cam = C && C.main;
    const py = typeof pos.y === 'number' && pos.y === pos.y ? pos.y : groundY(pos.x, pos.z);
    if (!cam || !cam.matrixWorld) { LS.d = 25; LS.pan = 0; return LS; }
    const e = cam.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14];
    const dx = pos.x - cx, dy = py - cy, dz = pos.z - cz;
    const dCam = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let d = dCam;
    const f = C.focusPoint;
    if (f) {
      const fx = pos.x - f.x, fy = py - f.y, fz = pos.z - f.z;
      const kx = cx - f.x, ky = cy - f.y, kz = cz - f.z;
      const alt = Math.sqrt(fx * fx + fy * fy + fz * fz) + 0.3 * Math.sqrt(kx * kx + ky * ky + kz * kz);
      if (alt < d) d = alt;
    }
    let side = 0;
    if (dCam > 0.001) side = (dx * e[0] + dy * e[1] + dz * e[2]) / dCam;
    LS.d = d === d ? d : 25;
    LS.pan = side === side ? U.clamp(side, -1, 1) * 0.85 * U.clamp01(dCam / 4) : 0;
    return LS;
  }
  function atten(def, d) {
    if (d <= def.ref) return 1;
    if (d >= def.max) return 0;
    return (def.ref / d) * (1 - U.smoothstep(def.max * 0.7, def.max, d));
  }
  function cameraAltitude() {
    const C = GM.Cameras;
    if (!C || !C.main || !C.main.matrixWorld) return 0;
    const fy = C.focusPoint ? C.focusPoint.y : 0;
    return U.clamp01((C.main.matrixWorld.elements[13] - fy - 25) / 140);
  }

  // ---------------------------------------------------------------- voices
  function ready() {
    return !!ctx && !muted && (ctx.state === 'running' || resuming);
  }
  const P = { rate: 1, vol: 1, variant: null, dist: 0 };

  /**
   * Play a sound. opts {pos, volume=1, rate=1, delay (s), variant, pan (-1..1, non-positional)}.
   * Returns true if a voice was started.
   */
  function play(name, opts) {
    if (!ready()) return false;
    const def = DEFS[name];
    if (!def) return false;
    opts = opts || EMPTY;
    let vol = opts.volume == null ? 1 : +opts.volume;
    if (!(vol > 0)) return false;
    if (vol > 2) vol = 2;
    let rate = opts.rate == null ? 1 : +opts.rate;
    if (!(rate > 0)) rate = 1;
    rate = U.clamp(rate, 0.25, 4);
    let delay = +opts.delay || 0;
    delay = U.clamp(delay, 0, 20);
    const now = ctx.currentTime;
    let att = 1, dist = 0;
    let pan = +opts.pan || 0;
    const op = opts.pos;
    const pos = !def.global && op && isFinite(op.x) && isFinite(op.z) ? op : null;
    if (pos) {
      const L = listen(pos);
      dist = L.d;
      pan = L.pan;
      att = atten(def, dist);
      if (att < def.minAtt) att = def.minAtt;
      if (def.sonic) delay += Math.min(dist / 343, 1.6) / Math.max(1, Math.sqrt(GM.state.speed || 1));
    }
    const level = vol * att * def.gain;
    if (level < 0.012) return false;
    const t0 = now + 0.006 + delay;

    // de-duplicate bursts (the same event may arrive from a module call and an event)
    if (def.gap > 0 && Math.abs(t0 - def.lt) < def.gap) {
      if (!def.gapDist || !pos || !def.lpos) return false;
      const ddx = pos.x - def.lx, ddz = pos.z - def.lz;
      if (ddx * ddx + ddz * ddz < def.gapDist * def.gapDist) return false;
    }

    // voice limits: per sound, then global (steal the least important voice)
    let same = 0, live = 0, oldest = null, victim = null;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.dead) continue;
      live++;
      if (v.name === name) {
        same++;
        if (!oldest || v.t0 < oldest.t0) oldest = v;
      }
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
    }
    if (same >= def.limit) {
      if (!oldest || oldest.level > level * 1.25 || name === 'knell') return false;
      kill(oldest);
      live--;
      if (victim === oldest) victim = null;
    }
    if (live >= maxVoices) {
      if (!victim || victim.prio > def.prio) return false;
      kill(victim);
    }

    // build the voice chain: sources -> inp -> [distance low-pass] -> [panner] -> bus (+ reverb send)
    const v = { name: name, prio: def.prio, level: level, t0: t0, end: 0, dead: false, srcs: [], inp: null, nodes: null };
    const inp = G(level);
    const nodes = [inp];
    let tail = inp;
    if (pos && dist > def.ref * 1.6) {
      const lp = F('lowpass', U.clamp(22000 * Math.pow(def.ref * 1.6 / dist, 0.85), 900, 16000), 0.4);
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    if (canPan && pan) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = U.clamp(pan, -1, 1);
      tail.connect(sp);
      tail = sp;
      nodes.push(sp);
    }
    tail.connect(busOf(def));
    if (def.send > 0 && reverbIn) {
      const s = G(Math.min(1, def.send + (pos ? 0.35 * (1 - att) : 0)));
      tail.connect(s);
      s.connect(reverbIn);
      nodes.push(s);
    }
    v.inp = inp;
    v.nodes = nodes;
    P.rate = rate;
    P.vol = vol;
    P.variant = opts.variant == null ? null : opts.variant;
    P.dist = pos ? dist : 0;
    const prev = cur;
    cur = v;
    let dur = 1;
    try {
      dur = def.fn(inp, t0, P) || 1;
    } catch (e) {
      cur = prev;
      GM.reportError('Audio.' + name, e);
      v.end = now;
      kill(v);
      release(v);
      return false;
    }
    cur = prev;
    v.end = t0 + dur + 0.15;
    voices.push(v);
    def.lt = t0;
    if (pos) { def.lx = pos.x; def.lz = pos.z; def.lpos = true; } else def.lpos = false;
    if (def.duck) duck(def.duck, def.duckFor || dur, delay);
    return true;
  }

  /** Fade a voice out quickly and stop its sources. */
  function kill(v) {
    if (v.dead) return;
    v.dead = true;
    const now = ctx.currentTime;
    try {
      const g = v.inp.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.04);
    } catch (e) { /* ignore */ }
    for (let i = 0; i < v.srcs.length; i++) {
      try { v.srcs[i].stop(now + 0.05); } catch (e) { /* already stopped */ }
    }
    v.end = Math.min(v.end || now + 0.08, now + 0.08);
  }
  /** Disconnect a finished voice so the graph can be garbage collected. */
  function release(v) {
    if (v.nodes) {
      for (let i = 0; i < v.nodes.length; i++) {
        try { v.nodes[i].disconnect(); } catch (e) { /* ignore */ }
      }
    }
    v.nodes = null;
    v.srcs.length = 0;
    v.dead = true;
  }
  function cleanup() {
    const now = ctx.currentTime;
    let w = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (now >= v.end) release(v);
      else voices[w++] = v;
    }
    voices.length = w;
  }
  /** Stop every playing sound (ambience beds keep running). */
  function stopAll(filter) {
    nextKnell = 0;
    if (!ctx) return;
    for (let i = 0; i < voices.length; i++) {
      if (!filter || filter(voices[i])) kill(voices[i]);
    }
  }
  /** Lower the ambience to `level` (0..1) for `seconds`, starting after `delay`. */
  function duck(level, seconds, delay) {
    if (!ctx || !busAmb) return;
    const t = ctx.currentTime + (delay || 0);
    const base = ambBase();
    const g = busAmb.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(base * U.clamp01(level), t, 0.08);
    g.setTargetAtTime(base, t + Math.max(0.2, seconds || 1), 0.9);
    duckUntil = Math.max(duckUntil, t + (seconds || 1) + 2.5);
    amb.base = -1; // re-apply the ambient level after the duck
  }

  // ---------------------------------------------------------------- ambience
  const amb = { acc: 0, fireAcc: 0, fire: 0, firePan: 0, birdT: 2, owlT: 25, base: -1, beds: null };
  function ambBase() { return AMB_LEVEL * (GM.state.paused ? 0.55 : 1); }

  function bed(builder, tau, pannable) {
    return { build: builder, tau: tau, pannable: pannable, gain: null, pan: null, srcs: null, running: false, target: 0, quiet: 0 };
  }
  function makeBeds() {
    amb.beds = {
      wind: bed(bWind, 2.0, false),
      rain: bed(bRain, 2.5, false),
      storm: bed(bStorm, 2.5, false),
      crickets: bed(bCrickets, 3.0, false),
      cicadas: bed(bCicadas, 3.0, false),
      fire: bed(bFire, 1.2, true),
    };
  }
  /** Cross-fade a bed toward `target`; starts it lazily, stops it after a long silence. */
  function bedSet(b, target) {
    if (target > 0.004) {
      b.quiet = 0;
      if (!b.running) bedStart(b);
    } else if (b.running) {
      b.quiet += AMB_STEP;
      if (b.quiet > b.tau * 4 + 1) { bedStop(b); return; }
    } else {
      return;
    }
    if (Math.abs(target - b.target) > 0.003) {
      b.gain.gain.setTargetAtTime(target, ctx.currentTime, b.tau);
      b.target = target;
    }
  }
  function bedStart(b) {
    const out = G(0);
    let tail = out;
    b.pan = null;
    if (b.pannable && canPan) {
      b.pan = ctx.createStereoPanner();
      out.connect(b.pan);
      tail = b.pan;
    }
    tail.connect(busAmb);
    b.gain = out;
    const prev = cur;
    cur = { srcs: [] };
    try { b.build(out, ctx.currentTime + 0.02); } catch (e) { GM.reportError('Audio.bed', e); }
    b.srcs = cur.srcs;
    cur = prev;
    b.running = true;
    b.target = 0;
    b.quiet = 0;
  }
  function bedStop(b) {
    if (b.srcs) {
      for (let i = 0; i < b.srcs.length; i++) { try { b.srcs[i].stop(); } catch (e) { /* ignore */ } }
    }
    try { if (b.gain) b.gain.disconnect(); } catch (e) { /* ignore */ }
    try { if (b.pan) b.pan.disconnect(); } catch (e) { /* ignore */ }
    b.gain = null; b.pan = null; b.srcs = null;
    b.running = false; b.target = 0; b.quiet = 0;
  }

  function bWind(d, t) {
    const am = G(0.65, d);
    O('sine', 0.11 + Math.random() * 0.05, t, null, G(0.35, am.gain));  // gusts
    const bp = F('bandpass', 420, 0.8, am);
    O('sine', 0.07 + Math.random() * 0.04, t, null, G(220, bp.frequency));
    N('pinkS', t, null, bp);
    N('brownS', t, null, F('lowpass', 260, 0.5, G(0.8, d)));
    const wb = F('bandpass', 1500, 6, G(0.06, am));                     // thin whistle
    O('sine', 0.05, t, null, G(500, wb.frequency));
    N('pinkS', t, null, wb);
  }
  function bRain(d, t) {
    const hp = F('highpass', 650, 0.5);
    hp.connect(F('lowpass', 8500, 0.5, G(0.75, d)));
    N('pinkS', t, null, hp);
    N('dropsS', t, null, F('highpass', 1500, 0.6, G(0.9, d)));
    N('brownS', t, null, F('lowpass', 420, 0.5, G(0.3, d)));
  }
  function bStorm(d, t) {
    const am = G(0.7, d);
    O('sine', 0.06, t, null, G(0.3, am.gain));
    N('brownS', t, null, F('lowpass', 150, 0.6, am));
  }
  function bCrickets(d, t) { N('crickets', t, null, d); }
  function bCicadas(d, t) { N('cicadas', t, null, F('highpass', 2500, 0.5, d)); }
  function bFire(d, t) {
    N('crackleS', t, null, F('highpass', 500, 0.5, G(1.0, d)));
    const am = G(0.6, d);
    O('sine', 0.45, t, null, G(0.3, am.gain));
    N('pinkS', t, null, F('lowpass', 340, 0.7, am));
  }

  // Fire sampling pattern around the camera focus: [dx, dz, weight, ...]
  const RING = (function () {
    const a = [0, 0, 1];
    const rings = [[11, 0.55], [26, 0.28], [48, 0.12]];
    for (let k = 0; k < rings.length; k++) {
      const r = rings[k][0];
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2 + k * 0.4;
        a.push(Math.cos(an) * r, Math.sin(an) * r, rings[k][1]);
      }
    }
    return a;
  })();
  /** Cheap proximity check: ~25 isBurning() lookups every FIRE_STEP seconds. */
  function sampleFire() {
    amb.fire = 0;
    amb.firePan = 0;
    const H = GM.Hazards;
    if (!H || typeof H.isBurning !== 'function') return;
    if (H.fire && typeof H.fire.count === 'number' && H.fire.count <= 0) return;
    const C = GM.Cameras;
    const f = C && C.focusPoint;
    const cx = f ? f.x : 0, cz = f ? f.z : 0;
    let sum = 0, px = 0, pz = 0;
    for (let i = 0; i < RING.length; i += 3) {
      if (H.isBurning(cx + RING[i], cz + RING[i + 1])) {
        const w = RING[i + 2];
        sum += w;
        px += RING[i] * w;
        pz += RING[i + 1] * w;
      }
    }
    if (sum <= 0) return;
    amb.fire = U.clamp01(sum / 2.2) * (1 - 0.5 * cameraAltitude());
    if (C && C.main && C.main.matrixWorld) {
      const e = C.main.matrixWorld.elements;
      const len = Math.sqrt(px * px + pz * pz);
      if (len > 0.01) amb.firePan = U.clamp((px * e[0] + pz * e[2]) / len, -1, 1) * 0.6 * U.clamp01(len / (sum * 12));
    }
  }

  function updateAmbience(step) {
    const st = GM.state;
    if (st.phase === 'boot' || !amb.beds) return;
    const E = GM.Env;
    const weather = (E && typeof E.weather === 'string' && E.weather) || 'clear';
    const tod = typeof st.timeOfDay === 'number' ? st.timeOfDay : 0.5;
    let night = tod < CFG.DAWN || tod > CFG.DUSK;
    if (E && typeof E.isNight === 'function') { try { night = !!E.isNight(); } catch (e) { /* keep fallback */ } }
    let day = night ? 0.1 : 1;
    if (E && typeof E.daylight === 'function') {
      try { const v = +E.daylight(); if (v >= 0) day = v; } catch (e) { /* keep fallback */ }
    }
    let wind = 3;
    if (E && E.wind) { const w = Math.sqrt((E.wind.x || 0) * (E.wind.x || 0) + (E.wind.z || 0) * (E.wind.z || 0)); if (w === w) wind = w; }
    const alt = cameraAltitude();
    const near = 1 - 0.6 * alt;
    const wet = weather === 'rain' || weather === 'storm';
    const B = amb.beds;

    bedSet(B.rain, weather === 'rain' ? 0.5 : weather === 'storm' ? 0.85 : 0);
    let wl = 0.07 + (Math.min(wind, 16) / 16) * 0.28 + alt * 0.25;
    if (weather === 'storm') wl += 0.45;
    else if (weather === 'snow') wl += 0.22;
    else if (weather === 'fog') wl *= 0.6;
    bedSet(B.wind, Math.min(wl, 0.95));
    bedSet(B.storm, weather === 'storm' ? 0.5 : 0);
    const nightF = U.clamp01(1 - day * 1.4);
    bedSet(B.crickets, night && !wet && weather !== 'snow' ? 0.36 * nightF * near * (weather === 'fog' ? 0.6 : 1) : 0);
    bedSet(B.cicadas, weather === 'heat' && !night ? 0.2 * near : 0);

    amb.fireAcc += step;
    if (amb.fireAcc >= FIRE_STEP) { amb.fireAcc = 0; sampleFire(); }
    bedSet(B.fire, amb.fire * 0.9);
    if (B.fire.pan) B.fire.pan.pan.setTargetAtTime(amb.firePan, ctx.currentTime, 0.4);

    amb.birdT -= step;
    if (amb.birdT <= 0) {
      const dawn = Math.abs(tod - CFG.DAWN) < 0.06;
      amb.birdT = rnd(2.5, 7.5) * (dawn ? 0.45 : 1) * (weather === 'fog' ? 1.8 : 1);
      if (!night && day > 0.45 && !wet && weather !== 'snow') {
        play('bird', { volume: rnd(0.45, 1) * near, pan: rnd(-0.85, 0.85), rate: rnd(0.92, 1.1) });
      }
    }
    amb.owlT -= step;
    if (amb.owlT <= 0) {
      amb.owlT = rnd(22, 55);
      if (night && !wet && weather !== 'snow') play('owl', { volume: rnd(0.5, 0.9) * near, pan: rnd(-0.7, 0.7) });
    }

    const base = ambBase();
    if (ctx.currentTime > duckUntil && Math.abs(base - amb.base) > 0.001) {
      busAmb.gain.cancelScheduledValues(ctx.currentTime);
      busAmb.gain.setTargetAtTime(base, ctx.currentTime, 0.6);
      amb.base = base;
    }
  }

  // ------------------------------------------------------ context lifecycle
  const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchend'];
  let hooked = false;
  function onGesture() {
    unlock();
    if (ctx && ctx.state === 'running') removeGestures();
  }
  function addGestures() {
    if (hooked) return;
    hooked = true;
    for (let i = 0; i < GESTURES.length; i++) window.addEventListener(GESTURES[i], onGesture, true);
  }
  function removeGestures() {
    if (!hooked) return;
    hooked = false;
    for (let i = 0; i < GESTURES.length; i++) window.removeEventListener(GESTURES[i], onGesture, true);
  }
  function wantRunning() {
    return unlocked && !muted && !(typeof document !== 'undefined' && document.hidden);
  }

  /**
   * Create (first call) or resume the AudioContext. Call from a user gesture.
   * Returns false when WebAudio is not available.
   */
  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        build();
        ctx.onstatechange = function () {
          if (ctx.state !== 'running' && wantRunning()) addGestures(); // e.g. iOS interruption
        };
      }
      try { // iOS: a silent buffer played inside the gesture unlocks output
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* ignore */ }
      unlocked = true;
      applyRunState();
      return true;
    } catch (e) {
      GM.reportError('Audio.unlock', e);
      return false;
    }
  }
  /** Resume or suspend the context to match mute / tab visibility. */
  function applyRunState() {
    if (!ctx) return;
    applyMaster();
    if (wantRunning()) {
      clearTimeout(suspendTimer);
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        resuming = true;
        let pr = null;
        try { pr = ctx.resume(); } catch (e) { pr = null; }
        if (pr && typeof pr.then === 'function') {
          pr.then(function () {
            resuming = false;
            if (ctx.state === 'running') removeGestures();
          }, function () { resuming = false; });
        } else {
          resuming = false;
        }
      }
    } else if (ctx.state === 'running') {
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(function () { // after the master fade: save CPU while silent
        if (ctx && ctx.state === 'running' && !wantRunning()) { try { ctx.suspend(); } catch (e) { /* ignore */ } }
      }, 150);
    }
  }
  function applyMaster() {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const v = muted ? 0 : Math.pow(volume, 1.6);
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(v, now, 0.04);
  }

  // ------------------------------------------------------------ game events
  const BLADE = { knife: 1, sickle: 1, sword: 1, spear: 1, trident: 1, throwing_knives: 1 };
  const HEAVY = { axe: 1, mace: 1, trident: 1 };
  const ANN_SKIP = { 'ann.victor': 1, 'ann.noVictor': 1 };
  const SCREAM_CAUSES = { weapon: 1, fists: 1, beast: 1, wasps: 1, trap: 1, fire: 1, smite: 1 };

  function takeToken() {
    const now = ctx.currentTime;
    tokens = Math.min(COMBAT_BURST, tokens + (now - tokenTime) * COMBAT_RATE);
    tokenTime = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }
  function validPos(p) { return !!p && isFinite(p.x) && isFinite(p.z); }
  function targetPos(tg) {
    if (!tg) return null;
    if (validPos(tg.pos)) return tg.pos;
    if (validPos(tg)) return tg;
    return null;
  }

  /** Every death fires the knell; several deaths queue shots a moment apart. */
  function onDied(e) {
    if (!ready()) return;
    const now = ctx.currentTime;
    const at = Math.max(now + 0.05, nextKnell);
    if (at - now <= KNELL_QUEUE_MAX && play('knell', { delay: at - now })) nextKnell = at + KNELL_GAP;
    const t = e && e.contestant;
    if (t && validPos(t.pos) && (e.killer || SCREAM_CAUSES[e.cause])) {
      play('scream', { pos: t.pos, volume: 0.7, variant: t.gender === 'f' ? 'f' : 'm' });
    }
  }
  function onAttack(e) {
    if (!e || !ready()) return;
    const a = e.attacker, tg = e.target;
    const pos = (a && validPos(a.pos) && a.pos) || (validPos(e.pos) && e.pos);
    if (!pos) return;
    const hp = (tg && validPos(tg.pos) && tg.pos) || pos;
    // skip far fights before spending the budget
    if (listen(pos).d > DEFS.hit.max && listen(hp).d > DEFS.hit.max) return;
    if (!takeToken()) return;
    const w = e.weapon || null;
    const heavy = !!HEAVY[w];
    const speed = Math.max(1, GM.state.speed || 1);
    if (e.ranged) {
      if (w === 'throwing_knives') play('swing', { pos: pos, rate: 1.6, volume: 0.8 });
      else play('bow', { pos: pos, rate: rnd(0.95, 1.05) });
      if (e.hit && hp !== pos) {
        const delay = U.clamp(U.distXZ(pos, hp) / 45, 0.05, 1.1) / speed;
        if (w === 'throwing_knives' || (tg && tg.kind === 'beast')) play('hit', { pos: hp, delay: delay, variant: 'blade' });
        else play('arrowHit', { pos: hp, delay: delay, rate: rnd(0.92, 1.08) });
      }
      return;
    }
    play('swing', { pos: pos, rate: heavy ? 0.75 : w ? 1.05 : 1.3, volume: w ? 0.9 : 0.6 });
    if (!e.hit) return;
    const armed = w && tg && tg.kind === 'contestant' && tg.inv && tg.inv.melee;
    if (armed && Math.random() < 0.3) {
      play('clash', { pos: hp, delay: 0.05 / speed });
    } else {
      play('hit', {
        pos: hp,
        delay: 0.06 / speed,
        variant: heavy ? 'blunt' : BLADE[w] ? 'blade' : 'body',
        rate: rnd(0.9, 1.1),
        volume: Math.min(1.2, 0.6 + (+e.damage || 10) / 40),
      });
    }
  }
  function onAnnounce(e) {
    if (!e || typeof e.key !== 'string') return;
    // the gong and the fanfare already mark these moments
    if (ANN_SKIP[e.key] || e.key.indexOf('ann.kickoff') === 0) return;
    const s = e.style;
    play('announce', { variant: s === 'danger' || s === 'gold' || s === 'gm' ? s : null });
  }
  function onEnd(e) {
    if (!ready()) return;
    const wait = Math.max(0, nextKnell - ctx.currentTime) + 0.9;
    if (e && e.winner) play('victory', { delay: wait });
    else play('anthem', { delay: wait, variant: 'somber' });
  }
  function onPower(e) {
    if (!e) return;
    const tp = targetPos(e.target);
    switch (e.id) {
      case 'lure':
        for (let i = 0; i < 3; i++) play('beep', { pos: tp, delay: i * 0.22, rate: 1.2 });
        break;
      case 'time_skip': play('whoosh'); break;
      case 'reveal': play('zap', { volume: 0.45, rate: 1.6 }); break;
      case 'smite': play('zap', { pos: tp }); break;
      case 'terraform': play('quake', { pos: tp, variant: 'small', volume: 0.6 }); break;
      case 'shrink_zone': play('alarm', { pos: tp }); break;
      case 'flood': play('splash', { variant: 'big' }); break;
      default: break;
    }
    play('power', { volume: 0.8 });
  }
  function onItemUsed(e) {
    const t = e && e.contestant;
    if (!t || !validPos(t.pos)) return;
    switch (e.type) {
      case 'food':
      case 'berries': play('eat', { pos: t.pos }); break;
      case 'water': play('drink', { pos: t.pos }); break;
      case 'medkit': play('heal', { pos: t.pos }); break;
      case 'trap_kit': play('trap', { pos: t.pos, volume: 0.35, rate: 1.4 }); break;
      default: break;
    }
  }
  function posOf(e) { return e && validPos(e.pos) ? e.pos : null; }

  function initEvents() {
    GM.on('contestant:died', onDied);
    GM.on('game:start', function () { play('gong'); });
    GM.on('countdown:tick', function (e) {
      const n = e && e.n;
      if (n > 0) play('countdown', { rate: n <= 3 ? 1.335 : 1, volume: n <= 3 ? 1 : 0.8 });
    });
    GM.on('combat:attack', onAttack);
    GM.on('hazard:lightning', function (e) { const p = posOf(e); if (p) play('thunder', { pos: p }); });
    GM.on('hazard:explosion', function (e) { const p = posOf(e); if (p) play('explosion', { pos: p }); });
    GM.on('hazard:quake', function (e) { const p = posOf(e); if (p) play('quake', { pos: p }); });
    GM.on('hazard:gas', function (e) { const p = posOf(e); if (p) play('gas', { pos: p }); });
    GM.on('hazard:fire', function (e) { const p = posOf(e); if (p) play('fire', { pos: p, volume: 0.8 }); });
    GM.on('hazard:flood', function () {
      play('splash', { variant: 'big' });
      play('quake', { variant: 'small', volume: 0.5 });
    });
    GM.on('zone:shrink', function (e) {
      const c = e && e.center;
      play('alarm', { pos: validPos(c) ? c : null });
    });
    GM.on('beast:spawned', function (e) {
      const m = e && e.beast;
      if (m && validPos(m.pos)) play(m.type === 'wasps' ? 'buzz' : 'howl', { pos: m.pos });
    });
    GM.on('beast:died', function (e) {
      const m = e && e.beast;
      if (m && m.type === 'wolf' && validPos(m.pos)) play('whimper', { pos: m.pos });
    });
    GM.on('alliance:broken', function (e) { if (e && e.betrayal) play('betray'); });
    GM.on('announce', onAnnounce);
    GM.on('game:end', onEnd);
    GM.on('recap:night', function () { play('anthem'); });
    GM.on('power:used', onPower);
    GM.on('trap:triggered', function (e) { const p = posOf(e); if (p) play('trap', { pos: p }); });
    GM.on('crate:landed', function (e) { const p = posOf(e); if (p) play('drop', { pos: p }); });
    GM.on('gift:sent', function (e) {
      const t = e && e.contestant;
      if (t && validPos(t.pos)) play('parachute', { pos: t.pos });
    });
    GM.on('item:used', onItemUsed);
    GM.on('weather:changed', function (e) {
      if (e && e.type === 'storm' && e.prev !== 'storm') play('thunder', { variant: 'far', volume: 0.7 });
    });
    GM.on('day:start', function () { amb.birdT = 0.4; });  // dawn chorus
    GM.on('game:new', function (e) {
      const s = e && e.settings;
      maxVoices = s && s.quality === 'low' ? MAX_VOICES_LOW : MAX_VOICES_HIGH;
      tokens = COMBAT_BURST;
    });
  }

  // ------------------------------------------------------------- public API
  const Audio = (GM.Audio = {
    unlock: unlock,
    play: play,
    /** Mute / unmute everything (persisted). */
    setMuted: function (b) {
      b = !!b;
      if (b === muted) return;
      muted = b;
      savePrefs();
      applyRunState();
      GM.emit('audio:changed', { muted: muted, volume: volume });
    },
    /** Toggle mute; returns the new muted state. */
    toggleMute: function () {
      Audio.setMuted(!muted);
      return muted;
    },
    /** Master volume 0..1 (persisted). */
    setVolume: function (v) {
      v = U.clamp01(+v || 0);
      if (Math.abs(v - volume) < 1e-4) return;
      volume = v;
      savePrefs();
      applyMaster();
      GM.emit('audio:changed', { muted: muted, volume: volume });
    },
    stopAll: function () { stopAll(null); },
    duck: function (level, seconds) { duck(level, seconds, 0); },
    has: function (name) { return !!DEFS[name]; },
    names: Object.keys(DEFS),
    status: function () {
      return {
        supported: !!(window.AudioContext || window.webkitAudioContext),
        unlocked: !!ctx && ctx.state === 'running',
        state: ctx ? ctx.state : 'none',
        muted: muted,
        volume: volume,
        voices: voices.length,
      };
    },
  });
  Object.defineProperty(Audio, 'muted', {
    get: function () { return muted; },
    set: function (v) { Audio.setMuted(v); },
    enumerable: true,
  });
  Object.defineProperty(Audio, 'volume', {
    get: function () { return volume; },
    set: function (v) { Audio.setVolume(v); },
    enumerable: true,
  });
  Object.defineProperty(Audio, 'unlocked', {
    get: function () { return !!ctx && ctx.state === 'running'; },
    enumerable: true,
  });
  Object.defineProperty(Audio, 'ctx', {
    get: function () { return ctx; },
  });

  // ----------------------------------------------------------------- system
  GM.registerSystem({
    name: 'Audio',
    order: 95,
    init: function () {
      addGestures();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', applyRunState);
      initEvents();
    },
    clear: function () {
      nextKnell = 0;
      amb.fire = 0;
      amb.firePan = 0;
      if (!ctx) return;
      // cut game sounds (a playing fanfare, queued knells); keep UI clicks and ambience
      stopAll(function (v) {
        const d = DEFS[v.name];
        return !d || (d.bus !== 'ui' && d.bus !== 'amb');
      });
    },
    reset: function (settings) {
      maxVoices = settings && settings.quality === 'low' ? MAX_VOICES_LOW : MAX_VOICES_HIGH;
    },
    frame: function (realDt) {
      if (!ctx || ctx.state !== 'running') return;
      if (voices.length) cleanup();
      amb.acc += realDt;
      if (amb.acc >= AMB_STEP) {
        amb.acc -= AMB_STEP;
        if (amb.acc > AMB_STEP) amb.acc = 0;
        updateAmbience(AMB_STEP);
      }
    },
  });
})();
