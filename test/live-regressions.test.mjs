import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once, EventEmitter } from "node:events";
import { KaptureClient } from "../src/kapture-client.mjs";
import { JevSteerRuntime } from "../src/runtime.mjs";
import { buildSemanticPage, INTERACTIVE_SELECTOR, semanticSnapshot } from "../src/semantic-snapshot.mjs";
import { toModelPage } from "../src/page-model.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";
import { spawnSync } from "node:child_process";
import { toVerificationPage } from "../src/verification.mjs";
import { buildTargetSpace } from "../src/decision-space.mjs";
import { relevantRequest, safeUrl, sanitizeNetworkBody } from "../src/evidence.mjs";
import { rememberField } from "../src/element-identity.mjs";

test("Kapture HTTP visibility enum survives boolean query coercion", async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://local.test");
    // Real Kapture 2.6.1 would reject visible=true after coercing it to boolean.
    assert.equal(url.searchParams.get("visible"), "all");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ url: "https://demo.test", elements: [{ selector: "#visible", visible: true }, { selector: "#hidden", visible: false }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const k = new KaptureClient({ port: server.address().port });
    assert.deepEqual((await k.elements("demo", "button", { visible: "true" })).elements.map((e) => e.selector), ["#visible"]);
    assert.deepEqual((await k.elements("demo", "button", { visible: false })).elements.map((e) => e.selector), ["#hidden"]);
  } finally { server.close(); await once(server, "close"); }
});

test("Kapture close tolerates the exit handler clearing this.child", async () => {
  const k = new KaptureClient();
  const child = new EventEmitter();
  child.exitCode = null; child.signalCode = null;
  child.kill = (signal) => { child.signalCode = signal; k.child = null; child.emit("exit", null, signal); return true; };
  k.startedByUs = true; k.child = child;
  await k.close();
  assert.equal(k.child, null);
});

test("freshness compares equivalent relative and absolute link destinations", async () => {
  let href = "https://demo.test/protected/expenses/bills";
  const runtime = new JevSteerRuntime({ kapture: { elements: async () => ({ url: "https://demo.test/protected/home", elements: [{ visible: true, tagName: "a", href }] }) } });
  const action = { tool: "click", observedUrl: "https://demo.test/protected/home", el: { selector: "#bills", tag: "a", href: "/protected/expenses/bills" } };
  await runtime.assertTargetFresh("demo", action);
  href = "https://demo.test/protected/expenses/claims";
  await assert.rejects(() => runtime.assertTargetFresh("demo", action), /navigation changed/);
});

test("unnamed delete icons carry their filename hint and their own row context", () => {
  const page = buildSemanticPage({ domHtml: '<table><tr><td>Vendor Alpha</td><td><button id="delete"><img alt="" src="/_next/static/media/delete.abc123.svg"></button></td></tr><tr><td>Vendor Beta</td></tr></table>', rawElements: [{ tagName: "button", selector: "#delete", visible: true }] });
  assert.equal(page.elements[0].label, "icon: delete");
  assert(page.elements[0].near.includes("Vendor Alpha"));
  assert(!page.elements[0].near.includes("Vendor Beta"));
  assert(INTERACTIVE_SELECTOR.includes('td[class~="cursor-pointer"]'));
});

test("snapshot keeps exact multiline and long field values for effect checks; model context stays bounded", () => {
  const value = "First line\n  Second line " + "x".repeat(200);
  const page = buildSemanticPage({ domHtml: '<textarea id="notes"></textarea>', rawElements: [{ tagName: "textarea", selector: "#notes", visible: true, value }] });
  assert.equal(page.elements[0].value, value);
  assert(toModelPage(page).elements[0].value.length <= 160);
  assert.equal(verifyActionEffect(page, page, { tool: "type", el: page.elements[0], expected_value: value }).status, "confirmed");
});

