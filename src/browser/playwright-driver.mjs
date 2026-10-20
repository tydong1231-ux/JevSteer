import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { sameIdentity, equivalentLink, pickTwin } from '../element-identity.mjs';
import { FIELDISH, SELECTISH } from '../page-model.mjs';
import { isDateText } from '../date-text.mjs';
import { observeUntilReady, observationSignature } from '../observation.mjs';
import { captureSnapshot, readDOM, FIELD, INTERACTIVE } from './snapshot.mjs';
import { PageEvents } from './events.mjs';
import { sessionIdentity, physicalPageId } from './sessions.mjs';
import { dispatchInput } from './driver.mjs';
import { inspectBusinessDOM } from './inspect.mjs';
import { SENSITIVE_PATTERNS } from '../sensitive.mjs';

export class PlaywrightDriver {
  constructor(options = {}) {
    this.kind = 'playwright';
    this.options = { headless: config.browserHeadless, userDataDir: config.browserProfile, cdpEndpoint: config.browserCdpEndpoint, channel: config.browserChannel, inputMode: config.browserInputMode, timeoutMs: config.browserTimeoutMs, maxElements: config.observationMaxElements, ...options };
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
    return { pageId: record.pageId, tabId: record.pageId, sessionId: this.sessionId, url: record.page.url(), title: await record.page.title().catch(() => ''), browser: 'chromium' };
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
    const result = await captureSnapshot(record.page, { pageId: record.pageId, sessionId: this.sessionId, frameInfo: (f) => this.frameInfo(f), scope, maxElements: this.options.maxElements });
    record.refs = result.refs;
    // A report or record the last input asked for shows nothing until its
    // response arrives, often with no spinner. Observation waits while such
    // a request is open (see observeUntilReady).
    const requests = record.events.requests(record.inputAt ?? 0);
    if (requests.pending) result.observation.pending_requests = requests.pending;
    if (record.inputAt != null) result.observation.requests_since_input = requests.started;
    return result.observation;
  }
  waitFor(ref, condition, budget = {}) { return observeUntilReady(() => this.observe(ref), { ...budget, ready: condition }); }

  async assertTargetFresh(ref, action) {
    const original = action.el;
    const record = await this.record(ref);
    if (!original?.snapshot_id || original.page_id !== record.pageId || original.session_id !== this.sessionId) throw new Error('STALE_TARGET: wrong page/session or no observation-bound target');
    const fresh = await this.observe(ref);
    // The page this check read: a refusal is about it (see the runtime).
    action.checkedOn = observationSignature(fresh);
    if (action.observedUrl && fresh.url !== action.observedUrl) throw new Error('STALE_TARGET: page navigated after decision');
    const matches = fresh.elements.filter((e) => e.frame_id === original.frame_id && e.document_id === original.document_id && sameIdentity(original, e, fresh.url));
    if (!matches.length) throw new Error('STALE_TARGET: changed document/record/form');
    // Of identical controls, the one that still shows what the chosen one
    // showed (see twinsOf), even when only one is left: it may be the other.
    // Their order never picks one.
    const twins = action.observed?.twins;
    const link = () => action.tool === 'click' && equivalentLink(original, matches, fresh.url);
    const pick = twins ? link() || pickTwin(twins, matches) : matches.length === 1 ? matches[0] : link();
    // One told apart by its table line: the page rebuilt that node, or moved it to another line.
    if (!pick && twins?.node != null) throw new Error(`STALE_TARGET: the control chosen on line ${twins.row} of its table is gone or on another line now, and identical controls are never told apart by their order`);
    if (!pick && matches.length === 1) throw new Error('STALE_TARGET: one of identical controls is left, and nothing shows it is the one chosen');
    if (!pick) throw new Error(`STALE_TARGET: ambiguous: ${matches.length} identical controls`);
    if (pick.disabled || action.tool === 'type' && pick.readonly) throw new Error('STALE_TARGET: disabled or read-only');
    if (['type', 'select'].includes(action.tool) && String(original.value ?? '') !== String(pick.value ?? '')) throw new Error('STALE_TARGET: live field value changed');
    if (action.listed_in) assertStillListed(action, pick, fresh);
    action.el = pick;
  }

