import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { jev } from '../src/jev.mjs';

const values = { company: 'Jev Fixture', contact: 'Test Contact', city: 'Oslo', reference: 'SYN-2026', notes: 'Synthetic only', region: 'south' };
const labels = ['Company', 'Contact', 'City', 'Reference', 'Notes', 'Region'];
const form = `<h1>Unsaved company draft</h1><form id="company-form">${labels.slice(0, 5).map((name, i) => `<label>${name}<input name="${Object.keys(values)[i]}"></label>`).join('')}<label>Region<select name="region"><option value="">Choose</option><option value="north">North</option><option value="south">South</option></select></label><button type="button" onclick="window.saved=(window.saved||0)+1">Save</button></form>`;
const assertions = labels.map((label, i) => ({ type: 'field_equals', label, value: Object.values(values)[i] }));
const contract = { goal: 'Fill all six supplied company draft fields and leave the form unsaved', values, verification_mode: 'host', constraints: ['Do not save or submit'], guidance: ['This synthetic fixture has six independent unsaved fields. Typing and native selection never send requests or autosave; only the separate Save button changes the save counter.'], assertions, success_criteria: ['All six fields exactly match their supplied values'], max_actions: 8, evidence_level: 'none' };

const bindingDouble = ({ collision = false, swap = false, safety = 0.99 } = {}) => async (state, questions) => {
  const answers = {};
  for (const [key, question] of Object.entries(questions)) {
    if (['remote_input_risk','irreversible_risk'].includes(key)) answers[key] = { noul: 1-safety };
    else if (['blocked','login','needs_vision','constraint_risk'].includes(key)) answers[key] = { noul: 0.01 };
    else {
      let index = Number(key.slice(6));
      if (swap && index < 2) index = 1-index;
      const target = collision ? state.page.elements[0] : state.page.elements.find((e) => e.name === Object.keys(values)[index]);
      const choice = String(target.i);
      answers[key] = { choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map((id) => [id, id === choice ? 0.99 : 0.001])) };
    }
  }
  return { answers, ms: 1, tokens: 10 };
};

async function accept(mcp, result) {
  return mcp.call('browser_review', { tab_id: mcp.id, review_id: result.host_review.review_id, decision: 'accept', goal_evidence: 'Independent FormData read matches all six supplied synthetic values', criteria_evidence: ['All exact fields confirmed'], constraints_evidence: 'Save counter is zero' });
}

test('one batch binding fills six fields through MCP with exact readback and no Save', async ({ page }, testInfo) => {
  await page.setContent(form);
  const mcp = await mcpFixture(page, testInfo, bindingDouble());
  try {
    const result = await mcp.call('browser_run', { ...contract, tab_id: mcp.id, execution_mode: 'form' });
    expect(result.status).toBe('host_review_required');
    expect(result.jev_calls).toBe(1);
    expect(await page.locator('form').evaluate((e) => Object.fromEntries(new FormData(e)))).toEqual(values);
    expect(await page.evaluate(() => window.saved || 0)).toBe(0);
    expect((await accept(mcp, result)).status).toBe('completed_host_verified');
  } finally { await mcp.close(); }
});

test('colliding bindings and uncertain local input safety reject before any field input', async ({ page }, testInfo) => {
  for (const scenario of [{ collision: true }, { swap: true }, { safety: 0.5 }]) {
    await page.setContent(form);
    const mcp = await mcpFixture(page, testInfo, bindingDouble(scenario));
    try {
      const result = await mcp.call('browser_run', { ...contract, tab_id: mcp.id, execution_mode: 'form' });
      expect(result.status).toBe('needs_guidance');
      expect(await page.locator('input[name=company]').inputValue()).toBe('');
      expect(await mcp.runtime.journal.pending(mcp.id)).toHaveLength(0);
    } finally { await mcp.close(); }
  }
});

test('bindings spanning different form owners fail before input', async ({ page }, testInfo) => {
  await page.setContent(form + '<form id="different-record"></form>');
  await page.locator('[name=city]').evaluate((e) => document.querySelector('#different-record').append(e.parentElement));
  const mcp = await mcpFixture(page, testInfo, bindingDouble());
  try {
    const result = await mcp.call('browser_run', { ...contract, tab_id: mcp.id, execution_mode: 'form' });
    expect(result.status).toBe('needs_guidance');
    expect(result.info).toContain('one observed form');
    await expect(page.locator('[name=company]')).toHaveValue('');
  } finally { await mcp.close(); }
});

test('a dependent field reset stops the batch before later input or Save', async ({ page }, testInfo) => {
  await page.setContent(form + `<script>document.querySelector('[name=contact]').addEventListener('input',()=>{document.querySelector('[name=company]').value='';});</script>`);
  const mcp = await mcpFixture(page, testInfo, bindingDouble());
  try {
    const result = await mcp.call('browser_run', { ...contract, tab_id: mcp.id, execution_mode: 'form' });
    expect(result.status).toBe('needs_guidance');
    expect(result.info).toContain('dependency');
    expect(await page.locator('[name=city]').inputValue()).toBe('');
    expect(await page.evaluate(() => window.saved || 0)).toBe(0);
  } finally { await mcp.close(); }
});

test('live Jev six-field comparison: explore versus one batch frontier, same contract and oracle', async ({ page }, testInfo) => {
  test.skip(!process.env.TYPESAFE_API_KEY && !process.env.OPENROUTER_API_KEY, 'Live Jev comparison requires a provider key.');
  test.setTimeout(180000);
  const results = [];
  for (const execution_mode of ['explore', 'form']) {
    await page.setContent(form);
    const mcp = await mcpFixture(page, testInfo, jev);
    try {
      const started = performance.now();
      const result = await mcp.call('browser_run', { ...contract, tab_id: mcp.id, execution_mode });
      expect(result.status, `${execution_mode}: ${result.info || ''}`).toBe('host_review_required');
      expect(await page.locator('form').evaluate((e) => Object.fromEntries(new FormData(e)))).toEqual(values);
      expect(await page.evaluate(() => window.saved || 0)).toBe(0);
      expect((await accept(mcp, result)).status).toBe('completed_host_verified');
      results.push({ execution_mode, jev_calls: result.jev_calls, jev_input_tokens: result.jev_input_tokens, executor_ms: result.ms, wall_ms: Math.round(performance.now() - started), outcome: 'completed_host_verified' });
    } finally { await mcp.close(); }
  }
  const reduction = 1 - results[1].jev_calls / results[0].jev_calls;
  expect(reduction).toBeGreaterThanOrEqual(0.3);
  await testInfo.attach('form-comparison', { body: JSON.stringify({ results, logical_call_reduction: reduction, provenance: 'live Jev, real Chromium, MCP, independent synthetic FormData oracle; no ccMonet or external Host model' }), contentType: 'application/json' });
});
