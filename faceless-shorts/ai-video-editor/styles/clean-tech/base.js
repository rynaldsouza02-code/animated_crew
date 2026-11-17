// Clean Tech (Kinetic Type) style engine for the ai-video-editor skill.
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

// ---------- shared UI-style helpers (Clean Tech, Software Walkthrough, Data Story) ----------
const W = 1280, HH = 720;
const { clamp, lerp, span, rng, noise1, ez } = CM;
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
// keyframe track: K = [[t, v1, v2, ...], ...], eased in-out between keys
function track(K, t) {
  if (t <= K[0][0]) return K[0].slice(1);
  for (let i = 0; i < K.length - 1; i++) { const a = K[i], b = K[i + 1]; if (t <= b[0]) { const e = ez.inout3((t - a[0]) / Math.max(1e-6, b[0] - a[0])); return a.slice(1).map((v, j) => lerp(v, b[j + 1], e)); } }
  return K[K.length - 1].slice(1);
}
const textW = (c, s, font) => { c.save(); c.font = font; const w = c.measureText(s).width; c.restore(); return w; };
const pxOf = (font) => parseFloat(/(\d+)px/.exec(font)[1]);
// a word rises from behind a mask line into place; returns its width
function rise(c, s, x, y, font, color, t0, t, o = {}) {
  const w = textW(c, s, font); if (t < t0) return w;
  const px = pxOf(font), X = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x, e = ez.outExpo(span(t, t0, t0 + (o.dur || 0.5)));
  c.save(); c.beginPath(); c.rect(X - 12, y - px * 1.0, w + 24, px * 1.32); c.clip();
  c.globalAlpha *= Math.min(1, e * 1.6) * (o.alpha == null ? 1 : o.alpha); c.font = font; c.fillStyle = color; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.fillText(s, X, y + (1 - e) * px * 0.9); c.restore(); return w;
}
// a line of words, each rising on its own time. words: [[text, t0, color?]]
function riseLine(c, words, x, y, font, color, t, o = {}) {
  const sp = textW(c, ' ', font), ws = words.map(([s]) => textW(c, s, font)), tot = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
  let cx = o.align === 'center' ? x - tot / 2 : x; const boxes = [];
  words.forEach(([s, t0, col], i) => { boxes.push({ x: cx, w: ws[i], y }); rise(c, s, cx, y, font, col || color, t0, t, { alpha: o.alpha }); cx += ws[i] + sp; });
  return boxes;
}
// pill highlight behind a word box, growing from the left
function pillBehind(c, box, font, p, color, pad = 16) {
  if (p <= 0) return; const px = pxOf(font); c.save(); c.fillStyle = color; rr(c, box.x - pad, box.y - px * 0.88, (box.w + pad * 2) * ez.outExpo(p), px * 1.12, px * 0.26); c.fill(); c.restore();
}
const typed = (full, t, a, b) => full.slice(0, Math.floor(full.length * span(t, a, b)));
function softCard(c, x, y, w, h, r, o = {}) {
  c.save(); c.shadowColor = o.shadow || 'rgba(13,15,40,0.13)'; c.shadowBlur = o.blur == null ? 44 : o.blur; c.shadowOffsetY = o.offY == null ? 16 : o.offY;
  c.fillStyle = o.fill || '#ffffff'; rr(c, x, y, w, h, r); c.fill(); c.restore();
  if (o.border !== false) { c.save(); c.strokeStyle = o.border || 'rgba(13,15,20,0.08)'; c.lineWidth = 1.5; rr(c, x, y, w, h, r); c.stroke(); c.restore(); }
}
function cursorArrow(c, x, y, s = 1.3) {
  c.save(); c.translate(x, y); c.scale(s, s); c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  c.fillStyle = '#111'; c.strokeStyle = '#fff'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 22); c.lineTo(5.5, 17); c.lineTo(9.5, 26); c.lineTo(13, 24.5); c.lineTo(9, 15.5); c.lineTo(16, 15.5); c.closePath(); c.fill(); c.shadowColor = 'transparent'; c.stroke(); c.restore();
}
function checkMark(c, x, y, r, p, fill = '#18b46b') {
  if (p <= 0) return; const s = ez.back(clamp(p), 2.2); c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = fill; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = r * 0.24; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(-r * 0.42, 0.02 * r); c.lineTo(-r * 0.1, r * 0.32); c.lineTo(r * 0.45, -r * 0.3); c.stroke(); c.restore();
}
// scenes on transparent layers, with cuts between them
const LA = CM.layer(W, HH), LB = CM.layer(W, HH);
function sceneLayer(L, draw, t) { const x = L.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, W, HH); draw(x, t); return L; }
function composite(ctx, t, SCENES, CUTS, background) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  background(ctx, t);
  let idx = 0; for (const c of CUTS) if (t >= c.t) idx++;
  const cut = CUTS.find((c) => t >= c.t && t < c.t + c.d);
  if (!cut) { ctx.drawImage(sceneLayer(LA, SCENES[idx], t), 0, 0); return; }
  const u = (t - cut.t) / cut.d, e = ez.inout3(u), A = sceneLayer(LA, SCENES[idx - 1], t), B = sceneLayer(LB, SCENES[idx], t);
  if (cut.type === 'push') {
    const dir = cut.dir || 1, s = 1 - 0.05 * Math.sin(Math.PI * u);
    for (const [L, off] of [[A, -e * W * dir], [B, (1 - e) * W * dir]]) { ctx.save(); ctx.translate(640 + off, 360); ctx.scale(s, s); ctx.drawImage(L, -640, -360); ctx.restore(); }
  } else if (cut.type === 'zoom') {
    const z = lerp(1, 3.2, ez.in3(clamp(u / 0.65))); ctx.save(); ctx.globalAlpha = 1 - span(u, 0.38, 0.65); ctx.translate(cut.x, cut.y); ctx.scale(z, z); ctx.drawImage(A, -cut.x, -cut.y); ctx.restore();
    const zb = lerp(1.1, 1, ez.out3(span(u, 0.35, 1))); ctx.save(); ctx.globalAlpha = span(u, 0.35, 0.72); ctx.translate(640, 360); ctx.scale(zb, zb); ctx.drawImage(B, -640, -360); ctx.restore();
  } else if (cut.type === 'up') {
    ctx.save(); ctx.globalAlpha = 1 - e; ctx.drawImage(A, 0, -60 * e); ctx.restore(); ctx.save(); ctx.globalAlpha = e; ctx.drawImage(B, 0, 70 * (1 - e)); ctx.restore();
  } else { ctx.save(); ctx.globalAlpha = 1 - e; ctx.drawImage(A, 0, 0); ctx.globalAlpha = e; ctx.drawImage(B, 0, 0); ctx.restore(); }
}
// a soft synth pad and light percussion on the music bus (for scores)
function padBed(k, t0, t1, o = {}) {
  const bpm = o.bpm || 90, beat = 60 / bpm, bar = beat * 4, chords = o.chords, g = o.gain == null ? 1 : o.gain;
  let i = 0;
  for (let tb = t0; tb < t1 - 0.1; tb += bar, i++) {
    const ch = chords[i % chords.length], len = Math.min(bar, t1 - tb);
    ch.forEach((n, j) => { k.voice(tb, { type: 'triangle', f: n, dur: len + 0.4, gain: 0.026 * g, a: 0.5, hold: Math.max(0, len - 0.9), filter: 'lowpass', ff: o.cut || 1300, pan: (j - (ch.length - 1) / 2) * 0.3, verb: 0.3, bus: 'music' }); });
    k.voice(tb, { f: k.hz(ch[0]) / 2, dur: len + 0.2, gain: 0.05 * g, a: 0.3, hold: Math.max(0, len - 0.6), bus: 'music' });
    for (let b = 0; b < 8; b++) {
      const ts = tb + b * beat / 2; if (ts >= t1 - 0.05) break;
      if (o.hats && ts >= o.hats[0] && ts < o.hats[1]) k.hiss(ts, { dur: b % 2 ? 0.03 : 0.045, filter: 'highpass', ff: 8000, gain: (b % 2 ? 0.014 : 0.022) * g, bus: 'music' });
      if (o.kick && ts >= o.kick[0] && ts < o.kick[1] && (b === 0 || b === 4)) k.voice(ts, { f: [[0, 120], [0.09, 46]], dur: 0.26, gain: 0.16 * g, bus: 'music' });
    }
  }
}
// =====================================================================================================
// STYLE: Clean Tech
// Bright, calm product-explainer look: cool off-white with a dot grid, crisp Inter Tight that rises into place,
// white UI cards with soft shadows, one electric blue accent, mono labels, smooth push and zoom-through cuts.
// Demo topic: "How AI agents get work done".
// =====================================================================================================
const C = { bg: '#f5f6f8', ink: '#0d0f14', mute: '#6b7280', faint: '#9aa1ad', line: '#e3e6ec', blue: '#2f5bff', blueSoft: '#e8edff', green: '#18b46b' };
const HEAD = (px) => `800 ${px}px "Inter Tight", system-ui, sans-serif`, BODY = (px, w = 500) => `${w} ${px}px "Inter Tight", system-ui, sans-serif`, MONO = (px) => `700 ${px}px "JetBrains Mono", ui-monospace, monospace`;

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 20,
  hook: { tag: 0.1, w1: [0.2, 0.38], w2: [0.85, 1.05], pill: 1.3 },
  agent: { head: 3.15, card: [3.2, 3.8], type: [3.85, 5.0], send: 5.05, move: [5.3, 5.95], nodes: [6.0, 6.2, 6.4], arcs: [6.5, 7.0], loop: [7.0, 10.6], period: 1.2, rows: [7.1, 7.25, 7.4], checks: [7.8, 9.0, 10.2] },
  result: { w: [11.7, 11.9], pill: 12.35, doc: [11.75, 12.35], rows: 12.5, cnt: [12.45, 13.6], badge: 13.9 },
  take: { w1: [16.2, 16.38], w2: [16.8, 17.0], pill: 17.25, note: 18.0 },
};
var CUTS = [{ t: 2.6, d: 0.5, type: 'push', dir: 1 }, { t: 11.0, d: 0.6, type: 'zoom', x: 330, y: 560 }, { t: 15.6, d: 0.5, type: 'push', dir: 1 }];
const BUMPS = [1.3, 12.35, 17.25];
const stepCount = (t) => Math.round(14 * ez.out3(span(t, TL.result.cnt[0], TL.result.cnt[1])));

