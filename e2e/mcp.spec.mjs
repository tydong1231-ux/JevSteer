// Actual MCP browser_run/browser_review, real Chromium UI, deterministic
// decision double, independent read-only HTTP/DOM oracle. Live Jev is separate.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { startFixtureServer } from '../test/helpers/fixture-server.mjs';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';
import { JevSteerRuntime } from '../src/runtime.mjs';
import { ActionJournal } from '../src/action-journal.mjs';
import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';

const lookup = (state, name) => state.page.elements.find((e) => e.label === name)?.i;
// Run, review and page ids and state digests are random hex, so they can hold
// any digits. A leaked secret would show up outside them.
const withoutIds = (value) => JSON.stringify(value).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32,}/gi, '<id>');

test('MCP host oracle reads visible business cells independently without input or secret values', async ({ page }, testInfo) => {
  await page.setContent(`<table aria-label="Statement"><tr><th>Date</th><th>Amount</th></tr><tr><td>2026/5/3</td><td>12.65</td></tr><tr hidden><td>Hidden</td></tr></table><label>API Key<input value="fixture-secret"></label><label>Password<input type="password" value="fixture-password"></label><table hidden><tr><td>Hidden table</td></tr></table><script>window.changes=[];new MutationObserver(m=>changes.push(...m)).observe(document,{subtree:true,attributes:true,childList:true,characterData:true});window.inputs=0;document.addEventListener('input',()=>inputs++);</script>`);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]));
  try {
    const oracle = await mcp.call('browser_inspect', { tab_id: mcp.id });
    expect(oracle.tables).toHaveLength(1);
    expect(oracle.tables[0].rows).toEqual([['Date', 'Amount'], ['2026/5/3', '12.65']]);
    expect(oracle.controls.map((e) => e.value)).toEqual(['[REDACTED]', '[REDACTED]']);
    expect(await page.evaluate(() => ({ changes: changes.length, inputs }))).toEqual({ changes: 0, inputs: 0 });
    expect(mcp.runtime.stats.calls).toBe(0);
  } finally { await mcp.close(); }
});

test('MCP host oracle redacts PIN and 2FA controls like sensitiveName()', async ({ page }, testInfo) => {
  await page.setContent('<label>PIN<input value="1234"></label><label>2FA code<input value="654321"></label><input name="card_pin" aria-label="Card" value="9999"><label>Shipping address<input value="1 Main St"></label>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]));
  try {
    const oracle = await mcp.call('browser_inspect', { tab_id: mcp.id });
    expect(oracle.controls.map((e) => e.value)).toEqual(['[REDACTED]', '[REDACTED]', '[REDACTED]', '1 Main St']);
    expect(withoutIds(oracle)).not.toMatch(/1234|654321|9999/);
  } finally { await mcp.close(); }
});

test('typing a host-supplied PIN is confirmed without exposing it', async ({ page }, testInfo) => {
  await page.setContent('<h1>Card settings</h1><label>Card PIN<input id="pin" autocomplete="off"></label>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: lookup(state, 'Card PIN') }),
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Enter the supplied card PIN without saving', values: { pin: '4321' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    await expect(page.locator('#pin')).toHaveValue('4321');
    expect(result.status).toBe('host_review_required');
    expect(withoutIds(result)).not.toContain('4321');
  } finally { await mcp.close(); }
});

test('exact constraint guard rejects low-risk row selection before any real input', async ({ page }, testInfo) => {
  await page.setContent('<label>Select all<input type="checkbox"></label>');
  let exact = 0;
  const decider = async (state, questions) => {
    if (questions.violates) { exact++; expect(state.proposed_action.checked).toBe(false); return { answers: { violates: { noul: 0.99 } }, ms: 1, tokens: 1 }; }
    return { answers: decision({ tool: 'click', target: 0, side_effect: 0.01, irreversible: 0.01, constraint_risk: 0.01 }), ms: 1, tokens: 1 };
  };
  const mcp = await mcpFixture(page, testInfo, decider);
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Inspect existing bills', constraints: ['Do not select bulk rows'], verification_mode: 'host', max_actions: 1, evidence_level: 'none' });
    expect(result.status).toBe('constraint_blocked');
    expect(exact).toBe(1);
    await expect(page.locator('input')).not.toBeChecked();
    expect(result.actions).toHaveLength(0);
  } finally { await mcp.close(); }
});

