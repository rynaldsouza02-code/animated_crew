// Warm Canvas (Talking Head) style engine for the ai-video-editor skill.
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
// STYLE: Warm Canvas  (family: Talking-Head Explainer)
// A calm, editorial creator-edit look built around the speaker's own footage (A-roll).
// Two modes and nothing else: full-frame A-roll with a few clean overlays, and a warm off-white canvas
// with a big soft swoosh, where white cards explain the idea while the speaker stays in a picture-in-picture.
// Soft serif headlines (two tones: ink + sky blue), quiet Inter UI text, pastel tinted chips, gentle fades.
// Demo topic: "Can AI really plan my week?"
// =====================================================================================================
const C = {
  bg: '#f7f5f4', swoosh: '#ebe6e2', ink: '#111111', sub: '#2b2826', mute: '#8f8a87', faint: '#c9c1bb', line: '#ece8e1',
  card: '#ffffff', head: '#f2ede9', labelCol: '#f9f6f5', dashOff: '#ddd4ce', pipRing: '#a7cbf3',
  sky: '#4f9cf0', skyDeep: '#2a78d8', skyTint: '#e4f0fd', skyLine: '#9cc5f3',
  purple: '#7a62c9', purpleSoft: '#b9a3ef', purpleTint: '#f0ebfb', purpleLine: '#c3b5e6',
  teal: '#1690b2', tealTint: '#e0f4fb', tealLine: '#8fd0e6',
  green: '#74ca82', greenDeep: '#379645', greenTint: '#e5f5e7', greenLine: '#97cc9e', greenWave: '#86c991',
  yellowTint: '#fdf3d0', yellowLine: '#efd37f', yellowDeep: '#b58a14',
  blue: '#3869f3', red: '#e5484d', redTint: '#fde4e4',
};
const SERIF = (px, w = 560) => `${w} ${px}px "Fraunces", Georgia, serif`;
const SANS = (px, w = 600) => `${w} ${px}px "Inter", system-ui, sans-serif`;
const LS = (px) => (-0.02 * px).toFixed(2) + 'px'; // serif tracking: -2%
const PIP = { x: 986, y: 168, w: 272, h: 384, r: 22 };
const COLX = 492; // centre of the content column when the PiP is on screen
const outC = ez.out3, inout = ez.inout3;
let OVERLAY = false; // overlay export: no A-roll, transparent where footage goes

// ---------- the timeline: picture (and later the sound) read these ----------
var TL = {
  D: 32.6,
  ch1: { title: 0.15, tile: 0.7, dash: 0.95 },
  talk1: { chips: [3.75, 4.25, 4.75], chipsOut: 6.9, cap: [7.55, 7.75, 7.95, 8.35, 8.55, 8.75, 8.95], capOut: 10.25 },
  old: { title: 11.0, cardA: 11.45, footA: 12.05, arrow: 12.6, cardB: 13.0, footB: 13.65, out: 15.7 },
  cmp: { title: 16.2, table: 16.55, rows: [16.85, 17.0, 17.15], cnt: [17.35, 18.6], r2: 19.2, r3: 19.8, out: 21.2 },
  week: { title: 21.7, win: 22.0, clips: 22.35, flag: 23.75, cut: [24.35, 24.85], pills: [25.05, 25.3, 25.55] },
  talk2: { cap: [26.85, 27.05, 27.25, 27.4, 27.75, 27.95, 28.15, 28.35], capOut: 29.3 },
  ch2: { title: 29.95, tile: 30.4, dash: 30.6 },
};
// cuts: vertical pushes in and out of chapter cards, hard cuts everywhere else
var CUTS = [{ t: 3.0, d: 0.45, type: 'vpush' }, { t: 10.6, d: 0, type: 'cut' }, { t: 26.4, d: 0, type: 'cut' }, { t: 29.55, d: 0.45, type: 'vpush' }];
// jump cuts inside the A-roll: [time, zoom, face x (0..1), face y (0..1)]
var PUNCH = [[3.0, 1.0, 0.5, 0.36], [7.2, 1.16, 0.5, 0.34], [26.4, 1.08, 0.46, 0.36]];

// ---------- primitives ----------
function tw(c, s, font, ls = '0px') { c.save(); c.font = font; c.letterSpacing = ls; const w = c.measureText(s).width; c.restore(); return w; }
// a line of mixed-colour serif text: parts = [[text, colour], ...]; returns its width
function toneText(c, parts, x, y, px, o = {}) {
  const font = SERIF(px, o.w || 560), ls = LS(px), ws = parts.map(([s]) => tw(c, s, font, ls)), tot = ws.reduce((a, b) => a + b, 0);
  let cx = o.align === 'left' ? x : x - tot / 2;
  c.save(); c.font = font; c.letterSpacing = ls; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  parts.forEach(([s, col], i) => { c.fillStyle = col; c.fillText(s, cx, y); cx += ws[i]; }); c.restore(); return tot;
}
function shadowCard(c, x, y, w, h, r, o = {}) {
  c.save(); c.shadowColor = o.shadow || 'rgba(96,64,44,0.11)'; c.shadowBlur = o.blur == null ? 34 : o.blur; c.shadowOffsetY = o.offY == null ? 12 : o.offY;
  c.fillStyle = o.fill || C.card; rr(c, x, y, w, h, r); c.fill(); c.restore();
}
function tag(c, x, y, text, bg, fg = '#fff', px = 19) {
  const f = SANS(px, 600), w = tw(c, text, f) + 24, h = px + 16;
  c.save(); c.fillStyle = bg; rr(c, x, y, w, h, 8); c.fill(); c.font = f; c.fillStyle = fg; c.textBaseline = 'middle'; c.fillText(text, x + 13, y + h / 2 + 1); c.restore(); return w;
}
// entrance: fade + small rise. returns eased progress
function enter(c, t, t0, dur = 0.35, dy = 18) { const e = outC(span(t, t0, t0 + dur)); c.globalAlpha *= e; c.translate(0, (1 - e) * dy); return e; }
const fadeOut = (t, t0, d = 0.22) => 1 - span(t, t0, t0 + d);

