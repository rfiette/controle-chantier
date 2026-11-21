// Lecture d'un DXF (export AutoCAD / Revit) et préparation d'un « plan interactif » :
// géométrie vectorielle en mm, cotes (avec leur valeur) et éléments (blocs) sélectionnables, découpage en vues.
// Fonctionne dans le navigateur et sous Node (pour les tests).

const UNIT_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };

/* ------------------------------------------------------------------ */
/* Lecture                                                              */
/* ------------------------------------------------------------------ */

function getter(c) {
  return (code, def) => {
    for (let i = 0; i < c.length; i += 2) if (c[i] === code) return c[i + 1];
    return def;
  };
}

function decodeText(s, mtext) {
  if (!s) return '';
  let t = s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%')
    .replace(/%%[uUoOkK]/g, '');
  if (mtext) {
    t = t
      .replace(/\\P/g, '\n')
      .replace(/\\S([^;^#/]*)[\^#/]([^;]*);/g, '$1/$2')
      .replace(/\\[ACFHQTWfhqtwacp][^;\\]*;/g, '')
      .replace(/\\[LlOoKkN]/g, '')
      .replace(/\\~/g, ' ')
      .replace(/\\\\/g, '\\')
      .replace(/[{}]/g, '');
  }
  return t.trim();
}

function convert(e) {
  const c = e.c;
  const g = getter(c);
  const n = (code, def = 0) => {
    const v = g(code);
    if (v === undefined) return def;
    const f = parseFloat(v);
    return Number.isFinite(f) ? f : def;
  };
  if (g(67) === '1') return { paper: true };
  const base = { l: g(8, '0'), h: g(5) };
  switch (e.type) {
    case 'LINE':
      return { ...base, k: 'lw', pts: [n(10), n(20), n(11), n(21)], bulges: null, closed: false };
    case 'LWPOLYLINE': {
      const pts = [];
      const bulges = [];
      let hasBulge = false;
      for (let i = 0; i < c.length; i += 2) {
        if (c[i] === 10) { pts.push(parseFloat(c[i + 1])); bulges.push(0); }
        else if (c[i] === 20) pts.push(parseFloat(c[i + 1]));
        else if (c[i] === 42 && bulges.length) { bulges[bulges.length - 1] = parseFloat(c[i + 1]); hasBulge = true; }
      }
      return { ...base, k: 'lw', pts, bulges: hasBulge ? bulges : null, closed: (n(70) & 1) === 1 };
    }
    case 'POLYLINE':
      if (n(70) & (16 | 64)) return null; // maillages 3D
      return { ...base, k: 'lw', pts: [], bulges: [], closed: (n(70) & 1) === 1 };
    case 'SOLID':
    case 'TRACE':
      return { ...base, k: 'lw', pts: [n(10), n(20), n(11), n(21), n(13), n(23), n(12), n(22)], bulges: null, closed: true };
    case 'LEADER': {
      const pts = [];
      for (let i = 0; i < c.length; i += 2) {
        if (c[i] === 10) pts.push(parseFloat(c[i + 1]));
        else if (c[i] === 20) pts.push(parseFloat(c[i + 1]));
      }
      return { ...base, k: 'lw', pts, bulges: null, closed: false };
    }
    case 'ARC':
      return { ...base, k: 'arc', cx: n(10), cy: n(20), r: n(40), a0: n(50), a1: n(51) };
    case 'CIRCLE':
      return { ...base, k: 'arc', cx: n(10), cy: n(20), r: n(40), a0: 0, a1: 360 };
    case 'ELLIPSE':
      return { ...base, k: 'ell', cx: n(10), cy: n(20), mx: n(11), my: n(21), ratio: n(40, 1), p0: n(41, 0), p1: n(42, Math.PI * 2) };
    case 'SPLINE': {
      const ctrl = [];
      const fit = [];
      const knots = [];
      for (let i = 0; i < c.length; i += 2) {
        const code = c[i];
        const v = parseFloat(c[i + 1]);
        if (code === 10 || code === 20) ctrl.push(v);
        else if (code === 11 || code === 21) fit.push(v);
        else if (code === 40) knots.push(v);
      }
      return { ...base, k: 'spl', ctrl, fit, knots, deg: n(71, 3) };
    }
    case 'TEXT':
    case 'ATTRIB': {
      if (e.type === 'ATTRIB' && (n(70) & 1)) return null; // attribut invisible
      const hj = n(72);
      const vj = e.type === 'ATTRIB' ? n(74) : n(73);
      const useAlign = (hj !== 0 || vj !== 0) && g(11) !== undefined;
      return {
        ...base, k: 'txt', x: useAlign ? n(11) : n(10), y: useAlign ? n(21) : n(20), h: n(40, 1), r: n(50),
        s: decodeText(g(1, ''), false),
        ah: hj === 1 || hj === 4 ? 'c' : hj === 2 ? 'r' : 'l',
        av: hj === 4 || vj === 2 ? 'm' : vj === 3 ? 't' : 'b',
      };
    }
    case 'MTEXT': {
      let s = '';
      for (let i = 0; i < c.length; i += 2) if (c[i] === 3) s += c[i + 1];
      s += g(1, '');
      const att = n(71, 1);
      let r = n(50, NaN);
      if (!Number.isFinite(r)) r = g(11) !== undefined ? (Math.atan2(n(21), n(11)) * 180) / Math.PI : 0;
      return {
        ...base, k: 'txt', x: n(10), y: n(20), h: n(40, 1), r, s: decodeText(s, true),
        ah: ['l', 'c', 'r'][(att - 1) % 3] || 'l', av: att <= 3 ? 't' : att <= 6 ? 'm' : 'b',
      };
    }
    case 'INSERT':
      return {
        ...base, k: 'ins', name: g(2, ''), x: n(10), y: n(20), sx: n(41, 1), sy: n(42, 1), r: n(50),
        cols: Math.max(1, n(70, 1)), rows: Math.max(1, n(71, 1)), cs: n(44), rs: n(45),
      };
    case 'DIMENSION':
      return {
        ...base, k: 'dim', name: g(2, ''), style: g(3, ''), meas: g(42) !== undefined ? n(42) : null,
        text: g(1, ''), dtype: n(70) & 7, rot: n(50),
        p11: [n(11), n(21)], p13: [n(13), n(23)], p14: [n(14), n(24)], p10: [n(10), n(20)],
      };
    default:
      return null;
  }
}

class DxfState {
  constructor() {
    this.section = null;
    this.wantName = false;
    this.ent = null;
    this.hvar = null;
    this.insunits = 0;
    this.layers = new Map();
    this.dimstyles = new Map();
    this.blocks = new Map();
    this.block = null;
    this.model = [];
    this.poly = null;
  }

  pair(code, raw) {
    const v = raw.trim();
    if (code === 0) {
      this.flush();
      if (v === 'SECTION') { this.wantName = true; return; }
      if (v === 'ENDSEC') { this.section = null; return; }
      if (v === 'TABLE' || v === 'ENDTAB' || v === 'EOF') return;
      this.ent = { type: v, c: [] };
      return;
    }
    if (this.wantName) {
      if (code === 2) { this.section = v; this.wantName = false; }
      return;
    }
    const s = this.section;
    if (s === 'HEADER') {
      if (code === 9) this.hvar = v;
      else if (this.hvar === '$INSUNITS' && code === 70) this.insunits = parseInt(v, 10);
      return;
    }
    if (this.ent && (s === 'ENTITIES' || s === 'BLOCKS' || s === 'TABLES')) this.ent.c.push(code, v);
  }

  flush() {
    const e = this.ent;
    if (!e) return;
    this.ent = null;
    const s = this.section;
    if (s === 'TABLES') {
      const g = getter(e.c);
      if (e.type === 'LAYER') {
        const color = parseInt(g(62, '7'), 10);
        const flags = parseInt(g(70, '0'), 10);
        this.layers.set(g(2, '0'), { off: color < 0 || (flags & 1) === 1 });
      } else if (e.type === 'DIMSTYLE') {
        this.dimstyles.set(g(2, ''), { lfac: parseFloat(g(144, '1')) || 1 });
      }
      return;
    }
    if (s === 'BLOCKS') {
      if (e.type === 'BLOCK') {
        const g = getter(e.c);
        this.block = { name: g(2, ''), bx: parseFloat(g(10, '0')), by: parseFloat(g(20, '0')), flags: parseInt(g(70, '0'), 10), ents: [] };
        this.blocks.set(this.block.name, this.block);
        return;
      }
      if (e.type === 'ENDBLK') { this.block = null; this.poly = null; return; }
      if (this.block) this.add(this.block.ents, e);
      return;
    }
    if (s === 'ENTITIES') this.add(this.model, e);
  }

  add(list, e) {
    if (e.type === 'VERTEX') {
      if (this.poly) {
        const g = getter(e.c);
        this.poly.pts.push(parseFloat(g(10, '0')), parseFloat(g(20, '0')));
        this.poly.bulges.push(parseFloat(g(42, '0')) || 0);
      }
      return;
    }
    if (e.type === 'SEQEND') { this.poly = null; return; }
    const o = convert(e);
    if (!o || o.paper) return;
    if (e.type === 'POLYLINE') this.poly = o;
    list.push(o);
  }
}

/** chunks : itérable asynchrone de morceaux de texte */
export async function parseDxfChunks(chunks, total, onProgress) {
  const st = new DxfState();
  let rest = '';
  let code = null;
  let read = 0;
  let lastYield = 0;
  for await (const chunk of chunks) {
    read += chunk.length;
    const text = rest + chunk;
    let start = 0;
    let i;
    while ((i = text.indexOf('\n', start)) !== -1) {
      const line = text.slice(start, i);
      start = i + 1;
      if (code === null) code = parseInt(line, 10);
      else { st.pair(code, line); code = null; }
    }
    rest = text.slice(start);
    if (onProgress && read - lastYield > 3e6) {
      lastYield = read;
      onProgress(Math.min(1, read / total));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (code !== null && rest) st.pair(code, rest);
  st.flush();
  return st;
}

export async function parseDxfFile(file, onProgress) {
  let chunks;
  if (typeof TextDecoderStream !== 'undefined' && file.stream) {
    const reader = file.stream().pipeThrough(new TextDecoderStream('utf-8')).getReader();
    chunks = {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      },
    };
  } else {
    const text = await file.text();
    chunks = (function* () {
      for (let i = 0; i < text.length; i += 1 << 20) yield text.slice(i, i + (1 << 20));
    })();
  }
  return parseDxfChunks(chunks, file.size, onProgress);
}

/* ------------------------------------------------------------------ */
/* Aplatissement (blocs → coordonnées du dessin)                        */
/* ------------------------------------------------------------------ */

const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const insertMatrix = (x, y, sx, sy, rDeg, bx, by) => {
  const r = (rDeg * Math.PI) / 180;
  const co = Math.cos(r);
  const si = Math.sin(r);
  // T(x,y) · R · S · T(-bx,-by)
  return [co * sx, si * sx, -si * sy, co * sy, x - (co * sx * bx - si * sy * by), y - (si * sx * bx + co * sy * by)];
};

function bulgeArc(x1, y1, x2, y2, b, out) {
  const th = 4 * Math.atan(b);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return;
  const r = d / (2 * Math.sin(th / 2));
  const hh = r * Math.cos(th / 2);
  const cx = (x1 + x2) / 2 - (dy / d) * hh;
  const cy = (y1 + y2) / 2 + (dx / d) * hh;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const R = Math.abs(r);
  const n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18)));
  for (let k = 1; k <= n; k++) {
    const a = a0 + (th * k) / n;
    out.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
}

function bspline(ctrl, knots, deg) {
  const n = ctrl.length / 2 - 1;
  if (n < deg || knots.length !== n + deg + 2) return ctrl.slice();
  const lo = knots[deg];
  const hi = knots[n + 1];
  const samples = Math.min(200, (n + 1) * 8);
  const out = [];
  for (let s = 0; s <= samples; s++) {
    const t = lo + ((hi - lo) * s) / samples;
    let k = deg;
    while (k < n && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) d.push(ctrl[2 * (j + k - deg)], ctrl[2 * (j + k - deg) + 1]);
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = j + k - deg;
        const den = knots[i + deg - r + 1] - knots[i];
        const a = den === 0 ? 0 : (t - knots[i]) / den;
        d[2 * j] = (1 - a) * d[2 * (j - 1)] + a * d[2 * j];
        d[2 * j + 1] = (1 - a) * d[2 * (j - 1) + 1] + a * d[2 * j + 1];
      }
    }
    out.push(d[2 * deg], d[2 * deg + 1]);
  }
  return out;
}

