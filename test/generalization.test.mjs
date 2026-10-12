import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal } from "../src/action-journal.mjs";
import { locateSameElement } from "../src/element-identity.mjs";
import { observeUntilReady, observationSignature } from "../src/observation.mjs";
import { buildSemanticPage, semanticSnapshot } from "../src/semantic-snapshot.mjs";
import { normalizeTaskContract } from "../src/task-contract.mjs";
import { evaluateAssertions, toVerificationPage } from "../src/verification.mjs";
import { buildTargetSpace } from "../src/decision-space.mjs";
import { toModelPage } from "../src/page-model.mjs";
import { sensitiveName } from "../src/sensitive.mjs";
import { MemoryKapture, memoryRuntime, scriptedDecider, decision } from "./helpers/runtime.mjs";

const button = { i: 0, selector: "#save", tag: "button", role: "button", label: "Save", context: "REF-42", identity_version: 1 };
const field = { i: 0, selector: "#name", tag: "input", role: "textbox", label: "Name", value: "", scope: "Customer", identity_version: 1 };
const page = (elements = [button], text = "Editor") => ({ url: "https://generic.test/editor", title: "Editor", text, elements: structuredClone(elements), metrics: {} });

test("a recycled virtual table selector never selects a different record", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  const action = { tool: "click", target: 0, el: structuredClone(button), observedUrl: k.page.url };
  k.page.elements[0] = { ...button, context: "REF-99" };
  await assert.rejects(() => runtime.act("test", action), /identity/);
  assert.equal(k.commands.length, 0);
});

test("manual recovery relocates a unique record after DOM reorder, and rejects ambiguous clones", () => {
  const runtime = memoryRuntime(new MemoryKapture(), scriptedDecider([{}]));
  const moved = { ...button, selector: "#new-location", i: 8 };
  assert.equal(runtime.findCurrentElement(button, page([moved])).selector, "#new-location");
  assert.throws(() => runtime.findCurrentElement(button, page([moved, { ...moved, selector: "#clone" }])), /ambiguous/);
  assert.equal(locateSameElement(button, page([{ ...moved, context: "REF-99" }])), undefined);
});

test("duplicate field names are distinguished by fieldset scope", () => {
  const p = buildSemanticPage({ tab: { url: "https://generic.test" }, domHtml: '<form><fieldset><legend>Customer</legend><label>Name<input id="a"></label></fieldset><fieldset><legend>Contact</legend><label>Name<input id="b"></label></fieldset></form>', rawElements: ["a", "b"].map((id) => ({ selector: `#${id}`, tagName: "input", visible: true, value: id })) });
  assert.equal(p.elements[0].scope, "Customer");
  assert.equal(p.elements[1].scope, "Contact");
  const assertions = normalizeTaskContract({ goal: "Check fields", assertions: [{ type: "field_equals", label: "Name", context: "Contact", value: "b" }] }).assertions;
  assert.equal(evaluateAssertions(p, assertions)[0].passed, true);
  assert.equal(evaluateAssertions(p, [{ ...assertions[0], context: undefined }])[0].passed, false);
});

test("native modal excludes background controls and ARIA toggle state is exact", () => {
  const p = buildSemanticPage({ domHtml: '<button id="behind">Delete</button><dialog open aria-label="Settings"><button id="switch" role="switch" aria-checked="false">Notifications</button></dialog>', rawElements: ["behind", "switch"].map((id) => ({ selector: `#${id}`, visible: true, tagName: "button" })) });
  assert.equal(p.elements.length, 1);
  assert.equal(p.elements[0].scope, "Settings");
  assert.equal(p.elements[0].checked, false);
  assert(!p.text.includes("Delete"));
});

test("unmatched raw selectors are excluded instead of being guessed as fields", () => {
  const p = buildSemanticPage({ domHtml: '<h1>New DOM</h1>', rawElements: [{ selector: "#old", visible: true, tagName: "input", value: "old" }] });
  assert.equal(p.elements.length, 0);
});