// ---------- background ----------
function background(c, t) {
  c.fillStyle = C.bg; c.fillRect(0, 0, W, HH);
  const g = c.createRadialGradient(1080 + Math.sin(t * 0.3) * 60, 80, 0, 1080, 80, 720); g.addColorStop(0, 'rgba(47,91,255,0.10)'); g.addColorStop(1, 'rgba(47,91,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, HH);
  const g2 = c.createRadialGradient(160, 680, 0, 160, 680, 600); g2.addColorStop(0, 'rgba(24,180,107,0.05)'); g2.addColorStop(1, 'rgba(24,180,107,0)'); c.fillStyle = g2; c.fillRect(0, 0, W, HH);
  c.fillStyle = 'rgba(13,15,20,0.085)'; const off = (t * 6) % 32;
  for (let y = 16; y < HH; y += 32) for (let x = 16 - off; x < W; x += 32) { c.beginPath(); c.arc(x, y, 1.4, 0, 7); c.fill(); }
}
// gentle push-in over each scene, and a small bump when a pill lands
function cam(c, t, a, b) { let z = 1 + 0.025 * ez.inout3(span(t, a, b)); for (const tb of BUMPS) { const d = t - tb; if (d > 0 && d < 1.2) z += 0.014 * Math.sin(Math.min(1, d / 0.25) * Math.PI / 2) * Math.exp(-d * 2.5); } c.translate(640, 360); c.scale(z, z); c.translate(-640, -360); }

// ---------- scene 0: hook ----------
function sceneHook(c, t) {
  const H = TL.hook; cam(c, t, 0, 2.6);
  c.save(); c.font = MONO(26); c.fillStyle = C.blue; c.letterSpacing = '4px'; c.textAlign = 'center'; c.globalAlpha = span(t, H.tag, H.tag + 0.3); c.fillText('THE SHIFT', 640, 236); c.restore();
  const F = HEAD(110);
  riseLine(c, [['Chatbots', H.w1[0]], ['answer.', H.w1[1]]], 640, 360, F, C.ink, t, { align: 'center' });
  const p = span(t, H.pill, H.pill + 0.35), b2 = riseLine(c, [['Agents', H.w2[0]], ['act.', H.w2[1], p > 0.6 ? '#fff' : C.ink]], 640, 494, F, C.ink, t, { align: 'center' });
  if (p > 0) { pillBehind(c, b2[1], F, p, C.blue); rise(c, 'act.', b2[1].x, 494, F, '#fff', H.w2[1], t); }
}
// ---------- scene 1: the agent loop ----------
const LOOP = { P: [890, 190], A: [1095, 400], K: [890, 610] };
const quadPts = (a, q, b, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, v = 1 - u; return [v * v * a[0] + 2 * v * u * q[0] + u * u * b[0], v * v * a[1] + 2 * v * u * q[1] + u * u * b[1]]; });
const ARCS = [quadPts(LOOP.P, [1070, 230], LOOP.A), quadPts(LOOP.A, [1070, 590], LOOP.K), quadPts(LOOP.K, [720, 400], LOOP.P)];
const LOOP_PATH = [...ARCS[0], ...ARCS[1].slice(1), ...ARCS[2].slice(1)];
function promptCard(c, cx, cy, s, t, alpha) {
  const A = TL.agent, w = 820, h = 150;
  c.save(); c.globalAlpha = alpha; c.translate(cx, cy); c.scale(s, s); c.translate(-w / 2, -h / 2);
  softCard(c, 0, 0, w, h, 26);
  c.font = MONO(22); c.fillStyle = C.mute; c.letterSpacing = '3px'; c.fillText('YOU', 40, 48); c.letterSpacing = '0px';
  const full = 'Research 5 competitors and write a summary.', s1 = typed(full, t, A.type[0], A.type[1]);
  c.font = BODY(30); c.fillStyle = C.ink; c.fillText(s1, 40, 102);
  if (t > A.type[0] - 0.3 && t < A.send && Math.floor(t * 2.4) % 2 === 0) { const cw = c.measureText(s1).width; c.fillStyle = C.blue; c.fillRect(44 + cw, 76, 3, 32); }
  const k = t > A.send ? 1 - 0.12 * Math.sin(Math.PI * span(t, A.send, A.send + 0.2)) : 1;
  c.save(); c.translate(w - 70, h / 2); c.scale(k, k); c.fillStyle = C.blue; c.beginPath(); c.arc(0, 0, 30, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(0, 12); c.lineTo(0, -11); c.moveTo(-9, -2); c.lineTo(0, -11); c.lineTo(9, -2); c.stroke(); c.restore();
  if (t > A.send) { const r = span(t, A.send, A.send + 0.6); if (r < 1) { c.strokeStyle = `rgba(47,91,255,${1 - r})`; c.lineWidth = 3; c.beginPath(); c.arc(w - 70, h / 2, 30 + 44 * r, 0, 7); c.stroke(); } }
  c.restore();
}
function node(c, [x, y], label, sub, t0, t, glow) {
  const s = ez.back(span(t, t0, t0 + 0.4), 2); if (s <= 0) return;
  c.save(); c.translate(x, y); c.scale(s, s);
  if (glow > 0) { c.shadowColor = `rgba(47,91,255,${0.5 * glow})`; c.shadowBlur = 40; }
  softCard(c, -105, -40, 210, 80, 20, { border: glow > 0.3 ? 'rgba(47,91,255,0.7)' : undefined });
  c.fillStyle = C.blueSoft; c.beginPath(); c.arc(-62, 0, 20, 0, 7); c.fill(); c.fillStyle = C.blue; c.beginPath(); c.arc(-62, 0, 7 + 3 * glow, 0, 7); c.fill();
  c.font = MONO(18); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText(sub, -30, -6); c.letterSpacing = '0px';
  c.font = BODY(30, 700); c.fillStyle = C.ink; c.fillText(label, -30, 26); c.restore();
}
function sceneAgent(c, t) {
  const A = TL.agent; cam(c, t, 3.1, 11.0);
  // headline above the card, gone once the card moves aside
  c.save(); c.globalAlpha = 1 - span(t, A.move[0] - 0.1, A.move[0] + 0.2); rise(c, 'You ask once.', 640, 230, HEAD(84), C.ink, A.head, t, { align: 'center' }); c.restore();
  const enter = ez.outExpo(span(t, A.card[0], A.card[1])), [cx, cy, s] = track([[A.move[0], 640, 380, 1], [A.move[1], 350, 240, 0.7]], t);
  if (enter > 0) promptCard(c, cx, cy + (1 - enter) * 300, s, t, Math.min(1, enter * 1.5));
  // the loop: arcs with flowing dashes, then a dot travelling round it
  const ap = span(t, A.arcs[0], A.arcs[1]);
  if (ap > 0) {
    c.save(); c.strokeStyle = 'rgba(47,91,255,0.55)'; c.lineWidth = 3; c.lineCap = 'round'; c.setLineDash([2, 11]); c.lineDashOffset = -t * 40;
    ARCS.forEach((P) => { const m = Math.max(2, Math.ceil(P.length * ap)); c.beginPath(); P.slice(0, m).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); }); c.restore();
    c.save(); c.font = MONO(22); c.fillStyle = C.blue; c.globalAlpha = 0.7 * ap; c.letterSpacing = '3px'; c.textAlign = 'center'; c.fillText('AGENT LOOP', 868, 408); c.restore();
  }
  let near = [0, 0, 0];
  if (t > A.loop[0] && t < A.loop[1]) {
    const u = ((t - A.loop[0]) / A.period) % 1, q = LOOP_PATH[Math.min(LOOP_PATH.length - 1, Math.floor(u * (LOOP_PATH.length - 1)))];
    near = [Math.max(0, 1 - Math.min(u, 1 - u) * 8), Math.max(0, 1 - Math.abs(u - 1 / 3) * 8), Math.max(0, 1 - Math.abs(u - 2 / 3) * 8)];
    const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 34); g.addColorStop(0, 'rgba(47,91,255,0.45)'); g.addColorStop(1, 'rgba(47,91,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(q[0], q[1], 34, 0, 7); c.fill();
    c.fillStyle = C.blue; c.beginPath(); c.arc(q[0], q[1], 9, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 7); c.fill();
  }
  node(c, LOOP.P, 'Plan', 'STEP 1', A.nodes[0], t, near[0]); node(c, LOOP.A, 'Act', 'STEP 2', A.nodes[1], t, near[1]); node(c, LOOP.K, 'Check', 'STEP 3', A.nodes[2], t, near[2]);
  // the task list fills in as each loop finishes
  if (t > A.rows[0] - 0.1) {
    const e = ez.outExpo(span(t, A.rows[0] - 0.1, A.rows[0] + 0.4)); c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 30);
    softCard(c, 90, 390, 500, 250, 24); c.font = MONO(22); c.fillStyle = C.mute; c.letterSpacing = '3px'; c.fillText('TASKS', 124, 434); c.letterSpacing = '0px';
    ['Search the web', 'Read 5 company sites', 'Draft the summary'].forEach((s, i) => {
      const y = 492 + i * 56, a = span(t, A.rows[i], A.rows[i] + 0.25), done = t > A.checks[i]; if (a <= 0) return; c.save(); c.globalAlpha *= a;
      c.strokeStyle = C.line; c.lineWidth = 2.5; c.beginPath(); c.arc(140, y - 9, 14, 0, 7); c.stroke();
      checkMark(c, 140, y - 9, 15, span(t, A.checks[i], A.checks[i] + 0.3), C.green);
      c.font = BODY(28, 600); c.fillStyle = done ? C.mute : C.ink; c.fillText(s, 172, y); c.restore();
    });
    c.restore();
  }
}
// ---------- scene 2: the result ----------
function sceneResult(c, t) {
  const R = TL.result; cam(c, t, 11.6, 15.6);
  const F = HEAD(78), p = span(t, R.pill, R.pill + 0.35);
  const b1 = riseLine(c, [['It', R.w[0]], ['checks', R.w[0] + 0.1, p > 0.6 ? '#fff' : C.ink]], 80, 236, F, C.ink, t);
  if (p > 0) { pillBehind(c, b1[1], F, p, C.blue, 14); rise(c, 'checks', b1[1].x, 236, F, '#fff', R.w[0] + 0.1, t); }
  riseLine(c, [['its', R.w[1]], ['own', R.w[1] + 0.08], ['work.', R.w[1] + 0.16]], 80, 330, F, C.ink, t);
  if (t > R.cnt[0] - 0.2) {
    c.save(); c.globalAlpha = span(t, R.cnt[0] - 0.2, R.cnt[0]); c.font = MONO(24); c.fillStyle = C.mute; c.letterSpacing = '3px'; c.fillText('STEPS TAKEN', 84, 448); c.letterSpacing = '0px';
    const done = t > R.cnt[1], pop = done ? 1 + 0.1 * Math.sin(Math.PI * span(t, R.cnt[1], R.cnt[1] + 0.3)) : 1;
    c.translate(84, 580); c.scale(pop, pop); c.font = HEAD(150); c.fillStyle = C.blue; c.fillText(String(stepCount(t)), 0, 0);
    c.font = BODY(30, 600); c.fillStyle = C.mute; c.fillText(done ? 'from one prompt' : '', 4, 46); c.restore();
  }
  // the document it wrote
  const e = ez.outExpo(span(t, R.doc[0], R.doc[1])); if (e <= 0) return;
  c.save(); c.globalAlpha = Math.min(1, e * 1.4); c.translate((1 - e) * 360, 0);
  const x = 560, y = 110, w = 640, h = 520; softCard(c, x, y, w, h, 26);
  c.font = HEAD(36); c.fillStyle = C.ink; c.fillText('Competitor summary', x + 40, y + 70);
  const fin = t > R.badge, tag = fin ? 'FINAL' : 'DRAFT'; c.font = MONO(18); const tw = c.measureText(tag).width + 28;
  c.fillStyle = fin ? '#e3f6ec' : C.blueSoft; rr(c, x + w - 40 - tw, y + 44, tw, 34, 17); c.fill(); c.fillStyle = fin ? C.green : C.blue; c.letterSpacing = '2px'; c.fillText(tag, x + w - 26 - tw, y + 67); c.letterSpacing = '0px';
  c.fillStyle = C.line; c.fillRect(x + 40, y + 100, w - 80, 1.5);
  c.font = MONO(20); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText('COMPANY', x + 40, y + 140); c.fillText('PRICE', x + 290, y + 140); c.fillText('STRENGTH', x + 410, y + 140); c.letterSpacing = '0px';
  const rows = [['Orbit', '$$', 0.82], ['Lumen', '$$$', 0.64], ['Kite', '$', 0.55], ['Northstar', '$$', 0.9], ['Pella', '$', 0.38]];
  rows.forEach(([n, pr, v], i) => {
    const t0 = R.rows + i * 0.18, a = span(t, t0, t0 + 0.25); if (a <= 0) return; const yy = y + 196 + i * 60;
    c.save(); c.globalAlpha *= a; c.font = BODY(28, 600); c.fillStyle = C.ink; c.fillText(n, x + 40, yy); c.font = BODY(28, 500); c.fillStyle = C.mute; c.fillText(pr, x + 290, yy);
    c.fillStyle = '#eef0f4'; rr(c, x + 410, yy - 20, 190, 14, 7); c.fill(); c.fillStyle = C.blue; rr(c, x + 410, yy - 20, 190 * v * ez.out3(span(t, t0 + 0.1, t0 + 0.6)), 14, 7); c.fill(); c.restore();
  });
  if (fin) { const s = ez.back(span(t, R.badge, R.badge + 0.35), 2.2); c.save(); c.translate(x + w - 30, y + h - 30); c.scale(s, s); c.fillStyle = C.green; rr(c, -190, -30, 190, 52, 26); c.fill(); checkMark(c, -160, -4, 14, 1, '#ffffff22'); c.font = BODY(26, 700); c.fillStyle = '#fff'; c.fillText('Checked', -138, 5); c.restore(); }
  c.restore();
}
// ---------- scene 3: takeaway ----------
function sceneTake(c, t) {
  const K = TL.take; cam(c, t, 16.1, 20);
  const F = HEAD(104);
  riseLine(c, [['Stop', K.w1[0]], ['prompting.', K.w1[1]]], 640, 316, F, C.faint, t, { align: 'center' });
  const p = span(t, K.pill, K.pill + 0.35), b = riseLine(c, [['Start', K.w2[0]], ['delegating.', K.w2[1], p > 0.6 ? '#fff' : C.ink]], 640, 446, F, C.ink, t, { align: 'center' });
  if (p > 0) { pillBehind(c, b[1], F, p, C.blue); rise(c, 'delegating.', b[1].x, 446, F, '#fff', K.w2[1], t); }
  if (t > K.note) { c.save(); const e = ez.outExpo(span(t, K.note, K.note + 0.5)); c.globalAlpha = e; c.font = MONO(28); c.fillStyle = C.blue; c.textAlign = 'center'; c.letterSpacing = '2px'; c.fillText('agent = goal + tools + loop', 640, 560 + (1 - e) * 16); c.restore(); }
}
var SCENES = [sceneHook, sceneAgent, sceneResult, sceneTake];
function explainer(ctx, t) {
  composite(ctx, t, SCENES, CUTS, background);
  const v = ctx.createRadialGradient(640, 360, 380, 640, 360, 820); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(20,24,40,0.07)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, HH);
}

