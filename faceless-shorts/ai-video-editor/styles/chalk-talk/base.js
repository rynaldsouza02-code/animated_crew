// Chalk Talk (Hand-Drawn) style engine for the ai-video-editor skill.
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
// STYLE: Chalkboard
// Dusty chalk on a long green slate. Every stroke and letter is chalked on in sequence by a visible stick,
// the grain of the board breaks the strokes, dust falls from the tip, the camera tracks along the board,
// numbers are re-chalked as they count, and a felt eraser wipes a section clean for the next idea.
// Demo topic: "Get 1% better every day".
// =====================================================================================================
const W = 1280, HH = 720;
const { clamp, lerp, span, rng, noise1, ez } = CM;
const BW = 2700; // board width in world units (the board is one long slate, 720 tall)
const C = { slate: '#24392f', chalk: '#f2efe6', yellow: '#f4d35e', pink: '#f39bbb', blue: '#93cbef', dim: 'rgba(242,239,230,0.55)' };
const F = { head: '"Cabin Sketch", "Comic Sans MS", cursive', hand: '"Kalam", "Segoe Print", cursive' };
const head = (px) => `700 ${px}px ${F.head}`, hand = (px, w = 700) => `${w} ${px}px ${F.hand}`;

// ---------- the timeline: picture and sound both read these ----------
var TL = {
  D: 20.8,
  title1: [0.25, 1.25], title2: [1.3, 1.9], under: [1.95, 2.25],
  eq1: [2.5, 3.3], lab1: [3.35, 3.8],
  eq2: [3.95, 4.65], cnt: [4.75, 6.15], ring1: [6.25, 6.65], lab2: [6.7, 7.1],
  eq3: [7.2, 7.95], lab3: [7.95, 8.3],
  arrow: [8.35, 8.9],
  yAxis: [9.5, 9.75], xAxis: [9.75, 10.0], axLab: [10.0, 10.35],
  flat: [10.4, 11.0], flatLab: [11.0, 11.4],
  curve: [11.5, 13.1], curveLab: [13.15, 13.5], ring2: [13.55, 13.9],
  bracket: [14.0, 14.35], gapLab: [14.4, 14.75],
  wipe: [15.2, 16.2],
  take1: [16.4, 17.3], take2: [17.35, 18.1], take3: [18.2, 18.6], note: [18.75, 19.3],
};
// camera keys: [t, centerX, centerY, zoom]
const CAM = [[0, 640, 360, 1], [3.8, 640, 360, 1], [4.7, 560, 430, 1.12], [6.9, 560, 430, 1.12], [7.6, 640, 380, 1], [8.4, 640, 370, 1], [9.4, 1950, 370, 1], [15.0, 1950, 370, 1], [20.8, 1950, 360, 1.05]];
function camAt(t) {
  if (t <= CAM[0][0]) return CAM[0].slice(1);
  for (let i = 0; i < CAM.length - 1; i++) { const a = CAM[i], b = CAM[i + 1]; if (t <= b[0]) { const e = ez.inout3((t - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], e), lerp(a[2], b[2], e), Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), e))]; } }
  return CAM[CAM.length - 1].slice(1);
}
const applyCam = (c, k) => { c.translate(640, 360); c.scale(k[2], k[2]); c.translate(-k[0], -k[1]); };
const toScreen = (k, x, y) => [(x - k[0]) * k[2] + 640, (y - k[1]) * k[2] + 360];

// shared value curve (picture and sound): 1.01^(365u), re-chalked 10 times a second
const cntStep = (t) => Math.floor(Math.max(0, t - TL.cnt[0]) * 10);
const cntVal = (t) => { const u = ez.out3(span(Math.min(t, TL.cnt[0] + cntStep(t) / 10), TL.cnt[0], TL.cnt[1])); return Math.pow(1.01, 365 * u); };
const cntText = (t) => (t >= TL.cnt[1] ? '37.8' : cntVal(t).toFixed(1));

// ---------- 2D value noise (for the slate) ----------
function noise2(seed) {
  const r = rng(seed), N = 256, g = new Float32Array(N * N); for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  const at = (x, y) => g[((y & 255) << 8) | (x & 255)];
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v); };
}

