import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskContract, contractForResume } from "../src/task-contract.mjs";
import { evaluateAssertions, summarizeVerification } from "../src/verification.mjs";
import { recoveryFor } from "../src/recovery.mjs";

test("task contract stays compact and deterministic assertions are strict", () => {
  const contract = normalizeTaskContract({
    goal: " Open ABC's latest invoice ",
    successCriteria: ["Customer is ABC Pte Ltd", "Customer is ABC Pte Ltd", "Latest invoice is open"],
    constraints: ["Do not edit anything"],
    assertions: [
      { type: "url_contains", value: "/invoice/" },
      { type: "text_not_contains", value: "ABC Trading" },
    ],
  });
  assert.deepEqual(contract.success_criteria, ["Customer is ABC Pte Ltd", "Latest invoice is open"]);
  const page = { url: "https://app.test/invoice/42", title: "Invoice", text: "ABC Pte Ltd INV-42" };
  const results = evaluateAssertions(page, contract.assertions);
  assert.equal(results.every((x) => x.passed), true);
  assert.deepEqual(contractForResume(contract), contract);
});

test("verification requires both deterministic and semantic acceptance", () => {
  const contract = normalizeTaskContract({
    goal: "Open ABC's invoice",
    successCriteria: ["Customer is ABC Pte Ltd"],
    assertions: [{ type: "text_contains", value: "ABC Pte Ltd" }],
  });
  const assertionResults = [{ type: "text_contains", expected: "ABC Pte Ltd", passed: true }];
  const verified = summarizeVerification({
    contract,
    assertionResults,
    answers: { goal_complete: { noul: 0.95 }, criterion_0: { noul: 0.93 } },
  });
  assert.equal(verified.status, "completed_verified");

  const failed = summarizeVerification({
    contract,
    assertionResults: [{ ...assertionResults[0], passed: false }],
    answers: { goal_complete: { noul: 0.99 }, criterion_0: { noul: 0.99 } },
  });
  assert.equal(failed.status, "verification_failed");
});

test("recovery output tells the host exactly how to take over and resume", () => {
  const contract = normalizeTaskContract({ goal: "Open latest invoice", successCriteria: ["Invoice detail is open"] });
  const recovery = recoveryFor("drifted", {
    tabId: "tab-1",
    contract,
    checkpoint: { url: "https://app.test/customers", title: "Customers" },
    failedStep: { action: "click", element: 'link "Wrong customer"' },
  });
  assert.equal(recovery.strategy, "inspect_and_replan");
  assert.equal(recovery.next_tool, "browser_snapshot");
  assert.equal(recovery.resume_after, true);
  assert.equal(recovery.resume_context.tab_id, "tab-1");
  assert.equal(recovery.resume_context.goal, "Open latest invoice");
});