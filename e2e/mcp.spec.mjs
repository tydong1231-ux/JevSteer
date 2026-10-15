// Actual MCP browser_run/browser_review, real Chromium UI, deterministic
// decision double, independent read-only HTTP/DOM oracle. Live Jev is separate.
import { test, expect } from '@playwright/test';
import { startFixtureServer } from '../test/helpers/fixture-server.mjs';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';
import { JevSteerRuntime } from '../src/runtime.mjs';
import { ActionJournal } from '../src/action-journal.mjs';
import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';

const lookup = (state, name) => state.page.elements.find((e) => e.label === name)?.i;
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

test('replacement pages cannot bypass an unknown session write, and old records remain resolvable', async ({ page }, testInfo) => {
  await page.setContent('<button>Save</button>');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([{ tool: 'none', done: 0.99 }]), { driver: { sessionId: 'replacement-fixture' } });
  try {
    const snapshot = await mcp.driver.observe(mcp.id);
    const record = await mcp.runtime.journal.begin(mcp.id, { runId: 'previous', milestoneId: 'save', action: { tool: 'click', el: snapshot.elements[0] }, page: snapshot, remoteRisk: 0.9 });
    const replacement = await page.context().newPage();
    const newRef = (await mcp.driver.pages()).find((p) => p.pageId !== mcp.id);
    await expect(mcp.call('browser_run', { tab_id: newRef.pageId, goal: 'Continue with another run', evidence_level: 'none' })).rejects.toThrow(/UNCONFIRMED_SESSION_ACTION/);
    await page.close();
    const resolution = await mcp.call('browser_resolve_action', { tab_id: mcp.id, action_id: record.id, resolution: 'not_applied', evidence: 'Independent fixture oracle confirms no request reached the server' });
    expect(resolution.resolution).toBe('not_applied');
    await replacement.close();
  } finally { await mcp.close(); }
});
