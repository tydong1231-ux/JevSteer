import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { actionIdentity } from "./element-identity.mjs";

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

// Write intent BEFORE dispatch. A timeout or process exit cannot tell us
// whether the site already accepted a submission. No raw field data is stored.
export class ActionJournal {
  constructor({ dir = process.env.JEVSTEER_STATE_DIR || join(process.cwd(), ".jevsteer-state", "actions") } = {}) {
    this.dir = dir;
    this.memory = new Map();
  }

  path(tabId) { return join(this.dir, `${hash(tabId)}.json`); }

  async load(tabId) {
    if (!this.dir) return structuredClone(this.memory.get(tabId) || []);
    try {
      const records = JSON.parse(await readFile(this.path(tabId), "utf8"));
      if (!Array.isArray(records) || records.some((r) => !r.id || !r.fingerprint || !["pending", "resolved"].includes(r.state))) throw new Error("Invalid journal");
      return records;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error("ACTION_JOURNAL_UNAVAILABLE: cannot safely read pending actions");
    }
  }

  async save(tabId, records) {
    if (!this.dir) { this.memory.set(tabId, structuredClone(records)); return; }
    await mkdir(this.dir, { recursive: true });
    const target = this.path(tabId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(records)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  }

  async pending(tabId) { return (await this.load(tabId)).filter((r) => r.state === "pending"); }

  async begin(tabId, { runId, milestoneId, action, page }) {
    const records = await this.load(tabId);
    const record = {
      id: randomUUID(), state: "pending", run_id: runId, milestone_id: milestoneId,
      tool: action.tool, fingerprint: hash(actionIdentity(action, page.url)),
      // Values are hashes even for non-secret fields; no financial data or URLs.
      value_hash: hash(action.value ?? ""), created_at: new Date().toISOString(),
    };
    records.push(record);
    await this.save(tabId, records);
    return record;
  }

  matches(record, action, page) { return record.fingerprint === hash(actionIdentity(action, page.url)); }

  async resolve(tabId, id, resolution, basis) {
    if (!["applied", "not_applied"].includes(resolution) || !String(basis || "").trim()) throw new Error("ACTION_RESOLUTION_REQUIRES_OBSERVED_EVIDENCE");
    const records = await this.load(tabId);
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error("ACTION_NOT_FOUND");
    record.state = "resolved";
    record.resolution = resolution;
    // Only an evidence digest is durable; the host may mention private data.
    record.basis_hash = hash(basis);
    record.resolved_at = new Date().toISOString();
    const pending = records.filter((r) => r.state === "pending");
    const resolved = records.filter((r) => r.state === "resolved").slice(-100);
    await this.save(tabId, [...pending, ...resolved]);
    return { action_id: id, resolution };
  }

  async verified(tabId, runId, milestoneId) {
    for (const record of await this.pending(tabId)) {
      if (record.run_id === runId && record.milestone_id === milestoneId) await this.resolve(tabId, record.id, "applied", "independent task contract verification passed");
    }
  }
}