  async perform(ref, action, targetRef, { beforeDispatch } = {}) {
    const record = await this.record(ref);
    const timeout = this.options.timeoutMs;
    const inputMode = action.inputMode || this.options.inputMode;
    // An option chosen from an open list: its combobox, pinned with it.
    let owner;
    // What a click on a field lands on when that is a part of the field's
    // own box drawn over it, pinned too (see ownPart); null when the field
    // itself takes the click.
    let part;
    // The box a SCROLL on a target turns, and where and how far (see
    // scrollerOf); null when nothing around the target scrolls.
    let scroller;
    let wheel;
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
        if (action.listed_in) {
          assertChosenAsSeen(action, current);
          owner = await pinned(record, action.listed_owner, timeout);
          await assertOwnerHolds(owner, action.listed_owner, handle);
        }
        if (action.tool === 'type' && (!FIELDISH(current) || action.value == null)) throw new Error('INVALID_INPUT: value required and field must be editable');
        if (action.tool === 'select' && !SELECTISH(current)) throw new Error('INVALID_INPUT: select requires a combobox');
        if (action.tool === 'select' && current.tag === 'select') {
          const options = current.options.filter((o) => o.value === String(action.value));
          if (action.value == null || options.length !== 1 || options[0].disabled) throw new Error('INVALID_INPUT: native option must be unique and enabled');
        }
        if (clicksField(action, inputMode, current)) part = await ownPartOf(handle, timeout);
        const at = part || handle;
        if (forced(action, current)) await at.hover({ trial: true, timeout });
        else if (['click', 'hover'].includes(action.tool)) await at[action.tool]({ trial: true, timeout });
        // A custom combobox opens on a click. One that another combobox's
        // open list covers fails here, before the journal, not after.
        else if (action.tool === 'select' && current.tag !== 'select') await at.click({ trial: true, timeout });
        else if (part) await part.click({ trial: true, timeout });
        // SCROLL on a target turns the box around it that scrolls, such as
        // an open list, with the pointer over the middle of that box. With
        // none, the wheel turns over the target.
        else if (action.tool === 'scroll') {
          const found = await handle.evaluateHandle(scrollerOf);
          scroller = found.asElement();
          if (!scroller) await found.dispose();
          wheel = scroller ? await scroller.evaluate(wheelOver) : undefined;
          await (scroller || handle).hover({ ...(wheel ? { position: wheel.at } : {}), trial: true, timeout });
        }
        return handle;
      } catch (error) { await handle.dispose(); throw error; }
    }, beforeDispatch, async (handle, mark) => {
      // fsync can take time. Recheck the pinned node after the durable hook,
      // still before input; detachment/record recycling is a proven rejection.
      let force = false;
      let current;
      if (handle) {
        const state = await handle.evaluate(readDOM);
        current = state.elements[0];
        const entry = record.refs.get(action.el.selector);
        const doc = entry && `${this.frameInfo(entry.frame).id}:${this.frameInfo(entry.frame).revision}:${state.documentKey}`;
        if (!current || !sameIdentity(action.el, current, state.url) || current.disabled
            || doc !== action.el.document_id
            || ['type', 'select'].includes(action.tool) && !sensitiveFieldValueEqual(action.el, current)) throw new Error('STALE_TARGET: target changed while persisting intent');
        if (action.listed_in) {
          assertChosenAsSeen(action, current);
          await assertOwnerHolds(owner, action.listed_owner, handle);
        }
        // The click still lands where it was checked to land.
        if (part !== undefined && !await handle.evaluate(ownPart, [FIELD, INTERACTIVE, part])) {
          throw new Error('STALE_TARGET: what a click on the target lands on changed while persisting intent');
        }
        force = forced(action, current);
        if (force) await (part || handle).hover({ trial: true, timeout });
      }
      const at = part || handle;
      // Requests the page starts from here on belong to this input; the next
      // observation waits for them (see observe).
      if (!['wait', 'none'].includes(action.tool)) {
        record.inputAt = Date.now();
        record.events.input(record.inputAt);
      }
      switch (action.tool) {
        case 'click': mark(); await at.click({ timeout, force }); break;
        case 'hover': mark(); await at.hover({ timeout }); break;
        case 'type': {
          const value = String(action.value);
          mark();
          if (inputMode === 'realistic') {
            await at.click({ timeout, force });
            await handle.press('ControlOrMeta+A', { timeout });
            await handle.press('Backspace', { timeout });
            await handle.type(value, { timeout });
          } else {
            await handle.fill(value, { timeout, force });
            // fill() sends input/change events but no key events. Widgets such
            // as jQuery date pickers parse the field on keyup and rewrite it
            // from their own state on blur, emptying it. A Shift press delivers
            // the key events without changing the text.
            await record.page.keyboard.press('Shift').catch(() => {});
          }
          // Date pickers commit a typed date only when focus leaves the field;
          // antd commits a frame after that. A click on Generate or Save right
          // after typing still reads the old date. Leaving the field now, and
          // waiting for that frame, lets the effect check see the committed
          // value. A combobox keeps focus for its option list.
          if (isDateText(value) && current?.role !== 'combobox') {
            await handle.evaluate((e) => e.blur()).catch(() => {});
            await nextFrames(handle);
          }
          return { input_mode: inputMode };
        }
        case 'select':
          mark();
          if (action.el.tag === 'select') await handle.selectOption({ value: String(action.value) }, { timeout, force });
          else await at.click({ timeout, force });
          return { input_mode: action.el.tag === 'select' ? 'native_select' : 'pointer' };
        case 'press_enter':
        case 'press_key': {
          const key = action.tool === 'press_enter' ? 'Enter' : action.key || 'Escape';
          mark();
          if (handle) await handle.press(key, { timeout }); else await record.page.keyboard.press(key);
          break;
        }
        case 'scroll':
          mark();
          if (handle) await (scroller || handle).hover({ ...(wheel ? { position: wheel.at } : {}), timeout });
          await record.page.mouse.wheel(0, wheel?.by || 600);
          break;
        case 'back': mark(); await record.page.goBack({ waitUntil: 'domcontentloaded', timeout }); break;
        case 'wait': await new Promise((r) => setTimeout(r, 150)); break;
        case 'none': break;
      }
      return { input_mode: ['click', 'hover'].includes(action.tool) ? 'pointer' : 'keyboard' };
    }).finally(() => Promise.all([owner, part, scroller].map((h) => h?.dispose().catch(() => {}))));
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

