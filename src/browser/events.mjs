import { safeUrl } from '../evidence.mjs';
import { trackerRequest } from '../trackers.mjs';

// A slow report or save is waited on until it returns. A request still open
// after STREAM_MS is a stream or will not return, and is no longer waited on.
const STREAM_MS = 30000;
// A long poll holds its request open until the server has news, and the page
// sends the next one as soon as it returns, with no input in between.
const HELD_MS = 8000;
const RESENT_MS = 1000;

export class PageEvents {
  constructor(page, { retainBodies = false, limit = 1000, now = Date.now } = {}) {
    this.page = page;
    this.limit = limit;
    this.retainBodies = retainBodies;
    this.now = now;
    this.cursor = 0;
    this.entries = [];
    this.responses = new Map();
    this.listeners = [];
    this.pendingDialog = null;
    // Start times of the page's own data requests: open ones, and recent ones.
    // Analytics and ad beacons are not the page's data: a form interaction
    // fires them whether or not anything is saved. Long polls are not either.
    this.open = new Map();
    this.started = [];
    // Times of anything else the page sent that can carry a change: a beacon
    // or form post (any method but GET, HEAD and OPTIONS), and WebSocket
    // messages. Analytics beacons are left out here too.
    this.sent = [];
    this.inputAt = -Infinity;
    this.heldUntil = new Map();
    this.longPolls = new Set();
    const on = (name, fn) => { page.on(name, fn); this.listeners.push([name, fn]); };
    on('request', (req) => {
      if (trackerRequest(req.url())) return;
      if (!DATA_REQUESTS.has(req.resourceType())) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) this.note();
        return;
      }
      const at = this.now();
      const key = endpoint(req);
      if (at - (this.heldUntil.get(key) ?? -Infinity) <= RESENT_MS && at - this.inputAt > RESENT_MS) this.longPolls.add(key);
      if (this.longPolls.has(key)) return;
      this.open.set(req, at);
      this.started.push(at);
      if (this.started.length > 500) this.started.splice(0, this.started.length - 500);
    });
    const finished = (req) => {
      const at = this.open.get(req);
      if (at == null) return;
      this.open.delete(req);
      const now = this.now();
      if (now - at >= HELD_MS) this.heldUntil.set(endpoint(req), now);
    };
    on('requestfinished', finished);
    on('response', (response) => {
      const req = response.request();
      const entry = this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(response.url()), status: response.status(), type: req.resourceType() });
      if (retainBodies) this.responses.set(entry.requestId, response);
    });
    on('requestfailed', (req) => {
      finished(req);
      this.push({ kind: 'network', requestId: String(this.cursor + 1), method: req.method(), url: safeUrl(req.url()), type: req.resourceType(), failed: true });
    });
    // Console text and dialog messages can contain financial data or secrets.
    // Keep only event type; screenshots remain explicitly requested by the host.
    on('console', (message) => this.push({ kind: 'console', type: message.type() }));
    on('pageerror', () => this.push({ kind: 'pageerror' }));
    on('dialog', (dialog) => { this.pendingDialog = dialog; this.push({ kind: 'dialog', type: dialog.type() }); });
    on('download', () => this.push({ kind: 'download' }));
    on('websocket', (socket) => socket.on('framesent', () => this.note()));
    on('close', () => this.close());
  }
  push(entry) {
    const value = { ...entry, cursor: ++this.cursor, timestamp: Date.now() };
    this.entries.push(value);
    while (this.entries.length > this.limit) this.responses.delete(this.entries.shift().requestId);
    return value;
  }
  // The driver's input. A request sent within RESENT_MS of it belongs to the
  // input, even when it repeats a long-held one.
  input(at = this.now()) { this.inputAt = at; }
  // XHR and fetch requests started at or after `since`, and how many of them
  // are still open. A long poll's requests count in neither.
  requests(since = 0, { now = this.now(), maxAgeMs = STREAM_MS } = {}) {
    let pending = 0;
    for (const [req, at] of this.open) {
      if (at >= since && now - at < maxAgeMs && !this.longPolls.has(endpoint(req))) pending++;
    }
    return { started: this.started.filter((at) => at >= since).length, pending };
  }
  note(at = this.now()) {
    if (!this.listeners.length) return;
    this.sent.push(at);
    if (this.sent.length > 500) this.sent.splice(0, this.sent.length - 500);
  }
  // Beacons, form posts and WebSocket messages sent at or after `since`.
  sentSince(since = 0) { return this.sent.filter((at) => at >= since).length; }
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
    this.sent = [];
    this.inputAt = -Infinity;
    this.heldUntil.clear();
    this.longPolls.clear();
  }
}

const DATA_REQUESTS = new Set(['xhr', 'fetch']);

function endpoint(req) {
  try {
    const url = new URL(req.url());
    return `${req.method()} ${url.origin}${url.pathname}`;
  } catch { return `${req.method()} ${req.url()}`; }
}
