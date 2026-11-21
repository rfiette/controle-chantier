import * as db from './db.js';
import {
  esc, uid, STATUS, pointStatus, parseNum, fmtNum, fmtMm, fmtEcart, fmtDate, ecartOf, isEmptyPoint, isProblem, isTodo,
  typeLabel, compressImage, safeFileName, today,
} from './util.js';
import { ICON, toast, modal, confirmDialog, formDialog, loading, shareOrDownload, pickFiles } from './ui.js';
import { PlanViewer, VectorViewer, loadSource, makeThumbnail } from './viewer.js';
import { buildCsv, exportBackup, importBackup } from './export.js';

window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const app = document.getElementById('app');
let cleanup = null;

/* ---------------- Routeur ---------------- */

async function route() {
  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    await c();
  }
  app.onclick = app.oninput = app.onchange = null;
  const hash = location.hash || '#/';
  let m;
  try {
    if ((m = hash.match(/^#\/p\/([^/?]+)$/))) return await viewProject(m[1]);
    if ((m = hash.match(/^#\/plan\/([^/?]+)(?:\?pt=(.+))?$/))) return await viewPlan(m[1], m[2]);
    return await viewHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main class="page"><div class="empty"><h2>Erreur</h2><p>${esc(err.message || err)}</p>
      <a class="btn primary" href="#/">Retour à l'accueil</a></div></main>`;
  }
}
window.addEventListener('hashchange', route);

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

/* ---------------- Accueil ---------------- */

async function viewHome() {
  const projects = (await db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  const points = await db.all('points');
  const stats = (id) => {
    const ps = points.filter((p) => p.projectId === id);
    return { n: ps.length, pb: ps.filter((p) => isProblem(pointStatus(p))).length, todo: ps.filter((p) => isTodo(pointStatus(p))).length };
  };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const hideTip = localStorageGet('hideInstallTip');

  document.title = 'Contrôle chantier';
  app.innerHTML = `
    <header class="topbar">
      <div class="title"><div class="t1">Contrôle chantier</div></div>
      <button class="icon-btn" data-act="settings" aria-label="Réglages">${ICON.gear}</button>
    </header>
    <main class="page">
      ${!standalone && !hideTip ? `<div class="tip">
        <div><strong>Installer l'app :</strong> sur iPad/iPhone, bouton <em>Partager</em> → <em>Sur l'écran d'accueil</em>.
        Sur Android, menu ⋮ → <em>Installer l'application</em>. Elle fonctionnera ensuite hors connexion.</div>
        <button class="icon-btn" data-act="hide-tip" aria-label="Masquer">${ICON.close}</button></div>` : ''}
      <div class="row-between">
        <h1>Chantiers</h1>
        <div class="row">
          <button class="btn" data-act="import">Importer une sauvegarde</button>
          <button class="btn primary" data-act="new">${ICON.plus} Nouveau chantier</button>
        </div>
      </div>
      ${projects.length
        ? `<div class="cards">${projects.map((p) => {
            const s = stats(p.id);
            return `<a class="card project-card" href="#/p/${p.id}">
              <div class="card-title">${esc(p.name)}</div>
              ${p.address ? `<div class="muted">${esc(p.address)}</div>` : ''}
              <div class="chips">
                <span class="chip">${s.n} point${s.n > 1 ? 's' : ''}</span>
                ${s.pb ? `<span class="chip" style="--c:${STATUS.non_conforme.color}">${s.pb} à traiter</span>` : ''}
                ${s.todo ? `<span class="chip" style="--c:${STATUS.a_verifier.color}">${s.todo} à contrôler</span>` : ''}
              </div>
              <div class="muted small">Modifié le ${fmtDate(p.updatedAt)}</div>
            </a>`;
          }).join('')}</div>`
        : `<div class="empty">
            <h2>Aucun chantier</h2>
            <p>Créez un chantier, ajoutez vos plans PDF, puis placez vos points de contrôle directement sur le plan.</p>
            <button class="btn primary" data-act="new">${ICON.plus} Créer un chantier</button>
          </div>`}
    </main>`;

  app.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') {
      const v = await formDialog('Nouveau chantier', [
        { name: 'name', label: 'Nom du chantier', required: true, placeholder: 'ex : Résidence Les Tilleuls – Bât. A' },
        { name: 'address', label: 'Adresse', placeholder: 'Adresse du chantier' },
        { name: 'client', label: "Maître d'ouvrage / entreprise", placeholder: 'Optionnel' },
      ], 'Créer');
      if (!v) return;
      const now = Date.now();
      const p = { id: uid(), ...v, createdAt: now, updatedAt: now };
      await db.put('projects', p);
      navigator.storage?.persist?.().catch(() => {});
      go(`#/p/${p.id}`);
    } else if (act === 'settings') {
      await openSettings();
    } else if (act === 'import') {
      const [file] = await pickFiles({ accept: '.json,application/json' });
      if (!file) return;
      const l = loading('Import de la sauvegarde…');
      try {
        const id = await importBackup(file);
        l.close();
        toast('Chantier importé');
        go(`#/p/${id}`);
      } catch (err) {
        l.close();
        console.error(err);
        toast('Fichier de sauvegarde invalide');
      }
    } else if (act === 'hide-tip') {
      localStorageSet('hideInstallTip', '1');
      route();
    }
  };
}

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

async function openSettings() {
  const s = await db.getSettings();
  let usage = '';
  try {
    const est = await navigator.storage.estimate();
    usage = `${(est.usage / 1048576).toFixed(1)} Mo utilisés`;
  } catch { /* indisponible */ }
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const form = document.createElement('form');
  form.className = 'form';
  form.innerHTML = `
    <label class="field"><span>Nom du contrôleur (apparaît dans les rapports)</span>
      <input name="author" value="${esc(s.author)}" placeholder="Prénom Nom" autocomplete="off"></label>
    <label class="field"><span>Tolérance par défaut ± (mm)</span>
      <input name="tol" value="${esc(fmtNum(s.tol))}" inputmode="decimal"></label>
    <p class="muted small">Les données sont enregistrées uniquement sur cet appareil${usage ? ` (${usage})` : ''}.
    ${persisted ? 'Stockage protégé contre l\'effacement automatique.' : ''}
    Pensez à faire des sauvegardes (bouton « Sauvegarde » dans chaque chantier).</p>
    <button type="submit" hidden></button>`;
  const ok = await modal({
    title: 'Réglages',
    body: form,
    actions: [{ label: 'Annuler', value: false }, { label: 'Enregistrer', value: true, kind: 'primary' }],
  });
  if (!ok) return;
  await db.saveSettings({ ...s, author: form.elements.author.value.trim(), tol: parseNum(form.elements.tol.value) ?? s.tol });
  toast('Réglages enregistrés');
}

/* ---------------- Chantier ---------------- */

const FILTERS = [
  ['all', 'Tous'],
  ['pb', 'À traiter'],
  ['todo', 'À contrôler'],
  ['obs', 'Observations'],
  ['ok', 'Conformes / levés'],
];
const matchFilter = (f, st) =>
  f === 'all' ||
  (f === 'pb' && isProblem(st)) ||
  (f === 'todo' && isTodo(st)) ||
  (f === 'obs' && st === 'observation') ||
  (f === 'ok' && (st === 'conforme' || st === 'levee'));

let projectFilter = 'all';

async function viewProject(id) {
  const project = await db.get('projects', id);
  if (!project) return go('#/');
  const plans = (await db.byIndex('plans', 'projectId', id)).sort((a, b) => a.createdAt - b.createdAt);
  const points = (await db.byIndex('points', 'projectId', id)).sort((a, b) => b.num - a.num);
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  document.title = project.name;

  const counts = {};
  for (const p of points) {
    const st = pointStatus(p);
    counts[st] = (counts[st] || 0) + 1;
  }

  const render = () => {
    const list = points.filter((p) => matchFilter(projectFilter, pointStatus(p)));
    app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Retour">${ICON.back}</a>
      <div class="title"><div class="t1">${esc(project.name)}</div>${project.address ? `<div class="t2">${esc(project.address)}</div>` : ''}</div>
      <button class="icon-btn" data-act="edit" aria-label="Modifier le chantier">${ICON.edit}</button>
    </header>
    <main class="page">
      <section class="stats">
        <div class="stat"><b>${points.length}</b><span>points</span></div>
        ${['non_conforme', 'a_reprendre', 'a_verifier', 'a_controler', 'observation', 'conforme', 'levee']
          .filter((k) => counts[k])
          .map((k) => `<div class="stat" style="--c:${STATUS[k].color}"><b>${counts[k]}</b><span>${STATUS[k].label}</span></div>`)
          .join('')}
      </section>

      <section class="toolbar">
        <button class="btn primary" data-act="report" ${points.length ? '' : 'disabled'}>Rapport PDF</button>
        <button class="btn" data-act="csv" ${points.length ? '' : 'disabled'}>Export Excel (CSV)</button>
        <button class="btn" data-act="backup">Sauvegarde</button>
      </section>

      <div class="row-between"><h2>Plans</h2><button class="btn" data-act="add-plan">${ICON.plus} Ajouter un plan</button></div>
      ${plans.length
        ? `<div class="plans">${plans.map((pl) => {
            const n = points.filter((p) => p.planId === pl.id).length;
            return `<div class="card plan-card">
              <a href="#/plan/${pl.id}" class="plan-thumb">${pl.thumb ? `<img src="${pl.thumb}" alt="">` : ''}</a>
              <div class="plan-info">
                <a href="#/plan/${pl.id}" class="card-title">${esc(pl.name)}</a>
                <div class="muted small">${n} point${n > 1 ? 's' : ''}${pl.pageCount > 1 ? ` · ${pl.pageCount} pages` : ''}</div>
              </div>
              <button class="icon-btn" data-act="plan-menu" data-plan="${pl.id}" aria-label="Options du plan">${ICON.more}</button>
            </div>`;
          }).join('')}</div>`
        : `<div class="empty small-empty"><p>Ajoutez un plan (PDF ou photo) pour commencer à placer des points de contrôle.</p>
            <button class="btn primary" data-act="add-plan">${ICON.plus} Ajouter un plan</button></div>`}

      ${points.length ? `
      <div class="row-between"><h2>Points de contrôle</h2></div>
      <div class="filters">${FILTERS.map(([k, l]) => `<button class="filter${projectFilter === k ? ' on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      <div class="pt-list">
        ${list.length ? list.map((p) => pointRow(p, planById[p.planId])).join('') : '<p class="muted">Aucun point pour ce filtre.</p>'}
      </div>` : ''}
    </main>`;
  };
  render();

  app.onclick = async (e) => {
    const el = e.target.closest('[data-act],[data-filter],[data-pt]');
    if (!el) return;
    if (el.dataset.filter) {
      projectFilter = el.dataset.filter;
      render();
      return;
    }
    if (el.dataset.pt) {
      go(`#/plan/${el.dataset.plan}?pt=${el.dataset.pt}`);
      return;
    }
    const act = el.dataset.act;
    if (act === 'edit') {
      const v = await modal({
        title: 'Chantier',
        body: (() => {
          const f = document.createElement('div');
          f.innerHTML = '<p>Que voulez-vous faire ?</p>';
          return f;
        })(),
        actions: [
          { label: 'Supprimer le chantier', value: 'delete', kind: 'danger' },
          { label: 'Annuler', value: null },
          { label: 'Modifier', value: 'edit', kind: 'primary' },
        ],
      });
      if (v === 'edit') {
        const r = await formDialog('Modifier le chantier', [
          { name: 'name', label: 'Nom du chantier', required: true, value: project.name },
          { name: 'address', label: 'Adresse', value: project.address },
          { name: 'client', label: "Maître d'ouvrage / entreprise", value: project.client },
        ]);
        if (!r) return;
        Object.assign(project, r, { updatedAt: Date.now() });
        await db.put('projects', project);
        route();
      } else if (v === 'delete') {
        const ok = await confirmDialog('Supprimer le chantier ?', `« ${project.name} », ses plans, ses points et ses photos seront définitivement supprimés de cet appareil.`, 'Supprimer', true);
        if (!ok) return;
        await db.deleteProject(project.id);
        toast('Chantier supprimé');
        go('#/');
      }
    } else if (act === 'add-plan') {
      const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*,.dxf', multiple: true });
      if (!files.length) return;
      const l = loading('Import du plan…');
      let ok = 0;
      for (const f of files) {
        try {
          l.set(`Import de ${f.name}…`);
          if (await importPlan(project, f, (m) => l.set(m))) ok++;
        } catch (err) {
          console.error(err);
          toast(`Impossible de lire ${f.name}`);
        }
      }
      l.close();
      if (ok) {
        await db.touchProject(project.id);
        route();
      }
    } else if (act === 'plan-menu') {
      const plan = planById[el.dataset.plan];
      const v = await modal({
        title: plan.name,
        body: '',
        actions: [
          { label: 'Supprimer', value: 'delete', kind: 'danger' },
          { label: 'Annuler', value: null },
          { label: 'Renommer', value: 'rename', kind: 'primary' },
        ],
      });
      if (v === 'rename') {
        const r = await formDialog('Renommer le plan', [{ name: 'name', label: 'Nom du plan', required: true, value: plan.name }]);
        if (!r) return;
        plan.name = r.name;
        await db.put('plans', plan);
        route();
      } else if (v === 'delete') {
        const n = points.filter((p) => p.planId === plan.id).length;
        const ok = await confirmDialog('Supprimer le plan ?', `Le plan « ${plan.name} »${n ? ` et ses ${n} point(s) de contrôle` : ''} seront définitivement supprimés.`, 'Supprimer', true);
        if (!ok) return;
        await db.deletePlan(plan);
        route();
      }
    } else if (act === 'report') {
      const l = loading('Préparation du rapport…');
      try {
        const { buildReport } = await import('./report.js');
        const blob = await buildReport(project, { onProgress: (m) => l.set(m) });
        l.close();
        await shareOrDownload(blob, `Rapport_${safeFileName(project.name)}_${today()}.pdf`);
      } catch (err) {
        l.close();
        console.error(err);
        toast('Erreur pendant la création du rapport');
      }
    } else if (act === 'csv') {
      const blob = await buildCsv(project);
      await shareOrDownload(blob, `Controles_${safeFileName(project.name)}_${today()}.csv`);
    } else if (act === 'backup') {
      const l = loading('Création de la sauvegarde…');
      try {
        const blob = await exportBackup(project.id);
        l.close();
        await shareOrDownload(blob, `Sauvegarde_${safeFileName(project.name)}_${today()}.json`);
      } catch (err) {
        l.close();
        console.error(err);
        toast('Erreur pendant la sauvegarde');
      }
    }
  };
}

function pointRow(p, plan) {
  const st = pointStatus(p);
  const S = STATUS[st];
  let detail = '';
  if (p.type === 'cote') {
    detail = `Plan ${fmtMm(p.theo)} · Mesuré ${fmtMm(p.mesure)}${ecartOf(p) != null ? ` · Écart ${fmtEcart(ecartOf(p))}` : ''}`;
  }
  if (p.type === 'element' && p.elLayer) detail = esc(p.elLayer);
  const comment = p.comment ? `<div class="pt-comment">${esc(p.comment)}</div>` : '';
  return `<button class="pt-row" data-pt="${p.id}" data-plan="${p.planId}">
    <span class="badge" style="background:${S.color}">${p.num}</span>
    <span class="pt-main">
      <span class="pt-title">${esc(p.title || typeLabel(p))}</span>
      <span class="pt-sub muted small">${typeLabel(p)} · ${esc(plan?.name || '')}${plan?.pageCount > 1 ? ` · ${esc(plan.pageNames?.[p.page - 1] || 'p.' + p.page)}` : ''}${detail ? ' · ' + detail : ''}</span>
      ${comment}
    </span>
    <span class="status" style="--c:${S.color}">${S.label}</span>
  </button>`;
}

async function importPlan(project, f, progress = () => {}) {
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isDxf = /\.dxf$/i.test(f.name);
  let kind = isPdf ? 'pdf' : 'image';
  let blob;
  let pageNames;
  if (isDxf) {
    kind = 'vector';
    const { parseDxfFile, prepareDxf } = await import('./dxf.js');
    const st = await parseDxfFile(f, (r) => progress(`Lecture de ${f.name}… ${Math.round(r * 100)} %`));
    progress('Analyse des cotes et des éléments…');
    await new Promise((r) => setTimeout(r, 30));
    const prep = prepareDxf(st);
    if (!prep.views.length) throw new Error('DXF vide');
    let sel = prep.views.map((_, i) => i);
    if (prep.views.length > 1) {
      sel = await chooseViews(f.name, prep.views);
      if (!sel || !sel.length) return false;
    }
    const plan = prep.build(sel);
    pageNames = plan.pages.map((p) => p.name);
    blob = new Blob([JSON.stringify(plan)], { type: 'application/json' });
  } else {
    // Copie en mémoire (les fichiers choisis sur iPad peuvent devenir inaccessibles ensuite)
    blob = new Blob([await f.arrayBuffer()], { type: f.type || (isPdf ? 'application/pdf' : 'image/jpeg') });
  }
  const src = await loadSource(blob, kind);
  const thumb = await makeThumbnail(src);
  const pageCount = src.pageCount;
  src.destroy();
  const fileId = uid();
  await db.put('files', { id: fileId, blob });
  await db.put('plans', {
    id: uid(), projectId: project.id, name: f.name.replace(/\.[^.]+$/, ''), kind, fileId, pageCount, pageNames, thumb, createdAt: Date.now(),
  });
  return true;
}

/** Choix des vues à garder dans un DXF (plans de niveaux, façades, coupes…) */
function chooseViews(fileName, views) {
  const box = document.createElement('div');
  box.className = 'view-choice';
  box.innerHTML = `<p class="muted small">Le fichier ${esc(fileName)} contient plusieurs vues. Chaque vue choisie devient une page du plan.</p>
    ${views.map((v, i) => `<label class="check-row"><input type="checkbox" value="${i}" ${v.dims || v.els ? 'checked' : ''}>
      <span><strong>${esc(v.name)}</strong><span class="muted small"> · ${v.wm} × ${v.hm} m · ${v.dims} cotes · ${v.els} éléments</span></span></label>`).join('')}`;
  return modal({
    title: 'Vues à importer',
    body: box,
    actions: [
      { label: 'Annuler', value: null },
      { label: 'Importer', kind: 'primary', value: () => [...box.querySelectorAll('input:checked')].map((c) => +c.value) },
    ],
  });
}

/* ---------------- Plan + points ---------------- */

async function viewPlan(planId, focusPointId) {
  const plan = await db.get('plans', planId);
  if (!plan) return go('#/');
  const project = await db.get('projects', plan.projectId);
  const file = await db.get('files', plan.fileId);
  const settings = await db.getSettings();
  let points = await db.byIndex('points', 'planId', planId);
  document.title = plan.name;

  app.innerHTML = `
  <div class="view-plan">
    <header class="topbar">
      <a class="icon-btn" href="#/p/${project.id}" aria-label="Retour">${ICON.back}</a>
      <div class="title"><div class="t1">${esc(plan.name)}</div><div class="t2">${esc(project.name)}</div></div>
      <div class="pager" ${plan.pageCount > 1 ? '' : 'hidden'}>
        <button class="icon-btn" data-act="prev" aria-label="Page précédente">‹</button>
        <span class="pager-label"></span>
        <button class="icon-btn" data-act="next" aria-label="Page suivante">›</button>
      </div>
      ${plan.kind === 'vector' ? `<button class="icon-btn" data-act="layers" aria-label="Calques">${ICON.layers}</button>` : ''}
      <button class="btn primary add-btn" data-act="add">${ICON.plus}<span>Point</span></button>
    </header>
    <div class="plan-body">
      <div class="viewer-host"><div class="viewer-loading"><div class="spinner"></div></div></div>
      <div class="zoom-ctrls">
        <button class="icon-btn" data-act="zoom-in" aria-label="Zoom avant">+</button>
        <button class="icon-btn" data-act="zoom-out" aria-label="Zoom arrière">−</button>
        <button class="icon-btn" data-act="fit" aria-label="Voir tout le plan">${ICON.fit}</button>
      </div>
      <div class="hint" hidden><span class="hint-text"></span><button class="btn small" data-act="cancel-mode">Annuler</button></div>
      <aside class="sheet" hidden></aside>
    </div>
  </div>`;

  const host = app.querySelector('.viewer-host');
  const sheet = app.querySelector('.sheet');
  const hint = app.querySelector('.hint');
  const addBtn = app.querySelector('[data-act="add"]');

  let page = 1;
  let lastType = 'cote'; // type du dernier point créé
  let mode = 'view'; // view | add | move
  let current = null; // point ouvert
  let currentPhotos = [];
  let saveTimer = 0;
  let photoUrls = [];
  const isVector = plan.kind === 'vector';
  let objIndex = new Map(); // identifiant DXF → cote / élément de la page
  const layersKey = `layers:${plan.id}`;

  const Viewer = isVector ? VectorViewer : PlanViewer;
  const viewer = new Viewer(host, {
    onTap: (x, y, inside) => onPlanTap(x, y, inside),
    onPinTap: (id) => {
      if (mode !== 'view') return;
      const p = points.find((q) => q.id === id);
      if (p) openPoint(p);
    },
  });

  const sheetInsets = () => {
    if (sheet.hidden) return {};
    const wide = matchMedia('(min-width: 900px)').matches;
    return wide ? { insetRight: sheet.offsetWidth } : { insetBottom: sheet.offsetHeight };
  };

  const refreshPins = () => {
    const onPage = points.filter((p) => p.page === page);
    // Sur un plan vectoriel, les points liés à une cote / un élément sont dessinés sur l'objet lui-même
    const linked = (p) => isVector && p.ref && objIndex.has(p.ref.h);
    viewer.setPins(
      onPage.filter((p) => !linked(p)).map((p) => ({ id: p.id, x: p.x, y: p.y, num: p.num, color: STATUS[pointStatus(p)].color })),
      current?.id
    );
    if (isVector) {
      viewer.setMarks(
        onPage.filter(linked).map((p) => ({ bb: objIndex.get(p.ref.h).bb, color: STATUS[pointStatus(p)].color, num: p.num })),
        current?.ref ? objIndex.get(current.ref.h)?.bb || null : null
      );
    }
  };

  const setMode = (m) => {
    mode = m;
    viewer.noDoubleTap = m !== 'view';
    host.classList.toggle('placing', m !== 'view');
    addBtn.classList.toggle('active', m === 'add');
    hint.hidden = m === 'view';
    hint.querySelector('.hint-text').textContent =
      m === 'add' ? 'Touchez le plan à l\'endroit du point de contrôle' : m === 'move' ? 'Touchez le nouvel emplacement du point' : '';
  };

  const showPage = async (n) => {
    await closePoint();
    page = n;
    const pname = plan.pageNames?.[n - 1];
    app.querySelector('.pager-label').textContent = pname ? `${pname} (${n}/${plan.pageCount})` : `${n} / ${plan.pageCount}`;
    await viewer.showPage(n);
    if (isVector) {
      objIndex = new Map();
      for (const d of viewer.pg.dims) objIndex.set(d.h, d);
      for (const e of viewer.pg.els) objIndex.set(e.h, e);
      try {
        viewer.setHiddenLayers(new Set(JSON.parse(localStorageGet(layersKey) || '[]')));
      } catch { /* ignore */ }
    }
    refreshPins();
  };

  try {
    const src = await loadSource(file.blob, plan.kind);
    await viewer.open(src);
    const focusPt = focusPointId && points.find((p) => p.id === focusPointId);
    await showPage(focusPt ? focusPt.page : 1);
    host.querySelector('.viewer-loading')?.remove();
    if (focusPt) openPoint(focusPt, true);
  } catch (err) {
    console.error(err);
    host.innerHTML = '<div class="empty"><p>Impossible d\'afficher ce plan.</p></div>';
  }

  async function onPlanTap(x, y, inside) {
    if (mode === 'add') {
      if (!inside) return toast('Touchez à l\'intérieur du plan');
      setMode('view');
      await closePoint();
      const all = await db.byIndex('points', 'projectId', project.id);
      const now = Date.now();
      const p = {
        id: uid(), projectId: project.id, planId: plan.id, page, x, y,
        num: all.reduce((m, q) => Math.max(m, q.num || 0), 0) + 1,
        type: lastType, title: '', theo: null, mesure: null, tol: settings.tol,
        remStatus: 'a_reprendre', comment: '', author: settings.author, createdAt: now, updatedAt: now,
      };
      points.push(p);
      await db.put('points', p);
      openPoint(p, false, true);
    } else if (mode === 'move') {
      if (!inside || !current) return;
      current.x = x;
      current.y = y;
      setMode('view');
      await savePoint();
      refreshPins();
      toast('Point déplacé');
    } else {
      if (isVector) {
        const hit = viewer.hitTest(x, y);
        if (hit) return openObject(hit);
      }
      if (current) await closePoint();
    }
  }

  // Toucher une cote ou un élément du plan : ouvre (ou prépare) sa fiche de contrôle
  async function openObject(hit) {
    const o = hit.obj;
    const existing = points.find((p) => p.ref && p.ref.h === o.h && p.page === page);
    if (existing) return openPoint(existing);
    await closePoint();
    const all = await db.byIndex('points', 'projectId', project.id);
    const now = Date.now();
    const p = {
      id: uid(), projectId: project.id, planId: plan.id, page,
      num: all.reduce((m, q) => Math.max(m, q.num || 0), 0) + 1,
      ref: { kind: hit.kind, h: o.h }, comment: '', author: settings.author, createdAt: now, updatedAt: now,
      tol: settings.tol, theo: null, mesure: null,
    };
    if (hit.kind === 'dim') {
      Object.assign(p, {
        type: 'cote', x: o.tx / viewer.W, y: o.ty / viewer.H, title: `Cote ${o.t}${plan.pageNames ? ' – ' + plan.pageNames[page - 1] : ''}`,
        theo: o.v, dimText: o.t, dimLayer: o.l,
      });
    } else {
      Object.assign(p, {
        type: 'element', x: (o.bb[0] + o.bb[2]) / 2 / viewer.W, y: (o.bb[1] + o.bb[3]) / 2 / viewer.H,
        title: o.n, elLayer: o.l, elRaw: o.raw, elStatus: null,
      });
    }
    points.push(p);
    await db.put('points', p);
    openPoint(p, false, true);
  }

  async function openLayers() {
    const pg = viewer.pg;
    const hidden = new Set(viewer.hidden);
    const onPage = points.filter((p) => p.page === page && p.ref);
    const rows = pg.layers.map((L) => {
      const els = pg.els.filter((e) => e.l === L.n);
      const dims = pg.dims.filter((d) => d.l === L.n);
      const hs = new Set([...els, ...dims].map((o) => o.h));
      const done = onPage.filter((p) => hs.has(p.ref.h) && !isTodo(pointStatus(p))).length;
      return { n: L.n, els: els.length, dims: dims.length, done };
    }).sort((a, b) => (b.els + b.dims > 0) - (a.els + a.dims > 0) || a.n.localeCompare(b.n, 'fr'));
    const box = document.createElement('div');
    box.className = 'layers-list';
    box.innerHTML = `<div class="row"><button type="button" class="btn small" data-all="1">Tout afficher</button>
      <button type="button" class="btn small" data-all="0">Tout masquer</button></div>
      ${rows.map((r) => `<label class="check-row"><input type="checkbox" value="${esc(r.n)}" ${hidden.has(r.n) ? '' : 'checked'}>
        <span><strong>${esc(r.n)}</strong>${r.els || r.dims ? `<span class="muted small"> · ${[
          r.els ? `${r.els} élément${r.els > 1 ? 's' : ''}` : '', r.dims ? `${r.dims} cote${r.dims > 1 ? 's' : ''}` : '',
        ].filter(Boolean).join(' · ')} · <b>${r.done} contrôlé${r.done > 1 ? 's' : ''}</b></span>` : ''}</span></label>`).join('')}`;
    box.addEventListener('click', (e) => {
      const all = e.target.closest('[data-all]');
      if (all) box.querySelectorAll('input').forEach((c) => (c.checked = all.dataset.all === '1'));
    });
    const ok = await modal({
      title: 'Calques',
      body: box,
      actions: [{ label: 'Annuler', value: false }, { label: 'Appliquer', value: true, kind: 'primary' }],
    });
    if (!ok) return;
    const set = new Set([...box.querySelectorAll('input:not(:checked)')].map((c) => c.value));
    localStorageSet(layersKey, JSON.stringify([...set]));
    viewer.setHiddenLayers(set);
  }

  async function openPoint(p, focus = false, isNew = false) {
    if (current && current.id !== p.id) await closePoint();
    current = p;
    photoUrls.forEach(URL.revokeObjectURL);
    photoUrls = [];
    currentPhotos = (await db.byIndex('photos', 'pointId', p.id)).sort((a, b) => a.createdAt - b.createdAt);
    renderSheet(isNew);
    sheet.hidden = false;
    refreshPins();
    requestAnimationFrame(() => {
      if (focus) viewer.focusOn(p.x, p.y, sheetInsets());
      else viewer.ensureVisible(p.x, p.y, sheetInsets());
    });
  }

  async function closePoint() {
    if (!current) return;
    clearTimeout(saveTimer);
    const p = current;
    current = null;
    sheet.hidden = true;
    sheet.innerHTML = '';
    photoUrls.forEach(URL.revokeObjectURL);
    photoUrls = [];
    if (isEmptyPoint(p, currentPhotos.length)) {
      await db.deletePoint(p.id);
      points = points.filter((q) => q.id !== p.id);
    } else {
      await savePoint(p);
    }
    refreshPins();
  }

  async function savePoint(p = current) {
    if (!p) return;
    clearTimeout(saveTimer);
    p.updatedAt = Date.now();
    await db.put('points', p);
    await db.touchProject(project.id);
  }

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    const p = current;
    saveTimer = setTimeout(() => savePoint(p), 400);
  };

  function renderSheet(isNew) {
    const p = current;
    sheet.innerHTML = `
      <div class="sheet-head">
        <span class="badge" data-badge>${p.num}</span>
        <strong>Point n°${p.num}</strong>
        <span class="status" data-status></span>
        <button class="icon-btn" data-act="close" aria-label="Fermer">${ICON.close}</button>
      </div>
      <div class="sheet-body">
        ${p.ref ? `<div class="ref-info">${p.type === 'cote'
          ? `Cote lue sur le plan : <strong>${esc(p.dimText)}</strong> → ${fmtMm(objIndex.get(p.ref.h)?.v ?? p.theo)}<span class="muted"> · calque ${esc(p.dimLayer)}</span>`
          : `Élément du plan : <strong>${esc(objIndex.get(p.ref.h)?.n || p.title)}</strong><span class="muted"> · calque ${esc(p.elLayer)}</span>`}</div>`
        : `<div class="seg" data-seg="type">
          <button type="button" data-v="cote">Contrôle de cote</button>
          <button type="button" data-v="remarque">Remarque</button>
        </div>`}
        <label class="field"><span>Libellé / localisation</span>
          <input name="title" value="${esc(p.title)}" placeholder="ex : Voile V3 – longueur, file B" autocomplete="off"></label>
        <div class="cote-fields">
          <div class="grid3">
            <label class="field"><span>Cote plan (mm)</span><input name="theo" value="${p.theo != null ? fmtNum(p.theo) : ''}" inputmode="decimal" autocomplete="off"></label>
            <label class="field"><span>Mesurée (mm)</span><input name="mesure" value="${p.mesure != null ? fmtNum(p.mesure) : ''}" inputmode="decimal" autocomplete="off"></label>
            <label class="field"><span>Tolérance ± (mm)</span><input name="tol" value="${p.tol != null ? fmtNum(p.tol) : ''}" inputmode="decimal" autocomplete="off"></label>
          </div>
          <div class="ecart" data-ecart></div>
        </div>
        <div class="rem-fields">
          <span class="lbl">Statut</span>
          <div class="seg" data-seg="remStatus">
            <button type="button" data-v="observation">Observation</button>
            <button type="button" data-v="a_reprendre">À reprendre</button>
            <button type="button" data-v="levee">Levée</button>
          </div>
        </div>
        <div class="el-fields">
          <span class="lbl">Contrôle de l'élément</span>
          <div class="seg" data-seg="elStatus">
            <button type="button" data-v="conforme">Conforme</button>
            <button type="button" data-v="non_conforme">Non conforme</button>
            <button type="button" data-v="levee">Levée</button>
          </div>
        </div>
        <label class="field"><span>Remarque sur l'exécution</span>
          <textarea name="comment" rows="3" placeholder="Constat, réserve, action demandée…">${esc(p.comment)}</textarea></label>
        <div class="photos">
          <span class="lbl">Photos</span>
          <div class="thumbs"></div>
          <div class="row">
            <button type="button" class="btn" data-act="photo-cam">${ICON.camera} Prendre une photo</button>
            <button type="button" class="btn" data-act="photo-lib">${ICON.image} Galerie</button>
          </div>
        </div>
        <p class="muted small">Créé le ${fmtDate(p.createdAt)}${p.author ? ` par ${esc(p.author)}` : ''}${p.updatedAt !== p.createdAt ? ` · modifié le ${fmtDate(p.updatedAt)}` : ''}</p>
      </div>
      <div class="sheet-foot">
        <button class="btn danger-ghost" data-act="delete">Supprimer</button>
        ${p.ref && isVector ? '' : '<button class="btn" data-act="move">Déplacer</button>'}
        <button class="btn primary" data-act="close">Terminé</button>
      </div>`;
    updateSheet();
    renderThumbs();
    if (isNew && p.type !== 'element') {
      const sel = p.type === 'cote' ? (p.ref ? '[name="mesure"]' : '[name="theo"]') : '[name="comment"]';
      setTimeout(() => sheet.querySelector(sel)?.focus({ preventScroll: true }), 80);
    }
  }

  function updateSheet() {
    const p = current;
    if (!p) return;
    const st = pointStatus(p);
    const S = STATUS[st];
    sheet.querySelector('[data-badge]').style.background = S.color;
    const stEl = sheet.querySelector('[data-status]');
    stEl.textContent = S.label;
    stEl.style.setProperty('--c', S.color);
    sheet.querySelector('.cote-fields').hidden = p.type !== 'cote';
    sheet.querySelector('.rem-fields').hidden = p.type !== 'remarque';
    sheet.querySelector('.el-fields').hidden = p.type !== 'element';
    for (const seg of sheet.querySelectorAll('[data-seg]')) {
      const val = p[seg.dataset.seg];
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === val);
    }
    const e = ecartOf(p);
    const ecEl = sheet.querySelector('[data-ecart]');
    ecEl.innerHTML = e == null
      ? '<span class="muted">Saisissez la cote du plan et la cote mesurée : l\'écart et la conformité sont calculés automatiquement.</span>'
      : `Écart : <strong style="color:${S.color}">${fmtEcart(e)}</strong> → <strong style="color:${S.color}">${S.label}</strong>`;
  }

  function renderThumbs() {
    const box = sheet.querySelector('.thumbs');
    if (!box) return;
    photoUrls.forEach(URL.revokeObjectURL);
    photoUrls = currentPhotos.map((ph) => URL.createObjectURL(ph.blob));
    box.innerHTML = currentPhotos.map((ph, i) => `<button type="button" class="thumb" data-photo="${ph.id}"><img src="${photoUrls[i]}" alt="Photo ${i + 1}"></button>`).join('');
  }

  async function addPhotos(capture) {
    const p = current;
    if (!p) return;
    const files = await pickFiles({ accept: 'image/*', multiple: !capture, capture: capture ? 'environment' : undefined });
    if (!files.length || current !== p) return;
    for (const f of files) {
      try {
        const blob = await compressImage(f);
        const ph = { id: uid(), pointId: p.id, projectId: project.id, blob, createdAt: Date.now() };
        await db.put('photos', ph);
        currentPhotos.push(ph);
      } catch (err) {
        console.error(err);
        toast('Photo illisible');
      }
    }
    await savePoint(p);
    renderThumbs();
  }

  async function showPhoto(id) {
    const ph = currentPhotos.find((x) => x.id === id);
    if (!ph) return;
    const url = URL.createObjectURL(ph.blob);
    const v = await modal({
      title: '',
      wide: true,
      body: `<img class="photo-full" src="${url}" alt="">`,
      actions: [
        { label: 'Supprimer la photo', value: 'delete', kind: 'danger-ghost' },
        { label: 'Fermer', value: null, kind: 'primary' },
      ],
    });
    URL.revokeObjectURL(url);
    if (v === 'delete') {
      if (!(await confirmDialog('Supprimer la photo ?', 'Cette photo sera définitivement supprimée.', 'Supprimer', true))) return;
      await db.del('photos', id);
      currentPhotos = currentPhotos.filter((x) => x.id !== id);
      renderThumbs();
    }
  }

  app.oninput = (e) => {
    const p = current;
    const name = e.target.name;
    if (!p || !sheet.contains(e.target) || !name) return;
    if (name === 'theo' || name === 'mesure' || name === 'tol') p[name] = parseNum(e.target.value);
    else p[name] = e.target.value;
    updateSheet();
    refreshPinColor();
    scheduleSave();
  };

  function refreshPinColor() {
    const el = host.querySelector(`.pin[data-id="${current.id}"] .pin-b`);
    if (el) el.style.background = STATUS[pointStatus(current)].color;
  }

  app.onclick = async (e) => {
    const seg = e.target.closest('[data-seg] [data-v]');
    if (seg && current) {
      const key = seg.parentElement.dataset.seg;
      current[key] = seg.dataset.v;
      if (key === 'type') lastType = seg.dataset.v;
      updateSheet();
      refreshPinColor();
      scheduleSave();
      return;
    }
    const photo = e.target.closest('[data-photo]');
    if (photo) return showPhoto(photo.dataset.photo);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add') {
      if (mode === 'add') return setMode('view');
      await closePoint();
      setMode('add');
    } else if (act === 'cancel-mode') {
      setMode('view');
    } else if (act === 'close') {
      await closePoint();
    } else if (act === 'move') {
      setMode('move');
    } else if (act === 'delete') {
      const p = current;
      if (!(await confirmDialog(`Supprimer le point n°${p.num} ?`, 'Le point et ses photos seront définitivement supprimés.', 'Supprimer', true))) return;
      clearTimeout(saveTimer);
      current = null;
      sheet.hidden = true;
      await db.deletePoint(p.id);
      points = points.filter((q) => q.id !== p.id);
      refreshPins();
      toast('Point supprimé');
    } else if (act === 'photo-cam') {
      addPhotos(true);
    } else if (act === 'photo-lib') {
      addPhotos(false);
    } else if (act === 'prev' && page > 1) {
      showPage(page - 1);
    } else if (act === 'next' && page < plan.pageCount) {
      showPage(page + 1);
    } else if (act === 'zoom-in') {
      viewer.zoomBy(1.6);
    } else if (act === 'zoom-out') {
      viewer.zoomBy(1 / 1.6);
    } else if (act === 'fit') {
      viewer.fit();
    } else if (act === 'layers') {
      openLayers();
    }
  };

  cleanup = async () => {
    await closePoint();
    photoUrls.forEach(URL.revokeObjectURL);
    viewer.destroy();
  };
}

/* ---------------- Démarrage ---------------- */

if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    toast('Application mise à jour');
  });
}

route();
