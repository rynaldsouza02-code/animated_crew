// Captions: Bold 3-4 words at a time with real-time active-word highlight.
// Safe zone: Center-lower (Y=1250, clear of YouTube Shorts bottom UI & buttons).
// Styling: Heavy sans font, thick black ink outline, soft drop shadow.
// Highlight: Current spoken word lights up in electric yellow (#FFE600) with a subtle pop.
// Inactive words: Crisp, bold white (#FFFFFF).
import { ctx, clamp, lerp, seg, eob } from './lib.js';
import { T, lineWords } from './timing.js';

export const CAP = { y: 1250, size: 92, maxW: 940 };
let caps = [];

/** Groups words into 3-4 word chunks for optimal readability & viewer retention */
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
    const ws = lineWords(i);
    if (!ws.length) return;
    
    // If line explicitly specifies manual chunks with '|'
    if (ln.caps) {
      let from = 0;
      const rawChunks = ln.caps.split('|').map((c) => c.trim()).filter(Boolean);
      rawChunks.forEach((cStr) => {
        const cWords = cStr.split(/\s+/).filter(Boolean);
        const count = cWords.length;
        const slice = ws.slice(from, from + count);
        from += count;
        if (!slice.length) return;
        caps.push({
          line: i,
          s: slice[0].s - 0.04,
          words: slice.map((w, wi) => ({
            txt: cWords[wi] ? cWords[wi].replace(/\*/g, '') : w.w,
            s: w.s,
            e: w.e,
          })),
        });
      });
    } else {
      // Automatic 3-4 word chunking
      const groups = autoChunks(ws);
      groups.forEach((grp) => {
        if (!grp.length) return;
        caps.push({
          line: i,
          s: grp[0].s - 0.04,
          words: grp.map((w) => ({
            txt: w.w,
            s: w.s,
            e: w.e,
          })),
        });
      });
    }
  });

  // Calculate chunk end times
  caps.forEach((c, k) => {
    const next = caps[k + 1];
    const lineEnd = T.lines[c.line] ? T.lines[c.line].end : c.words[c.words.length - 1].e;
    const lastWordEnd = c.words[c.words.length - 1].e;
    if (next) {
      if (next.line !== c.line) {
        c.e = Math.min(next.s, Math.max(lastWordEnd + 0.12, lineEnd));
      } else {
        c.e = next.s;
      }
    } else {
      c.e = T.dur || (lastWordEnd + 0.20);
    }
  });

  return caps;
}

export const captionList = () => caps;

/** Draw one caption text at x, y (used by sheet.js or standalone preview) */
export function captionText(text, x = 540, y = CAP.y, sc = 1, activeIdx = 0) {
  const size = CAP.size;
  ctx.save();
  ctx.font = `900 ${size}px Inter, sans-serif`;
  ctx.letterSpacing = '-0.5px';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  
  const words = text.split(/\s+/).filter(Boolean);
  const spaceW = ctx.measureText(' ').width;
  const wordWidths = words.map((w) => ctx.measureText(w).width);
  const totalW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, words.length - 1);
  const fit = Math.min(1, CAP.maxW / (totalW || 1));
  
  ctx.translate(x, y);
  ctx.scale(sc * fit, sc * fit);
  
  let curX = -totalW / 2;
  words.forEach((w, idx) => {
    const wWidth = wordWidths[idx];
    const wCenterX = curX + wWidth / 2;
    const isActive = (idx === activeIdx);
    
    ctx.save();
    ctx.translate(wCenterX, 0);
    ctx.textAlign = 'center';
    
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(w, 4, 10);
    
    // Thick ink outline
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#0B0B10';
    ctx.strokeText(w, 0, 0);
    
    // High-contrast active yellow vs crisp white
    ctx.fillStyle = isActive ? '#FFE600' : '#FFFFFF';
    ctx.fillText(w, 0, 0);
    
    ctx.restore();
    curX += wWidth + spaceW;
  });
  
  ctx.restore();
}

/** Draw active-word animated 3-4 word captions at time t in center-lower safe zone (Y=1250) */
export function drawCaption(t) {
  const c = caps.find((c) => t >= c.s && t < c.e);
  if (!c || !c.words.length) return;
  
  const size = CAP.size;
  ctx.save();
  ctx.font = `900 ${size}px Inter, sans-serif`;
  ctx.letterSpacing = '-0.5px';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  
  const spaceW = ctx.measureText(' ').width;
  const wordWidths = c.words.map((w) => ctx.measureText(w.txt).width);
  const totalW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, c.words.length - 1);
  const fit = Math.min(1, CAP.maxW / (totalW || 1));
  
  // Chunk entrance pop animation (scale in quickly on appearance)
  const lt = t - c.s;
  const chunkPop = lt < 0.12 ? lerp(0.88, 1.0, eob(seg(lt, 0, 0.12))) : 1.0;
  
  // Identify currently spoken active word
  let activeIdx = c.words.findIndex((w) => t >= w.s && t < w.e);
  if (activeIdx < 0) {
    if (t < c.words[0].s) {
      activeIdx = 0;
    } else {
      let lastPast = 0;
      for (let j = 0; j < c.words.length; j++) {
        if (t >= c.words[j].s) lastPast = j;
      }
      activeIdx = lastPast;
    }
  }
  
  ctx.translate(540, CAP.y);
  ctx.scale(fit * chunkPop, fit * chunkPop);
  
  let curX = -totalW / 2;
  c.words.forEach((w, idx) => {
    const wWidth = wordWidths[idx];
    const wCenterX = curX + wWidth / 2;
    const isActive = (idx === activeIdx);
    
    // Active word subtle pop on onset
    const wlt = t - w.s;
    const wordPop = (isActive && wlt >= 0 && wlt < 0.10) ? lerp(1.10, 1.0, eob(seg(wlt, 0, 0.10))) : 1.0;
    
    ctx.save();
    ctx.translate(wCenterX, 0);
    ctx.scale(wordPop, wordPop);
    ctx.textAlign = 'center';
    
    // Deep drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(w.txt, 4, 10);
    
    // Heavy black outline
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#0B0B10';
    ctx.strokeText(w.txt, 0, 0);
    
    // Fill color: electric yellow for active word, crisp white for rest
    ctx.fillStyle = isActive ? '#FFE600' : '#FFFFFF';
    ctx.fillText(w.txt, 0, 0);
    
    ctx.restore();
    curX += wWidth + spaceW;
  });
  
  ctx.restore();
}
