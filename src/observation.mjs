import { createHash } from "node:crypto";
import { verifyActionEffect } from "./action-effect.mjs";
import { FIELDISH, readablePopup } from "./page-model.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// More interactive elements than one observation takes (see captureSnapshot).
export function observationLimitError(error) {
  return /^OBSERVATION_LIMIT:/.test(String(error?.message || error));
}

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
  // `display` is what a select-like combobox shows as its value. `hint` and
  // `column` say which field it is when it has no name of its own, and `row`
  // which line of its table it is on; the host reads them, also where the
  // page text that shows them is past its cutoff. So it reads whether a field
  // is marked required or read-only, which a page can change with no text
  // around it changing: whether a form is complete, or a record locked, can
  // rest on it (Codex on 3fa0a57). A multi-select's chosen options are read
  // apart (display_items): "Doe, John" is one option, or two.
  const state = [page.url, page.title, page.text, page.loading, page.elements.map((e) =>
    [e.tag, e.role, e.label, e.hint, e.column, e.row, e.context, e.scope, e.value, e.display_items ?? e.display, e.checked, e.expanded, e.selected, e.disabled, e.readonly, e.required, e.invalid, e.error_mark, e.options?.filter((o) => o.selected).map((o) => o.value)])];
  if (page.page_id) state.push(page.page_id, page.frames, page.elements.map((e) => [e.form_key, e.record_key]));
  // What a focused field's popup says (search results) is read apart from
  // the page text, also past that text's cutoff, and a review can rest on it.
  const popup = readablePopup(page);
  if (popup) state.push(["popup", popup.field.i, popup.text]);
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

// The state a host review ticket binds. A toast ("Update successfully") goes
// away on its own seconds later, so its text is left out. The ticket keeps
// digests of the toasts it showed: any other toast at acceptance, such as a
// late error, still makes the ticket stale. With `counts`, badge counts stay
// in (see countsReferenced).
// The toasts a page shows, and a function that takes their text out of a
// text. An element's context is its row's or parent's text, which can hold a
// toast shown next to it.
function toastText(page) {
  const toasts = (page.toasts || []).filter((toast) => toast && page.text?.includes(toast));
  const without = (value) => {
    if (value == null) return value;
    let text = String(value);
    for (const toast of toasts) {
      const at = text.lastIndexOf(toast);
      if (at >= 0) text = `${text.slice(0, at)} ${text.slice(at + toast.length)}`;
    }
    return text.replace(/\s+/g, " ").trim();
  };
  return { toasts, without };
}

// The page without its toasts, which go away on their own. A host review
// ticket binds the page without them (see reviewedState), so its assertions
// are checked on this too.
export function withoutToasts(page) {
  const { without } = toastText(page);
  return { ...page, text: without(String(page.text ?? "")), toasts: [],
    elements: page.elements.filter((e) => !e.toast).map((e) => ({ ...e, context: without(e.context) })) };
}

export function reviewedState(page, { counts = false } = {}) {
  const { toasts, without } = toastText(page);
  // A badge count ("Todo 41") changes as other work adds to it: the review
  // copies the snapshot made show it as "#".
  const review = (copy, value) => counts ? value : copy ?? value;
  const elements = page.elements.filter((e) => !e.toast).map((e) => ({ ...e, label: review(e.review_label, e.label), context: without(review(e.review_context, e.context)) }));
  return { digest: observationSignature({ ...page, text: without(String(review(page.review_text, page.text) ?? "")), elements }), toasts: toasts.map(digest) };
}

export function sameReviewedState(page, record) {
  const now = reviewedState(page, { counts: record.counts === true });
  return now.digest === record.state_digest && now.toasts.every((toast) => (record.toasts || []).includes(toast));
}

