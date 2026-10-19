import test from "node:test";
import assert from "node:assert/strict";
import { countsReferenced, reviewedState, withoutToasts } from "../src/observation.mjs";
import { evaluateAssertions } from "../src/verification.mjs";
import { MemoryKapture, memoryRuntime, scriptedDecider } from "./helpers/runtime.mjs";

// ccMonet's sidebar as the snapshot reads it: the review copy shows each
// badge count as "#".
const sidebar = (extra = {}) => ({
  url: "https://erp.test/protected/sales/customers", title: "Customers",
  text: "AI Insights 42 Todo 41 Customers JevSteer QA", review_text: "AI Insights # Todo # Customers JevSteer QA",
  elements: [], ...extra,
});
const about = (goal, more = {}) => countsReferenced(sidebar(), { goal, success_criteria: [], constraints: [], assertions: [], ...more });

test("a contract speaks of a badge by its name, its number, or by asking about counts", () => {
  assert.equal(about("Create customer JevSteer QA"), false);
  // The word after a count in page text belongs to what follows it.
  assert.equal(about("Open the Customers list"), false);
  assert.equal(about("Open Todo and check the newest item"), true);
  assert.equal(about("Confirm 41 items are open"), true);
  assert.equal(about("Confirm 410 items are open"), false);
  assert.equal(about("Check the unread notifications"), true);
  assert.equal(about("检查未读消息"), true);
  assert.equal(about("Save the record", { success_criteria: ["The AI Insights badge shows 43"] }), true);
  assert.equal(about("Save the record", { assertions: [{ type: "text_contains", value: "Todo 42" }] }), true);
  // With no badge on the page, there is nothing to bind.
  assert.equal(countsReferenced({ text: "Todo list", elements: [] }, { goal: "Check the unread count" }), false);
});

test("a control's own label gives the word after its count", () => {
  const cart = { tag: "a", role: "link", label: "2 items", review_label: "# items", context: "" };
  const page = { text: "Shop", elements: [cart] };
  assert.equal(countsReferenced(page, { goal: "Check that the cart holds 3 items" }), true);
  assert.equal(countsReferenced(page, { goal: "Open the shop" }), false);
});

test("bound counts are part of the reviewed state; masked counts are not", () => {
  const before = sidebar(), after = sidebar({ text: "AI Insights 43 Todo 41 Customers JevSteer QA" });
  assert.equal(reviewedState(before).digest, reviewedState(after).digest);
  assert.notEqual(reviewedState(before, { counts: true }).digest, reviewedState(after, { counts: true }).digest);
});

test("a ticket for a contract about a count goes stale when the count changes", async () => {
  for (const [goal, status] of [["Inspect REF-42", "completed_host_verified"], ["Inspect REF-42 and its Todo count", "host_review_stale"]]) {
    const k = new MemoryKapture({ text: "REF-42 Todo 41", review_text: "REF-42 Todo #", elements: [] });
    const runtime = memoryRuntime(k, scriptedDecider([{ tool: "none", done: 0.99 }]));
    const result = await runtime.run(goal, { verificationMode: "host", evidenceLevel: "none", assertions: [{ type: "text_contains", value: "REF-42" }] });
    assert.equal(result.status, "host_review_required");
    k.page.text = "REF-42 Todo 42";
    const receipt = await runtime.reviewResult({ tabId: "test", reviewId: result.host_review.review_id, decision: "accept", goalEvidence: "Observed REF-42" });
    assert.equal(receipt.status, status, goal);
  }
});

test("a ticket's assertions are checked on the page without its toasts, which is what it binds", () => {
  const page = {
    url: "https://erp.test/protected/sales/customers", title: "Customers",
    text: "Customers JevSteer QA Status: Saved Update successfully", toasts: ["Update successfully"],
    elements: [{ i: 0, tag: "div", role: "alert", label: "Update successfully", toast: true, context: "Update successfully" }],
  };
  const kept = withoutToasts(page);
  assert.equal(kept.text, "Customers JevSteer QA Status: Saved");
  assert.deepEqual(kept.elements, []);
  const checks = [{ type: "text_contains", value: "Update successfully" }, { type: "text_contains", value: "Status: Saved" }];
  assert.deepEqual(evaluateAssertions(page, checks).map((a) => a.passed), [true, true]);
  assert.deepEqual(evaluateAssertions(kept, checks).map((a) => a.passed), [false, true]);
  // The digest a ticket binds is the same with or without the toast.
  assert.equal(reviewedState(page).digest, reviewedState(kept).digest);
});

// ccMonet's global search: the results float under the focused box, read
// apart from the page text, which stops at 24,000 characters.
test("a ticket binds what a focused field's popup says, unless the field is secret", () => {
  const search = { i: 0, tag: "input", role: "textbox", hint: "Search contacts, vendor bills...", value: "CP-MEIJI", context: "" };
  const bills = (popup, field = search) => ({
    url: "https://erp.test/protected/purchase/bills", title: "Bills", text: "Vendor Bills",
    elements: [field], ...(popup ? { popup: { field: 0, text: popup } } : {}),
  });
  const found = reviewedState(bills("Vendor 1 CP-MEIJI CO.,LTD.")).digest;
  assert.notEqual(reviewedState(bills("No results")).digest, found);
  assert.notEqual(reviewedState(bills()).digest, found);
  assert.equal(reviewedState(bills("Vendor 1 CP-MEIJI CO.,LTD.")).digest, found);
  // A secret field's popup is read by no one (see readablePopup).
  const pin = { ...search, label: "Card PIN", hint: undefined };
  assert.equal(reviewedState(bills("4321 is too short", pin)).digest, reviewedState(bills("4321 is fine", pin)).digest);
});
