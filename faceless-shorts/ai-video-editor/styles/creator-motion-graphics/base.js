// Creator Motion Graphics (Kinetic Type) style engine for the ai-video-editor skill.
// Unchanged from the Nafay 3D Style Library reference, except: the player is removed (the skill's player.js replaces it)
// and TL, CUTS, PUNCH, SCENES are declared with var so your story.js can redefine them.
// Everything after the 'STYLE:' banner that draws the demo story (scene functions, explainer, scoreSound) is a worked example.
// =====================================================================================================
// CREATOR MOTION GRAPHICS  ·  core helpers (CM), sound kit (SFX), style, player
// Every frame is a pure function of t. All randomness is seeded. Times are seconds.
// =====================================================================================================
const CM = (() => {
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const hash = (s) => { s = String(s); let h = 0x9e3779b1; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b); h ^= h >>> 13; } return h >>> 0; };
  // xoshiro128** style generator, seeded from a number or string
  const rng = (seed) => {
    const s = typeof seed === 'number' ? seed >>> 0 : hash(seed);
    let a = (s ^ 0xa5a5a5a5) >>> 0, b = (Math.imul(s, 0x27d4eb2d) >>> 0) || 1, c = (0x165667b1 ^ s) >>> 0, d = (rotl(s, 7) >>> 0) || 7;
    const r = () => { const res = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0; const t = b << 9; c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11); return res / 4294967296; };
    for (let i = 0; i < 8; i++) r();
    r.in = (lo, hi) => lo + r() * (hi - lo);
    r.pick = (arr) => arr[(r() * arr.length) | 0];
    return r;
  };
  // smooth 1D value noise, roughly -1..1
  const noise1 = (seed) => { const r = rng(seed), v = Float32Array.from({ length: 256 }, () => r() * 2 - 1); return (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(v[i & 255], v[(i + 1) & 255], u); }; };
  const ez = {
    out3: (u) => 1 - Math.pow(1 - u, 3),
    in3: (u) => u * u * u,
    inout3: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    outExpo: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
    back: (u, s = 1.7) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2)),
    spring: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-6 * u) * Math.cos(13 * u)),
  };
  const layer = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  return { clamp, lerp, span, hash, rng, noise1, ez, layer };
})();

