import { test, expect } from '@playwright/test';
import { startFixtureServer } from '../test/helpers/fixture-server.mjs';
import { jev } from '../src/jev.mjs';
import { mcpFixture } from './helpers.mjs';

test('live Jev executes a synthetic UI milestone through MCP and independent oracle', async ({ page }, testInfo) => {
  test.skip(!process.env.TYPESAFE_API_KEY && !process.env.OPENROUTER_API_KEY, 'Live Jev requires a provider key; synthetic decision tests are reported separately.');
  test.setTimeout(180000);
  const fixture = await startFixtureServer();
  await page.goto(fixture.base + '/draft');
  const mcp = await mcpFixture(page, testInfo, jev);
  try {
    const result = await mcp.call('browser_run', {
      goal: 'Fill the record name and notes with the supplied synthetic values. Leave the draft unsaved.',
      tab_id: mcp.id, values: { name: 'Jev live fixture', notes: 'Synthetic data only' },
      verification_mode: 'host', constraints: ['Do not save, publish or leave the editor'],
      success_criteria: ['Record name and Notes equal the supplied values'],
      assertions: [{ type: 'field_equals', label: 'Record name', value: 'Jev live fixture' }, { type: 'field_equals', label: 'Notes', value: 'Synthetic data only' }],
      max_actions: 5, evidence_level: 'summary',
    });
    expect(result.status).toBe('host_review_required');
    await expect(page.locator('#name')).toHaveValue('Jev live fixture');
    await expect(page.locator('#notes')).toHaveValue('Synthetic data only');
    expect((await (await fetch(fixture.base + '/state')).json()).drafts).toHaveLength(0);
    const receipt = await mcp.call('browser_review', { tab_id: mcp.id, review_id: result.host_review.review_id, decision: 'accept', goal_evidence: 'Independent DOM values match', criteria_evidence: ['Both exact field values observed'], constraints_evidence: 'Independent state has zero drafts and zero publications' });
    expect(receipt.status).toBe('completed_host_verified');
    const saved = await mcp.call('browser_run', {
      goal: 'Save this synthetic draft once and stay in the draft editor', tab_id: mcp.id,
      verification_mode: 'host', constraints: ['Do not publish or leave the editor'],
      success_criteria: ['Saved draft has business ID DRAFT-42'],
      assertions: [{ type: 'text_contains', value: 'Draft saved: DRAFT-42' }],
      max_actions: 3, evidence_level: 'summary',
    });
    expect(saved.status).toBe('host_review_required');
    await expect(page.locator('#status')).toHaveText('Draft saved: DRAFT-42');
    const state = await (await fetch(fixture.base + '/state')).json();
    expect(state.drafts).toEqual([{ name: 'Jev live fixture', notes: 'Synthetic data only' }]);
    expect(state.publications).toBe(0);
    const accepted = await mcp.call('browser_review', { tab_id: mcp.id, review_id: saved.host_review.review_id, decision: 'accept', goal_evidence: 'Independent fixture state contains one matching draft; DOM shows DRAFT-42', criteria_evidence: ['Business ID DRAFT-42 and exact draft fields confirmed'], constraints_evidence: 'Zero publication requests; still in editor' });
    expect(accepted.status).toBe('completed_host_verified');
    await testInfo.attach('jev-usage', { body: JSON.stringify([result, saved].map((r) => ({ jev_calls: r.jev_calls, jev_input_tokens: r.jev_input_tokens, ms: r.ms, outcome: r.status }))), contentType: 'application/json' });
  } finally { await mcp.close(); await fixture.close(); }
});
