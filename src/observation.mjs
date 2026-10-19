import { createHash } from "node:crypto";
import { verifyActionEffect } from "./action-effect.mjs";
import { FIELDISH } from "./page-model.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function transientNavigationError(error) {
  return /timed? out|timeout|receiving end does not exist|could not establish connection|execution context was destroyed|SNAPSHOT_CHANGED:|Kapture GET .*\/dom\b.*Cannot read properties of null \(reading 'outerHTML'\)/i.test(String(error?.message || error));
}

function expectsNavigation(before, action) {
  if (action?.tool === "press_enter" && (action.el?.type === "search" || action.el?.role === "searchbox")) return true;
  if (action?.tool === "click" && action.el?.form_action) return true;
  // A same-document link ("#", "#section", "#/route") loads no new page.
  if (action?.tool !== "click" || !(action.el?.tag === "a" || action.el?.role === "link") || !action.el?.href || action.el.href.startsWith("#")) return false;
  try {
    const destination = new URL(action.el.href, before.url);
    return ["http:", "https:"].includes(destination.protocol) && destination.href !== before.url;
  } catch { return false; }
}

export function observationSignature(page) {
  // Generated selectors, timestamps and geometry do not define progress.
  const state = [page.url, page.title, page.text, page.loading, page.elements.map((e) =>
    [e.tag, e.role, e.label, e.context, e.scope, e.value, e.checked, e.expanded, e.selected, e.disabled, e.invalid, e.options?.filter((o) => o.selected).map((o) => o.value)])];
  if (page.page_id) state.push(page.page_id, page.frames, page.elements.map((e) => [e.form_key, e.record_key]));
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

// The state a host review ticket binds. A toast ("Update successfully") goes
// away on its own seconds later, so its text is left out. The ticket keeps
// digests of the toasts it showed: any other toast at acceptance, such as a
// late error, still makes the ticket stale.
export function reviewedState(page) {
  const toasts = (page.toasts || []).filter((toast) => toast && page.text?.includes(toast));
  // An element's context is its row's or parent's text, which can hold a
  // toast shown next to it.
  const without = (value) => {
    if (value == null) return value;
    let text = String(value);
    for (const toast of toasts) {
      const at = text.lastIndexOf(toast);
      if (at >= 0) text = `${text.slice(0, at)} ${text.slice(at + toast.length)}`;
    }
    return text.replace(/\s+/g, " ").trim();
  };
  const elements = page.elements.filter((e) => !e.toast).map((e) => ({ ...e, context: without(e.context) }));
  return { digest: observationSignature({ ...page, text: without(String(page.text ?? "")), elements }), toasts: toasts.map(digest) };
}

export function sameReviewedState(page, record) {
  const now = reviewedState(page);
  return now.digest === record.state_digest && now.toasts.every((toast) => (record.toasts || []).includes(toast));
}

// A click that changes nothing at first may still be at work: a handler can
// wait before sending its request. Watch a little longer before reporting it.
// Clicking into a text field or a native select only focuses or opens it.
const DELAYED = new Set(["click", "press_enter", "press_key"]);
const mayBeDelayed = (action) => DELAYED.has(action?.tool) && !FIELDISH(action.el) && action.el?.tag !== "select";

export async function observeUntilReady(read, { before, action, ready, maxMs = 8000, navigationMs = maxMs, quietMs = 250, pollMs = 150, effectGraceMs = 1500, clickGraceMs = 1000, now = Date.now, pause = sleep } = {}) {
  const started = now();
  let page, previous, stableSince = started, effect;
  const navigation = expectsNavigation(before, action);
  const limit = navigation ? navigationMs : maxMs;
  const exact = action && (["type", "select"].includes(action.tool) || ["checkbox", "radio", "switch"].includes(action.el?.role));
  do {
    try { page = await read(); }
    catch (error) {
      // A navigation tears down the old content script. Retry observation only;
      // never retransmit the click, and never hide arbitrary transport errors.
      if (!navigation || !transientNavigationError(error) || now() - started >= limit) throw error;
      await pause(Math.min(pollMs, Math.max(1, limit - (now() - started))));
      continue;
    }
    // The driver counts the page's data requests the last input started that
    // are still open; their result is not on the page yet. One that just
    // finished is rendered a moment later, so it restarts the quiet period.
    const signature = `${observationSignature(page)}:${page.pending_requests || 0}`;
    if (previous !== signature) { previous = signature; stableSince = now(); }
    effect = verifyActionEffect(before, page, action);
    const busy = page.loading?.busy || page.pending_requests > 0;
    const waitingForEffect = (exact || navigation) && effect?.status !== "confirmed";
    const grace = action?.side_effect >= 0.25 ? effectGraceMs : mayBeDelayed(action) ? clickGraceMs : 0;
    const pendingAsync = effect?.status === "unknown" && now() - started < grace;
    if (!busy && !waitingForEffect && !pendingAsync && (!ready || ready(page)) && now() - stableSince >= quietMs) break;
    if (now() - started >= limit) break;
    await pause(Math.min(pollMs, Math.max(1, limit - (now() - started))));
  } while (true);
  return { page, effect, ms: now() - started, timed_out: !!(page.loading?.busy || page.pending_requests > 0) || ((exact || navigation) && effect?.status !== "confirmed") || !!(ready && (!ready(page) || now() - stableSince < quietMs)) };
}
