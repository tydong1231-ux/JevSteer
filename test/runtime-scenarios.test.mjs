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
  assert.equal(result.status, "host_review_required");
  assert.equal(result.verification.jev_verification.status, "verification_uncertain");
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

test("waits that change nothing on a settled page are marked for Jev and stop the run", async () => {
  const k = new MemoryKapture({ text: "Profit and Loss 2026/1/1 - 2026/10/31", elements: [button] });
  let seen;
  const decider = scriptedDecider([(state) => { seen = structuredClone(state.task.history); return decision({ tool: "wait" }); }]);
  const result = await memoryRuntime(k, decider).run("Show the report through 2026/12/31", { maxActions: 20, evidenceLevel: "none" });
  assert.equal(result.status, "stuck");
  assert.match(result.info, /did not change in 2 waits and nothing on it is loading/);
  // What Jev saw on its last decision: each earlier wait changed nothing.
  assert.deepEqual(seen.map((h) => [h.action, h.page_changed]), [["wait", false], ["wait", false]]);
  assert.equal(k.commands.length, 0);
});

test("waits while the page changes or loads are not idle", async () => {
  const k = new MemoryKapture({ text: "Generating", elements: [button] });
  let n = 0;
  const decider = scriptedDecider([() => { k.page.text = `Generating ${n++}`; return decision({ tool: "wait" }); }]);
  const result = await memoryRuntime(k, decider).run("Show the report", { maxActions: 5, evidenceLevel: "none" });
  assert.equal(result.status, "max_actions");
  assert.ok(result.actions.every((a) => a.page_changed === undefined));
});

function customerForm() {
  const create = { i: 0, selector: "#create", tag: "button", role: "button", label: "Create" };
  const row = { i: 0, selector: "#row", tag: "tr", role: "button", label: "JevSteer QA P1019B THB 0.00" };
  const k = new MemoryKapture({ text: "Add Customer Name", elements: [create] });
  k.onCommand = (command) => { if (command === "click") { k.page.text = "Customers JevSteer QA P1019B THB 0.00"; k.page.elements = [row]; } };
  return k;
}
const saveCustomer = { successCriteria: ["A saved customer row shows the exact name JevSteer QA P1019B"], maxActions: 4, evidenceLevel: "none" };

test("after a sent Create, an unclear next step checks the contract before asking for guidance", async () => {
  const k = customerForm();
  // Jev half believes the customer is saved and is unsure what comes next.
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, { next_step_clear: 0.1, done: 0.5 }]));
  const result = await runtime.run("Save customer JevSteer QA P1019B", saveCustomer);
  assert.equal(result.status, "completed_verified");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  assert.deepEqual(await runtime.journal.pending("test"), []);
});

test("after a sent Create, a verifier pass that Jev does not share goes to the host", async () => {
  // Jev does not find the goal reached; only the verifier does.
  for (const [mode, status] of [["hybrid", "host_review_required"], ["jev", "verification_uncertain"]]) {
    const k = customerForm();
    const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, { next_step_clear: 0.1 }]));
    const result = await runtime.run("Save customer JevSteer QA P1019B", { ...saveCustomer, verificationMode: mode });
    assert.equal(result.status, status, mode);
    assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
    // The Create stays pending until the host accepts or resolves it.
    assert.equal((await runtime.journal.pending("test")).length, 1);
  }
});

// Jev picks the new row, but with too little confidence to click it.
const unsureTarget = (done = 0.01) => () => ({ ...decision({ done }), target: { choice: "0", probabilities: { 0: 0.1 } } });

test("after a sent Create, Jev seeing no action or no clear target also checks the contract first", async () => {
  for (const [next, status] of [[{ tool: "none", done: 0.2 }, "host_review_required"], [unsureTarget(), "host_review_required"], [unsureTarget(0.5), "completed_verified"]]) {
    const k = customerForm();
    const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, next]));
    const result = await runtime.run("Save customer JevSteer QA P1019B", saveCustomer);
    assert.equal(result.status, status);
    assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  }
  // When the check fails, the stop is the same as before.
  const k = customerForm();
  const failed = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, unsureTarget(0.5)], { verifyScore: 0.1 })).run("Save customer JevSteer QA P1019B", saveCustomer);
  assert.equal(failed.status, "ambiguous");
});