// =====================================================================================================
// SFX: synthesized creator-edit sound kit. Plain Web Audio, no files.
// voiceover mode keeps the music low under narration and plays sounds marked `soft` at 55%.
// =====================================================================================================
const SFX = (() => {
  const SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const hz = (n) => { if (typeof n === 'number') return n; const m = /^([A-G])(#|b)?(-?\d)$/.exec(n); return 440 * Math.pow(2, (SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] - 4) * 12) / 12); };

  function kit(ac, o = {}) {
    const VO = !!o.voiceover, SR = ac.sampleRate, T0 = o.from || 0, base = ac.currentTime + (o.lead || 0);
    // snap every start a little past the sample grid (avoids level spikes on some browsers)
    const at = (t) => (Math.round((base + (t - T0)) * SR) + 0.3) / SR;
    const skip = (t, dur) => at(t) + dur < ac.currentTime || (t < T0 - 0.005 && dur < 1.2);

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    const master = ac.createGain(); master.gain.value = o.master == null ? 0.85 : o.master;
    comp.connect(master); master.connect(o.dest || ac.destination);
    const mk = (g) => { const n = ac.createGain(); n.gain.value = g; n.connect(comp); return n; };
    const bus = { fx: mk(VO ? 0.78 : 0.95), music: mk(VO ? 0.3 : 0.62), amb: mk(0.45) };
    const duckIn = ac.createGain(); duckIn.connect(bus.music);
    const DUCKS = [];

    // generated plate-style reverb
    const verb = ac.createConvolver();
    { const n = Math.floor(1.5 * SR), ir = ac.createBuffer(2, n, SR);
      for (let ch = 0; ch < 2; ch++) { const r = CM.rng('plate' + ch), d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const u = i / n; lp += (0.7 - 0.5 * u) * ((r() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - u, 2.6) * 0.9; } }
      verb.buffer = ir; }
    const verbIn = ac.createGain(); verbIn.gain.value = 0.8; verbIn.connect(verb); verb.connect(comp);

    // seeded noise buffers
    const NB = {};
    { const n = Math.floor(2 * SR);
      for (const kind of ['white', 'pink', 'brown']) {
        const b = ac.createBuffer(1, n, SR), d = b.getChannelData(0), r = CM.rng('nz' + kind); let b0 = 0, b1 = 0, b2 = 0, br = 0;
        for (let i = 0; i < n; i++) { const w = r() * 2 - 1;
          if (kind === 'white') d[i] = w;
          else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
          else { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.4; } }
        NB[kind] = b; } }

    const ramp = (param, v, t) => { if (!Array.isArray(v)) { param.setValueAtTime(v, t); return; } param.setValueAtTime(v[0][1], t + v[0][0]); for (let i = 1; i < v.length; i++) param.exponentialRampToValueAtTime(Math.max(1e-3, v[i][1]), t + v[i][0]); };
    const env = (g, t, peak, dur, a = 0.004, hold = 0) => {
      a = Math.min(a, dur * 0.9); hold = Math.min(hold, dur - a);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dur); g.gain.setValueAtTime(0, t + dur + 0.002);
    };
    const level = (p, d) => (p.gain == null ? d : p.gain) * (VO && p.soft ? 0.55 : 1);
    const route = (node, p, t) => {
      const pan = ac.createStereoPanner();
      if (Array.isArray(p.pan)) { pan.pan.setValueAtTime(p.pan[0], t); pan.pan.linearRampToValueAtTime(p.pan[1], t + (p.dur || 0.2)); } else pan.pan.value = CM.clamp(p.pan || 0, -1, 1);
      node.connect(pan); pan.connect(p.bus === 'music' ? duckIn : bus[p.bus || 'fx']);
      if (p.verb) { const s = ac.createGain(); s.gain.value = p.verb; pan.connect(s); s.connect(verbIn); }
    };
    const filt = (p, t) => { if (!p.filter) return null; const f = ac.createBiquadFilter(); f.type = p.filter; f.Q.value = p.q == null ? 0.9 : p.q; ramp(f.frequency, p.ff == null ? 1200 : p.ff, t); return f; };

    // primitive: oscillator voice. f may be a value or [[dt, hz], ...]
    function voice(time, p) {
      const dur = p.dur || 0.2; if (skip(time, dur)) return; const t = at(time);
      const osc = ac.createOscillator(); osc.type = p.type || 'sine';
      ramp(osc.frequency, Array.isArray(p.f) ? p.f.map(([d, v]) => [d, hz(v)]) : hz(p.f || 440), t);
      const g = ac.createGain(); env(g, t, level(p, 0.3), dur, p.a, p.hold);
      const f = filt(p, t); if (f) { osc.connect(f); f.connect(g); } else osc.connect(g);
      route(g, p, t); osc.start(t); osc.stop(t + dur + 0.03);
    }
    // primitive: noise voice
    function hiss(time, p) {
      const dur = p.dur || 0.2; if (skip(time, dur)) return; const t = at(time);
      const src = ac.createBufferSource(); src.buffer = NB[p.color || 'white']; src.loop = true; if (p.rate) src.playbackRate.value = p.rate;
      const g = ac.createGain(); env(g, t, level(p, 0.3), dur, p.a, p.hold);
      const f = filt(p, t); if (f) { src.connect(f); f.connect(g); } else src.connect(g);
      route(g, p, t); src.start(t, CM.rng('off' + time)() * 1.5); src.stop(t + dur + 0.03);
    }
    function duck(t, depth = 0.5, hold = 0.25) { DUCKS.push({ t, depth, hold }); }

    // ---------------- named sounds (creator-edit palette) ----------------
    const S = {
      // text slam: a tight low thump with a short papery crack
      slam: (t, o) => { voice(t, { f: [[0, 150], [0.12, 52]], dur: 0.2, gain: 0.42 * o.g, pan: o.pan, soft: o.soft }); hiss(t, { dur: 0.07, filter: 'lowpass', ff: 2600, gain: 0.22 * o.g, pan: o.pan, soft: o.soft }); hiss(t, { dur: 0.012, filter: 'highpass', ff: 5000, gain: 0.12 * o.g, pan: o.pan, soft: o.soft }); },
      // big drop: sub boom with a dark tail
      boom: (t, o) => { voice(t, { f: [[0, 90], [0.08, 52], [1.6, 34]], dur: 1.7, gain: 0.7 * o.g, a: 0.006, hold: 0.12 }); hiss(t, { color: 'brown', dur: 0.6, filter: 'lowpass', ff: [[0, 600], [0.5, 90]], gain: 0.35 * o.g, verb: 0.3 }); duck(t, 0.7, 0.35); },
      pop: (t, o) => { const f = o.f || 760; voice(t, { f: [[0, f * 1.7], [0.05, f]], dur: 0.08, gain: 0.22 * o.g, pan: o.pan, soft: o.soft }); hiss(t, { dur: 0.01, filter: 'highpass', ff: 4500, gain: 0.08 * o.g, pan: o.pan, soft: o.soft }); },
      tick: (t, o) => hiss(t, { dur: 0.016, filter: 'bandpass', ff: o.f || 3800, q: 3, gain: 0.32 * o.g, pan: o.pan, soft: o.soft }),
      click: (t, o) => { hiss(t, { dur: 0.012, filter: 'bandpass', ff: 3200, q: 2, gain: 0.35 * o.g, pan: o.pan }); hiss(t + 0.045, { dur: 0.01, filter: 'bandpass', ff: 2400, q: 2, gain: 0.22 * o.g, pan: o.pan }); },
      whoosh: (t, o) => { const d = o.dur || 0.35, dir = o.dir || 1; hiss(t, { color: 'pink', dur: d, filter: 'bandpass', ff: [[0, 260], [d * 0.55, o.top || 3200], [d, 520]], q: 0.75, gain: 0.5 * o.g, a: d * 0.55, pan: [-0.7 * dir, 0.7 * dir], verb: 0.12, soft: o.soft }); hiss(t + d * 0.2, { dur: d * 0.6, filter: 'highpass', ff: [[0, 3000], [d * 0.6, 7000]], gain: 0.08 * o.g, a: d * 0.3, pan: [-0.4 * dir, 0.5 * dir], soft: o.soft }); },
      riser: (t, o) => { const d = o.dur || 0.8; hiss(t, { color: 'pink', dur: d, filter: 'bandpass', ff: [[0, 300], [d, 5200]], q: 1.1, gain: 0.32 * o.g, a: d * 0.96, verb: 0.2, soft: o.soft }); voice(t, { type: 'sawtooth', f: [[0, 110], [d, 440]], dur: d, gain: 0.06 * o.g, a: d * 0.95, filter: 'lowpass', ff: [[0, 400], [d, 2400]], soft: o.soft }); },
      glitch: (t, o) => { const r = CM.rng('gl' + t); for (let i = 0; i < 9; i++) voice(t + i * 0.021, { type: 'square', f: 180 + r() * 2200, dur: 0.018, gain: 0.07 * o.g, a: 0.001, hold: 0.012, pan: r() * 1.4 - 0.7 }); hiss(t, { dur: 0.2, filter: 'bandpass', ff: [[0, 4000], [0.2, 900]], q: 0.7, gain: 0.18 * o.g }); hiss(t + 0.1, { dur: 0.05, color: 'brown', gain: 0.25 * o.g }); },
      ping: (t, o) => { voice(t, { f: 'E6', dur: 0.5, gain: 0.16 * o.g, a: 0.003, verb: 0.3, pan: o.pan }); voice(t + 0.11, { f: 'B6', dur: 0.7, gain: 0.14 * o.g, a: 0.003, verb: 0.35, pan: o.pan }); },
      send: (t, o) => { voice(t, { f: [[0, 520], [0.11, 1500]], dur: 0.13, gain: 0.14 * o.g, pan: o.pan }); hiss(t, { dur: 0.1, filter: 'highpass', ff: [[0, 2000], [0.1, 6000]], gain: 0.07 * o.g, pan: o.pan }); },
      keys: (t, o) => { const r = CM.rng('k' + t), end = t + (o.dur || 0.4); for (let x = t; x < end; x += 0.055 + r() * 0.035) { hiss(x, { dur: 0.014, filter: 'bandpass', ff: 3200 + r() * 900, q: 3, gain: 0.2 * o.g, pan: o.pan, soft: true }); voice(x, { f: 1900 + r() * 300, dur: 0.012, gain: 0.025 * o.g, pan: o.pan, soft: true }); } },
      // highlighter / marker swipe: grainy felt drag
      marker: (t, o) => { const d = o.dur || 0.25, r = CM.rng('m' + t); for (let x = 0; x < d; x += 0.022 + r() * 0.012) hiss(t + x, { dur: 0.03, filter: 'bandpass', ff: 1700 + r() * 900, q: 1.4, gain: 0.16 * o.g * (0.6 + r() * 0.5), pan: o.pan, soft: o.soft }); },
      strike: (t, o) => { hiss(t, { dur: 0.15, filter: 'bandpass', ff: [[0, 1200], [0.15, 3200]], q: 1.2, gain: 0.3 * o.g, a: 0.02, pan: o.pan }); },
      tapeStop: (t, o) => { voice(t, { type: 'sawtooth', f: [[0, 196], [0.62, 18]], dur: 0.66, gain: 0.22 * o.g, a: 0.004, hold: 0.3, filter: 'lowpass', ff: [[0, 1800], [0.6, 160]] }); voice(t, { f: [[0, 98], [0.62, 12]], dur: 0.66, gain: 0.3 * o.g, a: 0.004, hold: 0.3 }); hiss(t, { color: 'brown', dur: 0.5, filter: 'lowpass', ff: [[0, 900], [0.5, 120]], gain: 0.18 * o.g }); },
      stamp: (t, o) => { voice(t, { f: [[0, 160], [0.18, 48]], dur: 0.28, gain: 0.6 * o.g }); hiss(t, { dur: 0.06, filter: 'bandpass', ff: 1300, q: 1.1, gain: 0.4 * o.g }); hiss(t + 0.004, { dur: 0.014, filter: 'highpass', ff: 4200, gain: 0.25 * o.g }); },
      shimmer: (t, o) => { ['C6', 'E6', 'G6', 'B6', 'D7', 'E7'].forEach((n, i) => voice(t + i * 0.035, { f: n, dur: 0.75, gain: 0.045 * o.g, a: 0.003, verb: 0.45, pan: (i % 2 ? 0.35 : -0.35) })); },
      sparkle: (t, o) => { const r = CM.rng('sp' + t); for (let i = 0; i < 5; i++) voice(t + i * 0.05, { f: 2400 + r() * 2400, dur: 0.25, gain: 0.03 * o.g, a: 0.002, verb: 0.4, pan: r() * 1.2 - 0.6 }); },
    };
    function play(name, t, opts = {}) { const fn = S[name]; if (!fn) throw new Error('unknown sound ' + name); fn(t, Object.assign({}, opts, { g: opts.gain == null ? 1 : opts.gain })); }

    // ---------------- music: half-time beat with bass and soft pad ----------------
    function music(t0, t1, p = {}) {
      const bpm = p.bpm || 98, step = 60 / bpm / 4, bar = step * 16, g = p.gain == null ? 1 : p.gain;
      const roots = p.roots || ['A1', 'F1', 'C2', 'G1'];
      const pads = p.pads || [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['C4', 'E4', 'G4'], ['G3', 'B3', 'D4']];
      let bi = 0;
      for (let tb = t0; tb < t1 - 0.05; tb += bar, bi++) {
        const root = roots[bi % roots.length], pad = pads[bi % pads.length], blen = Math.min(bar, t1 - tb);
        pad.forEach((n, k) => voice(tb, { type: 'triangle', f: n, dur: blen + 0.2, gain: 0.03 * g, a: 0.3, hold: blen - 0.5, filter: 'lowpass', ff: 1100, pan: (k - 1) * 0.35, verb: 0.3, bus: 'music' }));
        for (let s = 0; s < 16; s++) {
          const ts = tb + s * step; if (ts >= t1 - 0.02) break;
          if (s === 0 || s === 10) { voice(ts, { f: [[0, 150], [0.09, 46]], dur: 0.32, gain: 0.5 * g, bus: 'music' }); hiss(ts, { dur: 0.012, filter: 'highpass', ff: 3000, gain: 0.05 * g, bus: 'music' }); }
          if (s === 4 || s === 12) { hiss(ts, { dur: 0.16, filter: 'bandpass', ff: 1700, q: 0.8, gain: 0.26 * g, verb: 0.25, bus: 'music' }); hiss(ts + 0.008, { dur: 0.05, filter: 'highpass', ff: 4500, gain: 0.1 * g, bus: 'music' }); }
          if (s % 2 === 0) hiss(ts, { dur: s % 4 === 2 ? 0.05 : 0.028, filter: 'highpass', ff: 7500, gain: (s % 4 === 2 ? 0.06 : 0.035) * g, bus: 'music' });
          if ([0, 3, 6, 10, 14].includes(s)) voice(ts, { type: 'triangle', f: root, dur: step * 2.6, gain: 0.2 * g, a: 0.006, hold: step, filter: 'lowpass', ff: 380, bus: 'music' });
        }
      }
    }
    function drone(t0, t1, p = {}) { const d = t1 - t0, g = p.gain == null ? 1 : p.gain; voice(t0, { f: p.note || 'A1', dur: d, gain: 0.12 * g, a: d * 0.4, hold: d * 0.4, bus: 'music' }); hiss(t0, { color: 'pink', dur: d, filter: 'bandpass', ff: 900, q: 0.5, gain: 0.03 * g, a: d * 0.5, hold: d * 0.3, bus: 'amb' }); }
    function finish() {
      DUCKS.sort((a, b) => a.t - b.t);
      for (const e of DUCKS) { const s = at(e.t); if (s + e.hold < ac.currentTime) continue; duckIn.gain.setTargetAtTime(1 - e.depth, Math.max(s, ac.currentTime), 0.008); duckIn.gain.setTargetAtTime(1, s + e.hold, 0.14); }
    }
    return { play, voice, hiss, music, drone, duck, finish, hz, vo: VO };
  }
  function live(score, from, opts = {}) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const k = kit(ac, Object.assign({}, opts, { from: from || 0, lead: 0.04 })); score(k); k.finish();
    return () => { try { ac.close(); } catch (e) {} };
  }
  async function render(score, dur, sr = 48000, opts = {}) {
    const len = Math.ceil(dur * sr), ac = new OfflineAudioContext(2, len, sr);
    const k = kit(ac, Object.assign({}, opts, { from: 0 })); score(k); k.finish();
    const buf = await ac.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), inter = new Float32Array(len * 2);
    let peak = 0; for (let i = 0; i < len; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    return { inter, peak, sr, frames: len };
  }
  return { kit, live, render, hz };
})();

