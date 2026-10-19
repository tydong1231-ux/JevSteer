import { KaptureClient } from '../kapture-client.mjs';
import { locateSameElement } from '../element-identity.mjs';
import { observeUntilReady } from '../observation.mjs';
import { dispatchInput } from './driver.mjs';

export class KaptureDriver {
  constructor({ client = new KaptureClient(), snapshotter } = {}) {
    this.kind = 'kapture';
    this.client = client;
    this.snapshotter = snapshotter || (async (client, id) => (await import('../semantic-snapshot.mjs')).semanticSnapshot(client, id));
  }
  ready() { return this.client.ensureServer(); }
  pages() { return this.client.listTabs(); }
  createPage() { return this.client.newTab(); }
  open(url, { pageRef } = {}) { return this.client.navigate(pageRef, url); }
  detail(id) { return this.client.tabDetail(id); }
  metadata(id) { return this.client.dom(id, { selector: 'title' }); }
  observe(id) { return this.snapshotter(this.client, id); }
  waitFor(id, condition, budget = {}) { return observeUntilReady(() => this.observe(id), { ...budget, ready: condition }); }
  screenshot(id, options) { return this.client.screenshot(id, options); }
  startEvents(id, clientId) { return this.client.command(id, 'network_monitor', { enabled: true, clientId }); }
  stopEvents(id, clientId) { return this.client.command(id, 'network_monitor', { enabled: false, clientId }); }
  events(id, cursor = 0) { return this.client.command(id, 'network_requests', { since: cursor, limit: 1000 }); }
  eventBody(id, requestId, maxBytes) { return this.client.command(id, 'network_body', { requestId, maxBytes }); }
  close() { return this.client.close(); }

  async assertTargetFresh(id, action, { readPage = () => this.observe(id) } = {}) {
    const original = action.el;
    if (!original?.selector) throw new Error('STALE_TARGET: no observed selector');
    let target = original;
    const generated = (s) => /^(?:#|\.)kapture-\d+$/.test(s || '');
    if (original.identity_version) {
      const page = await readPage(id);
      if (action.observedUrl && page.url !== action.observedUrl) throw new Error('STALE_TARGET: page navigated during identity check');
      const fresh = locateSameElement(original, page);
      if (!fresh || fresh.disabled || fresh.readonly && action.tool === 'type'
          || fresh.selector !== original.selector && !(generated(original.selector) && generated(fresh.selector))) {
        throw new Error('STALE_TARGET: target identity, record context or interaction scope changed');
      }
      if (['type', 'select'].includes(action.tool) && String(fresh.value ?? '') !== String(original.value ?? '')) throw new Error('STALE_TARGET: live field value changed');
      target = fresh;
    }
    const response = await this.client.elements(id, target.selector, { visible: 'true' });
    const matches = response?.elements || [];
    if (response?.url && action.observedUrl && response.url !== action.observedUrl) throw new Error('STALE_TARGET: page navigated after decision');
    if (matches.length !== 1 || matches[0]?.visible !== true) throw new Error('STALE_TARGET: target was replaced, hidden or became ambiguous');
    const current = matches[0];
    if (current.tagName && String(current.tagName).toLowerCase() !== original.tag) throw new Error('STALE_TARGET: target element type changed');
    if (original.href && current.href) {
      const base = action.observedUrl || response.url;
      const normalize = (href) => { try { return new URL(href, base).href; } catch { return href; } };
      if (normalize(original.href) !== normalize(current.href)) throw new Error('STALE_TARGET: target navigation changed');
    }
    if (original.name && current.name && original.name !== current.name) throw new Error('STALE_TARGET: target field changed');
    // Snapshots hide password values ("[REDACTED]"), so the live value of such
    // a field can never match; the identity check above still applies.
    const hidden = original.type === 'password' || original.value === '[REDACTED]';
    if (['type', 'select'].includes(action.tool) && current.value != null && !hidden && String(original.value ?? '') !== String(current.value)) throw new Error('STALE_TARGET: field value changed after decision');
    if (original.identity_version) action.el = { ...target, selector: generated(target.selector) && generated(current.selector) ? current.selector : target.selector };
  }

  perform(id, action, _target, { beforeDispatch } = {}) {
    return dispatchInput(async () => null, beforeDispatch, async (_, mark) => {
      const selector = action.target == null ? undefined : action.el?.selector;
      const command = async (name, args, timeout) => { mark(); return this.client.command(id, name, args, timeout); };
      switch (action.tool) {
        case 'click': await command('click', { selector }); break;
        case 'type': {
          const value = String(action.value);
          if (['input', 'textarea'].includes(action.el.tag)) await command('fill', { selector, value });
          else {
            await command('clear', { selector });
            await command('type', { selector, text: value, delay: value.length <= 120 ? 5 : 0 }, 120000);
          }
          return { input_mode: 'fast' };
        }
        case 'press_enter': await command('keypress', { ...(selector ? { selector } : {}), key: 'Enter' }); break;
        case 'press_key': await command('keypress', { ...(selector ? { selector } : {}), key: action.key || 'Escape' }); break;
        case 'select':
          if (action.el.tag !== 'select') await command('click', { selector });
          else await command('select', { selector, value: String(action.value) });
          break;
        case 'hover': await command('hover', { selector }); break;
        case 'scroll': await command('keypress', { key: 'PageDown' }); break;
        case 'back': await command('back', {}); break;
        case 'wait': await new Promise((r) => setTimeout(r, 900)); break;
        case 'none': break;
        default: throw new Error(`unsupported action: ${action.tool}`);
      }
    });
  }
}
