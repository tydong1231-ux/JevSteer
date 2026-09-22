import { config } from "./config.mjs";

export const FIELDISH = (e) =>
  !!e && (e.tag === "textarea" || e.tag === "input" || e.role === "textbox" || e.role === "searchbox" || e.contenteditable);

export const SELECTISH = (e) => !!e && (e.tag === "select" || e.role === "combobox" || e.role === "listbox");

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
    text: squash(page.text, config.modelPageTextChars),
    metrics: page.metrics,
    elements: page.elements.map((e) => ({
      i: e.i,
      tag: e.tag,
      role: e.role,
      label: e.label,
      text: e.text,
      placeholder: e.placeholder,
      name: e.name,
      type: e.type,
      href: e.href,
      value: e.type === "password" ? "[REDACTED]" : e.value,
      checked: e.checked,
      disabled: e.disabled,
      contenteditable: e.contenteditable,
      options: e.options?.map((o) => ({ text: o.text, value: o.value, selected: o.selected, disabled: o.disabled })),
      near: e.near,
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
      e.value && e.type !== "password" ? `value=${JSON.stringify(squash(e.value, 80))}` : "",
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