test("after a sent Create, an uncertain check goes to the host; without a write the host is asked for guidance", async () => {
  const k = customerForm();
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }, { next_step_clear: 0.1 }], { verifyScore: 0.6 }));
  const result = await runtime.run("Save customer JevSteer QA P1019B", { ...saveCustomer, verificationMode: "hybrid" });
  assert.equal(result.status, "host_review_required");
  assert.ok(result.host_review?.review_id);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  // A read-only click leaves no write to check; an unclear step still asks.
  const read = customerForm();
  const unclear = await memoryRuntime(read, scriptedDecider([{ side_effect: 0.01 }, { next_step_clear: 0.1 }])).run("Save customer JevSteer QA P1019B", saveCustomer);
  assert.equal(unclear.status, "needs_guidance");
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

test("exact constraint guard sees the chosen native option, never a secret one", async () => {
  let seen;
  const runtime = memoryRuntime(new MemoryKapture(), async (state) => {
    seen = state.proposed_action;
    return { answers: { violates: { noul: 0.05 } }, ms: 1, tokens: 1 };
  });
  const el = { i: 0, selector: "#status", tag: "select", role: "combobox", label: "Status", options: [{ text: "Open", value: "open" }, { text: "Closed", value: "closed" }] };
  const contract = { goal: "Reopen the ticket", success_criteria: [], constraints: ["Do not set Status to Closed"], guidance: [] };
  const page = { url: "https://fixture.test/ticket", title: "Ticket", text: "Status", elements: [el] };
  assert.equal(await runtime.checkConstraint(page, contract, { tool: "select", el, value: "open" }, []), 0.05);
  assert.deepEqual(seen.selected_option, { text: "Open", value: "open" });
  await runtime.checkConstraint(page, contract, { tool: "select", el: { ...el, label: "Security PIN" }, value: "open" }, []);
  assert.equal(seen.selected_option, undefined);
});

test("effect and constraint guards are separate requests; the constraint one sees page text only and blocks when unanswered", async () => {
  const asked = [];
  let reply = {};
  const runtime = memoryRuntime(new MemoryKapture(), async (state, questions) => {
    asked.push({ questions: Object.keys(questions).sort(), page: Object.keys(state.page).sort() });
    return { answers: reply, ms: 1, tokens: 1 };
  });
  const el = { i: 0, selector: "#save", tag: "button", role: "button", label: "Save" };
  const page = { url: "https://fixture.test/form", title: "Form", text: "Form", elements: [el] };
  const contract = { goal: "Save", success_criteria: [], constraints: ["Do not save"], guidance: [] };
  reply = { action_side_effect: { noul: 0.9 }, action_irreversible: { noul: 0.1 } };
  assert.deepEqual(await runtime.checkActionEffects(page, contract, { tool: "click", el }, []), { sideEffect: 0.9, irreversible: 0.1 });
  reply = { violates: { noul: 0.2 } };
  assert.equal(await runtime.checkConstraint(page, contract, { tool: "click", el }, []), 0.2);
  reply = {};
  assert.deepEqual(await runtime.checkActionEffects(page, contract, { tool: "click", el }, [], 0.3, 0.4), { sideEffect: 0.3, irreversible: 0.4 });
  assert.equal(await runtime.checkConstraint(page, contract, { tool: "click", el }, []), 1);
  assert.deepEqual(asked.map((a) => a.questions), [["action_irreversible", "action_side_effect"], ["violates"], ["action_irreversible", "action_side_effect"], ["violates"]]);
  assert.deepEqual(asked[1].page, ["text", "title", "url"]);
});

