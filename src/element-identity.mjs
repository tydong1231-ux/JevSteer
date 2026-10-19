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
