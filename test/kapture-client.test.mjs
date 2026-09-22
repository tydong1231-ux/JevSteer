import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { KaptureClient } from "../src/kapture-client.mjs";

test("KaptureClient talks to Kapture-compatible localhost HTTP", async () => {
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/tabs") {
      res.end(JSON.stringify({ tabs: [{ tabId: "t1", title: "Demo", url: "https://example.test" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/tab/t1/click") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      assert.equal(parsed.selector, "#save");
      res.end(JSON.stringify({ clicked: true }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const client = new KaptureClient({ port });
  try {
    const tabs = await client.listTabs();
    assert.equal(tabs[0].tabId, "t1");
    const result = await client.command("t1", "click", { selector: "#save" });
    assert.equal(result.clicked, true);
  } finally {
    server.close();
    await once(server, "close");
  }
});