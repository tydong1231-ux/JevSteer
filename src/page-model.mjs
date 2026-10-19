import { config } from "./config.mjs";
import { sensitiveField } from "./sensitive.mjs";

// HTML input elements are not all text fields. Checkboxes, file inputs and
// buttons must never be offered as TYPE targets to Jev.
const NON_TEXT_INPUTS = new Set([
  "checkbox", "radio", "hidden", "button", "submit", "reset", "image",
  "file", "color", "range",
]);

export const FIELDISH = (e) => !!e && !e.disabled && !e.readonly && (
  e.tag === "textarea"
  || (e.tag === "input" && !NON_TEXT_INPUTS.has(String(e.type || "text").toLowerCase()))
  || e.contenteditable
  || (["textbox", "searchbox", "spinbutton"].includes(e.role) && e.tag !== "input")
);

export const SELECTISH = (e) => !!e && !e.disabled
  && (e.tag === "select" || e.role === "combobox");

export function squash(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function brief(e) {
  if (!e) return "";
  const kind = e.role || e.tag || "element";
  const label = squash(e.label || e.text || e.placeholder || e.hint || e.name || e.href || "", 120);
  return label ? `${kind} "${label}"` : kind;
}

export function elementFingerprint(e) {
  if (!e) return "";
  return [
    e.tag,
    e.role,
    squash(e.label, 120),
    squash(e.text, 120),
    squash(e.placeholder, 80),
    squash(e.name, 80),
    squash(e.href, 160),
    squash(e.near, 120),
  ].join("|");
}

const CHECKABLE_TYPES = new Set(["checkbox", "radio"]);
const CHECKABLE_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
const FORM_TAGS = new Set(["input", "textarea", "select"]);

// Jev reads every element of every decision. Leave out what carries no
// information: empty strings, default-false flags, text that repeats the
// label, a "checked" state on controls that cannot be checked, and frame ids
// when the page has one frame. Explicit ARIA states keep false values.
function modelElement(e, multiFrame) {
  const secret = sensitiveField(e);
  const out = { i: e.i, tag: e.tag };
  const put = (key, value) => { if (value != null && value !== "") out[key] = value; };
  put("role", e.role);
  put("label", e.label);
  if (!secret && squash(e.text) !== squash(e.label)) put("text", e.text);
  put("placeholder", e.placeholder);
  put("hint", e.hint);
  put("name", e.name);
  put("type", e.type);
  put("href", e.href);
  if (secret) out.value = "[REDACTED]";
  else if (e.value != null && (e.value !== "" || FORM_TAGS.has(e.tag) || e.contenteditable)) out.value = squash(e.value, 160);
  // What a select-like combobox shows while its input holds only search text.
  if (!secret) put("display", e.display && squash(e.display, 160));
  put("column", e.column && squash(e.column, 60));
  if (typeof e.checked === "boolean" && (e.checked || CHECKABLE_TYPES.has(String(e.type || "").toLowerCase()) || CHECKABLE_ROLES.has(e.role))) out.checked = e.checked;
  for (const flag of ["disabled", "readonly", "contenteditable", "invalid"]) if (e[flag]) out[flag] = true;
  if (e.options) out.options = e.options.map((o) => {
    const option = { text: o.text };
    if (o.value !== o.text) option.value = o.value;
    if (o.selected) option.selected = true;
    if (o.disabled) option.disabled = true;
    return option;
  });
  if (!secret) put("near", e.near);
  put("context", e.context);
  put("scope", e.scope);
  if (multiFrame) put("frame_id", e.frame_id);
  put("form_key", e.form_key);
  put("record_key", e.record_key);
  if (typeof e.expanded === "boolean") out.expanded = e.expanded;
  if (typeof e.selected === "boolean") out.selected = e.selected;
  // The [i] of the field whose popup shows this element: an open combobox's
  // option, or a result under a search box.
  put("popup_of", e.popup_of);
  put("validation_message", e.validation_message);
  return out;
}

// What the focused field's popup shows, next to that field: search results
// under a global search box read as that box's results, not as page text.
// A secret field's popup can echo what was typed ("hunter2 is too common"),
// so it is left out, like the text next to such a field.
function popupForModel(page) {
  const field = page.popup && page.elements.find((e) => e.i === page.popup.field);
  if (!field || sensitiveField(field) || !squash(page.popup.text)) return undefined;
  return {
    field: `[${field.i}] ${brief(field)}`,
    field_value: squash(field.value, 80),
    shows: squash(page.popup.text, 600),
  };
}

export function toModelPage(page) {
  const multiFrame = new Set(page.elements.map((e) => e.frame_id).filter(Boolean)).size > 1
    || Number(page.metrics?.frame_count) > 1;
  const popup = popupForModel(page);
  return {
    url: page.url,
    title: page.title,
    ...(page.background_context ? { background_context: squash(page.background_context, 600) } : {}),
    ...(popup ? { popup } : {}),
    text: squash(page.text, config.modelPageTextChars),
    metrics: page.metrics,
    loading: page.loading,
    elements: page.elements.map((e) => modelElement(e, multiFrame)),
  };
}

export function formatPage(page) {
  const lines = [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    `Visible text: ${squash(page.text, 4000)}`,
    "",
    `Interactive elements (${page.elements.length}):`,
  ];
  for (const e of page.elements) {
    const attrs = [
      e.role ? `role=${e.role}` : "",
      e.type ? `type=${e.type}` : "",
      e.label ? `label=${JSON.stringify(squash(e.label, 120))}` : "",
      !e.label && e.text ? `text=${JSON.stringify(squash(e.text, 120))}` : "",
      e.placeholder ? `placeholder=${JSON.stringify(squash(e.placeholder, 80))}` : "",
      e.hint ? `hint=${JSON.stringify(squash(e.hint, 80))}` : "",
      e.value && !sensitiveField(e) ? `value=${JSON.stringify(squash(e.value, 80))}` : "",
      e.display && !sensitiveField(e) ? `shows=${JSON.stringify(squash(e.display, 80))}` : "",
      e.href ? `href=${JSON.stringify(squash(e.href, 120))}` : "",
      e.disabled ? "disabled" : "",
      e.checked != null ? `checked=${e.checked}` : "",
    ].filter(Boolean);
    lines.push(`[${e.i}] <${e.tag}> ${attrs.join(" ")}`.trim());
  }
  return lines.join("\n");
}

export function pageDiff(before, after) {
  if (!before) return undefined;
  const changes = [];
  if (before.url !== after.url) changes.push(`url changed: ${before.url} -> ${after.url}`);
  if (before.title !== after.title) changes.push(`title changed: ${before.title} -> ${after.title}`);
  if (before.text !== after.text) {
    const oldText = new Set(squash(before.text, 6000).split(" "));
    const added = squash(after.text, 6000).split(" ").filter((x) => x && !oldText.has(x)).slice(0, 40);
    if (added.length) changes.push(`new visible words: ${added.join(" ")}`);
  }
  if (before.elements.length !== after.elements.length) {
    changes.push(`interactive elements: ${before.elements.length} -> ${after.elements.length}`);
  }
  const bySelector = new Map(after.elements.map((e) => [e.selector, e]));
  for (const old of before.elements) {
    const current = bySelector.get(old.selector);
    if (!current) continue;
    if (old.checked !== current.checked) changes.push(`${brief(current)} checked=${current.checked}`);
    if (old.value !== current.value) changes.push(`${brief(current)} field value changed`);
    if (old.invalid !== current.invalid) changes.push(`${brief(current)} invalid=${current.invalid}`);
    if (changes.length >= 12) break;
  }
  return changes.join("; ") || "no obvious visible change";
}

export function repeatsBlock(seq, width, times) {
  if (seq.length < width * times) return false;
  const tail = seq.slice(-width * times);
  const block = tail.slice(0, width).join("\n");
  if (width > 1 && new Set(tail.slice(0, width)).size === 1) return false;
  for (let i = 1; i < times; i++) {
    if (tail.slice(i * width, (i + 1) * width).join("\n") !== block) return false;
  }
  return true;
}
