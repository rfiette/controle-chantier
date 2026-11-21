// Affichage d'un plan (PDF ou image) avec zoom/déplacement au doigt et repères.
import { loadImage } from './util.js';

const BASE_PX = 3072; // résolution de base du plan (côté le plus long)
const MAX_ZOOM = 10; // zoom maximum par rapport à la résolution de base

/** Ouvre un fichier de plan. render(page, maxPx) → { canvas, page, scale } */
export async function loadSource(blob, kind) {
  if (kind === 'vector') {
    const data = JSON.parse(await blob.text());
    return {
      kind,
      data,
      pageCount: data.pages.length,
      async render(pageNum, maxPx) {
        const pg = data.pages[pageNum - 1];
        const k = maxPx / Math.max(pg.w, pg.h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(pg.w * k));
        canvas.height = Math.max(1, Math.round(pg.h * k));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawVectorPage(ctx, pg, { s: k, paths: buildPaths(pg), dimLayers: dimLayerSet(pg), lineScale: Math.max(1, maxPx / 2000) });
        return { canvas, page: null, scale: k };
      },
      destroy() {},
    };
  }
  if (kind === 'pdf') {
    const data = new Uint8Array(await blob.arrayBuffer());
    const doc = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    return {
      kind,
      pageCount: doc.numPages,
      async render(pageNum, maxPx) {
        const page = await doc.getPage(pageNum);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = maxPx / Math.max(vp1.width, vp1.height);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        return { canvas, page, scale };
      },
      destroy() {
        doc.destroy();
      },
    };
  }
  const img = await loadImage(blob);
  return {
    kind,
    pageCount: 1,
    async render(_pageNum, maxPx) {
      const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { canvas, page: null, scale: k };
    },
    destroy() {},
  };
}

export async function makeThumbnail(src, maxPx = 480) {
  const { canvas } = await src.render(1, maxPx);
  const url = canvas.toDataURL('image/jpeg', 0.7);
  canvas.width = canvas.height = 0;
  return url;
}

export class PlanViewer {
  constructor(el, { onTap, onPinTap } = {}) {
    this.el = el;
    this.onTap = onTap;
    this.onPinTap = onPinTap;
    el.classList.add('viewer');
    el.innerHTML = '<div class="v-stage"></div><canvas class="v-sharp"></canvas><div class="v-pins"></div>';
    this.stage = el.querySelector('.v-stage');
    this.sharp = el.querySelector('.v-sharp');
    this.pinLayer = el.querySelector('.v-pins');
    this.s = 1; this.tx = 0; this.ty = 0; this.W = 1; this.H = 1;
    this.pins = [];
    this.pointers = new Map();
    this.sharpState = null;
    this.raf = 0;
    this.lastTap = null;

    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._wheel = (e) => this.onWheel(e);
    this._gesture = (e) => e.preventDefault();
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
    el.addEventListener('wheel', this._wheel, { passive: false });
    el.addEventListener('gesturestart', this._gesture);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(el);
    this.vw = el.clientWidth;
    this.vh = el.clientHeight;
  }

  async open(src) {
    this.src = src;
  }

  async showPage(pageNum) {
    this.cancelSharp();
    const old = this.stage.querySelector('canvas');
    const { canvas, page, scale } = await this.src.render(pageNum, BASE_PX);
    if (old) old.width = old.height = 0;
    this.stage.replaceChildren(canvas);
    canvas.className = 'v-base';
    this.page = page;
    this.baseScale = scale;
    this.W = canvas.width;
    this.H = canvas.height;
    this.stage.style.width = this.W + 'px';
    this.stage.style.height = this.H + 'px';
    this.fit();
  }

  get fitScale() {
    return Math.min(this.vw / this.W, this.vh / this.H) * 0.96;
  }

  fit() {
    this.s = this.fitScale;
    this.tx = (this.vw - this.W * this.s) / 2;
    this.ty = (this.vh - this.H * this.s) / 2;
    this.apply();
  }

