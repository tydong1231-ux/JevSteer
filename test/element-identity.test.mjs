import test from "node:test";
import assert from "node:assert/strict";
import { equivalentLink, findRemembered, locateAfterAction, pickTwin, rememberField, twinsOf } from "../src/element-identity.mjs";

const doc = { frame_id: "f1", document_id: "f1:0:1", identity_version: 2 };
const field = (i, context, extra = {}) => ({ i, ...doc, tag: "input", role: "textbox", label: "Credit limit", name: "credit", context, ...extra });
const page = (...elements) => ({ url: "https://erp.test/customers/1", elements });

test("a control re-found after input rewrote its surrounding text, only when it was unique without that text", () => {
  const before = page(field(0, "Credit limit Formatted: $0"));
  const after = page(field(0, "Credit limit Formatted: $7,500"));
  assert.equal(locateAfterAction(before.elements[0], after, before), after.elements[0]);
  assert.equal(locateAfterAction(before.elements[0], after), undefined);
});

test("equal unkeyed controls are never matched by label alone", () => {
  const before = page(field(0, "Row A 0.00"), field(1, "Row B 0.00"));
  const after = page(field(0, "Row A 10.00"), field(1, "Row B 0.00"));
  assert.equal(locateAfterAction(before.elements[0], after, before), undefined);
  // The untouched row still matches exactly.
  assert.equal(locateAfterAction(before.elements[1], after, before), after.elements[1]);
});

test("a remembered control is not re-found once an equal control appears", () => {
  const remembered = rememberField(field(0, "Line 1 total 0.00"), page(field(0, "Line 1 total 0.00")));
  assert.equal(remembered.loose, true);
  assert.equal(findRemembered(remembered, page(field(0, "Line 1 total 30.00"), field(1, ""))), undefined);
  assert.equal(findRemembered(remembered, page(field(0, "Line 1 total 30.00"))).i, 0);
});

test("record keys, forms and documents still separate controls without context", () => {
  const before = page(field(0, "a", { record_key: "line-1" }), field(1, "b", { record_key: "line-2" }));
  const after = page(field(0, "a changed", { record_key: "line-1" }), field(1, "b", { record_key: "line-2" }));
  assert.equal(locateAfterAction(before.elements[0], after, before), after.elements[0]);
  const otherDocument = page({ ...field(0, "a changed", { record_key: "line-1" }), document_id: "f1:1:2" });
  assert.equal(locateAfterAction(before.elements[0], otherDocument, before), undefined);
});

test("identical controls are told apart by what they show, never by their order", () => {
  const select = (i, extra = {}) => ({ i, ...doc, tag: "input", role: "combobox", label: "", context: "", ...extra });
  const filters = page(select(0, { hint: "Status" }), select(1, { hint: "Vendor" }), field(2, "Amount"));
  const twins = twinsOf(filters.elements[1], filters);
  assert.equal(twins.count, 2);
  assert.equal(twins.distinct, true);
  assert.equal(twinsOf(filters.elements[2], filters), undefined);
  // Another document's copy is not a twin.
  assert.equal(twinsOf(filters.elements[0], page(filters.elements[0], { ...select(1), document_id: "f1:1:2" })), undefined);
  // The page swapped them: the one showing "Vendor" is still the one chosen.
  const swapped = page(select(0, { hint: "Vendor" }), select(1, { hint: "Status" }));
  assert.equal(pickTwin(twins, swapped.elements), swapped.elements[0]);
  // Two that nothing observed tells apart are never picked, swapped or not.
  const same = page(select(0), select(1));
  assert.equal(twinsOf(same.elements[1], same).distinct, false);
  assert.equal(pickTwin(twinsOf(same.elements[1], same), same.elements), undefined);
  // Nor is one whose look another twin took on.
  assert.equal(pickTwin(twins, [select(0, { hint: "Vendor" }), select(1, { hint: "Vendor" })]), undefined);
  // When one is left, it is still picked only by its look: it may be the other.
  assert.equal(pickTwin(twins, [select(0, { hint: "Status" })]), undefined);
  assert.equal(pickTwin(twins, [select(0, { hint: "Vendor" })]).hint, "Vendor");
});

test("a combobox's twins can be told apart leaving out which one is open, as an open list can move", () => {
  const box = (i, extra = {}) => ({ i, ...doc, tag: "input", role: "combobox", label: "Tags", context: "", ...extra });
  const before = page(box(0, { expanded: true }), box(1, { expanded: false, display: "Urgent" }));
  const owner = twinsOf(before.elements[0], before, { ignore: ["expanded"] });
  assert.equal(owner.distinct, true);
  // The open list moved to the twin: the chosen one is still the empty one.
  const moved = page(box(0, { expanded: false }), box(1, { expanded: true, display: "Urgent" }));
  assert.equal(pickTwin(owner, moved.elements), moved.elements[0]);
  // Told apart only by which one is open: never picked.
  const open = page(box(0, { expanded: true }), box(1, { expanded: false }));
  assert.equal(twinsOf(open.elements[0], open).distinct, true);
  assert.equal(twinsOf(open.elements[0], open, { ignore: ["expanded"] }).distinct, false);
});

test("of two links to one address, the one clicked is the node Jev saw; links rebuilt since are not told apart", () => {
  const link = (i, node, extra = {}) => ({ i, ...doc, node, tag: "a", role: "link", label: "100", text: "100", href: "/w/index.php?limit=100", context: "(20 | 50 | 100)", ...extra });
  const base = "https://en.wikipedia.org/w/index.php?action=history";
  // The page moved the bottom pager above the top one: still the node seen.
  assert.equal(equivalentLink(link(1, "t:2"), [link(0, "t:2"), link(1, "t:1")], base).i, 0);
  // The only one left is the node seen.
  assert.equal(equivalentLink(link(1, "t:2"), [link(0, "t:2")], base).i, 0);
  // Rebuilt: neither is the node seen.
  assert.equal(equivalentLink(link(1, "t:2"), [link(0, "u:1"), link(1, "u:2")], base), undefined);
  // Without node numbers (Kapture), or for other links, nothing is picked.
  assert.equal(equivalentLink(link(1, undefined), [link(0, undefined), link(1, undefined)], base), undefined);
  assert.equal(equivalentLink(link(1, "t:2", { href: "#more" }), [link(0, "t:1", { href: "#more" }), link(1, "t:2", { href: "#more" })], base), undefined);
  assert.equal(equivalentLink(link(1, "t:2"), [link(0, "t:1", { link_target: "_blank" }), link(1, "t:2")], base), undefined);
});
