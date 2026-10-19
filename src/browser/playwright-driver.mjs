import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { sameIdentity } from '../element-identity.mjs';
import { FIELDISH, SELECTISH } from '../page-model.mjs';
import { observeUntilReady } from '../observation.mjs';
import { captureSnapshot, readDOM } from './snapshot.mjs';
import { PageEvents } from './events.mjs';
import { sessionIdentity, physicalPageId } from './sessions.mjs';
import { dispatchInput } from './driver.mjs';
import { inspectBusinessDOM } from './inspect.mjs';
import { SENSITIVE_PATTERNS } from '../sensitive.mjs';

// A frozen or discarded background tab in an attached Chrome never settles
// page.title(). Tab listing must not wait on it, or browser_doctor and
// browser_tabs hang for as long as that tab sleeps.
const LIST_TITLE_WAIT_MS = 1000;
function boundedTitle(page) {
  let timer;
  const fallback = new Promise((done) => { timer = setTimeout(() => done(''), LIST_TITLE_WAIT_MS); });
  return Promise.race([page.title().catch(() => ''), fallback]).finally(() => clearTimeout(timer));
}

export class PlaywrightDriver {
  constructor(options = {}) {
    this.kind = 'playwright';
    this.options = { headless: config.browserHeadless, userDataDir: config.browserProfile, cdpEndpoint: config.browserCdpEndpoint, channel: config.browserChannel, inputMode: config.browserInputMode, timeoutMs: config.browserTimeoutMs, ...options };
    if (options.context) this.options.userDataDir = options.userDataDir;
    if (this.options.cdpEndpoint && options.userDataDir) throw new Error('BROWSER_CONFIG: choose profile or CDP, not both');
    if (options.context && this.options.cdpEndpoint) throw new Error('BROWSER_CONFIG: choose borrowed context or CDP, not both');
    if (!['fast', 'realistic'].includes(this.options.inputMode) || !Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs <= 0) throw new Error('BROWSER_CONFIG: invalid input mode or timeout');
    this.sessionId = sessionIdentity(this.options);
    this.context = options.context;
    this.owned = !options.context;
    this.records = new Map();
    this.pageRecords = new WeakMap();
    this.frames = new WeakMap();
    this.frameSequence = 0;
    this.starting = null;
  }

  async ready() {
    if (this.closed) throw new Error('BROWSER_CLOSED');
    if (!this.starting) this.starting = this.start().catch((error) => { this.starting = null; throw error; });
    await this.starting;
    return { mode: this.options.cdpEndpoint ? 'cdp' : this.owned ? 'managed' : 'borrowed', driver: this.kind, session_id: this.sessionId };
  }

