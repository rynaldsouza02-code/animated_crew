// HiDPI shim for the style engines.
// Every style draws in a fixed 1280x720 design space. When window.__RENDER.scale (S) is above 1, this file
// makes every canvas S times bigger internally while the style code still sees 1280x720: canvas sizes,
// transforms, drawImage of other canvases, patterns, shadows, blur filters and putImageData are all
// translated. Result: sharp 1080p (S = 1.5) or 4K (S = 3) frames with no change to the style code.
(function () {
  const S = (window.__RENDER && window.__RENDER.scale) || 1;
  if (S === 1) return;
  const CP = HTMLCanvasElement.prototype;
  const X = CanvasRenderingContext2D.prototype;
  const wD = Object.getOwnPropertyDescriptor(CP, 'width');
  const hD = Object.getOwnPropertyDescriptor(CP, 'height');
  const LOG = new WeakMap(); // canvas -> { w, h } logical size

  function init(c) {
    let o = LOG.get(c);
    if (o) return o;
    o = { w: wD.get.call(c), h: hD.get.call(c) };
    LOG.set(c, o);
    wD.set.call(c, Math.round(o.w * S));
    hD.set.call(c, Math.round(o.h * S));
    return o;
  }
  const baseT = (ctx) => setT.call(ctx, S, 0, 0, S, 0, 0);

  Object.defineProperty(CP, 'width', {
    configurable: true, enumerable: true,
    get() { return init(this).w; },
    set(v) { const o = init(this); o.w = +v; wD.set.call(this, Math.round(o.w * S)); const x = CTX.get(this); if (x) baseT(x); },
  });
  Object.defineProperty(CP, 'height', {
    configurable: true, enumerable: true,
    get() { return init(this).h; },
    set(v) { const o = init(this); o.h = +v; hD.set.call(this, Math.round(o.h * S)); const x = CTX.get(this); if (x) baseT(x); },
  });

  const CTX = new WeakMap();
  const getCtx = CP.getContext;
  CP.getContext = function (type, opts) {
    init(this);
    const x = getCtx.call(this, type, opts);
    if (type === '2d' && x && !CTX.has(this)) { CTX.set(this, x); baseT(x); }
    return x;
  };

  const setT = X.setTransform;
  X.setTransform = function (a, b, c, d, e, f) {
    if (typeof a === 'object' && a !== null) { const m = a; return setT.call(this, (m.a ?? m.m11) * S, (m.b ?? m.m12) * S, (m.c ?? m.m21) * S, (m.d ?? m.m22) * S, (m.e ?? m.m41) * S, (m.f ?? m.m42) * S); }
    if (a === undefined) return baseT(this);
    return setT.call(this, a * S, b * S, c * S, d * S, e * S, f * S);
  };
  X.resetTransform = function () { return baseT(this); };
  const getT = X.getTransform;
  X.getTransform = function () { const m = getT.call(this); return new DOMMatrix([m.a / S, m.b / S, m.c / S, m.d / S, m.e / S, m.f / S]); };

  const scaled = (src) => src instanceof HTMLCanvasElement && LOG.has(src);
  const draw = X.drawImage;
  X.drawImage = function (src, ...a) {
    if (scaled(src)) {
      const o = LOG.get(src);
      if (a.length === 2) return draw.call(this, src, a[0], a[1], o.w, o.h);
      if (a.length === 8) return draw.call(this, src, a[0] * S, a[1] * S, a[2] * S, a[3] * S, a[4], a[5], a[6], a[7]);
    }
    return draw.call(this, src, ...a);
  };

  const cpat = X.createPattern;
  const PT = CanvasPattern.prototype, pset = PT.setTransform, SCALED_PAT = new WeakSet();
  X.createPattern = function (src, rep) {
    const p = cpat.call(this, src, rep);
    if (p && scaled(src)) { SCALED_PAT.add(p); pset.call(p, new DOMMatrix().scaleSelf(1 / S, 1 / S)); }
    return p;
  };
  PT.setTransform = function (m) {
    if (!SCALED_PAT.has(this)) return pset.call(this, m);
    const M = DOMMatrix.fromMatrix(m || new DOMMatrix()).scaleSelf(1 / S, 1 / S);
    return pset.call(this, M);
  };

  // putImageData ignores the transform: draw the pixels through a temporary canvas instead
  const put = X.putImageData;
  X.putImageData = function (img, dx, dy, ...rest) {
    if (!CTX.has(this.canvas)) return put.call(this, img, dx, dy, ...rest);
    const t = document.createElement('canvas'); LOG.set(t, { w: img.width, h: img.height });
    wD.set.call(t, img.width); hD.set.call(t, img.height); put.call(getCtx.call(t, '2d'), img, 0, 0);
    this.save(); setT.call(this, 1, 0, 0, 1, 0, 0); this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.filter = 'none';
    this.clearRect(dx * S, dy * S, img.width * S, img.height * S);
    draw.call(this, t, 0, 0, img.width, img.height, dx * S, dy * S, img.width * S, img.height * S);
    this.restore();
  };
  const gid = X.getImageData;
  X.getImageData = function (x, y, w, h, o) {
    if (!CTX.has(this.canvas)) return gid.call(this, x, y, w, h, o);
    // sample the scaled backing store down to logical pixels
    const t = document.createElement('canvas'); wD.set.call(t, w); hD.set.call(t, h);
    const tc = getCtx.call(t, '2d'); draw.call(tc, this.canvas, x * S, y * S, w * S, h * S, 0, 0, w, h);
    return gid.call(tc, 0, 0, w, h, o);
  };

  // shadows and filters live in device pixels, so scale them too
  for (const k of ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY']) {
    const d = Object.getOwnPropertyDescriptor(X, k);
    Object.defineProperty(X, k, { configurable: true, enumerable: true, get() { return d.get.call(this) / S; }, set(v) { d.set.call(this, v * S); } });
  }
  const fD = Object.getOwnPropertyDescriptor(X, 'filter');
  if (fD) {
    const FL = new WeakMap();
    Object.defineProperty(X, 'filter', {
      configurable: true, enumerable: true,
      get() { return FL.has(this) ? FL.get(this) : fD.get.call(this); },
      set(v) { FL.set(this, v); fD.set.call(this, String(v).replace(/(-?\d*\.?\d+)px/g, (m, n) => (parseFloat(n) * S) + 'px')); },
    });
    const sv = X.save, rs = X.restore, STK = new WeakMap();
    X.save = function () { (STK.get(this) || STK.set(this, []).get(this)).push(FL.get(this)); return sv.call(this); };
    X.restore = function () { const s = STK.get(this); if (s && s.length) { const v = s.pop(); if (v === undefined) FL.delete(this); else FL.set(this, v); } return rs.call(this); };
  }
})();