// =====================================================================================================
// STYLE: Creator Motion Graphics
// Kinetic captions slam in word by word, punch zooms and shake on emphasis, highlighter swipes,
// hand-drawn circles and arrows, perspective mockups, rolling counters, whip / glitch cuts, film grain.
// Demo topic: "How to land your first client".
// =====================================================================================================
const W = 1280, HH = 720;
const { clamp, lerp, span, rng, noise1, ez } = CM;
const C = { bg: '#09090a', ink: '#f4f1ea', dim: '#8e8d94', mute: '#3b3b41', panel: '#151518', panel2: '#1d1d21', line: '#2b2b31', hi: '#ffd60a', money: '#3dff8f', red: '#ff3b30', black: '#0b0b0c' };
const F = { disp: '"Anton", "Bebas Neue", Impact, sans-serif', body: '"Inter", system-ui, sans-serif', serif: '"Instrument Serif", Georgia, serif' };
const disp = (px) => `${px}px ${F.disp}`, inter = (px, w = 600) => `${w} ${px}px ${F.body}`, serif = (px) => `italic ${px}px ${F.serif}`;

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 21.5,
  hook: { w1: [0.15, 0.36, 0.57], w2: [0.82, 1.04], strike: 1.38, shift: 1.55, need: 1.62, reps: 1.84, under: 2.05 },
  skill: { pill: 2.95, w: [3.02, 3.18, 3.36], chips: [3.6, 3.75, 3.9], drop: 4.45, pick: 4.7, ring: 4.8, just: 5.25, arrow: 5.32 },
  build: { pill: 6.42, w: [6.42, 6.62, 6.75], br: 6.45, sub: 7.0, cards: [7.35, 7.6, 7.85], hl: 8.15, cur: 8.3, click: 8.8 },
  dm: { pill: 10.36, w: [10.36, 10.55, 10.75], phone: 10.3, type: [10.9, 11.35], send: 11.4, cnt: [11.5, 13.0], seen: 11.9, dots: [12.05, 12.55], reply: 12.6, ring: 12.85 },
  math: { w: [13.62, 13.78, 13.94, 14.12], cnt: [14.3, 15.35], lock: 15.35, conv: 15.5, sub: 15.8 },
  wrong: { w: [16.86, 17.0, 17.14, 17.28], strike: [17.55, 17.63], stamp: 17.8 },
  take: { vol: 18.78, hl: 19.0, w: [19.2, 19.42], line: 20.0 },
};
// cuts between scenes: [start, duration, type]
var CUTS = [
  { t: 2.6, d: 0.28, type: 'whip', dir: 1 },
  { t: 6.1, d: 0.22, type: 'glitch' },
  { t: 10.0, d: 0.26, type: 'whipV', dir: 1 },
  { t: 13.4, d: 0.14, type: 'flash' },
  { t: 16.6, d: 0.2, type: 'glitch' },
  { t: 18.45, d: 0.25, type: 'whip', dir: -1 },
];
// camera kicks: punch zoom and shake
var PUNCH = [
  { t: 0.15, a: 0.025 }, { t: 0.36, a: 0.025 }, { t: 0.57, a: 0.03 }, { t: 0.82, a: 0.045 }, { t: 1.04, a: 0.075 }, { t: 1.84, a: 0.09 },
  { t: 3.36, a: 0.03 }, { t: 4.7, a: 0.04 }, { t: 6.75, a: 0.035 }, { t: 10.75, a: 0.03 }, { t: 12.6, a: 0.05 },
  { t: 14.12, a: 0.03 }, { t: 15.35, a: 0.12, k: 1.6 }, { t: 17.8, a: 0.07 }, { t: 18.78, a: 0.1 }, { t: 19.42, a: 0.05 },
];
const SHAKE = [{ t: 1.04, a: 7 }, { t: 1.84, a: 13 }, { t: 4.7, a: 5 }, { t: 12.6, a: 6 }, { t: 15.35, a: 18, k: 6 }, { t: 17.8, a: 16 }, { t: 18.78, a: 12 }];
const FLASH = [{ t: 1.84, a: 0.22 }, { t: 13.47, a: 0.0 }, { t: 15.35, a: 0.55 }, { t: 17.8, a: 0.35, col: '255,59,48' }, { t: 18.78, a: 0.25 }];
const LEAK = [1.84, 15.35, 18.78];

// shared value curves (picture and sound)
const dmCount = (t) => (t < TL.dm.cnt[0] ? 1 : 1 + Math.floor(19 * ez.out3(span(t, TL.dm.cnt[0], TL.dm.cnt[1])) + 1e-9));
const mathCount = (t) => Math.round(600 * ez.out3(span(t, TL.math.cnt[0], TL.math.cnt[1])));

// ---------- text helpers ----------
const word = (s, t, font, color, extra) => Object.assign({ s, t, font, color: color || C.ink }, extra || {});
function measure(c, it) { c.font = it.font; c.letterSpacing = it.track || '0px'; const w = c.measureText(it.s).width; c.letterSpacing = '0px'; return w; }
function row(c, items, x, y, gap, align = 'center') {
  let tot = 0; items.forEach((it) => { it.w = measure(c, it); tot += it.w; }); tot += gap * (items.length - 1);
  let cx = align === 'center' ? x - tot / 2 : x;
  items.forEach((it) => { it.x = cx; it.cx = cx + it.w / 2; it.y = y; cx += it.w + gap; });
  return { x0: align === 'center' ? x - tot / 2 : x, w: tot };
}
// a word slams in: big, blurred, settles with an expo ease
function slam(c, it, t, o = {}) {
  if (t < it.t) return;
  const u = span(t, it.t, it.t + (o.dur || 0.2)), e = ez.outExpo(u), s = lerp(o.from || 1.42, 1, e);
  c.save(); c.translate(it.cx, it.y); c.scale(s, s);
  c.globalAlpha = (o.alpha == null ? 1 : o.alpha) * Math.min(1, u * 3.5);
  if (u < 1 && !o.noBlur) { const b = (1 - e) * 9; if (b > 0.5) c.filter = `blur(${b.toFixed(1)}px)`; }
  c.font = it.font; c.letterSpacing = it.track || '0px'; c.textAlign = 'center'; c.textBaseline = it.base || 'middle';
  if (o.glow) { c.shadowColor = o.glow; c.shadowBlur = o.glowBlur || 40; }
  c.fillStyle = o.color || it.color; c.fillText(it.s, 0, 0);
  c.restore();
}
// highlighter swipe behind a word; returns the swipe path so the word can turn dark inside it
function swipe(c, it, t, t0, dur, o = {}) {
  const p = ez.out3(span(t, t0, t0 + dur)); if (p <= 0) return null;
  const px = parseFloat(/(\d+)px/.exec(it.font)[1]), h = (o.h || 0.8) * px, pad = o.pad || 18, y = it.y + (o.dy || 0) - h / 2;
  const x = it.x - pad, w = (it.w + pad * 2) * p, r = rng('sw' + t0);
  const path = new Path2D();
  path.moveTo(x + r.in(0, 6), y + r.in(0, 5)); path.lineTo(x + w, y + r.in(-4, 2));
  path.lineTo(x + w + r.in(-5, 3), y + h + r.in(-2, 4)); path.lineTo(x + r.in(2, 8), y + h + r.in(-3, 2)); path.closePath();
  c.save(); c.fillStyle = o.color || C.hi; c.fill(path); c.restore();
  return path;
}
function slamMarked(c, it, t, path, o = {}) {
  slam(c, it, t, o);
  if (!path) return;
  c.save(); c.clip(path); slam(c, it, t, Object.assign({}, o, { color: C.black, glow: null })); c.restore();
}
function strike(c, x0, x1, y, p, col = C.red, w = 12, tilt = -0.025) {
  if (p <= 0) return; const e = ez.out3(clamp(p)), x = lerp(x0, x1, e);
  c.save(); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.shadowColor = col; c.shadowBlur = 12;
  c.beginPath(); c.moveTo(x0, y); c.lineTo(x, y + (x - x0) * tilt); c.stroke(); c.restore();
}
// hand-drawn loop around a thing, drawn on to progress p
function scribble(c, cx, cy, rx, ry, p, col, w, seed) {
  if (p <= 0) return; const n = noise1(seed), N = 96, turns = 1.1, a0 = -2.4, m = Math.max(2, Math.ceil(N * clamp(p)));
  c.save(); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i <= m; i++) { const u = i / N, a = a0 + u * turns * Math.PI * 2, k = 1 + 0.07 * n(u * 5 + seed) + 0.05 * u; const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke(); c.restore();
}
function handArrow(c, p0, q, p1, p, col, w) {
  if (p <= 0) return; const N = 30, m = Math.max(2, Math.round(N * clamp(p))), pts = [];
  for (let i = 0; i <= m; i++) { const u = i / N, v = 1 - u; pts.push([v * v * p0[0] + 2 * v * u * q[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * q[1] + u * u * p1[1]]); }
  c.save(); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); pts.forEach((q2, i) => (i ? c.lineTo(q2[0], q2[1]) : c.moveTo(q2[0], q2[1]))); c.stroke();
  if (p >= 0.92) { const a = pts[pts.length - 1], b = pts[pts.length - 4], an = Math.atan2(a[1] - b[1], a[0] - b[0]), hl = 22;
    c.beginPath(); c.moveTo(a[0] - Math.cos(an - 0.55) * hl, a[1] - Math.sin(an - 0.55) * hl); c.lineTo(a[0], a[1]); c.lineTo(a[0] - Math.cos(an + 0.55) * hl, a[1] - Math.sin(an + 0.55) * hl); c.stroke(); }
  c.restore();
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function wrap(c, text, maxW) { const out = []; let line = ''; for (const wd of text.split(' ')) { const test = line ? line + ' ' + wd : wd; if (c.measureText(test).width > maxW && line) { out.push(line); line = wd; } else line = test; } if (line) out.push(line); return out; }

// ---------- background, camera, finishing ----------
function background(c, t) {
  c.fillStyle = C.bg; c.fillRect(0, 0, W, HH);
  const glow = (x, y, r, col) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, HH); };
  glow(260 + Math.sin(t * 0.35) * 90, 180 + Math.cos(t * 0.27) * 40, 620, 'rgba(255,214,10,0.055)');
  glow(1050 + Math.cos(t * 0.31) * 70, 560 + Math.sin(t * 0.22) * 50, 640, 'rgba(90,120,255,0.05)');
  // faint editor grid, drifting
  c.save(); c.strokeStyle = 'rgba(244,241,234,0.032)'; c.lineWidth = 1; c.beginPath();
  const off = (t * 8) % 80; for (let x = -off; x < W; x += 80) { c.moveTo(x, 0); c.lineTo(x, HH); } for (let y = -off * 0.5; y < HH; y += 80) { c.moveTo(0, y); c.lineTo(W, y); } c.stroke(); c.restore();
  // red room for the "wrong" beat
  const red = span(t, 16.75, 17.0) * (1 - span(t, 18.4, 18.6)) * (0.6 + 0.4 * span(t, 17.55, 17.8));
  if (red > 0) glow(640, 380, 760, `rgba(255,40,30,${0.16 * red})`);
}
const NX = noise1(11), NY = noise1(23), NR = noise1(37);
// scene-level slow push and focus, per scene index
const PUSH = [[0, 2.6], [2.88, 6.1], [6.32, 10.0], [10.26, 13.4], [13.54, 16.6], [16.8, 18.45], [18.7, 21.5]];
function camera(t, si) {
  let z = 1, dx = 0, dy = 0, rot = 0;
  const [a, b] = PUSH[si]; z *= 1 + 0.035 * ez.inout3(span(t, a, b));
  if (si === 1) z *= 1 + 0.08 * ez.inout3(span(t, TL.skill.pick, TL.skill.pick + 0.35)); // lean in on the chosen chip
  for (const k of PUNCH) { const d = t - k.t; if (d < 0) continue; const e = d < 0.06 ? ez.out3(d / 0.06) : Math.exp(-(d - 0.06) * (k.k || 2.6)); z += k.a * e; }
  for (const k of SHAKE) { const d = t - k.t; if (d < 0 || d > 1.4) continue; const e = k.a * Math.exp(-d * (k.k || 8)); dx += e * NX(t * 34 + k.t * 5); dy += e * NY(t * 37 + k.t * 3); rot += e * 0.0015 * NR(t * 26 + k.t); }
  const fy = si === 1 ? lerp(360, 410, ez.inout3(span(t, TL.skill.pick, TL.skill.pick + 0.35))) : 360;
  return { z, dx, dy, rot, fx: 640, fy };
}
const applyCam = (c, k) => { c.translate(640 + k.dx, 360 + k.dy); c.rotate(k.rot); c.scale(k.z, k.z); c.translate(-k.fx, -k.fy); };

