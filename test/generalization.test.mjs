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

test("a select-like combobox is compared by the value it shows", () => {
  const customer = { i: 0, tag: "input", role: "combobox", label: "Customer", value: "", display: "CHAIN1019", context: "" };
  const assertions = normalizeTaskContract({ goal: "Check", assertions: [{ type: "field_equals", label: "Customer", value: "CHAIN1019" }] }).assertions;
  assert.equal(evaluateAssertions({ url: "https://app.test", text: "", elements: [customer] }, assertions)[0].passed, true);
  // Text typed into its search box is what it holds while the list is open.
  assert.equal(evaluateAssertions({ url: "https://app.test", text: "", elements: [{ ...customer, value: "CHAIN", display: undefined }] }, assertions)[0].passed, false);
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

test("an open data request holds observation until it returns, then the quiet period restarts", async () => {
  let time = 0, reads = 0;
  const before = page();
  // Reads 1-3: the report request is open. Read 4: it returned. Read 5: the
  // report is on the page.
  const result = await observeUntilReady(async () => {
    reads++;
    return { ...page([button], reads >= 5 ? "Editor For the period 2026/1/1 - 2026/12/31" : "Editor"), ...(reads < 4 ? { pending_requests: 1 } : {}) };
  }, { before, action: { tool: "click", el: button, side_effect: 0 }, maxMs: 5000, quietMs: 150, pollMs: 100, clickGraceMs: 0, now: () => time, pause: async (ms) => { time += ms; } });
  assert.equal(result.effect.status, "changed");
  assert.match(result.page.text, /For the period/);
  assert.equal(result.timed_out, false);
  // A request still open when the budget runs out leaves the page not settled.
  const open = await observeUntilReady(async () => ({ ...page(), pending_requests: 1 }), { maxMs: 300, quietMs: 0, pollMs: 100, now: () => time, pause: async (ms) => { time += ms; } });
  assert.equal(open.timed_out, true);
});

test("a click that changes nothing is watched briefly; one that changes the page is not", async () => {
  let time = 0, reads = 0;
  const before = page();
  const delayed = await observeUntilReady(async () => page([button], ++reads >= 6 ? "Editor Report ready" : "Editor"), {
    before, action: { tool: "click", el: button, side_effect: 0 }, maxMs: 5000, quietMs: 0, pollMs: 100, clickGraceMs: 1000, now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(delayed.effect.status, "changed");
  assert.equal(reads, 6);
  reads = 0;
  const nothing = await observeUntilReady(async () => { reads++; return page(); }, {
    before, action: { tool: "click", el: button, side_effect: 0 }, maxMs: 5000, quietMs: 0, pollMs: 100, clickGraceMs: 1000, now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(nothing.effect.status, "unknown");
  assert.equal(nothing.ms, 1000);
  reads = 0;
  const changed = await observeUntilReady(async () => { reads++; return page([button], "Editor Saved"); }, {
    before, action: { tool: "click", el: button, side_effect: 0 }, maxMs: 5000, quietMs: 0, pollMs: 100, clickGraceMs: 1000, now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(changed.effect.status, "changed");
  assert.equal(reads, 1);
});

test("observation recognizes values and toggle state but ignores generated selectors", () => {
  const a = page([{ ...field, value: "a", checked: false }]);
  assert.equal(observationSignature(a), observationSignature(page([{ ...a.elements[0], selector: "#random" }])));
  assert.notEqual(observationSignature(a), observationSignature(page([{ ...a.elements[0], value: "b" }])));
  assert.notEqual(observationSignature(a), observationSignature(page([{ ...a.elements[0], checked: true }])));
  // A select-like combobox holds no text once an option is picked; it shows it.
  assert.notEqual(observationSignature(a), observationSignature(page([{ ...a.elements[0], display: "Acme Ltd" }])));
  // "Doe, John" is one option, or two: a multi-select's options are read apart.
  const one = page([{ ...a.elements[0], display: "Doe, John" }]);
  assert.notEqual(observationSignature(one), observationSignature(page([{ ...one.elements[0], display_items: ["Doe", "John"] }])));
  // The options read apart stop at 20; a later one the field shows still
  // counts (Codex on 7519fff).
  const tags = Array.from({ length: 25 }, (_, n) => `T${n + 1}`);
  const many = (shown) => page([{ ...a.elements[0], display: shown.join(", "), display_items: shown.slice(0, 20) }]);
  assert.notEqual(observationSignature(many(tags)), observationSignature(many([...tags.slice(0, 24), "T99"])));
});

test("unrelated live text cannot authorize a duplicate server submission", async () => {
  const k = new MemoryKapture(page());
  k.onCommand = () => { k.page.text = "A clock ticked; save outcome still unknown"; };
  // Jev chooses Save again: the contract is checked first, and fails here.
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 }));
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
  const result = await memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 })).run("Save", { evidenceLevel: "none" });
  assert.equal(result.status, "action_failed"); assert.equal(k.commands.length, 1);
});

test("an observed server rejection can explicitly authorize a new attempt", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 }));
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