test("a navigation between element and HTML reads is rejected", async () => {
  await assert.rejects(() => semanticSnapshot({ elements: async () => ({ url: "https://a.test", elements: [] }), dom: async () => ({ url: "https://b.test", title: "B", html: "<body>B</body>" }) }, "t"), /SNAPSHOT_CHANGED/);
});

test("only inconsistent snapshots are retried; transport errors are not hidden", async () => {
  const runtime = memoryRuntime(new MemoryKapture(), scriptedDecider([{}]));
  let calls = 0;
  runtime.snapshotter = async () => { if (++calls === 1) throw new Error("SNAPSHOT_CHANGED: navigation"); return page(); };
  assert.equal((await runtime.readPage("test")).title, "Editor");
  assert.equal(calls, 2);
  runtime.snapshotter = async () => { throw new Error("transport offline"); };
  await assert.rejects(() => runtime.readPage("test"), /transport offline/);
});

test("settling waits for delayed field properties even without DOM size changes", async () => {
  let time = 0, reads = 0;
  const before = page([field]);
  const result = await observeUntilReady(async () => page([{ ...field, value: ++reads > 2 ? "Málaga" : "" }]), {
    before, action: { tool: "type", el: field, expected_value: "Málaga" }, maxMs: 1000, quietMs: 100, pollMs: 100,
    now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(result.effect.status, "confirmed");
  assert(reads >= 4);
  assert.equal(result.timed_out, false);
});

test("busy report widgets delay settling; permanently busy widgets have a bounded timeout", async () => {
  let time = 0, reads = 0;
  const result = await observeUntilReady(async () => ({ ...page(), loading: { busy: ++reads < 4 } }), {
    maxMs: 1000, quietMs: 100, pollMs: 100, now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(result.page.loading.busy, false);
  const stuck = await observeUntilReady(async () => ({ ...page(), loading: { busy: true } }), {
    maxMs: 300, quietMs: 100, pollMs: 100, now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(stuck.timed_out, true);
  assert.equal(stuck.ms, 300);
});

test("observation recognizes values and toggle state but ignores generated selectors", () => {
  const a = page([{ ...field, value: "a", checked: false }]);
  assert.equal(observationSignature(a), observationSignature(page([{ ...a.elements[0], selector: "#random" }])));
  assert.notEqual(observationSignature(a), observationSignature(page([{ ...a.elements[0], value: "b" }])));
  assert.notEqual(observationSignature(a), observationSignature(page([{ ...a.elements[0], checked: true }])));
});

test("unrelated live text cannot authorize a duplicate server submission", async () => {
  const k = new MemoryKapture(page());
  k.onCommand = () => { k.page.text = "A clock ticked; save outcome still unknown"; };
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  const result = await runtime.run("Save the record", { evidenceLevel: "none" });
  assert.equal(result.status, "action_failed");
  assert.equal(k.commands.length, 1);
  assert.equal(result.pending_actions.length, 1);
});

test("lost click acknowledgement stays blocked across process restart and a new run id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-journal-"));
  try {
    const k = new MemoryKapture(page());
    k.onCommand = () => { throw new Error("socket disconnected after dispatch"); };
    const first = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])); first.journal = new ActionJournal({ dir });
    const result = await first.run("Save", { runId: "run-one", evidenceLevel: "none" });
    assert.equal(result.status, "action_failed");
    const second = memoryRuntime(k, scriptedDecider([{ side_effect: 0.01 }])); second.journal = new ActionJournal({ dir });
    const resumed = await second.run("Save", { runId: "run-two", evidenceLevel: "none" });
    assert.equal(resumed.status, "action_failed");
    assert.equal(k.commands.length, 1);
    assert.equal(resumed.pending_actions[0].action_id, result.pending_actions[0].action_id);
    const raw = await readFile(first.journal.path("test"), "utf8");
    assert(!raw.includes("generic.test")); assert(!raw.includes("REF-42"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("changing the save button label cannot bypass an unresolved mutation", async () => {
  const k = new MemoryKapture(page());
  k.onCommand = () => { k.page.elements[0].label = "Retry save"; };
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])).run("Save", { evidenceLevel: "none" });
  assert.equal(result.status, "action_failed"); assert.equal(k.commands.length, 1);
});

test("an observed server rejection can explicitly authorize a new attempt", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  const first = await runtime.run("Save", { evidenceLevel: "none" });
  await runtime.resolveAction({ tabId: "test", actionId: first.pending_actions[0].action_id, resolution: "not_applied", evidence: "Server returned validation rejection; record is absent" });
  runtime.decider = scriptedDecider([{ side_effect: 0.9 }, { tool: "none", done: 0.99 }]);
  k.onCommand = () => { k.page.text = "Record saved REF-42"; };
  const final = await runtime.run("Save", { evidenceLevel: "none", assertions: [{ type: "text_contains", value: "Record saved REF-42" }] });
  assert.equal(final.status, "completed_verified"); assert.equal(k.commands.length, 2);
  assert.equal((await runtime.journal.pending("test")).length, 0);
});

test("a different task's successful verifier cannot resolve an earlier unknown submission", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  await runtime.run("Save", { runId: "save-run", evidenceLevel: "none" });
  runtime.decider = scriptedDecider([{ tool: "none", done: 0.99 }]);
  await runtime.run("Read the current page", { runId: "read-run", evidenceLevel: "none" });
  assert.equal((await runtime.journal.pending("test")).length, 1);
});