  async start() {
    if (!this.context) {
      const { chromium } = await import('playwright-core');
      if (this.options.cdpEndpoint) {
        this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint, { timeout: this.options.timeoutMs });
        const contexts = this.browser.contexts();
        if (contexts.length !== 1) {
          await this.browser.close();
          throw new Error('CDP_UNSUPPORTED: exactly one existing browser context is required; no fallback browser was launched');
        }
        this.context = contexts[0];
      } else {
        this.context = await chromium.launchPersistentContext(resolve(this.options.userDataDir), {
          headless: this.options.headless, channel: this.options.channel || undefined, executablePath: this.options.executablePath,
          acceptDownloads: false, ...this.options.launchOptions,
        });
      }
    }
    this.onPage = (page) => { this.register(page).catch(() => {}); };
    this.context.on('page', this.onPage);
    await Promise.all(this.context.pages().map((p) => this.register(p)));
  }

  frameInfo(frame) {
    if (!this.frames.has(frame)) this.frames.set(frame, { id: `f${++this.frameSequence}`, revision: 0, frame });
    return this.frames.get(frame);
  }

  async register(page) {
    if (this.pageRecords.has(page)) return this.pageRecords.get(page);
    const pending = (async () => {
      const targetId = await physicalPageId(this.context, page);
      // Physical target IDs are independent of the connection/profile alias.
      // The same Page attached through two CDP URLs must share one lease and
      // journal, even if the logical session namespaces differ.
      const pageId = `pw:${targetId}`;
      const record = { page, pageId, refs: new Map(), events: null };
      record.onNavigate = (frame) => { this.frameInfo(frame).revision++; };
      page.on('framenavigated', record.onNavigate);
      record.onClose = () => { record.refs.clear(); this.records.delete(pageId); };
      page.once('close', record.onClose);
      this.records.set(pageId, record);
      return record;
    })();
    this.pageRecords.set(page, pending);
    return pending;
  }

  async record(ref) {
    await this.ready();
    const id = typeof ref === 'string' ? ref : ref?.pageId;
    const record = this.records.get(id);
    if (!record || record.page.isClosed()) throw new Error(`TAB_NOT_FOUND: ${id}`);
    // Discovering other tabs must not collect their network/console data.
    // Event capture starts only on a page explicitly used by the runtime.
    record.events ||= new PageEvents(record.page, { retainBodies: this.options.retainNetworkBodies });
    return record;
  }

  async pageRef(record) {
    return { pageId: record.pageId, tabId: record.pageId, sessionId: this.sessionId, url: record.page.url(), title: await boundedTitle(record.page), browser: 'chromium' };
  }
  async pages() {
    await this.ready();
    const records = await Promise.all(this.context.pages().map((p) => this.register(p)));
    return Promise.all(records.filter((r) => !r.page.isClosed()).map((r) => this.pageRef(r)));
  }
  async createPage() { await this.ready(); return this.pageRef(await this.register(await this.context.newPage())); }
  async open(url, { pageRef } = {}) {
    const protocol = new URL(url).protocol;
    if (!['http:', 'https:', 'about:'].includes(protocol) || protocol === 'about:' && url !== 'about:blank') throw new Error('UNSUPPORTED_URL: only HTTP(S) or about:blank navigation');
    const ref = pageRef || (await this.createPage()).pageId;
    const record = await this.record(ref);
    await record.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs });
    return this.pageRef(record);
  }
  async detail(ref) { return this.pageRef(await this.record(ref)); }
  metadata(ref) { return this.detail(ref); }
  async observe(ref, scope) {
    const record = await this.record(ref);
    if (record.events.pendingDialog) throw new Error('DIALOG_OPEN: browser dialog requires host handling');
    const result = await captureSnapshot(record.page, { pageId: record.pageId, sessionId: this.sessionId, frameInfo: (f) => this.frameInfo(f), scope });
    record.refs = result.refs;
    return result.observation;
  }
  waitFor(ref, condition, budget = {}) { return observeUntilReady(() => this.observe(ref), { ...budget, ready: condition }); }

  async assertTargetFresh(ref, action) {
    const original = action.el;
    const record = await this.record(ref);
    if (!original?.snapshot_id || original.page_id !== record.pageId || original.session_id !== this.sessionId) throw new Error('STALE_TARGET: wrong page/session or no observation-bound target');
    const fresh = await this.observe(ref);
    if (action.observedUrl && fresh.url !== action.observedUrl) throw new Error('STALE_TARGET: page navigated after decision');
    const matches = fresh.elements.filter((e) => e.frame_id === original.frame_id && e.document_id === original.document_id && sameIdentity(original, e, fresh.url));
    if (matches.length !== 1 || matches[0].disabled || action.tool === 'type' && matches[0].readonly) throw new Error('STALE_TARGET: ambiguous, disabled or changed document/record/form');
    if (['type', 'select'].includes(action.tool) && String(original.value ?? '') !== String(matches[0].value ?? '')) throw new Error('STALE_TARGET: live field value changed');
    action.el = matches[0];
  }

  async perform(ref, action, targetRef, { beforeDispatch } = {}) {
    const record = await this.record(ref);
    const timeout = this.options.timeoutMs;
    const inputMode = action.inputMode || this.options.inputMode;
    return dispatchInput(async () => {
      if (record.events.pendingDialog) throw new Error('DIALOG_OPEN: browser dialog requires host handling');
      if (!['click', 'type', 'press_enter', 'press_key', 'select', 'hover', 'scroll', 'back', 'wait', 'none'].includes(action.tool)) throw new Error('UNSUPPORTED_ACTION');
      if (action.target == null) {
        if (['click', 'type', 'select', 'hover'].includes(action.tool)) throw new Error('STALE_TARGET: target required');
        return null;
      }
      const target = targetRef || action.el;
      const entry = record.refs.get(target?.selector);
      if (!entry || target.page_id !== record.pageId) throw new Error('STALE_TARGET: observation ref expired');
      // Pin only for this dispatch. A Locator indexed into a virtual row could
      // otherwise retry against a different record after the journal fsync.
      // A detached pinned target fails; it is never retried as another node.
      const handle = await entry.locator.elementHandle({ timeout });
      if (!handle) throw new Error('STALE_TARGET: target detached');
      try {
        const state = await handle.evaluate(readDOM);
        const current = state.elements[0];
        const doc = `${this.frameInfo(entry.frame).id}:${this.frameInfo(entry.frame).revision}:${state.documentKey}`;
        if (!current || doc !== target.document_id || !sameIdentity(target, current, state.url) || current.disabled) throw new Error('STALE_TARGET: live target identity changed');
        if (['type', 'select'].includes(action.tool) && !sensitiveFieldValueEqual(target, current)) throw new Error('STALE_TARGET: live field value changed');
        if (action.tool === 'type' && (!FIELDISH(current) || action.value == null)) throw new Error('INVALID_INPUT: value required and field must be editable');
        if (action.tool === 'select' && !SELECTISH(current)) throw new Error('INVALID_INPUT: select requires a combobox');
        if (action.tool === 'select' && current.tag === 'select') {
          const options = current.options.filter((o) => o.value === String(action.value));
          if (action.value == null || options.length !== 1 || options[0].disabled) throw new Error('INVALID_INPUT: native option must be unique and enabled');
        }
        if (['click', 'hover'].includes(action.tool)) await handle[action.tool]({ trial: true, timeout });
        return handle;
      } catch (error) { await handle.dispose(); throw error; }
    }, beforeDispatch, async (handle, mark) => {
      // fsync can take time. Recheck the pinned node after the durable hook,
      // still before input; detachment/record recycling is a proven rejection.
      if (handle) {
        const state = await handle.evaluate(readDOM);
        const current = state.elements[0];
        const entry = record.refs.get(action.el.selector);
        const doc = entry && `${this.frameInfo(entry.frame).id}:${this.frameInfo(entry.frame).revision}:${state.documentKey}`;
        if (!current || !sameIdentity(action.el, current, state.url) || current.disabled
            || doc !== action.el.document_id
            || ['type', 'select'].includes(action.tool) && !sensitiveFieldValueEqual(action.el, current)) throw new Error('STALE_TARGET: target changed while persisting intent');
      }
      switch (action.tool) {
        case 'click': mark(); await handle.click({ timeout }); break;
        case 'hover': mark(); await handle.hover({ timeout }); break;
        case 'type': {
          const value = String(action.value);
          mark();
          if (inputMode === 'realistic') {
            await handle.click({ timeout });
            await handle.press('ControlOrMeta+A', { timeout });
            await handle.press('Backspace', { timeout });
            await handle.type(value, { timeout });
          } else await handle.fill(value, { timeout });
          return { input_mode: inputMode };
        }
        case 'select':
          mark();
          if (action.el.tag === 'select') await handle.selectOption({ value: String(action.value) }, { timeout });
          else await handle.click({ timeout });
          return { input_mode: action.el.tag === 'select' ? 'native_select' : 'pointer' };
        case 'press_enter':
        case 'press_key': {
          const key = action.tool === 'press_enter' ? 'Enter' : action.key || 'Escape';
          mark();
          if (handle) await handle.press(key, { timeout }); else await record.page.keyboard.press(key);
          break;
        }
        case 'scroll': mark(); await record.page.mouse.wheel(0, 600); break;
        case 'back': mark(); await record.page.goBack({ waitUntil: 'domcontentloaded', timeout }); break;
        case 'wait': await new Promise((r) => setTimeout(r, 150)); break;
        case 'none': break;
      }
      return { input_mode: ['click', 'hover'].includes(action.tool) ? 'pointer' : 'keyboard' };
    });
  }
  async screenshot(ref, { format = 'png' } = {}) {
    const record = await this.record(ref);
    const data = await record.page.screenshot({ type: format, timeout: this.options.timeoutMs });
    return { data: data.toString('base64'), mimeType: `image/${format}` };
  }
  async inspect(ref) {
    const record = await this.record(ref);
    if (record.events.pendingDialog) throw new Error('DIALOG_OPEN: browser dialog requires host handling');
    return { page_id: record.pageId, session_id: this.sessionId, ...(await record.page.evaluate(inspectBusinessDOM, SENSITIVE_PATTERNS)) };
  }
  async startEvents(ref) { await this.record(ref); return { monitoring: true }; }
  async stopEvents() {}
  async events(ref, cursor = 0) { return (await this.record(ref)).events.read(cursor); }
  async eventBody(ref, requestId, maxBytes) { return (await this.record(ref)).events.body(requestId, maxBytes); }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.context?.off('page', this.onPage);
    for (const record of this.records.values()) {
      record.events?.close();
      record.page.off('framenavigated', record.onNavigate);
      record.page.off('close', record.onClose);
      record.refs.clear();
    }
    this.records.clear();
    if (this.owned) {
      if (this.browser) await this.browser.close(); // disconnects CDP; does not close the existing browser
      else await this.context?.close();
    }
  }
}

function sensitiveFieldValueEqual(target, current) {
  return target.value_hash ? target.value_hash === createHash('sha256').update(String(current.value ?? '')).digest('hex') : String(target.value ?? '') === String(current.value ?? '');
}
