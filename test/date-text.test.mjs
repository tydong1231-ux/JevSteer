import test from "node:test";
import assert from "node:assert/strict";
import { isDateText, sameDateText } from "../src/date-text.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";

test("date text covers the forms date pickers take, and not other numbers", () => {
  for (const text of ["2026/1/1", "2026-12-31", "2026.10.20", "2026-01-01 08:30", "2026-01-01T08:30:00", "10/20/2026", "20.10.26", "2026-10", "2026年1月1日", "2026年10月", "Oct 20, 2026", "20 October 2026", "Sept. 3 2026"]) {
    assert.equal(isDateText(text), true, text);
  }
  for (const text of ["", "2026", "1,234.56", "12/31", "INV-2026-10", "555-1234", "v1.5.2", "2026/1/1 to 2026/12/31", "Acme 2026/1/1"]) {
    assert.equal(isDateText(text), false, text);
  }
});

test("the same date in another padding or separator compares equal; another date or order never does", () => {
  assert.equal(sameDateText("2026/1/1", "2026-01-01"), true);
  assert.equal(sameDateText("2026年1月1日", "2026/01/01"), true);
  assert.equal(sameDateText("Oct 20, 2026", "october 20 2026"), true);
  assert.equal(sameDateText("2026/1/2", "1/2/2026"), false);
  assert.equal(sameDateText("2026/1/1", "2026/1/11"), false);
  assert.equal(sameDateText("2026-01-01 08:30", "2026-01-01"), false);
  assert.equal(sameDateText("100", "0100"), false);
});

test("a typed date the picker rewrote in its own format is confirmed; a reverted one fails", () => {
  const el = { tag: "input", name: "end", label: "End date", value: "2026/10/31", selector: "#end" };
  const before = { url: "https://erp.test/report", text: "Report", elements: [el] };
  const after = (value) => ({ ...before, elements: [{ ...el, value }] });
  const action = { tool: "type", el, expected_value: "2026/12/1" };
  assert.deepEqual(verifyActionEffect(before, after("2026/12/01"), action), { status: "confirmed", check: "field_value_date" });
  assert.deepEqual(verifyActionEffect(before, after("2026/12/1"), action), { status: "confirmed", check: "field_value" });
  assert.deepEqual(verifyActionEffect(before, after("2026/10/31"), action), { status: "failed", check: "field_value" });
});
