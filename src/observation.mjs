import { createHash } from "node:crypto";
import { verifyActionEffect } from "./action-effect.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function transientNavigationError(error) {
  return /timed? out|timeout|receiving end does not exist|could not establish connection|SNAPSHOT_CHANGED:|Kapture GET .*\/dom\b.*Cannot read properties of null \(reading 'outerHTML'\)/i.test(String(error?.message || error));
}

function expectsNavigation(before, action) {
  if (action?.tool === "press_enter" && (action.el?.type === "search" || action.el?.role === "searchbox")) return true;
  if (action?.tool === "click" && action.el?.form_action) return true;
  if (action?.tool !== "click" || !(action.el?.tag === "a" || action.el?.role === "link") || !action.el?.href) return false;
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

export async function observeUntilReady(read, { before, action, ready, maxMs = 8000, navigationMs = maxMs, quietMs = 250, pollMs = 150, effectGraceMs = 1500, now = Date.now, pause = sleep } = {}) {
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
    const signature = observationSignature(page);
    if (previous !== signature) { previous = signature; stableSince = now(); }
    effect = verifyActionEffect(before, page, action);
    const busy = page.loading?.busy;
    const waitingForEffect = (exact || navigation) && effect?.status !== "confirmed";
    const pendingAsync = action && action.side_effect >= 0.25 && effect?.status === "unknown" && now() - started < effectGraceMs;
    if (!busy && !waitingForEffect && !pendingAsync && (!ready || ready(page)) && now() - stableSince >= quietMs) break;
    if (now() - started >= limit) break;
    await pause(Math.min(pollMs, Math.max(1, limit - (now() - started))));
  } while (true);
  return { page, effect, ms: now() - started, timed_out: !!page.loading?.busy || ((exact || navigation) && effect?.status !== "confirmed") || !!(ready && (!ready(page) || now() - stableSince < quietMs)) };
}
