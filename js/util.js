export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function uid() {
  if (window.crypto && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* contexte non sécurisé */ }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// Accepte "2540", "2 540", "25,4"
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '' || s === '-' || s === '+') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function fmtNum(n) {
  if (n == null) return '—';
  const r = Math.round(n * 10) / 10;
  const [i, d] = Math.abs(r).toFixed(r % 1 ? 1 : 0).split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (r < 0 ? '-' : '') + ii + (d ? ',' + d : '');
}

export const fmtMm = (n) => (n == null ? '—' : fmtNum(n) + ' mm');
export const fmtEcart = (e) => (e == null ? '—' : (e > 0 ? '+' : '') + fmtNum(e) + ' mm');

export function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
}

export const STATUS = {
  non_conforme: { label: 'Non conforme', color: '#d64545' },
  a_reprendre: { label: 'À reprendre', color: '#dd6b20' },
  a_verifier: { label: 'À mesurer', color: '#718096' },
  a_controler: { label: 'À contrôler', color: '#718096' },
  observation: { label: 'Observation', color: '#2b6cb0' },
  conforme: { label: 'Conforme', color: '#1f9d55' },
  levee: { label: 'Levée', color: '#1f9d55' },
};

export const ecartOf = (p) =>
  p.type === 'cote' && p.theo != null && p.mesure != null ? Math.round((p.mesure - p.theo) * 10) / 10 : null;

export function pointStatus(p) {
  if (p.type === 'cote') {
    const e = ecartOf(p);
    if (e == null) return 'a_verifier';
    return Math.abs(e) <= (p.tol ?? 0) + 1e-9 ? 'conforme' : 'non_conforme';
  }
  if (p.type === 'element') return p.elStatus || 'a_controler';
  return p.remStatus || 'observation';
}

export const isProblem = (st) => st === 'non_conforme' || st === 'a_reprendre';
export const isTodo = (st) => st === 'a_verifier' || st === 'a_controler';

export const typeLabel = (p) => (p.type === 'cote' ? 'Contrôle de cote' : p.type === 'element' ? 'Élément' : 'Remarque');

export function isEmptyPoint(p, photoCount) {
  // Point lié à une cote / un élément du plan : vide tant que rien n'a été contrôlé
  if (p.ref) return (p.type === 'cote' ? p.mesure == null : !p.elStatus) && !p.comment && !photoCount;
  return !p.title && p.theo == null && p.mesure == null && !p.comment && !photoCount;
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

// Réduit une photo (le navigateur applique l'orientation EXIF)
export async function compressImage(blob, maxPx = 1600, quality = 0.8) {
  const img = await loadImage(blob);
  const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  c.width = c.height = 0;
  return out || blob;
}

export const safeFileName = (s) =>
  String(s || 'chantier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'chantier';

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
