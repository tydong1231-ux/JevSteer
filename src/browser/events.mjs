import { safeUrl } from '../evidence.mjs';

export class PageEvents {
  constructor(page, { retainBodies = false, limit = 1000 } = {}) {
    this.page = page;
    this.limit = limit;
    this.retainBodies = retainBodies;
    this.cursor = 0;
    this.entries = [];
    this.responses = new Map();
    this.listeners = [];
    this.pendingDialog = null;
    const on = (name, fn) => { page.on(name, fn); this.listeners.push([name, fn]); };
    on('response', (response) => {
      const req = response.request();
      const entry = this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(response.url()), status: response.status(), type: req.resourceType() });
      if (retainBodies) this.responses.set(entry.requestId, response);
    });
    on('requestfailed', (req) => this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(req.url()), type: req.resourceType(), failed: true }));
    // Console text and dialog messages can contain financial data or secrets.
    // Keep only event type; screenshots remain explicitly requested by the host.
    on('console', (message) => this.push({ kind: 'console', type: message.type() }));
    on('pageerror', () => this.push({ kind: 'pageerror' }));
    on('dialog', (dialog) => { this.pendingDialog = dialog; this.push({ kind: 'dialog', type: dialog.type() }); });
    on('download', () => this.push({ kind: 'download' }));
    on('close', () => this.close());
  }
  push(entry) {
    const value = { ...entry, cursor: ++this.cursor, timestamp: Date.now() };
    this.entries.push(value);
    while (this.entries.length > this.limit) this.responses.delete(this.entries.shift().requestId);
    return value;
  }
  read(since = 0) {
    const entries = this.entries.filter((e) => e.cursor > since);
    return { cursor: this.cursor, requests: entries.filter((e) => e.kind === 'network'), events: entries.filter((e) => e.kind !== 'network'), truncated: since > 0 && since < (this.entries[0]?.cursor || 0) - 1 };
  }
  async body(requestId, maxBytes = 16384) {
    const response = this.responses.get(String(requestId));
    if (!response) return { bodyError: 'body_capture_disabled_or_expired' };
    const headers = await response.allHeaders();
    const length = Number(headers['content-length']);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes || !/json|text\//i.test(headers['content-type'] || '')) return { bodyError: 'body_size_or_content_type' };
    const body = await response.body();
    if (body.length > maxBytes) return { bodyError: 'body_size' };
    return { body: body.toString('utf8') };
  }
  close() {
    for (const [name, listener] of this.listeners) this.page.off(name, listener);
    this.listeners = [];
    this.entries = [];
    this.responses.clear();
  }
}