// =================================== SOUND SCORE ===================================
// Airy and precise: a soft pad with light hats, small glassy ticks as words rise, clean swipes for the blue pills,
// soft keyboard and a send blip, pops for cards, a quiet chime per finished task, and smooth pushes between scenes.
function scoreSound(k) {
  { const k0 = k, G = 2.1; k = Object.assign({}, k0, { voice: (t, p) => k0.voice(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), hiss: (t, p) => k0.hiss(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), play: (n, t, o = {}) => k0.play(n, t, Object.assign({}, o, { gain: (o.gain == null ? 1 : o.gain) * G })) }); } // overall level
  const H = TL.hook, A = TL.agent, R = TL.result, K = TL.take;
  const rise1 = (t, pan = 0, g = 1) => { k.voice(t, { f: [[0, 760], [0.05, 1150]], dur: 0.07, gain: 0.07 * g, pan, soft: true }); k.hiss(t, { dur: 0.012, filter: 'highpass', ff: 6000, gain: 0.05 * g, pan, soft: true }); };
  const swipe = (t, pan = 0) => { k.hiss(t, { dur: 0.24, filter: 'bandpass', ff: [[0, 2400], [0.22, 6200]], q: 1.2, gain: 0.14, a: 0.08, pan }); k.voice(t + 0.12, { f: 'E6', dur: 0.5, gain: 0.05, verb: 0.35, pan }); };
  const chime = (t, pan = 0) => { k.voice(t, { f: 'C6', dur: 0.5, gain: 0.08, a: 0.003, verb: 0.3, pan }); k.voice(t + 0.07, { f: 'G6', dur: 0.6, gain: 0.07, a: 0.003, verb: 0.3, pan }); };
  padBed(k, 0.1, TL.D - 0.2, { bpm: 92, gain: 1, cut: 1400, chords: [['F3', 'A3', 'C4', 'E4'], ['D3', 'F3', 'A3', 'C4'], ['Bb2', 'D3', 'F3', 'A3'], ['C3', 'E3', 'G3', 'B3']], hats: [2.6, 15.6], kick: [3.1, 15.6] });
  // hook
  H.w1.concat(H.w2).forEach((t, i) => rise1(t, (i % 2 ? 0.2 : -0.2)));
  swipe(H.pill, 0.15);
  // scene pushes
  k.play('whoosh', CUTS[0].t, { dur: 0.5, gain: 0.55, dir: 1, top: 2400 }); k.play('whoosh', CUTS[2].t, { dur: 0.5, gain: 0.55, dir: 1, top: 2400 });
  // the agent
  rise1(A.head); k.play('whoosh', A.card[0], { dur: 0.5, gain: 0.25, dir: 1, top: 1500, soft: true });
  k.play('keys', A.type[0], { dur: A.type[1] - A.type[0], gain: 0.8, pan: 0 }); k.play('send', A.send, { gain: 1 });
  k.hiss(A.move[0], { color: 'pink', dur: 0.6, filter: 'bandpass', ff: [[0, 500], [0.3, 1600], [0.6, 600]], q: 0.8, gain: 0.08, a: 0.25, pan: [0.2, -0.4] });
  A.nodes.forEach((t, i) => k.play('pop', t + 0.06, { f: 700 + i * 140, gain: 0.55, pan: [0.4, 0.7, 0.4][i] }));
  k.hiss(A.arcs[0], { dur: A.arcs[1] - A.arcs[0], filter: 'bandpass', ff: [[0, 1500], [0.5, 3500]], q: 1.4, gain: 0.05, a: 0.2, pan: 0.5, soft: true });
  for (let t = A.loop[0]; t < A.loop[1] - 0.05; t += A.period / 3) k.play('tick', t, { f: 5200, gain: 0.3, pan: 0.5, soft: true });
  A.rows.forEach((t) => k.play('tick', t, { f: 3600, gain: 0.35, pan: -0.4, soft: true }));
  A.checks.forEach((t) => chime(t, -0.35));
  // zoom through into the result
  k.play('riser', CUTS[1].t - 0.5, { dur: 0.55, gain: 0.45 }); k.play('whoosh', CUTS[1].t + 0.1, { dur: 0.45, gain: 0.45, dir: -1, top: 3000 });
  rise1(R.w[0], -0.4); rise1(R.w[0] + 0.1, -0.4); [0, 0.08, 0.16].forEach((d) => rise1(R.w[1] + d, -0.4, 0.8));
  swipe(R.pill, -0.35);
  k.play('whoosh', R.doc[0], { dur: 0.5, gain: 0.3, dir: -1, top: 1800, soft: true });
  for (let i = 0; i < 5; i++) k.play('tick', R.rows + i * 0.18, { f: 4200, gain: 0.3, pan: 0.4, soft: true });
  { let last = -1; for (let t = R.cnt[0]; t <= R.cnt[1]; t += 1 / 120) { const v = stepCount(t); if (v !== last && v > 0) { k.play('tick', t, { f: 2600 + v * 90, gain: 0.45, pan: -0.5, soft: true }); last = v; } } }
  k.play('pop', R.cnt[1], { f: 980, gain: 0.5, pan: -0.5 });
  chime(R.badge, 0.45); k.voice(R.badge + 0.14, { f: 'C7', dur: 0.7, gain: 0.05, a: 0.003, verb: 0.35, pan: 0.45 });
  // takeaway
  K.w1.concat(K.w2).forEach((t, i) => rise1(t, 0, i < 2 ? 0.7 : 1));
  swipe(K.pill, 0.1);
  ['F4', 'A4', 'C5', 'E5'].forEach((n, i) => k.voice(K.pill + 0.15 + i * 0.06, { f: n, dur: 1.6, gain: 0.05, a: 0.01, verb: 0.4, pan: (i - 1.5) * 0.25 }));
  rise1(K.note, 0, 0.6);
}