// ---------- the board: baked once ----------
let BOARD = null;
function board() {
  if (BOARD) return BOARD;
  const L = CM.layer(BW, HH), c = L.getContext('2d'), img = c.createImageData(BW, HH), d = img.data, n1 = noise2(5), n2 = noise2(9), r = rng('slate');
  for (let y = 0; y < HH; y++) for (let x = 0; x < BW; x++) {
    const v = 1 + 0.07 * n1(x / 140, y / 140) + 0.04 * n2(x / 22, y / 22) + (r() - 0.5) * 0.07 - 0.08 * (y / HH);
    const i = (y * BW + x) * 4; d[i] = 36 * v; d[i + 1] = 58 * v; d[i + 2] = 47 * v; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // ghosts of earlier lessons, then smeared by old eraser passes
  c.save(); c.globalAlpha = 0.07; c.fillStyle = C.chalk;
  [['x² − 4x + 4 = 0', 930, 90, 34], ['a² + b² = c²', 120, 690, 30], ['f(x) = 2x + 1', 1540, 110, 32], ['∑ n = n(n+1)/2', 2280, 680, 30], ['HW: p. 214', 860, 655, 30], ['y = mx + b', 2350, 120, 34]]
    .forEach(([s, x, y, px]) => { c.font = hand(px, 400); c.fillText(s, x, y); });
  c.restore();
  const rs = rng('smear'); c.save(); c.lineCap = 'round'; c.filter = 'blur(9px)';
  for (let i = 0; i < 70; i++) { const x = rs.in(-100, BW), y = rs.in(40, 700), len = rs.in(160, 460); c.strokeStyle = `rgba(215,228,218,${rs.in(0.018, 0.045)})`; c.lineWidth = rs.in(36, 90); c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + len / 2, y + rs.in(-30, 30), x + len, y + rs.in(-20, 20)); c.stroke(); }
  c.restore();
  BOARD = L; return L;
}
// board tooth: specks that chalk skips over (punched out of the chalk layer)
let TOOTH = null;
function tooth() {
  if (TOOTH) return TOOTH;
  const L = CM.layer(384, 384), c = L.getContext('2d'), img = c.createImageData(384, 384), r = rng('tooth'), n = noise2(31);
  for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) { const v = 0.5 + 0.5 * n(x / 3.2, y / 3.2), a = v > 0.62 ? (v - 0.62) * 2.4 : 0; const i = (y * 384 + x) * 4; img.data[i + 3] = Math.min(255, 255 * (a + (r() < 0.06 ? 0.55 : 0))); }
  c.putImageData(img, 0, 0); TOOTH = L; return L;
}

// ---------- chalk drawing primitives ----------
const resample = (pts, step = 3) => { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)); for (let j = 1; j <= n; j++) out.push([lerp(x0, x1, j / n), lerp(y0, y1, j / n)]); } return out; };
const quad = (a, q, b, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, v = 1 - u; return [v * v * a[0] + 2 * v * u * q[0] + u * u * b[0], v * v * a[1] + 2 * v * u * q[1] + u * u * b[1]]; });
const ellipse = (cx, cy, rx, ry, a0 = -2.5, turns = 1.12, n = 70) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (i / n) * turns * Math.PI * 2, k = 1 + 0.04 * Math.sin(i * 0.31); return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
let TIP = null; // where the chalk stick is right now (world coords)

