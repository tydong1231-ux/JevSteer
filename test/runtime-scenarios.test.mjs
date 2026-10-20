import test from "node:test";
import assert from "node:assert/strict";
import { MemoryKapture, memoryRuntime, scriptedDecider, decision } from "./helpers/runtime.mjs";
import { normalizeTaskContract } from "../src/task-contract.mjs";
import { closedOnly } from "../src/action-effect.mjs";

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

test("a sign-in page returns needs_login even when Jev also asks for vision", async () => {
  // Jev scores both: the page wants a login and its next step looks visual,
  // as with a QR code beside the form.
  const both = new MemoryKapture({ elements: [button] });
  assert.equal((await memoryRuntime(both, scriptedDecider([{ needs_vision: 0.99, login: 0.99 }])).run("Open the report", { evidenceLevel: "none" })).status, "needs_login");
  // A password field with a sign-in button settles it, whatever Jev's login score.
  const form = new MemoryKapture({ url: "https://erp.test/login?next=%2Freports", elements: [
    { i: 0, selector: "#password", tag: "input", role: "textbox", type: "password", label: "Password", value: "" },
    { i: 1, selector: "#signin", tag: "button", role: "button", label: "Log in" },
  ] });
  const result = await memoryRuntime(form, scriptedDecider([{ needs_vision: 0.99, login: 0.2 }])).run("Open the report", { evidenceLevel: "none" });
  assert.equal(result.status, "needs_login");
  assert.equal(form.commands.length + both.commands.length, 0);
});

test("explained rounds carry their timing and the guards' verdicts", async () => {
  const k = new MemoryKapture({ elements: [button] });
  k.onCommand = (command) => { if (command === "click") k.page.text = "Saved"; };
  const result = await memoryRuntime(k, scriptedDecider([{ tool: "click" }, { tool: "none", done: 0.99 }])).run("Save", { evidenceLevel: "none", explain: true });
  const [click, after] = result.rounds;
  assert.equal(typeof click.decide_ms, "number");
  assert.equal(typeof click.side_effect_guard, "number");
  assert.equal(typeof after.observe_ms, "number");
});

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
    // The host is told what Jev did not see, and that the verifier passed.
    if (mode === "hybrid") assert.equal(result.info, 'Jev did not find task.goal reached after a write this milestone sent (click on button "Create"): no message appeared after it. The verifier passed this page. A required field or a rule on the page may have stopped the write. Check the site before accepting this result, and resolve the pending action from what it shows. No input was replayed.');
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

test("on a large page the first stage sees the focused field's popup, and SELECT still finds an open combobox's far options", async () => {
  const customer = { i: 0, selector: "#customer", tag: "input", role: "combobox", label: "Customer", value: "Acme", expanded: true };
  const rows = Array.from({ length: 299 }, (_, n) => ({ ...button, i: n + 1, selector: `#row-${n}`, label: `Record ${n}` }));
  const option = { i: 300, selector: "#acme", tag: "div", role: "option", label: "Acme Ltd", popup_of: 0 };
  const k = new MemoryKapture({ elements: [customer, ...rows, option], popup: { field: 0, text: "Acme Ltd" } });
  const calls = [];
  const runtime = memoryRuntime(k, async (state, questions) => {
    calls.push({ state, questions });
    const answers = questions.group ? { ...decision({ tool: "select", target: null }), group: { choice: "0", probabilities: { "0": 0.99 } } } : { select_target: { choice: "0>300", probabilities: { "0>300": 0.99, __none__: 0.01 } } };
    return { answers, ms: 1, tokens: 1 };
  });
  const answer = await runtime.decide(k.page, { goal: "Choose customer Acme Ltd", success_criteria: [], constraints: [], guidance: [] }, {}, [], null, null);
  assert.equal(answer.stages, 2);
  assert.deepEqual(calls[0].state.page.popup, { field: '[0] combobox "Customer"', field_value: "Acme", shows: "Acme Ltd" });
  assert.deepEqual(Object.keys(calls[1].questions.select_target.criteria), ["0>300", "__none__"]);
  const action = runtime.resolve(k.page, answer, {});
  assert.deepEqual([action.tool, action.el.selector], ["click", "#acme"]);
});

