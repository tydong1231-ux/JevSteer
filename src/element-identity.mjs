import { squash } from "./page-model.mjs";

const clean = (value) => squash(value, 600);
const href = (value, base) => { try { return new URL(value, base).href; } catch { return value || ""; } };

const IDENTITY_KEYS = ["type", "name", "label", "placeholder", "context", "scope", "form_action", "form_key", "record_key"];

// Selectors and DOM positions are locators, not record identity. Frameworks
// routinely reuse them when sorting, filtering or virtualizing a table.
// `ignoreContext` drops the surrounding record/parent text, which the page
// itself rewrites as a result of input (live totals, validation messages,
// character counters, suggestion lists appended next to a field).
export function sameIdentity(before, after, base, { ignoreContext = false } = {}) {
  if (!before || !after || before.tag !== after.tag || before.role !== after.role) return false;
  for (const key of ['frame_id', 'document_id']) if (before[key] && after[key] && before[key] !== after[key]) return false;
  for (const key of IDENTITY_KEYS) {
    if (ignoreContext && key === "context") continue;
    if (clean(before[key]) !== clean(after[key])) return false;
  }
  if (href(before.href, base) !== href(after.href, base)) return false;
  // Editable text changes are action effects, not replacement of the control.
  if (!before.contenteditable && clean(before.text) !== clean(after.text)) return false;
  return true;
}

export function locateSameElement(original, page) {
  const matches = page.elements.filter((e) => sameIdentity(original, e, page.url));
  // Even a matching selector is unsafe if semantic identity is ambiguous.
  // A record/fieldset/dialog scope distinguishes otherwise equal controls.
  if (matches.length !== 1) return undefined;
  return matches[0];
}

// Links with the same text, context and address load the same page: Wikipedia
// shows its "20 | 50 | 100 | 250 | 500" pager above and below a list. A click
// on either is the same click; the one observed is preferred. Any other
// control that matches twice stays ambiguous, as do in-page and script links.
export function equivalentLink(original, matches, base) {
  if (matches.length < 2 || !original?.href || /^\s*(#|javascript:)/i.test(original.href)) return undefined;
  try {
    if (!["http:", "https:"].includes(new URL(original.href, base).protocol)) return undefined;
  } catch { return undefined; }
  const same = (e) => (e.tag === "a" || e.role === "link") && (e.link_target || "") === (original.link_target || "") && !!e.download === !!original.download;
  if (!same(original) || !matches.every(same)) return undefined;
  return matches.find((e) => e.ordinal != null && e.ordinal === original.ordinal) || matches[0];
}

// What can tell identical controls apart once their identity matches: what
// each one shows or holds (a hint, the value it shows, its value, options and
// state), and the text and table column next to it.
const TELL_APART = ["hint", "display", "value_hash", "value", "near", "column", "checked", "selected", "expanded", "invalid", "readonly", "validation_message"];
export function twinKey(e) {
  return JSON.stringify([...TELL_APART.map((key) => e?.[key] ?? null), (e?.options || []).map((o) => [o.text, o.value, !!o.selected, !!o.disabled])]);
}

// Identical controls, such as unnamed selects in one filter row: where `el`
// is one of several on `page`, what tells it from the others. Never their
// order: a page can swap equal nodes without anything observed changing, so
// order cannot show which node was chosen. `distinct` is false when nothing
// observed tells `el` from another; then it is refused (see pickTwin).
export function twinsOf(el, page) {
  const twins = page.elements.filter((e) => e.frame_id === el.frame_id && e.document_id === el.document_id && sameIdentity(el, e, page.url));
  if (twins.length < 2 || !twins.includes(el)) return undefined;
  const key = twinKey(el);
  return { count: twins.length, key, distinct: twins.filter((e) => twinKey(e) === key).length === 1 };
}

// The one of `matches` that still shows what the chosen twin showed, if it
// was told apart from the others then and only one shows it now.
export function pickTwin(twins, matches) {
  if (!twins?.distinct) return undefined;
  const same = matches.filter((e) => twinKey(e) === twins.key);
  return same.length === 1 ? same[0] : undefined;
}

// True when the control is unique on `page` even without its surrounding text.
export function uniqueWithoutContext(original, page) {
  return !!matchWithoutContext(original, page);
}

// Remember a control this run already changed, so later observations can find
// it again after the page rewrote its surrounding text. `loose` records whether
// the control was unique without that text when it was remembered.
export function rememberField(el, page) {
  return { el, loose: uniqueWithoutContext(el, page) };
}

function matchWithoutContext(el, page) {
  const matches = page.elements.filter((e) => sameIdentity(el, e, page.url, { ignoreContext: true }));
  return matches.length === 1 ? matches[0] : undefined;
}

// Exact identity first. Without it, accept the one control that matches without
// its surrounding text, and only if it was unique that way when remembered, so
// equal controls in unkeyed rows are never confused.
export function findRemembered({ el, loose }, page) {
  return locateSameElement(el, page) || (loose ? matchWithoutContext(el, page) : undefined);
}

// Find the control an action targeted in the observation that followed it.
// Used for read-only effect checks; pre-input freshness checks stay exact.
export function locateAfterAction(original, after, before) {
  return locateSameElement(original, after)
    || (before && uniqueWithoutContext(original, before) ? matchWithoutContext(original, after) : undefined);
}

export function actionIdentity(action, pageUrl) {
  const e = action.el || {};
  return [pageUrl, action.tool, action.key || "", e.tag, e.role, e.type,
    e.label, e.name, e.placeholder, e.context, e.scope, href(e.href, pageUrl)]
    .map(clean).join("|");
}