test("pending actions do not expire silently and resolutions require evidence", async () => {
  const journal = new ActionJournal({ dir: null });
  const record = await journal.begin("test", { runId: "r", milestoneId: "m", action: { tool: "click", el: button }, page: page() });
  await assert.rejects(() => journal.resolve("test", record.id, "not_applied", ""), /EVIDENCE/);
  assert.equal((await journal.pending("test")).length, 1);
});

test("corrupt persistent journals fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-journal-"));
  try {
    const journal = new ActionJournal({ dir }); await writeFile(journal.path("test"), "broken");
    const k = new MemoryKapture(page()); const runtime = memoryRuntime(k, scriptedDecider([{}])); runtime.journal = journal;
    await assert.rejects(() => runtime.run("Save", { evidenceLevel: "none" }), /ACTION_JOURNAL_UNAVAILABLE/);
    assert.equal(k.commands.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failure to durably record intent prevents browser dispatch", async () => {
  const k = new MemoryKapture(page()); const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  runtime.journal.begin = async () => { throw new Error("disk write failed"); };
  const result = await runtime.run("Save", { evidenceLevel: "none" });
  assert.equal(result.status, "action_failed"); assert.equal(k.commands.length, 0);
});

test("field validation prevents a dependent submit even with a matching value", async () => {
  const k = new MemoryKapture(page([field, { ...button, i: 1 }]));
  k.onCommand = () => { k.page.elements[0].value = "bad"; k.page.elements[0].invalid = true; };
  const result = await memoryRuntime(k, scriptedDecider([{ tool: "type" }, { target: 1 }])).run("Fill and save", { values: { name: "bad" }, evidenceLevel: "none" });
  assert.equal(result.status, "action_failed"); assert.deepEqual(k.commands.map((c) => c.command), ["fill"]);
});

test("contenteditable clear failure cannot fall through to appended text", async () => {
  const e = { ...field, tag: "div", contenteditable: true };
  const k = new MemoryKapture(page([e])); k.onCommand = () => { throw new Error("clear failed"); };
  await assert.rejects(() => memoryRuntime(k, scriptedDecider([{}])).act("test", { tool: "type", target: 0, el: e, value: "new", observedUrl: k.page.url }), /clear failed/);
  assert.deepEqual(k.commands.map((c) => c.command), ["clear"]);
});

