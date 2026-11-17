// Data Story (Data) style engine for the ai-video-editor skill.
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
// STYLE: Data Story
// A calm, editorial data explainer: deep ink background, one warm accent per idea, numbers that count,
// a line chart that draws itself through real milestones, bars that grow and get sonified, and a plain-language
// takeaway with the source always on screen. Demo: "How we got to 8 billion" (UN World Population Prospects).
// =====================================================================================================
const C = { bg: '#0f141c', ink: '#eef1f5', mute: '#7d8796', faint: '#667183', grid: 'rgba(238,241,245,0.07)', coral: '#ff6b5b', teal: '#3cc6b8', sand: '#f2c14e' };
const HEAD = (px, w = 800) => `${w} ${px}px "Archivo", system-ui, sans-serif`, MONO = (px, w = 500) => `${w} ${px}px "IBM Plex Mono", ui-monospace, monospace`;

// ---------- the data (UN World Population Prospects; 1800 to 1900 values are historical estimates) ----------
const POP = [[1800, 0.98], [1804, 1.0], [1850, 1.26], [1900, 1.6], [1927, 2], [1950, 2.5], [1960, 3], [1974, 4], [1987, 5], [1999, 6], [2011, 7], [2022, 8]];
const BILLIONS = [1804, 1927, 1960, 1974, 1987, 1999, 2011, 2022];
const YEARS_PER = [123, 33, 14, 13, 12, 12, 11];

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 21,
  hook: { tag: 0.1, count: [0.3, 2.4], sub: 2.6, shrink: [3.6, 4.3] },
  line: { title: [3.9, 4.05], axes: [3.9, 4.5], draw: [4.5, 7.9], span: [8.1, 8.9], note: 8.5 },
  bars: { title: 10.55, base: [10.6, 11.0], bar0: 11.0, gap: 0.26, ring: 13.0, ringNote: 13.4 },
  cmp: { a: 15.15, b: 15.55, x: [16.1, 16.9], sub: 17.0 },
  take: { w1: [18.55, 18.7, 18.85], w2: [19.1, 19.25, 19.4], pill: 19.65, note: 20.1 },
};
var CUTS = [{ t: 10.0, d: 0.6, type: 'up' }, { t: 14.6, d: 0.5, type: 'push', dir: 1 }, { t: 18.0, d: 0.55, type: 'up' }];
const X = (yr) => 150 + (yr - 1800) / (2025 - 1800) * 1000, Y = (b) => 600 - (b / 8.5) * 440;
// monotone cubic through the data so the curve never overshoots a real value
const SLOPES = (() => { const n = POP.length, d = [], m = []; for (let i = 0; i < n - 1; i++) d.push((POP[i + 1][1] - POP[i][1]) / (POP[i + 1][0] - POP[i][0])); m[0] = d[0]; m[n - 1] = d[n - 2]; for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]); return m; })();
function popAt(yr) {
  if (yr <= POP[0][0]) return POP[0][1]; for (let i = 0; i < POP.length - 1; i++) { const [x0, y0] = POP[i], [x1, y1] = POP[i + 1]; if (yr <= x1) { const h = x1 - x0, s = (yr - x0) / h, s2 = s * s, s3 = s2 * s; return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * SLOPES[i] + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * SLOPES[i + 1]; } }
  return POP[POP.length - 1][1];
}
const yearAt = (t) => lerp(1800, 2022, ez.inout3(span(t, TL.line.draw[0], TL.line.draw[1])));
const countAt = (t) => Math.round(8e9 * ez.outExpo(span(t, TL.hook.count[0], TL.hook.count[1])) / 1e6) * 1e6;
const fmtN = (n) => n.toLocaleString('en-US');

