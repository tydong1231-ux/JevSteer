import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticPage, INTERACTIVE_SELECTOR } from "../src/semantic-snapshot.mjs";
import { observeUntilReady } from "../src/observation.mjs";
import { buildTargetSpace } from "../src/decision-space.mjs";
import { toVerificationPage } from "../src/verification.mjs";
import { MemoryKapture, memoryRuntime, scriptedDecider } from "./helpers/runtime.mjs";

const field = { i: 0, selector: ".kapture-1", tag: "input", role: "searchbox", name: "q", type: "search", label: "Quick search", value: "", context: "Search", identity_version: 1 };
const page = (elements = [field], url = "https://example.test/") => ({ url, title: "Example", text: "Search", elements, metrics: {} });

test("generated locator churn binds both journal intent and dispatch to the last live locator", async () => {
  const k = new MemoryKapture(page([{ ...field, selector: ".kapture-2" }]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  k.elements = async (_tab, selector) => {
    assert.equal(selector, ".kapture-2");
    return { url: k.page.url, elements: [{ ...field, selector: ".kapture-3", tagName: "input", visible: true }] };
  };
  let journaled;
  const action = { tool: "type", target: 0, el: { ...field }, value: "dataclasses", observedUrl: k.page.url, beforeDispatch: async () => { journaled = action.el.selector; assert.equal(k.commands.length, 0); } };
  await runtime.act("test", action);
  assert.equal(journaled, ".kapture-3");
  assert.deepEqual(k.commands, [{ command: "fill", args: { selector: ".kapture-3", value: "dataclasses" } }]);
});

test("generated locator recovery refuses duplicate identities and changed records", async () => {
  for (const elements of [
    [{ ...field, selector: ".kapture-2" }, { ...field, selector: ".kapture-3" }],
    [{ ...field, selector: ".kapture-2", context: "Different record" }],
  ]) {
    const k = new MemoryKapture(page(elements));
    const runtime = memoryRuntime(k, scriptedDecider([{}]));
    let journaled = false;
    await assert.rejects(runtime.act("test", { tool: "type", target: 0, el: field, value: "dataclasses", observedUrl: k.page.url, beforeDispatch: async () => { journaled = true; } }), /STALE_TARGET/);
    assert.equal(journaled, false);
    assert.equal(k.commands.length, 0);
  }
});

test("locator recovery still rejects authored-selector changes and concurrently changed values", async () => {
  const original = { ...field, selector: "#original" };
  const k = new MemoryKapture(page([{ ...original, selector: "#replacement" }]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  await assert.rejects(runtime.act("test", { tool: "type", target: 0, el: original, value: "dataclasses", observedUrl: k.page.url }), /STALE_TARGET/);
  k.page = page([{ ...field, selector: ".kapture-2" }]);
  k.elements = async () => ({ url: k.page.url, elements: [{ ...field, selector: ".kapture-3", tagName: "input", visible: true, value: "someone else's input" }] });
  await assert.rejects(runtime.act("test", { tool: "type", target: 0, el: field, value: "dataclasses", observedUrl: k.page.url }), /field value changed/);
  assert.equal(k.commands.length, 0);
});

test("CSS-hidden modal templates neither suppress main controls nor leak foreground text", () => {
  const p = buildSemanticPage({ domHtml: '<button id="search">Search flights</button><div id="calendar" role="dialog" aria-modal="true" class="css-hidden"><h1>Hidden calendar</h1><button id="done">Done</button></div>', rawElements: [
    { selector: "#search", tagName: "button", visible: true },
    { selector: "#calendar", tagName: "div", visible: false },
    { selector: "#done", tagName: "button", visible: false },
  ] });
  assert.deepEqual(p.elements.map(e => e.label), ["Search flights"]);
  assert(p.text.includes("Search flights"));
  assert(!p.text.includes("Hidden calendar"));
  assert(INTERACTIVE_SELECTOR.includes('[role="dialog"][aria-modal="true"]'));
});

test("a visible text-only modal blocks background outcomes even when a hidden modal follows it", () => {
  const p = buildSemanticPage({ domHtml: '<p>Saved REF-42</p><button id="save">Save</button><div id="warning" role="dialog" aria-modal="true"><h1>Permission denied</h1></div><div id="hidden" role="dialog" aria-modal="true">Wrong template</div>', rawElements: [
    { selector: "#save", tagName: "button", visible: true },
    { selector: "#warning", tagName: "div", visible: true },
    { selector: "#hidden", tagName: "div", visible: false },
  ] });
  assert.equal(p.elements.length, 0);
  assert(p.text.includes("Permission denied"));
  assert(!p.text.includes("Saved REF-42"));
  assert(!p.text.includes("Wrong template"));
});

test("navigation observation waits through an unchanged old page and content-script teardown", async () => {
  let time = 0, reads = 0;
  const before = page([]);
  const after = page([], "https://example.test/target");
  const result = await observeUntilReady(async () => {
    reads++;
    if (reads === 2) throw new Error("Could not establish connection. Receiving end does not exist.");
    return reads >= 4 ? after : before;
  }, { before, action: { tool: "click", tag: "a", el: { tag: "a", href: "/target" } }, maxMs: 100, navigationMs: 1000, pollMs: 100, quietMs: 100, now: () => time, pause: async ms => { time += ms; } });
  assert.equal(result.page.url, after.url);
  assert.equal(result.effect.status, "confirmed");
  assert.equal(result.timed_out, false);
  assert(reads >= 5);
});

test("navigation never accepts an unchanged page and does not hide permanent errors", async () => {
  let time = 0;
  const before = page([]);
  const action = { tool: "click", tag: "a", el: { tag: "a", href: "/target" } };
  const result = await observeUntilReady(async () => before, { before, action, maxMs: 200, quietMs: 0, pollMs: 100, now: () => time, pause: async ms => { time += ms; } });
  assert.equal(result.timed_out, true);
  assert.equal(result.effect.status, "unknown");
  await assert.rejects(observeUntilReady(async () => { throw new Error("Access denied"); }, { before, action }), /Access denied/);
  await assert.rejects(observeUntilReady(async () => { throw new Error("command timeout"); }, { before, action: { tool: "click", el: { tag: "button" } } }), /command timeout/);
});

test("search Enter tolerates a temporarily absent document during a full-page navigation", async () => {
  let time = 0, reads = 0;
  const before = page([field]);
  const result = await observeUntilReady(async () => {
    if (++reads === 1) throw new Error("Kapture GET /tab/test/dom: Cannot read properties of null (reading 'outerHTML')");
    return page([], "https://example.test/search?q=dataclasses");
  }, { before, action: { tool: "press_enter", el: field }, maxMs: 200, quietMs: 0, pollMs: 50, now: () => time, pause: async ms => { time += ms; } });
  assert.equal(result.page.url, "https://example.test/search?q=dataclasses");
  assert.equal(reads, 2);
});

test("a lost link acknowledgement with delayed navigation continues without clicking twice", async () => {
  const link = { i: 0, selector: "#target", tag: "a", role: "link", label: "Target", href: "/target" };
  const k = new MemoryKapture(page([link]));
  let dispatched = false, reads = 0;
  k.onCommand = command => { if (command === "click") { dispatched = true; throw new Error("command timeout"); } };
  const runtime = memoryRuntime(k, scriptedDecider([{ tool: "click" }, { tool: "none", done: 0.99 }]));
  runtime.observation = { maxMs: 0, navigationMs: 100, quietMs: 0, pollMs: 1 };
  runtime.snapshotter = async () => dispatched && ++reads >= 3 ? page([], "https://example.test/target") : structuredClone(k.page);
  const result = await runtime.run("Open target", { tabId: "test", assertions: [{ type: "url_contains", value: "/target" }] });
  assert.equal(result.status, "completed_verified");
  assert.equal(k.commands.filter(c => c.command === "click").length, 1);
  assert.equal((await runtime.journal.pending("test")).length, 0);
});

test("browser_open confirms a lost ACK through fresh destination DOM rather than stale registry metadata", async () => {
  const k = new MemoryKapture(page());
  let navigations = 0;
  k.navigate = async () => { navigations++; throw new Error("Timeout waiting for content script"); };
  k.dom = async () => ({ url: "https://example.test/target", title: "Target" });
  k.tabDetail = async () => ({ url: "https://wrong.test/", title: "Stale registry entry" });
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  const result = await runtime.open("https://example.test/target", { tabId: "test", newTab: false });
  assert.equal(result.url, "https://example.test/target");
  assert.equal(result.recovery, "destination_confirmed_after_transport_error");
  assert.equal(navigations, 1);
});

test("browser_open returns its tab for inspection if navigation remains unconfirmed", async () => {
  const k = new MemoryKapture(page());
  let navigations = 0;
  k.navigate = async () => { navigations++; throw new Error("command timeout"); };
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  runtime.waitForDestination = async () => null;
  const result = await runtime.open("https://example.test/target", { tabId: "test", newTab: false });
  assert.equal(result.status, "navigation_unconfirmed");
  assert.equal(result.tab_id, "test");
  assert.equal(navigations, 1);
});

test("destination confirmation rejects a different route even with a successful DOM response", async () => {
  const k = new MemoryKapture(page());
  k.dom = async () => ({ url: "https://example.test/wrong", title: "Wrong" });
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  assert.equal(await runtime.waitForDestination("test", "https://example.test/target", { max: 0 }), null);
});

test("page reads retry content-script teardown a bounded number of times and surface persistent failure", async () => {
  const k = new MemoryKapture(page());
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  let calls = 0;
  runtime.snapshotter = async () => { if (++calls < 3) throw new Error("Could not establish connection. Receiving end does not exist."); return page(); };
  assert.equal((await runtime.readPage("test")).url, k.page.url);
  assert.equal(calls, 3);
  calls = 0;
  runtime.snapshotter = async () => { calls++; throw new Error("Could not establish connection. Receiving end does not exist."); };
  await assert.rejects(runtime.readPage("test"), /Receiving end/);
  assert.equal(calls, 3);
});

test("explicit GET search forms retain navigation evidence but ordinary buttons and POST forms do not", () => {
  const p = buildSemanticPage({ tab: { url: "https://example.test/docs/" }, domHtml: '<form action="search.html"><input type="search"><button id="go">Go</button><button id="local" type="button">Local</button></form><form action="/save" method="post"><button id="save">Save</button></form>', rawElements: ["go", "local", "save"].map(id => ({ selector: `#${id}`, tagName: "button", visible: true })) });
  assert.equal(p.elements[0].form_action, "https://example.test/docs/search.html");
  assert.equal(p.elements[1].form_action, undefined);
  assert.equal(p.elements[2].form_action, undefined);
});

test("a GET form submit waits through document teardown without replaying submission", async () => {
  let time = 0, reads = 0;
  const before = page([]);
  const result = await observeUntilReady(async () => {
    if (++reads < 3) throw new Error("Kapture GET /tab/test/dom: Cannot read properties of null (reading 'outerHTML')");
    return page([], "https://example.test/search?q=dataclasses");
  }, { before, action: { tool: "click", tag: "button", el: { tag: "button", form_action: "https://example.test/search" } }, maxMs: 200, quietMs: 0, pollMs: 50, now: () => time, pause: async ms => { time += ms; } });
  assert.equal(result.effect.status, "confirmed");
  assert.equal(result.timed_out, false);
});

test("ARIA listbox containers are never click/select targets but their exact options and native selects remain available", () => {
  const elements = [
    { i: 0, selector: "#list", tag: "div", role: "listbox", label: "YVR Yvrac" },
    { i: 1, selector: "#airport", tag: "div", role: "option", label: "Vancouver International Airport YVR" },
    { i: 2, selector: "#town", tag: "div", role: "option", label: "Yvrac France" },
    { i: 3, selector: "#native", tag: "select", role: "listbox", options: [{ value: "YVR", text: "Vancouver", selected: false }] },
  ];
  const space = buildTargetSpace(elements);
  for (const candidates of Object.values(space.candidates)) assert(!candidates.some(c => c.element.i === 0));
  assert(space.candidates.click.some(c => c.element.i === 1));
  assert(space.candidates.click.some(c => c.element.i === 2));
  assert(space.candidates.select.some(c => c.element.i === 3 && c.option.value === "YVR"));
});

test("manual listbox container clicks fail before journaling or dispatch", async () => {
  const listbox = { i: 0, selector: "#list", tag: "div", role: "listbox" };
  const k = new MemoryKapture(page([listbox]));
  const runtime = memoryRuntime(k, scriptedDecider([{}]));
  let journaled = false;
  for (const tool of ["click", "select"]) {
    await assert.rejects(runtime.act("test", { tool, target: 0, el: listbox, beforeDispatch: async () => { journaled = true; } }), /listbox option|select or combobox/);
  }
  assert.equal(journaled, false);
  assert.equal(k.commands.length, 0);
});

test("verification preserves compact button state such as passenger count alongside exact field labels", () => {
  const observed = toVerificationPage(page([
    { ...field, label: "Where from? Vancouver YVR", value: "Vancouver" },
    { i: 1, selector: "#passengers", tag: "button", role: "button", label: "1 passenger" },
    ...Array.from({ length: 150 }, (_, i) => ({ i: i + 2, selector: `#flight${i}`, tag: "button", role: "button", label: "Select flight" })),
  ]));
  assert.equal(observed.elements.length, 1);
  assert.equal(observed.elements[0].label, "Where from? Vancouver YVR");
  assert(observed.control_summaries.some(e => e.label === "1 passenger"));
  assert.equal(observed.control_summaries.length, 40);
  assert(observed.control_summaries.every(e => !e.selector));
});