/** Points locaux (avant transformation) d'une entité linéaire */
function localPoints(o) {
  if (o.k === 'lw') {
    const p = o.pts;
    if (!o.bulges) return o.closed && p.length >= 6 ? [...p, p[0], p[1]] : p;
    const out = [p[0], p[1]];
    const nv = p.length / 2;
    const last = o.closed ? nv : nv - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % nv;
      const b = o.bulges[i] || 0;
      if (b) bulgeArc(p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1], b, out);
      else out.push(p[2 * j], p[2 * j + 1]);
    }
    return out;
  }
  if (o.k === 'arc') {
    let a0 = o.a0;
    let a1 = o.a1;
    while (a1 <= a0) a1 += 360;
    const n = Math.max(6, Math.ceil(((a1 - a0) / 360) * 48));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
      out.push(o.cx + o.r * Math.cos(a), o.cy + o.r * Math.sin(a));
    }
    return out;
  }
  if (o.k === 'ell') {
    let p0 = o.p0;
    let p1 = o.p1;
    while (p1 <= p0) p1 += Math.PI * 2;
    const n = Math.max(8, Math.ceil(((p1 - p0) / (Math.PI * 2)) * 48));
    const nx = -o.my * o.ratio;
    const ny = o.mx * o.ratio;
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = p0 + ((p1 - p0) * k) / n;
      out.push(o.cx + o.mx * Math.cos(t) + nx * Math.sin(t), o.cy + o.my * Math.cos(t) + ny * Math.sin(t));
    }
    return out;
  }
  if (o.k === 'spl') {
    if (o.ctrl.length >= 4 && o.knots.length) return bspline(o.ctrl, o.knots, o.deg);
    return o.fit.length >= 4 ? o.fit : o.ctrl;
  }
  return null;
}

