import test from "node:test";
import assert from "node:assert/strict";
import { JevSteerRuntime } from "../src/runtime.mjs";
import { ActionJournal } from "../src/action-journal.mjs";
import { PageEvents } from "../src/browser/events.mjs";

// A runtime over a driver stub with a browser session, enough for the
// session-wide checks on unconfirmed input and for browser_doctor.
function runtime(driver = {}) {
  return new JevSteerRuntime({
    driver: { kind: "playwright", sessionId: "s1", ready: async () => ({ mode: "cdp", session_id: "s1" }), pages: async () => [], ...driver },
    journal: new ActionJournal({ dir: null }),
    decider: async () => { throw new Error("no Jev call expected"); },
    observation: { maxMs: 0, quietMs: 0 },
  });
}

const page = (id) => ({ url: `https://app.test/${id}`, session_id: "s1", page_id: id });
const click = { tool: "click", el: { tag: "button", role: "button", label: "Open" } };

test("unconfirmed input judged unlikely to write blocks neither other pages nor navigation", async () => {
  const r = runtime();
  await r.journal.begin("A", { runId: "run", milestoneId: "m", action: click, page: page("A"), intent: "open the menu", remoteRisk: 0.25 });
  assert.equal((await r.journal.pendingSession("s1")).length, 1);
  await r.assertSessionClear("B");
  await r.assertOpenClear(undefined, "https://app.test/other");
  await r.assertOpenClear("A", "https://app.test/other");
});

test("unconfirmed input judged likely to write still blocks the session until the host resolves it", async () => {
  const r = runtime();
  const record = await r.journal.begin("A", { runId: "run", milestoneId: "m", action: click, page: page("A"), intent: "save", remoteRisk: 0.6 });
  await assert.rejects(() => r.assertSessionClear("B"), /UNCONFIRMED_SESSION_ACTION/);
  await assert.rejects(() => r.assertOpenClear(undefined, "https://app.test/other"), /UNCONFIRMED_SESSION_ACTION/);
  await r.assertOpenClear(undefined, "about:blank");
  await r.assertSessionClear("A");
  await r.journal.resolve("A", record.id, "not_applied", "the page shows no saved record");
  await r.assertSessionClear("B");
});

test("a legacy record without a risk counts as a likely write", async () => {
  const r = runtime();
  await r.journal.begin("A", { runId: "run", milestoneId: "m", action: click, page: page("A"), intent: "save" });
  const [record] = await r.journal.pendingSession("s1");
  delete record.remote_risk;
  await r.journal.save("A", [record]);
  await assert.rejects(() => r.assertSessionClear("B"), /UNCONFIRMED_SESSION_ACTION/);
});