test("an unrelated starting route is not mistaken for drift after waiting", async () => {
  const link = { ...button, tag: "a", role: "link", label: "Customers", href: "/customers" };
  const k = new MemoryKapture({ ...page([link]), url: "https://generic.test/reports" });
  k.onCommand = () => { k.page.url = "https://generic.test/customers"; k.page.text = "Customers ready"; };
  const result = await memoryRuntime(k, scriptedDecider([{ tool: "wait", on_track: 0.2 }, { on_track: 0.2 }, { tool: "none", done: 0.99 }])).run("Open Customers", { evidenceLevel: "none", assertions: [{ type: "text_contains", value: "Customers ready" }] });
  assert.equal(result.status, "completed_verified"); assert.equal(k.commands.length, 1);
});


test("P1: host-confirmed applied save remains replay-blocked across restarts and new run ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-applied-"));
  try {
    const k = new MemoryKapture(page());
    const first = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 }));
    first.journal = new ActionJournal({ dir });
    const initial = await first.run("Save invoice REF-42", { runId: "first", evidenceLevel: "none" });
    assert.equal(initial.status, "action_failed");
    assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
    const applied = await first.resolveAction({
      tabId: "test", actionId: initial.pending_actions[0].action_id,
      resolution: "applied", evidence: "Independent records API confirms REF-42 already saved",
    });
    assert.equal(applied.replay_protected, true);
    assert.equal((await first.journal.pending("test")).length, 0);

    const second = memoryRuntime(k, scriptedDecider([{ side_effect: 0.01 }]));
    second.journal = new ActionJournal({ dir });
    const resumed = await second.run("Save invoice REF-42", { runId: "second", evidenceLevel: "none" });
    assert.equal(resumed.status, "action_failed");
    assert.match(resumed.info, /already confirmed applied/);
    assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
    assert.equal(resumed.pending.resolution, "applied");

    const differentIntent = await second.journal.replayProtected("test",
      { tool: "click", el: button }, page(), { intent: "Create customer NEW-99" });
    assert.equal(differentIntent, null, "a new business goal can reuse a common Save button");
    assert(await second.journal.replayProtected("test",
      { tool: "click", el: button }, page(), { intent: "Save invoice REF-42" }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("P1: confirmed not_applied permits retry, while verified remote writes stay protected", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 }));
  const first = await runtime.run("Save REF-42", { evidenceLevel: "none" });
  await runtime.resolveAction({
    tabId: "test", actionId: first.pending_actions[0].action_id,
    resolution: "not_applied", evidence: "Independent API confirms rejection and no record exists",
  });
  assert.equal(await runtime.journal.replayProtected("test", { tool: "click", el: button }, page(), { intent: "Save REF-42" }), null);

  k.onCommand = (cmd) => { if (cmd === "click") k.page.text = "Saved REF-42"; };
  runtime.decider = scriptedDecider([{ side_effect: 0.9 }, { tool: "none", done: 0.99 }]);
  const final = await runtime.run("Save REF-42", {
    evidenceLevel: "none", assertions: [{ type: "text_contains", value: "Saved REF-42" }],
  });
  assert.equal(final.status, "completed_verified");
  assert.equal(k.commands.filter((c) => c.command === "click").length, 2);
  assert.equal((await runtime.journal.pending("test")).length, 0);
  assert(await runtime.journal.replayProtected("test", { tool: "click", el: button }, page(), { intent: "Save REF-42" }));
});