// The counts a "#" stands for in the review copy of a text, each with the
// words next to it. A count follows what it counts ("Todo 41"): in a page's
// text the word after it already belongs to the next thing on the page, so
// only a control's own label also gives the word after ("2 items"). A count
// can read as several words: antd's Badge draws each digit apart ("4 1").
function badgeCounts(text, copy, { after = false } = {}) {
  // A page's frames read one after another, each on a line of its own.
  const raw = String(text ?? "").split(/\s/), marked = String(copy ?? "").split(/\s/);
  const word = (token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const named = (token) => token !== "#" && /\p{L}/u.test(word(token));
  const found = [];
  for (let i = 0, j = 0; i < raw.length && j < marked.length; j++) {
    if (marked[j] !== "#" || raw[i] === "#") { if (raw[i] !== marked[j]) break; i++; continue; }
    // The longest run of digit words that reads as one count, after which
    // the text and its copy agree again, or that ends either of them.
    let max = i;
    while (max < raw.length && max - i < 7 && /^[\d+]+$/.test(raw[max])) max++;
    const runs = Array.from({ length: max - i }, (_, n) => max - n).filter((end) => /^\d{1,6}\+?$/.test(raw.slice(i, end).join("")));
    const end = runs.find((e) => e < raw.length && raw[e] === marked[j + 1]) ?? runs.find((e) => e === raw.length || j + 1 === marked.length);
    if (end === undefined) break;
    const words = [marked.slice(0, j).findLast(named), after && marked.slice(j + 1).find(named)];
    found.push({ count: raw.slice(i, end).join("").replace(/\+$/, ""), words: words.filter(Boolean).map(word) });
    i = end;
  }
  return found;
}

const said = (text, token) => {
  const t = token.toLowerCase();
  if (!/[a-z0-9]/.test(t)) return text.includes(t);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);
};

// The page text as a ticket binds it, when it has a badge count: its review
// copy, with each count it shows as "#" unknown ("\0", which no assertion
// holds). A "#" the page shows itself reads as unknown too.
function boundText(page) {
  if (page.review_text == null || page.review_text === page.text) return undefined;
  return String(page.review_text).split(/(\s+)/).map((token) => (token === "#" ? "\0" : token)).join("");
}

// Whether a text assertion rests on a badge count in the page text. One that
// must hold does when the page holds its text only in a count ("2" in
// "Todo 12"). One whose text the page must not show does when a count could
// turn into it, which takes a word of it that a count could be ("3" while
// "Cart 2" shows): a count never shares a word with letters.
function assertionsRestOnCounts(page, assertions) {
  const bound = boundText(page);
  if (bound === undefined) return false;
  const kept = toastText(page).without(bound);
  return (assertions || []).some((a) => {
    if (typeof a?.value !== "string" || !a.value.trim()) return false;
    const fold = (v) => (a.case_sensitive ? v : v.toLowerCase());
    if (a.type === "text_contains") return !fold(kept).includes(fold(a.value));
    if (a.type === "text_not_contains") return a.value.trim().split(/\s+/).some((word) => /^\d*\+?$/.test(word));
    return false;
  });
}

// Whether a milestone's contract speaks of a count that a badge on the page
// shows: it names the badge ("Cart", "Todo"), states its number, or asks
// about counts at all, or a text assertion rests on one (see
// assertionsRestOnCounts). A ticket for such a contract binds the counts too,
// so "Cart 2" turning into "Cart 3" makes it stale.
export function countsReferenced(page, contract = {}) {
  const text = [contract.goal, ...(contract.success_criteria || []), ...(contract.constraints || []),
    ...(contract.assertions || []).flatMap((a) => [a.value, a.label, a.context])].filter((v) => typeof v === "string" && v).join("\n").toLowerCase();
  if (!text) return false;
  const pairs = [[page.text, page.review_text], ...page.elements.flatMap((e) => [[e.label, e.review_label, true], [e.context, e.review_context]])];
  const badges = pairs.filter(([value, copy]) => copy != null && copy !== value).flatMap(([value, copy, after]) => badgeCounts(value, copy, { after }));
  if (!badges.length) return false;
  if (assertionsRestOnCounts(page, contract.assertions)) return true;
  if (/(^|[^a-z])(badges?|counters?|counts?|unread|notifications?)($|[^a-z])|角标|未读|计数/.test(text)) return true;
  return badges.some(({ count, words }) => said(text, count) || words.some((w) => said(text, w)));
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
      // While a page swaps its content it can briefly hold both the old and
      // the new list, more elements than one observation takes: watch it
      // settle, whatever the input was.
      const overLimit = observationLimitError(error);
      if (!(overLimit || navigation && transientNavigationError(error)) || now() - started >= limit) throw error;
      await pause(Math.min(overLimit ? Math.max(pollMs, 500) : pollMs, Math.max(1, limit - (now() - started))));
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
