// Software Walkthrough (Screen and UI) style engine for the ai-video-editor skill.
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
// STYLE: Software Walkthrough
// A screen-recording style tutorial built entirely in code: an app window on a soft gradient desktop,
// a real-feeling cursor with click ripples, a camera that zooms into what matters, spotlight cutouts,
// numbered step callouts and a calm pad underneath. Demo: "Your first automation" in an invented app, Flowdesk.
// =====================================================================================================
const C = { ink: '#14161c', mute: '#6a6f7c', faint: '#a3a8b4', line: '#e8eaef', side: '#f8f9fb', bar: '#f3f4f7', acc: '#5b5bf6', accDeep: '#4646e0', accSoft: '#ecebff', green: '#1fb46e', greenSoft: '#e4f6ec', yellow: '#ffd60a', dark: 'rgba(14,16,26,0.92)' };
const SANS = (px, w = 500) => `${w} ${px}px "DM Sans", system-ui, sans-serif`, MONO = (px, w = 500) => `${w} ${px}px "DM Mono", ui-monospace, monospace`;
const WIN = { x: 80, y: 50, w: 1120, h: 620 }, NX = 690;

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 19.5,
  intro: { tag: 0.1, w1: [0.25, 0.4], w2: [0.55], meta: 0.95, out: [1.9, 2.3], win: [2.0, 2.6] },
  steps: [2.5, 5.0, 8.7, 13.0], stepsOut: 17.2,
  clicks: [3.05, 4.45, 5.95, 6.9, 7.5, 8.3, 9.95, 10.6, 11.05, 13.95],
  modal: [4.6, 8.45], list: [6.95, 7.55], editor: 8.6, trig: 8.8, wire: [9.1, 9.4], plus: 9.4, menu: [10.05, 10.7], node: 10.75,
  type: [11.2, 11.8], chips: [12.0, 12.2, 12.4], live: 13.95, toast: [14.15, 15.4], notif: [15.0, 17.0], panel: 15.6, row: 16.15,
  outro: { card: 17.4, w1: 17.55, w2: 18.0 },
};
const CAM = [[0, 640, 360, 1], [3.5, 640, 360, 1], [4.1, 770, 450, 1.5], [4.7, 770, 450, 1.5], [5.3, 700, 380, 1.22], [8.3, 700, 380, 1.22], [8.8, 640, 360, 1], [9.3, 640, 360, 1], [9.8, 720, 370, 1.3], [12.6, 720, 370, 1.3], [13.2, 640, 360, 1], [13.45, 640, 360, 1], [13.9, 1000, 210, 1.6], [14.6, 1000, 210, 1.6], [15.2, 640, 360, 1], [15.6, 640, 360, 1], [16.2, 980, 360, 1.3], [17.3, 980, 360, 1.3], [17.9, 640, 380, 0.95], [19.5, 640, 380, 0.93]];
const CURSOR = [[2.4, 640, 610], [2.95, 200, 222], [3.4, 200, 222], [4.3, 770, 470], [4.6, 770, 470], [5.8, 700, 338], [6.1, 700, 338], [6.8, 700, 482], [7.0, 700, 482], [7.4, 690, 530], [7.6, 690, 530], [8.2, 935, 562], [8.4, 935, 562], [9.8, NX + 6, 326], [10.1, NX + 6, 326], [10.5, 850, 374], [10.7, 850, 374], [11.0, 640, 428], [12.8, 640, 428], [13.8, 1092, 124], [14.3, 1092, 124], [15.0, 1000, 300], [17.3, 1000, 300]];
const STEP_NAMES = ['Create an automation', 'Pick a trigger', 'Add an action', 'Turn it on'];
const sel = (t) => (t > TL.clicks[0] ? 1 : 0);
const pressed = (t) => TL.clicks.some((c) => t > c - 0.02 && t < c + 0.1);

// ---------- desktop ----------
function wallpaper(c, t) {
  const g = c.createLinearGradient(0, 0, W, HH); g.addColorStop(0, '#3b3f8f'); g.addColorStop(0.55, '#2a6f8f'); g.addColorStop(1, '#1c8a7a'); c.fillStyle = g; c.fillRect(-400, -400, W + 800, HH + 800);
  const b = c.createRadialGradient(300 + Math.sin(t * 0.25) * 80, 140, 0, 300, 140, 700); b.addColorStop(0, 'rgba(255,255,255,0.16)'); b.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = b; c.fillRect(-400, -400, W + 800, HH + 800);
  const b2 = c.createRadialGradient(1100, 640 + Math.cos(t * 0.2) * 40, 0, 1100, 640, 600); b2.addColorStop(0, 'rgba(120,255,214,0.14)'); b2.addColorStop(1, 'rgba(120,255,214,0)'); c.fillStyle = b2; c.fillRect(-400, -400, W + 800, HH + 800);
}

