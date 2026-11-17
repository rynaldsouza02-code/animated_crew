// Pop Info (Illustrated) style engine for the ai-video-editor skill.
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
// STYLE: Pop Info  (family: Illustrated Explainer)
// A flat-vector animated infographic: a cosy cartoon scene drawn in code (no images), one small
// character with a big feeling, a speech or thought bubble that carries the idea, one counter,
// one dotted path or arrow, and an iris wipe in and out. Soft muted room, warm product colours,
// a deep teal for the idea and coral and sunny yellow for emphasis. Rounded Fredoka type.
// Everything is drawn in a 680 x 383 design space and scaled up to fill the canvas.
// Demo topic: "Why is the milk always at the back of the store?"
// =====================================================================================================
const W = 1280, HH = 720;
const { clamp, lerp, rng } = CM;
const DW = 680, DH = 383; // design space: every shape below uses these coordinates

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 12,
  iris: { open: 0.75, close: 11.25 },             // iris wipe in and out
  shelves: 0.2,                                    // shelves slide in from both sides
  shopper: { rise: 1.0, land: 1.4, annoyed: 1.85, look: 2.5, lookBack: 6.0, sigh: 9.0, sighOut: 10.6, sweat: 9.3 },
  bubble: { pop: 3.0, carton: 3.3, count: 3.9, countDur: 2.0, away: 6.1, wink: 7.45, winkEnd: 8.1 },
  path: { draw: 6.2, dur: 2.3, pin: 8.5 },         // dotted path to the dairy cooler, then the pin drops
  cam: { push: 6.0, dur: 5.0 },                    // slow push toward the back of the aisle
};

// ---------- tiny helpers ----------
const prog = (t, a, d) => clamp((t - a) / d);
const eOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const eInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eOutBack = (x, s = 2.0) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const popS = (t, a, d = 0.45, s = 2.2) => (t < a ? 0 : eOutBack(clamp((t - a) / d), s)); // springy pop-in scale
function wobble(t, a) { if (t < a) return 0; const x = t - a; return Math.exp(-x * 6) * Math.sin(x * 20) * 0.13; } // decaying jiggle
function blink(t, off, period) { const p = (t + off) % period; return p < 0.13 ? Math.sin(Math.PI * p / 0.13) : 0; }   // eye blinks

const C = {
  wall: '#D7DCCB', ceil: '#E6E2D2', back: '#D2CAB4', floor: '#C4B79D', floorLight: '#CDC2A9', tile: 'rgba(150,135,105,.35)',
  ink: '#3B2A26', teal: '#2F6F73', tealD: '#24585B', coral: '#E85D4A',
  skin: '#F2B48C', skinD: '#E39C77', hood: '#E8A33D', hoodD: '#D18B2B', hoodDD: '#B97420',
  cool: '#7FAEC8', glass: '#B7D9EA', milk: '#FAF8F2', blue: '#5B9BD5'
};
const PALETTE = ['#E07A5F', '#F2CC8F', '#81B29A', '#6C9BB8', '#E9A178', '#3D405B', '#C8553D'];

