import test from "node:test";
import assert from "node:assert/strict";
import { repeatsBlock, elementFingerprint, toModelPage, brief, formatPage } from "../src/page-model.mjs";

test("repeatsBlock detects repeated cycles", () => {
  assert.equal(repeatsBlock(["a", "b", "a", "b", "a", "b"], 2, 3), true);
  assert.equal(repeatsBlock(["a", "b", "a", "c", "a", "b"], 2, 3), false);
});

test("element fingerprint is stable for semantic identity", () => {
  const a = { tag: "button", role: "button", label: "Save", near: "Invoice" };
  const b = { ...a, selector: "#changed" };
  assert.equal(elementFingerprint(a), elementFingerprint(b));
});

test("password values are redacted from model page", () => {
  const page = {
    url: "https://example.test",
    title: "Login",
    text: "Login",
    metrics: {},
    elements: [{ i: 0, tag: "input", role: "textbox", label: "Password", type: "password", value: "hunter2" }],
  };
  assert.equal(toModelPage(page).elements[0].value, "[REDACTED]");
});
test("model page leaves out empty and default fields without losing state", () => {
  const page = { url: "https://erp.test", title: "Invoice", text: "Invoice", metrics: { frame_count: 1 }, elements: [
    { i: 0, tag: "a", role: "link", label: "Invoices", text: "Invoices", placeholder: "", name: "", href: "/invoices", disabled: false, readonly: false, contenteditable: false, invalid: false, context: "Nav", scope: "", frame_id: "f1", form_key: "", record_key: "", validation_message: "" },
    { i: 1, tag: "input", role: "textbox", type: "text", label: "Quantity", text: "", value: "", checked: false, disabled: false, frame_id: "f1", form_key: "invoice", record_key: "line-1" },
    { i: 2, tag: "input", role: "checkbox", type: "checkbox", label: "Billable", value: "on", checked: false, frame_id: "f1" },
    { i: 3, tag: "select", role: "combobox", label: "Tax", value: "std-20", options: [{ text: "None", value: "none", selected: false, disabled: false }, { text: "Standard 20%", value: "std-20", selected: true, disabled: false }, { text: "Net 30", value: "Net 30", selected: false, disabled: true }] },
    { i: 4, tag: "button", role: "button", label: "Save", text: "Save", value: "", expanded: false, disabled: true },
    { i: 5, tag: "input", type: "password", label: "Password", text: "hunter2", value: "hunter2", near: "hunter2" },
  ] };
  assert.deepEqual(toModelPage(page).elements, [
    { i: 0, tag: "a", role: "link", label: "Invoices", href: "/invoices", context: "Nav" },
    { i: 1, tag: "input", role: "textbox", label: "Quantity", type: "text", value: "", form_key: "invoice", record_key: "line-1" },
    { i: 2, tag: "input", role: "checkbox", label: "Billable", type: "checkbox", value: "on", checked: false },
    { i: 3, tag: "select", role: "combobox", label: "Tax", value: "std-20", options: [{ text: "None", value: "none" }, { text: "Standard 20%", value: "std-20", selected: true }, { text: "Net 30", disabled: true }] },
    { i: 4, tag: "button", role: "button", label: "Save", disabled: true, expanded: false },
    { i: 5, tag: "input", label: "Password", type: "password", value: "[REDACTED]" },
  ]);
  assert.equal(toModelPage({ ...page, metrics: { frame_count: 2 } }).elements[0].frame_id, "f1");
});

test("a hint and a table column reach Jev; a hint names a field only when nothing else does", () => {
  const search = { i: 0, tag: "input", role: "textbox", type: "text", label: "", hint: "Search contacts, vendor bills..." };
  const qty = { i: 1, tag: "input", role: "textbox", label: "QTY", column: "QTY", value: "" };
  const page = { url: "https://erp.test", title: "Bills", text: "Bills", metrics: {}, elements: [search, qty] };
  assert.deepEqual(toModelPage(page).elements, [
    { i: 0, tag: "input", role: "textbox", hint: "Search contacts, vendor bills...", type: "text" },
    { i: 1, tag: "input", role: "textbox", label: "QTY", value: "", column: "QTY" },
  ]);
  assert.equal(brief(search), 'textbox "Search contacts, vendor bills..."');
  assert.equal(brief({ ...search, placeholder: "Keyword" }), 'textbox "Keyword"');
  assert.match(formatPage(page), /\[0\] <input> role=textbox type=text hint="Search contacts, vendor bills..."/);
});

test("the focused field's popup shows next to that field, never with a secret value", () => {
  const field = { i: 3, tag: "input", role: "textbox", label: "", hint: "Search contacts", value: "CP-MEIJI" };
  const page = { url: "https://erp.test", title: "Bills", text: "Vendor 1 CP-MEIJI CO.,LTD.", elements: [field, { i: 6, tag: "div", label: "CP-MEIJI CO.,LTD.", popup_of: 3 }], popup: { field: 3, text: "Vendor 1 CP-MEIJI CO.,LTD." } };
  const model = toModelPage(page);
  assert.deepEqual(model.popup, { field: '[3] textbox "Search contacts"', field_value: "CP-MEIJI", shows: "Vendor 1 CP-MEIJI CO.,LTD." });
  assert.equal(model.elements[1].popup_of, 3);
  const secret = toModelPage({ ...page, elements: [{ ...field, type: "password", label: "Password" }] });
  assert.equal(secret.popup.field_value, undefined);
  assert.equal(toModelPage({ ...page, popup: { field: 9, text: "x" } }).popup, undefined);
});