// ---------- background ----------
function background(c, t) {
  c.fillStyle = C.bg; c.fillRect(0, 0, W, HH);
  const g = c.createRadialGradient(280 + Math.sin(t * 0.2) * 50, 110, 0, 280, 110, 900); g.addColorStop(0, 'rgba(255,107,91,0.075)'); g.addColorStop(1, 'rgba(255,107,91,0)'); c.fillStyle = g; c.fillRect(0, 0, W, HH);
  const g2 = c.createRadialGradient(1100, 650, 0, 1100, 650, 700); g2.addColorStop(0, 'rgba(60,198,184,0.05)'); g2.addColorStop(1, 'rgba(60,198,184,0)'); c.fillStyle = g2; c.fillRect(0, 0, W, HH);
}
function source(c, t) { c.save(); c.globalAlpha = 0.9 * span(t, 0.4, 1.0); c.font = MONO(16); c.fillStyle = '#5f6a7a'; c.fillText('Source: UN World Population Prospects', 150, 690); c.restore(); }
function tag(c, s, x, y, t0, t, col = C.coral, align = 'left') { c.save(); c.globalAlpha *= span(t, t0, t0 + 0.3); c.font = MONO(22, 600); c.fillStyle = col; c.letterSpacing = '4px'; c.textAlign = align; c.fillText(s, x, y); c.restore(); }
function cam(c, t, a, b) { const z = 1 + 0.022 * ez.inout3(span(t, a, b)); c.translate(640, 360); c.scale(z, z); c.translate(-640, -360); }

