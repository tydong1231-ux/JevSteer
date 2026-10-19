// Input widgets that keep their own copy of a field's value. The date picker
// below follows bootstrap-datepicker 1.9 (Selenium's web form): it parses the
// field on keyup and, on blur, writes its own parsed value back.
import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const pick = (match) => (state) => state.page.elements.find(match)?.i;

test('fast input reaches key listeners: a date picker keeps the typed date after blur', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Web form</h1><form>
    <label>Date picker <input name="my-date"></label><label>Text input <input name="my-text"></label>
  </form><script>
    const date = document.querySelector('[name=my-date]');
    let parsed = '';
    date.addEventListener('keyup', (e) => { if (![27, 37, 39, 38, 40, 32, 13, 9].includes(e.keyCode)) parsed = date.value; });
    date.addEventListener('blur', () => { if (date.value) date.value = parsed; });
  </script>`);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: pick((e) => e.name === 'my-date')(state) }),
    (state) => decision({ tool: 'click', target: pick((e) => e.name === 'my-text')(state) }),
    { tool: 'none', done: 0.99 },
  ]), { driver: { inputMode: 'fast' } });
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Set the date picker', values: { 'my-date': '10/20/2026' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(result.actions[0].effect?.status).toBe('confirmed');
    await expect(page.locator('[name=my-date]')).toHaveValue('10/20/2026');
  } finally { await mcp.close(); }
});

test('a confirmed field that is empty again is marked for Jev and named when the run stops', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Checkout</h1><form>
    <label>Promo code <input name="promo"></label><label>Note <input name="note"></label>
  </form><script>document.querySelector('[name=promo]').addEventListener('blur', (e) => { e.target.value = ''; });</script>`);
  let history;
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: pick((e) => e.name === 'promo')(state) }),
    (state) => decision({ tool: 'click', target: pick((e) => e.name === 'note')(state) }),
    (state) => { history = state.task.history; return decision({ tool: 'none', done: 0.01 }); },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Apply the promo code', values: { promo: 'SPRING' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
    expect(history.map((h) => [h.action, h.value_now])).toEqual([['type', 'empty'], ['click', undefined]]);
    expect(result.actions.map((h) => h.value_now)).toEqual([undefined, undefined]);
    expect(result.status).toBe('stuck');
    expect(result.info).toContain('Typed and confirmed earlier in this run, empty now: textbox "Promo code".');
  } finally { await mcp.close(); }
});

// Like antd's RangePicker: the field shows typed text at once, but the
// picker's own value changes a frame after focus leaves the field, so a
// Generate click right after typing reads the old range.
const rangePicker = ({ padded = false } = {}) => `<h1>Profit and Loss</h1>
  <label>Start date <input name="start" value="2026/1/1"></label>
  <label>End date <input name="end" value="2026/10/31"></label>
  <button>Generate</button><h2 id="report">No report</h2>
  <script>
    const range = { start: '2026/1/1', end: '2026/10/31' };
    for (const input of document.querySelectorAll('input')) input.addEventListener('blur', () => requestAnimationFrame(() => {
      const m = input.value.match(/^(\\d{4})\\/(\\d{1,2})\\/(\\d{1,2})$/);
      if (m) range[input.name] = ${padded} ? m[1] + '/' + m[2].padStart(2, '0') + '/' + m[3].padStart(2, '0') : input.value;
      input.value = range[input.name];
    }));
    document.querySelector('button').onclick = () => { document.querySelector('#report').textContent = 'Report ' + range.start + ' - ' + range.end; };
  </script>`;

for (const inputMode of ['fast', 'realistic']) {
  test(`a typed date is committed before the next click (${inputMode} input)`, async ({ page }, testInfo) => {
    await page.setContent(rangePicker());
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      (state) => decision({ tool: 'type', target: pick((e) => e.name === 'end')(state) }),
      (state) => decision({ tool: 'click', target: pick((e) => e.tag === 'button')(state) }),
      { tool: 'none', done: 0.99 },
    ]), { driver: { inputMode } });
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the report through December 31, 2026', values: { end_date: '2026/12/31' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
      expect(result.status).toBe('host_review_required');
      expect(result.actions[0].effect).toMatchObject({ status: 'confirmed', check: 'field_value' });
      await expect(page.locator('#report')).toHaveText('Report 2026/1/1 - 2026/12/31');
    } finally { await mcp.close(); }
  });
}

test('a date the picker rewrites in its own format still counts as typed', async ({ page }, testInfo) => {
  await page.setContent(rangePicker({ padded: true }));
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: pick((e) => e.name === 'end')(state) }),
    { tool: 'none', done: 0.99 },
  ]), { driver: { inputMode: 'fast' } });
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Set the end date to December 1, 2026', values: { end_date: '2026/12/1' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.actions[0].effect).toMatchObject({ status: 'confirmed', check: 'field_value_date' });
    await expect(page.locator('[name=end]')).toHaveValue('2026/12/01');
  } finally { await mcp.close(); }
});