test("P1: permanent applied replay barriers survive routine journal retention", async () => {
  const journal = new ActionJournal({ dir: null });
  const recorded = await journal.begin("test", {
    runId: "initial", milestoneId: "save", action: { tool: "click", el: button },
    page: page(), intent: "Create a specific record", remoteRisk: 0.95,
  });
  await journal.resolve("test", recorded.id, "applied", "Record exists in API", { protectReplay: true });
  for (let index = 0; index < 130; index++) {
    const ordinary = await journal.begin("test", {
      runId: "other", milestoneId: "nav",
      action: { tool: "click", el: { ...button, label: `Open panel ${index}` } },
      page: page(),
    });
    await journal.resolve("test", ordinary.id, "applied", "Navigation acknowledged");
  }
  assert.equal((await journal.load("test")).length, 101);
  assert(await journal.replayProtected("test", { tool: "click", el: button },
    page(), { intent: "Create a specific record" }));
});

test("P2: manual recovery journals before clicking and stays pending after transport ACK", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const result = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(result.status, "action_unconfirmed");
  assert(result.action_id);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  assert.equal((await runtime.journal.pending("test"))[0].id, result.action_id);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0 }), /UNCONFIRMED_ACTION/);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
  await runtime.resolveAction({
    tabId: "test", actionId: result.action_id, resolution: "applied",
    evidence: "Server-side record REF-42 exists and has expected values",
  });
  assert.equal((await runtime.journal.pending("test")).length, 0);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0 }), /ACTION_ALREADY_APPLIED/);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
});

// ccMonet opens every invoice on one address: a host's click on option "HQ"
// for one invoice, resolved applied, refused "HQ" on the next invoice, by
// hand and in a run, and a milestone goal that named no invoice refused
// Approve on the next one (Mac rerun of 3fa0a57). A goal names the
// operation and its record; the same goal is still refused.
test("a manual input given a goal is refused again under that goal only, as a run's write is", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const clicks = () => k.commands.filter((c) => c.command === "click").length;
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0, goal: "  Approve the sales invoice for ABC PTE LTD,\n 5,000.00 " });
  assert.match(first.info, /the same input on this page is then refused as a replay under this goal\. If it only changed the page \(a field set before saving, a list opened\), resolve not_applied\.$/);
  await runtime.resolveAction({ tabId: "test", actionId: first.action_id, resolution: "applied", evidence: "The invoice shows Approved" });
  // The same goal, by hand or as a run's goal, is refused, with how another record is told apart.
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0, goal: "Approve the sales invoice for ABC PTE LTD, 5,000.00" }),
    /ACTION_ALREADY_APPLIED: the confirmed action must not be replayed manually\. If the page now shows another record \(another invoice on the same address\), name that record in goal, so this operation is told apart from the confirmed one\. For the same record, keep the goal as it is\.$/);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0 }),
    /replayed manually\. If the page now shows another record, pass goal naming that record and the operation\.$/);
  const resumed = await runtime.run("Approve the sales invoice for ABC PTE LTD, 5,000.00", { evidenceLevel: "none" });
  assert.equal(resumed.status, "action_failed");
  assert.match(resumed.info, /Inspect the existing record\. If the page now shows another record \(another invoice on the same address\), name that record in this milestone's goal/);
  assert.equal(clicks(), 1);
  // Another record's goal is another operation.
  const next = await runtime.actManual({ tabId: "test", action: "click", element: 0, goal: "Approve the sales invoice for JevSteer QA CHAIN1020A, 50.00" });
  assert.equal(next.status, "action_unconfirmed");
  assert.equal(clicks(), 2);
  await runtime.resolveAction({ tabId: "test", actionId: next.action_id, resolution: "applied", evidence: "The invoice shows Approved" });
  // A run under a goal no record holds clicks.
  runtime.decider = scriptedDecider([{ side_effect: 0.9 }], { verifyScore: 0.1 });
  const other = await runtime.run("Approve the sales invoice for Third Co, 1.00", { evidenceLevel: "none" });
  assert.equal(clicks(), 3);
  assert.equal(other.pending_actions.length, 1);
});