// ---------- scene 0+1: the counter that becomes a chart ----------
function sceneLine(c, t) {
  const H = TL.hook, L = TL.line;
  // counter: big at center, then shrinks into a label at the top right
  const sh = ez.inout3(span(t, H.shrink[0], H.shrink[1])), F = HEAD(128), str = fmtN(countAt(t)), fw = textW(c, fmtN(8e9), F);
  c.save(); c.globalAlpha = 1 - span(t, H.shrink[0] - 0.3, H.shrink[0]); tag(c, 'WORLD POPULATION', 640, 250, H.tag, t, C.coral, 'center'); c.restore();
  { const s = lerp(1, 0.25, sh), cx = lerp(640, 1150 - fw * 0.25 / 2, sh), cy = lerp(390, 118, sh);
    c.save(); c.translate(cx, cy); c.scale(s, s); c.font = F; c.textAlign = 'center'; c.fillStyle = C.ink; c.shadowColor = 'rgba(255,107,91,0.25)'; c.shadowBlur = 40 * (1 - sh); c.fillText(str, 0, 0); c.restore(); }
  if (t > H.sub) { c.save(); c.globalAlpha = span(t, H.sub, H.sub + 0.4) * (1 - span(t, H.shrink[0] - 0.2, H.shrink[0] + 0.1)); rise(c, 'people. We crossed it in November 2022.', 640, 470, MONO(28), C.mute, H.sub, t, { align: 'center' }); c.restore(); }
  if (t < L.axes[0]) return;
  c.save(); cam(c, t, L.axes[0], 10);
  // title + gridlines + axis labels
  tag(c, 'WORLD POPULATION', 150, 70, L.title[0], t);
  riseLine(c, [['How', L.title[0]], ['we', L.title[0] + 0.06], ['got', L.title[0] + 0.12], ['to', L.title[0] + 0.18], ['8', L.title[1] + 0.2], ['billion', L.title[1] + 0.26]], 150, 128, HEAD(50), C.ink, t);
  const ax = ez.outExpo(span(t, L.axes[0], L.axes[1]));
  [2, 4, 6, 8].forEach((b, i) => { const a = span(t, L.axes[0] + i * 0.06, L.axes[0] + 0.3 + i * 0.06); c.strokeStyle = C.grid; c.lineWidth = 1; c.beginPath(); c.moveTo(150, Y(b)); c.lineTo(150 + 1000 * ax, Y(b)); c.stroke(); c.save(); c.globalAlpha = a; c.font = MONO(16); c.fillStyle = C.faint; c.textAlign = 'right'; c.fillText(b + 'B', 136, Y(b) + 5); c.restore(); });
  c.strokeStyle = 'rgba(238,241,245,0.3)'; c.lineWidth = 2; c.beginPath(); c.moveTo(150, 600); c.lineTo(150 + 1000 * ax, 600); c.stroke();
  [1800, 1850, 1900, 1950, 2000].forEach((yr, i) => { c.save(); c.globalAlpha = span(t, L.axes[0] + 0.2 + i * 0.05, L.axes[0] + 0.5 + i * 0.05); c.font = MONO(16); c.fillStyle = C.faint; c.textAlign = 'center'; c.fillText(String(yr), X(yr), 628); c.restore(); });
  // the line, area and head
  const yr = yearAt(t);
  if (t > L.draw[0]) {
    const pts = []; for (let y = 1800; y < yr; y += 1) pts.push([X(y), Y(popAt(y))]); pts.push([X(yr), Y(popAt(yr))]);
    const ag = c.createLinearGradient(0, 180, 0, 600); ag.addColorStop(0, 'rgba(255,107,91,0.28)'); ag.addColorStop(1, 'rgba(255,107,91,0)');
    c.fillStyle = ag; c.beginPath(); c.moveTo(X(1800), 600); pts.forEach(([x, y]) => c.lineTo(x, y)); c.lineTo(pts[pts.length - 1][0], 600); c.closePath(); c.fill();
    c.strokeStyle = C.coral; c.lineWidth = 4; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    // the last 95 years glow sand once the span lands
    const sp = span(t, L.span[0], L.span[1]);
    if (sp > 0) { const yEnd = lerp(1927, 2022, ez.inout3(sp)); c.strokeStyle = C.sand; c.lineWidth = 6; c.shadowColor = 'rgba(242,193,78,0.6)'; c.shadowBlur = 18; c.beginPath(); for (let y = 1927; y <= yEnd; y += 1) { const P = [X(y), Y(popAt(y))]; y === 1927 ? c.moveTo(...P) : c.lineTo(...P); } c.stroke(); c.shadowBlur = 0; c.shadowColor = 'transparent'; }
    // milestone dots
    BILLIONS.forEach((by, i) => { if (yr < by) return; const passT = TL.line.draw[0] + inverseYear(by), s = ez.back(span(t, passT, passT + 0.3), 2.4); c.save(); c.translate(X(by), Y(i + 1)); c.scale(s, s); c.fillStyle = C.bg; c.strokeStyle = sp > 0 && by >= 1927 ? C.sand : C.coral; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill(); c.stroke(); c.restore(); });
    // labels on the key milestones
    [[0, '1B · 1804', -1], [1, '2B · 1927', 1], [7, '8B · 2022', 1]].forEach(([i, s, side]) => { const by = BILLIONS[i]; if (yr < by) return; const passT = TL.line.draw[0] + inverseYear(by); c.save(); c.globalAlpha = span(t, passT + 0.1, passT + 0.4); c.font = MONO(18, 600); c.fillStyle = C.ink; c.textAlign = side > 0 ? 'right' : 'left'; c.fillText(s, X(by) + (side > 0 ? -16 : 8), Y(i + 1) - 18); c.restore(); });
    if (yr < 2022) { const hx = X(yr), hy = Y(popAt(yr)), g = c.createRadialGradient(hx, hy, 0, hx, hy, 30); g.addColorStop(0, 'rgba(255,107,91,0.6)'); g.addColorStop(1, 'rgba(255,107,91,0)'); c.fillStyle = g; c.beginPath(); c.arc(hx, hy, 30, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(hx, hy, 5, 0, 7); c.fill(); }
    if (t > L.note) { const e = ez.outExpo(span(t, L.note, L.note + 0.5)); c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 14); c.font = HEAD(40, 800); c.fillStyle = C.sand; c.fillText('+6 billion', 560, 300); c.font = MONO(22); c.fillStyle = C.ink; c.fillText('in just 95 years', 560, 336); c.restore(); }
  }
  c.restore();
}
// time (seconds into the draw) at which the line reaches a given year
function inverseYear(by) { let lo = 0, hi = TL.line.draw[1] - TL.line.draw[0]; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (yearAt(TL.line.draw[0] + m) < by) lo = m; else hi = m; } return hi; }

