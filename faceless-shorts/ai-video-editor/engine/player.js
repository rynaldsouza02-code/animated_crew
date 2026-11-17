// Editor player for the ai-video-editor skill. Loaded after the style's base.js and your story.js.
// story.js must define:
//   var EDIT = {
//     D: <edited video length in seconds>,
//     SPANS: [[t0, t1], ...],   // where graphics are on screen; outside them the plain footage plays
//     draw(ctx, t) { ... },     // draws frame t (only called inside a span); draw the footage yourself with FOOTAGE
//     score(k) { ... },         // sound effects for the whole timeline, same times as the picture
//   };
// FOOTAGE gives the edited A-roll at the current time (the renderer swaps in the exact frame before each draw).
(function () {
  const W0 = 1280, H0 = 720;
  const RENDER = !!window.__RENDER;
  const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------- footage source ----------------
  let el; // <video> in preview, <img> while rendering
  if (RENDER) {
    el = new Image();
    Object.defineProperty(el, 'videoWidth', { get: () => el.naturalWidth });
    Object.defineProperty(el, 'videoHeight', { get: () => el.naturalHeight });
  } else {
    el = document.createElement('video');
    el.src = window.FOOTAGE_URL || 'cut.mp4'; el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
  }
  const size = () => (RENDER ? [el.naturalWidth, el.naturalHeight] : [el.videoWidth, el.videoHeight]);
  const FOOTAGE = {
    el,
    ready() { const [w] = size(); return w > 0; },
    // cover-fit the footage into a rect, zoomed by z around the face point (fx, fy as 0..1 of the frame)
    draw(c, x, y, w, h, z = 1, fx = 0.5, fy = 0.38) {
      const [sw, sh] = size(); if (!sw) { c.save(); c.fillStyle = '#222'; c.fillRect(x, y, w, h); c.restore(); return; }
      const s = Math.max(w / sw, h / sh) * z, dw = sw * s, dh = sh * s;
      let dx = x + w / 2 - fx * dw, dy = y + h * 0.42 - fy * dh;
      dx = clampN(dx, x + w - dw, x); dy = clampN(dy, y + h - dh, y);
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.drawImage(el, dx, dy, dw, dh); c.restore();
    },
    full(c, z = 1, fx = 0.5, fy = 0.38) { c.save(); c.fillStyle = '#000'; c.fillRect(0, 0, W0, H0); c.restore(); this.draw(c, 0, 0, W0, H0, z, fx, fy); },
  };
  window.FOOTAGE = FOOTAGE;

  // Transition between the footage and a full-screen graphics span [a, b], at both edges.
  // type: 'cut' (none), 'fade', 'push' (sideways), 'up' (vertical). d: seconds per transition.
  let GL = null;
  window.gfxInOut = (c, t, a, b, draw, o = {}) => {
    const type = o.type || 'push', d = o.d == null ? 0.4 : o.d;
    const u = d > 0 ? Math.min(clampN((t - a) / d, 0, 1), clampN((b - t) / d, 0, 1)) : 1;
    if (type === 'cut' || u >= 1) { draw(c, t); return; }
    const entering = t - a < b - t, e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    if (!GL) { GL = document.createElement('canvas'); GL.width = W0; GL.height = H0; }
    const g = GL.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, W0, H0);
    draw(g, t);
    if (type === 'fade') { FOOTAGE.full(c); c.save(); c.globalAlpha = e; c.drawImage(GL, 0, 0); c.restore(); return; }
    const dir = entering ? 1 : -1;
    if (type === 'up') {
      c.save(); c.translate(0, -e * H0 * dir); FOOTAGE.full(c); c.restore();
      c.save(); c.translate(0, (1 - e) * H0 * dir); c.drawImage(GL, 0, 0); c.restore(); return;
    }
    c.save(); c.translate(-e * W0 * dir, 0); FOOTAGE.full(c); c.restore();
    c.save(); c.translate((1 - e) * W0 * dir, 0); c.drawImage(GL, 0, 0); c.restore();
  };
  // styles built around A-roll (Warm Canvas) read AR.el: point it at the real footage
  try { if (typeof AR !== 'undefined') AR = { el }; } catch (e) {}
  try { if (typeof OVERLAY !== 'undefined') OVERLAY = false; } catch (e) {}

  if (typeof EDIT === 'undefined') throw new Error('story.js must define var EDIT = { D, SPANS, draw, score }');
  const D = EDIT.D, SPANS = (EDIT.SPANS || []).map((s) => [+s[0], +s[1]]).sort((a, b) => a[0] - b[0]);
  const inSpan = (t) => SPANS.some(([a, b]) => t >= a && t < b);
  const cvs = document.getElementById('stage'), ctx = cvs.getContext('2d');
  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    if (inSpan(t)) EDIT.draw(ctx, t); else FOOTAGE.full(ctx);
  }

  // note: never assign window.scoreSound here, it would replace a style's own scoreSound function
  const SCORE = (k) => EDIT.score(k);
  window.DURATION = D; window.SPANS = SPANS; window.EDIT_SCORE = SCORE;
  window.drawAt = frame;

  // ---------------- render hooks (used by scripts/render.py) ----------------
  window.__renderFrame = async (t, jpegB64, quality) => {
    if (jpegB64) { el.src = 'data:image/jpeg;base64,' + jpegB64; await el.decode(); }
    frame(t);
    return cvs.toDataURL('image/jpeg', quality || 0.93).slice(23);
  };
  window.__renderStill = async (t, jpegB64) => {
    if (jpegB64) { el.src = 'data:image/jpeg;base64,' + jpegB64; await el.decode(); }
    frame(t); return cvs.toDataURL('image/png').slice(22);
  };
  let SFXBUF = null;
  window.__renderSfx = async (sr) => {
    const r = await SFX.render(SCORE, D, sr || 48000, { voiceover: true });
    const n = r.inter.length, pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, r.inter[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
    SFXBUF = new Uint8Array(pcm.buffer); return { bytes: SFXBUF.length, peak: r.peak, frames: r.frames };
  };
  window.__sfxChunk = (off, len) => {
    const part = SFXBUF.subarray(off, Math.min(off + len, SFXBUF.length)); let s = '';
    for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // ---------------- preview player ----------------
  const ui = { play: document.getElementById('play'), scrub: document.getElementById('scrub'), time: document.getElementById('time'), sound: document.getElementById('sound'), marks: document.getElementById('marks') };
  let T = 0, playing = false, last = 0, soundOn = true, stopSound = null;
  const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0'); return m + ':' + s; };
  async function show() {
    if (!RENDER && !playing && el.readyState >= 1 && Math.abs(el.currentTime - T) > 0.02) {
      await new Promise((res) => { el.addEventListener('seeked', res, { once: true }); el.currentTime = Math.min(T, (el.duration || D) - 0.02); });
    }
    frame(T); if (ui.scrub) ui.scrub.value = T; if (ui.time) ui.time.textContent = fmt(T) + ' / ' + fmt(D);
  }
  window.seek = (t) => { T = clampN(t, 0, D); return show(); };
  function startSound() { stopSnd(); if (playing && soundOn) stopSound = SFX.live(SCORE, T, { voiceover: true }); }
  function stopSnd() { if (stopSound) { stopSound(); stopSound = null; } }
  function setPlaying(p) {
    playing = p; if (ui.play) ui.play.textContent = p ? 'Pause' : 'Play';
    if (p) { el.currentTime = T; el.muted = false; el.play().catch(() => {}); last = performance.now(); startSound(); } else { el.pause(); stopSnd(); }
  }
  function tick(now) {
    if (playing) {
      T = el.readyState >= 2 && !el.paused ? el.currentTime : T + (now - last) / 1000; last = now;
      if (T >= D) { T = D; setPlaying(false); }
      frame(T); if (ui.scrub) ui.scrub.value = T; if (ui.time) ui.time.textContent = fmt(T) + ' / ' + fmt(D);
    }
    requestAnimationFrame(tick);
  }
  if (!RENDER && ui.play) {
    ui.scrub.max = D;
    ui.play.addEventListener('click', () => { if (!playing && T >= D - 0.01) T = 0; setPlaying(!playing); });
    ui.scrub.addEventListener('input', () => { T = parseFloat(ui.scrub.value); if (playing) { el.currentTime = T; startSound(); } else show(); });
    ui.sound.addEventListener('click', () => { soundOn = !soundOn; ui.sound.setAttribute('aria-pressed', soundOn); ui.sound.textContent = soundOn ? 'Effects on' : 'Effects off'; startSound(); });
    if (ui.marks) ui.marks.innerHTML = SPANS.map(([a, b]) => `<i style="left:${(a / D) * 100}%;width:${((b - a) / D) * 100}%"></i>`).join('');
    document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); ui.play.click(); } });
  }

  // ---------------- startup: fonts first, then the first frame ----------------
  (async () => {
    const want = window.STYLE_FONTS || [];
    try { await Promise.all(want.map((f) => document.fonts.load(f, 'AaZz09'))); await document.fonts.ready; } catch (e) {}
    if (!RENDER) { await new Promise((res) => { if (el.readyState >= 2) res(); else { el.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 4000); } }); }
    T = SPANS.length ? SPANS[0][0] + 0.5 : 0; await show();
    window.__ready = true;
    if (!RENDER) requestAnimationFrame((n) => { last = n; tick(n); });
  })();
})();
