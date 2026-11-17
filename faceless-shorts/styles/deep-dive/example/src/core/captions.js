// Captions: Bold 3-4 words, Inter Black, white with thick ink outline, active-word yellow highlight.
// Center-lower safe zone: Y=1250px (clear of YouTube Shorts UI).
import { ctx, C, clamp, lerp, seg, eob } from './lib.js';
import { T, lineWords } from './timing.js';

export const CAP = { y: 1250, size: 112, maxW: 940 };
let caps = [];

function autoChunks(words) {
  const chunks = [];
  let i = 0;
  const n = words.length;
  while (i < n) {
    const rem = n - i;
    let size = 4;
    if (rem <= 4) size = rem;
    else if (rem === 5) size = 3;
    else if (rem === 6) size = 3;
    else if (rem === 7) size = 4;
    else if (rem === 8) size = 4;
    else if (rem === 9) size = 3;
    else size = 4;
    chunks.push(words.slice(i, i + size));
    i += size;
  }
  return chunks;
}

export function buildCaptions(script) {
  caps = [];
  script.lines.forEach((ln, i) => {
    const ws = lineWords(i); if (!ws.length) return;
    if (ln.caps) {
      let from = 0;
      const chunks = ln.caps.split('|').map((s) => s.trim()).filter(Boolean);
      chunks.forEach((c) => {
        const cWords = c.toUpperCase().split(/\s+/).filter(Boolean);
        const count = cWords.length;
        const slice = ws.slice(from, from + count);
        from += count;
        if (!slice.length) return;
        caps.push({
          line: i,
          s: slice[0].s - 0.05,
          words: slice.map((w, wi) => ({
            txt: cWords[wi] ? cWords[wi].replace('*', '') : w.w.toUpperCase(),
            s: w.s,
            e: w.e,
          }))
        });
      });
    } else {
      const groups = autoChunks(ws);
      groups.forEach((grp) => {
        if (!grp.length) return;
        caps.push({
          line: i,
          s: grp[0].s - 0.05,
          words: grp.map((w) => ({
            txt: w.w.toUpperCase(),
            s: w.s,
            e: w.e,
          }))
        });
      });
    }
  });
  caps.forEach((c, k) => {
    const next = caps[k + 1], lineEnd = T.lines[c.line] ? T.lines[c.line].end : c.words[c.words.length - 1].e;
    const lastWordEnd = c.words[c.words.length - 1].e;
    c.e = next ? (next.line !== c.line ? Math.min(next.s, Math.max(lastWordEnd + 0.12, lineEnd)) : next.s) : (T.dur || lastWordEnd + 0.20);
  });
  return caps;
}
export const captionList = () => caps;

export function drawCaption(t) {
  const c = caps.find((c) => t >= c.s && t < c.e); if (!c || !c.words.length) return;
  const lt = t - c.s, size = CAP.size;
  ctx.font = `900 ${size}px Inter`; ctx.letterSpacing = '-1px';
  const sp = size * 0.26;
  
  // Find active word
  let activeIdx = c.words.findIndex((w) => t >= w.s && t < w.e);
  if (activeIdx < 0) {
    if (t < c.words[0].s) activeIdx = 0;
    else {
      let last = 0;
      for (let j = 0; j < c.words.length; j++) { if (t >= c.words[j].s) last = j; }
      activeIdx = last;
    }
  }

  c.words.forEach((w) => (w.w = ctx.measureText(w.txt).width));
  const width = (ws) => ws.reduce((a, w) => a + w.w, 0) + sp * (ws.length - 1);
  let lines = [c.words];
  if (width(c.words) > CAP.maxW && c.words.length > 1) {
    let best = null;
    for (let i = 1; i < c.words.length; i++) { const a = c.words.slice(0, i), b = c.words.slice(i), m = Math.max(width(a), width(b)); if (!best || m < best.m) best = { m, l: [a, b] }; }
    lines = best.l;
  }
  const fit = Math.min(1, CAP.maxW / Math.max(...lines.map(width)));
  const sc = (lt < 0.15 ? lerp(0.75, 1, eob(seg(lt, 0, 0.15))) : 1) * fit;
  ctx.save(); ctx.translate(540, CAP.y); ctx.scale(sc, sc);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  const lh = size, y0 = -(lines.length - 1) * lh / 2;
  lines.forEach((ln, li) => {
    let x = -width(ln) / 2; const y = y0 + li * lh;
    for (let wi = 0; wi < ln.length; wi++) {
      const w = ln[wi];
      const isHi = (c.words.indexOf(w) === activeIdx);
      ctx.lineWidth = 22; ctx.strokeStyle = '#0B0B10'; ctx.strokeText(w.txt, x, y + 6); ctx.strokeText(w.txt, x, y);
      ctx.fillStyle = isHi ? '#FFE600' : '#FFFFFF'; ctx.fillText(w.txt, x, y); x += w.w + sp;
    }
  });
  ctx.letterSpacing = '0px'; ctx.restore();
}
