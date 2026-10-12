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
  "[onclick]",
  'td[class~="cursor-pointer"]',
  'div[class~="cursor-pointer"]:has([aria-label])',
  '[style*="cursor: pointer"]',
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
  const row = node.closest('tr,[role="row"]');
  let contextNode = row.length && row[0] !== node[0] ? row : node.parent();
  if (["INPUT", "TEXTAREA", "SELECT"].includes(node.prop("tagName"))) {
    // Dense business forms often nest the input several empty wrappers below
    // its section heading. Keep that heading so two "Name" fields (customer
    // vs contact) can be distinguished after target selection.
    const ancestors = node.parents().slice(0, 8);
    let firstContextLength;
    for (let index = 0; index < ancestors.length; index++) {
      const candidate = ancestors.eq(index).clone();
      candidate.find("script,style,noscript,template,[hidden],[aria-hidden=true]").remove();
      const text = squash(candidate.text(), 501);
      if (text.length <= Math.max(16, own.length + 12)) continue;
      firstContextLength ??= text.length;
      if (text.length > Math.min(500, firstContextLength * 2 + 40)) break;
      contextNode = ancestors.eq(index);
    }
  }
  const context = contextNode.clone();
  context.find("script,style,noscript,template,[hidden],[aria-hidden=true]").remove();
  const parent = squash(context.text(), 500);
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
  if (["input", "textarea", "select"].includes(tag)) {
    const cell = node?.closest("td");
    if (cell?.length) {
      const index = Number(cell.attr("data-index") ?? cell.index());
      const header = squash(cell.closest("table").find("thead tr").first().children("th,td").eq(index).text(), 100);
      if (header) return header;
    }
  }
  const text = elementText(node);
  if (text) return text;
  const icon = node?.find('[aria-label],svg title,img[alt]').first();
  const iconLabel = squash(icon?.attr("aria-label") || icon?.attr("alt") || icon?.text(), 100);
  if (iconLabel) return iconLabel;
  // A filename is a hint for otherwise unnamed icon controls, not an
  // accessible-name implementation. Preserve that distinction in the label.
  const src = node?.find("img[src]").first().attr("src");
  if (src) {
    const filename = src.split(/[/?#]/).filter(Boolean).at(-1) || "";
    const hint = filename.replace(/\.[^.]+$/, "").split(".")[0].replace(/[_-]+/g, " ");
    if (hint && /[a-z]/i.test(hint)) return `icon: ${hint}`;
  }
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

  const hiddenNode = (node) => !!node?.parents().addBack().toArray().some((el) =>
    $(el).attr("hidden") != null || $(el).attr("aria-hidden") === "true"
    || $(el).attr("inert") != null || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr("style") || ""));
  const activeDialog = $('[role="dialog"][aria-modal="true"]').filter((_, el) => !hiddenNode($(el))).last();

  // A blocking modal is the current interaction surface. Its background can
  // contain thousands of virtual table rows and otherwise bury the detail
  // fields beyond the model's text budget.
  const textRoot = (activeDialog.length ? activeDialog : $("body")).clone();
  textRoot.find("script,style,noscript,template").remove();
  textRoot.find('[hidden],[aria-hidden="true"],[inert]').remove();
  textRoot.find('[style]').each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr("style") || "")) $(el).remove();
  });
  textRoot.find("div,p,li,tr,th,td,label,h1,h2,h3,h4,button,a,section").each((_, el) => { $(el).prepend(" ").append(" "); });
  let pageText = squash(textRoot.text(), 10000);
  if (activeDialog.length) {
    const background = $("body").clone();
    background.find('script,style,noscript,template,[hidden],[aria-hidden="true"],[role="dialog"]').remove();
    background.find("div,p,li,label,h1,h2,h3,button,a").each((_, el) => { $(el).prepend(" ").append(" "); });
    // Preserve a small amount of app/organization context for contracts scoped
    // to a demo company, without restoring the background table's action space.
    pageText += ` Background context: ${squash(background.text(), 600)}`;
  }
  const elements = [];

  for (const raw of rawElements || []) {
    if (!raw?.visible || !raw.selector) continue;
    const node = safeQuery($, raw.selector);
    if (hiddenNode(node)) continue;
    if (activeDialog.length && !node?.closest('[role="dialog"][aria-modal="true"]').filter((_, el) => el === activeDialog[0]).length
        && !node?.closest('[role="listbox"],[role="menu"],[role="option"],[role="menuitem"]').length) continue;
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
      value: password ? "[REDACTED]" : (raw.value != null ? String(raw.value) : undefined),
      checked: raw.checked != null ? !!raw.checked : (node?.attr("checked") != null ? true : undefined),
      disabled: node?.attr("disabled") != null || node?.attr("aria-disabled") === "true",
      readonly: node?.attr("readonly") != null || node?.attr("aria-readonly") === "true",
      contenteditable: node?.attr("contenteditable") === "true",
      options,
      near: nearbyText(node) || undefined,
      bounds: raw.bounds,
    });
  }

  return {
    url: tab?.url || "",
    title: tab?.title || "",
    text: pageText + (elements.some((e) => e.value && e.label && e.type !== "password")
      ? ` Visible field values: ${elements.filter((e) => e.value && e.label && e.type !== "password" && !/(password|secret|token|api[-_]?key|otp|2fa|pin|cvv|cvc)/i.test([e.label, e.name].join(" "))).slice(0, 40).map((e) => `${e.label}: ${squash(e.value, 160)}`).join("; ")}` : ""),
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
  // Kapture assigns unique selectors while enumerating elements, which can
  // mutate the live DOM. Read the HTML only after the selectors exist.
  const raw = await kapture.elements(tabId, INTERACTIVE_SELECTOR);
  const dom = await kapture.dom(tabId);
  // Recent Kapture responses include tab metadata: avoid a third HTTP request.
  // Older or mocked clients fall back to tab_detail.
  const tab = (dom?.url && dom?.title) ? dom : await kapture.tabDetail(tabId);

  const page = buildSemanticPage({
    tab,
    domHtml: dom?.html || dom?.outerHTML || dom?.dom || "",
    rawElements: raw?.elements || [],
  });
  const nativeToggles = page.elements.filter((e) => e.tag === "input" && ["checkbox", "radio"].includes(e.type));
  if (nativeToggles.length) {
    // checked is a live DOM property, not necessarily an HTML attribute.
    // CSS :checked reads it through Kapture's normal element tool, without
    // enabling arbitrary JavaScript execution for the tab.
    try {
      const checked = await kapture.elements(tabId, 'input[type="checkbox"]:checked,input[type="radio"]:checked');
      const selectors = new Set((checked?.elements || []).map((e) => e.selector));
      for (const element of nativeToggles) element.checked = selectors.has(element.selector);
    } catch {
      for (const element of nativeToggles) element.checked = undefined;
    }
  }
  return page;
}
