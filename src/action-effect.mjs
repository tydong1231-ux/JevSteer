import { elementFingerprint, pageDiff } from "./page-model.mjs";

function findAfter(after, action) {
  if (!action?.el) return undefined;
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
    if (!current) return { status: changed ? "changed" : "unknown", check: "field_value" };
    const actual = String(current.value ?? "");
    const expected = String(action.expected_value ?? "");
    return { status: actual === expected ? "confirmed" : "failed", check: "field_value" };
  }

  if (action.tool === "select") {
    if (!current) return { status: changed ? "changed" : "unknown", check: "selected_value" };
    const selected = current.options?.find((o) => o.selected);
    const actual = String(selected?.value ?? selected?.text ?? current.value ?? "");
    const expected = String(action.expected_value ?? "");
    return { status: !expected || actual === expected ? "confirmed" : "failed", check: "selected_value" };
  }

  if (action.tool === "click" && (action.tag === "a" || action.role === "link")) {
    return { status: before.url !== after.url ? "confirmed" : (changed ? "changed" : "unknown"), check: "navigation" };
  }

  if (["click", "press_enter", "press_key", "hover", "scroll"].includes(action.tool)) {
    return { status: changed ? "changed" : "unknown", check: "page_change" };
  }

  return { status: "unknown", check: "none" };
}
