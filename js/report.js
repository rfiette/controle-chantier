// Rapport PDF de contrôle (jsPDF) : synthèse, plans repérés, détail des points avec extrait de plan et photos.
import * as db from './db.js';
import { STATUS, pointStatus, ecartOf, fmtMm, fmtEcart, fmtNum, fmtDate, loadImage } from './util.js';
import { loadSource } from './viewer.js';

const M = 14; // marge (mm)
const ORDER = ['non_conforme', 'a_reprendre', 'a_verifier', 'observation', 'conforme', 'levee'];
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

// Les polices standard du PDF ne gèrent que l'alphabet latin (WinAnsi)
const clean = (s) =>
  String(s ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[−]/g, '-')
    .replace(/[^\n\x20-\xff]/g, (c) => (WINANSI_EXTRA.includes(c) ? c : ''));

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function drawMarker(ctx, x, y, r, color, label) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * (String(label).length > 2 ? 0.85 : 1.05))}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label), x, y + r * 0.05);
}

function canvasToJpeg(c, q = 0.82) {
  return { data: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
}

function overviewImage(src, pts, maxPx = 2200) {
  const k = Math.min(1, maxPx / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const r = Math.max(12, Math.max(c.width, c.height) * 0.012);
  for (const p of pts) drawMarker(ctx, p.x * c.width, p.y * c.height, r, STATUS[pointStatus(p)].color, p.num);
  const out = canvasToJpeg(c);
  c.width = c.height = 0;
  return out;
}

function cropImage(src, p) {
  const cw = Math.min(src.width, Math.round(Math.max(src.width, src.height) * 0.22));
  const ch = Math.min(src.height, Math.round(cw * 0.72));
  const px = p.x * src.width;
  const py = p.y * src.height;
  const x0 = Math.min(Math.max(0, px - cw / 2), src.width - cw);
  const y0 = Math.min(Math.max(0, py - ch / 2), src.height - ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
  const color = STATUS[pointStatus(p)].color;
  const r = cw * 0.035;
  const lx = px - x0;
  const ly = py - y0;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, cw * 0.005);
  ctx.beginPath();
  ctx.arc(lx, ly, r * 2.2, 0, Math.PI * 2);
  ctx.stroke();
  drawMarker(ctx, lx + r * 2.6, ly - r * 2.6, r, color, p.num);
  const out = canvasToJpeg(c);
  c.width = c.height = 0;
  return out;
}

async function photoImage(blob, maxPx = 1000) {
  const img = await loadImage(blob);
  const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = canvasToJpeg(c, 0.8);
  c.width = c.height = 0;
  return out;
}

export async function buildReport(project, { onProgress = () => {} } = {}) {
  const { jsPDF } = window.jspdf;
  const settings = await db.getSettings();
  const plans = (await db.byIndex('plans', 'projectId', project.id)).sort((a, b) => a.createdAt - b.createdAt);
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  const points = (await db.byIndex('points', 'projectId', project.id)).sort((a, b) => a.num - b.num);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p', compress: true });
  const pw = () => doc.internal.pageSize.getWidth();
  const ph = () => doc.internal.pageSize.getHeight();
  const text = (s, x, y, opt) => doc.text(clean(s), x, y, opt);
  const font = (size, style = 'normal', color = '#17212f') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...hexToRgb(color));
  };
  const fit = (s, w) => {
    let t = clean(s);
    if (doc.getTextWidth(t) <= w) return t;
    while (t.length > 1 && doc.getTextWidth(t + '…') > w) t = t.slice(0, -1);
    return t + '…';
  };
  const chip = (label, x, y, color, size = 8) => {
    font(size, 'bold', '#ffffff');
    const w = doc.getTextWidth(clean(label)) + 4;
    doc.setFillColor(...hexToRgb(color));
    doc.roundedRect(x, y - size * 0.29, w, size * 0.48, 1, 1, 'F');
    text(label, x + 2, y + size * 0.06);
    return w;
  };

  /* ---- Page de garde + synthèse ---- */
  let y = M + 4;
  doc.setFillColor(31, 58, 95);
  doc.rect(0, 0, pw(), 30, 'F');
  font(18, 'bold', '#ffffff');
  text('Rapport de contrôle', M, 14);
  font(11, 'normal', '#ffffff');
  text(fit(project.name, pw() - 2 * M), M, 22);
  y = 40;
  font(10);
  const info = [
    ['Adresse', project.address],
    ["Maître d'ouvrage / entreprise", project.client],
    ['Date du rapport', fmtDate(Date.now(), false)],
    ['Contrôleur', settings.author],
  ].filter(([, v]) => v);
  for (const [k, v] of info) {
    font(9, 'normal', '#5b6878');
    text(k, M, y);
    font(10, 'bold');
    text(fit(v, pw() - 2 * M - 55), M + 55, y);
    y += 6;
  }

  y += 4;
  font(12, 'bold');
  text('Synthèse', M, y);
  y += 7;
  const counts = {};
  for (const p of points) counts[pointStatus(p)] = (counts[pointStatus(p)] || 0) + 1;
  let x = M;
  font(9, 'normal');
  text(`${points.length} point(s) de contrôle sur ${plans.filter((pl) => points.some((p) => p.planId === pl.id)).length} plan(s)`, M, y);
  y += 6;
  for (const k of ORDER) {
    if (!counts[k]) continue;
    const w = chip(`${STATUS[k].label} : ${counts[k]}`, x, y, STATUS[k].color, 9);
    x += w + 3;
    if (x > pw() - M - 40) { x = M; y += 7; }
  }
  y += 10;

  // Tableau récapitulatif
  const cols = [
    ['N°', 10], ['Libellé / localisation', 58], ['Plan', 32], ['Plan (mm)', 18], ['Mesuré', 18], ['Écart', 18], ['Statut', 28],
  ];
  const header = () => {
    doc.setFillColor(238, 241, 245);
    doc.rect(M, y - 4.2, pw() - 2 * M, 6.2, 'F');
    font(8, 'bold', '#5b6878');
    let cx = M + 1.5;
    for (const [l, w] of cols) { text(l, cx, y); cx += w; }
    y += 6;
  };
  header();
  for (const p of points) {
    if (y > ph() - M - 10) {
      doc.addPage('a4', 'p');
      y = M + 6;
      header();
    }
    const st = pointStatus(p);
    const cote = p.type === 'cote';
    const pl = planById[p.planId];
    const vals = [
      String(p.num),
      p.title || (cote ? 'Cote' : 'Remarque'),
      (pl?.name || '') + (pl?.pageCount > 1 ? ` p.${p.page}` : ''),
      cote ? fmtNum(p.theo) : '',
      cote ? fmtNum(p.mesure) : '',
      cote && ecartOf(p) != null ? fmtEcart(ecartOf(p)) : '',
    ];
    let cx = M + 1.5;
    font(8.5, 'normal');
    vals.forEach((v, i) => {
      if (i === 0) font(8.5, 'bold');
      else font(8.5, 'normal');
      text(fit(v, cols[i][1] - 2), cx, y);
      cx += cols[i][1];
    });
    font(8.5, 'bold', STATUS[st].color);
    text(fit(STATUS[st].label, cols[6][1] - 1), cx, y);
    doc.setDrawColor(225, 230, 236);
    doc.setLineWidth(0.2);
    doc.line(M, y + 2, pw() - M, y + 2);
    y += 6;
  }

  /* ---- Plans repérés (+ extraits pour le détail) ---- */
  const crops = new Map();
  let idx = 0;
  for (const pl of plans) {
    const pts = points.filter((p) => p.planId === pl.id);
    if (!pts.length) continue;
    idx++;
    onProgress(`Plan ${idx} : ${pl.name}…`);
    const f = await db.get('files', pl.fileId);
    const src = await loadSource(f.blob, pl.kind);
    const pages = [...new Set(pts.map((p) => p.page))].sort((a, b) => a - b);
    for (const pg of pages) {
      const { canvas } = await src.render(pg, 3200);
      const pgPts = pts.filter((p) => p.page === pg);
      const ov = overviewImage(canvas, pgPts);
      for (const p of pgPts) crops.set(p.id, cropImage(canvas, p));
      canvas.width = canvas.height = 0;

      doc.addPage('a4', ov.w > ov.h ? 'l' : 'p');
      font(12, 'bold');
      text(fit(`Plan : ${pl.name}${pl.pageCount > 1 ? ` (page ${pg})` : ''}`, pw() - 2 * M), M, M + 2);
      font(8.5, 'normal', '#5b6878');
      text(`${pgPts.length} point(s) – les numéros renvoient au détail ci-après`, M, M + 7);
      const boxW = pw() - 2 * M;
      const boxH = ph() - 2 * M - 12;
      const k = Math.min(boxW / ov.w, boxH / ov.h);
      const iw = ov.w * k;
      const ih = ov.h * k;
      doc.addImage(ov.data, 'JPEG', M + (boxW - iw) / 2, M + 11, iw, ih);
      doc.setDrawColor(200, 206, 214);
      doc.rect(M + (boxW - iw) / 2, M + 11, iw, ih);
    }
    src.destroy();
  }

  /* ---- Détail des points ---- */
  doc.addPage('a4', 'p');
  y = M + 4;
  font(14, 'bold');
  text('Détail des points de contrôle', M, y);
  y += 9;
  const ensure = (h) => {
    if (y + h > ph() - M - 6) {
      doc.addPage('a4', 'p');
      y = M + 4;
    }
  };
  const IMG_W = (pw() - 2 * M - 2 * 4) / 3;
  const IMG_H = 46;

  let n = 0;
  for (const p of points) {
    n++;
    onProgress(`Point ${n} / ${points.length}…`);
    const st = pointStatus(p);
    const S = STATUS[st];
    const cote = p.type === 'cote';
    const pl = planById[p.planId];
    font(9.5);
    const commentLines = p.comment ? doc.splitTextToSize(clean(p.comment), pw() - 2 * M) : [];
    ensure(16 + (cote ? 6 : 0) + Math.min(commentLines.length, 6) * 4.6 + 10);

    // En-tête du point
    doc.setFillColor(...hexToRgb(S.color));
    doc.roundedRect(M, y - 4.6, 11, 6.6, 1.2, 1.2, 'F');
    font(10, 'bold', '#ffffff');
    text(String(p.num), M + 5.5, y, { align: 'center' });
    font(11, 'bold');
    text(fit(p.title || (cote ? 'Contrôle de cote' : 'Remarque'), pw() - 2 * M - 52), M + 14, y);
    font(8, 'bold');
    const lw = doc.getTextWidth(clean(S.label)) + 4;
    chip(S.label, pw() - M - lw, y - 1, S.color, 8);
    y += 5.5;
    font(8.5, 'normal', '#5b6878');
    text(fit(`${cote ? 'Contrôle de cote' : 'Remarque'} · Plan : ${pl?.name || ''}${pl?.pageCount > 1 ? ` p.${p.page}` : ''} · ${fmtDate(p.createdAt)}${p.author ? ' · ' + p.author : ''}`, pw() - 2 * M), M + 14, y);
    y += 6;

    if (cote) {
      const e = ecartOf(p);
      const parts = [
        ['Cote plan', fmtMm(p.theo)],
        ['Cote mesurée', fmtMm(p.mesure)],
        ['Écart', e == null ? '—' : fmtEcart(e)],
        ['Tolérance', p.tol != null ? `± ${fmtNum(p.tol)} mm` : '—'],
      ];
      let cx = M;
      for (const [k2, v] of parts) {
        font(8, 'normal', '#5b6878');
        text(k2, cx, y);
        font(10, 'bold', k2 === 'Écart' && e != null ? S.color : '#17212f');
        text(v, cx, y + 4.6);
        cx += (pw() - 2 * M) / 4;
      }
      y += 10;
    }

    if (commentLines.length) {
      font(9.5);
      for (const line of commentLines) {
        ensure(5);
        text(line, M, y);
        y += 4.6;
      }
      y += 1.5;
    }

    // Extrait du plan + photos
    const imgs = [];
    if (crops.has(p.id)) imgs.push(crops.get(p.id));
    const photos = (await db.byIndex('photos', 'pointId', p.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const phRec of photos) {
      try {
        imgs.push(await photoImage(phRec.blob));
      } catch { /* photo illisible ignorée */ }
    }
    for (let i = 0; i < imgs.length; i += 3) {
      ensure(IMG_H + 3);
      imgs.slice(i, i + 3).forEach((im, j) => {
        const k = Math.min(IMG_W / im.w, IMG_H / im.h);
        const w = im.w * k;
        const h = im.h * k;
        const ix = M + j * (IMG_W + 4);
        doc.addImage(im.data, 'JPEG', ix, y, w, h);
        doc.setDrawColor(200, 206, 214);
        doc.setLineWidth(0.2);
        doc.rect(ix, y, w, h);
      });
      y += IMG_H + 3;
    }

    y += 2;
    doc.setDrawColor(210, 216, 224);
    doc.setLineWidth(0.3);
    doc.line(M, y, pw() - M, y);
    y += 8;
  }

  /* ---- Pied de page ---- */
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    font(7.5, 'normal', '#8a94a3');
    text(fit(`${project.name} – Rapport du ${fmtDate(Date.now(), false)}`, pw() / 2), M, ph() - 7);
    text(`Page ${i} / ${total}`, pw() - M, ph() - 7, { align: 'right' });
  }

  onProgress('Finalisation…');
  return doc.output('blob');
}