// Playwright counts everything inside an aria-disabled button or row as
// disabled, so click, fill and selectOption wait on it until they time out. A
// dnd-kit item's aria-disabled only turns dragging off (see snapshot.mjs). For
// a target inside one, input skips Playwright's checks. Playwright's trial
// hover, which has no enabled check, first proves the target is visible,
// stable and not covered.
function forced(action, current) {
  return current.drag_disabled === true && ['click', 'type', 'select'].includes(action.tool);
}

// Input that clicks a field (or points at it): the click, the hover, the
// click that opens a custom combobox, and a realistic TYPE's first click.
// The page code checks the field as FIELD counts one; this only skips that
// check for what cannot be one.
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'radio', 'switch', 'slider']);
function clicksField(action, inputMode, current) {
  const field = ['input', 'textarea', 'select'].includes(current.tag) || FIELD_ROLES.has(current.role) || !!current.contenteditable;
  return field && (['click', 'hover'].includes(action.tool) || action.tool === 'select' && current.tag !== 'select'
    || action.tool === 'type' && inputMode === 'realistic');
}

// The part of a field's own box a click on the field lands on, when not the
// field itself (see ownPart). The field is scrolled into view first, as the
// click scrolls it, so that its middle is on screen.
async function ownPartOf(handle, timeout) {
  await handle.scrollIntoViewIfNeeded({ timeout });
  const found = await handle.evaluateHandle(ownPart, [FIELD, INTERACTIVE]);
  const part = found.asElement();
  if (!part) await found.dispose();
  return part;
}

