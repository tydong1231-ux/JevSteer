import { elementFingerprint, pageDiff } from "./page-model.mjs";
import { locateSameElement } from "./element-identity.mjs";

function findAfter(after, action) {
  if (!action?.el) return undefined;
  if (action.el.identity_version) return locateSameElement(action.el, after);
  const bySelector = after.elements?.find((e) => e.selector && e.selector === action.el.selector);
  if (bySelector) return bySelector;
  const fingerprint = elementFingerprint(action.el);
  const matches = (after.elements || []).filter((e) => elementFingerprint(e) === fingerprint);
  return matches.length === 1 ? matches[0] : undefined;
}

export function verifyActionEffect(before, after, action) {
  if (!before || !after || !action) return undefined;
  const changed = pageDiff(before, after) !== "no obvious visible change";
  const current = findAfter(after, action);

  if (action.tool === "type") {
    if (action.el?.type === "password") return { status: "unknown", check: "field_value_redacted" };
    if (!current) return { status: "unknown", check: "field_value" };
    if (current.invalid) return { status: "failed", check: "field_validation" };
    const actual = String(current.value ?? "");
    const expected = String(action.expected_value ?? "");
    return { status: actual === expected ? "confirmed" : "failed", check: "field_value" };
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

  if (action.tool === "click" && (action.tag === "a" || action.role === "link")) {
    return { status: before.url !== after.url ? "confirmed" : (changed ? "changed" : "unknown"), check: "navigation" };
  }

  if (action.tool === "click" && (["checkbox", "radio"].includes(action.el?.type) || ["checkbox", "radio", "switch"].includes(action.el?.role))
      && typeof current?.checked === "boolean" && typeof action.el?.checked === "boolean") {
    return { status: current.checked !== action.el.checked ? "confirmed" : "failed", check: "checked_state" };
  }

  if (["click", "press_enter", "press_key", "hover", "scroll"].includes(action.tool)) {
    return { status: changed ? "changed" : "unknown", check: "page_change" };
  }

  return { status: "unknown", check: "none" };
}
