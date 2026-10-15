import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join } from "node:path";

export function reviewDigest(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function reviewReceipt(record) {
  return { review_id: record.id, run_id: record.run_id, milestone_id: record.milestone_id,
    milestone_index: record.milestone_index, next_milestone_index: record.next_index,
    state: record.state, created_at: record.created_at,
    ...(record.decided_at ? { decided_at: record.decided_at } : {}),
  };
}

// Store only digests and protocol metadata, never page text, credentials,
// financial values or the host's potentially private evidence descriptions.
export class HostReviewStore {
  constructor({ dir = join(process.env.JEVSTEER_STATE_DIR || join(process.cwd(), ".jevsteer-state"), "reviews") } = {}) {
    this.dir = dir;
    this.memory = new Map();
  }
  path(tabId) { return join(this.dir, `${reviewDigest(tabId)}.json`); }
  async load(tabId) {
    if (!this.dir) return structuredClone(this.memory.get(tabId) || []);
    try {
      const rows = JSON.parse(await readFile(this.path(tabId), "utf8"));
      if (!Array.isArray(rows) || rows.some(r => !r.id || !r.state_digest || !r.contract_digest || !["pending", "accepted", "rejected"].includes(r.state))) throw new Error("Invalid review store");
      return rows;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error("HOST_REVIEW_STORE_UNAVAILABLE: cannot safely read review receipts");
    }
  }
  async save(tabId, rows) {
    if (!this.dir) { this.memory.set(tabId, structuredClone(rows)); return; }
    await mkdir(this.dir, { recursive: true });
    const target = this.path(tabId), temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(rows)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  }
  async pending(tabId) { return (await this.load(tabId)).find(r => r.state === "pending"); }
  async accepted(tabId, runId, milestoneId, contractDigest) {
    return (await this.load(tabId)).find(r => r.state === "accepted" && r.run_id === runId && r.milestone_id === milestoneId && r.contract_digest === contractDigest);
  }
  async issue(tabId, details) {
    const rows = await this.load(tabId);
    if (rows.some(r => r.state === "pending")) throw new Error("HOST_REVIEW_PENDING");
    const record = { ...details, id: randomUUID(), state: "pending", created_at: new Date().toISOString() };
    rows.push(record);
    await this.save(tabId, rows);
    return record;
  }
  async finish(tabId, id, decision, evidence) {
    const rows = await this.load(tabId);
    const record = rows.find(r => r.id === id);
    if (!record || record.state !== "pending") throw new Error("HOST_REVIEW_NOT_PENDING");
    if (!["accepted", "rejected"].includes(decision)) throw new Error("INVALID_HOST_REVIEW_DECISION");
    record.state = decision;
    record.evidence_digest = reviewDigest(evidence);
    record.decided_at = new Date().toISOString();
    await this.save(tabId, rows);
    return record;
  }
}