test("a manual input given no goal, once applied, refuses the same input on the page under any goal", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{ side_effect: 0.9 }]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const bare = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.match(bare.info, /refused as a replay under any goal, since none was given\./);
  await runtime.resolveAction({ tabId: "test", actionId: bare.action_id, resolution: "applied", evidence: "The invoice shows Approved" });
  const note = "It was confirmed by a manual action given no goal, so it refuses this input on this page under any goal.";
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0, goal: "Approve the sales invoice for Third Co, 1.00" }),
    (error) => error.message.endsWith(note));
  const run = await runtime.run("Approve the sales invoice for Third Co, 1.00", { evidenceLevel: "none" });
  assert.equal(run.status, "action_failed");
  assert(run.info.endsWith(note), run.info);
  assert.equal(k.commands.filter((c) => c.command === "click").length, 1);
});

test("P2: a lost manual click ACK retains a recoverable durable journal record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-manual-"));
  try {
    const k = new MemoryKapture(page());
    k.onCommand = () => { throw new Error("connection reset after remote Save"); };
    const first = memoryRuntime(k, scriptedDecider([{}])); first.journal = new ActionJournal({ dir });
    first.shown = { ...k.page, tab_id: "test" };
    const result = await first.actManual({ tabId: "test", action: "click", element: 0 });
    assert.equal(result.status, "action_unconfirmed");
    assert.match(result.error, /connection reset/);
    const second = memoryRuntime(k, scriptedDecider([{}])); second.journal = new ActionJournal({ dir });
    second.shown = { ...k.page, tab_id: "test" };
    assert.equal((await second.journal.pending("test"))[0].id, result.action_id);
    await assert.rejects(() => second.actManual({ tabId: "test", action: "click", element: 0 }), /UNCONFIRMED_ACTION/);
    assert.equal(k.commands.filter(c=>c.command==="click").length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("P2: manually typing into a possibly autosaving field remains unresolved despite correct local value", async () => {
  const k = new MemoryKapture(page([field]));
  k.onCommand = (cmd, args) => { if (cmd === "fill") k.page.elements[0].value = args.value; };
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const result = await runtime.actManual({ tabId: "test", action: "type", element: 0, value: "Acme Inc" });
  assert.equal(result.status, "action_unconfirmed");
  assert.equal(result.effect?.status, "confirmed");
  assert.equal((await runtime.journal.pending("test")).length, 1);
  assert.equal(k.commands.filter(c=>c.command==="fill").length, 1);
});

test("P2: failed durable intent write prevents manual browser input", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  runtime.journal.begin = async () => { throw new Error("disk is read-only"); };
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0 }), /disk is read-only/);
  assert.equal(k.commands.length, 0);
});


test("manual click replay cannot be bypassed with ignored value or key parameters", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(first.status, "action_unconfirmed");
  await runtime.resolveAction({
    tabId: "test", actionId: first.action_id, resolution: "applied",
    evidence: "Independent source confirms the Save operation was committed",
  });
  await assert.rejects(() => runtime.actManual({
    tabId: "test", action: "click", element: 0, value: "unused", key: "Unrelated",
  }), /ACTION_ALREADY_APPLIED/);
  assert.equal(k.commands.filter(c => c.command === "click").length, 1);
});