  clampScale(s) {
    return Math.min(Math.max(s, this.fitScale * 0.5), MAX_ZOOM);
  }

  /** Centre sur un point (coordonnées 0..1) en laissant la place au panneau latéral/bas */
  focusOn(x, y, { insetRight = 0, insetBottom = 0, minZoomFactor = 3 } = {}) {
    const target = Math.max(this.s, this.fitScale * minZoomFactor);
    this.s = this.clampScale(target);
    const cx = (this.vw - insetRight) / 2;
    const cy = (this.vh - insetBottom) / 2;
    this.tx = cx - x * this.W * this.s;
    this.ty = cy - y * this.H * this.s;
    this.apply();
  }

  /** Assure qu'un point est visible (sans changer le zoom) */
  ensureVisible(x, y, { insetRight = 0, insetBottom = 0 } = {}) {
    const px = this.tx + x * this.W * this.s;
    const py = this.ty + y * this.H * this.s;
    const m = 40;
    const maxX = this.vw - insetRight - m;
    const maxY = this.vh - insetBottom - m;
    if (px < m || px > maxX || py < m + 30 || py > maxY) {
      this.tx += (this.vw - insetRight) / 2 - px;
      this.ty += (this.vh - insetBottom) / 2 - py;
      this.apply();
    }
  }

  setPins(pins, selectedId = null) {
    this.pins = pins;
    this.selectedId = selectedId;
    this.pinLayer.innerHTML = pins
      .map(
        (p) => `<div class="pin${p.id === selectedId ? ' selected' : ''}" data-id="${p.id}">
          <div class="pin-b" style="background:${p.color}"><span>${p.num}</span></div></div>`
      )
      .join('');
    this.pinEls = [...this.pinLayer.children];
    this.positionPins();
  }