test("a constraint block says allow_irreversible does not lift it and how to settle it", async () => {
  const k = new MemoryKapture({ elements: [button] });
  const decider = async (state, questions) => {
    if (questions.violates) return { answers: { violates: { noul: 0.74 } }, ms: 1, tokens: 1 };
    if (questions.action_side_effect) return { answers: { action_side_effect: { noul: 0.9 }, action_irreversible: { noul: 0.1 } }, ms: 1, tokens: 1 };
    return { answers: decision(), ms: 1, tokens: 1 };
  };
  const result = await memoryRuntime(k, decider).run("Create customer Acme", { constraints: ["Do not create duplicates"], allowIrreversible: true, maxActions: 3, evidenceLevel: "none" });
  assert.equal(result.status, "constraint_blocked");
  assert.match(result.info, /allow_irreversible does not lift this check/);
  assert.equal(result.pending.p_constraint_risk, 0.74);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 0);
});

test("Playwright rounds wait on full observations, not the URL/title metadata poll", async () => {
  const { JevSteerRuntime } = await import("../src/runtime.mjs");
  const { ActionJournal } = await import("../src/action-journal.mjs");
  let details = 0;
  let reads = 0;
  const driver = {
    kind: "playwright",
    detail: async () => { details++; return { url: "https://fixture.test", title: "T" }; },
    observe: async () => { reads++; return { url: "https://fixture.test", title: "T", text: "", elements: [], loading: { busy: reads < 2 } }; },
  };
  const runtime = new JevSteerRuntime({ driver, journal: new ActionJournal({ dir: null }), observation: { maxMs: 1000, quietMs: 0, pollMs: 1 } });
  assert.equal(await runtime.settle("tab"), 0);
  assert.equal((await runtime.settledPage("tab")).loading.busy, false);
  assert.equal(details, 0);
  assert.equal(reads, 2);
});

test("a wait ends as soon as the page changes", async () => {
  // The report shows 300 ms into the wait; the wait does not run its full 5 s.
  const k = new MemoryKapture({ text: "Profit and Loss", elements: [button] });
  const runtime = memoryRuntime(k, scriptedDecider([
    () => { setTimeout(() => { k.page.text = "Profit and Loss For the period 2026/1/1 - 2026/12/31"; }, 300); return decision({ tool: "wait" }); },
    (state) => decision(state.page.text.includes("For the period") ? { tool: "none", done: 0.99 } : { tool: "wait" }),
  ]));
  runtime.observation = { maxMs: 8000, quietMs: 0, pollMs: 20, waitMs: 5000 };
  const started = Date.now();
  const result = await runtime.run("Show the report", { maxActions: 4, evidenceLevel: "none" });
  assert.equal(result.status, "completed_verified");
  assert.deepEqual(result.actions.map((a) => [a.action, a.page_changed]), [["wait", undefined]]);
  assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`);
});

test("a wait in which the page sent requests is not idle", async () => {
  const k = new MemoryKapture({ text: "Generating", elements: [button] });
  let sent = 0;
  // A job the page polls: each wait sees one more request, and no change yet.
  const runtime = memoryRuntime(k, scriptedDecider([() => { k.page.requests_since_input = ++sent; return decision({ tool: "wait" }); }]));
  const result = await runtime.run("Show the report", { maxActions: 4, evidenceLevel: "none" });
  assert.equal(result.status, "max_actions");
  assert.ok(result.actions.every((a) => a.page_changed === undefined));
});

test("the effect and constraint guards do not see how many requests earlier inputs sent", async () => {
  const k = new MemoryKapture({ text: "Add Customer", elements: [button] });
  k.onCommand = (command) => { if (command === "click") k.page.requests_since_input = 3; };
  const guards = [];
  let decided;
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.01 }, { side_effect: 0.01 }, { tool: "none", done: 0.99 }], {
    inspect: (state, questions) => {
      if (questions.action_side_effect || questions.violates) guards.push(state.task.history);
      else if (questions.tool) decided = state.task.history;
    },
  }));
  await runtime.run("Add two contact rows", { constraints: ["Do not save"], maxActions: 4, evidenceLevel: "none" });
  // Jev's own next step sees the count; the guards judge without it.
  assert.equal(decided[0].requests, 3);
  const later = guards.filter((history) => history.length);
  assert.ok(later.length >= 2);
  assert.ok(later.every((history) => history.every((entry) => !("requests" in entry))));
});
