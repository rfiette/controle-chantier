// Export CSV (Excel) et sauvegarde / restauration d'un chantier complet.
import * as db from './db.js';
import { uid, STATUS, pointStatus, ecartOf, fmtDate, blobToDataURL } from './util.js';

const num = (n) => (n == null ? '' : String(Math.round(n * 10) / 10).replace('.', ','));
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function buildCsv(project) {
  const plans = Object.fromEntries((await db.byIndex('plans', 'projectId', project.id)).map((p) => [p.id, p]));
  const points = (await db.byIndex('points', 'projectId', project.id)).sort((a, b) => a.num - b.num);
  const rows = [[
    'N°', 'Plan', 'Page', 'Type', 'Libellé / localisation', 'Cote plan (mm)', 'Cote mesurée (mm)', 'Écart (mm)',
    'Tolérance ± (mm)', 'Statut', 'Remarque', 'Photos', 'Créé le', 'Modifié le', 'Contrôleur',
  ]];
  for (const p of points) {
    const photos = await db.countByIndex('photos', 'pointId', p.id);
    const cote = p.type === 'cote';
    rows.push([
      p.num, plans[p.planId]?.name ?? '', p.page, cote ? 'Cote' : 'Remarque', p.title,
      cote ? num(p.theo) : '', cote ? num(p.mesure) : '', cote ? num(ecartOf(p)) : '', cote ? num(p.tol) : '',
      STATUS[pointStatus(p)].label, p.comment, photos, fmtDate(p.createdAt), fmtDate(p.updatedAt), p.author,
    ]);
  }
  // Point-virgule + BOM : ouverture directe dans Excel en français
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export async function exportBackup(projectId) {
  const project = await db.get('projects', projectId);
  const plans = [];
  for (const pl of await db.byIndex('plans', 'projectId', projectId)) {
    const f = await db.get('files', pl.fileId);
    plans.push({ ...pl, file: f ? await blobToDataURL(f.blob) : null });
  }
  const points = await db.byIndex('points', 'projectId', projectId);
  const photos = [];
  for (const ph of await db.byIndex('photos', 'projectId', projectId)) {
    const { blob, ...rest } = ph;
    photos.push({ ...rest, data: await blobToDataURL(blob) });
  }
  const data = { format: 'controle-chantier', version: 1, exportedAt: Date.now(), project, plans, points, photos };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

function dataURLToBlob(u) {
  const i = u.indexOf(',');
  const mime = /data:([^;,]+)/.exec(u.slice(0, i))?.[1] || 'application/octet-stream';
  const bin = atob(u.slice(i + 1));
  const arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return new Blob([arr], { type: mime });
}

/** Importe une sauvegarde comme nouveau chantier (nouveaux identifiants). Renvoie l'id du chantier. */
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'controle-chantier' || !data.project) throw new Error('Format inconnu');
  const ids = new Map();
  const nid = (old) => {
    if (!ids.has(old)) ids.set(old, uid());
    return ids.get(old);
  };
  const existing = await db.get('projects', data.project.id);
  const project = {
    ...data.project,
    id: nid(data.project.id),
    name: existing ? `${data.project.name} (copie importée)` : data.project.name,
    updatedAt: Date.now(),
  };
  for (const pl of data.plans || []) {
    if (!pl.file) continue;
    const fileId = uid();
    await db.put('files', { id: fileId, blob: dataURLToBlob(pl.file) });
    const { file: _f, ...rest } = pl;
    await db.put('plans', { ...rest, id: nid(pl.id), projectId: project.id, fileId });
  }
  await db.putMany('points', (data.points || []).filter((p) => ids.has(p.planId)).map((p) => ({ ...p, id: nid(p.id), projectId: project.id, planId: ids.get(p.planId) })));
  for (const ph of data.photos || []) {
    if (!ids.has(ph.pointId)) continue;
    const { data: d, ...rest } = ph;
    await db.put('photos', { ...rest, id: uid(), pointId: ids.get(ph.pointId), projectId: project.id, blob: dataURLToBlob(d) });
  }
  await db.put('projects', project);
  return project.id;
}