test("native date/time fields are offered as fill targets while file inputs are excluded", () => {
  for (const type of ["date", "datetime-local", "time", "week", "month"]) {
    assert(buildTargetSpace([{ ...field, type }]).questions.type_target);
  }
  assert.equal(buildTargetSpace([{ ...field, type: "file" }]).questions.type_target, undefined);
});

test("control assertions preserve empty, multiline and exact values and reject missing state", () => {
  const p = page([{ ...field, value: "line one\n  line two" }, { ...button, role: "switch", label: "Enabled", checked: false }]);
  const assertions = normalizeTaskContract({ goal: "Inspect", assertions: [
    { type: "field_equals", label: "Name", value: "line one\n  line two" },
    { type: "control_checked", label: "Enabled", value: false },
    { type: "element_count", label: "Name", value: 1 },
  ] }).assertions;
  assert(evaluateAssertions(p, assertions).every((r) => r.passed));
  assert.equal(evaluateAssertions(page([{ ...field, value: "" }]), [{ type: "field_equals", label: "Name", value: "" }])[0].passed, true);
  assert.equal(evaluateAssertions(page([{ ...button, label: "Enabled" }]), [assertions[1]])[0].passed, false);
});

test("unsupported and malformed assertions are errors, never silently dropped", () => {
  for (const assertion of [{ type: "nonexistent", value: "x" }, { type: "control_checked", label: "x", value: "false" }, { type: "field_equals", value: "x" }, { type: "element_count", label: "x", value: -1 }]) {
    assert.throws(() => normalizeTaskContract({ goal: "Inspect", assertions: [assertion] }));
  }
});

test("verification prioritizes asserted controls beyond the first eighty fields", () => {
  const p = page(Array.from({ length: 200 }, (_, i) => ({ ...field, i, selector: `#f${i}`, label: `Field ${i}` })));
  assert(toVerificationPage(p, [{ type: "field_equals", label: "Field 199", value: "" }]).elements.some((e) => e.i === 199));
});

test("budget exhaustion after a slow decision prevents subsequent browser input", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, async () => { await new Promise((r) => setTimeout(r, 20)); return { answers: decision(), ms: 20, tokens: 1 }; });
  const result = await runtime.run("Save", { maxDurationMs: 10, evidenceLevel: "none" });
  assert.equal(result.status, "budget_exhausted"); assert.equal(k.commands.length, 0); assert(result.recovery);
});

test("a lost acknowledgement with verified saved state completes without replay", async () => {
  const k = new MemoryKapture(page());
  k.onCommand = () => { k.page.text = "Saved REF-42"; throw new Error("response lost"); };
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])).run("Save REF-42", { evidenceLevel: "none", assertions: [{ type: "text_contains", value: "Saved REF-42" }], explain: true });
  assert.equal(result.status, "completed_verified"); assert.equal(k.commands.length, 1);
  assert.equal(result.rounds[0].recovery, "verified_after_transport_error"); assert.equal(result.pending_actions, undefined);
});

test("a changed but incorrect outcome after a lost acknowledgement remains unresolved", async () => {
  const k = new MemoryKapture(page());
  k.onCommand = () => { k.page.text = "Saved REF-99"; throw new Error("response lost"); };
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])).run("Save REF-42", { evidenceLevel: "none", assertions: [{ type: "text_contains", value: "Saved REF-42" }] });
  assert.equal(result.status, "action_failed"); assert.equal(result.pending_actions.length, 1); assert.equal(k.commands.length, 1);
});