test("hidden success text and script contents do not enter visible text or nearby context", () => {
  const page = buildSemanticPage({ domHtml: '<body><div><script>private script</script><p hidden>Hidden success</p><p style="display:none">Other hidden success</p><p>Visible record</p><button id="view">View</button><button hidden id="off">Hidden button</button></div></body>', rawElements: [{ tagName: "button", selector: "#view", visible: true }, { tagName: "button", selector: "#off", visible: true }] });
  assert.equal(page.elements.length, 1);
  assert(!page.text.includes("Hidden success"));
  assert(!page.text.includes("Other hidden"));
  assert(!page.elements[0].near.includes("private script"));
});

test("active financial detail dialogs keep background tables out of model context", () => {
  const page = buildSemanticPage({ domHtml: `<body><table><tr><td>${"Unrelated row ".repeat(900)}</td></tr></table><button id="background">Delete</button><div role="dialog" aria-modal="true"><h1>Bill details</h1><p>Vendor Alpha Total THB 264.83</p><button id="close">Close</button></div></body>`, rawElements: [{ tagName: "button", selector: "#background", visible: true }, { tagName: "button", selector: "#close", visible: true }] });
  assert(page.text.includes("Total THB 264.83"));
  assert(!page.text.includes("Unrelated row"));
  assert(page.background_context.includes("Unrelated row"));
  assert(page.text.length < 1000);
  assert.deepEqual(page.elements.map((e) => e.selector), ["#close"]);
});

