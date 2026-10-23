import test from "node:test";
import assert from "node:assert/strict";
import { numericField, sameNumberText } from "../src/number-text.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";

// Each pair is what was typed, then what the field shows.
test("a field that groups the digits typed, or adds zeros after the point, shows the number typed; another number never does", () => {
  for (const numeric of [false, true]) {
    for (const [typed, shown] of [["5000", "5,000"], ["5000", "5,000.00"], ["5000", "5 000"], ["5000", "5\u00a0000"], ["5000", "5\u202f000"], ["1234567.5", "1,234,567.50"], ["-5000", "-5,000"], ["100", "100.0"], [".5", "0.50"], ["5.", "5"], ["5", "5."]]) {
      assert.equal(sameNumberText(shown, typed, { numeric }), true, `${typed} ${shown}`);
    }
    // A grouping mark that does not part groups of three, a currency or
    // unit, another number, or text that is no plain number.
    for (const [a, b] of [["5000", "5,00"], ["5000", "50,00"], ["12345", "1,2345"], ["5000", "5.000"], ["1234.56", "1.234,56"], ["5000", "$5,000"], ["5000", "5000 USD"], ["5000", "5001"], ["0.1", "10%"], ["1000", "1e3"], ["", "0"], ["abc", "abc"], ["2026/1/1", "202611"]]) {
      assert.equal(sameNumberText(a, b, { numeric }), false, `${a} ${b}`);
      assert.equal(sameNumberText(b, a, { numeric }), false, `${b} ${a}`);
    }
  }
});

// A text field that shows 123 for a typed 00123 cut a reference short; one
// that shows 10% for 10 changed what it holds, and one that shows 1 for 1.0
// cut a version short (Codex on b2d32ae and 7519fff). Only a field the page
// says holds a number reads them as the same number.
test("a text field never takes away what was typed: leading zeros, a sign, zeros after the point, grouping marks", () => {
  for (const [typed, shown] of [["00123", "123"], ["007", "7"], ["10", "10%"], ["10%", "10"], ["+5", "5"], ["-0", "0.00"], ["+6591234567", "6591234567"], ["1.0", "1"], ["1.00", "1.0"], ["0.10", ".1"], ["5,000", "5000"], ["5,000", "5,000.00"]]) {
    assert.equal(sameNumberText(shown, typed), false, `${typed} ${shown}`);
    assert.equal(sameNumberText(shown, typed, { numeric: true }), true, `${typed} ${shown}`);
    assert.equal(sameNumberText(typed, shown, { numeric: true }), true, `${shown} ${typed}`);
  }
  assert.deepEqual([{ type: "number" }, { role: "spinbutton" }, { tag: "input", type: "text", role: "textbox" }, undefined].map(numericField), [true, true, false, false]);
});

// A JavaScript number keeps about 16 digits: read as numbers, a long account
// or reference number and one a digit off compared equal (Codex on 3fa0a57).
test("numbers are compared digit by digit, however many digits they have", () => {
  for (const numeric of [false, true]) {
    for (const [a, b] of [["9007199254740992", "9,007,199,254,740,993"], ["12345678901234567890", "12345678901234567891"], ["0.1", "0.1000000000000000055511151231257827"], ["1.0000000000000001", "1"]]) {
      assert.equal(sameNumberText(a, b, { numeric }), false, `${a} ${b}`);
      assert.equal(sameNumberText(b, a, { numeric }), false, `${b} ${a}`);
    }
    for (const [typed, shown] of [["9007199254740993", "9,007,199,254,740,993"], ["12345678901234567890", "12 345 678 901 234 567 890.000"], ["5.", "5"], [".1", "0.10"]]) {
      assert.equal(sameNumberText(shown, typed, { numeric }), true, `${typed} ${shown}`);
    }
  }
});

// ccMonet's Unit Price showed the typed 5000 as "5,000", and the run stopped
// on a failed effect (Mac run on 9a83708).
test("a typed number the field shows with its digits grouped is confirmed; another number fails", () => {
  const el = { tag: "input", label: "Unit Price", column: "Unit Price", row: 1, value: "", selector: "#price" };
  const before = { url: "https://erp.test/invoice", text: "Invoice", elements: [el] };
  const after = (value) => ({ ...before, elements: [{ ...el, value }] });
  const action = { tool: "type", el, expected_value: "5000" };
  assert.deepEqual(verifyActionEffect(before, after("5,000"), action), { status: "confirmed", check: "field_value_number" });
  assert.deepEqual(verifyActionEffect(before, after("5000"), action), { status: "confirmed", check: "field_value" });
  assert.deepEqual(verifyActionEffect(before, after("500"), action), { status: "failed", check: "field_value" });
  // Zeros the field adds after the point are fine; a reference or a version
  // cut short fails; a field that holds a number may drop zeros.
  assert.deepEqual(verifyActionEffect(before, after("5,000.00"), action), { status: "confirmed", check: "field_value_number" });
  assert.deepEqual(verifyActionEffect(before, after("123"), { ...action, expected_value: "00123" }), { status: "failed", check: "field_value" });
  assert.deepEqual(verifyActionEffect(before, after("1"), { ...action, expected_value: "1.0" }), { status: "failed", check: "field_value" });
  const quantity = { tag: "input", type: "number", role: "spinbutton", label: "Quantity", value: "", selector: "#qty" };
  const counted = { url: "https://erp.test/invoice", text: "Invoice", elements: [quantity] };
  assert.deepEqual(verifyActionEffect(counted, { ...counted, elements: [{ ...quantity, value: "7" }] }, { tool: "type", el: quantity, expected_value: "007" }), { status: "confirmed", check: "field_value_number" });
});
