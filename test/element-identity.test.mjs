import test from "node:test";
import assert from "node:assert/strict";
import { findRemembered, locateAfterAction, rememberField, twinsOf } from "../src/element-identity.mjs";

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

test("identical controls are told apart only by their order", () => {
  const select = (i) => ({ i, ...doc, tag: "input", role: "combobox", label: "", context: "" });
  const filters = page(select(0), select(1), field(2, "Amount"));
  assert.deepEqual(twinsOf(filters.elements[1], filters), { index: 1, count: 2 });
  assert.equal(twinsOf(filters.elements[2], filters), undefined);
  // Another document's copy is not a twin.
  assert.equal(twinsOf(filters.elements[0], page(filters.elements[0], { ...select(1), document_id: "f1:1:2" })), undefined);
});
