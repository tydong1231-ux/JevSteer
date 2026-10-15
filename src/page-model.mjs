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
  const label = squash(e.label || e.text || e.placeholder || e.name || e.href || "", 120);
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

export function toModelPage(page) {
  return {
    url: page.url,
    title: page.title,
    ...(page.background_context ? { background_context: squash(page.background_context, 600) } : {}),
    text: squash(page.text, config.modelPageTextChars),
    metrics: page.metrics,
    loading: page.loading,
    elements: page.elements.map((e) => ({
      i: e.i,
      tag: e.tag,
      role: e.role,
      label: e.label,
      text: sensitiveField(e) ? undefined : e.text,
      placeholder: e.placeholder,
      name: e.name,
      type: e.type,
      href: e.href,
      value: sensitiveField(e) ? "[REDACTED]" : (e.value != null ? squash(e.value, 160) : undefined),
      checked: e.checked,
      disabled: e.disabled,
      readonly: e.readonly,
      contenteditable: e.contenteditable,
      options: e.options?.map((o) => ({ text: o.text, value: o.value, selected: o.selected, disabled: o.disabled })),
      near: sensitiveField(e) ? undefined : e.near,
      context: e.context,
      scope: e.scope,
      invalid: e.invalid,
      expanded: e.expanded,
      selected: e.selected,
      validation_message: e.validation_message,
    })),
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
      e.value && !sensitiveField(e) ? `value=${JSON.stringify(squash(e.value, 80))}` : "",
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
