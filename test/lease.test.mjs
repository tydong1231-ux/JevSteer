import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TabLeaseManager } from "../src/lease.mjs";

test("tab lease prevents simultaneous control", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jevsteer-test-"));
  try {
    const manager = new TabLeaseManager({ dir, ttlMs: 60000 });
    const lease = await manager.acquire("tab-1", { runId: "a" });
    await assert.rejects(() => manager.acquire("tab-1", { runId: "b" }), /TAB_BUSY/);
    await lease.release();
    const second = await manager.acquire("tab-1", { runId: "c" });
    await second.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});