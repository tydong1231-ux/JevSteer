import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { jev } from "../src/jev.mjs";
import { KaptureClient } from "../src/kapture-client.mjs";
import { semanticSnapshot } from "../src/semantic-snapshot.mjs";
import { safeUrl } from "../src/evidence.mjs";

test("Jev does not retry a permanent authentication failure", async () => {
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  process.env.TYPESAFE_API_KEY = "test-key";
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  };
  try {
    await assert.rejects(
      jev({ page: {} }, { q: { type: "noul", instructions: "test" } }, { retries: 2 }),
      /Jev HTTP 401/
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});

test("Jev rejects incomplete successful responses", async () => {
  const previousKey = process.env.TYPESAFE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.TYPESAFE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ answers: {} }), { status: 200 });
  try {
    await assert.rejects(
      jev({}, { q: { type: "noul", instructions: "test" } }, { retries: 0 }),
      /missing answer: q/
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
  }
});

test("Kapture HTTP 200 with success:false is an action error", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: { code: "EXTENSION_OUTDATED", message: "Update extension" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new KaptureClient({ port: server.address().port });
  try {
    await assert.rejects(client.command("t1", "network_monitor", { enabled: true }), /Update extension/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("snapshot reads Kapture-generated selectors before DOM HTML", async () => {
  const steps = [];
  let html = "<body><button>Save</button></body>";
  const kapture = {
    async elements() {
      steps.push("elements");
      html = '<body><button id="kapture-1">Save</button></body>';
      return { elements: [{ visible: true, selector: "#kapture-1", tagName: "button" }] };
    },
    async dom() {
      steps.push("dom");
      return { html };
    },
    async tabDetail() {
      steps.push("tabDetail");
      return { url: "https://example.test/form", title: "Form" };
    },
  };
  const page = await semanticSnapshot(kapture, "t1");
  assert.deepEqual(steps, ["elements", "dom", "tabDetail"]);
  assert.equal(page.elements[0].label, "Save");
  assert.equal(page.elements[0].tag, "button");
});

test("evidence URL redacts secret query and fragment values", () => {
  const url = safeUrl("https://example.test/callback?token=abc&ok=1#access_token=123");
  assert.ok(!url.includes("abc"));
  assert.ok(!url.includes("123"));
  assert.ok(url.includes("ok=1"));
});