test("OpenRouter config routes real Jev to System One and keeps keys local", () => {
  const env = { ...process.env, JEV_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test-key" };
  delete env.JEV_API_URL; delete env.TYPESAFE_API_KEY;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import {config,requireTypesafeKey} from './src/config.mjs'; console.log(JSON.stringify({provider:config.jevProvider,url:config.jevApiUrl,key_available:!!requireTypesafeKey()}))"], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { provider: "openrouter", url: "https://openrouter.ai/api/v1/systemone", key_available: true });
  assert(!result.stdout.includes("test-key"));
});

test("nested customer and contact Name fields keep distinct section context", () => {
  const page = buildSemanticPage({ domHtml: '<body><section><h2>Basic information</h2><label>Name<div><div><input id="customer" placeholder="Name"></div></div></label></section><section><h2>Contact</h2><div><div><label>Name<div><input id="contact" placeholder="Name"></div></label><label>Email<input id="email"></label></div></div></section></body>', rawElements: [{ tagName: "input", selector: "#customer", visible: true }, { tagName: "input", selector: "#contact", visible: true }] });
  assert(page.elements[0].near.includes("Basic information"));
  assert(page.elements[1].near.includes("Contact"));
});

test("verification of large tables keeps field state without sending every click target", () => {
  const elements = Array.from({ length: 1000 }, (_, i) => ({ i, tag: "td", label: `Record ${i}`, near: "Long row context ".repeat(15) }));
  elements.push({ i: 1000, tag: "input", role: "textbox", label: "Name", value: "JevSteer QA" });
  const page = toVerificationPage({ url: "https://demo.test/customers", title: "Customers", text: "JevSteer QA saved", metrics: { elements: 1001 }, elements });
  assert.equal(page.elements.length, 1);
  assert.equal(page.elements[0].value, "JevSteer QA");
  assert(JSON.stringify(page).length < 1000);
});

test("unidentified text inputs are not guessed as search or Enter targets", () => {
  const space = buildTargetSpace([{ i: 0, selector: "#unidentified", tag: "input", role: "textbox" }, { i: 1, selector: "#search", tag: "button", role: "button", label: "Search" }]);
  assert.equal(space.questions.type_target, undefined);
  assert.deepEqual(space.candidates.press_enter.map((c) => c.key), ["1"]);
});

test("confirmed correct inputs stay available for Enter but are removed from TYPE choices", async () => {
  let observed;
  const runtime = new JevSteerRuntime({ decider: async (_state, questions) => { observed = questions; return { answers: { tool: { choice: "press_enter", probabilities: { press_enter: 1 } } }, ms: 1, tokens: 1 }; } });
  const page = { url: "https://demo.test", title: "Search", text: "", metrics: {}, elements: [{ i: 0, selector: "#search", tag: "input", role: "textbox", label: "Search", value: "JevSteer QA" }] };
  const contract = { goal: "Find JevSteer QA", success_criteria: [], constraints: [], guidance: [] };
  await runtime.decide(page, contract, { search: "JevSteer QA" }, [], null, null, [{ field: rememberField(page.elements[0], page), url: page.url, value: "JevSteer QA" }]);
  assert.equal(observed.type_target, undefined);
  assert(observed.press_enter_target.criteria["0"]);
});

test("business evidence excludes telemetry and does not retain opaque compressed bodies", () => {
  assert.equal(relevantRequest({ method: "POST", status: 204, url: "https://h.clarity.ms/collect" }), false);
  assert.equal(relevantRequest({ method: "POST", status: 200, url: "https://api.demo.test/customers" }), true);
  assert.equal(sanitizeNetworkBody({ requestBody: "\u001f\u008bcompressed" }).request_body, "[NON_TEXT_BODY_OMITTED]");
});

test("ad and analytics beacons a form fires are not evidence of a write, and lose their query", () => {
  // What ccMonet's contact Add sent: Google Ads form_start beacons and an Amplitude batch.
  for (const url of ["https://www.google.com/ccm/form-data/1?em=tv.1~em.hash", "https://www.google.com/rmkt/collect/1/?en=form_start",
    "https://www.google.com/measurement/conversion/?en=form_start", "https://api2.amplitude.com/2/httpapi"]) {
    assert.equal(relevantRequest({ method: "POST", status: 200, url }), false, url);
  }
  assert.equal(safeUrl("https://www.google.com/ccm/form-data/1?em=tv.1~em.hash&gcl=x"), "https://www.google.com/ccm/form-data/1");
  // The app's own API, Google's other services and lookalike hosts still count.
  for (const url of ["https://api.ccmonet.com/customer/save", "https://www.google.com/search", "https://maps.googleapis.com/maps/api/place/autocomplete/json", "https://notamplitude.com/x"]) {
    assert.equal(relevantRequest({ method: "POST", status: 200, url }), true, url);
  }
  assert.equal(safeUrl("https://app.test/x?page=2"), "https://app.test/x?page=2");
});

test("navigation waits poll fresh lightweight DOM metadata before another decision", async () => {
  let calls = 0;
  const runtime = new JevSteerRuntime({ kapture: { dom: async (_tab, options) => { assert.equal(options.selector, "title"); return { url: ++calls > 1 ? "https://demo.test/final" : "https://demo.test/start" }; } } });
  await runtime.waitForNavigation("demo", "https://demo.test/start", { max: 1000 });
  assert.equal(calls, 2);
});

test("native toggle property state is read with CSS even when checked attributes are stale", async () => {
  const kapture = {
    elements: async (_tab, selector) => ({ elements: selector.includes(":checked") ? [{ selector: "#enabled" }] : [
      { tagName: "input", selector: "#enabled", visible: true },
      { tagName: "input", selector: "#disabled", visible: true },
    ] }),
    dom: async () => ({ url: "https://demo.test", title: "Controls", html: '<input id="enabled" aria-label="Enabled" type="checkbox"><input id="disabled" aria-label="Disabled" type="checkbox" checked>' }),
  };
  const page = await semanticSnapshot(kapture, "demo");
  assert.equal(page.elements[0].checked, true);
  assert.equal(page.elements[1].checked, false);
  const before = { ...page, elements: [{ ...page.elements[0], checked: false }] };
  assert.equal(verifyActionEffect(before, page, { tool: "click", el: before.elements[0] }).status, "confirmed");
});