// ---------- app pieces ----------
function sidebar(c, t) {
  const { x, y, h } = WIN; c.fillStyle = C.side; c.fillRect(x, y + 40, 230, h - 40); c.fillStyle = C.line; c.fillRect(x + 230, y + 40, 1, h - 40);
  c.fillStyle = C.acc; rr(c, 104, 112, 30, 30, 8); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(112, 132); c.lineTo(119, 120); c.lineTo(124, 129); c.lineTo(128, 122); c.stroke();
  c.font = SANS(22, 700); c.fillStyle = C.ink; c.fillText('Flowdesk', 146, 134);
  const s = sel(t), k = span(t, TL.clicks[0], TL.clicks[0] + 0.2);
  ['Home', 'Automations', 'Templates', 'Settings'].forEach((n, i) => {
    const yy = 228 + i * 48 - 48; const on = i === s, a = i === 1 ? k : i === 0 ? 1 - k : 0;
    if (a > 0) { c.save(); c.globalAlpha = a; c.fillStyle = C.accSoft; rr(c, 96, yy - 26, 198, 40, 10); c.fill(); c.restore(); }
    c.fillStyle = on ? C.accDeep : '#4a4f5c'; c.font = SANS(20, on ? 700 : 500); c.fillText(n, 118, yy);
  });
  c.font = MONO(14); c.fillStyle = C.faint; c.fillText('FREE PLAN', 106, 640);
}
function header(c, t) {
  const x0 = 340; c.fillStyle = C.line; c.fillRect(311, 150, 889, 1);
  const ed = t > TL.editor, title = t < TL.clicks[0] ? 'Home' : ed ? 'New automation' : 'Automations';
  c.font = SANS(26, 700); c.fillStyle = C.ink; c.fillText(title, x0, 130);
  if (ed) {
    c.save(); c.globalAlpha = span(t, TL.editor, TL.editor + 0.3); const on = span(t, TL.live, TL.live + 0.22), lv = t > TL.live + 0.1;
    c.font = MONO(15); c.fillStyle = lv ? C.green : C.faint; c.textAlign = 'right'; c.letterSpacing = '2px'; c.fillText(lv ? 'LIVE' : 'OFF', 1046, 126); c.letterSpacing = '0px'; c.textAlign = 'left';
    c.fillStyle = '#d9dce3'; rr(c, 1060, 103, 64, 34, 17); c.fill(); if (on > 0) { c.globalAlpha *= on; c.fillStyle = C.green; rr(c, 1060, 103, 64, 34, 17); c.fill(); c.globalAlpha = span(t, TL.editor, TL.editor + 0.3); }
    const kx = lerp(1077, 1107, ez.back(on, 1.4)); c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 4; c.shadowOffsetY = 1; c.fillStyle = '#fff'; c.beginPath(); c.arc(kx, 120, 13, 0, 7); c.fill(); c.restore();
  }
}
function homePage(c, a) {
  if (a <= 0) return; c.save(); c.globalAlpha = a;
  c.font = SANS(34, 700); c.fillStyle = C.ink; c.fillText('Good morning', 340, 220); c.font = SANS(20, 400); c.fillStyle = C.mute; c.fillText('Here is what ran overnight.', 340, 252);
  for (let i = 0; i < 3; i++) { const x = 340 + i * 280; c.fillStyle = '#f6f7f9'; rr(c, x, 290, 256, 150, 14); c.fill(); c.fillStyle = '#e7e9ee'; rr(c, x + 24, 320, 120, 14, 7); c.fill(); rr(c, x + 24, 350, 190, 10, 5); c.fill(); rr(c, x + 24, 372, 150, 10, 5); c.fill(); }
  c.restore();
}
function emptyState(c, t, a) {
  if (a <= 0) return; c.save(); c.globalAlpha = a; const cx = 755;
  c.fillStyle = C.accSoft; c.beginPath(); c.arc(cx, 290, 48, 0, 7); c.fill(); c.strokeStyle = C.acc; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(cx - 3, 268); c.lineTo(cx - 15, 294); c.lineTo(cx + 5, 294); c.lineTo(cx - 7, 314); c.stroke();
  c.textAlign = 'center'; c.font = SANS(30, 700); c.fillStyle = C.ink; c.fillText('No automations yet', cx, 378);
  c.font = SANS(20, 400); c.fillStyle = C.mute; c.fillText('Connect your apps and let the busywork run itself.', cx, 410);
  const k = 1 - 0.06 * Math.sin(Math.PI * span(t, TL.clicks[1], TL.clicks[1] + 0.2));
  c.translate(cx, 462); c.scale(k, k); c.fillStyle = C.acc; rr(c, -130, -26, 260, 52, 12); c.fill(); c.font = SANS(20, 700); c.fillStyle = '#fff'; c.fillText('+ New automation', 0, 7);
  c.restore();
}
function modal(c, t) {
  const [m0, m1] = TL.modal, open = ez.outExpo(span(t, m0, m0 + 0.4)) * (1 - ez.in3(span(t, m1, m1 + 0.25))); if (open <= 0) return;
  c.save(); c.fillStyle = `rgba(14,16,26,${0.32 * open})`; c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
  c.globalAlpha = Math.min(1, open * 1.3); c.translate(755, 380); const s = 0.94 + 0.06 * open; c.scale(s, s); c.translate(-755, -380 + (1 - open) * 20);
  softCard(c, 475, 160, 560, 440, 18, { shadow: 'rgba(10,12,30,0.3)', blur: 50, offY: 20 });
  c.font = SANS(28, 700); c.fillStyle = C.ink; c.fillText('When should it run?', 511, 214); c.font = SANS(18, 400); c.fillStyle = C.mute; c.fillText('Pick a trigger. You can change it later.', 511, 242);
  const pick = span(t, TL.clicks[2], TL.clicks[2] + 0.2);
  [['New email', '@'], ['New form reply', '≡'], ['Every morning at 9', '◷']].forEach(([n, ic], i) => {
    const y = 286 + i * 56, on = i === 1 ? pick : 0;
    c.fillStyle = on > 0 ? `rgba(236,235,255,${on})` : '#fff'; rr(c, 505, y - 30, 500, 50, 12); c.fill();
    c.strokeStyle = on > 0.5 ? C.acc : C.line; c.lineWidth = on > 0.5 ? 2 : 1.5; rr(c, 505, y - 30, 500, 50, 12); c.stroke();
    c.fillStyle = on > 0.5 ? C.acc : '#f0f1f4'; rr(c, 519, y - 20, 30, 30, 8); c.fill(); c.font = SANS(18, 700); c.fillStyle = on > 0.5 ? '#fff' : C.mute; c.textAlign = 'center'; c.fillText(ic, 534, y + 1); c.textAlign = 'left';
    c.font = SANS(20, on > 0.5 ? 700 : 500); c.fillStyle = C.ink; c.fillText(n, 563, y + 2);
    if (i === 1) checkMark(c, 980, y - 5, 12, pick, C.acc);
  });
  // which form
  const fa = span(t, TL.clicks[2] + 0.25, TL.clicks[2] + 0.55);
  if (fa > 0) {
    c.save(); c.globalAlpha *= fa; c.font = SANS(17, 700); c.fillStyle = C.mute; c.fillText('Which form?', 511, 446);
    const chosen = t > TL.clicks[4]; c.strokeStyle = t > TL.clicks[3] && !chosen ? C.acc : C.line; c.lineWidth = 2; rr(c, 505, 458, 500, 44, 10); c.stroke();
    c.font = SANS(19, chosen ? 600 : 400); c.fillStyle = chosen ? C.ink : C.faint; c.fillText(chosen ? 'Contact form' : 'Choose a form', 521, 487);
    c.strokeStyle = C.mute; c.lineWidth = 2; c.beginPath(); c.moveTo(978, 476); c.lineTo(985, 483); c.lineTo(992, 476); c.stroke(); c.restore();
  }
  // continue button
  const ca = span(t, TL.clicks[4] + 0.05, TL.clicks[4] + 0.3), k = 1 - 0.07 * Math.sin(Math.PI * span(t, TL.clicks[5], TL.clicks[5] + 0.2));
  c.save(); c.translate(935, 562); c.scale(k, k); c.fillStyle = ca > 0 ? C.acc : '#e3e5ea'; rr(c, -70, -22, 140, 44, 10); c.fill(); if (ca > 0 && ca < 1) { c.globalAlpha = 1 - ca; c.fillStyle = '#e3e5ea'; rr(c, -70, -22, 140, 44, 10); c.fill(); c.globalAlpha = 1; }
  c.font = SANS(18, 700); c.fillStyle = ca > 0.5 ? '#fff' : C.faint; c.textAlign = 'center'; c.fillText('Continue', 0, 6); c.restore();
  c.font = SANS(18, 500); c.fillStyle = C.mute; c.fillText('Cancel', 790, 568);
  // dropdown list
  const [l0, l1] = TL.list, lo = ez.outExpo(span(t, l0, l0 + 0.25)) * (1 - span(t, l1, l1 + 0.15));
  if (lo > 0) {
    c.save(); c.globalAlpha *= lo; c.translate(0, (1 - lo) * -8); softCard(c, 505, 506, 500, 96, 12, { blur: 30, offY: 10 });
    const hov = t > 7.25; if (hov) { c.fillStyle = C.accSoft; rr(c, 511, 512, 488, 40, 8); c.fill(); }
    c.font = SANS(19, hov ? 700 : 500); c.fillStyle = C.ink; c.fillText('Contact form', 527, 538); c.font = SANS(19, 500); c.fillStyle = C.mute; c.fillText('Newsletter signup', 527, 584); c.restore();
  }
  c.restore();
}
function nodeCard(c, x, y, w, h, s, a) { c.save(); c.globalAlpha *= a; c.translate(x + w / 2, y + h / 2); c.scale(s, s); c.translate(-x - w / 2, -y - h / 2); softCard(c, x, y, w, h, 16, { blur: 26, offY: 8, shadow: 'rgba(13,15,40,0.10)' }); c.restore(); }
function editor(c, t) {
  const ea = span(t, TL.editor, TL.editor + 0.3); if (ea <= 0) return; c.save(); c.globalAlpha = ea;
  // dotted canvas
  c.fillStyle = 'rgba(20,22,28,0.08)'; for (let y = 180; y < 660; y += 24) for (let x = 330; x < 1190; x += 24) { c.beginPath(); c.arc(x, y, 1.2, 0, 7); c.fill(); }
  // trigger node
  const ts = ez.back(span(t, TL.trig, TL.trig + 0.4), 1.8);
  if (ts > 0) {
    nodeCard(c, NX - 190, 172, 380, 86, ts, 1); c.save(); c.globalAlpha *= Math.min(1, ts);
    c.fillStyle = C.accSoft; rr(c, NX - 170, 192, 46, 46, 12); c.fill(); c.font = SANS(24, 700); c.fillStyle = C.acc; c.textAlign = 'center'; c.fillText('≡', NX - 147, 223); c.textAlign = 'left';
    c.font = MONO(13); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText('WHEN', NX - 108, 207); c.letterSpacing = '0px';
    c.font = SANS(20, 700); c.fillStyle = C.ink; c.fillText('New form reply', NX - 108, 232); c.font = SANS(16, 500); c.fillStyle = C.mute; c.fillText('Contact form', NX + 50, 232); c.restore();
  }
  // wire and plus
  const wp = span(t, TL.wire[0], TL.wire[1]), joined = span(t, TL.node - 0.05, TL.node + 0.25);
  if (wp > 0) {
    const yEnd = lerp(258, 300, wp) + 55 * joined; c.strokeStyle = '#c9cdd6'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(NX, 258); c.lineTo(NX, yEnd); c.stroke();
    if (t > TL.live + 0.1) { const u = ((t - TL.live) * 0.9) % 1; c.fillStyle = C.green; c.beginPath(); c.arc(NX, lerp(258, 355, u), 5, 0, 7); c.fill(); }
  }
  const ps = ez.back(span(t, TL.plus, TL.plus + 0.3), 2) * (1 - span(t, TL.menu[1], TL.menu[1] + 0.15));
  if (ps > 0) { const k = 1 - 0.1 * Math.sin(Math.PI * span(t, TL.clicks[6], TL.clicks[6] + 0.2)); c.save(); c.translate(NX, 320); c.scale(ps * k, ps * k); c.fillStyle = t > TL.clicks[6] ? C.acc : '#fff'; c.strokeStyle = C.acc; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill(); c.stroke(); c.strokeStyle = t > TL.clicks[6] ? '#fff' : C.acc; c.lineCap = 'round'; c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.moveTo(0, -8); c.lineTo(0, 8); c.stroke(); c.restore(); }
  // action menu
  const mo = ez.outExpo(span(t, TL.menu[0], TL.menu[0] + 0.25)) * (1 - span(t, TL.menu[1], TL.menu[1] + 0.15));
  if (mo > 0) {
    c.save(); c.globalAlpha *= mo; c.translate(-10 * (1 - mo), 0); softCard(c, NX + 36, 296, 300, 140, 14, { blur: 30, offY: 10 });
    c.font = MONO(13); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText('THEN', NX + 54, 322); c.letterSpacing = '0px';
    ['Send a message', 'Add a row to a sheet', 'Create a task'].forEach((n, i) => { const y = 352 + i * 30, hov = i === 1 && t > 10.35; if (hov) { c.fillStyle = C.accSoft; rr(c, NX + 44, y - 20, 284, 28, 7); c.fill(); } c.font = SANS(18, hov ? 700 : 500); c.fillStyle = hov ? C.accDeep : C.ink; c.fillText(n, NX + 56, y); });
    c.restore();
  }
  // action node
  const ns = ez.back(span(t, TL.node, TL.node + 0.4), 1.8);
  if (ns > 0) {
    nodeCard(c, NX - 190, 355, 380, 156, ns, 1); c.save(); c.globalAlpha *= Math.min(1, ns);
    c.fillStyle = C.greenSoft; rr(c, NX - 170, 373, 46, 46, 12); c.fill(); c.strokeStyle = C.green; c.lineWidth = 2.5; rr(c, NX - 159, 384, 24, 24, 3); c.stroke(); c.beginPath(); c.moveTo(NX - 159, 392); c.lineTo(NX - 135, 392); c.moveTo(NX - 147, 384); c.lineTo(NX - 147, 408); c.stroke();
    c.font = MONO(13); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText('THEN', NX - 108, 388); c.letterSpacing = '0px';
    c.font = SANS(20, 700); c.fillStyle = C.ink; c.fillText('Add a row to a sheet', NX - 108, 412);
    const focus = t > TL.clicks[8] && t < TL.chips[2] + 0.3; c.strokeStyle = focus ? C.acc : C.line; c.lineWidth = 2; rr(c, NX - 170, 430, 340, 36, 9); c.stroke();
    const s1 = typed('Leads', t, TL.type[0], TL.type[1]); c.font = SANS(18, 600); c.fillStyle = s1 ? C.ink : C.faint; c.fillText(s1 || 'Sheet name', NX - 156, 454);
    if (focus && t < TL.type[1] + 0.6 && Math.floor(t * 2.4) % 2 === 0) { c.fillStyle = C.acc; c.fillRect(NX - 154 + c.measureText(s1).width, 438, 2, 22); }
    let cx = NX - 170; ['Name', 'Email', 'Message'].forEach((n, i) => { c.font = SANS(15, 700); const w = c.measureText(n).width + 24, s = ez.back(span(t, TL.chips[i], TL.chips[i] + 0.3), 2.4); if (s > 0) { c.save(); c.translate(cx + w / 2, 490); c.scale(s, s); c.fillStyle = C.accSoft; rr(c, -w / 2, -13, w, 26, 13); c.fill(); c.fillStyle = C.accDeep; c.textAlign = 'center'; c.fillText(n, 0, 5); c.restore(); } cx += w + 8; });
    if (t > TL.live + 0.3) { c.globalAlpha *= span(t, TL.live + 0.3, TL.live + 0.6); c.font = MONO(13); c.fillStyle = C.green; c.textAlign = 'right'; c.fillText(t > TL.row ? 'RAN JUST NOW' : 'WAITING', NX + 172, 388); }
    c.restore();
  }
  // live toast
  const [a0, a1] = TL.toast, to = ez.outExpo(span(t, a0, a0 + 0.35)) * (1 - span(t, a1, a1 + 0.25));
  if (to > 0) { c.save(); c.globalAlpha *= to; c.translate(0, (1 - to) * -16); c.fillStyle = C.ink; rr(c, 840, 168, 280, 50, 25); c.fill(); checkMark(c, 868, 193, 13, span(t, a0 + 0.15, a0 + 0.45), C.green); c.font = SANS(18, 700); c.fillStyle = '#fff'; c.fillText('Automation is live', 892, 199); c.restore(); }
  // the sheet it writes to
  const pa = ez.outExpo(span(t, TL.panel, TL.panel + 0.5));
  if (pa > 0) {
    c.save(); c.translate((1 - pa) * 320, 0); c.fillStyle = '#ffffff'; c.shadowColor = 'rgba(13,15,40,0.14)'; c.shadowBlur = 30; c.shadowOffsetX = -8; c.fillRect(905, 151, 295, 519); c.shadowColor = 'transparent';
    c.fillStyle = C.line; c.fillRect(905, 151, 1, 519);
    c.fillStyle = C.greenSoft; rr(c, 925, 172, 34, 34, 9); c.fill(); c.strokeStyle = C.green; c.lineWidth = 2; rr(c, 933, 180, 18, 18, 2); c.stroke(); c.beginPath(); c.moveTo(933, 186); c.lineTo(951, 186); c.moveTo(942, 180); c.lineTo(942, 198); c.stroke();
    c.font = SANS(22, 700); c.fillStyle = C.ink; c.fillText('Leads', 971, 197); c.font = MONO(13); c.fillStyle = C.faint; c.letterSpacing = '2px'; c.fillText('NAME', 925, 246); c.fillText('EMAIL', 1045, 246); c.letterSpacing = '0px'; c.fillStyle = C.line; c.fillRect(925, 258, 255, 1);
    const ins = ez.outExpo(span(t, TL.row, TL.row + 0.45)), rows = [['Maya Chen', 'maya@chen.io', 1], ['Sam Ortiz', 'sam@ortiz.co', 0], ['Priya Nair', 'priya@hey.com', 0]];
    rows.forEach(([n, e, fresh], i) => {
      const y = 296 + (fresh ? 0 : (i - 1 + ins) * 46); if (fresh && ins <= 0) return;
      c.save(); if (fresh) { c.globalAlpha = ins; const hl = 1 - span(t, TL.row + 1.2, TL.row + 2.2); c.fillStyle = `rgba(31,180,110,${0.14 * hl})`; rr(c, 917, y - 28, 271, 42, 8); c.fill(); }
      c.font = SANS(16, fresh ? 700 : 500); c.fillStyle = C.ink; c.fillText(n, 925, y); c.font = SANS(15, 400); c.fillStyle = C.mute; c.fillText(e, 1045, y); c.fillStyle = C.line; c.fillRect(925, y + 18, 255, 1); c.restore();
    });
    c.restore();
  }
  c.restore();
}
function appWindow(c, t) {
  const { x, y, w, h } = WIN;
  c.save(); c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 60; c.shadowOffsetY = 24; c.fillStyle = '#ffffff'; rr(c, x, y, w, h, 14); c.fill(); c.restore();
  c.save(); rr(c, x, y, w, h, 14); c.clip();
  c.fillStyle = C.bar; c.fillRect(x, y, w, 40); [0, 1, 2].forEach((i) => { c.fillStyle = '#d5d8de'; c.beginPath(); c.arc(104 + i * 20, 70, 6, 0, 7); c.fill(); });
  c.font = SANS(16, 500); c.fillStyle = C.mute; c.textAlign = 'center'; c.fillText('Flowdesk', 640, 76); c.textAlign = 'left';
  sidebar(c, t); header(c, t);
  const k0 = TL.clicks[0]; homePage(c, 1 - span(t, k0, k0 + 0.15)); emptyState(c, t, span(t, k0 + 0.1, k0 + 0.35) * (1 - span(t, TL.editor - 0.2, TL.editor)));
  editor(c, t); modal(c, t);
  c.restore();
}
// spotlight: dims everything but a rounded cutout, with a bright edge
function spotlight(c, x, y, w, h, a) {
  if (a <= 0) return; c.save(); c.fillStyle = `rgba(10,12,24,${0.42 * a})`; c.beginPath(); c.rect(-600, -600, W + 1200, HH + 1200); c.roundRect(x, y, w, h, 14); c.fill('evenodd');
  c.strokeStyle = `rgba(255,214,10,${a})`; c.lineWidth = 3; rr(c, x, y, w, h, 14); c.stroke(); c.restore();
}
function cursor(c, t) {
  if (t < CURSOR[0][0]) return; const [x, y] = track(CURSOR, t), a = span(t, CURSOR[0][0], CURSOR[0][0] + 0.3) * (1 - span(t, 17.3, 17.6)); if (a <= 0) return;
  c.save(); c.globalAlpha = a;
  for (const ct of TL.clicks) { const r = span(t, ct, ct + 0.5); if (r > 0 && r < 1) { c.strokeStyle = `rgba(91,91,246,${0.9 * (1 - r)})`; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 8 + 30 * ez.out3(r), 0, 7); c.stroke(); c.fillStyle = `rgba(91,91,246,${0.18 * (1 - r)})`; c.fill(); } }
  cursorArrow(c, x, y, pressed(t) ? 1.12 : 1.3); c.restore();
}