// a chalk stroke: wobbly, slightly broken, drawn on to progress p
function chalkLine(c, it, p) {
  if (p <= 0) return;
  const P = it._P || (it._P = (() => { const n = noise1(it.seed), raw = resample(it.pts, 3); let len = 0; return raw.map((q, i) => { if (i) len += Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1]); const o = n(len * 0.02) * 1.4; return [q[0] + o, q[1] - o * 0.6, len]; }); })());
  const m = Math.max(2, Math.ceil(P.length * Math.min(1, p))), gap = noise1(it.seed + 7);
  c.save(); c.strokeStyle = it.col; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [w, a, dx] of [[it.w, 0.92, 0], [it.w * 0.55, 0.45, it.w * 0.35]]) {
    c.lineWidth = w; c.globalAlpha = a; c.beginPath(); let pen = false;
    for (let i = 0; i < m; i++) { const q = P[i], skip = gap(q[2] * 0.09) > 0.8; if (skip) { pen = false; continue; } pen ? c.lineTo(q[0] + dx, q[1] - dx) : c.moveTo(q[0] + dx, q[1] - dx); pen = true; }
    c.stroke();
  }
  c.restore();
  if (p < 1) TIP = [P[m - 1][0], P[m - 1][1]];
}
// chalk lettering: parts are runs of text, each with its own font and vertical shift (for exponents)
function layoutText(c, it) {
  if (it._L) return it._L;
  const chars = []; let x = 0;
  for (const part of it.parts) { c.font = part.font; for (const ch of part.s) { const w = c.measureText(ch).width; chars.push({ ch, x, w, font: part.font, dy: part.dy || 0, col: part.col }); x += w; } }
  const x0 = it.align === 'center' ? it.x - x / 2 : it.align === 'right' ? it.x - x : it.x;
  return (it._L = { chars, x0, w: x });
}
function chalkText(c, it, p) {
  if (p <= 0) return;
  const L = layoutText(c, it), n = L.chars.length, shown = Math.min(n, p * n), r = rng('tx' + it.seed);
  c.save(); c.textBaseline = 'alphabetic';
  L.chars.forEach((g, i) => {
    const jy = r.in(-2, 2), jr = r.in(-0.05, 0.05); if (i >= shown) return; const a = Math.min(1, shown - i);
    c.save(); c.translate(L.x0 + g.x + g.w / 2, it.y + g.dy + jy); c.rotate(jr); c.font = g.font; c.textAlign = 'center';
    c.globalAlpha = 0.95 * a; c.fillStyle = g.col || it.col; c.fillText(g.ch, 0, 0);
    c.globalAlpha = 0.5 * a; c.strokeStyle = g.col || it.col; c.lineWidth = 1.4; c.strokeText(g.ch, 0.6, -0.4);
    c.restore();
  });
  c.restore();
  if (p < 1) { const g = L.chars[Math.min(n - 1, Math.floor(shown))]; TIP = [L.x0 + g.x + g.w * (shown % 1), it.y + g.dy - 18]; }
}