// ---------- scene 2: years to add each billion ----------
const BAR = { base: 600, scale: 380 / 123, x: (i) => 190 + i * 140, w: 92 };
const barT = (i) => TL.bars.bar0 + i * TL.bars.gap;
function sceneBars(c, t) {
  const B = TL.bars; cam(c, t, 10, 14.6);
  tag(c, 'EACH NEW BILLION', 150, 92, B.title - 0.1, t);
  riseLine(c, [['Years', B.title], ['to', B.title + 0.06], ['add', B.title + 0.12], ['each', B.title + 0.18], ['billion', B.title + 0.24]], 150, 150, HEAD(52), C.ink, t);
  c.strokeStyle = 'rgba(238,241,245,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(150, BAR.base); c.lineTo(150 + 1030 * ez.outExpo(span(t, B.base[0], B.base[1])), BAR.base); c.stroke();
  YEARS_PER.forEach((v, i) => {
    const t0 = barT(i), p = ez.outExpo(span(t, t0, t0 + 0.55)), x = BAR.x(i), h = v * BAR.scale * p; if (p <= 0) return;
    const col = i === 0 ? C.coral : i === 6 ? C.sand : C.teal; c.fillStyle = col; rr(c, x, BAR.base - h, BAR.w, h, [8, 8, 0, 0]); c.fill();
    c.save(); c.globalAlpha = span(t, t0 + 0.2, t0 + 0.45); c.font = MONO(30, 600); c.fillStyle = C.ink; c.textAlign = 'center'; c.fillText(String(Math.round(v * p)), x + BAR.w / 2, BAR.base - h - 14);
    c.font = MONO(26); c.fillStyle = C.mute; c.fillText(`${i + 2}B`, x + BAR.w / 2, BAR.base + 40); c.restore();
  });
  const r = span(t, B.ring, B.ring + 0.45); if (r > 0) { const x = BAR.x(6) + BAR.w / 2, y = BAR.base - 11 * BAR.scale - 30; c.strokeStyle = C.sand; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.arc(x, y, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ez.outExpo(r)); c.stroke(); }
  if (t > B.ringNote) { const e = ez.outExpo(span(t, B.ringNote, B.ringNote + 0.5)); c.save(); c.globalAlpha = e; c.font = MONO(22); c.fillStyle = C.sand; c.textAlign = 'right'; c.fillText('the 8th billion took 11 years', BAR.x(6) - 18 + (1 - e) * 20, BAR.base - 11 * BAR.scale - 104); c.restore(); }
}
// ---------- scene 3: the comparison ----------
function cmpCard(c, x, label, num, col, t0, t) {
  const e = ez.outExpo(span(t, t0, t0 + 0.55)); if (e <= 0) return; c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 40);
  c.fillStyle = 'rgba(238,241,245,0.04)'; rr(c, x, 190, 380, 340, 24); c.fill(); c.strokeStyle = 'rgba(238,241,245,0.10)'; c.lineWidth = 1.5; rr(c, x, 190, 380, 340, 24); c.stroke();
  c.font = MONO(22, 600); c.fillStyle = C.mute; c.letterSpacing = '3px'; c.fillText(label, x + 36, 246); c.letterSpacing = '0px';
  const n = Math.round(num * ez.out3(span(t, t0 + 0.1, t0 + 0.8))); c.font = HEAD(150); c.fillStyle = col; c.fillText(String(n), x + 30, 420);
  c.font = MONO(28); c.fillStyle = C.ink; c.fillText('years', x + 38, 478); c.restore();
}
function sceneCmp(c, t) {
  const K = TL.cmp; cam(c, t, 14.6, 18);
  cmpCard(c, 100, '1B → 2B', 123, C.coral, K.a, t); cmpCard(c, 800, '7B → 8B', 11, C.sand, K.b, t);
  const k = span(t, K.x[0], K.x[1]); if (k > 0) {
    const n = Math.max(1, Math.round(11 * ez.out3(k))), pop = t > K.x[1] ? 1 + 0.12 * Math.sin(Math.PI * span(t, K.x[1], K.x[1] + 0.25)) : 1;
    c.save(); c.translate(640, 380); c.scale(pop, pop); c.font = HEAD(104); c.textAlign = 'center'; c.shadowColor = 'rgba(242,193,78,0.45)'; c.shadowBlur = 36; c.fillStyle = C.sand; c.globalAlpha = Math.min(1, k * 3); c.fillText(n + '×', 0, 0); c.restore();
  }
  if (t > K.sub) { c.save(); c.globalAlpha = ez.outExpo(span(t, K.sub, K.sub + 0.4)); c.font = MONO(24); c.fillStyle = C.ink; c.textAlign = 'center'; c.fillText('faster', 640, 428); c.restore(); }
}
// ---------- scene 4: takeaway ----------
function sceneTake(c, t) {
  const K = TL.take; cam(c, t, 18, 21); const F = HEAD(88);
  riseLine(c, [['The', K.w1[0]], ['fastest', K.w1[1]], ['growth', K.w1[2]]], 640, 320, F, C.ink, t, { align: 'center' });
  const p = span(t, K.pill, K.pill + 0.4), on = p > 0.6, b = riseLine(c, [['is', K.w2[0]], ['behind', K.w2[1], on ? C.bg : C.ink], ['us.', K.w2[2], on ? C.bg : C.ink]], 640, 430, F, C.ink, t, { align: 'center' });
  if (p > 0) { const box = { x: b[1].x, w: b[2].x + b[2].w - b[1].x, y: 430 }; pillBehind(c, box, F, p, C.sand, 18); rise(c, 'behind', b[1].x, 430, F, C.bg, K.w2[1], t); rise(c, 'us.', b[2].x, 430, F, C.bg, K.w2[2], t); }
  if (t > K.note) { const e = ez.outExpo(span(t, K.note, K.note + 0.5)); c.save(); c.globalAlpha = e; c.font = MONO(24); c.fillStyle = C.mute; c.textAlign = 'center'; c.fillText('Growth peaked in the 1960s at about 2% a year.', 640, 540 + (1 - e) * 14); c.restore(); }
}
var SCENES = [sceneLine, sceneBars, sceneCmp, sceneTake];
function explainer(ctx, t) {
  composite(ctx, t, SCENES, CUTS, background);
  source(ctx, t);
  const v = ctx.createRadialGradient(640, 360, 400, 640, 360, 860); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.3)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, HH);
}