test("manual Escape on no element is journaled like any key; resolved not_applied it can be pressed again, applied it is not replayed", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  k.tabDetail = async () => ({ url: k.page.url, title: k.page.title });
  // The default key is Escape. A page can answer it (cancel an edit, autosave),
  // so its outcome is the host's to resolve.
  const escape = await runtime.actManual({ tabId: "test", action: "press_key" });
  assert.equal(escape.status, "action_unconfirmed");
  assert.match(escape.info, /resolve it as applied/);
  assert.deepEqual((await runtime.journal.pending("test")).map((r) => [r.id, r.tool]), [[escape.action_id, "press_key"]]);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "press_key", key: "Escape" }), /UNCONFIRMED_ACTION/);
  assert.equal(k.commands.filter(c=>c.command==="keypress").length, 1);
  // Nothing changed on the site: it can be pressed again.
  const local = await runtime.resolveAction({ tabId: "test", actionId: escape.action_id, resolution: "not_applied", evidence: "The menu closed and nothing changed on the site" });
  assert.equal(local.replay_protected, false);
  const again = await runtime.actManual({ tabId: "test", action: "press_key", key: "Escape" });
  assert.equal(again.status, "action_unconfirmed");
  assert.equal(k.commands.filter(c=>c.command==="keypress").length, 2);
  // It cancelled something on the site: the same Escape here is a replay.
  const remote = await runtime.resolveAction({ tabId: "test", actionId: again.action_id, resolution: "applied", evidence: "The page discarded the draft on the server" });
  assert.equal(remote.replay_protected, true);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "press_key", key: "Escape" }), /ACTION_ALREADY_APPLIED/);
  assert.equal(k.commands.filter(c=>c.command==="keypress").length, 2);
});

test("manual Escape on an element gets the same guidance; resolved applied it is not replayed", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const escape = await runtime.actManual({ tabId: "test", action: "press_key", key: "Escape", element: 0 });
  assert.equal(escape.status, "action_unconfirmed");
  assert.match(escape.info, /resolve it as not_applied/);
  const resolved = await runtime.resolveAction({ tabId: "test", actionId: escape.action_id, resolution: "applied", evidence: "The edit was cancelled on the server" });
  assert.equal(resolved.replay_protected, true);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "press_key", key: "Escape", element: 0 }), /ACTION_ALREADY_APPLIED/);
  assert.equal(k.commands.filter(c=>c.command==="keypress").length, 1);
});

test("manual Enter is journaled and is not repeated before it is resolved", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  k.tabDetail = async () => ({ url: k.page.url, title: k.page.title });
  // Enter can submit a form.
  const enter = await runtime.actManual({ tabId: "test", action: "press_key", key: "Enter" });
  assert.equal(enter.status, "action_unconfirmed");
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "press_key", key: "Enter" }), /UNCONFIRMED_ACTION/);
  assert.equal(k.commands.filter(c=>c.command==="keypress").length, 1);
});


test("P1: confirmed local autosave field remains pending until independently verified", async () => {
  const k = new MemoryKapture(page([field]));
  k.onCommand = (cmd, args) => { if (cmd === "fill") k.page.elements[0].value = args.value; };
  const runtime = memoryRuntime(k, scriptedDecider([
    { tool: "type", side_effect: 0.9 },
    { tool: "none", done: 0.01 },
  ]));
  const result = await runtime.run("Autosave the customer name", {
    values: { name: "Acme Inc" }, evidenceLevel: "none", maxActions: 2,
  });
  assert.equal(k.commands.filter(c => c.command === "fill").length, 1);
  assert.equal((await runtime.journal.pending("test")).length, 1);
  assert.equal(result.status !== "completed_verified", true);
});

test("P2: applied ordinary manual link navigation can be repeated", async () => {
  const link = { i: 0, selector: "#customers", tag: "a", role: "link", label: "Customers", href: "/customers" };
  const k = new MemoryKapture(page([link]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(first.status, "action_unconfirmed");
  const resolved = await runtime.resolveAction({ tabId: "test", actionId: first.action_id, resolution: "applied", evidence: "Navigation confirmed" });
  assert.equal(resolved.replay_protected, false);
  const second = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(second.status, "action_unconfirmed");
  assert.equal(k.commands.filter(c => c.command === "click").length, 2);
});

test("P2: malformed manual actions never write phantom journal intents", async () => {
  const k = new MemoryKapture(page([field]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "type", element: 0 }), /type requires a value/);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click" }), /click requires a target selector/);
  assert.equal((await runtime.journal.pending("test")).length, 0);
  assert.equal(k.commands.length, 0);
});

test("P1: applied high-risk manual save is still replay protected", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  const resolved = await runtime.resolveAction({ tabId: "test", actionId: first.action_id, resolution: "applied", evidence: "Saved record verified" });
  assert.equal(resolved.replay_protected, true);
  await assert.rejects(() => runtime.actManual({ tabId: "test", action: "click", element: 0 }), /ACTION_ALREADY_APPLIED/);
});


