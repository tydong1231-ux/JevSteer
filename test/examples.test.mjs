import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.mjs";

// Example contracts are hand-written JSON that hosts pass straight to
// browser_run, start_url included. Check them against the real tool schema.
test("example contracts pass browser_run's input schema; start_url is an absolute web address", async () => {
  const runs = [];
  const runtime = { run: async (goal, options) => { runs.push({ goal, options }); return { status: "recorded" }; }, close: async () => {} };
  const server = createServer({ runtime });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "examples-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const dir = new URL("../examples/", import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    assert.ok(files.length >= 5, `found ${files.length} example contracts`);
    for (const file of files) {
      const contract = JSON.parse(await readFile(new URL(file, dir), "utf8"));
      if ("start_url" in contract) assert.match(new URL(contract.start_url).protocol, /^https?:$/, file);
      const response = await client.callTool({ name: "browser_run", arguments: contract });
      assert.ok(!response.isError, `${file}: ${response.content?.[0]?.text}`);
      const run = runs.at(-1);
      assert.equal(run.goal, contract.goal, file);
      assert.equal(run.options.milestones.length, contract.milestones?.length ?? 0, file);
      assert.deepEqual(run.options.values, contract.values || {}, file);
    }
    assert.equal(runs.length, files.length);
  } finally {
    await client.close();
    await server.close();
  }
});
