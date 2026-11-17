// Example story.js (Warm Canvas) for a 21.8 s edited clip. Times are seconds in cut.mp4 (transcript_edited.txt).
// Script of the clip: "Hey everyone, welcome back to the channel. Today I'm going to show you how to edit a video with AI
// for free. The first step is cutting out the silent parts. Then we add motion graphics that explain the idea. Most editors
// charge around five hundred dollars for this. And the best part is, it costs nothing."
var TL = {
  cap1: { words: [5.29, 5.61, 5.75, 6.13, 6.45, 6.65, 6.91], out: 7.45 },
  steps: { title: 7.75, cardA: 8.36, waveCut: 9.9, arrow: 11.15, cardB: 11.7, out: 14.55 },
  cost: { title: 14.96, cardA: 15.3, cnt: [16.6, 17.5], cardB: 19.3, zero: 20.7 },
};

// a voice waveform; the quiet gaps shrink away when cut
function waveStrip(c, x, y, w, h, cutP) {
  const r = CM.rng('wave'), bars = 34, gaps = [9, 10, 22, 23, 24];
  let cx = x; const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const gap = gaps.includes(i), k = gap ? 1 - cutP : 1;
    const amp = gap ? 0.08 : 0.25 + r() * 0.7;
    if (k > 0.02) {
      c.fillStyle = gap ? C.red : C.sky; c.globalAlpha = gap ? 0.55 * k : 1;
      rr(c, cx + 2, y + h / 2 - (amp * h) / 2, Math.max(1, bw * k - 4), amp * h, 3); c.fill(); c.globalAlpha = 1;
    }
    cx += bw * k;
  }
}
function stepCard(c, x, y, n, title, sub, draw) {
  const w = 360, h = 330; shadowCard(c, x, y, w, h, 22);
  c.save(); c.fillStyle = C.sky; rr(c, x + 26, y + 26, 52, 52, 14); c.fill(); c.font = SERIF(32, 600); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(String(n), x + 52, y + 63); c.restore();
  c.font = SERIF(32, 600); c.letterSpacing = LS(32); c.fillStyle = C.ink; c.fillText(title, x + 96, y + 62); c.letterSpacing = '0px';
  c.font = SANS(18, 500); c.fillStyle = C.sub; c.fillText(sub, x + 28, y + 118);
  draw(x + 28, y + 150, w - 56, 140);
}

function sceneTalk(c, t) {
  FOOTAGE.full(c, 1.08, 0.5, 0.36);
  const k = TL.cap1.words;
  caption(c, t, [[['Edit', k[0]], ['a', k[1]], ['video', k[2]]], [['with', k[3]], ['AI', k[4], C.sky], ['for', k[5], C.sky], ['free', k[6], C.sky]]], TL.cap1.out);
}

function sceneSteps(c, t) {
  canvasBG(c); pip(c, t);
  const S = TL.steps;
  titleChip(c, [['Two ', C.ink], ['steps', C.sky]], t, S.title, S.out);
  const a = fadeOut(t, S.out);
  if (t > S.cardA) { c.save(); c.globalAlpha = a; enter(c, t, S.cardA);
    stepCard(c, 70, 220, 1, 'Cut the pauses', 'Silent gaps get removed', (x, y, w, h) => {
      c.save(); c.fillStyle = C.head; rr(c, x, y, w, h, 14); c.fill(); c.restore();
      waveStrip(c, x + 14, y + 10, w - 28, h - 20, inout(span(t, S.waveCut, S.waveCut + 0.7)));
    }); c.restore(); }
  c.save(); c.globalAlpha = a; dashArrow(c, 448, 385, 64, span(t, S.arrow, S.arrow + 0.35)); c.restore();
  if (t > S.cardB) { c.save(); c.globalAlpha = a; enter(c, t, S.cardB);
    stepCard(c, 532, 220, 2, 'Add graphics', 'Only where they explain', (x, y, w, h) => {
      c.save(); c.fillStyle = C.head; rr(c, x, y, w, h, 14); c.fill();
      const p = outC(span(t, S.cardB + 0.4, S.cardB + 0.9));
      shadowCard(c, x + 24, y + 22, (w - 48) * p, 40, 10, { blur: 12, offY: 4 });
      c.globalAlpha *= p; tag(c, x + 36, y + 30, 'Title', C.skyTint, C.skyDeep, 15);
      const q = outC(span(t, S.cardB + 0.8, S.cardB + 1.3)); c.globalAlpha = a * q;
      shadowCard(c, x + 24, y + 76, (w - 48) * 0.7, 40, 10, { blur: 12, offY: 4 }); tag(c, x + 36, y + 84, 'Chart', C.purpleTint, C.purple, 15);
      c.restore();
    }); c.restore(); }
}

