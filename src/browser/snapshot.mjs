import { createHash, randomUUID } from 'node:crypto';
import { sensitiveField } from '../sensitive.mjs';

// This selector is only a discovery surface. It is never a durable identity.
export const INTERACTIVE = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=listbox],[role=textbox],[role=searchbox],[role=spinbutton],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"]),.cursor-pointer';

// Runs in the browser exclusively to READ state. No attributes, handlers,
// hidden nodes, DOM values or application state are changed by observation.
export function readDOM(elements) {
  elements = Array.isArray(elements) ? elements : [elements];
  const clean = (s, max = 500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const parent = (e) => e.parentElement || e.getRootNode()?.host;
  const ancestors = (e) => { const a = []; for (let p = e; p; p = parent(p)) a.push(p); return a; };
  const closest = (e, selector) => ancestors(e).find((p) => p.matches(selector));
  const visible = (e) => {
    if (!e.isConnected || !e.getClientRects().length) return false;
    return !ancestors(e).some((p) => {
      const style = getComputedStyle(p);
      return p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    });
  };
  const text = (e, max = 500) => {
    if (!e) return '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName)
          || ancestors(node).some((p) => p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || ['none'].includes(getComputedStyle(p).display) || getComputedStyle(p).visibility === 'hidden')) return '';
      return [...(node.shadowRoot || node).childNodes].map(walk).join(' ');
    };
    return clean(walk(e), max);
  };
  const idText = (e, ids) => (ids || '').split(/\s+/).map((id) => text(e.getRootNode().getElementById?.(id), 180)).filter(Boolean).join(' ');
  // Toggle buttons often keep the alternate icon in the DOM hidden with CSS
  // (favorite/unfavorite), so computed display/visibility counts too. An SVG
  // <title> is never rendered itself; judge it by its parent graphic.
  const iconHidden = (icon) => {
    const shown = icon.matches('svg title') ? icon.parentElement : icon;
    if (!shown || getComputedStyle(shown).visibility !== 'visible') return true;
    return ancestors(shown).some((p) => p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || getComputedStyle(p).display === 'none');
  };
  const iconName = (e) => [...e.querySelectorAll('[role=img][aria-label],svg title,img[alt]')]
    .filter((icon) => !iconHidden(icon))
    .map((icon) => clean(icon.getAttribute('aria-label') || icon.getAttribute('alt') || icon.textContent, 180)).filter(Boolean).join(' ');
  // Asset names are explicitly hints, never fabricated accessible names. Strip
  // query/fragment data; opaque or duplicate icons still fail unique identity.
  const iconHint = (e) => {
    const img = e.matches('img[src]') ? e : e.querySelector('img[src]');
    if (!img) return '';
    try {
      const url = new URL(img.getAttribute('src'), location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const filename = decodeURIComponent(url.pathname.split('/').at(-1));
      if (!/\.(svg|png|webp|gif|jpe?g)$/i.test(filename)) return '';
      const hint = filename.split('.')[0].replace(/[_-]+/g, ' ');
      return /^[a-z][a-z0-9 ]{0,79}$/i.test(hint) ? `icon: ${hint}` : '';
    } catch { return ''; }
  };
  const name = (e) => clean(e.getAttribute('aria-label') || idText(e, e.getAttribute('aria-labelledby'))
    || [...(e.labels || [])].map((l) => text(l, 180)).join(' ') || text(closest(e, 'label'), 180)
    || e.getAttribute('alt') || e.getAttribute('title') || (e.matches('button,a,[role=button],[role=option],.cursor-pointer') ? text(e, 180) : '')
    || (['submit', 'button', 'reset'].includes(e.type) ? e.value : '')
    || (e.matches('button,[role=button],.cursor-pointer') ? iconName(e) || iconHint(e) : '') || e.getAttribute('placeholder') || e.getAttribute('name'));
  const role = (e) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[e.tagName]
    || (e.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', reset: 'button', button: 'button', number: 'spinbutton' })[e.type] || 'textbox' : e.isContentEditable ? 'textbox' : undefined);
  const all = [...elements];
  const modals = all.filter((e) => e.matches('dialog[open],[role=dialog][aria-modal=true]') && visible(e));
  // Dialogs without focusable attributes are discovered independently.
  for (const e of document.querySelectorAll('dialog[open],[role=dialog][aria-modal=true]')) if (visible(e) && !modals.includes(e)) modals.push(e);
  const modal = modals.at(-1);
  const permitted = (e) => !modal || ancestors(e).includes(modal) || !!closest(e, '[role=listbox],[role=option]');
  // Only a submit control of a GET form loads the form's action. Checkboxes,
  // radios and fields in that form change nothing until it is submitted.
  const getAction = (e) => {
    const submits = e.tagName === 'BUTTON' ? !['button', 'reset'].includes(e.type) : e.tagName === 'INPUT' && ['submit', 'image'].includes(e.type);
    if (!submits || !e.form) return undefined;
    const method = e.hasAttribute('formmethod') ? e.formMethod : e.form.method;
    const action = e.getAttribute('formaction') || e.form.getAttribute('action');
    if (String(method || 'get').toLowerCase() !== 'get' || !action) return undefined;
    try {
      const url = new URL(action, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
    } catch { return undefined; }
  };
  const describe = (e, index) => {
    const form = e.form || closest(e, 'form,[role=form]');
    const section = closest(e, 'fieldset,[role=group],[role=dialog],dialog');
    const record = closest(e, '[data-record-id],[data-row-key],[data-id],tr,[role=row],article');
    const recordKey = record && (record.getAttribute('data-record-id') || record.getAttribute('data-row-key') || record.getAttribute('data-id') || record.id);
    const formKey = form && (form.id || form.getAttribute('name') || name(form) || clean(form.getAttribute('action')));
    const scope = section && (section.matches('fieldset') ? text(section.querySelector('legend'), 180) : name(section));
    const local = text(record || parent(e), 500);
    const descriptor = {
      ordinal: index, tag: e.tagName.toLowerCase(), role: role(e), type: e.getAttribute('type') || (e.tagName === 'INPUT' ? e.type : undefined),
      label: name(e), text: text(e, 180), name: e.getAttribute('name') || '', placeholder: e.getAttribute('placeholder') || '',
      href: e.getAttribute('href') || undefined,
      value: 'value' in e ? String(e.value) : e.isContentEditable ? e.innerText : undefined,
      checked: 'checked' in e ? e.checked : e.hasAttribute('aria-checked') ? e.getAttribute('aria-checked') === 'true' : undefined,
      selected: e.hasAttribute('aria-selected') ? e.getAttribute('aria-selected') === 'true' : undefined,
      expanded: e.hasAttribute('aria-expanded') ? e.getAttribute('aria-expanded') === 'true' : undefined,
      disabled: e.matches(':disabled') || !!closest(e, '[aria-disabled=true]'),
      readonly: e.readOnly === true || e.getAttribute('aria-readonly') === 'true', contenteditable: e.isContentEditable,
      invalid: e.getAttribute('aria-invalid') === 'true' || (e.willValidate && !e.validity.valid) || false,
      validation_message: e.validationMessage || '', context: local, scope: scope || '',
      form_key: formKey || '', record_key: recordKey || '',
      form_action: getAction(e),
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => ({ text: clean(o.text), value: o.value, selected: o.selected, disabled: o.disabled || o.parentElement?.disabled === true })) : undefined,
    };
    return descriptor;
  };
  const filtered = all.map((e, i) => visible(e) && permitted(e) && !e.matches('dialog,[role=dialog]') ? describe(e, i) : null).filter(Boolean);
  return {
    documentKey: String(performance.timeOrigin), url: location.href, title: document.title,
    text: text(modal || document.body, 24000), background_context: modal ? text(document.querySelector('h1'), 500) : undefined,
    modal: !!modal,
    loading: { busy: document.readyState === 'loading' || all.some((e) => visible(e) && permitted(e) && e.getAttribute('aria-busy') === 'true') || [...document.querySelectorAll('[aria-busy=true],[role=progressbar]')].some(visible) },
    elements: filtered,
  };
}

export async function captureSnapshot(page, { pageId, sessionId, frameInfo, scope, maxElements = 1000 }) {
  const snapshotId = randomUUID();
  const refs = new Map();
  const frames = [];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      const owner = await frame.frameElement().catch(() => null);
      try { if (!owner || !await owner.isVisible()) continue; } finally { await owner?.dispose(); }
    }
    const info = frameInfo(frame);
    const revision = info.revision;
    const query = scope ? frame.locator(scope).locator(INTERACTIVE) : frame.locator(INTERACTIVE + ',dialog[open],[role=dialog][aria-modal=true]');
    if (scope && !await frame.locator(scope).count()) continue;
    let data;
    try { data = await query.evaluateAll(readDOM); }
    catch (error) { if (frame.isDetached()) continue; throw error; }
    if (info.revision !== revision) throw new Error('SNAPSHOT_CHANGED: document navigated during capture');
    const documentId = `${info.id}:${revision}:${data.documentKey}`;
    for (const e of data.elements) {
      const selector = `pw-ref:${snapshotId}:${info.id}:${e.ordinal}`;
      const target = { ...e, selector, snapshot_id: snapshotId, page_id: pageId, session_id: sessionId, frame_id: info.id, document_id: documentId, identity_version: 2 };
      target.value_hash = createHash('sha256').update(String(e.value ?? '')).digest('hex');
      if (sensitiveField(target)) { target.value = '[REDACTED]'; target.text = ''; }
      refs.set(selector, { locator: query.nth(e.ordinal), frame, target });
      e.target = target;
    }
    frames.push({ info, revision, documentId, data });
  }
  if (frames.some((f) => f.info.revision !== f.revision || f.info.frame.isDetached())) throw new Error('SNAPSHOT_CHANGED: frame/document changed during capture');
  if (scope && !frames.length) throw new Error('SCOPE_NOT_FOUND');
  const modalFrames = frames.filter((f) => f.data.modal);
  // A modal in the main frame prevents interaction with covered child frames.
  const active = modalFrames.some((f) => f.info.frame === page.mainFrame()) ? modalFrames : frames;
  const elements = active.flatMap((f) => f.data.elements.map((e) => e.target));
  if (elements.length > maxElements) throw new Error('OBSERVATION_LIMIT: narrow the observation scope');
  elements.forEach((e, i) => { e.i = i; });
  const main = frames.find((f) => f.info.frame === page.mainFrame())?.data;
  return {
    refs,
    observation: {
      snapshot_id: snapshotId, page_id: pageId, session_id: sessionId,
      url: page.url(), title: main?.title || await page.title(),
      text: active.map((f) => f.data.text).join('\n'), background_context: main?.background_context,
      loading: { busy: active.some((f) => f.data.loading.busy) }, elements,
      frames: active.map((f) => ({ frame_id: f.info.id, document_id: f.documentId, url: f.data.url })),
      metrics: { element_count: elements.length, frame_count: active.length },
    },
  };
}