const ELEMENT_EXCLUDE = /quadrillage|[ée]tiquette|^etq|^niveau|cartouche|cotation|^texte|annotation|^coupe|fl[eè]che|symbole|^nord|cercle pmr|^env_|^det-|^\*|^a\$|zw\$|indice|pignon/i;
const ELEMENT_LAYER_EXCLUDE = /quadrillage|texte|annotation|cotation|niveaux|coupes|^axes|cartouche|defpoints/i;

/** Nom lisible d'un bloc Revit : « Famille - Type 140-123456-DCE - Vue » → « Type 140 » */
export function cleanBlockName(raw) {
  const tidy = (s) =>
    s.replace(/-(?:V\d+|\d{2,})-[A-Z]{2,4}$/i, '').replace(/-\d{5,}$/, '')
      .replace(/^(ASA|PRT|ENV|PIP|POU|POT)[_-]\s*/i, '').replace(/(\d)_(\d)/g, '$1,$2')
      .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = raw.split(' - ');
  if (parts.length < 2) return tidy(raw) || raw;
  const family = tidy(parts[0]);
  const type = tidy(parts.length >= 3 ? parts.slice(1, -1).join(' - ') : parts[1]);
  const fam = family.replace(/\d+$/, '').trim();
  const name = !type ? family : type.toLowerCase().includes(fam.toLowerCase()) ? type : `${family} ${type}`;
  return name || raw;
}
const viewSuffix = (raw) => {
  const parts = raw.split(' - ');
  if (parts.length < 3) return null;
  const s = parts[parts.length - 1].replace(/^[\w-]*\d{5,}-[A-Z]+\s*-?\s*/i, '').trim();
  return s && s.length <= 24 ? s : null;
};