let GRAIN = null;
function grainTiles() { if (GRAIN) return GRAIN; GRAIN = []; for (let g = 0; g < 4; g++) { const L = CM.layer(256, 256), x = L.getContext('2d'), img = x.createImageData(256, 256), r = rng('grain' + g); for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (r() + r() - 1) * 120; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } x.putImageData(img, 0, 0); GRAIN.push(L); } return GRAIN; }
function finishing(c, t) {
  // light leaks on the big moments
  for (const t0 of LEAK) { const u = span(t, t0, t0 + 0.95); if (u <= 0 || u >= 1) continue; const e = Math.sin(Math.PI * u);
    c.save(); c.globalCompositeOperation = 'screen'; const x = lerp(-150, 1450, ez.out3(u)), g = c.createRadialGradient(x, 120, 0, x, 120, 760);
    g.addColorStop(0, `rgba(255,150,50,${0.42 * e})`); g.addColorStop(0.45, `rgba(255,70,40,${0.16 * e})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, HH); c.restore(); }
  // flashes
  for (const f of FLASH) { const d = t - f.t; if (d < 0 || d > 0.4 || !f.a) continue; c.fillStyle = `rgba(${f.col || '255,255,255'},${f.a * Math.exp(-d * 11)})`; c.fillRect(0, 0, W, HH); }
  // vignette
  const v = c.createRadialGradient(640, 360, 260, 640, 360, 820); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); c.fillStyle = v; c.fillRect(0, 0, W, HH);
  // film grain, stepped at 24 fps
  const fi = Math.floor(t * 24), r = rng(fi + 900), tile = grainTiles()[fi % 4];
  c.save(); c.globalAlpha = 0.07; c.globalCompositeOperation = 'overlay'; const pat = c.createPattern(tile, 'repeat'); pat.setTransform(new DOMMatrix().translateSelf(-r() * 256, -r() * 256)); c.fillStyle = pat; c.fillRect(0, 0, W, HH);
  c.globalAlpha = 0.035; c.globalCompositeOperation = 'source-over'; c.fillRect(0, 0, W, HH); c.restore();
}

// ---------- persistent chrome: topic label + step pill (screen space) ----------
function chrome(c, t) {
  const a = span(t, 2.86, 3.1) * (1 - span(t, 13.3, 13.45));
  if (a > 0) {
    c.save(); c.globalAlpha = a; c.fillStyle = C.hi; c.fillRect(64, 47, 12, 12);
    c.font = inter(28, 700); c.letterSpacing = '3px'; c.fillStyle = C.dim; c.textBaseline = 'middle'; c.fillText('HOW TO LAND YOUR FIRST CLIENT', 88, 54); c.restore();
  }
  const steps = [['STEP 01', TL.skill.pill, 6.1], ['STEP 02', TL.build.pill, 10.0], ['STEP 03', TL.dm.pill, 13.4]];
  for (const [label, t0, t1] of steps) {
    if (t < t0 || t > t1) continue; const s = ez.back(span(t, t0, t0 + 0.3), 2.2);
    c.save(); c.translate(64, 108); c.scale(s, s); c.font = inter(28, 800); c.letterSpacing = '3px';
    const w = c.measureText(label).width + 30; c.fillStyle = C.hi; rr(c, 0, -23, w, 46, 8); c.fill();
    c.fillStyle = C.black; c.textBaseline = 'middle'; c.fillText(label, 15, 2); c.restore();
  }
}

// =================================== SCENES ===================================
// 0 · hook
function sceneHook(c, t) {
  const H = TL.hook, sh = lerp(45, -70, ez.inout3(span(t, H.shift, H.shift + 0.3)));
  const r1 = [word('YOU', H.w1[0], disp(118), C.ink, { track: '2px' }), word("DON'T", H.w1[1], disp(118), C.ink, { track: '2px' }), word('NEED', H.w1[2], disp(118), C.ink, { track: '2px' })];
  const r2 = [word('MORE', H.w2[0], disp(168), C.ink, { track: '2px' }), word('SKILLS.', H.w2[1], disp(168), C.ink, { track: '2px' })];
  row(c, r1, 640, 232 + sh, 30); const b2 = row(c, r2, 640, 392 + sh, 36);
  const dimA = 1 - 0.62 * span(t, H.strike, H.strike + 0.18);
  r1.forEach((it) => slam(c, it, t, { alpha: dimA })); r2.forEach((it) => slam(c, it, t, { alpha: dimA, from: 1.6 }));
  strike(c, b2.x0 - 20, b2.x0 + b2.w + 20, 392 + sh, span(t, H.strike, H.strike + 0.16), C.red, 14);
  if (t >= H.need) {
    const r3 = [word('you need', H.need, inter(46, 600), C.dim, { base: 'alphabetic' }), word('more reps.', H.reps, serif(156), C.hi, { base: 'alphabetic' })];
    const b3 = row(c, r3, 640, 590, 26);
    slam(c, r3[0], t, { from: 1.15 }); slam(c, r3[1], t, { from: 1.7, glow: 'rgba(255,214,10,0.35)' });
    // marker underline under "more reps."
    const p = span(t, H.under, H.under + 0.22); if (p > 0) { const x0 = r3[1].x - 6, x1 = r3[1].x + r3[1].w + 8; c.save(); c.strokeStyle = C.hi; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); const n = 24; for (let i = 0; i <= n * p; i++) { const u = i / n, x = lerp(x0, x1, u), y = 622 + Math.sin(u * 3.2) * 5 - u * 6; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); c.restore(); }
    void b3;
  }
}
// 1 · pick one skill
function icon(c, kind, x, y, s, col) {
  c.save(); c.translate(x, y); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3.5; c.lineJoin = 'round';
  if (kind === 'play') { c.beginPath(); c.arc(0, 0, s, 0, 7); c.stroke(); c.beginPath(); c.moveTo(-s * 0.3, -s * 0.45); c.lineTo(s * 0.5, 0); c.lineTo(-s * 0.3, s * 0.45); c.closePath(); c.fill(); }
  else if (kind === 'bolt') { c.beginPath(); c.moveTo(s * 0.15, -s); c.lineTo(-s * 0.55, s * 0.12); c.lineTo(-s * 0.02, s * 0.12); c.lineTo(-s * 0.18, s); c.lineTo(s * 0.58, -s * 0.18); c.lineTo(s * 0.05, -s * 0.18); c.closePath(); c.fill(); }
  else { rr(c, -s, -s * 0.8, s * 2, s * 1.6, 5); c.stroke(); c.beginPath(); c.moveTo(-s, -s * 0.35); c.lineTo(s, -s * 0.35); c.stroke(); [0, 1, 2].forEach((i) => { c.beginPath(); c.arc(-s * 0.7 + i * s * 0.26, -s * 0.58, 2.6, 0, 7); c.fill(); }); }
  c.restore();
}
function sceneSkill(c, t) {
  const S = TL.skill;
  const head = [word('PICK', S.w[0], disp(108)), word('ONE', S.w[1], disp(108), C.hi), word('SKILL', S.w[2], disp(108))];
  row(c, head, 640, 238, 26); head.forEach((it) => slam(c, it, t));
  const chips = [['Video editing', 'play'], ['AI automations', 'bolt'], ['Websites', 'browser']], X = [290, 640, 990], Y = 455, w = 330, h = 120;
  chips.forEach(([label, ic], i) => {
    const t0 = S.chips[i]; if (t < t0) return;
    const pop = ez.back(span(t, t0, t0 + 0.32), 2), chosen = i === 1;
    const dimA = chosen ? 1 : 1 - 0.7 * span(t, S.drop, S.drop + 0.18);
    const grow = chosen ? 1 + 0.12 * ez.back(span(t, S.pick, S.pick + 0.32), 2.2) : 1;
    const lit = chosen ? span(t, S.pick, S.pick + 0.12) : 0;
    c.save(); c.translate(X[i], Y + (1 - pop) * 40); c.scale(pop * grow, pop * grow); c.globalAlpha = dimA * Math.min(1, pop * 2);
    if (lit > 0) { c.shadowColor = `rgba(255,214,10,${0.55 * lit})`; c.shadowBlur = 44; }
    c.fillStyle = C.panel; rr(c, -w / 2, -h / 2, w, h, 18); c.fill(); c.shadowBlur = 0;
    c.lineWidth = lit > 0 ? 3 : 1.5; c.strokeStyle = lit > 0 ? C.hi : C.line; rr(c, -w / 2, -h / 2, w, h, 18); c.stroke();
    icon(c, ic, -w / 2 + 52, 0, 20, lit > 0 ? C.hi : C.ink);
    c.font = inter(30, 700); c.fillStyle = C.ink; c.textBaseline = 'middle'; c.fillText(label, -w / 2 + 92, 2);
    c.restore();
    if (!chosen) { c.save(); c.globalAlpha = 0.9; strike(c, X[i] - w / 2 + 20, X[i] + w / 2 - 20, Y, span(t, S.drop, S.drop + 0.14), C.dim, 5, 0); c.restore(); }
  });
  scribble(c, 640, Y, 222, 104, span(t, S.ring, S.ring + 0.38), C.hi, 7, 4);
  if (t >= S.just) { const it = word('just one.', S.just, serif(76), C.hi, { base: 'alphabetic' }); row(c, [it], 960, 650, 0); slam(c, it, t, { from: 1.5 }); }
  handArrow(c, [880, 612], [830, 600], [812, 538], span(t, S.arrow, S.arrow + 0.25), C.hi, 6);
}
// 2 · build 3 samples (perspective browser mockup)
let BR = null;
function browserLayer(t) {
  const B = TL.build; if (!BR) BR = CM.layer(780, 520); const x = BR.getContext('2d'); const w = 780, h = 520;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
  x.fillStyle = '#f4f2ee'; rr(x, 0, 0, w, h, 18); x.fill();
  x.save(); rr(x, 0, 0, w, h, 18); x.clip();
  x.fillStyle = '#e4e1db'; x.fillRect(0, 0, w, 52);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { x.fillStyle = col; x.beginPath(); x.arc(28 + i * 22, 26, 7, 0, 7); x.fill(); });
  x.fillStyle = '#ffffff'; rr(x, 120, 12, 420, 28, 14); x.fill(); x.fillStyle = '#6d6a64'; x.font = inter(17, 600); x.textBaseline = 'middle'; x.fillText('yourname.co/work', 140, 27);
  x.fillStyle = '#121214'; x.font = disp(54); x.textBaseline = 'alphabetic'; x.letterSpacing = '1px'; x.fillText('MY WORK', 40, 132); x.letterSpacing = '0px';
  x.fillStyle = '#8b877f'; x.font = inter(20, 600); x.fillText('Free samples for brands I want to work with', 40, 164);
  const cols = [['#ff8a3d', '#ffcf5c'], ['#28c7ff', '#6a5cff'], ['#ff4f9a', '#ffb36b']], names = ['Promo edit', 'Landing page', 'Ad creative'];
  B.cards.forEach((t0, i) => {
    if (t < t0) return; const p = ez.back(span(t, t0, t0 + 0.3), 1.8), cx = 40 + i * 236, cy = 192, cw = 214, ch = 282;
    const lift = i === 2 ? ez.back(span(t, B.click, B.click + 0.25), 2) : 0;
    x.save(); x.translate(cx + cw / 2, cy + ch / 2 - lift * 8); x.scale(p * (1 + 0.05 * lift), p * (1 + 0.05 * lift)); x.translate(-cw / 2, -ch / 2);
    x.shadowColor = `rgba(0,0,0,${0.18 + 0.2 * lift})`; x.shadowBlur = 18 + 20 * lift; x.shadowOffsetY = 8;
    x.fillStyle = '#ffffff'; rr(x, 0, 0, cw, ch, 14); x.fill(); x.shadowColor = 'transparent';
    const g = x.createLinearGradient(0, 0, cw, 150); g.addColorStop(0, cols[i][0]); g.addColorStop(1, cols[i][1]); x.fillStyle = g; rr(x, 10, 10, cw - 20, 150, 10); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.92)'; x.beginPath(); x.arc(cw / 2, 85, 26, 0, 7); x.fill(); x.fillStyle = cols[i][0]; x.beginPath(); x.moveTo(cw / 2 - 8, 72); x.lineTo(cw / 2 + 13, 85); x.lineTo(cw / 2 - 8, 98); x.closePath(); x.fill();
    x.fillStyle = '#18181a'; x.font = inter(22, 700); x.textBaseline = 'middle'; x.fillText(names[i], 16, 190);
    x.fillStyle = '#d9d6cf'; rr(x, 16, 214, cw - 60, 10, 5); x.fill(); rr(x, 16, 234, cw - 100, 10, 5); x.fill();
    const ck = ez.back(span(t, t0 + 0.32, t0 + 0.52), 2.4);
    if (ck > 0) { x.save(); x.translate(cw - 28, ch - 30); x.scale(ck, ck); x.fillStyle = '#20c46b'; x.beginPath(); x.arc(0, 0, 17, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(-7, 1); x.lineTo(-2, 6); x.lineTo(8, -6); x.stroke(); x.restore(); }
    if (lift > 0) { x.strokeStyle = `rgba(255,214,10,${lift})`; x.lineWidth = 5; rr(x, 2, 2, cw - 4, ch - 4, 13); x.stroke(); }
    x.restore();
  });
  // cursor travels to the third card and clicks
  if (t > B.cur) {
    const u = ez.inout3(span(t, B.cur, B.click - 0.05)), px = lerp(760, 650, u), py = lerp(520, 300, u);
    const ck = t > B.click ? span(t, B.click, B.click + 0.35) : 0, s = 1 - 0.18 * Math.sin(Math.PI * Math.min(1, ck * 2.5));
    if (ck > 0 && ck < 1) { x.strokeStyle = `rgba(255,214,10,${1 - ck})`; x.lineWidth = 4; x.beginPath(); x.arc(px, py, 10 + 40 * ck, 0, 7); x.stroke(); }
    x.save(); x.translate(px, py); x.scale(1.5 * s, 1.5 * s); x.fillStyle = '#111'; x.strokeStyle = '#fff'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 22); x.lineTo(5.5, 17); x.lineTo(9.5, 26); x.lineTo(13, 24.5); x.lineTo(9, 15.5); x.lineTo(16, 15.5); x.closePath(); x.fill(); x.stroke(); x.restore();
  }
  x.restore();
  return BR;
}
// draw a flat layer rotated around its vertical axis (perspective by vertical strips)
function drawYaw(c, src, cx, cy, w, h, yaw, alpha) {
  const f = 1500, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const proj = (x) => { const X = x * cs, Z = x * sn, k = f / (f + Z); return { x: cx + X * k, k }; };
  const L = proj(-w / 2), R = proj(w / 2);
  c.save(); c.globalAlpha = alpha;
  // soft drop shadow under the quad
  c.save(); c.filter = 'blur(30px)'; c.fillStyle = 'rgba(0,0,0,0.7)'; c.beginPath();
  c.moveTo(L.x + 20, cy - (h * L.k) / 2 + 50); c.lineTo(R.x + 20, cy - (h * R.k) / 2 + 50); c.lineTo(R.x + 20, cy + (h * R.k) / 2 + 50); c.lineTo(L.x + 20, cy + (h * L.k) / 2 + 50); c.closePath(); c.fill(); c.restore();
  const sw = 3;
  for (let sx = 0; sx < src.width; sx += sw) {
    const p0 = proj((sx / src.width - 0.5) * w), p1 = proj(((sx + sw) / src.width - 0.5) * w), hh = (h * (p0.k + p1.k)) / 2;
    c.drawImage(src, sx, 0, sw, src.height, p0.x, cy - hh / 2, p1.x - p0.x + 0.7, hh);
  }
  // glass sheen
  const g = c.createLinearGradient(L.x, cy - h / 2, R.x, cy + h / 2); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.4, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = g; c.beginPath(); c.moveTo(L.x, cy - (h * L.k) / 2); c.lineTo(R.x, cy - (h * R.k) / 2); c.lineTo(R.x, cy + (h * R.k) / 2); c.lineTo(L.x, cy + (h * L.k) / 2); c.closePath(); c.fill();
  c.restore();
}
function sceneBuild(c, t) {
  const B = TL.build;
  const enter = ez.outExpo(span(t, B.br, B.br + 0.65)), yaw = lerp(-0.62, -0.36, enter) + Math.sin(t * 0.9) * 0.015;
  if (t > B.br) drawYaw(c, browserLayer(t), 878 + (1 - enter) * 520, 404 + Math.sin(t * 1.1) * 5, 620, 413, yaw, Math.min(1, enter * 1.6));
  const l1 = [word('BUILD', B.w[0], disp(124))], l2 = [word('3', B.w[1], disp(124), C.hi), word('SAMPLES', B.w[2], disp(124))];
  row(c, l1, 72, 270, 0, 'left'); row(c, l2, 72, 405, 24, 'left');
  slam(c, l1[0], t); slam(c, l2[0], t, { from: 1.8 });
  const path = swipe(c, l2[1], t, B.hl, 0.24, { h: 0.82, pad: 14, dy: 4 });
  slamMarked(c, l2[1], t, path);
  if (t > B.sub) { c.save(); const u = ez.out3(span(t, B.sub, B.sub + 0.35)); c.globalAlpha = u; c.font = inter(32, 600); c.fillStyle = C.dim; c.textBaseline = 'middle'; c.fillText('free work for brands you want', 76, 498 + (1 - u) * 16); c.restore(); }
}
// 3 · send 20 DMs a day (phone mockup)
function bubble(c, lines, x, y, maxW, mine, p, lh = 36) {
  const padX = 18, padY = 14; c.font = inter(28, 600);
  const bw = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width)) + padX * 2), bh = lines.length * lh + padY * 2 - 6;
  const bx = mine ? x - bw : x, s = ez.back(clamp(p), 1.9); if (s <= 0) return bh;
  c.save(); c.translate(mine ? bx + bw : bx, y + bh); c.scale(s, s); c.translate(mine ? -bw : 0, -bh);
  c.fillStyle = mine ? C.hi : '#26262b'; rr(c, 0, 0, bw, bh, 22); c.fill();
  c.fillStyle = mine ? C.black : C.ink; c.textBaseline = 'top'; lines.forEach((l, i) => c.fillText(l, padX, padY + i * lh));
  c.restore(); return bh;
}
function scenePhone(c, t) {
  const D = TL.dm;
  // headline + counter, left
  const l1 = [word('SEND', D.w[0], disp(110))], l2 = [word('20', D.w[1], disp(110), C.hi), word('DMs', D.w[1] + 0.08, disp(110))], l3 = [word('A DAY.', D.w[2], disp(110))];
  row(c, l1, 72, 250, 0, 'left'); row(c, l2, 72, 372, 22, 'left'); row(c, l3, 72, 494, 0, 'left');
  [...l1, ...l2, ...l3].forEach((it) => slam(c, it, t));
  if (t > D.send + 0.05) {
    const u = ez.back(span(t, D.send + 0.05, D.send + 0.35), 2); c.save(); c.translate(72, 610); c.scale(u, u); c.globalAlpha = Math.min(1, u * 2);
    c.fillStyle = C.panel; rr(c, 0, -40, 330, 80, 14); c.fill(); c.strokeStyle = C.line; c.lineWidth = 1.5; rr(c, 0, -40, 330, 80, 14); c.stroke();
    c.font = inter(28, 600); c.fillStyle = C.dim; c.textBaseline = 'middle'; c.fillText('sent today', 22, 2);
    const n = dmCount(t), bump = 1 + 0.12 * Math.max(0, 1 - ((t - D.cnt[0]) * 12 % 1) * 3) * (t < D.cnt[1] + 0.05 && t > D.cnt[0] ? 1 : 0);
    c.save(); c.translate(250, 4); c.scale(bump, bump); c.font = disp(56); c.fillStyle = n >= 20 ? C.hi : C.ink; c.textAlign = 'center'; c.fillText(String(n), 0, 0); c.restore();
    c.restore();
  }
  // phone
  const enter = ez.outExpo(span(t, D.phone, D.phone + 0.5)); if (enter <= 0) return;
  const shake = t > D.reply ? Math.exp(-(t - D.reply) * 9) * Math.sin((t - D.reply) * 70) * 5 : 0;
  const pw = 372, ph = 640;
  c.save(); c.translate(935 + shake, 382 + (1 - enter) * 560); c.rotate(-0.035); c.translate(-pw / 2, -ph / 2);
  c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 60; c.shadowOffsetY = 30; c.fillStyle = '#18181b'; rr(c, 0, 0, pw, ph, 54); c.fill(); c.restore();
  c.strokeStyle = '#33333a'; c.lineWidth = 3; rr(c, 1.5, 1.5, pw - 3, ph - 3, 53); c.stroke();
  c.fillStyle = '#0e0e10'; rr(c, 11, 11, pw - 22, ph - 22, 44); c.fill();
  c.save(); rr(c, 11, 11, pw - 22, ph - 22, 44); c.clip();
  c.fillStyle = '#000'; rr(c, pw / 2 - 52, 22, 104, 28, 14); c.fill();
  // header
  const ag = c.createLinearGradient(40, 70, 90, 120); ag.addColorStop(0, '#ff8a3d'); ag.addColorStop(1, '#ff3d8b');
  c.fillStyle = ag; c.beginPath(); c.arc(62, 94, 25, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = disp(26); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('B', 62, 96); c.textAlign = 'left';
  c.fillStyle = C.ink; c.font = inter(26, 700); c.fillText('Brand Co.', 100, 84);
  c.fillStyle = C.money; c.beginPath(); c.arc(106, 110, 5, 0, 7); c.fill(); c.fillStyle = C.dim; c.font = inter(19, 500); c.fillText('Active now', 118, 111);
  c.fillStyle = '#222227'; c.fillRect(11, 136, pw - 22, 1.5);
  // thread
  c.font = inter(28, 600);
  const outLines = wrap(c, 'Hey! I made a free sample for your brand. Want it?', 230);
  let y = 158; const outH = bubble(c, outLines, pw - 26, y, 268, true, span(t, D.send, D.send + 0.28));
  if (t > D.seen) { c.globalAlpha = span(t, D.seen, D.seen + 0.2); c.fillStyle = C.dim; c.font = inter(19, 500); c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('Seen', pw - 30, y + outH + 8); c.textAlign = 'left'; c.globalAlpha = 1; }
  y += outH + 44;
  if (t > D.dots[0] && t < D.reply) { const a = span(t, D.dots[0], D.dots[0] + 0.12); c.globalAlpha = a; c.fillStyle = '#26262b'; rr(c, 26, y, 96, 52, 22); c.fill();
    for (let i = 0; i < 3; i++) { const b = Math.max(0, Math.sin((t * 7 - i * 0.6) * Math.PI)) * 6; c.fillStyle = C.dim; c.beginPath(); c.arc(52 + i * 22, y + 26 - b, 6, 0, 7); c.fill(); } c.globalAlpha = 1; }
  c.font = inter(28, 600);
  const inLines = wrap(c, 'This is sick. What do you charge?', 220);
  const inH = bubble(c, inLines, 26, y, 260, false, span(t, D.reply, D.reply + 0.28));
  // composer
  const cy = ph - 84; c.fillStyle = '#1b1b1f'; rr(c, 24, cy, pw - 104, 52, 26); c.fill();
  const full = 'Hey! I made a free sample for your brand. Want it?', n = Math.floor(full.length * span(t, D.type[0], D.type[1]));
  c.save(); rr(c, 24, cy, pw - 104, 52, 26); c.clip(); c.font = inter(22, 500); c.textBaseline = 'middle';
  if (t > D.type[0] && t < D.send) { const s = full.slice(0, n), tw = c.measureText(s).width, room = pw - 150; c.fillStyle = C.ink; c.fillText(s, 44 + Math.min(0, room - tw), cy + 27); }
  else { c.fillStyle = '#5c5c63'; c.fillText('Message\u2026', 44, cy + 27); }
  c.restore();
  const sp = t > D.send && t < D.send + 0.2 ? 0.85 : 1;
  c.save(); c.translate(pw - 52, cy + 26); c.scale(sp, sp); c.fillStyle = C.hi; c.beginPath(); c.arc(0, 0, 24, 0, 7); c.fill(); c.strokeStyle = C.black; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(0, 10); c.lineTo(0, -9); c.moveTo(-8, -1); c.lineTo(0, -9); c.lineTo(8, -1); c.stroke(); c.restore();
  c.restore();
  c.restore();
  // emphasis loop around the reply, drawn in screen space over the phone
  if (t > D.ring) { c.save(); c.translate(935, 382); c.rotate(-0.035); scribble(c, -pw / 2 + 26 + 130, -ph / 2 + y + inH / 2, 175, 82, span(t, D.ring, D.ring + 0.35), C.hi, 6, 9); c.restore(); }
}
// 4 · the math
function sceneMath(c, t) {
  const M = TL.math;
  const r = [word('20', M.w[0], disp(128)), word('\u00d7', M.w[1], inter(96, 800), C.dim), word('30 DAYS', M.w[2], disp(128)), word('=', M.w[3], inter(96, 800), C.dim)];
  row(c, r, 640, 170, 30); r.forEach((it) => slam(c, it, t));
  if (t > M.cnt[0] - 0.15) {
    const v = mathCount(t), lk = t > M.lock ? span(t, M.lock, M.lock + 0.4) : 0, pop = 1 + 0.16 * Math.sin(Math.PI * lk) * (lk < 1 ? 1 : 0);
    c.save(); c.translate(640, 440); c.scale(pop, pop); c.globalAlpha = span(t, M.cnt[0] - 0.15, M.cnt[0]);
    c.font = disp(250); c.textAlign = 'center'; c.textBaseline = 'middle'; c.letterSpacing = '4px';
    c.shadowColor = `rgba(61,255,143,${0.35 + 0.4 * (t > M.lock ? Math.exp(-(t - M.lock) * 2) : 0)})`; c.shadowBlur = 60; c.fillStyle = C.money; c.fillText(String(v), 0, 0);
    c.shadowBlur = 0; c.fillText(String(v), 0, 0); c.restore();
    // spark streaks on the lock
    const age = t - M.lock;
    if (age > 0 && age < 0.9) { const rr2 = rng('spark'); c.save(); c.lineCap = 'round';
      for (let i = 0; i < 26; i++) { const an = rr2() * Math.PI * 2, sp = rr2.in(260, 520), d0 = sp * ez.out3(Math.min(1, age / 0.6)), len = 46 * (1 - age / 0.9); c.strokeStyle = i % 3 ? `rgba(61,255,143,${1 - age / 0.9})` : `rgba(255,255,255,${1 - age / 0.9})`; c.lineWidth = 4; c.beginPath(); c.moveTo(640 + Math.cos(an) * d0, 440 + Math.sin(an) * d0 * 0.7); c.lineTo(640 + Math.cos(an) * (d0 + len), 440 + Math.sin(an) * (d0 + len) * 0.7); c.stroke(); }
      c.restore(); }
  }
  if (t >= M.conv) { const it = word('conversations', M.conv, serif(92), C.ink, { base: 'alphabetic' }); row(c, [it], 640, 640, 0); slam(c, it, t, { from: 1.4 }); }
  if (t > M.sub) { c.save(); const u = ez.out3(span(t, M.sub, M.sub + 0.35)); c.globalAlpha = u; c.font = inter(30, 600); c.fillStyle = C.dim; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('with people who could pay you', 640, 690 - (1 - u) * 12); c.restore(); }
}
// 5 · the wrong move
let STAMP = null;
function stampLayer() {
  if (STAMP) return STAMP; STAMP = CM.layer(340, 190); const x = STAMP.getContext('2d');
  x.strokeStyle = C.red; x.lineWidth = 10; rr(x, 10, 10, 320, 170, 16); x.stroke();
  x.fillStyle = C.red; x.font = disp(124); x.textAlign = 'center'; x.textBaseline = 'middle'; x.letterSpacing = '4px'; x.fillText('NO.', 172, 100);
  x.globalCompositeOperation = 'destination-out'; const r = rng('stamp'); for (let i = 0; i < 420; i++) { x.globalAlpha = r.in(0.3, 1); x.beginPath(); x.arc(r() * 340, r() * 190, r.in(0.6, 2.6), 0, 7); x.fill(); }
  return STAMP;
}
function sceneWrong(c, t) {
  const X = TL.wrong;
  const r1 = [word('WAITING', X.w[0], disp(124)), word('UNTIL', X.w[1], disp(124))], r2 = [word("YOU'RE", X.w[2], disp(124)), word('READY?', X.w[3], disp(124))];
  const b1 = row(c, r1, 640, 262, 30), b2 = row(c, r2, 640, 404, 30);
  const dimmed = span(t, X.strike[0], X.strike[0] + 0.2);
  [...r1, ...r2].forEach((it) => slam(c, it, t, { color: dimmed > 0.5 ? '#7a7a80' : it.color }));
  strike(c, b1.x0 - 20, b1.x0 + b1.w + 20, 262, span(t, X.strike[0], X.strike[0] + 0.14), C.red, 15);
  strike(c, b2.x0 - 20, b2.x0 + b2.w + 20, 404, span(t, X.strike[1], X.strike[1] + 0.14), C.red, 15);
  if (t > X.stamp) { const u = span(t, X.stamp, X.stamp + 0.13), s = lerp(2.4, 1, ez.in3(u)); c.save(); c.translate(915, 560); c.rotate(-0.16); c.scale(s, s); c.globalAlpha = Math.min(1, u * 3) * 0.95; c.drawImage(stampLayer(), -170, -95); c.restore(); }
}
// 6 · takeaway
function sceneTake(c, t) {
  const K = TL.take;
  const v = word('VOLUME', K.vol, disp(214), C.ink, { track: '4px' }); row(c, [v], 640, 268, 0);
  const path = swipe(c, v, t, K.hl, 0.26, { h: 0.84, pad: 24, dy: 6 });
  slamMarked(c, v, t, path, { from: 1.6 });
  const r2 = [word('BEATS', K.w[0], disp(150)), word('TALENT.', K.w[1], disp(150))]; row(c, r2, 640, 470, 34); r2.forEach((it) => slam(c, it, t));
  if (t > K.line) { c.save(); const u = ez.out3(span(t, K.line, K.line + 0.45)); c.globalAlpha = u; c.font = inter(34, 600); c.fillStyle = C.dim; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Send the first DM today.', 640, 612 + (1 - u) * 18); c.restore(); }
}
var SCENES = [sceneHook, sceneSkill, sceneBuild, scenePhone, sceneMath, sceneWrong, sceneTake];

// =================================== COMPOSITOR ===================================
const LA = CM.layer(W, HH), LB = CM.layer(W, HH), LT = CM.layer(W, HH), LR = CM.layer(W, HH), LG = CM.layer(W, HH);
function sceneIndex(t) { let i = 0; for (const c of CUTS) if (t >= c.t) i++; return i; }
function paintScene(c, i, t) { c.save(); applyCam(c, camera(t, i)); SCENES[i](c, t); c.restore(); }
function paintLayer(L, i, t, withBg) { const x = L.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, W, HH); if (withBg) background(x, t); paintScene(x, i, t); return L; }
function explainer(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const idx = sceneIndex(t), cut = CUTS.find((c) => t >= c.t && t < c.t + c.d);
  if (!cut) { background(ctx, t); paintScene(ctx, idx, t); }
  else {
    const u = (t - cut.t) / cut.d, from = idx - 1, to = idx;
    if (cut.type === 'whip' || cut.type === 'whipV') {
      background(ctx, t);
      const e = ez.inout3(u), vert = cut.type === 'whipV', dir = cut.dir || 1, D = vert ? HH : W, blur = Math.sin(Math.PI * u) * 170;
      paintLayer(LA, from, t, false); paintLayer(LB, to, t, false);
      const T = LT.getContext('2d'); T.setTransform(1, 0, 0, 1, 0, 0); T.clearRect(0, 0, W, HH); T.globalCompositeOperation = 'lighter';
      const N = 8; T.globalAlpha = 1 / N;
      for (let k = 0; k < N; k++) { const o = (k / (N - 1) - 0.5) * blur, oa = -e * D * dir + o, ob = (1 - e) * D * dir + o;
        if (vert) { T.drawImage(LA, 0, oa); T.drawImage(LB, 0, ob); } else { T.drawImage(LA, oa, 0); T.drawImage(LB, ob, 0); } }
      T.globalCompositeOperation = 'source-over'; T.globalAlpha = 1; ctx.drawImage(LT, 0, 0);
    } else if (cut.type === 'glitch') {
      paintLayer(LA, u < 0.5 ? from : to, t, true);
      const fi = Math.floor(t * 60), r = rng('g' + fi), off = (8 + r() * 18) * Math.sin(Math.PI * u) * 1.6;
      // split channels
      const tint = (L, col) => { const x = L.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, HH); x.drawImage(LA, 0, 0); x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, W, HH); x.globalCompositeOperation = 'source-over'; return L; };
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, HH); ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tint(LR, '#ff0000'), off, 0); ctx.drawImage(tint(LG, '#00ffff'), -off, 0); ctx.globalCompositeOperation = 'source-over';
      // displaced slices
      for (let k = 0; k < 9; k++) { const y = r() * HH, h = 6 + r() * 60, dx = (r() - 0.5) * 140 * Math.sin(Math.PI * u); ctx.drawImage(LA, 0, y, W, h, dx, y, W, h); }
      if (r() > 0.4) { ctx.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`; ctx.fillRect(0, r() * HH, W, 2 + r() * 6); }
    } else {
      background(ctx, t); paintScene(ctx, u < 0.5 ? from : to, t);
      ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - Math.abs(u * 2 - 1))})`; ctx.fillRect(0, 0, W, HH);
    }
  }
  chrome(ctx, t);
  finishing(ctx, t);
}

// =================================== SOUND SCORE ===================================
function scoreSound(k) {
  const H = TL.hook, S = TL.skill, B = TL.build, Dm = TL.dm, M = TL.math, X = TL.wrong, K = TL.take;
  const px = (x) => clamp((x / 1280) * 2 - 1, -1, 1) * 0.55;
  // music: drone into the drop, beat under the steps, cut by a tape stop, back for the takeaway
  k.drone(0, H.reps + 0.05, { gain: 1 });
  k.play('riser', H.reps - 1.15, { dur: 1.15, gain: 0.9 });
  k.music(H.reps, X.strike[0], { bpm: 98, gain: 1 });
  k.music(K.vol, TL.D - 0.15, { bpm: 98, gain: 1 });

  // hook
  H.w1.forEach((t, i) => k.play('slam', t, { gain: 0.65, pan: (i - 1) * 0.25 }));
  k.play('slam', H.w2[0], { gain: 0.85, pan: -0.15 }); k.play('slam', H.w2[1], { gain: 1.15, pan: 0.15 }); k.play('boom', H.w2[1], { gain: 0.5 });
  k.play('strike', H.strike, { gain: 1 });
  k.play('pop', H.need, { f: 520, gain: 0.6, soft: true });
  k.play('boom', H.reps, { gain: 1.1 }); k.play('slam', H.reps, { gain: 0.9 }); k.play('sparkle', H.reps + 0.05, { gain: 0.8 });
  k.play('marker', H.under, { dur: 0.22, gain: 0.8, soft: true });

  // cut 1 (whip right)
  k.play('whoosh', CUTS[0].t - 0.04, { dur: 0.36, gain: 1, dir: 1 });
  // step 1
  k.play('pop', S.pill, { f: 900, gain: 0.7 });
  S.w.forEach((t, i) => k.play('slam', t, { gain: 0.6, pan: (i - 1) * 0.3 }));
  S.chips.forEach((t, i) => k.play('pop', t + 0.05, { f: 640 + i * 120, gain: 0.7, pan: px([290, 640, 990][i]) }));
  k.play('strike', S.drop, { gain: 0.45, pan: px(290) }); k.play('strike', S.drop + 0.03, { gain: 0.45, pan: px(990) });
  k.play('slam', S.pick, { gain: 0.8 }); k.play('shimmer', S.pick + 0.02, { gain: 0.9 });
  k.play('marker', S.ring, { dur: 0.38, gain: 0.7, soft: true });
  k.play('pop', S.just, { f: 600, gain: 0.55 }); k.play('marker', S.arrow, { dur: 0.25, gain: 0.55, pan: 0.4, soft: true });

  // cut 2 (glitch)
  k.play('glitch', CUTS[1].t, { gain: 1 });
  // step 2
  k.play('pop', B.pill, { f: 900, gain: 0.7 });
  k.play('slam', B.w[0], { gain: 0.65, pan: -0.5 }); k.play('slam', B.w[1], { gain: 0.6, pan: -0.5 }); k.play('slam', B.w[2], { gain: 0.75, pan: -0.4 });
  k.play('whoosh', B.br, { dur: 0.55, gain: 0.7, dir: -1, top: 2200 });
  k.play('pop', B.sub, { f: 480, gain: 0.35, soft: true, pan: -0.5 });
  B.cards.forEach((t, i) => { k.play('pop', t + 0.06, { f: 700 + i * 110, gain: 0.6, pan: 0.3 + i * 0.12 }); k.play('tick', t + 0.4, { f: 4200, gain: 0.7, pan: 0.35 + i * 0.12, soft: true }); });
  k.play('marker', B.hl, { dur: 0.24, gain: 0.9, pan: -0.4 });
  k.play('whoosh', B.cur, { dur: 0.45, gain: 0.18, dir: -1, top: 1400, soft: true });
  k.play('click', B.click, { gain: 1, pan: 0.5 }); k.play('pop', B.click + 0.04, { f: 980, gain: 0.45, pan: 0.5 });

  // cut 3 (vertical whip)
  k.play('whoosh', CUTS[2].t - 0.04, { dur: 0.34, gain: 1, dir: 1, top: 2600 });
  // step 3
  k.play('pop', Dm.pill, { f: 900, gain: 0.7 });
  k.play('whoosh', Dm.phone, { dur: 0.45, gain: 0.5, dir: 1, top: 1800, soft: true });
  k.play('slam', Dm.w[0], { gain: 0.6, pan: -0.5 }); k.play('slam', Dm.w[1], { gain: 0.65, pan: -0.5 }); k.play('slam', Dm.w[2], { gain: 0.65, pan: -0.5 });
  k.play('keys', Dm.type[0], { dur: Dm.type[1] - Dm.type[0], gain: 0.9, pan: 0.45 });
  k.play('send', Dm.send, { gain: 1, pan: 0.45 });
  { let last = -1, prev = dmCount(Dm.cnt[0] - 0.01); for (let t = Dm.cnt[0]; t <= Dm.cnt[1] + 0.01; t += 1 / 240) { const v = dmCount(t); if (v !== prev && t - last >= 1 / 12) { k.play('tick', t, { f: 3000 + v * 60, gain: 0.55, pan: -0.45, soft: true }); last = t; } prev = v; } }
  k.play('pop', Dm.cnt[1], { f: 1100, gain: 0.5, pan: -0.45 });
  k.play('tick', Dm.seen, { f: 5200, gain: 0.35, pan: 0.45, soft: true });
  k.play('ping', Dm.reply, { gain: 1.1, pan: 0.45 }); k.play('slam', Dm.reply, { gain: 0.45, pan: 0.45 });
  k.play('marker', Dm.ring, { dur: 0.35, gain: 0.6, pan: 0.4, soft: true });
  k.play('riser', CUTS[3].t - 0.55, { dur: 0.55, gain: 0.7 });

  // cut 4 (flash) and the math
  k.play('slam', CUTS[3].t + 0.06, { gain: 1 });
  M.w.forEach((t, i) => k.play('slam', t, { gain: i % 2 ? 0.45 : 0.7, pan: (i - 1.5) * 0.25 }));
  { let last = -1, prev = mathCount(M.cnt[0] - 0.01); for (let t = M.cnt[0]; t < M.lock - 0.02; t += 1 / 240) { const v = mathCount(t); if (v !== prev && t - last >= 1 / 12) { k.play('tick', t, { f: 2600 + v * 3, gain: 0.6, soft: true }); last = t; } prev = v; } }
  k.play('riser', M.cnt[0] + 0.2, { dur: M.lock - M.cnt[0] - 0.2, gain: 0.85 });
  k.play('boom', M.lock, { gain: 1.35 }); k.play('slam', M.lock, { gain: 1.1 }); k.play('shimmer', M.lock + 0.03, { gain: 1.2 }); k.play('sparkle', M.lock + 0.08, { gain: 1 });
  k.play('pop', M.conv, { f: 560, gain: 0.5 }); k.play('pop', M.sub, { f: 440, gain: 0.3, soft: true });

  // cut 5 (glitch) and the wrong move
  k.play('glitch', CUTS[4].t, { gain: 1 });
  X.w.forEach((t, i) => k.play('slam', t, { gain: 0.55, pan: (i - 1.5) * 0.2 }));
  k.play('tapeStop', X.strike[0], { gain: 1 });
  k.play('strike', X.strike[0], { gain: 0.9 }); k.play('strike', X.strike[1], { gain: 0.9 });
  k.play('stamp', X.stamp, { gain: 1.2, pan: 0.3 });

  // cut 6 (whip left) and the takeaway
  k.play('whoosh', CUTS[5].t - 0.04, { dur: 0.36, gain: 1, dir: -1 });
  k.play('boom', K.vol, { gain: 1.2 }); k.play('slam', K.vol, { gain: 1 });
  k.play('marker', K.hl, { dur: 0.26, gain: 1 });
  k.play('slam', K.w[0], { gain: 0.7, pan: -0.2 }); k.play('slam', K.w[1], { gain: 0.9, pan: 0.2 });
  k.play('pop', K.line, { f: 520, gain: 0.4, soft: true });
  k.play('shimmer', K.line + 0.05, { gain: 0.6 });
}