// ---------- the lesson, as timed chalk items ----------
const A = (k, a, extra) => Object.assign({ k, a: a[0], b: a[1], col: C.chalk, seed: (a[0] * 1000) | 0 }, extra);
const sup = (s) => ({ s, font: hand(36), dy: -34 });
const gx = (d) => 1440 + (d / 365) * 960, gy = (v) => 600 - (v / 40) * 400;
const ITEMS = [
  // section A: the hook and the three equations
  A('text', TL.title1, { parts: [{ s: 'Get 1% better', font: head(104) }], x: 110, y: 158 }),
  A('text', TL.title2, { parts: [{ s: 'every day.', font: head(104) }], x: 110, y: 270, col: C.pink }),
  A('line', TL.under, { pts: [[108, 296], [320, 291], [600, 298]], col: C.yellow, w: 7 }),
  A('text', TL.eq1, { parts: [{ s: '1.00', font: hand(64) }, sup('365'), { s: ' = 1', font: hand(64) }], x: 140, y: 380 }),
  A('text', TL.lab1, { parts: [{ s: '← stay the same', font: hand(40, 400) }], x: 640, y: 378, col: C.blue }),
  A('text', TL.eq2, { parts: [{ s: '1.01', font: hand(64) }, sup('365'), { s: ' ≈', font: hand(64) }], x: 140, y: 495 }),
  A('line', TL.ring1, { pts: ellipse(560, 472, 120, 52), col: C.pink, w: 5 }),
  A('text', TL.lab2, { parts: [{ s: '← 1% better', font: hand(40, 400) }], x: 720, y: 493, col: C.blue }),
  A('text', TL.eq3, { parts: [{ s: '0.99', font: hand(64) }, sup('365'), { s: ' ≈ 0.03', font: hand(64) }], x: 140, y: 610 }),
  A('text', TL.lab3, { parts: [{ s: '← 1% worse', font: hand(40, 400) }], x: 720, y: 608, col: C.blue }),
  A('line', TL.arrow, { pts: quad([900, 560], [1120, 420], [1340, 330], 50), w: 5 }),
  A('line', [TL.arrow[1], TL.arrow[1] + 0.12], { pts: [[1306, 318], [1340, 330], [1318, 360]], w: 5 }),
  // section B: the graph (erased later)
  A('line', TL.yAxis, { pts: [[1440, 625], [1440, 170]], w: 5, tag: 'B' }),
  A('line', TL.xAxis, { pts: [[1430, 625], [2470, 625]], w: 5, tag: 'B' }),
  A('text', TL.axLab, { parts: [{ s: 'you', font: hand(40) }], x: 1400, y: 152, tag: 'B' }),
  A('text', TL.axLab, { parts: [{ s: 'days →', font: hand(36, 400) }], x: 2120, y: 672, tag: 'B' }),
  A('text', TL.axLab, { parts: [{ s: '365', font: hand(36, 400) }], x: 2400, y: 672, align: 'center', tag: 'B' }),
  A('line', TL.flat, { pts: [[gx(0), gy(1)], [gx(365), gy(1)]], w: 5, tag: 'B' }),
  A('text', TL.flatLab, { parts: [{ s: '1.00', font: hand(36) }, { s: 'n', font: hand(24), dy: -20 }, { s: '  same', font: hand(36, 400) }], x: 2440, y: 575, align: 'right', tag: 'B' }),
  A('line', TL.curve, { pts: Array.from({ length: 121 }, (_, i) => { const d = (i / 120) * 365; return [gx(d), gy(Math.pow(1.01, d))]; }), col: C.yellow, w: 6, tag: 'B' }),
  A('text', TL.curveLab, { parts: [{ s: '×37.8', font: head(64) }], x: 2190, y: 168, align: 'center', col: C.pink, tag: 'B' }),
  A('line', TL.ring2, { pts: ellipse(gx(365), gy(37.8), 44, 40), col: C.pink, w: 5, tag: 'B' }),
  A('line', TL.bracket, { pts: [[2480, 588], [2496, 578], [2496, 410], [2510, 397], [2496, 384], [2496, 216], [2480, 206]], col: C.yellow, w: 4, tag: 'B' }),
  A('text', TL.gapLab, { parts: [{ s: 'the gap', font: hand(42) }], x: 2435, y: 470, align: 'right', col: C.yellow, tag: 'B' }),
  // section B after the wipe: the takeaway
  A('text', TL.take1, { parts: [{ s: 'Small wins', font: head(112) }], x: 1950, y: 300, align: 'center' }),
  A('text', TL.take2, { parts: [{ s: 'compound.', font: head(132) }], x: 1950, y: 452, align: 'center', col: C.yellow }),
  A('line', TL.take3, { pts: [[1690, 482], [1950, 474], [2215, 484]], col: C.pink, w: 6 }),
  A('line', [TL.take3[0] + 0.12, TL.take3[1] + 0.05], { pts: [[1720, 500], [1960, 494], [2190, 502]], col: C.pink, w: 4 }),
  A('text', TL.note, { parts: [{ s: 'start today, it adds up', font: hand(40, 400) }], x: 1950, y: 566, align: 'center', col: C.blue }),
];
// the counter is re-chalked on its own
function drawCounter(c, t) {
  if (t < TL.cnt[0]) return;
  const s = cntText(t), it = { parts: [{ s, font: head(76) }], x: 482, y: 497, col: C.pink, seed: 9000 + cntStep(t), _L: null };
  chalkText(c, it, Math.min(1, (t - TL.cnt[0] - cntStep(t) / 10) / 0.06 + 0.35));
}