/**
 * Prépare le dessin : aplatit les blocs, repère cotes et éléments, découpe en vues.
 * Renvoie { units, views:[{name, items, dims, els, bbox}], build(indices) → plan interactif }
 */
export function prepareDxf(st) {
  const u = UNIT_MM[st.insunits] ?? 1;
  const layerOff = (l) => st.layers.get(l)?.off || /^defpoints$/i.test(l);
  const items = [];

  const emit = (o, M, inherit, out, depth) => {
    const L = o.l === '0' && inherit ? inherit : o.l;
    if (layerOff(L)) return;
    if (o.k === 'txt') {
      if (!o.s) return;
      const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
      out.texts.push({
        l: L, x: M[0] * o.x + M[2] * o.y + M[4], y: M[1] * o.x + M[3] * o.y + M[5], h: o.h * sc,
        r: o.r + (Math.atan2(M[1], M[0]) * 180) / Math.PI, s: o.s, ah: o.ah, av: o.av,
      });
      return;
    }
    if (o.k === 'ins') {
      const b = st.blocks.get(o.name);
      if (!b || depth > 12 || b.flags & 4) return;
      for (let ci = 0; ci < o.cols; ci++) {
        for (let ri = 0; ri < o.rows; ri++) {
          const M2 = mul(M, insertMatrix(o.x + ci * o.cs, o.y + ri * o.rs, o.sx, o.sy, o.r, b.bx, b.by));
          for (const ch of b.ents) emit(ch, M2, L, out, depth + 1);
        }
      }
      return;
    }
    if (o.k === 'dim') {
      const b = st.blocks.get(o.name);
      if (b && b.ents.length) {
        for (const ch of b.ents) emit(ch, M, L, out, depth + 1);
      } else {
        out.polys.push({ l: L, p: [o.p13[0], o.p13[1], o.p14[0], o.p14[1]] });
      }
      return;
    }
    const pts = localPoints(o);
    if (!pts || pts.length < 4) return;
    const p = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      p[i] = M[0] * pts[i] + M[2] * pts[i + 1] + M[4];
      p[i + 1] = M[1] * pts[i] + M[3] * pts[i + 1] + M[5];
    }
    out.polys.push({ l: L, p });
  };

  for (const o of st.model) {
    if (layerOff(o.l)) continue;
    const it = { polys: [], texts: [], kind: null };
    emit(o, ID, null, it, 0);
    if (!it.polys.length && !it.texts.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pl of it.polys) {
      for (let i = 0; i < pl.p.length; i += 2) {
        const x = pl.p[i], y = pl.p[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    for (const t of it.texts) {
      const w = t.h * 0.6 * Math.min(40, t.s.length);
      if (t.x - w < x0) x0 = t.x - w; if (t.x + w > x1) x1 = t.x + w;
      if (t.y - t.h < y0) y0 = t.y - t.h; if (t.y + t.h > y1) y1 = t.y + t.h;
    }
    if (!Number.isFinite(x0)) continue;
    it.bb = [x0, y0, x1, y1];
    if (o.k === 'dim') {
      // Tout le dessin de la cote reste sur le calque de la cote (affichage en couleur, masquage par calque)
      for (const pl of it.polys) pl.l = o.l;
      for (const t of it.texts) t.l = o.l;
      const style = st.dimstyles.get(o.style);
      let shown = it.texts.find((t) => /\d/.test(t.s))?.s;
      if (!shown && o.meas != null) shown = String(Math.round(o.meas * (style?.lfac || 1) * 100) / 100);
      if (o.text && o.text !== '<>' && !o.text.includes('<>')) shown = decodeText(o.text, true);
      // Longueur réelle recalculée à partir des points de cote (plus fiable que la valeur stockée)
      let len = o.meas;
      if (o.dtype === 0 || o.dtype === 1) {
        const dx = o.p14[0] - o.p13[0];
        const dy = o.p14[1] - o.p13[1];
        if (o.dtype === 1) len = Math.hypot(dx, dy);
        else {
          const r = (o.rot * Math.PI) / 180;
          len = Math.abs(dx * Math.cos(r) + dy * Math.sin(r));
        }
      }
      it.kind = 'dim';
      it.dim = { h: o.h, l: o.l, v: len != null ? len * u : null, raw: o.meas, t: shown || '', tx: o.p11[0], ty: o.p11[1], forced: !!o.text && !o.text.includes('<>') && o.text !== '<>' };
    } else if (o.k === 'ins') {
      it.kind = 'ins';
      it.name = o.name;
      const b = st.blocks.get(o.name);
      if (!ELEMENT_EXCLUDE.test(o.name) && !ELEMENT_LAYER_EXCLUDE.test(o.l) && !(b && b.flags & 4)) {
        it.el = { h: o.h, raw: o.name, n: cleanBlockName(o.name), l: o.l };
      }
    }
    items.push(it);
  }

  /* --- Découpage en vues (îlots de dessin séparés par du vide) --- */
  // Emprise robuste : on ignore les objets égarés très loin du dessin
  const qs = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
  const xs = items.map((it) => (it.bb[0] + it.bb[2]) / 2).sort((a, b) => a - b);
  const ys = items.map((it) => (it.bb[1] + it.bb[3]) / 2).sort((a, b) => a - b);
  const rx0 = qs(xs, 0.005), rx1 = qs(xs, 0.995), ry0 = qs(ys, 0.005), ry1 = qs(ys, 0.995);
  const span = Math.max(rx1 - rx0, ry1 - ry0) || 1;
  const X0 = rx0 - span * 0.1, X1 = rx1 + span * 0.1, Y0 = ry0 - span * 0.1, Y1 = ry1 + span * 0.1;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const mx = (it.bb[0] + it.bb[2]) / 2, my = (it.bb[1] + it.bb[3]) / 2;
    if (mx < X0 || mx > X1 || my < Y0 || my > Y1) items.splice(i, 1);
    else it.bb = [Math.max(it.bb[0], X0), Math.max(it.bb[1], Y0), Math.min(it.bb[2], X1), Math.min(it.bb[3], Y1)];
  }
  const G = 300;
  const cell = Math.max(X1 - X0, Y1 - Y0) / G || 1;
  const gx = Math.ceil((X1 - X0) / cell) + 3;
  const gy = Math.ceil((Y1 - Y0) / cell) + 3;
  const grid = new Uint8Array(gx * gy);
  const cx = (x) => Math.min(gx - 1, Math.max(0, Math.floor((x - X0) / cell) + 1));
  const cy = (y) => Math.min(gy - 1, Math.max(0, Math.floor((y - Y0) / cell) + 1));
  for (const it of items) {
    const a = cx(it.bb[0]), b = cx(it.bb[2]), c = cy(it.bb[1]), d = cy(it.bb[3]);
    if ((b - a + 1) * (d - c + 1) > gx * gy * 0.25) continue; // très grand objet : ne relie pas les vues
    for (let y = c - 1; y <= d + 1; y++) for (let x = a - 1; x <= b + 1; x++) if (x >= 0 && y >= 0 && x < gx && y < gy) grid[y * gx + x] = 1;
  }
  const label = new Int32Array(gx * gy).fill(-1);
  let nLab = 0;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || label[i] >= 0) continue;
    const stack = [i];
    label[i] = nLab;
    while (stack.length) {
      const k = stack.pop();
      const x = k % gx, y = (k / gx) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue;
        const j = ny * gx + nx;
        if (grid[j] && label[j] < 0) { label[j] = nLab; stack.push(j); }
      }
    }
    nLab++;
  }
  const groups = new Map();
  for (const it of items) {
    const lab = label[cy((it.bb[1] + it.bb[3]) / 2) * gx + cx((it.bb[0] + it.bb[2]) / 2)];
    if (!groups.has(lab)) groups.set(lab, []);
    groups.get(lab).push(it);
  }
  let views = [...groups.values()].map((its) => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const it of its) { bb[0] = Math.min(bb[0], it.bb[0]); bb[1] = Math.min(bb[1], it.bb[1]); bb[2] = Math.max(bb[2], it.bb[2]); bb[3] = Math.max(bb[3], it.bb[3]); }
    return { items: its, bb };
  });
  // Les petits îlots isolés rejoignent la vue la plus proche
  const minItems = Math.max(5, items.length * 0.005);
  const big = views.filter((v) => v.items.length >= minItems);
  if (big.length) {
    for (const v of views) {
      if (big.includes(v)) continue;
      const c0 = [(v.bb[0] + v.bb[2]) / 2, (v.bb[1] + v.bb[3]) / 2];
      let best = big[0], bd = Infinity;
      for (const b of big) {
        const dx = Math.max(b.bb[0] - c0[0], 0, c0[0] - b.bb[2]);
        const dy = Math.max(b.bb[1] - c0[1], 0, c0[1] - b.bb[3]);
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = b; }
      }
      best.items.push(...v.items);
      best.bb = [Math.min(best.bb[0], v.bb[0]), Math.min(best.bb[1], v.bb[1]), Math.max(best.bb[2], v.bb[2]), Math.max(best.bb[3], v.bb[3])];
    }
    views = big;
  }
  views.sort((a, b) => a.bb[0] - b.bb[0] || b.bb[3] - a.bb[3]);
  views.forEach((v, i) => {
    const votes = new Map();
    for (const it of v.items) {
      const s = it.name && viewSuffix(it.name);
      if (s) votes.set(s, (votes.get(s) || 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    v.name = best && best[1] >= 2 ? best[0] : `Vue ${i + 1}`;
    v.dims = v.items.filter((it) => it.dim).length;
    v.els = v.items.filter((it) => it.el).length;
    v.wm = Math.round(((v.bb[2] - v.bb[0]) * u) / 1000);
    v.hm = Math.round(((v.bb[3] - v.bb[1]) * u) / 1000);
  });
  // Noms en double : on numérote
  const seen = new Map();
  for (const v of views) {
    const n = (seen.get(v.name) || 0) + 1;
    seen.set(v.name, n);
    if (n > 1) v.name = `${v.name} (${n})`;
  }

  return {
    units: u,
    views: views.map((v) => ({ name: v.name, count: v.items.length, dims: v.dims, els: v.els, wm: v.wm, hm: v.hm })),
    build(indices) {
      return { format: 'plan-vectoriel', version: 1, pages: indices.map((i) => buildPage(views[i], u)) };
    },
  };
}

function buildPage(view, u) {
  const m = Math.max(view.bb[2] - view.bb[0], view.bb[3] - view.bb[1]) * 0.03;
  const X0 = view.bb[0] - m;
  const Y1 = view.bb[3] + m;
  const tx = (x) => Math.round((x - X0) * u);
  const ty = (y) => Math.round((Y1 - y) * u);
  const layers = [];
  const li = new Map();
  const layerIndex = (n) => {
    if (!li.has(n)) { li.set(n, layers.length); layers.push({ n, p: [] }); }
    return li.get(n);
  };
  const texts = [];
  const dims = [];
  const els = [];
  const bbOut = (bb) => [tx(bb[0]), ty(bb[3]), tx(bb[2]), ty(bb[1])];
  for (const it of view.items) {
    for (const pl of it.polys) {
      const arr = [];
      let px = NaN, py = NaN;
      for (let i = 0; i < pl.p.length; i += 2) {
        const x = tx(pl.p[i]), y = ty(pl.p[i + 1]);
        if (x === px && y === py) continue;
        arr.push(x, y);
        px = x; py = y;
      }
      if (arr.length >= 4) layers[layerIndex(pl.l)].p.push(arr);
    }
    for (const t of it.texts) {
      texts.push([tx(t.x), ty(t.y), Math.round(t.h * u * 10) / 10, Math.round(t.r * 10) / 10, t.s, t.ah + t.av, layerIndex(t.l)]);
    }
    if (it.dim && it.dim.v != null) {
      dims.push({ h: it.dim.h, l: it.dim.l, v: Math.round(it.dim.v * 10) / 10, t: it.dim.t, f: it.dim.forced || undefined, tx: tx(it.dim.tx), ty: ty(it.dim.ty), bb: bbOut(it.bb) });
    }
    if (it.el) els.push({ ...it.el, bb: bbOut(it.bb) });
  }
  return {
    name: view.name,
    w: Math.round((view.bb[2] - view.bb[0] + 2 * m) * u),
    h: Math.round((view.bb[3] - view.bb[1] + 2 * m) * u),
    layers, texts, dims, els,
  };
}