// ---------- icons (generic, drawn in code) ----------
function iconSpark(c, x, y, s, col) { c.save(); c.translate(x, y); c.fillStyle = col; c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? s * 0.28 : s; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.restore(); }
function iconCheck(c, x, y, r, col = C.greenDeep) { c.save(); c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = r * 0.26; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x - r * 0.42, y + r * 0.02); c.lineTo(x - r * 0.1, y + r * 0.32); c.lineTo(x + r * 0.44, y - r * 0.3); c.stroke(); c.restore(); }
function iconX(c, x, y, r, col = C.red) { c.save(); c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = r * 0.24; c.lineCap = 'round'; const k = r * 0.36; c.beginPath(); c.moveTo(x - k, y - k); c.lineTo(x + k, y + k); c.moveTo(x + k, y - k); c.lineTo(x - k, y + k); c.stroke(); c.restore(); }
function iconMinus(c, x, y, r, col) { c.save(); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); c.lineCap = 'round'; c.beginPath(); c.moveTo(x - r * 0.45, y); c.lineTo(x + r * 0.45, y); c.stroke(); c.restore(); }
function iconOk(c, x, y, r, col) { c.save(); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x - r * 0.42, y); c.lineTo(x - r * 0.1, y + r * 0.32); c.lineTo(x + r * 0.42, y - r * 0.3); c.stroke(); c.restore(); }
function iconBook(c, x, y, s, col) { c.save(); c.strokeStyle = col; c.lineWidth = 2; c.lineJoin = 'round'; rr(c, x - s, y - s * 0.75, s * 2, s * 1.5, 3); c.stroke(); c.beginPath(); c.moveTo(x, y - s * 0.75); c.lineTo(x, y + s * 0.75); c.stroke(); c.restore(); }
function iconNotes(c, x, y, s) { c.save(); c.fillStyle = '#fff4cf'; rr(c, x - s, y - s, s * 2, s * 2, s * 0.3); c.fill(); c.strokeStyle = '#d9b44a'; c.lineWidth = 2.4; c.lineCap = 'round'; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(x - s * 0.55, y - s * 0.4 + i * s * 0.42); c.lineTo(x + s * (i === 2 ? 0.15 : 0.55), y - s * 0.4 + i * s * 0.42); c.stroke(); } c.restore(); }
function iconCal(c, x, y, s) { c.save(); c.fillStyle = '#fff'; c.strokeStyle = '#d9d2cc'; c.lineWidth = 1.5; rr(c, x - s, y - s, s * 2, s * 2, s * 0.32); c.fill(); c.stroke(); c.fillStyle = C.red; c.beginPath(); c.roundRect(x - s, y - s, s * 2, s * 0.62, [s * 0.32, s * 0.32, 0, 0]); c.fill(); c.fillStyle = C.ink; c.font = SERIF(s * 1.05, 600); c.textAlign = 'center'; c.fillText('7', x, y + s * 0.78); c.restore(); }
function avatar(c, x, y, s, tint, col) { c.save(); c.fillStyle = tint; rr(c, x, y, s, s, s * 0.22); c.fill(); c.beginPath(); rr(c, x, y, s, s, s * 0.22); c.clip(); c.fillStyle = col; c.beginPath(); c.arc(x + s / 2, y + s * 0.42, s * 0.19, 0, 7); c.fill(); c.beginPath(); c.ellipse(x + s / 2, y + s * 1.02, s * 0.36, s * 0.32, 0, 0, 7); c.fill(); c.restore(); }

