import { squash } from "./page-model.mjs";

const clean = (value) => squash(value, 600);
const href = (value, base) => { try { return new URL(value, base).href; } catch { return value || ""; } };

// Selectors and DOM positions are locators, not record identity. Frameworks
// routinely reuse them when sorting, filtering or virtualizing a table.
export function sameIdentity(before, after, base) {
  if (!before || !after || before.tag !== after.tag || before.role !== after.role) return false;
  for (const key of ['frame_id', 'document_id']) if (before[key] && after[key] && before[key] !== after[key]) return false;
  for (const key of ["type", "name", "label", "placeholder", "context", "scope", "form_action", "form_key", "record_key"]) {
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

export function actionIdentity(action, pageUrl) {
  const e = action.el || {};
  return [pageUrl, action.tool, action.key || "", e.tag, e.role, e.type,
    e.label, e.name, e.placeholder, e.context, e.scope, href(e.href, pageUrl)]
    .map(clean).join("|");
}
