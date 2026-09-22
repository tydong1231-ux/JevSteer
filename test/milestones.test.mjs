import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMilestonePlan } from "../src/milestones.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";
import { buildEvidencePacket, relevantRequest } from "../src/evidence.mjs";

test("host milestones inherit global constraints and keep guidance local", () => {
  const plan = normalizeMilestonePlan({
    goal: "Configure and validate a field",
    constraints: ["Do not delete data"],
    guidance: ["Use the normal settings area"],
    milestones: [
      { id: "configure", goal: "Create the field", success_criteria: ["Field exists"], guidance: ["Save finishes the editor"] },
      { id: "validate", goal: "Validate the field", success_criteria: ["Field is visible"] },
    ],
  });
  assert.equal(plan.milestones.length, 2);
  assert.deepEqual(plan.milestones[0].constraints, ["Do not delete data"]);
  assert.deepEqual(plan.milestones[0].guidance, ["Use the normal settings area", "Save finishes the editor"]);
  assert.deepEqual(plan.milestones[1].guidance, ["Use the normal settings area"]);
});

test("deterministic action effect confirms typed values without another model call", () => {
  const before = { url: "https://app.test/form", text: "", elements: [{ selector: "#name", tag: "input", role: "textbox", value: "" }] };
  const after = { url: "https://app.test/form", text: "", elements: [{ selector: "#name", tag: "input", role: "textbox", value: "Delivery Note" }] };
  const effect = verifyActionEffect(before, after, {
    tool: "type",
    el: before.elements[0],
    expected_value: "Delivery Note",
  });
  assert.equal(effect.status, "confirmed");
});

test("evidence packet keeps compact request evidence", () => {
  assert.equal(relevantRequest({ method: "GET", status: 200 }), false);
  assert.equal(relevantRequest({ method: "POST", status: 200 }), true);
  const packet = buildEvidencePacket({
    runId: "r1",
    milestone: { id: "m1", goal: "Save a record" },
    result: { status: "completed_verified", actions: [{ action: "click", element: 'button "Save"', effect: { status: "changed" } }], verification: { status: "completed_verified" }, url: "https://app.test/1", title: "Record" },
    network: { available: true, total_requests: 4, relevant_requests: 1, requests: [{ method: "POST", status: 200 }] },
  });
  assert.equal(packet.milestone_id, "m1");
  assert.equal(packet.actions[0].effect.status, "changed");
  assert.equal(packet.network.relevant_requests, 1);
});