test("exact action risk can clear an ordinary field without clearing a later save", async () => {
  const k = new MemoryKapture(page([field, { ...button, i: 1 }]));
  k.onCommand = (command) => { if (command === "fill") k.page.elements[0].value = "Globex"; };
  let choices = 0;
  const runtime = memoryRuntime(k, async (_state, questions) => {
    let answers;
    if (questions.action_side_effect) answers = { action_side_effect: { noul: choices === 1 ? 0.01 : 0.99 }, action_irreversible: { noul: choices === 1 ? 0.01 : 0.99 } };
    else answers = decision(++choices === 1 ? { tool: "type", side_effect: 0.9, irreversible: 0.9 } : { target: 1, side_effect: 0.9, irreversible: 0.9 });
    return { answers, ms: 1, tokens: 1 };
  });
  const result = await runtime.run("Fill and save", { values: { company: "Globex" }, evidenceLevel: "none" });
  assert.equal(result.status, "needs_confirmation"); assert.deepEqual(k.commands.map((c) => c.command), ["fill"]);
});

test("an executor denied tab ownership cannot start network monitoring", async () => {
  const k = new MemoryKapture(page()); const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.leases.withLease = async () => { throw new Error("TAB_BUSY"); };
  await assert.rejects(() => runtime.run("Inspect"), /TAB_BUSY/);
  assert.equal(k.commands.length, 0);
});

test("wrapping select labels exclude all option text and preserve opaque option values", () => {
  const value = "opaque-" + "x".repeat(250);
  const p = buildSemanticPage({ domHtml: '<label>Region<select id="r"><option>Central</option><option>Central</option></select></label>', rawElements: [{ tagName: "select", selector: "#r", visible: true, value, options: [{ text: "Central", value, selected: true }] }] });
  assert.equal(p.elements[0].label, "Region"); assert.equal(p.elements[0].options[0].value, value);
  assert.equal(evaluateAssertions(p, [{ type: "field_equals", label: "Region", value }])[0].passed, true);
});

test("visible background records cannot satisfy a modal's outcome assertion", () => {
  const p = buildSemanticPage({ domHtml: '<p>Saved REF-42</p><dialog open><h1>New unsaved record</h1></dialog>', rawElements: [] });
  assert(p.background_context.includes("Saved REF-42"));
  assert.equal(evaluateAssertions(p, [{ type: "text_contains", value: "Saved REF-42" }])[0].passed, false);
});

test("API keys and PINs are redacted without masking ordinary shipping fields", () => {
  assert(sensitiveName("apiKey")); assert(sensitiveName("access_token")); assert(sensitiveName("PIN")); assert(!sensitiveName("shippingAddress"));
  const p = buildSemanticPage({ domHtml: '<label>API key<input id="key" name="apiKey"></label><label>Shipping address<input id="shipping" name="shippingAddress"></label><textarea id="secret" name="secret">private-secret</textarea>', rawElements: [
    { selector: "#key", tagName: "input", visible: true, value: "private-key" },
    { selector: "#shipping", tagName: "input", visible: true, value: "42 Ocean Street" },
    { selector: "#secret", tagName: "textarea", visible: true, value: "private-secret" },
  ] });
  const model = JSON.stringify(toModelPage(p));
  assert(!model.includes("private-key")); assert(!model.includes("private-secret")); assert(model.includes("42 Ocean Street"));
});

test("ordinary search values cannot authorize filling a sign-in form", async () => {
  const k = new MemoryKapture({ ...page([{ ...field, type: "password", label: "Password" }, { ...button, i: 1, label: "Sign in" }]), url: "https://generic.test/login" });
  const result = await memoryRuntime(k, scriptedDecider([{ tool: "type", login: 0.2 }])).run("Find customer", { values: { search: "Globex" }, evidenceLevel: "none" });
  assert.equal(result.status, "needs_login"); assert.equal(k.commands.length, 0);
});

test("timeout errors do not turn Kapture's hypothetical dialog hint into a confirmed dialog", async () => {
  const k = new MemoryKapture(page()); k.onCommand = () => { throw new Error("Command timeout: click. A JavaScript dialog may be blocking this tab"); };
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }])).run("Save", { evidenceLevel: "none" });
  assert(result.actions[0].error.includes("timed out")); assert(!result.actions[0].error.includes("dialog is blocking"));
});
