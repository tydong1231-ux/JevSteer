import test from "node:test";
import assert from "node:assert/strict";
import { MemoryKapture, memoryRuntime, scriptedDecider, decision } from "./helpers/runtime.mjs";

const button = { i: 0, selector: "#continue", tag: "button", role: "button", label: "Continue" };
const plan = [
  { id: "draft", goal: "Save the draft", assertions: [{ type: "text_contains", value: "Draft saved" }] },
  { id: "review", goal: "Open review", assertions: [{ type: "text_contains", value: "Review ready" }] },
];

function workflow() {
  const k = new MemoryKapture({ elements: [button] });
  k.onCommand = (command) => { if (command === "click") k.page.text = k.page.text === "Start" ? "Draft saved" : "Review ready"; };
  return { k, runtime: memoryRuntime(k, scriptedDecider([
    { tool: "click" }, { tool: "none", done: 0.99 },
    { tool: "click" }, { tool: "none", done: 0.99 },
  ])) };
}

test("strict review pauses before the next milestone; host resumes the same run", async () => {
  const { k, runtime } = workflow();
  const first = await runtime.run("Prepare draft for review", { milestones: plan, reviewMode: "strict", evidenceLevel: "none" });
  assert.equal(first.status, "milestone_ready_for_review");
  assert.equal(first.next_milestone_index, 1);
  assert.equal(first.evidence.milestone_id, "draft");
  assert.equal(k.page.text, "Draft saved");
  const final = await runtime.run("Prepare draft for review", { milestones: plan, reviewMode: "strict", milestoneIndex: 1, runId: first.run_id, evidenceLevel: "none" });
  assert.equal(final.run_id, first.run_id);
  assert.equal(final.plan_complete_after_review, true);
  assert.equal(final.next_milestone_index, null);
  assert.equal(k.page.text, "Review ready");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 2);
});

test("fast review executes and independently verifies each milestone", async () => {
  const { runtime } = workflow();
  const result = await runtime.run("Prepare draft for review", { milestones: plan, evidenceLevel: "none" });
  assert.equal(result.status, "completed_verified");
  assert.deepEqual(result.milestones_completed, ["draft", "review"]);
  assert.equal(result.evidence.length, 2);
  assert(result.evidence.every((p) => p.verification.assertions.every((a) => a.passed)));
});

test("guidance patches resume the current milestone without touching later milestones", async () => {
  const k = new MemoryKapture({ elements: [button] });
  k.onCommand = (command) => { if (command === "click") k.page.text = "Draft saved"; };
  const decider = scriptedDecider([(state) => state.page.text === "Draft saved"
    ? decision({ tool: "none", done: 0.99 })
    : state.task.guidance?.includes("Save keeps a draft") ? decision({ tool: "click" }) : decision({ next_step_clear: 0.1 })]);
  const runtime = memoryRuntime(k, decider);
  const first = await runtime.run("Prepare draft", { milestones: plan, reviewMode: "strict", evidenceLevel: "none" });
  assert.equal(first.status, "needs_guidance");
  assert.equal(first.resume.milestone_index, 0);
  assert.equal(k.commands.length, 0);
  const patched = [{ ...plan[0], guidance: ["Save keeps a draft"] }, plan[1]];
  const next = await runtime.run("Prepare draft", { milestones: patched, reviewMode: "strict", runId: first.run_id, evidenceLevel: "none" });
  assert.equal(next.status, "milestone_ready_for_review");
  assert.equal(next.run_id, first.run_id);
  assert.equal(k.page.text, "Draft saved");
});

test("model DONE cannot override a wrong invoice and cannot advance the plan", async () => {
  const k = new MemoryKapture({ text: "INV-99 Wrong customer", elements: [button] });
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "none", done: 0.99 }]));
  const result = await runtime.run("Inspect invoice", { milestones: [
    { id: "find", goal: "Find INV-42", assertions: [{ type: "text_contains", value: "INV-42" }] }, plan[1],
  ], evidenceLevel: "none" });
  assert.equal(result.status, "verification_failed");
  assert.equal(result.milestone_index, 0);
  assert.equal(k.commands.length, 0);
});

test("uncertain independent verification returns to the host", async () => {
  const k = new MemoryKapture();
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "none", done: 0.99 }], { verifyScore: 0.6 }));
  const result = await runtime.run("Inspect record", { evidenceLevel: "none" });
  assert.equal(result.status, "verification_uncertain");
});

test("independent verification receives expected values and redacts secrets", async () => {
  const k = new MemoryKapture();
  let observed;
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "none", done: 0.99 }], { inspect: (state, questions) => { if (questions.goal_complete) observed = state.task.values; } }));
  await runtime.run("Inspect the customer", { values: { email: "qa@example.invalid", password: "private-password" }, evidenceLevel: "none" });
  assert.equal(observed.email, "qa@example.invalid");
  assert(!JSON.stringify(observed).includes("private-password"));
});

