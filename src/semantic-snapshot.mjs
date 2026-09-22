import { load } from "cheerio";
import { squash } from "./page-model.mjs";

export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=combobox]",
  "[role=listbox]",
  "[role=textbox]",
  "[role=searchbox]",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex=\"-1\"])"
].join(",");

function inferRole(tag, type, explicit) {
  if (explicit) return explicit;
  if (tag === "a") return "link";
  if (tag === "button" || type === "button" || type === "submit" || type === "reset") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "searchbox";
    return "textbox";
  }
  return undefined;
}

function safeQuery($, selector) {
  try { return $(selector).first(); } catch { return null; }
}

function findById($, id) {
  if (!id) return null;
  try {
    return $("[id]").filter((_, el) => $(el).attr("id") === id).first();
  } catch {
    return null;
  }
}

function elementText(node) {
  if (!node || !node.length) return "";
  return squash(node.text(), 180);
}

function nearbyText(node) {
  if (!node || !node.length) return "";
  const own = elementText(node);
  const parent = squash(node.parent().text(), 260);
  if (!parent) return "";
  if (!own) return parent.slice(0, 180);
  return squash(parent.replace(own, " "), 180);
}

function labelFor($, node, raw, tag, type) {
  const aria = squash(node?.attr("aria-label"), 180);
  if (aria) return aria;

  const labelledBy = node?.attr("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => squash(findById($, id)?.text(), 120)).filter(Boolean);
    if (parts.length) return squash(parts.join(" "), 180);
  }

  const title = squash(node?.attr("title"), 180);
  if (title) return title;
  const placeholder = squash(node?.attr("placeholder"), 180);
  if (placeholder) return placeholder;

  const id = node?.attr("id") || raw.id;
  if (id) {
    let explicit = "";
    try {
      explicit = squash($("label[for]").filter((_, el) => $(el).attr("for") === id).first().text(), 180);
    } catch {}
    if (explicit) return explicit;
  }

  const wrapping = squash(node?.closest("label").text(), 180);
  if (wrapping) return wrapping;
  const text = elementText(node);
  if (text) return text;
  const name = squash(node?.attr("name") || raw.name, 120);
  if (name) return name;
  if (tag === "input" && type === "submit") return squash(node?.attr("value") || raw.value, 120);
  return "";
}

function redactPasswordAttrs($) {
  $("input[type=password]").each((_, el) => {
    $(el).attr("value", "[REDACTED]");
  });
}

export function buildSemanticPage({ tab, domHtml, rawElements }) {
  const $ = load(domHtml || "<html><body></body></html>");
  redactPasswordAttrs($);

  const textRoot = $("body").clone();
  textRoot.find("script,style,noscript,template").remove();
  const pageText = squash(textRoot.text(), 10000);
  const elements = [];

  for (const raw of rawElements || []) {
    if (!raw?.visible || !raw.selector) continue;
    const node = safeQuery($, raw.selector);
    const tag = String(raw.tagName || node?.prop("tagName") || "element").toLowerCase();
    const type = squash(node?.attr("type") || "", 40).toLowerCase() || undefined;
    const role = inferRole(tag, type, squash(node?.attr("role"), 60) || undefined);
    const password = type === "password";
    const label = labelFor($, node, raw, tag, type);
    const text = elementText(node);
    const options = Array.isArray(raw.options) ? raw.options.map((o) => ({
      text: squash(o.text, 100),
      value: squash(o.value, 100),
      selected: !!o.selected,
      disabled: !!o.disabled,
    })) : undefined;

    elements.push({
      i: elements.length,
      selector: raw.selector,
      tag,
      role,
      label,
      text,
      placeholder: squash(node?.attr("placeholder"), 140) || undefined,
      name: squash(node?.attr("name") || raw.name, 100) || undefined,
      type,
      href: squash(node?.attr("href") || raw.href, 220) || undefined,
      value: password ? "[REDACTED]" : (squash(raw.value, 160) || undefined),
      checked: node?.attr("checked") != null ? true : undefined,
      disabled: node?.attr("disabled") != null || node?.attr("aria-disabled") === "true",
      contenteditable: node?.attr("contenteditable") === "true",
      options,
      near: nearbyText(node) || undefined,
      bounds: raw.bounds,
    });
  }

  return {
    url: tab?.url || "",
    title: tab?.title || "",
    text: pageText,
    metrics: {
      elements: elements.length,
      dom_size: tab?.domSize,
      viewport: tab?.viewportDimensions,
      scroll: tab?.scrollPosition,
    },
    elements,
  };
}

export async function semanticSnapshot(kapture, tabId) {
  const [tab, raw, dom] = await Promise.all([
    kapture.tabDetail(tabId),
    kapture.elements(tabId, INTERACTIVE_SELECTOR),
    kapture.dom(tabId),
  ]);

  return buildSemanticPage({
    tab,
    domHtml: dom?.html || dom?.outerHTML || dom?.dom || "",
    rawElements: raw?.elements || [],
  });
}
