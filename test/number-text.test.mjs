import test from "node:test";
import assert from "node:assert/strict";
import { sameNumberText } from "../src/number-text.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";

test("the same number with its digits grouped, or with decimals or a percent sign added, compares equal; another number never does", () => {
  for (const [a, b] of [["5000", "5,000"], ["5000", "5,000.00"], ["5000", "5 000"], ["5000", "5 000"], ["1234567.5", "1,234,567.50"], ["-5000", "-5,000"], ["100", "100.0"], ["10", "10%"], [".5", "0.50"]]) {
    assert.equal(sameNumberText(a, b), true, `${a} ${b}`);
    assert.equal(sameNumberText(b, a), true, `${b} ${a}`);
  }
  // A grouping mark that does not part groups of three, a currency or unit,
  // another number, or text that is no plain number.
  for (const [a, b] of [["5000", "5,00"], ["5000", "50,00"], ["12345", "1,2345"], ["5000", "5.000"], ["1234.56", "1.234,56"], ["5000", "$5,000"], ["5000", "5000 USD"], ["5000", "5001"], ["0.1", "10%"], ["1000", "1e3"], ["", "0"], ["abc", "abc"], ["2026/1/1", "202611"]]) {
    assert.equal(sameNumberText(a, b), false, `${a} ${b}`);
  }
});

// A JavaScript number keeps about 16 digits: read as numbers, a long account
// or reference number and one a digit off compared equal (Codex on 3fa0a57).
test("numbers are compared digit by digit, however many digits they have", () => {
  for (const [a, b] of [["9007199254740992", "9,007,199,254,740,993"], ["12345678901234567890", "12345678901234567891"], ["0.1", "0.1000000000000000055511151231257827"], ["1.0000000000000001", "1"]]) {
    assert.equal(sameNumberText(a, b), false, `${a} ${b}`);
    assert.equal(sameNumberText(b, a), false, `${b} ${a}`);
  }
  for (const [a, b] of [["9007199254740993", "9,007,199,254,740,993"], ["12345678901234567890", "12 345 678 901 234 567 890.000"], ["+5", "5"], ["-0", "0.00"], ["007", "7"], ["5.", "5"], ["0.10", ".1"]]) {
    assert.equal(sameNumberText(a, b), true, `${a} ${b}`);
    assert.equal(sameNumberText(b, a), true, `${b} ${a}`);
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
});
