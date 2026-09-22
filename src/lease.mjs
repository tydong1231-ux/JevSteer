import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";

function safeName(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class TabLeaseManager {
  constructor({ dir = join(homedir(), ".jevsteer", "leases"), ttlMs = config.leaseTtlMs } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
  }

  path(tabId) {
    return join(this.dir, `${safeName(tabId)}.lock`);
  }

  async inspect(tabId) {
    const path = this.path(tabId);
    try {
      const [raw, meta] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      const data = JSON.parse(raw);
      const stale = Date.now() - meta.mtimeMs > this.ttlMs || !pidAlive(data.pid);
      return { locked: !stale, stale, ...data, age_ms: Math.round(Date.now() - meta.mtimeMs) };
    } catch {
      return { locked: false };
    }
  }

  async acquire(tabId, owner = {}) {
    await mkdir(this.dir, { recursive: true });
    const path = this.path(tabId);
    const lease = {
      pid: process.pid,
      run_id: owner.runId || randomUUID(),
      client: owner.client || "mcp",
      acquired_at: new Date().toISOString(),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(JSON.stringify(lease));
        await handle.close();
        let stopped = false;
        const heartbeat = setInterval(() => {
          if (!stopped) writeFile(path, JSON.stringify(lease), { flag: "r+" }).catch(() => {});
        }, Math.max(5000, Math.floor(this.ttlMs / 3)));
        heartbeat.unref?.();
        return {
          ...lease,
          release: async () => {
            stopped = true;
            clearInterval(heartbeat);
            await rm(path, { force: true }).catch(() => {});
          },
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const info = await this.inspect(tabId);
        if (info.stale) {
          await rm(path, { force: true }).catch(() => {});
          continue;
        }
        throw new Error(`TAB_BUSY: tab ${tabId} is already controlled by pid=${info.pid ?? "?"}, run=${info.run_id ?? "?"}`);
      }
    }
    throw new Error(`TAB_BUSY: could not acquire tab ${tabId}`);
  }

  async withLease(tabId, owner, fn) {
    const lease = await this.acquire(tabId, owner);
    try {
      return await fn(lease);
    } finally {
      await lease.release();
    }
  }
}