test("P1: native select text and exact value are the same durable manual action", async () => {
  const region = {
    i: 0, selector: "#region", tag: "select", role: "combobox", label: "Region",
    value: "", options: [
      { text: "British Columbia", value: "CA-BC", disabled: false },
      { text: "Ontario", value: "CA-ON", disabled: false },
    ],
  };
  const k = new MemoryKapture(page([region]));
  k.onCommand = (cmd, args) => {
    if (cmd === "select") k.page.elements[0].value = args.value;
  };
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({
    tabId: "test", action: "select", element: 0, value: "British Columbia",
  });
  assert.equal(first.status, "action_unconfirmed");
  assert.equal(k.commands[0].args.value, "CA-BC");
  const records = await runtime.journal.pending("test");
  assert.equal(records.length, 1);
  const accepted = await runtime.resolveAction({
    tabId: "test", actionId: first.action_id, resolution: "applied",
    evidence: "Independent server state confirms region was saved",
  });
  assert.equal(accepted.replay_protected, true);
  await assert.rejects(() => runtime.actManual({
    tabId: "test", action: "select", element: 0, value: "CA-BC",
  }), /ACTION_ALREADY_APPLIED/);
  assert.equal(k.commands.filter(c => c.command === "select").length, 1);
});

test("P1: ambiguous native select labels fail before any journal write", async () => {
  const region = {
    i: 0, selector: "#region", tag: "select", role: "combobox", label: "Region",
    options: [
      { text: "Central", value: "first" },
      { text: "Central", value: "second" },
    ],
  };
  const k = new MemoryKapture(page([region]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  await assert.rejects(() => runtime.actManual({
    tabId: "test", action: "select", element: 0, value: "Central",
  }), /AMBIGUOUS_SELECT_OPTION/);
  assert.equal((await runtime.journal.pending("test")).length, 0);
  assert.equal(k.commands.length, 0);
});

test("P2: browser_act back recovery executes and does not create a journal entry", async () => {
  const k = new MemoryKapture({ ...page(), url: "https://generic.test/second" });
  k.tabDetail = async () => ({ url: k.page.url, title: "Editor" });
  k.onCommand = (command) => {
    if (command === "back") k.page.url = "https://generic.test/first";
  };
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  const result = await runtime.actManual({ tabId: "test", action: "back" });
  assert.equal(result.status, "completed");
  assert.equal(result.url, "https://generic.test/first");
  assert.deepEqual(k.commands.map(c => c.command), ["back"]);
  assert.equal((await runtime.journal.pending("test")).length, 0);
});

test("P2: meaningful same-document anchors can be revisited after applied resolution", async () => {
  const section = {
    i: 0, selector: "#details-link", tag: "a", role: "link",
    label: "Details", href: "#details",
  };
  const k = new MemoryKapture(page([section]));
  k.onCommand = (command) => {
    if (command === "click") k.page.url = "https://generic.test/editor#details";
  };
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(first.status, "action_unconfirmed");
  const resolved = await runtime.resolveAction({
    tabId: "test", actionId: first.action_id, resolution: "applied",
    evidence: "The details section is visible",
  });
  assert.equal(resolved.replay_protected, false);
  const second = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  assert.equal(second.status, "action_unconfirmed");
  assert.equal(k.commands.filter(c => c.command === "click").length, 2);
});

test("ambiguous placeholder anchor remains replay-protected conservatively", async () => {
  const placeholder = {
    i: 0, selector: "#action", tag: "a", role: "link",
    label: "Perform action", href: "#",
  };
  const k = new MemoryKapture(page([placeholder]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.shown = { ...k.page, tab_id: "test" };
  const first = await runtime.actManual({ tabId: "test", action: "click", element: 0 });
  const result = await runtime.resolveAction({
    tabId: "test", actionId: first.action_id, resolution: "applied",
    evidence: "Independent source confirms mutation committed",
  });
  assert.equal(result.replay_protected, true);
  await assert.rejects(() => runtime.actManual({
    tabId: "test", action: "click", element: 0,
  }), /ACTION_ALREADY_APPLIED/);
});