// ---------- screen-space overlays ----------
function titleCard(c, t) {
  const I = TL.intro, out = ez.in3(span(t, I.out[0], I.out[1])); if (out >= 1) return;
  c.save(); c.globalAlpha = 1 - out; c.translate(0, -60 * out);
  c.font = MONO(22, 500); c.fillStyle = 'rgba(255,255,255,0.75)'; c.letterSpacing = '5px'; c.textAlign = 'center'; c.globalAlpha *= span(t, I.tag, I.tag + 0.3); c.fillText('FLOWDESK BASICS', 640, 250); c.restore();
  c.save(); c.globalAlpha = 1 - out; c.translate(0, -60 * out); const F = SANS(96, 700);
  riseLine(c, [['Your', I.w1[0]], ['first', I.w1[1]]], 640, 360, F, '#ffffff', t, { align: 'center' });
  riseLine(c, [['automation', I.w2[0]]], 640, 462, F, '#ffffff', t, { align: 'center' });
  const m = ez.outExpo(span(t, I.meta, I.meta + 0.5)); if (m > 0) { c.globalAlpha *= m; c.font = MONO(22, 500); c.letterSpacing = '4px'; const s = '4 STEPS · ABOUT A MINUTE', w = c.measureText(s).width + 48; c.fillStyle = 'rgba(255,255,255,0.14)'; rr(c, 640 - w / 2, 510, w, 46, 23); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(s, 640 + 2, 541); }
  c.restore();
}
function stepCallout(c, t) {
  const S = TL.steps; let i = -1; S.forEach((s, j) => { if (t >= s) i = j; }); if (i < 0) return;
  const inn = ez.outExpo(span(t, S[i], S[i] + 0.45)), out = ez.in3(span(t, TL.stepsOut, TL.stepsOut + 0.3)), a = (i === 0 ? inn : 1) * (1 - out); if (a <= 0) return;
  const label = STEP_NAMES[i]; c.save(); c.font = SANS(28, 700); const w = c.measureText(label).width + 150;
  c.globalAlpha = a; c.translate(-50 * (1 - (i === 0 ? inn : 1)) - 60 * out, 0);
  c.fillStyle = C.dark; rr(c, 48, 612, w, 64, 32); c.fill();
  const sw = i > 0 ? inn : 1; c.save(); c.translate(80, 644); c.scale(ez.back(sw, 2), ez.back(sw, 2)); c.fillStyle = C.acc; c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill(); c.font = MONO(22, 500); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(String(i + 1), 0, 8); c.restore();
  c.save(); c.beginPath(); c.rect(110, 616, w - 60, 56); c.clip(); c.font = SANS(28, 700); c.fillStyle = '#fff'; c.fillText(label, 116, 654 + (1 - sw) * 40);
  const lw = c.measureText(label).width; c.font = MONO(16, 500); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillText(`${i + 1}/4`, 116 + lw + 16, 652 + (1 - sw) * 40); c.restore();
  c.restore();
}
function notification(c, t) {
  const [n0, n1] = TL.notif, a = ez.outExpo(span(t, n0, n0 + 0.45)) * (1 - ez.in3(span(t, n1, n1 + 0.3))); if (a <= 0) return;
  c.save(); c.translate((1 - a) * 380, 0); c.fillStyle = 'rgba(250,250,252,0.97)'; c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 30; c.shadowOffsetY = 10; rr(c, 880, 22, 370, 82, 18); c.fill(); c.shadowColor = 'transparent';
  c.fillStyle = C.acc; rr(c, 898, 40, 46, 46, 12); c.fill(); c.font = SANS(24, 700); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('≡', 921, 71); c.textAlign = 'left';
  c.font = SANS(18, 700); c.fillStyle = C.ink; c.fillText('Contact form', 958, 58); c.font = SANS(17, 400); c.fillStyle = C.mute; c.fillText('New reply from Maya Chen', 958, 84);
  c.font = MONO(13); c.fillStyle = C.faint; c.textAlign = 'right'; c.fillText('NOW', 1232, 58); c.restore();
}
function outroCard(c, t) {
  const O = TL.outro, a = ez.outExpo(span(t, O.card, O.card + 0.5)); if (a <= 0) return;
  c.save(); c.globalAlpha = a; c.translate(-60 * (1 - a), 0); c.fillStyle = C.dark; rr(c, 48, 548, 520, 128, 24); c.fill();
  checkMark(c, 102, 612, 26, span(t, O.card + 0.15, O.card + 0.5), C.green);
  rise(c, 'Done in 4 steps.', 146, 610, SANS(40, 700), '#fff', O.w1, t);
  rise(c, 'No code needed.', 148, 648, SANS(24, 500), 'rgba(255,255,255,0.62)', O.w2, t);
  c.restore();
}

