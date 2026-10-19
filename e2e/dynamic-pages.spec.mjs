// Real Chromium pages that rewrite text around a field while the user types:
// live previews, counters, row totals and repeated row labels. Decisions are
// deterministic test doubles; the checks are on the runtime's own handling.
import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const lookup = (state, label, record) => state.page.elements.find((e) => e.label === label && (!record || e.record_key === record))?.i;

test('a field whose neighboring text changes on input is confirmed and not offered for TYPE again', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Customer CUS-1067</h1><form id="customer">
    <div><label for="credit">Credit limit</label><input id="credit" name="credit"><span id="preview">Formatted: $0</span></div>
    <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea><span id="count">0/500</span></div>
  </form><script>
    credit.addEventListener('input', () => { preview.textContent = 'Formatted: $' + Number(credit.value || 0).toLocaleString('en-US'); });
    notes.addEventListener('input', () => { count.textContent = notes.value.length + '/500'; });
  </script>`);
  let typeTargets;
  let creditIndex;
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: lookup(state, 'Credit limit') }),
    (state, questions) => {
      creditIndex = String(lookup(state, 'Credit limit'));
      typeTargets = Object.keys(questions.type_target?.criteria || {});
      return decision({ tool: 'type', target: lookup(state, 'Notes') });
    },
  ]));
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Set the credit limit and a review note', values: { credit: '7500', notes: 'Reviewed' },
      assertions: [{ type: 'field_equals', label: 'Credit limit', value: '7500' }, { type: 'field_equals', label: 'Notes', value: 'Reviewed' }],
      verification_mode: 'host', max_actions: 4, evidence_level: 'none',
    });
    expect(result.status).toBe('host_review_required');
    expect(result.actions.map((a) => [a.action, a.effect?.status])).toEqual([['type', 'confirmed'], ['type', 'confirmed']]);
    expect(typeTargets).not.toContain(creditIndex);
    await expect(page.locator('#preview')).toHaveText('Formatted: $7,500');
    await expect(page.locator('#count')).toHaveText('8/500');
  } finally { await mcp.close(); }
});

const invoiceRows = `<h1>New invoice</h1><form id="invoice"><table>
  <tr><th>Description</th><th>Line total</th></tr>
  ${[1, 2].map((n) => `<tr data-row-key="line-${n}"><td><input aria-label="Description" name="desc"></td><td><input aria-label="Quantity" name="qty" value="1"></td><td class="total">0.00</td></tr>`).join('')}
</table></form>`;

test('repeated row fields are bound and described by their own record', async ({ page }, testInfo) => {
  await page.setContent(invoiceRows);
  const seen = { fields: [], candidates: [], history: [] };
  const steps = scriptedDecider([
    (state, questions) => {
      seen.candidates.push(questions.type_target.criteria[String(lookup(state, 'Description', 'line-2'))]);
      return decision({ tool: 'type', target: lookup(state, 'Description', 'line-2') });
    },
    (state) => {
      seen.history.push(state.task.history.map((h) => [h.action, h.value, h.record]));
      return decision({ tool: 'type', target: lookup(state, 'Description', 'line-1') });
    },
    { tool: 'none', done: 0.99 },
  ]);
  const decider = async (state, questions) => {
    if (!questions.selected_value) return steps(state, questions);
    seen.fields.push(state.selected_field);
    const key = { 'line-1': 'desc_1', 'line-2': 'desc_2' }[state.selected_field.record] || '__none__';
    return { answers: { selected_value: { choice: key, probabilities: { [key]: 0.95 } } }, ms: 1, tokens: 1 };
  };
  const mcp = await mcpFixture(page, testInfo, decider);
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Describe both invoice lines', values: { desc_1: 'Consulting', desc_2: 'Travel' },
      verification_mode: 'host', max_actions: 4, evidence_level: 'none',
    });
    expect(result.status).toBe('host_review_required');
    expect(seen.fields.map((f) => [f.label, f.record, f.form])).toEqual([['Description', 'line-2', 'invoice'], ['Description', 'line-1', 'invoice']]);
    expect(seen.candidates[0].record).toBe('line-2');
    expect(seen.history[0]).toEqual([['type', 'desc_2', 'line-2']]);
    await expect(page.locator('[data-row-key=line-1] [name=desc]')).toHaveValue('Consulting');
    await expect(page.locator('[data-row-key=line-2] [name=desc]')).toHaveValue('Travel');
  } finally { await mcp.close(); }
});

test('form mode keeps its bindings when a live row total rewrites the row text', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Unsaved invoice line</h1><form id="invoice"><table><tr data-row-key="line-1">
    <td><label>Quantity<input name="qty"></label></td><td><label>Unit price<input name="price"></label></td>
    <td class="total">Line total: 0.00</td><td class="state"></td></tr></table></form><script>
    const row = document.querySelector('[data-row-key=line-1]');
    row.addEventListener('input', () => {
      row.querySelector('.state').textContent = 'Unsaved changes';
      row.querySelector('.total').textContent = 'Line total: ' + (Number(row.querySelector('[name=qty]').value || 0) * Number(row.querySelector('[name=price]').value || 0)).toFixed(2);
    });
  </script>`);
  const values = { qty: '3', price: '12.50' };
  const decider = async (state, questions) => {
    const answers = {};
    for (const [key, question] of Object.entries(questions)) {
      if (['remote_input_risk', 'irreversible_risk', 'blocked', 'login', 'needs_vision', 'constraint_risk'].includes(key)) answers[key] = { noul: 0.01 };
      else if (key.startsWith('field_')) {
        const target = state.page.elements.find((e) => e.name === Object.keys(values)[Number(key.slice(6))]);
        answers[key] = { choice: String(target.i), probabilities: Object.fromEntries(Object.keys(question.criteria).map((id) => [id, id === String(target.i) ? 0.99 : 0.001])) };
      }
    }
    return { answers, ms: 1, tokens: 1 };
  };
  const mcp = await mcpFixture(page, testInfo, decider);
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Fill the unsaved line quantity and unit price', values, execution_mode: 'form',
      verification_mode: 'host', max_actions: 4, evidence_level: 'none',
    });
    expect(result.status).toBe('host_review_required');
    expect(result.jev_calls).toBe(1);
    await expect(page.locator('.total')).toHaveText('Line total: 37.50');
    await expect(page.locator('[name=qty]')).toHaveValue('3');
    await expect(page.locator('[name=price]')).toHaveValue('12.50');
  } finally { await mcp.close(); }
});
