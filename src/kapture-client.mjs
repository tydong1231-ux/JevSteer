import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { config } from "./config.mjs";
import { log } from "./log.mjs";

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export class KaptureClient {
  constructor({ port = config.kapturePort } = {}) {
    this.port = port;
    this.base = `http://127.0.0.1:${port}`;
    this.child = null;
    this.startedByUs = false;
  }

  async request(path, { method = "GET", body, timeout = 15000 } = {}) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const message = data?.error?.message || data?.error || data?.raw || `HTTP ${response.status}`;
      throw new Error(`Kapture ${method} ${path}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
    }
    return data;
  }

  async probe() {
    try {
      const data = await this.request("/tabs", { timeout: 900 });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async ensureServer() {
    const existing = await this.probe();
    if (existing.ok) return { mode: "reused", port: this.port };

    if (this.child) return { mode: "spawned", port: this.port };

    const packageJson = require.resolve("kapture-mcp/package.json");
    const entry = join(dirname(packageJson), "dist", "index.js");
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, KAPTURE_PORT: String(this.port) },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.startedByUs = true;
    if (process.env.JEVSTEER_LOG === "1") {
      child.stderr.on("data", (chunk) => process.stderr.write(`[kapture] ${chunk}`));
    }
    child.on("exit", (code, signal) => {
      log(`Kapture child exited code=${code} signal=${signal}`);
      this.child = null;
    });

    for (let i = 0; i < 50; i++) {
      await sleep(100);
      const status = await this.probe();
      if (status.ok) return { mode: "spawned", port: this.port };
      if (child.exitCode != null) break;
    }

    throw new Error(`Could not start Kapture on port ${this.port}. Start 'npx kapture-mcp' manually and retry.`);
  }

  async close() {
    if (this.startedByUs && this.child && this.child.exitCode == null) {
      this.child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => this.child.once("exit", resolve)),
        sleep(1500),
      ]).catch(() => {});
      if (this.child?.exitCode == null) this.child.kill("SIGKILL");
    }
    this.child = null;
  }

  async listTabs() {
    await this.ensureServer();
    const data = await this.request("/tabs");
    return Array.isArray(data) ? data : (data.tabs || []);
  }

  async tabDetail(tabId) {
    return this.request(`/tab/${encodeURIComponent(tabId)}`);
  }

  async newTab() {
    return this.request("/tabs", { method: "POST", body: {}, timeout: 20000 });
  }

  async closeTab(tabId) {
    return this.request(`/tab/${encodeURIComponent(tabId)}`, { method: "DELETE" });
  }

  async command(tabId, command, body = {}, timeout = 20000) {
    return this.request(`/tab/${encodeURIComponent(tabId)}/${command}`, { method: "POST", body, timeout });
  }

  async navigate(tabId, url) {
    return this.command(tabId, "navigate", { url, timeout: 30000 }, 35000);
  }

  async elements(tabId, selector, { visible } = {}) {
    return this.request(`/tab/${encodeURIComponent(tabId)}/elements${encodeQuery({ selector, visible })}`, { timeout: 15000 });
  }

  async dom(tabId) {
    return this.request(`/tab/${encodeURIComponent(tabId)}/dom`, { timeout: 15000 });
  }

  async screenshot(tabId, { scale = 1, format = "png", quality } = {}) {
    return this.request(`/tab/${encodeURIComponent(tabId)}/screenshot${encodeQuery({ scale, format, quality })}`, { timeout: 20000 });
  }
}
