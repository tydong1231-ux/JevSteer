import { elementFingerprint, pageDiff, squash } from "./page-model.mjs";

// Snapshot values are whitespace-collapsed and truncated (see
// semantic-snapshot.mjs), so expected values are normalized the same way
// before comparison. Otherwise multi-line or long text always "fails".
const VALUE_CHARS = 160;
const TEXT_CHARS = 180;

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
    // Native fields report a value (an empty field has none in the snapshot,
    // so a fill that did not take still fails). Rich-text editors and custom
    // textboxes have no value and expose their content as text instead.
    const native = current.tag === "input" || current.tag === "textarea";
    const useText = !native && current.value == null;
    const limit = useText ? TEXT_CHARS : VALUE_CHARS;
    const actual = squash(useText ? current.text : current.value, limit);
    const expected = squash(action.expected_value, limit);
    return { status: actual === expected ? "confirmed" : "failed", check: "field_value" };
  }

  if (action.tool === "select") {
    if (!current) return { status: changed ? "changed" : "unknown", check: "selected_value" };
    const selected = current.options?.find((o) => o.selected);
    const expected = squash(action.expected_value, 100);
    const matches = !expected
      || squash(selected?.value ?? current.value, 100) === expected
      || (selected?.text != null && squash(selected.text, 100).toLowerCase() === expected.toLowerCase());
    return { status: matches ? "confirmed" : "failed", check: "selected_value" };
  }

  if (action.tool === "click" && (action.tag === "a" || action.role === "link")) {
    return { status: before.url !== after.url ? "confirmed" : (changed ? "changed" : "unknown"), check: "navigation" };
  }

  if (["click", "press_enter", "press_key", "hover", "scroll"].includes(action.tool)) {
    return { status: changed ? "changed" : "unknown", check: "page_change" };
  }

  return { status: "unknown", check: "none" };
}