function sceneCost(c, t) {
  canvasBG(c); pip(c, t);
  const K = TL.cost;
  titleChip(c, [['What it ', C.ink], ['costs', C.sky]], t, K.title, 99);
  const card = (x, t0, label, tagBg, value, valCol, footOk, foot, footT) => {
    if (t < t0) return; c.save(); enter(c, t, t0);
    shadowCard(c, x, 220, 360, 330, 22);
    c.font = SERIF(96, 600); c.letterSpacing = LS(96); c.fillStyle = valCol; c.textAlign = 'center'; c.fillText(value, x + 180, 380); c.letterSpacing = '0px';
    c.font = SANS(22, 600); c.fillStyle = C.sub; c.fillText(label, x + 180, 430); c.textAlign = 'left';
    cardFooter(c, x, 515, 360, footOk, foot, span(t, footT, footT + 0.3)); c.restore();
  };
  const n = Math.round(500 * outC(span(t, K.cnt[0], K.cnt[1])));
  card(70, K.cardA, 'Hiring an editor', C.purpleSoft, '$' + n, C.ink, false, 'Per video', K.cnt[1]);
  card(532, K.cardB, 'This skill', C.sky, '$0', C.skyDeep, true, 'Runs on your computer', K.zero);
}

var SCENES = [sceneTalk, sceneSteps, sceneCost];
var CUTS = [{ t: 7.6 }, { t: 14.85 }];
function storyDraw(c, t) { let i = 0; for (const cu of CUTS) if (t >= cu.t) i++; SCENES[i](c, t); }

function storyScore(k) {
  const tap = (t, g = 1, pan = 0) => { k.voice(t, { f: [[0, 120], [0.12, 60]], dur: 0.2, gain: 0.16 * g, pan, soft: true }); k.hiss(t, { color: 'brown', dur: 0.06, filter: 'lowpass', ff: 650, gain: 0.06 * g, pan, soft: true }); };
  const slide = (t, g = 1, pan = 0) => k.hiss(t, { color: 'pink', dur: 0.32, filter: 'bandpass', ff: [[0, 380], [0.3, 1100]], q: 0.8, gain: 0.08 * g, a: 0.12, pan, soft: true });
  const S = TL.steps, K = TL.cost;
  k.voice(S.title - 0.2, { type: 'triangle', f: 'D3', dur: 14.4, gain: 0.022, a: 1.2, hold: 12, filter: 'lowpass', ff: 700, verb: 0.3, bus: 'music' });
  slide(S.title, 0.7); slide(S.cardA, 0.9, -0.4);
  k.hiss(S.waveCut, { color: 'pink', dur: 0.6, filter: 'bandpass', ff: [[0, 1200], [0.6, 420]], q: 0.9, gain: 0.07, a: 0.1 });
  slide(S.arrow, 0.5); slide(S.cardB, 0.9, 0.4); tap(S.cardB + 0.45, 0.5); tap(S.cardB + 0.85, 0.5);
  slide(K.title, 0.7); slide(K.cardA, 0.9, -0.4);
  const r = CM.rng('cnt'); for (let x = K.cnt[0]; x < K.cnt[1]; x += 0.07 + r() * 0.05) k.hiss(x, { dur: 0.014, filter: 'bandpass', ff: 1500 + r() * 500, q: 1.8, gain: 0.05, soft: true });
  tap(K.cnt[1], 0.8); slide(K.cardB, 0.9, 0.4); tap(K.zero, 0.8, 0.4);
}

var EDIT = { D: 21.8, SPANS: [[5.2, 7.5], [7.6, 21.8]], draw: storyDraw, score: storyScore };