test("a head that turns down its only target stops for guidance, and nothing is typed", async () => {
  const k = new MemoryKapture({ text: "Vendor 1 CP-MEIJI CO.,LTD.", elements: [{ i: 0, selector: "#size", tag: "input", role: "combobox", label: "Page Size", value: "20" }] });
  const runtime = memoryRuntime(k, scriptedDecider([() => ({ ...decision({ tool: "type", target: null }), type_target: { choice: "__none__", probabilities: { "0": 0.2, __none__: 0.8 } } })]));
  const result = await runtime.run("Search for vendor CP-MEIJI", { values: { vendor: "CP-MEIJI" }, evidenceLevel: "none" });
  assert.equal(result.status, "needs_guidance");
  assert.match(result.info, /^Jev chose TYPE, but the one control it could do that on does not fit task\.goal, so no input was sent\./);
  assert.equal(k.commands.length, 0);
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

// Status and Resolution list the same "Closed". Status is open; its list
// floats apart from it, so the option's own section and context say nothing
// about which field it sets.
test("the exact guards see an option chosen from an open list as a SELECT on its combobox", async () => {
  const seen = {};
  const runtime = memoryRuntime(new MemoryKapture(), async (state, questions) => {
    seen[Object.keys(questions).sort().join()] = JSON.parse(JSON.stringify(state.proposed_action));
    return { answers: {}, ms: 1, tokens: 1 };
  });
  const status = { i: 0, selector: "#status", tag: "input", role: "combobox", label: "Status", value: "", display: "Open", expanded: true, scope: "Ticket 42", context: "Status Open", record_key: "Ticket 42" };
  const resolution = { i: 1, selector: "#resolution", tag: "input", role: "combobox", label: "Resolution", value: "", display: "Fixed", expanded: false, scope: "Ticket 42", context: "Resolution Fixed", record_key: "Ticket 42" };
  const open = { i: 2, selector: "#open", tag: "div", role: "option", label: "Open", popup_of: 0, selected: true, context: "Open Closed" };
  const closed = { i: 3, selector: "#closed", tag: "div", role: "option", label: "Closed", popup_of: 0, selected: false, context: "Open Closed" };
  const page = { url: "https://fixture.test/ticket", title: "Ticket 42", text: "Ticket 42 Status Open Resolution Fixed", elements: [status, resolution, open, closed] };
  const contract = { goal: "Set the resolution to Closed", success_criteria: [], constraints: ["Do not change the ticket's Status"], guidance: [] };
  const action = runtime.resolve(page, { ...decision({ tool: "select", target: null }), select_target: { choice: "0>3", probabilities: { "0>3": 0.99 } } }, {});
  assert.deepEqual([action.tool, action.chosen_as, action.el.selector], ["click", "select", "#closed"]);
  await runtime.checkActionEffects(page, contract, action, []);
  await runtime.checkConstraint(page, contract, action, []);
  const asSelect = { tool: "select", element: 'combobox "Status"', scope: "Ticket 42", context: "Status Open", record: "Ticket 42", selected_option: { text: "Closed" } };
  // A SELECT sets a field: the guards also ask whether the task calls for it.
  assert.deepEqual(seen, { "action_irreversible,action_side_effect,action_unrequested": asSelect, violates: asSelect });
  // A CLICK on an option names its combobox, and whether the option is chosen
  // now: a click on a chosen one of a multi-select takes it out. Such a click
  // is checked before input as a SELECT is (see the driver).
  for (const [option, selected] of [[closed, false], [open, true]]) {
    const click = runtime.resolve(page, decision({ tool: "click", target: option.i }), {});
    assert.deepEqual([click.tool, click.chosen_as, click.listed_in?.selector, click.el.selector], ["click", undefined, "#status", option.selector]);
    await runtime.checkConstraint(page, contract, click, []);
    assert.deepEqual(seen.violates, {
      tool: "click", element: `option "${option.label}"`, context: "Open Closed",
      option_of: { element: 'combobox "Status"', scope: "Ticket 42", context: "Status Open", record: "Ticket 42" }, selected,
    });
  }
  // A secret field's option is not named.
  await runtime.checkConstraint(page, contract, { ...action, listed_in: { ...status, label: "Security PIN" } }, []);
  assert.deepEqual(seen.violates, { tool: "select", element: 'combobox "Security PIN"', scope: "Ticket 42", context: "Status Open", record: "Ticket 42" });
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

// ccMonet refused a Save as Draft ("Please fill in all required fields :
// Due Date"). With the date typed, the save was blocked at 0.82 to 0.92
// against "Do not create duplicates", whatever the host's guidance said.
test("the constraint guard takes the host's checked guidance as fact, and a refused save as nothing created", async () => {
  let asked;
  const runtime = memoryRuntime(new MemoryKapture(), async (state, questions) => {
    asked = { task: state.task, instructions: questions.violates.instructions };
    return { answers: { violates: { noul: 0.1 } }, ms: 1, tokens: 1 };
  });
  const el = { i: 0, selector: "#draft", tag: "button", role: "button", label: "Save as Draft" };
  const page = { url: "https://erp.test/invoices", title: "New Invoice", text: "New Invoice Customer JevSteer QA Due Date 2026/11/30", elements: [el] };
  const contract = normalizeTaskContract({ goal: "Save the invoice as a draft", constraints: ["Create one draft invoice for JevSteer QA. Do not create duplicates."],
    guidance: ["The earlier Save as Draft was refused because Due Date was empty; it created nothing and no invoice exists"] });
  assert.equal(await runtime.checkConstraint(page, contract, { tool: "click", el }, []), 0.1);
  assert.deepEqual(asked.task.guidance, contract.guidance);
  assert.match(asked.instructions, /task\.guidance comes from the host, who has checked the site: take what it says as fact/);
  assert.match(asked.instructions, /refused with a validation message \(a required field it named\) normally created nothing: making it again once the form is fixed is not a duplicate/);
});

// ccMonet (Mac rerun on f462b95): with a filter popup left open, or the
// global search's results showing, a click on a bill's vendor cell only closed
// them. The page sent no request and no bill opened; Jev waited three times.
const vendorCell = { i: 0, selector: "#cp", tag: "td", label: "CP-MEIJI CO.,LTD.", record_key: "2" };
const filterPopup = [{ i: 1, selector: "#add", tag: "button", label: "+ Add Filter" }, { i: 2, selector: "#field", tag: "input", role: "combobox" }];
const billsWithPopup = { url: "https://erp.test/bills", title: "Vendor Bills", text: "Vendor Bills Filter + Add Filter CP-MEIJI CO.,LTD. ฿ 1,732.00", elements: [vendorCell, ...filterPopup] };

test("a click that only closed what was open, sending no request, is told apart from one that did something", () => {
  const after = { ...billsWithPopup, text: "Vendor Bills CP-MEIJI CO.,LTD. ฿ 1,732.00", elements: [vendorCell], requests_since_input: 0 };
  const click = { tool: "click", el: vendorCell };
  assert.deepEqual(closedOnly(billsWithPopup, after, click), { controls_gone: 2, such_as: ['button "+ Add Filter"', "combobox"] });
  // A field's placeholder can show again once it loses focus.
  assert.ok(closedOnly(billsWithPopup, { ...after, text: `${after.text} Search contacts, ...` }, click));
  for (const [what, page] of [
    ["sent a request", { ...after, requests_since_input: 1 }],
    ["has a request open", { ...after, pending_requests: 1 }],
    ["is loading", { ...after, loading: { busy: true } }],
    ["counts no requests", { ...after, requests_since_input: undefined }],
    ["opened something", { ...after, elements: [vendorCell, { i: 1, selector: "#edit", tag: "button", label: "Edit" }] }],
    ["shows new text", { ...after, text: `${after.text} Bill 9001563832 due 2025/5/25 Unpaid` }],
    ["loaded another page", { ...after, url: "https://erp.test/bills/2" }],
    ["took its target away", { ...after, elements: [] }],
    ["closed nothing", { ...billsWithPopup, requests_since_input: 0 }],
    ["changed its target's state", { ...after, elements: [{ ...vendorCell, selected: true }] }],
  ]) assert.equal(closedOnly(billsWithPopup, page, click), undefined, what);
  // A toggle that showed its own popup open took the click: it closed that popup.
  const toggle = { ...vendorCell, expanded: true };
  assert.equal(closedOnly({ ...billsWithPopup, elements: billsWithPopup.elements.map((e) => (e === vendorCell ? toggle : e)) }, { ...after, elements: [{ ...vendorCell, expanded: false }] }, { tool: "click", el: toggle }), undefined);
  assert.equal(closedOnly(billsWithPopup, after, { tool: "press_key", key: "Escape" }), undefined);
});

test("after a click that only closed a popup, Jev sees it in history and clicks again instead of waiting", async () => {
  const k = new MemoryKapture(structuredClone(billsWithPopup));
  let clicks = 0;
  k.onCommand = (command) => {
    if (command !== "click") return;
    clicks++;
    // The first click closes the popup and goes no further; the second opens the bill.
    k.page = k.page.elements.length > 1
      ? { ...k.page, text: "Vendor Bills CP-MEIJI CO.,LTD. ฿ 1,732.00", elements: [vendorCell], requests_since_input: 0 }
      : { ...k.page, url: "https://erp.test/bills/2", text: "Bill 9001563832 CP-MEIJI CO.,LTD. Unpaid", elements: [{ i: 0, selector: "#edit", tag: "button", label: "Edit" }], requests_since_input: 6 };
  };
  let last;
  const runtime = memoryRuntime(k, scriptedDecider([
    { tool: "click", target: 0 },
    (state) => {
      last = state.task.history.at(-1);
      return decision(last.closed_only ? { tool: "click", target: 0 } : { tool: "wait" });
    },
    { tool: "none", done: 0.99 },
  ]));
  const result = await runtime.run("Open the CP-MEIJI bill", { maxActions: 4, evidenceLevel: "none" });
  assert.deepEqual([last.action, last.requests, last.closed_only], ["click", 0, { controls_gone: 2, such_as: ['button "+ Add Filter"', "combobox"] }]);
  assert.equal(clicks, 2);
  assert.equal(result.status, "completed_verified");
});

// ccMonet (Mac rerun on f462b95): filling an invoice's lines, Jev chose
// Tracking Category "Woodlands" on both lines, though nothing asked for one.
const trackingLine = () => {
  const tracking = { i: 0, selector: "#tracking", tag: "input", role: "combobox", label: "Tracking Category", column: "Tracking Category", record_key: "line-1", value: "", expanded: true };
  const woodlands = { i: 1, selector: "#woodlands", tag: "div", role: "option", label: "Woodlands", popup_of: 0, selected: false };
  const quantity = { i: 2, selector: "#qty", tag: "input", label: "QTY", column: "QTY", record_key: "line-1", value: "2" };
  return new MemoryKapture({ url: "https://erp.test/invoices/new", title: "New Invoice", text: "New Invoice Item QA item A QTY 2 Tracking Category Woodlands", elements: [tracking, woodlands, quantity] });
};
const pickWoodlands = { ...decision({ tool: "select", target: null }), select_target: { choice: "0>1", probabilities: { "0>1": 0.99 } } };

test("only an action that sets a field is asked whether the task calls for it; an unanswered question holds nothing back", async () => {
  const asked = [];
  let reply = {};
  const runtime = memoryRuntime(new MemoryKapture(), async (state, questions) => {
    asked.push(Object.keys(questions).sort().join());
    if (questions.action_unrequested) asked.push(questions.action_unrequested.instructions);
    return { answers: reply, ms: 1, tokens: 1 };
  });
  const page = trackingLine().page;
  const contract = normalizeTaskContract({ goal: "Fill line 1: item QA item A, quantity 2" });
  const select = runtime.resolve(page, pickWoodlands, {});
  reply = { action_side_effect: { noul: 0.05 }, action_irreversible: { noul: 0.01 }, action_unrequested: { noul: 0.93 } };
  assert.deepEqual(await runtime.checkActionEffects(page, contract, select, []), { sideEffect: 0.05, irreversible: 0.01, unrequested: 0.93 });
  assert.match(asked[1], /puts a value of its own choosing into a field that task\.goal, task\.success_criteria and task\.guidance never mention/);
  reply = { action_side_effect: { noul: 0.05 }, action_irreversible: { noul: 0.01 } };
  assert.equal((await runtime.checkActionEffects(page, contract, select, [])).unrequested, 0);
  const click = { tool: "click", el: { i: 3, selector: "#add", tag: "button", label: "Add New Line" } };
  assert.equal("unrequested" in await runtime.checkActionEffects(page, contract, click, []), false);
  assert.deepEqual(asked.filter((a) => !a.includes(" ")), ["action_irreversible,action_side_effect,action_unrequested", "action_irreversible,action_side_effect,action_unrequested", "action_irreversible,action_side_effect"]);
});

test("a field the task does not ask for is left as it is: nothing is sent, Jev is told why, and one who insists is stopped", async () => {
  const unrequested = async (state, questions) => {
    if (questions.action_side_effect) return { answers: { action_side_effect: { noul: 0.05 }, action_irreversible: { noul: 0.01 }, ...(questions.action_unrequested ? { action_unrequested: { noul: 0.9 } } : {}) }, ms: 1, tokens: 1 };
    return undefined;
  };
  // Jev reads the refusal and moves on.
  let k = trackingLine();
  let told;
  const steps = scriptedDecider([() => pickWoodlands, (s) => { told = s.task.history.at(-1); return decision({ tool: "none", done: 0.99 }); }]);
  let runtime = memoryRuntime(k, async (state, questions) => (await unrequested(state, questions)) || steps(state, questions));
  let result = await runtime.run("Fill line 1: item QA item A, quantity 2", { maxActions: 4, evidenceLevel: "none" });
  assert.equal(k.commands.filter((c) => c.command === "click").length, 0);
  assert.deepEqual([told.recovery, told.reason, told.input_sent], ["reobserve", "not_requested", false]);
  assert.match(told.detail, /^combobox "Tracking Category" -> Woodlands: the task does not ask to set this field to that, so nothing was sent/);
  assert.equal(result.actions.find((a) => a.reason === "not_requested")?.detail, told.detail);
  assert.equal(result.status, "completed_verified");
  // Jev chooses it three times: the third stops the run for guidance.
  k = trackingLine();
  const insists = scriptedDecider([() => pickWoodlands]);
  runtime = memoryRuntime(k, async (state, questions) => (await unrequested(state, questions)) || insists(state, questions));
  result = await runtime.run("Fill line 1: item QA item A, quantity 2", { maxActions: 6, evidenceLevel: "none" });
  assert.equal(result.status, "needs_guidance");
  assert.match(result.info, /^Jev kept choosing to set fields the task does not ask for \(last: combobox "Tracking Category" -> Woodlands\), so no input was sent/);
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

test("a wait in which the page sent requests is not idle, but three of them in a row stop", async () => {
  const k = new MemoryKapture({ text: "Generating", elements: [button] });
  let sent = 0;
  // A job the page polls, or a page that polls badge counters: each wait sees
  // one more request and no visible change.
  const runtime = memoryRuntime(k, scriptedDecider([() => { k.page.requests_since_input = ++sent; return decision({ tool: "wait" }); }]));
  const result = await runtime.run("Show the report", { maxActions: 10, evidenceLevel: "none" });
  assert.ok(result.actions.every((a) => a.page_changed === undefined));
  assert.equal(result.status, "stuck");
  assert.equal(result.actions.filter((a) => a.action === "wait").length, 3);
  assert.match(result.info, /did not change in 3 waits.*kept sending requests/);
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