function explainer(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const [cx, cy, z] = track(CAM, t);
  ctx.save(); ctx.translate(640, 360); ctx.scale(z, z); ctx.translate(-cx, -cy);
  wallpaper(ctx, t);
  const I = TL.intro, wa = ez.outExpo(span(t, I.win[0], I.win[1]));
  if (wa > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, wa * 1.4); ctx.translate(640, 360 + 50 * (1 - wa)); const s = 0.9 + 0.1 * wa; ctx.scale(s, s); ctx.translate(-640, -360); appWindow(ctx, t); ctx.restore(); }
  spotlight(ctx, 618, 428, 274, 68, span(t, 3.9, 4.2) * (1 - span(t, 4.6, 4.9)));
  spotlight(ctx, 1000, 94, 136, 52, span(t, 13.55, 13.8) * (1 - span(t, 14.4, 14.7)));
  cursor(ctx, t);
  ctx.restore();
  titleCard(ctx, t); stepCallout(ctx, t); notification(ctx, t); outroCard(ctx, t);
  const v = ctx.createRadialGradient(640, 360, 420, 640, 360, 860); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.18)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, HH);
}

// =================================== SOUND SCORE ===================================
// Calm and tactile: a warm, slow pad, crisp mouse clicks, soft keyboard, pops when panels open,
// a small two-note chime for each new step, a smooth whoosh on every camera move, a ping for the notification.
function scoreSound(k) {
  { const k0 = k, G = 2.0; k = Object.assign({}, k0, { voice: (t, p) => k0.voice(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), hiss: (t, p) => k0.hiss(t, Object.assign({}, p, { gain: (p.gain == null ? 0.3 : p.gain) * G })), play: (n, t, o = {}) => k0.play(n, t, Object.assign({}, o, { gain: (o.gain == null ? 1 : o.gain) * G })) }); }
  const I = TL.intro;
  const rise1 = (t, g = 1) => { k.voice(t, { f: [[0, 700], [0.05, 1050]], dur: 0.07, gain: 0.06 * g, soft: true }); k.hiss(t, { dur: 0.012, filter: 'highpass', ff: 6000, gain: 0.04 * g, soft: true }); };
  const chime = (t, n1 = 'E6', n2 = 'B6', g = 1, pan = 0) => { k.voice(t, { f: n1, dur: 0.5, gain: 0.07 * g, a: 0.003, verb: 0.3, pan }); k.voice(t + 0.08, { f: n2, dur: 0.7, gain: 0.06 * g, a: 0.003, verb: 0.3, pan }); };
  const camMove = (t, dir = 1, g = 1) => k.hiss(t, { color: 'pink', dur: 0.6, filter: 'bandpass', ff: dir > 0 ? [[0, 400], [0.4, 1500]] : [[0, 1500], [0.5, 400]], q: 0.8, gain: 0.07 * g, a: 0.3, soft: true });
  padBed(k, 0.1, TL.D - 0.2, { bpm: 80, gain: 1, cut: 1200, chords: [['D3', 'F#3', 'A3', 'C#4'], ['B2', 'D3', 'F#3', 'A3'], ['G2', 'B2', 'D3', 'F#3'], ['A2', 'C#3', 'E3', 'G#3']], hats: [2.6, 17.4] });
  // title
  k.play('tick', I.tag, { f: 3800, gain: 0.3, soft: true }); I.w1.concat(I.w2).forEach((t) => rise1(t)); k.play('pop', I.meta, { f: 820, gain: 0.4 });
  k.play('whoosh', I.out[0], { dur: 0.6, gain: 0.45, dir: 1, top: 2200 }); k.play('pop', I.win[0] + 0.2, { f: 520, gain: 0.35 });
  // step callouts
  TL.steps.forEach((t, i) => { chime(t + 0.05, ['E6', 'F#6', 'A6', 'B6'][i], ['B6', 'C#7', 'E7', 'F#7'][i], 0.9, -0.5); k.play('whoosh', t, { dur: 0.35, gain: 0.18, dir: 1, top: 1600, soft: true }); });
  // clicks
  TL.clicks.forEach((t) => k.play('click', t, { gain: 0.9 }));
  // camera moves
  for (let i = 1; i < CAM.length; i++) { const [a, , , za] = CAM[i - 1], [b, , , zb] = CAM[i]; if (Math.abs(zb - za) > 0.05 && b - a < 1) camMove(a, zb > za ? 1 : -1); }
  // modal + dropdown + continue
  k.play('pop', TL.modal[0] + 0.05, { f: 640, gain: 0.5 }); k.play('tick', TL.clicks[2] + 0.12, { f: 3400, gain: 0.35, soft: true });
  k.play('pop', TL.list[0] + 0.03, { f: 900, gain: 0.35 }); k.play('whoosh', TL.modal[1], { dur: 0.3, gain: 0.2, dir: -1, top: 1400, soft: true });
  // editor
  k.play('pop', TL.trig + 0.05, { f: 600, gain: 0.5 }); k.play('tick', TL.wire[0], { f: 2600, gain: 0.25, soft: true }); k.play('pop', TL.plus + 0.04, { f: 1100, gain: 0.35 });
  k.play('pop', TL.menu[0] + 0.03, { f: 860, gain: 0.35 }); k.play('pop', TL.node + 0.05, { f: 700, gain: 0.5 });
  k.play('keys', TL.type[0], { dur: TL.type[1] - TL.type[0], gain: 0.75 });
  TL.chips.forEach((t, i) => k.play('pop', t + 0.03, { f: 1000 + i * 160, gain: 0.32 }));
  // go live
  k.hiss(TL.live + 0.02, { dur: 0.16, filter: 'bandpass', ff: [[0, 1800], [0.15, 4200]], q: 1.5, gain: 0.08 });
  chime(TL.toast[0] + 0.05, 'A5', 'E6', 1.1, 0.3); k.voice(TL.toast[0] + 0.2, { f: 'A6', dur: 0.8, gain: 0.04, a: 0.003, verb: 0.4, pan: 0.3 });
  // result
  k.play('ping', TL.notif[0] + 0.1, { gain: 0.6 }); k.play('whoosh', TL.panel, { dur: 0.5, gain: 0.25, dir: -1, top: 1800, soft: true });
  k.play('pop', TL.row + 0.05, { f: 760, gain: 0.45 }); chime(TL.row + 0.2, 'D6', 'A6', 1, 0.5);
  // outro
  k.play('whoosh', TL.outro.card, { dur: 0.5, gain: 0.3, dir: 1, top: 1800 }); rise1(TL.outro.w1); rise1(TL.outro.w2, 0.7);
  ['D4', 'F#4', 'A4', 'C#5'].forEach((n, i) => k.voice(TL.outro.card + 0.2 + i * 0.07, { f: n, dur: 1.8, gain: 0.045, a: 0.01, verb: 0.4, pan: (i - 1.5) * 0.25 }));
}
