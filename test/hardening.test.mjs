import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, utimes, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KaptureClient } from "../src/kapture-client.mjs";
import { TabLeaseManager } from "../src/lease.mjs";
import { JevSteerRuntime } from "../src/runtime.mjs";
import { verifyActionEffect } from "../src/action-effect.mjs";
import { isSensitiveName } from "../src/sensitive.mjs";
import { redact, safeUrl } from "../src/evidence.mjs";
import { normalizeMilestonePlan } from "../src/milestones.mjs";
import { normalizeAssertions } from "../src/task-contract.mjs";
import { buildSemanticPage } from "../src/semantic-snapshot.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-hardening-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("KaptureClient.close does not crash when the spawned child exits on SIGTERM", async () => {
  const client = new KaptureClient({ port: 1 });
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"]);
  await once(child, "spawn");
  client.child = child;
  client.startedByUs = true;
  // Same listener ensureServer registers: it clears child on exit.
  child.on("exit", () => { client.child = null; });
  await client.close();
  assert.equal(client.child, null);
  assert.ok(child.exitCode === 0 || child.signalCode != null);
});

test("an empty or corrupt lock file does not block a tab forever", async () => {
  await withTempDir(async (dir) => {
    const manager = new TabLeaseManager({ dir, ttlMs: 60000 });
    const path = manager.path("tab-1");
    await writeFile(path, "");
    // A fresh unreadable lock may still be mid-write: keep it locked.
    assert.equal((await manager.inspect("tab-1")).locked, true);
    await assert.rejects(() => manager.acquire("tab-1"), /TAB_BUSY/);
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    const lease = await manager.acquire("tab-1", { runId: "after-crash" });
    assert.equal(JSON.parse(await readFile(path, "utf8")).run_id, "after-crash");
    await lease.release();
  });
});

test("releasing a lease that another run took over leaves the new owner's lock", async () => {
  await withTempDir(async (dir) => {
    const manager = new TabLeaseManager({ dir, ttlMs: 60000 });
    const lease = await manager.acquire("tab-1", { runId: "first" });
    const path = manager.path("tab-1");
    await writeFile(path, JSON.stringify({ pid: process.pid, run_id: "second" }));
    await lease.release();
    assert.equal(JSON.parse(await readFile(path, "utf8")).run_id, "second");
  });
});

function freshnessRuntime(liveElement) {
  return new JevSteerRuntime({ kapture: { elements: async () => ({ elements: [liveElement] }) } });
}

test("password fields are not reported stale because the snapshot value is redacted", async () => {
  const runtime = freshnessRuntime({ visible: true, tagName: "input", value: "" });
  await runtime.assertTargetFresh("t1", {
    tool: "type",
    el: { selector: "#password", tag: "input", type: "password", value: "[REDACTED]" },
  });
});

test("freshness compares live field values the way snapshots normalize them", async () => {
  const live = "first line\n\nsecond   line " + "x".repeat(300);
  const snapshotValue = buildSemanticPage({
    domHtml: '<body><textarea id="notes"></textarea></body>',
    rawElements: [{ visible: true, selector: "#notes", tagName: "textarea", value: live }],
  }).elements[0].value;
  await freshnessRuntime({ visible: true, tagName: "textarea", value: live }).assertTargetFresh("t1", {
    tool: "type",
    el: { selector: "#notes", tag: "textarea", value: snapshotValue },
  });
  await assert.rejects(
    () => freshnessRuntime({ visible: true, tagName: "textarea", value: "edited by someone else" }).assertTargetFresh("t1", {
      tool: "type",
      el: { selector: "#notes", tag: "textarea", value: snapshotValue },
    }),
    /STALE_TARGET: field value changed/,
  );
});

function page(elements) {
  return { url: "https://app.test/form", title: "Form", text: "", elements };
}

test("typing multi-line or long text is confirmed against the normalized snapshot value", () => {
  const el = { selector: "#notes", tag: "textarea" };
  const typed = "Dear team,\n\nPlease review   the attached invoice. " + "y".repeat(400);
  const after = buildSemanticPage({
    domHtml: '<body><textarea id="notes"></textarea></body>',
    rawElements: [{ visible: true, selector: "#notes", tagName: "textarea", value: typed }],
  }).elements[0];
  const effect = verifyActionEffect(page([el]), page([after]), { tool: "type", el, expected_value: typed });
  assert.equal(effect.status, "confirmed");
  const wrong = verifyActionEffect(page([el]), page([{ ...after, value: "something else" }]), { tool: "type", el, expected_value: typed });
  assert.equal(wrong.status, "failed");
});

test("a fill that leaves a native field empty is still a failed effect", () => {
  const el = { selector: "#email", tag: "input", type: "email" };
  const after = buildSemanticPage({
    domHtml: '<body><input id="email" type="email"></body>',
    rawElements: [{ visible: true, selector: "#email", tagName: "input", value: "" }],
  }).elements[0];
  assert.equal(after.value, undefined);
  assert.equal(verifyActionEffect(page([el]), page([after]), { tool: "type", el, expected_value: "a@b.test" }).status, "failed");
});

