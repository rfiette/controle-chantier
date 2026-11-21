import { esc } from './util.js';

export const ICON = {
  back: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  fit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
};

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Fenêtre modale. actions: [{label, value, kind, validate(wrap)}]
 * value peut être une fonction (wrap) => valeur.
 */
export function modal({ title, body, actions = [{ label: 'OK', value: true, kind: 'primary' }], onOpen, wide = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="modal-body"></div><div class="modal-actions"></div></div>`;
    const bodyEl = wrap.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.append(body);
    const actionsEl = wrap.querySelector('.modal-actions');
    const close = (v) => {
      wrap.remove();
      resolve(v);
    };
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.onclick = async () => {
        if (a.validate && !(await a.validate(wrap))) return;
        close(typeof a.value === 'function' ? a.value(wrap) : a.value);
      };
      actionsEl.append(b);
    }
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close(undefined);
    });
    wrap.addEventListener('submit', (e) => {
      e.preventDefault();
      actionsEl.querySelector('.primary')?.click();
    });
    document.body.append(wrap);
    onOpen?.(wrap, close);
  });
}

export const confirmDialog = (title, message, okLabel = 'Confirmer', danger = false) =>
  modal({
    title,
    body: `<p>${esc(message)}</p>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });

/** fields: [{name, label, value, placeholder, required, inputmode, type}] → objet ou undefined */
export function formDialog(title, fields, okLabel = 'Enregistrer') {
  const form = document.createElement('form');
  form.className = 'form';
  form.innerHTML = fields
    .map(
      (f) => `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>
      ${f.type === 'textarea'
        ? `<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`
        : `<input name="${f.name}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} autocomplete="off">`}
      </label>`
    )
    .join('') + '<button type="submit" hidden></button>';
  return modal({
    title,
    body: form,
    actions: [
      { label: 'Annuler', value: undefined },
      {
        label: okLabel,
        kind: 'primary',
        validate: () => {
          for (const f of fields) {
            const el = form.elements[f.name];
            if (f.required && !el.value.trim()) {
              el.focus();
              el.classList.add('invalid');
              return false;
            }
          }
          return true;
        },
        value: () => Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()])),
      },
    ],
    onOpen: () => setTimeout(() => form.querySelector('input,textarea')?.focus(), 50),
  });
}

export function loading(msg) {
  const el = document.createElement('div');
  el.className = 'modal-wrap loading';
  el.innerHTML = `<div class="modal center"><div class="spinner"></div><p class="loading-msg">${esc(msg)}</p></div>`;
  document.body.append(el);
  return {
    set: (m) => (el.querySelector('.loading-msg').textContent = m),
    close: () => el.remove(),
  };
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

// Sur tablette/téléphone : feuille de partage (AirDrop, Mail, Fichiers…). Sur ordinateur : téléchargement.
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function pickFiles({ accept, multiple = false, capture } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    input.onchange = () => {
      resolve([...input.files]);
      input.remove();
    };
    document.body.append(input);
    input.click();
  });
}