// ---------- eraser wipe over section B ----------
const WIPE = (() => { const pts = [], x0 = 1390, x1 = 2540, y0 = 150, y1 = 690, rows = 6; for (let r = 0; r <= rows; r++) { const y = lerp(y0, y1, r / rows); pts.push(r % 2 ? [x1, y] : [x0, y], r % 2 ? [x0, y + 12] : [x1, y + 12]); } return resample(pts, 14); })();
function wipeMask(c, p) {
  const m = Math.max(2, Math.ceil(WIPE.length * p)); c.save(); c.globalCompositeOperation = 'destination-out'; c.lineCap = 'round'; c.lineJoin = 'round';
  const sweep = (w, a, dy) => { c.lineWidth = w; c.strokeStyle = `rgba(0,0,0,${a})`; c.beginPath(); WIPE.slice(0, m).forEach(([x, y], i) => (i ? c.lineTo(x, y + dy) : c.moveTo(x, y + dy))); c.stroke(); };
  sweep(110, 0.9, 0); sweep(30, 0.9, -38); sweep(30, 0.9, 38); c.restore();
  return WIPE[m - 1];
}

// ---------- props in screen space: frame, tray, chalk stick, eraser, dust ----------
function wood(c, x, y, w, h, light) {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, light ? '#b07a45' : '#8a5a31'); g.addColorStop(0.5, '#9a6738'); g.addColorStop(1, '#5f3b1e');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.strokeStyle = 'rgba(50,25,8,0.28)'; c.lineWidth = 1;
  for (let k = 0; k < 6; k++) { c.beginPath(); for (let s = 0; s <= 80; s++) { const px = x + (s / 80) * w, py = y + 3 + k * (h / 6) + Math.sin(s * 0.37 + k * 2) * 1.2; s ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); }
  c.restore();
}
function chalkStick(c, x, y, col) {
  c.save(); c.translate(x, y); c.rotate(0.62);
  c.save(); c.filter = 'blur(6px)'; c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.roundRect(10, 8, 120, 22, 10); c.fill(); c.restore();
  const g = c.createLinearGradient(0, -11, 0, 11); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, col); g.addColorStop(1, 'rgba(150,150,140,1)');
  c.fillStyle = g; c.beginPath(); c.moveTo(4, -9); c.lineTo(118, -11); c.quadraticCurveTo(126, 0, 118, 11); c.lineTo(4, 9); c.quadraticCurveTo(-4, 0, 4, -9); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(14, -6, 90, 3);
  c.restore();
}
function eraser(c, x, y) {
  c.save(); c.translate(x, y); c.rotate(-0.06);
  c.save(); c.filter = 'blur(8px)'; c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(-74, -18, 160, 66); c.restore();
  wood(c, -80, -34, 160, 40, true); c.fillStyle = '#e9e4d6'; c.fillRect(-80, 6, 160, 18); c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(-80, 20, 160, 4);
  c.restore();
}
function tray(c, t, hideEraser) {
  wood(c, 0, 0, W, 20, true); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 20, W, 5);
  const g = c.createLinearGradient(0, HH - 46, 0, HH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)'); c.fillStyle = g; c.fillRect(0, HH - 80, W, 80);
  wood(c, 0, HH - 34, W, 34, false); c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, HH - 34, W, 3);
  c.fillStyle = 'rgba(240,236,226,0.12)'; for (let i = 0; i < 40; i++) { const r = rng('dust' + i); c.fillRect(r.in(0, W), HH - 33 + r.in(0, 6), r.in(2, 14), 1.5); }
  [[880, '#f2efe6', 70], [960, '#f4d35e', 46], [1010, '#f39bbb', 58]].forEach(([x, col, len]) => { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x + 2, HH - 26, len, 13); c.fillStyle = col; c.beginPath(); c.roundRect(x, HH - 29, len, 12, 5); c.fill(); });
  if (!hideEraser) { c.save(); c.translate(180, HH - 40); c.scale(0.8, 0.8); eraser(c, 0, 0); c.restore(); }
}
// dust that falls from the chalk while it draws (a pure function of t)
function dust(c, t, k) {
  c.save(); c.fillStyle = 'rgba(240,236,226,0.8)';
  for (const it of ITEMS) {
    if (t < it.a || t > it.b + 0.9) continue;
    const r = rng('du' + it.seed);
    for (let ts = it.a; ts < Math.min(t, it.b); ts += 0.045) {
      const age = t - ts; if (age > 0.9) { r(); r(); continue; }
      const u = (ts - it.a) / (it.b - it.a); let x, y;
      if (it.k === 'line') { const P = it._P; if (!P) continue; const q = P[Math.min(P.length - 1, Math.floor(u * (P.length - 1)))]; x = q[0]; y = q[1]; }
      else { const L = it._L; if (!L) continue; x = L.x0 + L.w * u; y = it.y - 6; }
      const dx = r.in(-8, 8), sz = r.in(0.8, 2.2); const [sx, sy] = toScreen(k, x + dx + age * 6, y + 40 * age + 120 * age * age);
      c.globalAlpha = 0.55 * (1 - age / 0.9); c.fillRect(sx, sy, sz, sz);
    }
  }
  c.restore();
}

