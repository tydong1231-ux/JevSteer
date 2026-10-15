import { load } from "cheerio";
import { squash } from "./page-model.mjs";
import { sensitiveField } from "./sensitive.mjs";

const MODAL_SELECTOR = 'dialog[open],[role="dialog"][aria-modal="true"]';

export const INTERACTIVE_SELECTOR = [
  MODAL_SELECTOR,
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

function labelText(node) {
  if (!node?.length) return "";
  const copy = node.clone();
  copy.find("input,textarea,select,button,script,style,[hidden],[aria-hidden=true]").remove();
  return elementText(copy);
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
  context.find("input,textarea,select,script,style,noscript,template,[hidden],[aria-hidden=true]").remove();
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

  const id = node?.attr("id") || raw.id;
  if (id) {
    let explicit = "";
    try {
      explicit = labelText($("label[for]").filter((_, el) => $(el).attr("for") === id).first());
    } catch {}
    if (explicit) return explicit;
  }

  const wrapping = labelText(node?.closest("label"));
  if (wrapping) return wrapping;
  const placeholder = squash(node?.attr("placeholder") || node?.attr("data-placeholder"), 180);
  if (placeholder) return placeholder;
  if (["input", "textarea", "select"].includes(tag)) {
    const cell = node?.closest("td");
    if (cell?.length) {
      const index = Number(cell.attr("data-index") ?? cell.index());
      const header = squash(cell.closest("table").find("thead tr").first().children("th,td").eq(index).text(), 100);
      if (header) return header;
    }
  }
  const text = ["input", "textarea", "select"].includes(tag) || node?.attr("contenteditable") === "true" ? "" : elementText(node);
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

function semanticScope($, node) {
  const parts = [];
  for (const el of node.parents('dialog,[role="dialog"],form,fieldset,section,[role="group"]').toArray().reverse()) {
    const owner = $(el);
    const referenced = (owner.attr("aria-labelledby") || "").split(/\s+/).map((id) => findById($, id)?.text()).filter(Boolean).join(" ");
    const title = owner.attr("aria-label") || referenced || owner.children("legend,h1,h2,h3,h4").first().text() || owner.attr("name");
    if (title) parts.push(squash(title, 120));
  }
  return parts.join(" > ");
}

function recordContext($, node) {
  const textWithoutActions = (record) => {
    const clone = record.clone();
    clone.find('button,input,textarea,select,[role="button"]:not(a[href]),script,style,[hidden],[aria-hidden="true"]').remove();
    return squash(clone.text(), 501);
  };
  const record = node.closest('tr,[role="row"],[role="listitem"],article,li');
  if (record?.length) return squash(textWithoutActions(record), 500);
  if (!node.is('button,a,[role="button"],[role="link"]')) return "";
  // Repeated cards are often plain DIVs rather than semantic list items.
  // Use the nearest compact repeated sibling container with independent text;
  // do not identify a record from button text, DOM position or vendor classes.
  const shape = (el) => `${el.prop("tagName")}|${(el.attr("class") || "").split(/\s+/).filter(Boolean).sort().join(" ")}`;
  for (const parent of node.parents().slice(0, 6).toArray()) {
    const candidate = $(parent);
    if (candidate.is("body,html,form,nav,header,footer")) break;
    const text = textWithoutActions(candidate);
    if (!text || text.length > 500) continue;
    const controls = candidate.find('button,input,textarea,select,[role="button"]:not(a[href])').length;
    if (controls && candidate.siblings().filter((_, el) => shape($(el)) === shape(candidate)
        && $(el).find('button,input,textarea,select,[role="button"]:not(a[href])').length === controls).length) return text;
  }
  return "";
}

export function buildSemanticPage({ tab, domHtml, rawElements }) {
  const $ = load(domHtml || "<html><body></body></html>");
  redactPasswordAttrs($);

  const hiddenNode = (node) => !!node?.parents().addBack().toArray().some((el) =>
    $(el).attr("hidden") != null || $(el).attr("aria-hidden") === "true"
    || $(el).attr("inert") != null || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr("style") || ""));
  const modalSelector = MODAL_SELECTOR;
  // Ask Kapture for the containers themselves: class-based CSS hiding cannot
  // be inferred from HTML attributes, and a visible dialog may contain only text.
  const measured = (rawElements || []).map((raw) => ({ raw, node: safeQuery($, raw.selector)?.[0] }));
  const visibleDialog = (el) => {
    const node = $(el);
    if (hiddenNode(node)) return false;
    const container = measured.find((item) => item.node === el);
    if (typeof container?.raw.visible === "boolean") return container.raw.visible;
    // Compatibility with older snapshots that enumerated interactive children
    // only. Native open dialogs remain foreground even without any controls.
    return node.is("dialog[open]") || measured.some((item) => item.raw.visible
      && item.node && $(item.node).parents().toArray().includes(el));
  };
  const dialogs = $(modalSelector);
  const activeDialog = dialogs.filter((_, el) => visibleDialog(el)).last();
  // Hidden modal templates must not leak their labels/options into page text.
  dialogs.filter((_, el) => !visibleDialog(el)).remove();

  // A blocking modal is the current interaction surface. Its background can
  // contain thousands of virtual table rows and otherwise bury the detail
  // fields beyond the model's text budget.
  const textRoot = (activeDialog.length ? activeDialog : $("body")).clone();
  textRoot.find("script,style,noscript,template").remove();
  textRoot.find("textarea").each((_, el) => {
    const node = $(el);
    if (sensitiveField({ name: node.attr("name"), label: node.attr("aria-label"), placeholder: node.attr("placeholder") })) node.text("[REDACTED]");
  });
  textRoot.find('[hidden],[aria-hidden="true"],[inert]').remove();
  textRoot.find('[style]').each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr("style") || "")) $(el).remove();
  });
  textRoot.find("div,p,li,tr,th,td,label,h1,h2,h3,h4,button,a,section").each((_, el) => { $(el).prepend(" ").append(" "); });
  let pageText = squash(textRoot.text(), 10000);
  let backgroundContext;
  if (activeDialog.length) {
    const background = $("body").clone();
    background.find('script,style,noscript,template,[hidden],[aria-hidden="true"],dialog,[role="dialog"]').remove();
    background.find("div,p,li,label,h1,h2,h3,button,a").each((_, el) => { $(el).prepend(" ").append(" "); });
    // Preserve a small amount of app/organization context for contracts scoped
    // to a demo company, without restoring the background table's action space.
    backgroundContext = squash(background.text(), 600);
  }
  const elements = [];

  for (const raw of rawElements || []) {
    if (!raw?.visible || !raw.selector) continue;
    const node = safeQuery($, raw.selector);
    // A raw element absent from this HTML may belong to a replaced DOM,
    // unsupported iframe or shadow root. Never invent its semantics.
    if (!node?.length) continue;
    if (hiddenNode(node)) continue;
    if (activeDialog.length && !node?.closest(modalSelector).filter((_, el) => el === activeDialog[0]).length
        && !node?.closest('[role="listbox"],[role="menu"],[role="option"],[role="menuitem"]').length) continue;
    const tag = String(raw.tagName || node?.prop("tagName") || "element").toLowerCase();
    if (node.is(modalSelector)) continue; // Visibility evidence, not an action target.
    const type = squash(node?.attr("type") || "", 40).toLowerCase() || undefined;
    const role = inferRole(tag, type, squash(node?.attr("role"), 60) || undefined);
    const password = type === "password";
    const label = labelFor($, node, raw, tag, type);
    const text = ["input", "textarea", "select"].includes(tag) ? "" : elementText(node);
    const options = Array.isArray(raw.options) ? raw.options.map((o) => ({
      text: squash(o.text, 100),
      value: String(o.value ?? ""),
      selected: !!o.selected,
      disabled: !!o.disabled,
    })) : undefined;
    const form = node.attr("form") ? findById($, node.attr("form")) : node.closest("form");
    const submits = tag === "button" && !["button", "reset"].includes(type)
      || tag === "input" && ["submit", "image"].includes(type);
    let formAction;
    const declaredAction = node.attr("formaction") || form?.attr("action");
    if (submits && form?.length && declaredAction
        && String(node.attr("formmethod") || form.attr("method") || "get").toLowerCase() === "get") {
      try {
        const destination = new URL(declaredAction, tab?.url);
        if (["http:", "https:"].includes(destination.protocol)) formAction = destination.href;
      } catch {}
    }

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
      ...(formAction ? { form_action: formAction } : {}),
      value: password ? "[REDACTED]" : (raw.value != null ? String(raw.value) : undefined),
      checked: raw.checked != null ? !!raw.checked : (["true", "false"].includes(node?.attr("aria-checked")) ? node.attr("aria-checked") === "true" : (node?.attr("checked") != null ? true : undefined)),
      disabled: node?.attr("disabled") != null || node?.attr("aria-disabled") === "true",
      readonly: node?.attr("readonly") != null || node?.attr("aria-readonly") === "true",
      contenteditable: node?.attr("contenteditable") === "true",
      options,
      near: nearbyText(node) || undefined,
      context: recordContext($, node) || undefined,
      scope: semanticScope($, node) || undefined,
      identity_version: 1,
      invalid: node?.attr("aria-invalid") === "true",
      expanded: ["true", "false"].includes(node?.attr("aria-expanded")) ? node.attr("aria-expanded") === "true" : undefined,
      selected: ["true", "false"].includes(node?.attr("aria-selected")) ? node.attr("aria-selected") === "true" : undefined,
      validation_message: (node?.attr("aria-errormessage") || "").split(/\s+/).map((id) => elementText(findById($, id))).filter(Boolean).join(" ") || undefined,
      bounds: raw.bounds,
    });
  }

  for (const e of elements) {
    if (!sensitiveField(e) || !e.value || e.value === "[REDACTED]") continue;
    pageText = pageText.split(e.value).join("[REDACTED]");
    if (backgroundContext) backgroundContext = backgroundContext.split(e.value).join("[REDACTED]");
  }
  return {
    url: tab?.url || "",
    title: tab?.title || "",
    ...(backgroundContext ? { background_context: backgroundContext } : {}),
    loading: {
      busy: textRoot.find('[aria-busy="true"],[role="progressbar"]').length > 0 || textRoot.attr("aria-busy") === "true",
    },
    text: pageText + (elements.some((e) => e.value && e.label && e.type !== "password")
      ? ` Visible field values: ${elements.filter((e) => e.value && e.label && !sensitiveField(e)).slice(0, 40).map((e) => `${e.label}: ${squash(e.value, 160)}`).join("; ")}` : ""),
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
  if (raw?.url && dom?.url && raw.url !== dom.url) throw new Error("SNAPSHOT_CHANGED: page navigated during observation");
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