  positionPins() {
    if (!this.pinEls) return;
    for (let i = 0; i < this.pins.length; i++) {
      const p = this.pins[i];
      const x = this.tx + p.x * this.W * this.s;
      const y = this.ty + p.y * this.H * this.s;
      this.pinEls[i].style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }

  apply() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.stage.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.s})`;
      this.positionPins();
      // Le calque net suit le mouvement en attendant d'être recalculé
      const st = this.sharpState;
      if (st) {
        const k = this.s / st.s;
        this.sharp.style.transform = `translate3d(${this.tx - st.tx * k}px, ${this.ty - st.ty * k}px, 0) scale(${k})`;
      }
      clearTimeout(this.sharpTimer);
      this.sharpTimer = setTimeout(() => this.renderSharp(), 180);
    });
  }

  cancelSharp() {
    clearTimeout(this.sharpTimer);
    this.sharpToken = (this.sharpToken || 0) + 1;
    if (this.sharpTask) {
      try { this.sharpTask.cancel(); } catch { /* déjà fini */ }
      this.sharpTask = null;
    }
    this.sharpState = null;
    this.sharp.style.visibility = 'hidden';
  }

  // Re-rendu net de la zone visible du PDF quand on zoome au-delà de la résolution de base
  async renderSharp() {
    if (!this.page) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (this.s * dpr <= 1.15) {
      this.cancelSharp();
      return;
    }
    const token = (this.sharpToken = (this.sharpToken || 0) + 1);
    if (this.sharpTask) {
      try { this.sharpTask.cancel(); } catch { /* ignore */ }
    }
    const { s, tx, ty, vw, vh } = this;
    const cw = Math.round(vw * dpr);
    const ch = Math.round(vh * dpr);
    const off = (this.off ||= document.createElement('canvas'));
    off.width = cw;
    off.height = ch;
    const viewport = this.page.getViewport({ scale: this.baseScale * s * dpr, offsetX: tx * dpr, offsetY: ty * dpr });
    this.sharpTask = this.page.render({ canvasContext: off.getContext('2d'), viewport });
    try {
      await this.sharpTask.promise;
    } catch {
      return; // annulé
    }
    if (token !== this.sharpToken) return;
    this.sharpTask = null;
    // On ne garde que la zone de la feuille (pdf.js peint tout le canevas en blanc)
    const x0 = Math.max(0, Math.floor(tx * dpr));
    const y0 = Math.max(0, Math.floor(ty * dpr));
    const x1 = Math.min(cw, Math.ceil((tx + this.W * s) * dpr));
    const y1 = Math.min(ch, Math.ceil((ty + this.H * s) * dpr));
    this.sharp.width = cw;
    this.sharp.height = ch;
    this.sharp.style.width = vw + 'px';
    this.sharp.style.height = vh + 'px';
    if (x1 > x0 && y1 > y0) {
      this.sharp.getContext('2d').drawImage(off, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    }
    this.sharpState = { s, tx, ty };
    // Le plan a pu bouger pendant le rendu
    const k = this.s / s;
    this.sharp.style.transform = `translate3d(${this.tx - tx * k}px, ${this.ty - ty * k}px, 0) scale(${k})`;
    this.sharp.style.visibility = 'visible';
  }

  onResize() {
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    if (!vw || !vh) return;
    const wasFit = Math.abs(this.s - this.fitScale) < 1e-6;
    this.tx += (vw - this.vw) / 2;
    this.ty += (vh - this.vh) / 2;
    this.vw = vw;
    this.vh = vh;
    if (wasFit && this.W > 1) this.fit();
    else this.apply();
  }

  local(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  startGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length === 1) {
      this.g = { mode: 'pan', x0: pts[0].x, y0: pts[0].y, tx0: this.tx, ty0: this.ty };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      this.g = {
        mode: 'pinch',
        cx0: (a.x + b.x) / 2,
        cy0: (a.y + b.y) / 2,
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: this.s, tx0: this.tx, ty0: this.ty,
      };
    } else {
      this.g = null;
    }
  }

  onDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.tap = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), target: e.target, moved: false };
    } else {
      this.tap = null;
    }
    this.startGesture();
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) > 8) this.tap.moved = true;
    const g = this.g;
    if (!g) return;
    if (g.mode === 'pan') {
      if (this.tap && !this.tap.moved) return;
      this.tx = g.tx0 + (p.x - g.x0);
      this.ty = g.ty0 + (p.y - g.y0);
    } else {
      const [a, b] = [...this.pointers.values()];
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const s = this.clampScale((g.s0 * d) / g.d0);
      const qx = (g.cx0 - g.tx0) / g.s0;
      const qy = (g.cy0 - g.ty0) / g.s0;
      this.s = s;
      this.tx = cx - qx * s;
      this.ty = cy - qy * s;
    }
    this.apply();
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    const tap = this.tap;
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId && !tap.moved && performance.now() - tap.t < 500) {
      this.handleTap(p, tap.target);
    }
    this.tap = null;
    this.startGesture();
  }

  handleTap(p, target) {
    const pinEl = target && target.closest && target.closest('.pin');
    if (pinEl) {
      this.lastTap = null;
      this.onPinTap?.(pinEl.dataset.id);
      return;
    }
    const now = performance.now();
    const lt = this.lastTap;
    if (lt && now - lt.t < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 30 && !this.noDoubleTap) {
      // Double appui : zoom avant
      this.lastTap = null;
      this.zoomAt(p.x, p.y, 2.5);
      return;
    }
    this.lastTap = { t: now, x: p.x, y: p.y };
    const qx = (p.x - this.tx) / this.s / this.W;
    const qy = (p.y - this.ty) / this.s / this.H;
    this.onTap?.(qx, qy, qx >= 0 && qx <= 1 && qy >= 0 && qy <= 1);
  }

  zoomAt(x, y, factor) {
    const s = this.clampScale(this.s * factor);
    const k = s / this.s;
    this.tx = x - (x - this.tx) * k;
    this.ty = y - (y - this.ty) * k;
    this.s = s;
    this.apply();
  }

  zoomBy(factor) {
    this.zoomAt(this.vw / 2, this.vh / 2, factor);
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  }

  destroy() {
    this.cancelSharp();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    const c = this.stage.querySelector('canvas');
    if (c) c.width = c.height = 0;
    this.sharp.width = this.sharp.height = 0;
    if (this.off) this.off.width = this.off.height = 0;
    this.src?.destroy();
    this.el.removeEventListener('pointerdown', this._down);
    this.el.removeEventListener('pointermove', this._move);
    this.el.removeEventListener('pointerup', this._up);
    this.el.removeEventListener('pointercancel', this._up);
    this.el.removeEventListener('wheel', this._wheel);
    this.el.removeEventListener('gesturestart', this._gesture);
  }
}

/* ------------------------------------------------------------------ */
/* Plans vectoriels (issus d'un DXF) : cotes et éléments cliquables     */
/* ------------------------------------------------------------------ */

const LINE_COLOR = '#30363d';
const TEXT_COLOR = '#1d232b';
const DIM_COLOR = '#1d5fb4';

export function buildPaths(pg) {
  return pg.layers.map((L) => {
    const p = new Path2D();
    for (const a of L.p) {
      p.moveTo(a[0], a[1]);
      for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]);
    }
    return p;
  });
}

export const dimLayerSet = (pg) => new Set(pg.dims.map((d) => d.l));

/**
 * Dessine une page vectorielle. Le contexte doit déjà être transformé (unités : mm du plan).
 * o.px = pixels (canevas) par mm ; o.view = zone visible [x0,y0,x1,y1] ; o.marks = objets contrôlés.
 */
export function drawVectorPage(ctx, pg, o) {
  const px = o.px || o.s;
  const hidden = o.hidden || new Set();
  const vis = o.view || [0, 0, pg.w, pg.h];
  const marks = o.marks || [];
  for (const m of marks) {
    const b = m.bb;
    ctx.fillStyle = m.color + '30';
    ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = (o.lineScale || 1) / px;
  pg.layers.forEach((L, i) => {
    if (hidden.has(L.n)) return;
    ctx.strokeStyle = o.dimLayers && o.dimLayers.has(L.n) ? DIM_COLOR : LINE_COLOR;
    ctx.stroke(o.paths[i]);
  });
  const minH = 3 / px;
  let font = '';
  for (const t of pg.texts) {
    const [x, y, h, r, s, al, li] = t;
    if (h < minH) continue;
    const L = pg.layers[li];
    if (L && hidden.has(L.n)) continue;
    const reach = h * (s.length + 2);
    if (x + reach < vis[0] || x - reach > vis[2] || y + reach < vis[1] || y - reach > vis[3]) continue;
    ctx.fillStyle = L && o.dimLayers && o.dimLayers.has(L.n) ? DIM_COLOR : TEXT_COLOR;
    const f = `${Math.round(h * 14) / 10}px Arial, Helvetica, sans-serif`;
    if (f !== font) { ctx.font = f; font = f; }
    ctx.textAlign = al[0] === 'c' ? 'center' : al[0] === 'r' ? 'right' : 'left';
    ctx.textBaseline = al[1] === 't' ? 'top' : al[1] === 'm' ? 'middle' : 'alphabetic';
    const lines = s.split('\n');
    const lh = h * 1.66;
    let oy = al[1] === 't' ? 0 : al[1] === 'm' ? (-(lines.length - 1) * lh) / 2 : -(lines.length - 1) * lh;
    ctx.save();
    ctx.translate(x, y);
    if (r) ctx.rotate((-r * Math.PI) / 180);
    for (const line of lines) {
      ctx.fillText(line, 0, oy);
      oy += lh;
    }
    ctx.restore();
  }
  // Objets contrôlés : contour coloré + numéro
  for (const m of marks) {
    const b = m.bb;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2.5 / px;
    ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  }
  const R = 11 / px;
  ctx.font = `bold ${12 / px}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of marks) {
    const bx = m.bb[2];
    const by = m.bb[1];
    ctx.beginPath();
    ctx.arc(bx, by, R, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.lineWidth = 2 / px;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(m.num), bx, by + 0.5 / px);
  }
  if (o.selected) {
    const b = o.selected;
    const e = 5 / px;
    ctx.setLineDash([6 / px, 4 / px]);
    ctx.strokeStyle = '#f28c28';
    ctx.lineWidth = 3 / px;
    ctx.strokeRect(b[0] - e, b[1] - e, b[2] - b[0] + 2 * e, b[3] - b[1] + 2 * e);
    ctx.setLineDash([]);
  }
}

