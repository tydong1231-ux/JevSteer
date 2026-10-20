import { createHash } from "node:crypto";
import { brief, elementFingerprint, pageDiff, squash } from "./page-model.mjs";
import { locateAfterAction } from "./element-identity.mjs";
import { sameDateText } from "./date-text.mjs";

// Kapture snapshots give rich-text editors and custom textboxes no value; their
// content is element text, whitespace-collapsed and cut to this many chars.
const TEXT_CHARS = 180;

const digest = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");

function findAfter(after, action, before) {
  if (!action?.el) return undefined;
  if (action.el.identity_version) return locateAfterAction(action.el, after, before);
  const bySelector = after.elements?.find((e) => e.selector && e.selector === action.el.selector);
  if (bySelector) return bySelector;
  const fingerprint = elementFingerprint(action.el);
  const matches = (after.elements || []).filter((e) => elementFingerprint(e) === fingerprint);
  return matches.length === 1 ? matches[0] : undefined;
}

export function verifyActionEffect(before, after, action) {
  if (!before || !after || !action) return undefined;
  const changed = pageDiff(before, after) !== "no obvious visible change";
  const current = findAfter(after, action, before);

  if (action.tool === "type") {
    const secret = action.el?.type === "password" || current?.value === "[REDACTED]";
    if (!current) return { status: "unknown", check: secret ? "field_value_redacted" : "field_value" };
    if (current.invalid) return { status: "failed", check: "field_validation" };
    if (secret) {
      // Secret values are never compared as text. The Playwright snapshot keeps
      // a digest of the live value, which still confirms or rejects the fill.
      if (!current.value_hash) return { status: "unknown", check: "field_value_redacted" };
      return { status: current.value_hash === digest(action.expected_value) ? "confirmed" : "failed", check: "field_value_hash" };
    }
    const native = current.tag === "input" || current.tag === "textarea";
    const asText = !native && current.value == null && current.text != null;
    const actual = asText ? squash(current.text, TEXT_CHARS) : String(current.value ?? "");
    const expected = asText ? squash(action.expected_value, TEXT_CHARS) : String(action.expected_value ?? "");
    if (actual === expected) return { status: "confirmed", check: "field_value" };
    // A date picker rewrites a committed date in its own format: 2026/01/01.
    if (sameDateText(actual, expected)) return { status: "confirmed", check: "field_value_date" };
    return { status: "failed", check: "field_value" };
  }

  if (action.tool === "select") {
    if (action.el?.tag !== "select") return verifyActionEffect(before, after, { ...action, tool: "click" });
    if (!current) return { status: "unknown", check: "selected_value" };
    const selected = current.options?.find((o) => o.selected);
    const actual = String(selected?.value ?? selected?.text ?? current.value ?? "");
    const expected = String(action.expected_value ?? "");
    return { status: actual === expected ? "confirmed" : "failed", check: "selected_value" };
  }

  if (action.tool === "click" && typeof action.el?.expanded === "boolean" && typeof current?.expanded === "boolean") {
    return { status: current.expanded !== action.el.expanded ? "confirmed" : "unknown", check: "expanded_state" };
  }

  if (action.tool === "click" && action.el?.role === "option") {
    const combos = after.elements.filter((e) => e.role === "combobox");
    const expected = action.el.text || action.el.label;
    if (combos.length === 1 && expected && [combos[0].value, combos[0].text, ...((combos[0].options || []).filter((o) => o.selected).map((o) => o.text))].includes(expected)) {
      return { status: "confirmed", check: "combobox_selection" };
    }
  }

  // A checkable control's own state is its effect, even inside a form or a
  // link. Only when the click loaded another page is that load the effect.
  if (action.tool === "click" && (["checkbox", "radio"].includes(action.el?.type) || ["checkbox", "radio", "switch"].includes(action.el?.role))
      && typeof action.el?.checked === "boolean") {
    if (typeof current?.checked === "boolean") return { status: current.checked !== action.el.checked ? "confirmed" : "failed", check: "checked_state" };
    if (!current && before.url !== after.url) return { status: "confirmed", check: "navigation" };
  }

  if (action.tool === "click" && (action.tag === "a" || action.role === "link" || action.el?.form_action)) {
    return { status: before.url !== after.url ? "confirmed" : (changed ? "changed" : "unknown"), check: "navigation" };
  }

  if (action.tool === "press_enter" && (action.el?.type === "search" || action.el?.role === "searchbox")) {
    return { status: before.url !== after.url ? "confirmed" : (changed ? "changed" : "unknown"), check: "navigation" };
  }

  if (["click", "press_enter", "press_key", "hover", "scroll"].includes(action.tool)) {
    return { status: changed ? "changed" : "unknown", check: "page_change" };
  }

  return { status: "unknown", check: "none" };
}

// What a click did when all it did was close something. A popup, menu or list
// that is open takes a click outside it: it closes, and the page need not
// pass the click on to what it was aimed at. ccMonet's bill rows opened
// nothing when clicked while a filter popup, or the global search's results,
// were open; Jev then waited for a bill that was not coming. Such a click
// took controls away and added none, on the same address, with a few new
// words at most (a field's placeholder shows again once it loses focus); the
// page sent no request, and the click's target is still there, as it was:
// a toggle that shows its own popup open (aria-expanded) or changes its own
// state took the click itself. Each control that went was in an open popup
// (`layer`, Playwright driver: a field's popup, or a box with a popup's role
// such as antd's popover), and no control is left in it: it closed. A
// section that a button collapses without showing any state of its own is
// no popup, and a second click would open it again (Codex on 440e142).
// Returns how many controls went, and a few of them.
export function closedOnly(before, after, action) {
  if (action?.tool !== "click" || !before || !after || before.url !== after.url) return undefined;
  if (after.requests_since_input !== 0 || after.pending_requests > 0 || after.loading?.busy) return undefined;
  const target = findAfter(after, action, before);
  if (!target || action.el?.expanded === true) return undefined;
  if (["expanded", "checked", "selected"].some((key) => (target[key] ?? null) !== (action.el?.[key] ?? null))) return undefined;
  const left = new Map();
  for (const e of after.elements) left.set(elementFingerprint(e), (left.get(elementFingerprint(e)) || 0) + 1);
  const gone = [];
  for (const e of before.elements) {
    const key = elementFingerprint(e);
    if (left.get(key)) left.set(key, left.get(key) - 1);
    else gone.push(e);
  }
  // What is still counted in `left` was not there before.
  if (!gone.length || [...left.values()].some((n) => n > 0)) return undefined;
  const popups = new Set(gone.map((e) => e.layer));
  if (popups.has(undefined) || popups.has(null) || after.elements.some((e) => e.layer != null && popups.has(e.layer))) return undefined;
  const words = new Set(squash(before.text, 6000).split(" "));
  if (squash(after.text, 6000).split(" ").filter((w) => w && !words.has(w)).length > 3) return undefined;
  return { controls_gone: gone.length, such_as: gone.slice(0, 3).map((e) => brief(e)) };
}
