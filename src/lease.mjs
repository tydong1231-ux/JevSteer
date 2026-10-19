import { mkdir, open, readFile, rm, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";

function safeName(value) {
  return Buffer.from(String(value)).toString("base64url");
}

// A lock file is created empty and filled immediately afterwards. Give a
// writer this long before an unreadable lock is treated as abandoned.
const UNREADABLE_GRACE_MS = 2000;

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
    let raw;
    let meta;
    try {
      [raw, meta] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    } catch {
      return { locked: false };
    }
    const ageMs = Date.now() - meta.mtimeMs;
    let data;
    try {
      data = JSON.parse(raw);
      if (!data || typeof data !== "object") throw new Error("invalid lease");
    } catch {
      // An empty or corrupt lock (for example after a crash mid-write) must
      // not block the tab forever.
      const stale = ageMs > UNREADABLE_GRACE_MS;
      return { locked: !stale, stale, corrupt: true, age_ms: Math.round(ageMs) };
    }
    const stale = ageMs > this.ttlMs || !pidAlive(data.pid);
    return { locked: !stale, stale, ...data, age_ms: Math.round(ageMs) };
  }

  async owns(path, runId) {
    try {
      return JSON.parse(await readFile(path, "utf8"))?.run_id === runId;
    } catch {
      return false;
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
        try {
          await handle.writeFile(JSON.stringify(lease));
        } catch (error) {
          await handle.close().catch(() => {});
          await rm(path, { force: true }).catch(() => {});
          throw error;
        }
        await handle.close();
        let stopped = false;
        // Refresh mtime only while the file is still ours: another process may
        // have taken over a lease it judged stale.
        const heartbeat = setInterval(async () => {
          if (stopped || !(await this.owns(path, lease.run_id))) return;
          const now = new Date();
          await utimes(path, now, now).catch(() => {});
        }, Math.max(5000, Math.floor(this.ttlMs / 3)));
        heartbeat.unref?.();
        return {
          ...lease,
          release: async () => {
            stopped = true;
            clearInterval(heartbeat);
            if (await this.owns(path, lease.run_id)) await rm(path, { force: true }).catch(() => {});
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