// ---------- surfaces ----------
// the warm canvas: off-white with one big soft swoosh (static, it never moves)
function canvasBG(c) {
  c.fillStyle = C.bg; c.fillRect(0, 0, W, HH);
  c.fillStyle = C.swoosh; c.beginPath(); c.moveTo(372, HH); c.bezierCurveTo(640, 600, 760, 170, 1280, 102); c.lineTo(1280, 418); c.bezierCurveTo(1150, 500, 1040, 640, 948, HH); c.closePath(); c.fill();
}
// A-roll stand-in: a defocused talking-head frame, rendered once. Load real footage with "Load A-roll".
const PH = CM.layer(W, HH);
(function makePlaceholder() {
  const x = PH.getContext('2d'), b = CM.layer(W, HH), bc = b.getContext('2d');
  let g = bc.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#59605d'); g.addColorStop(0.45, '#8d918b'); g.addColorStop(0.7, '#d7d2c9'); g.addColorStop(1, '#e4ded4'); bc.fillStyle = g; bc.fillRect(0, 0, W, HH);
  bc.fillStyle = '#9fb0ab'; bc.fillRect(90, 140, 330, 210); bc.fillStyle = '#b8c6c1'; bc.fillRect(110, 160, 140, 170); bc.fillRect(270, 160, 130, 170);
  bc.fillStyle = 'rgba(255,255,250,0.85)'; [[150, 175], [220, 172], [330, 178], [380, 210]].forEach(([a, d]) => { bc.beginPath(); bc.arc(a, d, 9, 0, 7); bc.fill(); });
  bc.fillStyle = '#efc1b4'; for (let i = 0; i < 28; i++) { const r = CM.rng('note' + i); bc.fillRect(900 + (i % 7) * 34 + r() * 6, 120 + Math.floor(i / 7) * 34 + r() * 6, 26, 26); }
  bc.fillStyle = '#c69a6a'; bc.fillRect(1170, 200, 110, 14); bc.fillStyle = '#5c8a5a'; bc.beginPath(); bc.ellipse(1150, 640, 140, 120, -0.4, 0, 7); bc.fill();
  bc.fillStyle = '#6b6f6c'; bc.fillRect(0, 600, 380, 120);
  x.filter = 'blur(16px)'; x.drawImage(b, 0, 0);
  // a soft, featureless figure: it only marks where the speaker sits in frame
  const f = CM.layer(W, HH), fc = f.getContext('2d');
  fc.fillStyle = '#d3d4d1'; fc.beginPath(); fc.moveTo(420, HH); fc.bezierCurveTo(430, 470, 520, 392, 640, 388); fc.bezierCurveTo(760, 392, 850, 470, 860, HH); fc.closePath(); fc.fill();
  fc.fillStyle = '#9c7660'; fc.fillRect(606, 300, 68, 100);
  fc.fillStyle = '#ad8670'; fc.beginPath(); fc.ellipse(640, 232, 82, 104, 0, 0, 7); fc.fill();
  fc.fillStyle = '#2e2724'; fc.beginPath(); fc.ellipse(640, 160, 90, 62, 0, Math.PI, 0); fc.fill();
  x.filter = 'blur(9px)'; x.drawImage(f, 0, 0);
  x.filter = 'blur(10px)'; x.fillStyle = 'rgba(70,120,70,0.75)'; x.beginPath(); x.ellipse(1190, 600, 120, 70, -0.7, 0, 7); x.fill(); x.filter = 'none';
  x.font = '600 15px "Inter", system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillText('A-ROLL STAND-IN', 24, 700);
})();
let AR = null; // loaded A-roll video { el }
// draw the A-roll into a rect, cover-fit, zoomed around the face point
function arollFeed(c, t, x, y, w, h, z = 1, fx = 0.5, fy = 0.36) {
  if (OVERLAY) return;
  const src = AR ? AR.el : PH, sw = AR ? AR.el.videoWidth : W, sh = AR ? AR.el.videoHeight : HH; if (!sw) return;
  const s = Math.max(w / sw, h / sh) * z, dw = sw * s, dh = sh * s;
  let dx = x + w / 2 - fx * dw, dy = y + h * 0.42 - fy * dh;
  dx = clamp(dx, x + w - dw, x); dy = clamp(dy, y + h - dh, y);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.drawImage(src, dx, dy, dw, dh); c.restore();
}
function punchAt(t) { let p = PUNCH[0]; for (const q of PUNCH) if (t >= q[0]) p = q; return p; }
function fullARoll(c, t) { if (OVERLAY) return; c.fillStyle = '#000'; c.fillRect(0, 0, W, HH); const [, z, fx, fy] = punchAt(t); arollFeed(c, t, 0, 0, W, HH, z, fx, fy); }
// picture-in-picture: portrait crop of the same A-roll, soft lavender ring
function pip(c, t) {
  const { x, y, w, h, r } = PIP;
  c.save(); c.shadowColor = 'rgba(80,90,170,0.18)'; c.shadowBlur = 22; c.shadowOffsetY = 6; c.fillStyle = '#d9dce6'; rr(c, x, y, w, h, r); c.fill(); c.restore();
  if (OVERLAY) { c.save(); c.globalCompositeOperation = 'destination-out'; rr(c, x, y, w, h, r); c.fill(); c.restore(); }
  else { c.save(); rr(c, x, y, w, h, r); c.clip(); arollFeed(c, t, x, y, w, h, 1.0, 0.5, 0.33); c.restore(); }
  c.save(); c.strokeStyle = C.pipRing; c.lineWidth = 2.5; rr(c, x + 1, y + 1, w - 2, h - 2, r - 1); c.stroke(); c.restore();
}