export class VectorViewer extends PlanViewer {
  constructor(el, opts) {
    super(el, opts);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'v-vec';
    el.insertBefore(this.canvas, this.pinLayer);
    this.stage.style.display = 'none';
    this.hidden = new Set();
    this.marks = [];
    this.selected = null;
  }

  async showPage(n) {
    this.pg = this.src.data.pages[n - 1];
    this.W = this.pg.w;
    this.H = this.pg.h;
    this.paths = buildPaths(this.pg);
    this.dimLayers = dimLayerSet(this.pg);
    this.fit();
  }

  clampScale(s) {
    const f = this.fitScale;
    return Math.min(Math.max(s, f * 0.5), Math.max(f * 400, 3));
  }

  focusOn(x, y, opts = {}) {
    super.focusOn(x, y, { minZoomFactor: 8, ...opts });
  }

  apply() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
      this.positionPins();
    });
  }

  renderSharp() {}
  cancelSharp() {}

  draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = this.canvas;
    const cw = Math.round(this.vw * dpr);
    const ch = Math.round(this.vh * dpr);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
      c.style.width = this.vw + 'px';
      c.style.height = this.vh + 'px';
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!this.pg) return;
    const k = this.s * dpr;
    ctx.setTransform(k, 0, 0, k, this.tx * dpr, this.ty * dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.W, this.H);
    const view = [-this.tx / this.s, -this.ty / this.s, (this.vw - this.tx) / this.s, (this.vh - this.ty) / this.s];
    drawVectorPage(ctx, this.pg, {
      px: k, paths: this.paths, dimLayers: this.dimLayers, hidden: this.hidden, view, marks: this.marks, selected: this.selected,
    });
  }

  setHiddenLayers(set) {
    this.hidden = set;
    this.apply();
  }

  /** marks : [{bb, color, num}] ; selected : bb ou null */
  setMarks(marks, selected) {
    this.marks = marks;
    this.selected = selected;
    this.apply();
  }

  /** Cote ou élément sous le doigt (coordonnées 0..1) */
  hitTest(qx, qy) {
    const pg = this.pg;
    if (!pg) return null;
    const x = qx * this.W;
    const y = qy * this.H;
    const tol = 18 / this.s;
    const hid = this.hidden;
    let dim = null;
    let bd = Infinity;
    for (const d of pg.dims) {
      if (hid.has(d.l)) continue;
      const dist = Math.hypot(x - d.tx, y - d.ty);
      if (dist < bd) { bd = dist; dim = d; }
    }
    if (bd > tol * 2) dim = null;
    let el = null;
    let ba = Infinity;
    for (const e of pg.els) {
      if (hid.has(e.l)) continue;
      const b = e.bb;
      if (x < b[0] - tol / 2 || x > b[2] + tol / 2 || y < b[1] - tol / 2 || y > b[3] + tol / 2) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < ba) { ba = a; el = e; }
    }
    if (dim && (!el || bd < tol)) return { kind: 'dim', obj: dim };
    if (el) return { kind: 'el', obj: el };
    return null;
  }

  destroy() {
    super.destroy();
    this.canvas.width = this.canvas.height = 0;
  }
}
