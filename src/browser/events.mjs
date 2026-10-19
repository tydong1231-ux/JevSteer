import { safeUrl } from '../evidence.mjs';
import { trackerRequest } from '../trackers.mjs';

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
    // Start times of the page's own data requests: open ones, and recent ones.
    // Endpoints seen holding a request open for a long time (long polling)
    // are not waited on again. Analytics and ad beacons are not the page's
    // data: a form interaction fires them whether or not anything is saved.
    this.open = new Map();
    this.started = [];
    this.longLived = new Set();
    const on = (name, fn) => { page.on(name, fn); this.listeners.push([name, fn]); };
    on('request', (req) => {
      if (!DATA_REQUESTS.has(req.resourceType()) || trackerRequest(req.url())) return;
      const at = Date.now();
      this.open.set(req, at);
      this.started.push(at);
      if (this.started.length > 500) this.started.splice(0, this.started.length - 500);
    });
    on('requestfinished', (req) => this.open.delete(req));
    on('response', (response) => {
      const req = response.request();
      const entry = this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(response.url()), status: response.status(), type: req.resourceType() });
      if (retainBodies) this.responses.set(entry.requestId, response);
    });
    on('requestfailed', (req) => {
      this.open.delete(req);
      this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(req.url()), type: req.resourceType(), failed: true });
    });
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
  // XHR and fetch requests started at or after `since`, and how many of them
  // are still open. One open for maxAgeMs or longer is a long poll or a
  // stream: it no longer counts, nor do later requests to its endpoint.
  requests(since = 0, { now = Date.now(), maxAgeMs = 8000 } = {}) {
    let pending = 0;
    for (const [req, at] of this.open) {
      if (now - at >= maxAgeMs) {
        this.longLived.add(endpoint(req));
        this.open.delete(req);
      } else if (at >= since && !this.longLived.has(endpoint(req))) pending++;
    }
    return { started: this.started.filter((at) => at >= since).length, pending };
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
    this.open.clear();
    this.started = [];
    this.longLived.clear();
  }
}

const DATA_REQUESTS = new Set(['xhr', 'fetch']);

function endpoint(req) {
  try {
    const url = new URL(req.url());
    return `${req.method()} ${url.origin}${url.pathname}`;
  } catch { return `${req.method()} ${req.url()}`; }
}