// Page code: what a click on a field lands on, when that is a part of the
// field's own box drawn over it. antd draws a select's shown value over its
// input ("Is" in ccMonet's filter popup), so the browser's check before a
// click on the input waits, until it times out, for something that never
// moves away, and a person clicks that value to open the list. The part is
// what is on top at the middle of the field, where a click lands; it lies in
// the field's own box, up to four levels around the field that hold no other
// field (as in listsOption), and neither it nor anything between it and that
// box is a control (`interactive`): a clear button, a link, an option. With
// the field itself on top there, or anything else, there is none (null), and
// the browser's own check decides. `field` is FIELD. Like the browser's check,
// it reads into open shadow roots, and so does its count of fields in a box.
// Given what it found before (`expected`, a part or null), it says whether it
// finds the same now.
function ownPart(target, [field, interactive, expected]) {
  const parent = (e) => e.parentElement || e.getRootNode()?.host;
  const fieldsIn = (root) => [...root.querySelectorAll('*')].reduce((n, e) => n + (e.matches(field) ? 1 : 0) + (e.shadowRoot ? fieldsIn(e.shadowRoot) : 0), 0);
  const lands = () => {
    if (!target.isConnected || !target.matches(field)) return null;
    const rect = target.getClientRects()[0];
    if (!rect) return null;
    const x = (Math.max(rect.left, 0) + Math.min(rect.right, innerWidth)) / 2;
    const y = (Math.max(rect.top, 0) + Math.min(rect.bottom, innerHeight)) / 2;
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (!hit) return null;
    for (let p = hit; p; p = parent(p)) if (p === target) return null;
    let box;
    for (let up = parent(target), depth = 0; up && up !== document.body && up !== document.documentElement && depth < 4; up = parent(up), depth++) {
      if (fieldsIn(up) + (up.matches(field) ? 1 : 0) > 1) break;
      box = up;
    }
    if (!box) return null;
    for (let p = hit; p !== box; p = parent(p)) if (!p || p.matches(interactive)) return null;
    return hit;
  };
  const found = lands();
  return expected === undefined ? found : found === expected;
}

// An option from an open combobox's list is clicked: one chosen with SELECT
// (see listedOptions), or one Jev clicks. Before input it must still be
// listed under that combobox, which is still open, and still chosen or
// unchosen as it was when the click was chosen: on a multi-select a click on
// a chosen option takes it out again. SELECT offers only unchosen options.
const OPTION_CHOSEN = 'STALE_TARGET: the option is already chosen';
const OPTION_UNCHOSEN = 'STALE_TARGET: the option is no longer chosen';
const NOT_LISTED = 'STALE_TARGET: the option is no longer listed under the combobox it was chosen from';
function assertChosenAsSeen(action, option) {
  if ((option.selected === true) !== (action.listed_chosen === true)) throw new Error(action.listed_chosen ? OPTION_UNCHOSEN : OPTION_CHOSEN);
}
function assertStillListed(action, option, page) {
  // `action.el` is still the option as the decision saw it.
  action.listed_chosen = action.chosen_as !== 'select' && action.el?.selected === true;
  assertChosenAsSeen(action, option);
  const listedIn = action.listed_in;
  if (!listedIn) throw new Error(NOT_LISTED);
  // Its combobox is found as any target is: the one control with its
  // identity, or of identical ones the one that still shows what it showed
  // (see twinsOf), never just the one open now.
  const owners = page.elements.filter((e) => e.frame_id === listedIn.frame_id && e.document_id === listedIn.document_id && sameIdentity(listedIn, e, page.url));
  const twins = action.observed?.owner_twins;
  const owner = twins ? pickTwin(twins, owners) : owners.length === 1 ? owners[0] : undefined;
  // A combobox told apart by its table line is gone or on another line now.
  if (!owner && twins?.node != null) throw new Error(NOT_LISTED);
  if (!owner && owners.length > 1) throw new Error("STALE_TARGET: ambiguous: the option's combobox has identical twins");
  if (!owner || owner.expanded !== true || option.popup_of !== owner.i) throw new Error(NOT_LISTED);
  action.listed_owner = owner;
}

async function pinned(record, el, timeout) {
  const entry = el && record.refs.get(el.selector);
  const handle = entry && await entry.locator.elementHandle({ timeout }).catch(() => null);
  if (!handle) throw new Error(NOT_LISTED);
  return handle;
}

// The pinned combobox still lists the pinned option: it is still the control
// the freshness check found, still open, and its list holds the option.
async function assertOwnerHolds(ownerHandle, owner, optionHandle) {
  const state = await ownerHandle.evaluate(readDOM);
  const current = state.elements[0];
  if (!current || !sameIdentity(owner, current, state.url) || current.expanded !== true
      || !await ownerHandle.evaluate(listsOption, [optionHandle, FIELD])) throw new Error(NOT_LISTED);
}