for (const [score, status] of [[{ blocked: 0.99 }, "blocked"], [{ needs_vision: 0.99 }, "needs_vision"], [{ login: 0.99 }, "needs_login"], [{ irreversible: 0.99 }, "needs_confirmation"]]) {
  test(`${status} stops before browser input`, async () => {
    const k = new MemoryKapture({ elements: [button] });
    const result = await memoryRuntime(k, scriptedDecider([score])).run("Continue workflow", { evidenceLevel: "none" });
    assert.equal(result.status, status);
    assert.equal(k.commands.length, 0);
  });
}

test("low target confidence returns ambiguous without a click", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const result = await memoryRuntime(k, scriptedDecider([() => {
    const a = decision(); a.target.probabilities["0"] = 0.1; return a;
  }])).run("Continue", { evidenceLevel: "none" });
  assert.equal(result.status, "ambiguous");
  assert.equal(k.commands.length, 0);
});

test("no-effect click loop stops after two attempts", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const result = await memoryRuntime(k, scriptedDecider([{}])).run("Continue", { maxActions: 10, evidenceLevel: "none" });
  assert.equal(result.status, "stuck");
  assert.equal(result.actions.length, 2);
});

test("an acknowledged remote mutation with no visible effect is never submitted twice", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])).run("Save a test customer", { maxActions: 10, evidenceLevel: "none" });
  assert.equal(result.status, "action_failed");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  assert.equal(result.actions[0].effect.status, "unknown");
});

test("waiting does not clear an unconfirmed mutation or permit duplicate submission", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, { tool: "wait" }, { side_effect: 0.9 }])).run("Save a test customer", { maxActions: 8, evidenceLevel: "none" });
  assert.equal(result.status, "action_failed");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
});

test("navigation during a decision reobserves without replaying the click", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const decider = scriptedDecider([{}, () => { k.page.url = "https://fixture.test/final"; k.page.text = "Saved detail"; return decision(); }, { tool: "none", done: 0.99 }]);
  const result = await memoryRuntime(k, decider).run("Open the detail", { maxActions: 6, evidenceLevel: "none" });
  assert.equal(result.status, "completed_verified");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  assert.equal(result.actions.filter((a) => a.recovery === "reobserve").length, 1);
});

test("large pages keep original target indices across the two-stage decision", async () => {
  const k = new MemoryKapture({ elements: Array.from({ length: 301 }, (_, i) => ({ ...button, i, selector: `#item-${i}`, label: `Record ${i}` })) });
  const calls = [];
  const runtime = memoryRuntime(k, async (state, questions) => {
    calls.push({ state, questions });
    const answers = questions.group ? { ...decision(), group: { choice: "10", probabilities: { "10": 0.99 } } } : { click_target: { choice: "300", probabilities: { "300": 0.99 } } };
    return { answers, ms: 1, tokens: 1 };
  });
  const contract = { goal: "Open Record 300", success_criteria: [], constraints: [], guidance: [] };
  const answer = await runtime.decide(k.page, contract, {}, [], null, null);
  assert.equal(answer.stages, 2);
  assert.deepEqual(calls[1].state.page.elements.map((e) => e.i), [300]);
  assert.equal(runtime.resolve(k.page, answer, {}).el.selector, "#item-300");
});

test("network evidence stops monitoring even when the decision service fails", async () => {
  const k = new MemoryKapture();
  const runtime = memoryRuntime(k, async () => { throw new Error("decision service offline"); });
  await assert.rejects(() => runtime.run("Inspect record"), /decision service offline/);
  assert.equal(k.commands.at(-1).command, "network_monitor");
  assert.equal(k.commands.at(-1).args.enabled, false);
});

test("expanded evidence also redacts secrets in the request URL", async () => {
  const k = new MemoryKapture();
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "none", done: 0.99 }]));
  const capture = await runtime.startNetworkCapture("test", "r", "m", "relevant");
  k.requests.push({ requestId: "req1", method: "POST", status: 200, url: "https://fixture.test/save?token=private-token", type: "Fetch" });
  k.body = { requestBody: '{"password":"private-password"}', body: '{"ok":true}' };
  const packet = await runtime.finishNetworkCapture("test", capture, "r", "m", "relevant");
  assert(!JSON.stringify(packet).includes("private-token"));
  assert(!JSON.stringify(runtime.getEvidence(packet.requests[0].evidence_ref)).includes("private-token"));
  assert(!JSON.stringify(runtime.getEvidence(packet.requests[0].evidence_ref)).includes("private-password"));
});