// =================================== SOUND SCORE ===================================
// Thoughtful and warm: a low pad with a soft pulse, a ticking counter, a pluck for every billion the line passes
// (pitch climbs with the population), bars that sound their height, a bright swipe for the ring and the pill,
// a deep hit for the 11x, and an open chord to land the takeaway.
function scoreSound(k) {
  { const k0 = k, G = 2.0; k = Object.assign({}, k0, { voice: (t, p) => k0.voice(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), hiss: (t, p) => k0.hiss(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), play: (n, t, o = {}) => k0.play(n, t, Object.assign({}, o, { gain: (o.gain == null ? 1 : o.gain) * G })) }); }
  const H = TL.hook, L = TL.line, B = TL.bars, K = TL.cmp, T = TL.take;
  const rise1 = (t, g = 1, pan = 0) => { k.voice(t, { f: [[0, 600], [0.05, 900]], dur: 0.08, gain: 0.06 * g, pan, soft: true }); k.hiss(t, { dur: 0.012, filter: 'highpass', ff: 5500, gain: 0.04 * g, pan, soft: true }); };
  const pluck = (t, f, g = 1, pan = 0) => { k.voice(t, { type: 'triangle', f, dur: 0.7, gain: 0.09 * g, a: 0.003, verb: 0.35, pan }); k.voice(t, { f: f * 2, dur: 0.3, gain: 0.03 * g, a: 0.002, pan }); };
  const swipe = (t, pan = 0) => { k.hiss(t, { dur: 0.26, filter: 'bandpass', ff: [[0, 2000], [0.24, 5600]], q: 1.2, gain: 0.12, a: 0.08, pan }); k.voice(t + 0.12, { f: 'B5', dur: 0.6, gain: 0.05, verb: 0.35, pan }); };
  const scale = [196, 220, 247, 294, 330, 392, 440, 494, 587, 659];
  padBed(k, 0.1, TL.D - 0.2, { bpm: 84, gain: 1, cut: 1100, chords: [['A2', 'E3', 'G3', 'C4'], ['F2', 'C3', 'E3', 'A3'], ['C3', 'G3', 'B3', 'E4'], ['G2', 'D3', 'F#3', 'B3']], hats: [4.5, 18.0], kick: [10.0, 18.0] });
  // counter
  k.play('tick', H.tag, { f: 3400, gain: 0.3, soft: true });
  { let last = -1; for (let t = H.count[0]; t <= H.count[1]; t += 1 / 30) { const v = Math.floor(countAt(t) / 2e8); if (v !== last) { k.play('tick', t, { f: 1800 + v * 70, gain: 0.32, soft: true }); last = v; } } }
  k.play('pop', H.count[1], { f: 620, gain: 0.5 }); k.voice(H.count[1] + 0.02, { f: 'A5', dur: 1.2, gain: 0.05, a: 0.003, verb: 0.45 });
  rise1(H.sub, 0.7); k.play('whoosh', H.shrink[0], { dur: 0.6, gain: 0.35, dir: 1, top: 1800 });
  // chart
  [0, 0.06, 0.12, 0.18, 0.46, 0.52].forEach((d) => rise1(L.title[0] + d, 0.8, -0.4));
  k.hiss(L.axes[0], { dur: 0.6, filter: 'bandpass', ff: [[0, 900], [0.5, 2600]], q: 1, gain: 0.05, a: 0.2, soft: true });
  k.hiss(L.draw[0], { color: 'pink', dur: L.draw[1] - L.draw[0], filter: 'bandpass', ff: [[0, 300], [3.4, 1400]], q: 1.2, gain: 0.04, a: 1.2, pan: [-0.5, 0.6], soft: true });
  BILLIONS.forEach((by, i) => pluck(L.draw[0] + inverseYear(by), scale[i + 1], 1, -0.6 + i * 0.17));
  swipe(L.span[0], 0.2); k.play('pop', L.note, { f: 700, gain: 0.4 });
  // bars
  k.play('whoosh', CUTS[0].t, { dur: 0.55, gain: 0.45, dir: 1, top: 2000 });
  [0, 0.06, 0.12, 0.18, 0.24].forEach((d) => rise1(B.title + d, 0.8));
  YEARS_PER.forEach((v, i) => pluck(barT(i) + 0.03, 196 * Math.pow(2, (1 - v / 123) * 1.6), 1.1, -0.6 + i * 0.2));
  swipe(B.ring, 0.6); k.play('tick', B.ringNote, { f: 3000, gain: 0.3, soft: true });
  // comparison
  k.play('whoosh', CUTS[1].t, { dur: 0.5, gain: 0.5, dir: 1, top: 2400 });
  k.play('pop', K.a + 0.05, { f: 520, gain: 0.45, pan: -0.5 }); k.play('pop', K.b + 0.05, { f: 780, gain: 0.45, pan: 0.5 });
  for (let i = 1; i <= 11; i++) { const tt = K.x[0] + (i / 11) * (K.x[1] - K.x[0]) * 0.8; k.play('tick', tt, { f: 2000 + i * 160, gain: 0.35, soft: true }); }
  k.play('boom', K.x[1], { gain: 0.5 }); k.voice(K.x[1] + 0.02, { f: 'E6', dur: 1.2, gain: 0.05, a: 0.003, verb: 0.45 });
  // takeaway
  k.play('whoosh', CUTS[2].t, { dur: 0.5, gain: 0.4, dir: -1, top: 1800 });
  T.w1.concat(T.w2).forEach((t) => rise1(t)); swipe(T.pill, 0);
  ['A3', 'E4', 'G4', 'C5', 'E5'].forEach((n, i) => k.voice(T.pill + 0.18 + i * 0.07, { f: n, dur: 2.0, gain: 0.045, a: 0.01, verb: 0.45, pan: (i - 2) * 0.22 }));
  rise1(T.note, 0.6);
}