// Page code: whether the open combobox `box` lists `option`, linked as the
// snapshot links them (see popupOwner there): the list its aria-controls or
// aria-owns names, or the floating box that holds that list, holds it; or,
// with no such list, it is the one open combobox and the option floats
// outside it in a box drawn for it (see drawnFor there). `field` is FIELD.
// Like the snapshot, it reads into open shadow roots and up through their
// hosts: a web component's combobox or list is found here too.
function listsOption(box, [option, field]) {
  if (!box.isConnected || !option?.isConnected || box.getAttribute('aria-expanded') !== 'true') return false;
  const parent = (e) => e.parentElement || e.getRootNode()?.host;
  const floating = (p) => ['absolute', 'fixed'].includes(getComputedStyle(p).position);
  const floatOf = (p) => {
    for (let up = 0; p && p !== document.body && up < 5; up++, p = p.parentElement) if (floating(p)) return p;
    return undefined;
  };
  const roots = `${box.getAttribute('aria-controls') || ''} ${box.getAttribute('aria-owns') || ''}`.split(/\s+/).filter(Boolean)
    .map((id) => box.getRootNode().getElementById?.(id) || document.getElementById(id)).filter(Boolean)
    .map((l) => { const f = floatOf(l); return f && !f.contains(box) ? f : l; });
  if (box.contains(option) || roots.some((r) => r.contains(option))) return true;
  // The snapshot's visible() and clipsAll(), mirrored: page code cannot
  // share them. An open combobox that is hidden, inert, aria-hidden (a
  // dialog's background) or clipped away is not counted here, as the
  // snapshot does not count it when it links the option.
  const clipsAll = (p, style) => {
    if (style.display === 'inline' || style.display === 'contents') return false;
    const tiny = () => { const r = p.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; };
    if (/hidden|clip/.test(`${style.overflowX} ${style.overflowY}`) && tiny()) return true;
    if (style.clipPath === 'inset(50%)') return true;
    const rect = style.clip.match(/^rect\(([-\d.]+)px,? ([-\d.]+)px,? ([-\d.]+)px,? ([-\d.]+)px\)$/);
    return !!rect && ['absolute', 'fixed'].includes(style.position) && (rect[2] - rect[4] <= 1 || rect[3] - rect[1] <= 1);
  };
  const visible = (e) => {
    if (!e.isConnected || !e.getClientRects().length) return false;
    for (let p = e; p; p = parent(p)) {
      const style = getComputedStyle(p);
      if (p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || clipsAll(p, style)) return false;
    }
    return true;
  };
  const trees = (root) => [root, ...[...root.querySelectorAll('*')].filter((e) => e.shadowRoot).flatMap((e) => trees(e.shadowRoot))];
  const open = trees(document).flatMap((root) => [...root.querySelectorAll('[role=combobox][aria-expanded="true"]')])
    .filter((c) => c.tagName !== 'SELECT' && visible(c));
  if (open.length !== 1 || open[0] !== box) return false;
  let p = parent(option);
  while (p && !floating(p)) p = parent(p);
  if (!p || p.contains(box)) return false;
  let at = box;
  for (let depth = 0; depth < 4; depth++) {
    const up = parent(at);
    if (!up || up === document.body || up.querySelectorAll(field).length + (up.matches(field) ? 1 : 0) > 1) break;
    at = up;
  }
  const r = p.getBoundingClientRect(), f = at.getBoundingClientRect();
  return r.width * r.height > 0 && r.left < f.right && r.right > f.left && Math.max(r.top - f.bottom, f.top - r.bottom) <= 64;
}

// The nearest box around a target that scrolls, such as an open list.
// antd's virtual list draws only the options in view and turns the wheel
// itself (overflow hidden). Null when there is none.
function scrollerOf(target) {
  const up = (e) => e.parentElement || e.getRootNode()?.host;
  for (let p = up(target); p && p !== document.body && p !== document.documentElement; p = up(p)) {
    if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

// Where the pointer goes to turn a box's wheel, from the top left corner of
// its padding box: the middle of what it shows, so that no part of what it
// scrolls is brought into view first. How far: most of what it shows, so
// that what it shows next overlaps this.
function wheelOver(box) {
  return { at: { x: box.clientWidth / 2, y: box.clientHeight / 2 }, by: Math.max(24, Math.round(box.clientHeight * 0.8)) };
}

// Resolves after the page has drawn two more frames. A hidden tab draws none,
// so give up after a short time instead of waiting for it.
function nextFrames(handle, ms = 250) {
  const frames = handle.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
  return Promise.race([frames.catch(() => false), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

function sensitiveFieldValueEqual(target, current) {
  return target.value_hash ? target.value_hash === createHash('sha256').update(String(current.value ?? '')).digest('hex') : String(target.value ?? '') === String(current.value ?? '');
}