// ---------- compositor ----------
const LC = CM.layer(W, HH), LB2 = CM.layer(W, HH), HALO = CM.layer(W / 4, HH / 4);
function explainer(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const k = camAt(t); TIP = null;
  // board
  ctx.save(); applyCam(ctx, k); ctx.drawImage(board(), 0, 0); ctx.restore();
  // chalk on two layers: the graph section (erasable) and everything else
  const a = LC.getContext('2d'), b = LB2.getContext('2d');
  for (const L of [a, b]) { L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.clearRect(0, 0, W, HH); }
  a.save(); applyCam(a, k); b.save(); applyCam(b, k);
  for (const it of ITEMS) { const p = span(t, it.a, it.b), L = it.tag === 'B' ? b : a; if (it.k === 'line') chalkLine(L, it, p); else chalkText(L, it, p); }
  drawCounter(a, t);
  let eraserAt = null;
  if (t > TL.wipe[0]) { const p = ez.inout3(span(t, TL.wipe[0], TL.wipe[1])); const e = wipeMask(b, p); if (p < 1) eraserAt = toScreen(k, e[0], e[1]); TIP = null; }
  a.restore(); b.restore();
  a.drawImage(LB2, 0, 0);
  // the board's tooth breaks the chalk; it sticks to the board as the camera moves
  a.save(); a.globalCompositeOperation = 'destination-out'; a.globalAlpha = 0.85;
  const pat = a.createPattern(tooth(), 'repeat'); pat.setTransform(new DOMMatrix().translateSelf(640 - k[0] * k[2], 360 - k[1] * k[2]).scaleSelf(k[2], k[2])); a.fillStyle = pat; a.fillRect(0, 0, W, HH); a.restore();
  // dusty halo, then the chalk itself
  { const hc = HALO.getContext('2d'); hc.setTransform(1, 0, 0, 1, 0, 0); hc.clearRect(0, 0, W / 4, HH / 4); hc.drawImage(LC, 0, 0, W / 4, HH / 4); ctx.save(); ctx.globalAlpha = 0.35; ctx.imageSmoothingEnabled = true; ctx.drawImage(HALO, 0, 0, W, HH); ctx.restore(); }
  ctx.drawImage(LC, 0, 0);
  // eraser haze left behind on the wiped section
  if (t > TL.wipe[0]) { ctx.save(); applyCam(ctx, k); ctx.globalAlpha = 0.6 * span(t, TL.wipe[0], TL.wipe[1]); ctx.filter = 'blur(10px)'; ctx.strokeStyle = 'rgba(215,228,218,0.06)'; ctx.lineWidth = 90; ctx.lineCap = 'round'; ctx.beginPath(); WIPE.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore(); }
  dust(ctx, t, k);
  // classroom light, frame and tray
  const lg = ctx.createRadialGradient(560, 120, 80, 640, 300, 900); lg.addColorStop(0, 'rgba(255,250,230,0.07)'); lg.addColorStop(1, 'rgba(0,0,0,0.32)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, HH);
  tray(ctx, t, !!eraserAt);
  if (eraserAt) eraser(ctx, eraserAt[0], eraserAt[1]);
  else if (TIP) { const [sx, sy] = toScreen(k, TIP[0], TIP[1]); const active = ITEMS.filter((it) => t > it.a && t < it.b).pop(); chalkStick(ctx, sx, sy, active ? active.col : C.chalk); }
  else if (t > TL.cnt[0] && t < TL.cnt[1]) { const [sx, sy] = toScreen(k, 560, 470); chalkStick(ctx, sx + 30, sy, C.pink); }
  // fine grain over everything
  const fi = Math.floor(t * 12), r = rng('gr' + (fi % 6)); ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay'; const gp = ctx.createPattern(tooth(), 'repeat'); gp.setTransform(new DOMMatrix().translateSelf(-r() * 384, -r() * 384)); ctx.fillStyle = gp; ctx.fillRect(0, 0, W, HH); ctx.restore();
}

// =================================== SOUND SCORE ===================================
// A quiet classroom. Chalk scratches for every word and stroke (one stroke per word, short taps where the stick
// lands), a felt eraser rubbing back and forth, a soft wooden knock at the start, and gentle plucks for the big moments.
function scoreSound(k) {
  const G = 1.9; // overall level for this quiet medium
  const px = (t, x) => { const c = camAt(t); return clamp(((x - c[0]) * c[2]) / 640, -1, 1) * 0.6; };
  const tap = (t, pan = 0, g = 1) => { k.hiss(t, { dur: 0.018, filter: 'bandpass', ff: 2600, q: 2.2, gain: 0.32 * g * G, a: 0.001, pan, soft: true }); k.voice(t, { f: [[0, 1100], [0.015, 600]], dur: 0.02, gain: 0.05 * g * G, pan, soft: true }); };
  // chalk scratch: grainy, uneven bursts in the upper mids
  const scratch = (a, b, pan = 0, g = 1, soft = true) => { const r = CM.rng('ch' + a); tap(a, pan, g * 0.9); for (let x = a; x < b; x += 0.018 + r() * 0.02) { if (r() < 0.12) continue; const d = 0.02 + r() * 0.025; k.hiss(x, { dur: d, filter: 'bandpass', ff: 2400 + r() * 2200, q: 1.3, gain: (0.12 + r() * 0.1) * g * G, a: d * 0.3, pan, soft }); } };
  const write = (s, a, b, pan, g = 1, soft = true) => { const n = s.length, re = /\S+/g; let m; while ((m = re.exec(s))) scratch(a + (b - a) * (m.index / n), a + (b - a) * ((m.index + m[0].length) / n), pan, g, soft); };
  const pluck = (t, note, g = 1, pan = 0) => { const f = k.hz(note); k.voice(t, { f, dur: 0.9, gain: 0.16 * g * G, a: 0.004, verb: 0.3, pan }); k.voice(t, { f: f * 4, dur: 0.08, gain: 0.03 * g, a: 0.001, pan }); k.voice(t, { f: f * 2, type: 'triangle', dur: 0.3, gain: 0.04 * g, a: 0.003, pan }); };

  k.hiss(0, { color: 'brown', dur: TL.D, filter: 'lowpass', ff: 300, gain: 0.07, a: 0.6, hold: TL.D - 1.2, bus: 'amb' }); // room tone
  k.voice(0.05, { f: [[0, 190], [0.06, 120]], dur: 0.09, gain: 0.22 * G }); k.voice(0.15, { f: [[0, 200], [0.06, 125]], dur: 0.09, gain: 0.18 * G }); // knock knock on the board

  write('Get 1% better', TL.title1[0], TL.title1[1], px(0.6, 400), 1, false);
  write('every day.', TL.title2[0], TL.title2[1], px(1.5, 300), 1, false);
  scratch(TL.under[0], TL.under[1], 0, 1.3, false);
  write('1.00365 = 1', TL.eq1[0], TL.eq1[1], px(2.8, 300));
  write('stay the same', TL.lab1[0], TL.lab1[1], px(3.5, 780), 0.7);
  write('1.01365 ≈', TL.eq2[0], TL.eq2[1], px(4.3, 300));
  // counter re-chalked ten times a second; ticks only when the number changes
  { let last = ''; for (let t = TL.cnt[0]; t <= TL.cnt[1] + 0.001; t += 0.1) { const s = cntText(t + 0.001); if (s !== last) { scratch(t, t + 0.05, px(t, 520), 0.8); last = s; } } }
  pluck(TL.cnt[1], 'E5', 1.1, 0); pluck(TL.cnt[1] + 0.09, 'B5', 0.9, 0);
  scratch(TL.ring1[0], TL.ring1[1], px(6.4, 560), 1.2, false);
  write('1% better', TL.lab2[0], TL.lab2[1], px(6.9, 820), 0.7);
  write('0.99365 ≈ 0.03', TL.eq3[0], TL.eq3[1], px(7.5, 300));
  pluck(TL.eq3[1] - 0.1, 'A3', 0.7, -0.2);
  write('1% worse', TL.lab3[0], TL.lab3[1], px(8.1, 820), 0.7);
  scratch(TL.arrow[0], TL.arrow[1] + 0.12, 0.4, 1);
  k.hiss(8.4, { color: 'pink', dur: 1.0, filter: 'lowpass', ff: [[0, 300], [0.5, 900], [1.0, 300]], gain: 0.07, a: 0.45 }); // camera slides along the board

  scratch(TL.yAxis[0], TL.yAxis[1], px(9.6, 1440), 1.1); scratch(TL.xAxis[0], TL.xAxis[1], 0, 1.1);
  write('you', TL.axLab[0], TL.axLab[0] + 0.12, -0.5, 0.6); write('days', TL.axLab[0] + 0.12, TL.axLab[1], 0.3, 0.6);
  scratch(TL.flat[0], TL.flat[1], 0, 0.9); write('1.00 same', TL.flatLab[0], TL.flatLab[1], 0.45, 0.7);
  scratch(TL.curve[0], TL.curve[1], 0, 1.1, false);
  pluck(TL.curve[1], 'G4', 1, 0.4); pluck(TL.curve[1] + 0.1, 'D5', 0.9, 0.4); pluck(TL.curve[1] + 0.2, 'G5', 0.7, 0.4);
  write('×37.8', TL.curveLab[0], TL.curveLab[1], 0.3, 1.1, false);
  scratch(TL.ring2[0], TL.ring2[1], 0.55, 1.2, false);
  scratch(TL.bracket[0], TL.bracket[1], 0.6, 1); write('the gap', TL.gapLab[0], TL.gapLab[1], 0.5, 0.9);
  // felt eraser: back and forth passes, panned with the eraser
  { const rows = 6, d = (TL.wipe[1] - TL.wipe[0]) / (rows + 1); for (let i = 0; i <= rows; i++) { const t0 = TL.wipe[0] + i * d, dir = i % 2 ? 1 : -1; k.hiss(t0, { color: 'pink', dur: d + 0.02, filter: 'bandpass', ff: 700 + (i % 2) * 120, q: 0.7, gain: 0.26 * G, a: d * 0.25, hold: d * 0.4, pan: [-0.5 * dir, 0.5 * dir] }); k.hiss(t0, { color: 'brown', dur: d, filter: 'lowpass', ff: 400, gain: 0.12 * G, a: d * 0.3 }); } }
  write('Small wins', TL.take1[0], TL.take1[1], 0, 1, false);
  write('compound.', TL.take2[0], TL.take2[1], 0, 1.1, false);
  scratch(TL.take3[0], TL.take3[1] + 0.05, 0, 1.2, false);
  pluck(TL.take3[1], 'C5', 1, -0.2); pluck(TL.take3[1] + 0.1, 'E5', 0.9, 0); pluck(TL.take3[1] + 0.2, 'G5', 0.9, 0.2); pluck(TL.take3[1] + 0.32, 'C6', 0.7, 0.1);
  write('start today, it adds up', TL.note[0], TL.note[1], 0, 0.6);
  tap(TL.note[1] + 0.25, 0.3, 1.2); // the chalk goes back in the tray
}