test("browser_doctor says what a failed browser start needs", async () => {
  const missing = runtime({ ready: async () => { throw new Error("browserType.launchPersistentContext: Executable doesn't exist at /x/chrome"); } });
  const report = await missing.doctor();
  assert.equal(report.status, "not_ready");
  assert.match(report.fix, /npm run browser:install|JEVSTEER_BROWSER_CHANNEL/);
  const refused = runtime({ ready: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:9222"); } });
  assert.match((await refused.doctor()).fix, /remote debugging/);
});

test("browser_doctor probes each tab and names sleeping and background ones", async () => {
  const tabs = [
    { tabId: "pw:1", pageId: "pw:1", sessionId: "s1", url: "https://app.test/a", title: "A" },
    { tabId: "pw:2", pageId: "pw:2", sessionId: "s1", url: "https://app.test/b", title: "B" },
  ];
  process.env.OPENROUTER_API_KEY ||= "test-key";
  const r = runtime({
    pages: async () => tabs,
    probe: async (id) => (id === "pw:1" ? { responsive: false, visible: false } : { responsive: true, visible: false }),
  });
  r.leases.inspect = async () => ({ locked: false });
  const report = await r.doctor();
  assert.equal(report.status, "ready");
  assert.equal(report.tabs[0].responsive, false);
  assert.equal(report.tabs[1].visible, false);
  assert.match(report.next_step, /pw:1.*sleeping|does not answer/);
});

test("page events count the responses to requests that can change remote data", () => {
  const listeners = {};
  const fakePage = { on: (name, fn) => { listeners[name] = fn; }, off: () => {} };
  const events = new PageEvents(fakePage, { now: () => 1000 });
  const response = (method, url, type) => listeners.response({ request: () => ({ method: () => method, url: () => url, resourceType: () => type }), url: () => url, status: () => 200 });
  response("GET", "https://app.test/api/list", "xhr");
  response("POST", "https://www.google-analytics.com/collect", "xhr");
  response("POST", "https://app.test/api/invoices", "fetch");
  response("PUT", "https://app.test/api/invoices/1", "xhr");
  response("POST", "https://app.test/submit", "document");
  response("POST", "https://app.test/img.png", "image");
  assert.equal(events.writes(0), 3);
  assert.equal(events.writes(Date.now() + 60000), 0);
});

import { MemoryKapture, memoryRuntime, scriptedDecider } from "./helpers/runtime.mjs";

// Demo recording 2026-10-22 on ccMonet: a click judged 0.25 likely to write
// (the "+" that opens the create menu) opened its menu and sent nothing, but
// its record stayed pending once the milestone ended on needs_guidance, and
// blocked every other page of the session until the host resolved it by hand.
test("input judged possibly, not likely, to write closes once its local effect shows and no write request followed", async () => {
  const menuButton = { i: 0, selector: "#plus", tag: "button", role: "button", label: "+" };
  const k = new MemoryKapture({ url: "https://erp.test/invoices", title: "Sales Invoices", text: "Sales Invoices +", elements: [menuButton] });
  k.onCommand = (command) => {
    if (command !== "click") return;
    k.page = { ...k.page, text: "Sales Invoices + Create Invoice (Manual Entry) Create Invoice (From File)",
      elements: [menuButton, { i: 1, selector: "#manual", tag: "a", role: "menuitem", label: "Create Invoice (Manual Entry)" }], requests_since_input: 0, writes_since_input: 0 };
  };
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "click", target: 0, side_effect: 0.3 }, { next_step_clear: 0.1 }]));
  const result = await runtime.run("Open an empty new sales invoice form with manual entry", { evidenceLevel: "none" });
  assert.equal(result.status, "needs_guidance");
  assert.equal(result.actions[0].journal, "closed_local_effect");
  assert.equal(result.pending_actions, undefined);
  assert.deepEqual(await runtime.journal.pending("test"), []);
  assert.deepEqual(await runtime.journal.pendingSession("test-session"), []);
});

test("input judged likely to write stays pending for verification or the host even once the page changed", async () => {
  const save = { i: 0, selector: "#save", tag: "button", role: "button", label: "Save" };
  const k = new MemoryKapture({ url: "https://erp.test/invoices/new", title: "New Invoice", text: "New Invoice Save", elements: [save] });
  k.onCommand = (command) => { if (command === "click") k.page = { ...k.page, text: "New Invoice Save Saved", requests_since_input: 1, writes_since_input: 1 }; };
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "click", target: 0, side_effect: 0.3 }, { next_step_clear: 0.1 }]));
  const result = await runtime.run("Save the invoice", { evidenceLevel: "none" });
  assert.equal(result.pending_actions?.length, 1);
  assert.equal((await runtime.journal.pending("test")).length, 1);
});

test("low-risk input with a lost acknowledgement, no effect and no request closes as not applied", async () => {
  const tab = { i: 0, selector: "#tab", tag: "input", role: "radio", label: "Reconcile by Bank Account" };
  const k = new MemoryKapture({ url: "https://erp.test/statements", title: "Bank Statements", text: "Bank Statements Reconcile by Bank Account", elements: [tab], requests_since_input: 0, writes_since_input: 0 });
  k.onCommand = (command) => { if (command === "click") throw new Error("browser command timed out"); };
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "click", target: 0, side_effect: 0.05 }]));
  const result = await runtime.run("Open the Reconcile by Bank Account view", { evidenceLevel: "none" });
  assert.equal(result.status, "action_failed");
  assert.match(result.info, /nothing reached the site/);
  assert.equal(result.pending_actions, undefined);
  assert.deepEqual(await runtime.journal.pending("test"), []);
});