// ---------- components ----------
// title chip: white pill with a two-tone serif line, sits above the content
function titleChip(c, parts, t, t0, out, cx = COLX, y = 112) {
  const a = span(t, t0, t0 + 0.3) * fadeOut(t, out); if (a <= 0) return;
  const px = 38, w = tw(c, parts.map((p) => p[0]).join(''), SERIF(px), LS(px)) + 56, h = 70;
  c.save(); c.globalAlpha *= outC(a); c.translate(0, (1 - outC(span(t, t0, t0 + 0.3))) * -8);
  shadowCard(c, cx - w / 2, y, w, h, 18, { shadow: 'rgba(96,64,44,0.06)', blur: 26, offY: 6 });
  toneText(c, parts, cx, y + 48, px); c.restore();
}
// chapter card: number tile, two-tone title, chapter dashes
function chapterCard(c, t, n, parts, T0, total = 11) {
  canvasBG(c);
  const te = outC(span(t, T0.title, T0.title + 0.55));
  c.save(); c.globalAlpha = te; toneText(c, parts, 640, 425 + (1 - te) * 46, 78); c.restore();
  const p = span(t, T0.tile, T0.tile + 0.32);
  if (p > 0) { const s = 0.7 + 0.3 * ez.back(p, 1.6); c.save(); c.globalAlpha = Math.min(1, p * 1.6); c.translate(640, 254); c.scale(s, s);
    c.shadowColor = 'rgba(79,156,240,0.35)'; c.shadowBlur = 22; c.shadowOffsetY = 8; c.fillStyle = C.sky; rr(c, -58, -58, 116, 116, 26); c.fill(); c.shadowColor = 'transparent';
    c.font = SERIF(66, 600); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(String(n), 0, 24); c.restore(); }
  const dw = 40, gap = 8, x0 = 640 - (total * dw + (total - 1) * gap) / 2, da = te;
  for (let i = 0; i < total; i++) { const x = x0 + i * (dw + gap); c.save(); c.globalAlpha = da; c.fillStyle = C.dashOff; rr(c, x, 489, dw, 6, 3); c.fill();
    if (i === n - 1) { c.fillStyle = C.sky; rr(c, x, 489, dw * outC(span(t, T0.dash, T0.dash + 0.35)), 6, 3); c.fill(); } c.restore(); }
}
// overlay chip on the A-roll (left stack): icon tile, small overline, serif label
function sideChip(c, t, t0, out, y, icon, over, label) {
  const e = outC(span(t, t0, t0 + 0.32)), a = e * fadeOut(t, out, 0.2); if (a <= 0) return;
  const x = 40 - (1 - e) * 36, w = 374, h = 108;
  c.save(); c.globalAlpha = a; shadowCard(c, x, y, w, h, 16, { shadow: 'rgba(0,0,0,0.16)', blur: 24, offY: 6 });
  c.fillStyle = '#fff'; c.strokeStyle = '#ece8e4'; c.lineWidth = 1.5; rr(c, x + 18, y + 22, 64, 64, 15); c.fill(); c.stroke(); icon(c, x + 50, y + 54);
  c.font = SANS(16, 500); c.fillStyle = '#5f5b58'; c.fillText(over, x + 100, y + 44); c.font = SERIF(31, 600); c.letterSpacing = LS(31); c.fillStyle = C.ink; c.fillText(label, x + 98, y + 80); c.restore();
}
// caption words are pre-rendered once (text + soft shadow) so captions stay fast
const SPRITES = new Map();
function wordSprite(s, font, ls, col, px) {
  const key = s + '|' + font + '|' + col; let L = SPRITES.get(key); if (L) return L;
  const w = Math.ceil(tw(ctxProbe, s, font, ls)) + 80, h = Math.ceil(px * 1.5) + 80; L = CM.layer(w, h); const x = L.getContext('2d');
  x.font = font; x.letterSpacing = ls; x.fillStyle = col; x.shadowColor = 'rgba(0,0,0,0.30)'; x.shadowBlur = 18; x.shadowOffsetY = 2; x.fillText(s, 40, 40 + px * 1.1);
  if (document.fonts.status === 'loaded') SPRITES.set(key, L); return L;
}
const ctxProbe = CM.layer(4, 4).getContext('2d');
// caption on the A-roll: centred, white serif, key words in sky blue, each word fades up as it is spoken
function caption(c, t, lines, out) {
  const fa = fadeOut(t, out, 0.16); if (fa <= 0 || t < lines[0][0][1] - 0.01) return;
  const px = 104, font = SERIF(px), ls = LS(px), gap = 114, y0 = 650 - (lines.length - 1) * gap, sp = tw(c, ' ', font, ls);
  lines.forEach((ln, li) => {
    const ws = ln.map(([s]) => tw(c, s, font, ls)), tot = ws.reduce((a, b) => a + b, 0) + sp * (ln.length - 1); let x = 640 - tot / 2;
    ln.forEach(([s, t0, col], i) => {
      const e = outC(span(t, t0, t0 + 0.3));
      if (e > 0) { const sp0 = wordSprite(s, font, ls, col || '#fff', px); c.save(); c.globalAlpha = e * fa; if (e < 1) c.filter = `blur(${((1 - e) * 5).toFixed(2)}px)`;
        c.drawImage(sp0, x - 40, y0 + li * gap + (1 - e) * 12 - px * 1.1 - 40); c.restore(); }
      x += ws[i] + sp;
    });
  });
}
// dashed arrow "- ->" drawn left to right
function dashArrow(c, x, y, len, p) {
  if (p <= 0) return; c.save(); c.strokeStyle = C.ink; c.lineWidth = 4.5; c.lineCap = 'round'; c.lineJoin = 'round'; const end = x + len * outC(p);
  for (let s = x; s < end - 10; s += 22) { c.beginPath(); c.moveTo(s, y); c.lineTo(Math.min(s + 10, end - 10), y); c.stroke(); }
  if (p > 0.5) { const a = outC(span(p, 0.5, 1)); c.globalAlpha = a; c.beginPath(); c.moveTo(end - 18, y - 9); c.lineTo(end - 8, y); c.lineTo(end - 18, y + 9); c.moveTo(end - 22, y); c.lineTo(end - 8, y); c.stroke(); }
  c.restore();
}
// mini week grid used as a "thumbnail" inside cards
function weekThumb(c, x, y, w, h, blur) {
  c.save(); c.beginPath(); rr(c, x, y, w, h, 12); c.clip(); c.fillStyle = '#f4efe9'; c.fillRect(x, y, w, h);
  if (blur) c.filter = 'blur(5px)';
  const cw = (w - 24) / 5; for (let i = 0; i < 5; i++) { c.fillStyle = '#ffffff'; rr(c, x + 12 + i * cw + 2, y + 12, cw - 4, h - 24, 6); c.fill();
    const r = CM.rng('wk' + i); let yy = y + 20; while (yy < y + h - 34) { const bh = 14 + r() * 24; c.fillStyle = r.pick([C.purpleTint, C.skyTint, C.greenTint, C.tealTint, C.yellowTint]); rr(c, x + 12 + i * cw + 6, yy, cw - 12, bh, 4); c.fill(); yy += bh + 6; } }
  c.restore();
}
function personCard(c, x, y, o) {
  const w = 346, h = 436; shadowCard(c, x, y, w, h, 22);
  tag(c, x + 26, y + 26, o.tag, o.tagBg);
  if (o.ai) { c.save(); c.fillStyle = '#fff'; c.strokeStyle = '#efe9e4'; c.lineWidth = 1.5; rr(c, x + 26, y + 86, 76, 76, 18); c.fill(); c.stroke(); iconSpark(c, x + 64, y + 124, 24, C.purple); c.restore(); }
  else avatar(c, x + 26, y + 86, 76, C.skyTint, C.sky);
  c.font = SERIF(32, 600); c.letterSpacing = LS(32); c.fillStyle = C.ink; c.fillText(o.name, x + 122, y + 120); c.letterSpacing = '0px';
  c.font = SANS(19, 500); c.fillStyle = C.sub; c.fillText(o.sub, x + 122, y + 148);
  weekThumb(c, x + 26, y + 190, w - 52, 166, o.ai);
  if (o.ai) { c.save(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x + w / 2, y + 273, 30, 0, 7); c.fill(); c.font = SERIF(40, 700); c.fillStyle = C.purple; c.textAlign = 'center'; c.fillText('?', x + w / 2, y + 287); c.restore(); }
}
function cardFooter(c, x, y, w, ok, text, p) {
  if (p <= 0) return; c.save(); c.globalAlpha *= outC(p); const f = SERIF(25, 600), tw0 = tw(c, text, f, LS(25)) + 36, sx = x + w / 2 - tw0 / 2;
  (ok ? iconCheck : iconX)(c, sx + 12, y - 8, 13); c.font = f; c.letterSpacing = LS(25); c.fillStyle = C.ink; c.fillText(text, sx + 36, y); c.restore();
}
// segmented meter (white segments on a tinted column)
function segBar(c, x, y, w, v, segs = 22) { const g = 2.6, sw = (w - g * (segs - 1)) / segs; for (let i = 0; i < segs; i++) { const f = clamp(v * segs - i); c.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * f})`; rr(c, x + i * (sw + g), y, sw, 11, 3); c.fill(); } }
function rowPill(c, xr, y, text, bg, fg) { const f = SERIF(26), w = tw(c, text, f, LS(26)) + 34; c.save(); c.fillStyle = bg; rr(c, xr - w, y - 21, w, 42, 11); c.fill(); c.font = f; c.letterSpacing = LS(26); c.fillStyle = fg; c.textBaseline = 'middle'; c.fillText(text, xr - w + 17, y + 1); c.restore(); }
const WV = CM.noise1('wv');
// a clip on the week timeline
function clip(c, x, y, w, h, kind, label, o = {}) {
  if (w < 2) return; const K = { deep: [C.purpleTint, C.purpleLine], meet: [C.skyTint, C.skyLine], call: [C.greenTint, C.greenLine], gym: [C.tealTint, C.tealLine], admin: [C.yellowTint, C.yellowLine], bad: [C.redTint, C.red] }[kind];
  c.save(); c.fillStyle = K[0]; rr(c, x, y, w, h, 8); c.fill(); c.strokeStyle = K[1]; c.lineWidth = o.flag ? 2.2 : 1.5; rr(c, x, y, w, h, 8); c.stroke();
  c.beginPath(); rr(c, x, y, w, h, 8); c.clip();
  if (kind === 'meet' || kind === 'bad') { c.strokeStyle = K[1]; c.globalAlpha = 0.45; c.lineWidth = 1; for (let s = x + 40; s < x + w - 4; s += 40) { c.beginPath(); c.moveTo(s, y); c.lineTo(s, y + h); c.stroke(); } c.globalAlpha = 1; }
  if (kind === 'call') { c.strokeStyle = C.greenWave; c.lineWidth = 2; const r = CM.rng('wave' + Math.round(x)); for (let s = x + 7; s < x + w - 6; s += 4.5) { const a = (0.2 + 0.8 * Math.abs(WV(s * 0.07)) * (0.6 + r() * 0.6)) * h * 0.36; c.beginPath(); c.moveTo(s, y + h / 2 - a); c.lineTo(s, y + h / 2 + a); c.stroke(); } }
  if (label) { c.font = SANS(13.5, 600); c.fillStyle = kind === 'bad' ? C.red : kind === 'admin' ? C.yellowDeep : kind === 'gym' ? C.teal : kind === 'deep' ? C.purple : C.skyDeep; c.textBaseline = 'middle';
    if (kind === 'deep') { c.save(); c.fillStyle = '#fff'; rr(c, x + 8, y + 9, 30, h - 18, 4); c.fill(); c.fillStyle = C.purpleLine; c.fillRect(x + 12, y + 14, 22, 3); c.fillRect(x + 12, y + 20, 15, 3); c.restore(); c.fillText(label, x + 46, y + h / 2 + 1); }
    else c.fillText(label, x + (kind === 'admin' ? 0 : 10) + (kind === 'admin' ? (w - c.measureText(label).width) / 2 : 0), y + h / 2 + 1); }
  c.restore();
}

// ---------- scene 0: chapter 1 ----------
function sceneCh1(c, t) { chapterCard(c, t, 1, [['Can AI ', C.ink], ['Really Plan?', C.sky]], TL.ch1); }

// ---------- scene 1: talking head with side chips and a caption ----------
function sceneTalk1(c, t) {
  const T1 = TL.talk1; fullARoll(c, t);
  sideChip(c, t, T1.chips[0], T1.chipsOut, 174, (c, x, y) => iconNotes(c, x, y, 20), 'Old school', 'Paper planner');
  sideChip(c, t, T1.chips[1], T1.chipsOut, 298, (c, x, y) => iconCal(c, x, y, 20), 'Built in', 'Calendar app');
  sideChip(c, t, T1.chips[2], T1.chipsOut, 422, (c, x, y) => iconSpark(c, x, y, 21, C.sky), 'New', 'AI assistant');
  const k = T1.cap;
  caption(c, t, [[['This', k[0]], ['one', k[1]], ['can', k[2]]], [['now', k[3]], ['plan', k[4], C.sky], ['your', k[5], C.sky], ['week', k[6], C.sky]]], T1.capOut);
}

// ---------- scene 2: the board (canvas + PiP), three beats ----------
function sceneBoard(c, t) {
  canvasBG(c); pip(c, t);
  const O = TL.old, M = TL.cmp, K = TL.week;
  // beat 1: two cards and a dashed arrow
  titleChip(c, [['The ', C.ink], ['old', C.sky], [' way', C.ink]], t, O.title, O.out);
  if (t < O.out + 0.3) {
    const a = fadeOut(t, O.out);
    if (t > O.cardA) { c.save(); c.globalAlpha = a; enter(c, t, O.cardA); personCard(c, 96, 210, { tag: 'Done by hand', tagBg: C.sky, name: 'Me, on paper', sub: 'Every Sunday, 2 hours' }); cardFooter(c, 96, 210 + 412, 346, true, 'It works', span(t, O.footA, O.footA + 0.3)); c.restore(); }
    c.save(); c.globalAlpha = a; dashArrow(c, 466, 418, 64, span(t, O.arrow, O.arrow + 0.35)); c.restore();
    if (t > O.cardB) { c.save(); c.globalAlpha = a; enter(c, t, O.cardB); personCard(c, 554, 210, { tag: 'With AI', tagBg: C.purpleSoft, name: 'With AI', sub: 'Never tried it', ai: true }); cardFooter(c, 554, 210 + 412, 346, false, 'Not sure yet', span(t, O.footB, O.footB + 0.3)); c.restore(); }
  }
  // beat 2: comparison table with counters
  titleChip(c, [['How close can ', C.ink], ['AI', C.sky], [' get?', C.ink]], t, M.title, M.out);
  if (t > M.table && t < M.out + 0.3) {
    c.save(); c.globalAlpha = fadeOut(t, M.out); enter(c, t, M.table, 0.4, 22);
    const x = 92, y = 210, w = 780, h = 398, c1 = 220, cw = 280;
    shadowCard(c, x, y, w, h, 22); c.save(); c.beginPath(); rr(c, x, y, w, h, 22); c.clip();
    c.fillStyle = C.skyTint; c.fillRect(x + c1, y, cw, h); c.fillStyle = C.purpleTint; c.fillRect(x + c1 + cw, y, cw, h);
    c.fillStyle = C.line; [98, 198, 298].forEach((ry) => c.fillRect(x, y + ry, w, 1.5)); c.restore();
    avatar(c, x + c1 + 28, y + 22, 56, '#fff', C.sky); c.font = SERIF(31, 600); c.letterSpacing = LS(31); c.fillStyle = C.ink; c.fillText('By hand', x + c1 + 100, y + 60);
    c.fillStyle = '#fff'; rr(c, x + c1 + cw + 34, y + 22, 56, 56, 14); c.fill(); iconSpark(c, x + c1 + cw + 62, y + 50, 18, C.purple); c.fillStyle = C.ink; c.fillText('With AI', x + c1 + cw + 106, y + 60); c.letterSpacing = '0px';
    const rows = [['How close', C.skyTint, C.skyDeep], ['Time spent', '#ece6fb', C.purple], ['Tools', C.tealTint, C.teal]];
    rows.forEach(([s, bg, fg], i) => { const p = outC(span(t, M.rows[i], M.rows[i] + 0.3)); if (p <= 0) return; c.save(); c.globalAlpha *= p; rowPill(c, x + c1 - 24, y + 148 + i * 100, s, bg, fg); c.restore(); });
    const u = outC(span(t, M.cnt[0], M.cnt[1])), vals = [100, 82];
    vals.forEach((v, j) => { const cx = x + c1 + j * cw + cw / 2, n = Math.round(v * (j === 0 ? Math.min(1, u * 1.15) : u));
      c.save(); c.globalAlpha *= span(t, M.cnt[0] - 0.2, M.cnt[0]); const f = SERIF(66, 600), nw = tw(c, String(n), f, LS(66)), pw = tw(c, '%', SERIF(30, 600));
      c.font = f; c.letterSpacing = LS(66); c.fillStyle = C.ink; c.fillText(String(n), cx - (nw + pw + 4) / 2, y + 168); c.font = SERIF(30, 600); c.letterSpacing = '0px'; c.fillStyle = j ? C.purple : C.skyDeep; c.fillText('%', cx - (nw + pw + 4) / 2 + nw + 4, y + 168);
      segBar(c, x + c1 + j * cw + 22, y + 182, cw - 44, n / 100); c.restore(); });
    [[M.r2, ['2 hours', '4 minutes']], [M.r3, ['Paper + pen', 'Calendar + AI']]].forEach(([t0, vv], i) => { const p = outC(span(t, t0, t0 + 0.3)); if (p <= 0) return;
      vv.forEach((s, j) => { c.save(); c.globalAlpha *= p; c.font = SANS(22, 500); c.fillStyle = C.sub; c.textAlign = 'center'; c.fillText(s, x + c1 + j * cw + cw / 2, y + 256 + i * 100 + (1 - p) * 8); c.restore(); }); });
    c.restore();
  }
  // beat 3: the week as an editing timeline, with a ripple delete
  titleChip(c, [['What does AI ', C.ink], ['actually change?', C.sky]], t, K.title, 99, COLX, 88);
  if (t > K.win) {
    c.save(); enter(c, t, K.win, 0.4, 22);
    const x = 72, y = 182, w = 840, h = 362, lc = 138, th = 58, ty = 248;
    shadowCard(c, x, y, w, h, 20); c.save(); c.beginPath(); rr(c, x, y, w, h, 20); c.clip();
    c.fillStyle = C.head; c.fillRect(x, y, w, 40); c.fillStyle = C.labelCol; c.fillRect(x, y + 40, lc, h); c.fillStyle = C.line; c.fillRect(x + lc, y + 40, 1.5, h);
    ['#ddd5cf', '#ddd5cf', '#ddd5cf'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(x + 20 + i * 16, y + 20, 5, 0, 7); c.fill(); });
    c.fillStyle = '#fff'; rr(c, x + 78, y + 9, 22, 22, 6); c.fill(); iconSpark(c, x + 89, y + 20, 8, C.sky); c.font = SANS(15, 500); c.fillStyle = C.sub; c.fillText('Week planner', x + 108, y + 25);
    c.fillStyle = C.faint; for (let i = 0; i < 11; i++) c.fillRect(x + lc + 12 + i * 67, y + 52, 1.5, 9);
    c.font = SANS(12, 600); c.fillStyle = C.mute; ['MON', 'TUE', 'WED', 'THU', 'FRI'].forEach((d, i) => c.fillText(d, x + lc + 20 + i * 134, y + 60));
    const tracks = [['Deep work', C.purpleSoft, C.purpleTint], ['Meetings', C.sky, C.skyTint], ['Calls', C.green, C.greenTint], ['Gym', '#56b8d6', C.tealTint], ['Admin', '#e8c45a', C.yellowTint]];
    const cutU = inout(span(t, K.cut[0], K.cut[1])), flag = t > K.flag;
    tracks.forEach(([n, dot, tint], i) => { const yy = ty + i * th + th / 2, act = i === 1 && flag && cutU < 1;
      if (act) { c.fillStyle = C.redTint; rr(c, x + 12, yy - 15, lc - 24, 30, 8); c.fill(); }
      c.fillStyle = dot; c.beginPath(); c.arc(x + 26, yy, 4.5, 0, 7); c.fill(); c.font = SANS(16, 600); c.fillStyle = act ? C.red : C.sub; c.fillText(n, x + 38, yy + 6); });
    const X0 = x + lc + 12, cy = (i) => ty + i * th + 9, ch = 40, ap = (k) => outC(span(t, K.clips + k * 0.07, K.clips + k * 0.07 + 0.3));
    const put = (k, fn) => { const p = ap(k); if (p <= 0) return; c.save(); c.globalAlpha *= p; c.translate(0, (1 - p) * 6); fn(); c.restore(); };
    put(0, () => clip(c, X0 + 8, cy(0), 230, ch, 'deep', 'Write script')); put(1, () => clip(c, X0 + 290, cy(0), 200, ch, 'deep', 'Edit video'));
    // meetings row: two "Doomscroll" blocks get flagged, then removed; the rest slides together
    const segs = [[110, 'meet', 'Team sync'], [104, 'bad', 'Doomscroll'], [120, 'meet', 'Client call'], [100, 'bad', 'Doomscroll'], [100, 'meet', 'Review']];
    let mx = X0 + 8; segs.forEach(([sw, kind, lab], k) => { const bad = kind === 'bad', ww = bad ? sw * (1 - cutU) : sw, kk = bad && flag ? 'bad' : bad ? 'meet' : kind, lb = bad && !flag ? 'Scrolling' : lab;
      put(2 + k, () => clip(c, mx, cy(1), Math.max(0, ww - 4), ch, kk, ww > 60 ? lb : '', { flag: bad && flag })); mx += ww; });
    put(7, () => clip(c, X0 + 8, cy(2), 150, ch, 'call', '')); put(8, () => clip(c, X0 + 170, cy(2), 210, ch, 'call', '')); put(9, () => clip(c, X0 + 392, cy(2), 120, ch, 'call', ''));
    put(10, () => clip(c, X0 + 30, cy(3), 90, ch, 'gym', 'Gym')); put(11, () => clip(c, X0 + 300, cy(3), 90, ch, 'gym', 'Gym')); put(12, () => clip(c, X0 + 560, cy(3), 90, ch, 'gym', 'Gym'));
    [60, 240, 420, 600].forEach((ax, i) => put(13 + i, () => clip(c, X0 + ax, cy(4) + 6, 66, 28, 'admin', 'Inbox')));
    // playhead ("now")
    const px = x + 409; c.fillStyle = '#1b1b1b'; c.fillRect(px - 1, y + 48, 2, h - 48); c.beginPath(); c.moveTo(px - 7, y + 44); c.lineTo(px + 7, y + 44); c.lineTo(px, y + 53); c.closePath(); c.fill();
    c.restore(); c.restore();
    // takeaway pills under the window
    const pills = [[iconBook, 'Protect deep work', C.purple], [iconMinus, 'Cut what drains you', C.red], [iconOk, 'Keep what matters', C.greenDeep]];
    const pw = pills.map(([, s]) => tw(c, s, SANS(16, 600)) + 56), tot = pw.reduce((a, b) => a + b, 0) + 14 * 2; let px0 = x + w / 2 - tot / 2;
    pills.forEach(([ic, s, col], i) => { const p = outC(span(t, K.pills[i], K.pills[i] + 0.3)); if (p > 0) { c.save(); c.globalAlpha *= p; c.translate(0, (1 - p) * 10);
      shadowCard(c, px0, 566, pw[i], 40, 12, { shadow: 'rgba(96,64,44,0.08)', blur: 16, offY: 4 }); ic(c, px0 + 22, 586, 8, col); c.font = SANS(16, 600); c.fillStyle = C.sub; c.fillText(s, px0 + 40, 592); c.restore(); } px0 += pw[i] + 14; });
  }
}

// ---------- scene 3: talking head again, one caption ----------
function sceneTalk2(c, t) {
  fullARoll(c, t); const k = TL.talk2.cap;
  caption(c, t, [[['So', k[0]], ['what', k[1]], ['does', k[2]], ['a', k[3]]], [['good', k[4], C.sky], ['week', k[5], C.sky], ['look', k[6]], ['like?', k[7]]]], TL.talk2.capOut);
}
// ---------- scene 4: chapter 2 ----------
function sceneCh2(c, t) { chapterCard(c, t, 2, [['What Makes A ', C.ink], ['Good Week?', C.sky]], TL.ch2); }

var SCENES = [sceneCh1, sceneTalk1, sceneBoard, sceneTalk2, sceneCh2];
// compositor: hard cuts, and a vertical push (old frame slides up and out, new frame follows from below)
function explainer(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.clearRect(0, 0, W, HH); if (!OVERLAY) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, HH); }
  let idx = 0; for (const cu of CUTS) if (t >= cu.t) idx++;
  const cut = CUTS.find((cu) => cu.d > 0 && t >= cu.t && t < cu.t + cu.d);
  if (!cut) { ctx.drawImage(sceneLayer(LA, SCENES[idx], t), 0, 0); return; }
  const e = inout((t - cut.t) / cut.d), A = sceneLayer(LA, SCENES[idx - 1], t), B = sceneLayer(LB, SCENES[idx], t);
  ctx.drawImage(A, 0, -e * HH); ctx.drawImage(B, 0, (1 - e) * HH);
}

// =================================== SOUND SCORE ===================================
// Quiet and tactile: soft paper slides for cards and chips, low wooden taps for list items,
// a breathy swell for the vertical pushes, a light keyboard patter and one warm pad under the board.
// Built to sit under a real voice: no chimes, bells or pings, never more than two sounds at once.
function scoreSound(k) {
  const O = TL.old, M = TL.cmp, K = TL.week, T1 = TL.talk1;
  const tap = (t, g = 1, pan = 0) => { k.voice(t, { f: [[0, 120], [0.12, 60]], dur: 0.2, gain: 0.16 * g, pan, soft: true }); k.hiss(t, { color: 'brown', dur: 0.06, filter: 'lowpass', ff: 650, gain: 0.06 * g, pan, soft: true }); };
  const slide = (t, g = 1, pan = 0) => k.hiss(t, { color: 'pink', dur: 0.32, filter: 'bandpass', ff: [[0, 380], [0.3, 1100]], q: 0.8, gain: 0.08 * g, a: 0.12, pan, soft: true });
  const swell = (t, g = 1) => k.hiss(t - 0.05, { color: 'pink', dur: 0.6, filter: 'bandpass', ff: [[0, 300], [0.35, 1300], [0.6, 380]], q: 0.7, gain: 0.13 * g, a: 0.32 });
  // chapter card 1, then the vertical push into the A-roll
  slide(TL.ch1.title, 0.8); tap(TL.ch1.tile, 0.8); slide(TL.ch1.dash, 0.5); swell(CUTS[0].t);
  T1.chips.forEach((t, i) => slide(t, 0.9, -0.5 + i * 0.1));
  // the board: one quiet pad from the first title to the last pill
  k.voice(O.title - 0.2, { type: 'triangle', f: 'D3', dur: K.pills[2] - O.title + 1.4, gain: 0.025, a: 1.2, hold: K.pills[2] - O.title - 0.6, filter: 'lowpass', ff: 700, verb: 0.3, bus: 'music' });
  k.voice(O.title - 0.2, { type: 'triangle', f: 'A3', dur: K.pills[2] - O.title + 1.4, gain: 0.018, a: 1.2, hold: K.pills[2] - O.title - 0.6, filter: 'lowpass', ff: 700, verb: 0.3, pan: 0.3, bus: 'music' });
  slide(O.title, 0.7); slide(O.cardA, 0.9, -0.4); tap(O.footA, 0.6, -0.4); slide(O.arrow, 0.5); slide(O.cardB, 0.9, 0.4); tap(O.footB, 0.6, 0.4);
  slide(M.title, 0.7); slide(M.table, 0.9); M.rows.forEach((t, i) => tap(t, 0.5, -0.2 + i * 0.2));
  const r = CM.rng('cnt'); for (let x = M.cnt[0]; x < M.cnt[1]; x += 0.07 + r() * 0.05) k.hiss(x, { dur: 0.014, filter: 'bandpass', ff: 1500 + r() * 500, q: 1.8, gain: 0.05, soft: true });
  tap(M.cnt[1], 0.8); tap(M.r2, 0.6); tap(M.r3, 0.6);
  slide(K.title, 0.7); slide(K.win, 0.9); slide(K.clips, 0.5); tap(K.flag, 0.8, -0.2);
  k.hiss(K.cut[0], { color: 'pink', dur: K.cut[1] - K.cut[0], filter: 'bandpass', ff: [[0, 1200], [K.cut[1] - K.cut[0], 420]], q: 0.9, gain: 0.07, a: 0.1 });
  K.pills.forEach((t, i) => tap(t, 0.55, -0.3 + i * 0.3));
  // chapter card 2
  swell(CUTS[3].t); slide(TL.ch2.title, 0.8); tap(TL.ch2.tile, 0.8); slide(TL.ch2.dash, 0.5);
}