test('read-only input checks exact remote preferences even when rough risk is low', async ({ page }, testInfo) => {
  await page.setContent('<button aria-label="Toggle favorite" onclick="window.favorites=(window.favorites||0)+1">☆</button>');
  let effects = 0;
  const decider = async (_state, questions) => {
    if (questions.action_side_effect) { effects++; return { answers: { action_side_effect: { noul: 0.99 }, action_irreversible: { noul: 0.01 } }, ms: 1, tokens: 1 }; }
    if (questions.violates) return { answers: { violates: { noul: 0.99 } }, ms: 1, tokens: 1 };
    return { answers: decision({ tool: 'click', target: 0, side_effect: 0.01, irreversible: 0.01, constraint_risk: 0.01 }), ms: 1, tokens: 1 };
  };
  const mcp = await mcpFixture(page, testInfo, decider);
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Open the existing report', constraints: ['Read only; do not change remote preferences'], verification_mode: 'host', max_actions: 1, evidence_level: 'none' });
    expect(result.status).toBe('constraint_blocked');
    expect(effects).toBe(1);
    expect(result.actions).toHaveLength(0);
    expect(await page.evaluate(() => window.favorites || 0)).toBe(0);
  } finally { await mcp.close(); }
});

test('accepting a later read-only checkpoint does not clear an earlier unknown action', async ({ page }, testInfo) => {
  await page.setContent('<button>Generate</button>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]));
  try {
    const before = await mcp.driver.observe(mcp.id);
    const unknown = await mcp.runtime.journal.begin(mcp.id, { runId: 'earlier-report', milestoneId: 'generate', page: before, action: { tool: 'click', el: before.elements[0] }, remoteRisk: 0.7 });
    await page.setContent('<h1>Bank statement list loaded</h1>');
    const result = await mcp.call('browser_run', { tab_id: mcp.id, run_id: 'later-read-only', goal: 'Inspect the bank statement list', assertions: [{ type: 'text_contains', value: 'Bank statement list loaded' }], verification_mode: 'host', evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    const accepted = await mcp.call('browser_review', { tab_id: mcp.id, review_id: result.host_review.review_id, decision: 'accept', goal_evidence: 'Independent DOM confirms the list heading', criteria_evidence: [] });
    expect(accepted.status).toBe('completed_host_verified');
    expect((await mcp.runtime.journal.pending(mcp.id)).map((r) => r.id)).toEqual([unknown.id]);
  } finally { await mcp.close(); }
});
const draftDecider = scriptedDecider([(state) => {
  const field = (label) => state.page.elements.find((e) => e.label === label);
  if (field('Record name')?.value !== 'Jev synthetic') return decision({ tool: 'type', target: lookup(state, 'Record name'), value: 'name' });
  if (field('Notes')?.value !== 'Fixture only') return decision({ tool: 'type', target: lookup(state, 'Notes'), value: 'notes' });
  if (state.task.goal.includes('Save') && !state.page.text.includes('DRAFT-42')) return decision({ tool: 'click', target: lookup(state, 'Save draft'), side_effect: 0.8 });
  return decision({ tool: 'none', done: 0.99 });
}]);

test('MCP milestones fill by real input, require host receipts, save once and read back business ID', async ({ page }, testInfo) => {
  const fixture = await startFixtureServer();
  await page.goto(fixture.base + '/draft');
  const mcp = await mcpFixture(page, testInfo, draftDecider);
  const plan = {
    goal: 'Prepare a synthetic draft and save it', tab_id: mcp.id,
    verification_mode: 'host', review_mode: 'strict', constraints: ['Keep the record in draft; do not publish'],
    values: { name: 'Jev synthetic', notes: 'Fixture only' },
    milestones: [
      { id: 'fill', goal: 'Fill the synthetic draft fields', success_criteria: ['Record name and notes match the supplied values'], assertions: [{ type: 'field_equals', label: 'Record name', value: 'Jev synthetic' }, { type: 'field_equals', label: 'Notes', value: 'Fixture only' }] },
      { id: 'save', goal: 'Save the synthetic draft once', success_criteria: ['A saved draft has business ID DRAFT-42'], assertions: [{ type: 'text_contains', value: 'Draft saved: DRAFT-42' }] },
    ],
  };
  try {
    const fill = await mcp.call('browser_run', plan);
    expect(fill.status).toBe('host_review_required');
    await expect(page.locator('#name')).toHaveValue('Jev synthetic');
    await expect(page.locator('#notes')).toHaveValue('Fixture only');
    expect((await (await fetch(fixture.base + '/state')).json()).drafts).toHaveLength(0);
    const premature = await mcp.call('browser_run', { ...plan, run_id: fill.run_id, milestone_index: 1 });
    expect(premature.host_review.review_id).toBe(fill.host_review.review_id);
    const receipt = await mcp.call('browser_review', { tab_id: mcp.id, review_id: fill.host_review.review_id, decision: 'accept', goal_evidence: 'Independent DOM read confirms both synthetic values', criteria_evidence: ['Name and notes equal the supplied values'], constraints_evidence: 'No save or publish request in independent fixture state' });
    expect(receipt.status).toBe('milestone_accepted');
    const saved = await mcp.call('browser_run', { ...plan, run_id: fill.run_id, milestone_index: 1 });
    expect(saved.status).toBe('host_review_required');
    await expect(page.locator('#status')).toHaveText('Draft saved: DRAFT-42');
    const state = await (await fetch(fixture.base + '/state')).json();
    expect(state.drafts).toEqual([{ name: 'Jev synthetic', notes: 'Fixture only' }]);
    expect(state.publications).toBe(0);
    const final = await mcp.call('browser_review', { tab_id: mcp.id, review_id: saved.host_review.review_id, decision: 'accept', goal_evidence: 'Independent state endpoint contains exactly one matching draft and DOM shows DRAFT-42', criteria_evidence: ['Draft saved DRAFT-42 confirmed'], constraints_evidence: 'Zero publications in independent state' });
    expect(final.status).toBe('completed_host_verified');
    expect(await mcp.runtime.journal.pending(mcp.id)).toHaveLength(0);
    expect(saved.actions.find((a) => a.action === 'click').dispatch_state).toBe('dispatched_ack');
  } finally { await mcp.close(); await fixture.close(); }
});

test('lost Save ACK persists across driver/runtime restart and new run ID without a duplicate write', async ({ page }, testInfo) => {
  const fixture = await startFixtureServer();
  await page.goto(fixture.base + '/draft');
  const decider = scriptedDecider([(state) => decision({ tool: 'click', target: lookup(state, 'Save draft'), side_effect: 0.8 })]);
  const mcp = await mcpFixture(page, testInfo, decider, { driver: { sessionId: 'ack-loss-fixture' } });
  const perform = mcp.driver.perform.bind(mcp.driver);
  mcp.driver.perform = async (...args) => {
    const result = await perform(...args);
    return args[1].tool === 'click' && result.state === 'dispatched_ack' ? { state: 'dispatched_unknown', error: 'Injected lost Save acknowledgement' } : result;
  };
  try {
    const result = await mcp.call('browser_run', { goal: 'Save synthetic draft', tab_id: mcp.id, verification_mode: 'host', assertions: [{ type: 'text_contains', value: 'A deliberately absent independent receipt' }], max_actions: 2, evidence_level: 'none' });
    expect(result.status).not.toMatch(/^completed/);
    expect(await mcp.runtime.journal.pending(mcp.id)).toHaveLength(1);
    expect((await (await fetch(fixture.base + '/state')).json()).drafts).toHaveLength(1);
    await mcp.driver.close();
    const driver = new PlaywrightDriver({ context: page.context(), sessionId: 'ack-loss-fixture', timeoutMs: 800 });
    const restarted = new JevSteerRuntime({ driver, decider, journal: new ActionJournal({ dir: mcp.runtime.journal.dir }), observation: { maxMs: 0, quietMs: 0 } });
    restarted.settle = async () => 0;
    try {
      const retry = await restarted.run('Save synthetic draft', { tabId: mcp.id, runId: 'new-run-after-restart', verificationMode: 'host', assertions: [{ type: 'text_contains', value: 'Missing receipt' }], evidenceLevel: 'none', maxActions: 1 });
      expect(retry.status).not.toMatch(/^completed/);
      expect((await (await fetch(fixture.base + '/state')).json()).drafts).toHaveLength(1);
      expect(await restarted.journal.pending(mcp.id)).toHaveLength(1);
    } finally { await restarted.close(); }
  } finally { await mcp.close(); await fixture.close(); }
});

test('replacement pages cannot bypass an unknown session write but can show what it did, and old records remain resolvable', async ({ page }, testInfo) => {
  await page.setContent('<button>Save</button>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]), { driver: { sessionId: 'replacement-fixture' } });
  try {
    const snapshot = await mcp.driver.observe(mcp.id);
    const record = await mcp.runtime.journal.begin(mcp.id, { runId: 'previous', milestoneId: 'save', action: { tool: 'click', el: snapshot.elements[0] }, page: snapshot, remoteRisk: 0.9 });
    const replacement = await page.context().newPage();
    const newRef = (await mcp.driver.pages()).find((p) => p.pageId !== mcp.id);
    await expect(mcp.call('browser_run', { tab_id: newRef.pageId, goal: 'Continue with another run', evidence_level: 'none' })).rejects.toThrow(/UNCONFIRMED_SESSION_ACTION/);
    await page.close();
    // Opening a page sends it no input: a new tab is where the host checks the site.
    const check = await mcp.call('browser_open', { url: 'about:blank' });
    expect(check.url).toBe('about:blank');
    // Input there is still blocked. After the page is gone the error still names its tab_id, action_id and the way out.
    await expect(mcp.call('browser_run', { tab_id: check.tab_id, goal: 'Continue with another run', evidence_level: 'none' })).rejects.toThrow(`click on tab_id ${mcp.id} (action_id ${record.id}, ${record.created_at}). Inspect what it did on the site (browser_snapshot works, and browser_open opens about:blank or the address that input was chosen on in a new tab), then call browser_resolve_action with that tab_id and action_id, even if that page was closed.`);
    const resolution = await mcp.call('browser_resolve_action', { tab_id: mcp.id, action_id: record.id, resolution: 'not_applied', evidence: 'Independent fixture oracle confirms no request reached the server' });
    expect(resolution.resolution).toBe('not_applied');
    await replacement.close();
  } finally { await mcp.close(); }
});

test('a run clicks either of two same-address links; two buttons nothing tells apart stop it as ambiguous with no input, not as a page error', async ({ page }, testInfo) => {
  const pager = '<div>(<a href="/list?limit=20">20</a> | <a href="/list?limit=100">100</a>)</div>';
  await page.route('https://fixture.invalid/**', (route) => {
    const limit = new URL(route.request().url()).searchParams.get('limit');
    route.fulfill({ contentType: 'text/html', body: limit ? `<h1>Showing ${limit} results</h1>` : `<h1>Results</h1>${pager}<ul><li>One</li></ul>${pager}<div><button onclick="window.loads=(window.loads||0)+1;window.which=1">Load</button></div><div><button onclick="window.loads=(window.loads||0)+1;window.which=2">Load</button></div>` });
  });
  await page.goto('https://fixture.invalid/list');
  const second = (name) => (state) => decision({ target: state.page.elements.filter((e) => e.label === name).at(-1)?.i });
  const links = await mcpFixture(page, testInfo, scriptedDecider([second('100'), { tool: 'none', done: 0.99 }]));
  try {
    const result = await links.call('browser_run', { tab_id: links.id, goal: 'Show 100 results', max_actions: 4, evidence_level: 'none' });
    expect(result.status).toBe('completed_verified');
    expect(page.url()).toContain('limit=100');
  } finally { await links.close(); }
  // Nothing observed tells the two buttons apart, and their order cannot: a
  // page can swap equal nodes unseen. The choice is refused with no input,
  // Jev looks once more, and the run stops as ambiguous.
  await page.goto('https://fixture.invalid/list');
  const buttons = await mcpFixture(page, testInfo, scriptedDecider([second('Load')]));
  try {
    const result = await buttons.call('browser_run', { tab_id: buttons.id, goal: 'Load more results', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('ambiguous');
    expect(result.actions.filter((a) => a.recovery === 'reobserve')).toEqual([{ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: ambiguous: 2 identical controls' }]);
    expect(await page.evaluate(() => window.loads)).toBeUndefined();
  } finally { await buttons.close(); }
  // A list that grows after each choice. After a refusal Jev reads the history as an error; no input was sent.
  await page.goto('https://fixture.invalid/list');
  const grow = (pick) => async (state) => { await page.evaluate(() => document.querySelector('ul').append(Object.assign(document.createElement('li'), { textContent: 'More' }))); return pick(state); };
  const growing = await mcpFixture(page, testInfo, scriptedDecider([grow(second('Load')), grow((state) => decision({ target: state.page.elements.filter((e) => e.label === 'Load')[0].i, error: 0.9 })), grow(second('Load'))]));
  try {
    const result = await growing.call('browser_run', { tab_id: growing.id, goal: 'Load more results', max_actions: 6, evidence_level: 'none' });
    expect(result.status).toBe('ambiguous');
    expect(result.info).toContain('identical controls');
    expect(result.actions.filter((a) => a.recovery === 'reobserve')).toEqual([{ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: ambiguous: 2 identical controls' }]);
    expect(await page.evaluate(() => window.loads)).toBeUndefined();
  } finally { await growing.close(); }
});

// Two unnamed filter selects that only their placeholders tell apart, as on
// ccMonet's bills list. The page swaps them while Jev decides. The click
// still goes to the one Jev chose: it is found by what it shows, not by its
// place.
const filterSelect = (hint) => `<div class="ant-select" style="position:relative;display:inline-block;width:200px;height:28px;border:1px solid #ccc">
  <span class="ant-select-selection-search"><input class="ant-select-selection-search-input" role="combobox" type="search" aria-expanded="false" autocomplete="off" value="" style="width:100%;height:26px;border:0" onclick="window.clicked=(window.clicked||[]).concat('${hint}')"></span>
  <span class="ant-select-selection-placeholder" style="position:absolute;left:6px;top:5px;pointer-events:none">${hint}</span></div>`;

test('identical selects told apart by their placeholders are found by them after the page swaps them', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Bills</h1><div id="filters">${filterSelect('Status')}${filterSelect('Vendor')}</div>`);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    async (state) => {
      const vendor = state.page.elements.find((e) => e.hint === 'Vendor');
      seen.twins = state.page.elements.filter((e) => e.role === 'combobox').map((e) => [e.label ?? '', e.hint]);
      await page.evaluate(() => { const filters = document.querySelector('#filters'); filters.prepend(filters.lastElementChild); });
      return decision({ tool: 'click', target: vendor.i });
    },
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Open the Vendor filter', verification_mode: 'host', max_actions: 2, evidence_level: 'none' });
    expect(seen.twins).toEqual([['', 'Status'], ['', 'Vendor']]);
    expect(result.actions.filter((a) => a.recovery)).toEqual([]);
    expect(await page.evaluate(() => window.clicked)).toEqual(['Vendor']);
  } finally { await mcp.close(); }
});

// While a write has no confirmed outcome, browser_open opens a blank tab or
// the address the write was chosen on, which shows the site's state without
// asking it for anything new. Any other address, or the page the write was
// sent on, is refused before a request is made.
test('while a write is unconfirmed, a new tab opens only a blank page or the address it was chosen on', async ({ page }, testInfo) => {
  const visits = [];
  await page.context().route('https://fixture.invalid/**', (route) => {
    visits.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'text/html', body: '<h1>Invoices</h1><button>Save</button>' });
  });
  await page.goto('https://fixture.invalid/invoices?status=draft');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]), { driver: { sessionId: 'open-barrier-fixture' } });
  try {
    const snapshot = await mcp.driver.observe(mcp.id);
    const record = await mcp.runtime.journal.begin(mcp.id, { runId: 'previous', milestoneId: 'save', action: { tool: 'click', el: snapshot.elements.find((e) => e.label === 'Save') }, page: snapshot, remoteRisk: 0.9 });
    visits.length = 0;
    const tabs = page.context().pages().length;
    await expect(mcp.call('browser_open', { url: 'https://fixture.invalid/logout' })).rejects.toThrow('UNCONFIRMED_SESSION_ACTION: earlier input in this browser session has no confirmed outcome, so browser_open opens only about:blank or the address that input was chosen on, not https://fixture.invalid/logout');
    await expect(mcp.call('browser_open', { url: 'https://fixture.invalid/invoices?status=draft', tab_id: mcp.id, new_tab: false })).rejects.toThrow('UNCONFIRMED_SESSION_ACTION: input on this page has no confirmed outcome, so it is not navigated');
    expect(visits).toEqual([]);
    expect(page.context().pages()).toHaveLength(tabs);
    const check = await mcp.call('browser_open', { url: 'https://fixture.invalid/invoices?status=draft' });
    expect(check.url).toBe('https://fixture.invalid/invoices?status=draft');
    expect(visits).toEqual(['/invoices']);
    expect((await mcp.call('browser_open', { url: 'about:blank' })).url).toBe('about:blank');
    // Input on the new tab stays blocked until the write is resolved.
    await expect(mcp.call('browser_run', { tab_id: check.tab_id, goal: 'Continue', evidence_level: 'none' })).rejects.toThrow(/UNCONFIRMED_SESSION_ACTION/);
    await mcp.call('browser_resolve_action', { tab_id: mcp.id, action_id: record.id, resolution: 'not_applied', evidence: 'The invoice list in a new tab shows no new draft' });
    expect((await mcp.call('browser_open', { url: 'https://fixture.invalid/logout' })).url).toBe('https://fixture.invalid/logout');
  } finally { await mcp.close(); }
});

// Escape on no element is journaled like any input. When the page sent
// nothing after it and stayed on its document, it is resolved from that.
test('Escape pressed on no element is resolved from what the page did, so it does not block the next tab; Enter is not', async ({ page }, testInfo) => {
  await page.setContent('<form><label>Search <input name="q"></label></form><div role="menu"><div role="menuitem">Export</div></div>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]), { driver: { sessionId: 'escape-fixture' } });
  try {
    const escape = await mcp.call('browser_act', { tab_id: mcp.id, action: 'press_key', key: 'Escape' });
    expect(escape).toMatchObject({ status: 'completed', resolution: 'applied' });
    expect(await mcp.runtime.journal.pending(mcp.id)).toEqual([]);
    expect((await mcp.runtime.journal.load(mcp.id)).find((r) => r.id === escape.action_id)).toMatchObject({ state: 'resolved', resolution: 'applied', replay_protected: false });
    const other = await mcp.call('browser_open', { url: 'about:blank' });
    expect(other.tab_id).toBeTruthy();
    expect((await mcp.call('browser_act', { tab_id: mcp.id, action: 'press_key', key: 'Enter' })).status).toBe('action_unconfirmed');
    const next = await mcp.call('browser_open', { url: 'about:blank' });
    await expect(mcp.call('browser_act', { tab_id: next.tab_id, action: 'press_key', key: 'Escape' })).rejects.toThrow(/UNCONFIRMED_SESSION_ACTION/);
  } finally { await mcp.close(); }
});

// A page can answer Escape itself: an autosave, now or a moment later, a
// beacon, or a WebSocket message. Then the key's outcome is the host's to
// resolve, as for any input. The page comes from the same loopback server as
// its socket: Chromium blocks a public page's connections to loopback (local
// network access), and newer versions block its WebSockets too.
async function draftServer(answer) {
  let saves = 0;
  const server = createServer((req, res) => {
    if (req.url === '/autosave') { saves++; res.writeHead(204); return res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(`<h1>Draft</h1><script>const socket = new WebSocket('ws://' + location.host + '/live');
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ${answer}; });</script>`);
  });
  const sockets = new Set();
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => { saves++; });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/draft`,
    saves: () => saves,
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); server.close(resolve); }),
  };
}

for (const [what, send] of [
  ['a request', "fetch('/autosave', { method: 'POST', body: 'draft' })"],
  ['a request a moment later', "setTimeout(() => fetch('/autosave', { method: 'POST', body: 'draft' }), 400)"],
  ['a beacon', "navigator.sendBeacon('/autosave', 'draft')"],
  ['a WebSocket message', "socket.send('cancel draft')"],
]) {
  test(`an Escape the page answers with ${what} stays unconfirmed and blocks input on other tabs`, async ({ page }, testInfo) => {
    const draft = await draftServer(send);
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]), { driver: { sessionId: 'escape-answered-fixture' } });
    try {
      // JevSteer watches a page's traffic from its first use of the page. It
      // sees messages on a socket the page opened after that.
      await mcp.driver.observe(mcp.id);
      await page.goto(draft.url);
      await page.waitForFunction(() => socket.readyState !== WebSocket.CONNECTING);
      expect(await page.evaluate(() => socket.readyState)).toBe(1);
      const escape = await mcp.call('browser_act', { tab_id: mcp.id, action: 'press_key', key: 'Escape' });
      expect(escape.status).toBe('action_unconfirmed');
      expect((await mcp.runtime.journal.pending(mcp.id)).map((r) => r.id)).toEqual([escape.action_id]);
      await expect.poll(draft.saves).toBeGreaterThan(0);
      const next = await mcp.call('browser_open', { url: 'about:blank' });
      await expect(mcp.call('browser_act', { tab_id: next.tab_id, action: 'press_key', key: 'Escape' })).rejects.toThrow(/UNCONFIRMED_SESSION_ACTION/);
    } finally { await mcp.close(); await draft.close(); }
  });
}
