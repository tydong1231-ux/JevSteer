import { createHash } from "node:crypto";
import { verifyActionEffect } from "./action-effect.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function observationSignature(page) {
  // Generated selectors, timestamps and geometry do not define progress.
  const state = [page.url, page.title, page.text, page.loading, page.elements.map((e) =>
    [e.tag, e.role, e.label, e.context, e.scope, e.value, e.checked, e.expanded, e.selected, e.disabled, e.invalid, e.options?.filter((o) => o.selected).map((o) => o.value)])];
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export async function observeUntilReady(read, { before, action, maxMs = 8000, quietMs = 250, pollMs = 150, effectGraceMs = 1500, now = Date.now, pause = sleep } = {}) {
  const started = now();
  let page, previous, stableSince = started, effect;
  const exact = action && (["type", "select"].includes(action.tool) || ["checkbox", "radio", "switch"].includes(action.el?.role));
  do {
    page = await read();
    const signature = observationSignature(page);
    if (previous !== signature) { previous = signature; stableSince = now(); }
    effect = verifyActionEffect(before, page, action);
    const busy = page.loading?.busy;
    const waitingForEffect = exact && effect?.status !== "confirmed";
    const pendingAsync = action && action.side_effect >= 0.25 && effect?.status === "unknown" && now() - started < effectGraceMs;
    if (!busy && !waitingForEffect && !pendingAsync && now() - stableSince >= quietMs) break;
    if (now() - started >= maxMs) break;
    await pause(Math.min(pollMs, Math.max(1, maxMs - (now() - started))));
  } while (true);
  return { page, effect, ms: now() - started, timed_out: !!page.loading?.busy || (exact && effect?.status !== "confirmed") };
}