test("contenteditable typing is checked against element text, not a missing value", () => {
  const el = { selector: "#editor", tag: "div", role: "textbox", contenteditable: true };
  const after = { ...el, text: "Hello world" };
  assert.equal(verifyActionEffect(page([el]), page([after]), { tool: "type", el, expected_value: "Hello world" }).status, "confirmed");
  assert.equal(verifyActionEffect(page([el]), page([{ ...el, text: "Hello" }]), { tool: "type", el, expected_value: "Hello world" }).status, "failed");
});

test("select effect accepts an option matched by its visible text", () => {
  const el = { selector: "#priority", tag: "select" };
  const after = { ...el, options: [{ text: "Urgent", value: "3", selected: true }] };
  assert.equal(verifyActionEffect(page([el]), page([after]), { tool: "select", el, expected_value: "urgent" }).status, "confirmed");
  assert.equal(verifyActionEffect(page([el]), page([after]), { tool: "select", el, expected_value: "Low" }).status, "failed");
});

test("secret detection keeps short tokens to whole words", () => {
  for (const name of ["password", "confirmPassword", "user_pass", "PIN", "cardPin", "pin_code", "otp", "smsOtp", "2fa", "cvv", "api_key", "apiKey", "access_token", "Authorization", "set-cookie", "security_code", "client_secret",
    // Compound names the previous substring rule hid from Jev must stay hidden.
    "userpass", "dbpass", "cardpin", "userpin", "pin1", "pins", "pinnumber", "pinCode", "totp", "hotp_code", "cardcvv", "cvv2", "otpvalue", "passkey", "passport", "2FA", "use2FA"]) {
    assert.equal(isSensitiveName(name), true, name);
  }
  for (const name of ["shipping_address", "shippingAddress", "mapping", "opinion", "passed", "passenger", "passing", "spinner", "pinned", "hotpot", "footprint", "email", "Customer name"]) {
    assert.equal(isSensitiveName(name), false, name);
  }
  assert.deepEqual(redact({ shipping_address: "1 Main St", pin: "1234", passed: true }), { shipping_address: "1 Main St", pin: "[REDACTED]", passed: true });
  assert.equal(safeUrl("https://app.test/?mapping=a&otp=9"), "https://app.test/?mapping=a&otp=%5BREDACTED%5D");
});

test("milestone plans reject silent truncation and invalid action budgets", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ goal: `Step ${i}` }));
  assert.throws(() => normalizeMilestonePlan({ goal: "Long", milestones: many }), /Too many milestones/);
  const plan = normalizeMilestonePlan({ goal: "G", milestones: [{ goal: "A", max_actions: "lots" }, { goal: "B", max_actions: 99 }], maxActions: 7 });
  assert.deepEqual(plan.milestones.map((m) => m.max_actions), [7, 40]);
  assert.equal(normalizeMilestonePlan({ goal: "G", maxActions: Number.NaN }).milestones[0].max_actions, 12);
});

test("url_matches assertions keep the regex verbatim", () => {
  const pattern = "^https://app\\.test/(a|b)  /" + "c".repeat(250);
  const [assertion] = normalizeAssertions([{ type: "url_matches", value: pattern }]);
  assert.equal(assertion.value, pattern);
});

test("aria-labelledby ignores empty id references", () => {
  const result = buildSemanticPage({
    domHtml: '<body><div id="">Unrelated</div><span id="l">Email</span><input id="f" aria-labelledby=" l "></body>',
    rawElements: [{ visible: true, selector: "#f", tagName: "input" }],
  });
  assert.equal(result.elements[0].label, "Email");
});

test("semantic snapshot stays fast on pages with thousands of labelled controls", () => {
  let html = "<html><body>";
  const raw = [];
  for (let i = 0; i < 1000; i++) {
    html += `<div><span id="l${i}">Row ${i}</span><label for="f${i}">Field ${i}</label><input id="f${i}" aria-labelledby="l${i}"><input id="g${i}"><a id="a${i}" href="/x/${i}">Open</a></div>`;
    raw.push({ visible: true, selector: `#f${i}`, tagName: "input" }, { visible: true, selector: `#g${i}`, tagName: "input" }, { visible: true, selector: `#a${i}`, tagName: "a" });
  }
  const started = performance.now();
  const result = buildSemanticPage({ domHtml: `${html}</body></html>`, rawElements: raw });
  const ms = performance.now() - started;
  assert.equal(result.elements.length, 3000);
  assert.equal(result.elements[0].label, "Row 0");
  assert.equal(result.elements[2].label, "Open");
  // Was ~10s before the per-snapshot index; generous bound for slow CI.
  assert.ok(ms < 3000, `snapshot took ${Math.round(ms)}ms`);
});

test("a target-only Jev request (large-page second stage) still validates its target head", async () => {
  const { jev } = await import("../src/jev.mjs");
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.TYPESAFE_API_KEY = "test-key";
  const questions = { click_target: { type: "choice", instructions: "pick", criteria: { 0: "a", 1: "b" } } };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ answers: {} }), { status: 200 });
    await assert.rejects(jev({}, questions, { retries: 0 }), /missing answer: click_target/);
    globalThis.fetch = async () => new Response(JSON.stringify({ answers: { click_target: { choice: "1", probabilities: { 0: 0.1, 1: 0.9 } } } }), { status: 200 });
    const result = await jev({}, questions, { retries: 0 });
    assert.equal(result.answers.click_target.choice, "1");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});