// shelf products (design coords, left shelf; right is mirrored)
const ROWS = [
  [[15, 72, 34, 62], [60, 82, 30, 56], [100, 92, 28, 50], [140, 100, 26, 46], [180, 111, 24, 40], [220, 119, 22, 36], [258, 127, 20, 32]],
  [[15, 172, 34, 62], [60, 173, 30, 56], [100, 175, 28, 50], [140, 175, 26, 46], [180, 178, 24, 40], [220, 178, 22, 36], [258, 178, 20, 32]],
  [[15, 275, 34, 60], [60, 267, 30, 55], [100, 260, 28, 50], [140, 253, 26, 45], [180, 246, 24, 40], [220, 239, 22, 35], [258, 232, 20, 31]]
];
function buildProducts(seed) {
  const r = rng(seed), out = [];
  for (const row of ROWS) for (const [x, y, w, h] of row) {
    // split each slot into 1-2 items for density
    const n = r() < .45 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const ww = w / n - (n > 1 ? 1.5 : 0), xx = x + k * (w / n);
      const hh = h * (n > 1 ? lerp(.7, .95, r()) : 1);
      out.push({ x: xx, y: y + (h - hh), w: ww, h: hh, c: PALETTE[Math.floor(r() * PALETTE.length)], bottle: r() < .3, label: r() });
    }
  }
  return out;
}
const PL = buildProducts('shelfL'), PR = buildProducts('shelfR');
const DUST = (() => { const r = rng('dust'); return Array.from({ length: 46 }, () => ({ x: r() * 680, y: r() * 383, s: .5 + r() * 1.2, v: 2 + r() * 5, ph: r() * 6.28 })); })();

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawProduct(ctx, p) {
  ctx.fillStyle = p.c;
  if (p.bottle) {
    const nw = p.w * .38, nh = p.h * .22;
    rr(ctx, p.x + (p.w - nw) / 2, p.y, nw, nh + 2, 1.5); ctx.fill();
    rr(ctx, p.x, p.y + nh, p.w, p.h - nh, p.w * .3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; rr(ctx, p.x + p.w * .72, p.y + nh + 2, p.w * .22, p.h - nh - 4, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(p.x + 1, p.y + nh + (p.h - nh) * .38, p.w - 2, (p.h - nh) * .2);
  } else {
    rr(ctx, p.x, p.y, p.w, p.h, 1.8); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(p.x + p.w * .78, p.y, p.w * .22, p.h);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(p.x + 2, p.y + p.h * (.2 + p.label * .2), p.w * .62, p.h * .14);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.arc(p.x + p.w * .38, p.y + p.h * .68, Math.min(p.w, p.h) * .14, 0, 6.29); ctx.fill();
  }
}

function drawShelf(ctx, products, panel, board) {
  ctx.fillStyle = panel;
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(300, 120); ctx.lineTo(300, 250); ctx.lineTo(0, 340); ctx.closePath(); ctx.fill();
  // back shading strip near the vanishing end
  ctx.fillStyle = 'rgba(0,0,0,.05)';
  ctx.beginPath(); ctx.moveTo(240, 102); ctx.lineTo(300, 120); ctx.lineTo(300, 250); ctx.lineTo(240, 268); ctx.closePath(); ctx.fill();
  for (const p of products) drawProduct(ctx, p);
  ctx.fillStyle = board;
  for (const [a, b] of [[132, 163], [235, 206]]) {
    ctx.beginPath(); ctx.moveTo(0, a); ctx.lineTo(300, b); ctx.lineTo(300, b + 5); ctx.lineTo(0, a + 9); ctx.closePath(); ctx.fill();
  }
  // price tags on shelf edges
  ctx.fillStyle = '#FBF8EE';
  for (let i = 0; i < 6; i++) { const x = 20 + i * 46, f = x / 300; ctx.fillRect(x, lerp(134, 165, f) + 1, 10 * (1 - f * .5), 4 * (1 - f * .4)); ctx.fillRect(x, lerp(237, 208, f) + 1, 10 * (1 - f * .5), 4 * (1 - f * .4)); }
  // end-cap upright on the near edge
  ctx.fillStyle = 'rgba(0,0,0,.08)';
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(8, 32); ctx.lineTo(8, 338); ctx.lineTo(0, 340); ctx.closePath(); ctx.fill();
}

function drawRoom(ctx, t) {
  ctx.fillStyle = C.wall; ctx.fillRect(-200, -200, 1080, 800);
  ctx.fillStyle = C.ceil;
  ctx.beginPath(); ctx.moveTo(-200, -200); ctx.lineTo(880, -200); ctx.lineTo(880, -30); ctx.lineTo(500, 120); ctx.lineTo(300, 120); ctx.lineTo(-200, -30); ctx.closePath(); ctx.fill();
  // ceiling light panels receding to the back
  for (const d of [.05, .3, .55, .75, .9]) {
    const y = lerp(-10, 112, d), w = lerp(170, 26, d), h = lerp(9, 2, d);
    ctx.fillStyle = '#FBF8EE'; rr(ctx, 400 - w / 2, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,250,235,.25)'; rr(ctx, 400 - w * .65, y - h * .6, w * 1.3, h * 2.2, h); ctx.fill();
  }
  ctx.fillStyle = C.back; ctx.fillRect(300, 120, 200, 130);
  // floor
  ctx.fillStyle = C.floor;
  ctx.beginPath(); ctx.moveTo(-200, 400); ctx.lineTo(300, 250); ctx.lineTo(500, 250); ctx.lineTo(880, 400); ctx.lineTo(880, 600); ctx.lineTo(-200, 600); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.floorLight;
  ctx.beginPath(); ctx.moveTo(360, 250); ctx.lineTo(440, 250); ctx.lineTo(540, 420); ctx.lineTo(260, 420); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.tile; ctx.lineWidth = .7;
  for (let k = 1; k < 9; k++) { const y = 250 + Math.pow(k / 8, 1.8) * 170; const xl = (340 - y) / .3; ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(680 - xl, y); ctx.stroke(); }
  for (let k = -6; k <= 6; k++) { ctx.beginPath(); ctx.moveTo(400 + k * 16, 250); ctx.lineTo(400 + k * 130, 420); ctx.stroke(); }
  // cooler glow
  const pulse = .85 + .15 * Math.sin(t * 2.3);
  const g = ctx.createRadialGradient(400, 190, 10, 400, 190, 150);
  g.addColorStop(0, `rgba(175,220,242,${.55 * pulse})`); g.addColorStop(1, 'rgba(175,220,242,0)');
  ctx.fillStyle = g; ctx.fillRect(240, 60, 320, 260);
  // cooler
  ctx.fillStyle = '#6E9CB6'; rr(ctx, 316, 130, 168, 116, 4); ctx.fill();
  ctx.fillStyle = C.cool; rr(ctx, 318, 132, 164, 112, 3); ctx.fill();
  for (const x of [326, 377, 428]) {
    ctx.fillStyle = C.glass; rr(ctx, x, 140, 46, 96, 2); ctx.fill();
    for (const y of [158, 198]) for (let i = 0; i < 3; i++) {
      const cx = x + 4 + i * 13; ctx.fillStyle = C.milk; rr(ctx, cx, y, 10, 18, 1); ctx.fill();
      ctx.fillStyle = '#E8E3D6'; ctx.fillRect(cx + 6, y, 4, 18);
      ctx.fillStyle = C.blue; ctx.fillRect(cx, y + 8, 10, 4);
    }
    ctx.fillStyle = '#9CC4DA'; ctx.fillRect(x, 186, 46, 4); ctx.fillRect(x, 226, 46, 4);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.moveTo(x + 30, 140); ctx.lineTo(x + 40, 140); ctx.lineTo(x + 16, 236); ctx.lineTo(x + 6, 236); ctx.closePath(); ctx.fill();
  }
  // hanging dairy sign
  const sw = Math.sin(t * 1.6) * .03;
  ctx.save(); ctx.translate(400, 84); ctx.rotate(sw);
  ctx.strokeStyle = '#8E8670'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(-22, -10); ctx.lineTo(-22, 8); ctx.moveTo(22, -10); ctx.lineTo(22, 8); ctx.stroke();
  ctx.fillStyle = '#C24B39'; rr(ctx, -33, 9, 66, 20, 4); ctx.fill();
  ctx.fillStyle = C.coral; rr(ctx, -33, 7, 66, 20, 4); ctx.fill();
  ctx.fillStyle = '#FFF6EC'; ctx.font = '600 11px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DAIRY', 0, 17.5); ctx.restore();
}

function drawPath(ctx, t) {
  const p = eInOut(prog(t, TL.path.draw, TL.path.dur)); if (p <= 0) return;
  const P0 = [318, 372], P1 = [370, 322], P2 = [430, 300], P3 = [402, 254];
  const pt = u => { const a = 1 - u; return [a * a * a * P0[0] + 3 * a * a * u * P1[0] + 3 * a * u * u * P2[0] + u * u * u * P3[0], a * a * a * P0[1] + 3 * a * a * u * P1[1] + 3 * a * u * u * P2[1] + u * u * u * P3[1]]; };
  const n = 34;
  for (let i = 0; i <= n; i++) {
    const u = i / n; if (u > p) break;
    const [x, y] = pt(u); const r = .9 + (y - 250) / 120 * 2.2;
    const a = clamp((p - u) * 12);
    ctx.fillStyle = `rgba(232,93,74,${.9 * a})`; ctx.beginPath(); ctx.arc(x, y, r * (.6 + .4 * a), 0, 6.29); ctx.fill();
  }
  // destination pin
  const s = popS(t, TL.path.pin, .5);
  if (s > 0) {
    const bob = Math.sin((t - 8.5) * 5) * 1.5;
    ctx.save(); ctx.translate(402, 246 + bob); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.ellipse(0, 8 - bob, 6, 1.8, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = C.coral; ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(-9, -4, -8, -16, 0, -16); ctx.bezierCurveTo(8, -16, 9, -4, 0, 6); ctx.fill();
    ctx.fillStyle = '#FFF6EC'; ctx.beginPath(); ctx.arc(0, -9, 3.2, 0, 6.29); ctx.fill();
    ctx.restore();
  }
}

function drawShopper(ctx, t) {
  const rise = t < TL.shopper.rise ? 1 : 1 - eOutBack(prog(t, TL.shopper.rise, .55), 1.6);
  const w = wobble(t, TL.shopper.land);
  const sigh = eOutCubic(prog(t, TL.shopper.sigh, .5)) * (1 - eOutCubic(prog(t, TL.shopper.sighOut, .6)));
  const breath = Math.sin(t * 2.4) * .008;
  ctx.save();
  ctx.translate(0, rise * 170);
  ctx.translate(200, 383); ctx.scale(1 + w, 1 - w + breath); ctx.translate(-200, -383);
  ctx.translate(0, sigh * 4);
  // body
  ctx.fillStyle = C.hoodDD; ctx.beginPath(); ctx.ellipse(197, 292, 44, 14, 0, 0, 6.29); ctx.fill(); // hood behind neck
  ctx.fillStyle = C.hood; ctx.fill(new Path2D('M108 400 C108 322 140 292 197 286 C252 292 288 322 292 400 Z'));
  ctx.fillStyle = C.hoodD; ctx.fill(new Path2D('M200 286 C252 292 288 322 292 400 L246 400 C249 342 233 306 200 286 Z'));
  ctx.strokeStyle = C.hoodDD; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(150, 372); ctx.quadraticCurveTo(197, 380, 236, 372); ctx.stroke(); // pocket
  ctx.strokeStyle = '#F6E3C0'; ctx.lineWidth = 2.4;
  const sway = Math.sin(t * 2.4) * 1.2;
  ctx.beginPath(); ctx.moveTo(186, 304); ctx.lineTo(184 + sway, 330); ctx.moveTo(208, 304); ctx.lineTo(210 + sway, 330); ctx.stroke();
  ctx.fillStyle = '#F6E3C0'; ctx.beginPath(); ctx.arc(184 + sway, 331, 2, 0, 6.29); ctx.arc(210 + sway, 331, 2, 0, 6.29); ctx.fill();
  // neck
  ctx.fillStyle = C.skinD; ctx.fillRect(183, 262, 30, 30);
  // head (tilts toward the bubble once it appears)
  const look = eInOut(prog(t, TL.shopper.look, .5)) * (1 - .6 * eInOut(prog(t, TL.shopper.lookBack, .6)));
  ctx.save(); ctx.translate(197, 270); ctx.rotate(-look * .05 + sigh * .04); ctx.translate(-197, -270);
  ctx.fillStyle = C.skin; ctx.beginPath(); ctx.ellipse(197, 226, 50, 56, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = C.skinD; ctx.fill(new Path2D('M232 186 C254 206 254 250 228 278 C242 250 244 210 232 186 Z'));
  ctx.fillStyle = '#E7A57E'; ctx.beginPath(); ctx.ellipse(150, 232, 9, 13, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#D48D69'; ctx.beginPath(); ctx.ellipse(151, 233, 4, 7, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = C.ink; ctx.fill(new Path2D('M146 222 C138 172 178 156 206 164 C240 160 257 186 249 210 C237 192 216 190 202 197 C186 190 166 200 160 228 Z'));
  ctx.fillStyle = '#4E3A33'; ctx.fill(new Path2D('M170 178 C185 168 205 167 220 172 C205 172 186 176 176 184 Z'));
  // eyes
  const bl = Math.max(blink(t, .3, 3.7), blink(t, 2.1, 5.3));
  const lid = Math.max(bl, sigh * .55);
  const ex = lerp(1.5, 2.5, look), ey = lerp(0, -2.4, look);
  for (const cx of [208, 236]) {
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(cx + ex, 226 + ey, 5, 5 * (1 - lid * .92), 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; if (lid < .5) { ctx.beginPath(); ctx.arc(cx + ex + 1.6, 224 + ey, 1.3, 0, 6.29); ctx.fill(); }
  }
  // brows: neutral -> annoyed (1.8s) -> tired (9s)
  const ann = eOutBack(prog(t, TL.shopper.annoyed, .3)) * (1 - sigh);
  const lb = [[200, 211 - ann * 3 + sigh * 3], [215, 211 + ann * 3 - sigh * 3]];
  const rb = [[230, 211 + ann * 3 - sigh * 3], [244, 211 - ann * 3 + sigh * 3]];
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const b of [lb, rb]) { ctx.beginPath(); ctx.moveTo(b[0][0] + ex * .4, b[0][1]); ctx.lineTo(b[1][0] + ex * .4, b[1][1]); ctx.stroke(); }
  // mouth
  if (sigh > .25) {
    ctx.fillStyle = '#9E3B3B'; ctx.beginPath(); ctx.ellipse(226, 255, 6 + sigh * 2, 3 + sigh * 4, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#D9686A'; ctx.beginPath(); ctx.ellipse(226, 257 + sigh * 2, 3.5, 1.6 + sigh, 0, 0, 6.29); ctx.fill();
  } else {
    ctx.strokeStyle = '#9E3B3B'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(219, 254 - ann * .5); ctx.quadraticCurveTo(226, 254 - ann * 2.5 + 1.5, 233, 254 + ann * 1.2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240,143,122,.45)'; ctx.beginPath(); ctx.ellipse(243, 244, 7, 4, 0, 0, 6.29); ctx.fill();
  ctx.beginPath(); ctx.ellipse(191, 244, 6, 3.5, 0, 0, 6.29); ctx.fill();
  // sweat drop
  const sd = prog(t, TL.shopper.sweat, 1.3);
  if (sd > 0 && sd < 1) {
    const a = Math.sin(Math.PI * sd), y = lerp(196, 222, eInOut(sd));
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#8CC8E8';
    ctx.beginPath(); ctx.moveTo(252, y - 9); ctx.bezierCurveTo(247, y - 2, 246, y + 4, 252, y + 4); ctx.bezierCurveTo(258, y + 4, 257, y - 2, 252, y - 9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(250.5, y, 1.2, 0, 6.29); ctx.fill(); ctx.restore();
  }
  ctx.restore();
  // arm + basket
  ctx.fillStyle = C.hoodDD; ctx.fill(new Path2D('M262 300 C286 320 293 345 288 370 L264 372 C264 350 257 330 247 315 Z'));
  ctx.strokeStyle = '#24585B'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(248, 360); ctx.bezierCurveTo(252, 330, 300, 330, 304, 360); ctx.stroke();
  ctx.fillStyle = C.skin; ctx.beginPath(); ctx.ellipse(276, 368, 12, 9, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#3E8A8E'; rr(ctx, 238, 358, 76, 40, 5); ctx.fill();
  ctx.fillStyle = C.teal; for (const y of [366, 376, 386]) ctx.fillRect(244, y, 64, 3.5);
  ctx.restore();
}

function drawBubble(ctx, t) {
  const dots = [[262, 170, 6, 2.5], [290, 148, 10, 2.65], [322, 122, 14, 2.8]];
  for (const [x, y, r, a] of dots) { const s = popS(t, a, .35); if (s <= 0) continue; ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(x, y + Math.sin(t * 2 + x) * 1.2, r * s, 0, 6.29); ctx.fill(); }
  const s = popS(t, TL.bubble.pop, .5, 1.8); if (s <= 0) return;
  const bw = wobble(t, TL.bubble.carton) * .5;
  ctx.save(); ctx.translate(432, 72); ctx.scale(s * (1 + bw), s * (1 - bw)); ctx.translate(-432, -72);
  ctx.fillStyle = C.teal; ctx.beginPath(); ctx.ellipse(432, 72, 102, 57, 0, 0, 6.29); ctx.fill();
  ctx.fillStyle = C.tealD; ctx.beginPath(); ctx.ellipse(432, 92, 92, 34, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = C.teal; ctx.beginPath(); ctx.ellipse(432, 86, 96, 30, 0, 0, Math.PI); ctx.fill();
  // little speed streaks
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const [x, y, l] of [[352, 52, 14], [358, 90, 10], [500, 40, 12], [505, 100, 9]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y); ctx.stroke(); }
  // milk carton character
  const cs = popS(t, TL.bubble.carton, .55, 2.6);
  if (cs > 0) {
    const bob = Math.sin(t * 4.2) * 2.2, cw = wobble(t, TL.bubble.carton);
    ctx.save(); ctx.translate(405, 104); ctx.scale(cs * (1 + cw), cs * (1 - cw)); ctx.translate(-405, -104);
    ctx.fillStyle = C.tealD; ctx.beginPath(); ctx.ellipse(405, 105, 26 - bob, 3.5, 0, 0, 6.29); ctx.fill();
    // legs tapping
    const tap = Math.max(0, Math.sin(t * 8.4)) * 3;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(394, 92 + bob); ctx.lineTo(390, 104); ctx.lineTo(386, 104); ctx.moveTo(416, 92 + bob); ctx.lineTo(421, 104 - tap); ctx.lineTo(425, 104 - tap); ctx.stroke();
    ctx.save(); ctx.translate(0, bob);
    ctx.fillStyle = C.milk; rr(ctx, 385, 42, 40, 52, 3); ctx.fill();
    ctx.fillStyle = '#E9E5DA'; rr(ctx, 407, 42, 18, 52, 2); ctx.fill();
    ctx.fillStyle = '#E3DED1'; ctx.beginPath(); ctx.moveTo(385, 43); ctx.lineTo(393, 26); ctx.lineTo(417, 26); ctx.lineTo(425, 43); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#D6D0C1'; ctx.beginPath(); ctx.moveTo(405, 26); ctx.lineTo(417, 26); ctx.lineTo(425, 43); ctx.lineTo(411, 43); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.blue; rr(ctx, 400, 19, 10, 8, 2); ctx.fill();
    ctx.fillStyle = C.blue; ctx.fillRect(385, 72, 40, 10);
    ctx.fillStyle = '#4A86BE'; ctx.fillRect(407, 72, 18, 10);
    // face: wink at 7.5
    const wink = prog(t, TL.bubble.wink, .1) * (1 - prog(t, TL.bubble.winkEnd, .1));
    const cb = blink(t, 1.1, 4.1);
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.ellipse(397, 55, 2.9, 2.9 * (1 - cb * .9), 0, 0, 6.29); ctx.fill();
    if (wink > .5) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(409, 55); ctx.quadraticCurveTo(412, 52, 415, 55); ctx.stroke(); }
    else { ctx.beginPath(); ctx.ellipse(412, 55, 2.9, 2.9 * (1 - cb * .9), 0, 0, 6.29); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(398, 54, .9, 0, 6.29); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(398, 62); ctx.quadraticCurveTo(405, 69, 412, 62); ctx.stroke();
    ctx.fillStyle = 'rgba(240,143,122,.6)'; ctx.beginPath(); ctx.ellipse(392, 63, 3, 1.8, 0, 0, 6.29); ctx.ellipse(418, 63, 3, 1.8, 0, 0, 6.29); ctx.fill();
    // arms: left waves, right on hip
    const wave = Math.sin(t * 9) * .45;
    ctx.strokeStyle = C.milk; ctx.lineWidth = 4;
    ctx.save(); ctx.translate(385, 60); ctx.rotate(-.9 + wave);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-10, -4, -14, -14); ctx.stroke();
    ctx.fillStyle = C.milk; ctx.beginPath(); ctx.arc(-14, -15, 3.2, 0, 6.29); ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(425, 60); ctx.quadraticCurveTo(436, 64, 431, 74); ctx.stroke();
    ctx.restore(); ctx.restore();
  }
  // sparkle on wink
  const sp = prog(t, TL.bubble.wink + 0.05, .7);
  if (sp > 0 && sp < 1) {
    const sc = Math.sin(Math.PI * sp) * 2.2;
    ctx.save(); ctx.translate(432, 34); ctx.rotate(sp * 2); ctx.scale(sc, sc); ctx.fillStyle = '#FFD86B';
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 2 : 7; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.restore();
  }
  // counter
  const cp = prog(t, TL.bubble.count + 0.1, TL.bubble.countDur);
  if (t >= TL.bubble.count) {
    const n = Math.round(500 * eOutCubic(cp)), ts = popS(t, TL.bubble.count, .35);
    ctx.save(); ctx.translate(446, 62); ctx.scale(ts, ts);
    ctx.fillStyle = '#FFFFFF'; ctx.font = '600 21px Fredoka, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(n), 0, 0);
    const nw = ctx.measureText(String(n)).width;
    ctx.font = '600 12px Fredoka, sans-serif'; ctx.fillStyle = '#CDE7E5'; ctx.fillText('steps', nw + 4, 0);
    ctx.restore();
    const as = popS(t, TL.bubble.away, .4);
    if (as > 0) {
      ctx.save(); ctx.translate(446, 82); ctx.scale(as, as);
      ctx.fillStyle = '#FFD86B'; rr(ctx, -2, -12, 42, 17, 8.5); ctx.fill();
      ctx.fillStyle = C.tealD; ctx.font = '600 11px Fredoka, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('away!', 5, 0.5);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawWipe(ctx, t) {
  let r = null;
  if (t < TL.iris.open) r = eInOut(prog(t, 0, TL.iris.open)) * 520;
  else if (t > TL.iris.close) r = (1 - eInOut(prog(t, TL.iris.close, .7))) * 520;
  if (r === null) return;
  ctx.fillStyle = C.teal; ctx.beginPath(); ctx.rect(-10, -10, 700, 410); ctx.moveTo(340 + Math.max(.01, r), 191); ctx.arc(340, 191, Math.max(.01, r), 0, 6.29, true); ctx.fill('evenodd');
  ctx.strokeStyle = '#FFD86B'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(340 + Math.max(.01, r), 191); ctx.arc(340, 191, Math.max(.01, r), 0, 6.29); ctx.stroke();
}

function renderAt(ctx, t, W, H) {
  t = clamp(t, 0, TL.D - 1e-6);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const S = W / DW; ctx.scale(S, S);
  const cam = 1.03 + .15 * eInOut(prog(t, TL.cam.push, TL.cam.dur));
  const dx = Math.sin(t * .5) * 1.2, dy = Math.cos(t * .4) * .8;
  ctx.save();
  ctx.translate(400 + dx, 190 + dy); ctx.scale(cam, cam); ctx.translate(-400, -190);
  drawRoom(ctx, t);
  const slide = 1 - eOutBack(prog(t, TL.shelves, .7), 1.4);
  ctx.save(); ctx.translate(-280 * slide, 0); drawShelf(ctx, PL, '#ECE7DA', '#C9BEA6'); ctx.restore();
  ctx.save(); ctx.translate(680 + 280 * slide, 0); ctx.scale(-1, 1); drawShelf(ctx, PR, '#E6E0D1', '#C2B79F'); ctx.restore();
  drawPath(ctx, t);
  for (const d of DUST) {
    const y = ((d.y - t * d.v) % 383 + 383) % 383, x = d.x + Math.sin(t * .7 + d.ph) * 6;
    ctx.fillStyle = 'rgba(255,253,240,.35)'; ctx.beginPath(); ctx.arc(x, y, d.s, 0, 6.29); ctx.fill();
  }
  ctx.restore();
  // foreground: shopper with gentle parallax
  const fc = 1 + (cam - 1.03) * .3;
  ctx.save(); ctx.translate(200, 383); ctx.scale(fc, fc); ctx.translate(-200, -383);
  drawShopper(ctx, t); ctx.restore();
  ctx.save(); ctx.translate(0, 9); drawBubble(ctx, t); ctx.restore();
  drawWipe(ctx, t);
  ctx.restore();
}

// ---------- compositor ----------
// renderAt scales the 680 x 383 design space to whatever the canvas is (1280x720, or 2x for a crisp render)
function explainer(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  renderAt(ctx, t, ctx.canvas.width, ctx.canvas.height);
}

// =================================== SOUND SCORE ===================================
// Soft, toy-like and sparse: rounded pops, airy whooshes, wooden taps and one breathy sigh.
// No chimes, bells or pings: the cartoon carries the charm, the sound only gives it weight.
function scoreSound(k) {
  const B = TL.bubble, P = TL.path, H = TL.shopper;
  const tap = (t, g = 1, pan = 0, f = 190) => k.voice(t, { f: [[0, f * 1.4], [0.09, f]], dur: 0.14, gain: 0.12 * g, pan, soft: true });
  const bloop = (t, g = 1, f = 330, pan = 0) => k.voice(t, { type: 'sine', f: [[0, f * 0.7], [0.07, f * 1.25], [0.16, f]], dur: 0.2, gain: 0.13 * g, pan });
  k.music(0.6, TL.D - 0.4, { bpm: 96, gain: 0.55, roots: ['F1', 'D1', 'G1', 'C2'], pads: [['F3', 'A3', 'C4'], ['D3', 'F3', 'A3'], ['G3', 'B3', 'D4'], ['C3', 'E3', 'G3']] });
  k.play('whoosh', 0.02, { dur: 0.7, top: 1800, gain: 0.5 });                       // iris opens
  k.play('whoosh', TL.shelves + 0.05, { dur: 0.5, top: 1400, gain: 0.35, pan: -0.5 }); // shelves slide in
  k.play('whoosh', TL.shelves + 0.12, { dur: 0.5, top: 1400, gain: 0.35, pan: 0.5 });
  k.play('whoosh', H.rise, { dur: 0.35, top: 1600, gain: 0.35 }); tap(H.land, 1.2, -0.3, 150); // shopper pops up and lands
  bloop(H.annoyed, 0.7, 220, -0.3);                                        // little huff
  k.play('pop', B.pop, { gain: 0.7, f: 520 }); bloop(B.carton, 1, 392, 0.3);         // bubble, then the carton
  const r = rng('steps');                                                  // counter: soft wooden ticks that thin out as it lands
  for (let x = B.count + 0.12; x < B.count + B.countDur; x += 0.06 + 0.16 * ((x - B.count) / B.countDur) + r() * 0.02) tap(x, 0.45, 0.35, 420);
  tap(B.count + B.countDur + 0.02, 1, 0.35, 300);
  k.play('pop', B.away, { gain: 0.6, f: 640, pan: 0.35 });                           // "away!" tag
  bloop(B.wink, 0.6, 523, 0.3);                                           // wink
  for (let i = 0; i < 9; i++) tap(P.draw + 0.2 + i * (P.dur - 0.3) / 9, 0.3, -0.2 + i * 0.06, 260); // path dots
  k.play('pop', P.pin, { gain: 0.8, f: 420 }); tap(P.pin + 0.08, 0.9, 0.1, 140);     // pin drops
  k.hiss(H.sigh, { color: 'pink', dur: 0.9, filter: 'bandpass', ff: [[0, 900], [0.9, 380]], q: 0.8, gain: 0.07, a: 0.25 }); // sigh
  k.play('whoosh', TL.iris.close, { dur: 0.7, top: 1600, gain: 0.5, dir: -1 });     // iris closes
}
