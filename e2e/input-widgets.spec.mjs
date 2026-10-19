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

// antd 5's Select in a Drawer, as on ccMonet's invoice form. The options
// render in a portal at the end of <body>. rc-select draws each visible
// option as a div with aria-selected and no role, and keeps role=option
// copies in a 0×0 listbox for screen readers; a click on those times out.
const drawerSelect = `<style>
    .ant-select { position: relative; width: 240px; height: 28px; border: 1px solid #ccc; }
    .ant-select-selection-search-input { width: 100%; height: 26px; border: 0; }
    .ant-select-selection-placeholder, .ant-select-selection-item { position: absolute; left: 6px; top: 5px; pointer-events: none; }
    .ant-select-dropdown { position: absolute; top: 40px; left: 420px; width: 240px; background: #fff; border: 1px solid #ccc; z-index: 1050; }
    .ant-select-dropdown-hidden { display: none; }
    .ant-select-item-option { padding: 5px 12px; cursor: pointer; }
  </style>
  <h1>Sales invoices</h1><button>New invoice</button>
  <div class="ant-drawer-content" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div id="drawer-title">New invoice</div>
    <div class="ant-col"><div>Customer</div>
      <div class="ant-select ant-select-single ant-select-show-search"><div class="ant-select-selector">
        <span class="ant-select-selection-search"><input id="rc_select_1" class="ant-select-selection-search-input" role="combobox" type="search" aria-expanded="false" aria-haspopup="listbox" aria-owns="rc_select_1_list" aria-autocomplete="list" aria-controls="rc_select_1_list" autocomplete="off" value=""></span>
        <span class="ant-select-selection-placeholder">Select a customer</span>
      </div></div>
    </div>
    <label>Reference <input name="reference"></label>
    <button>Save as Draft</button>
  </div>
  <div style="position: absolute; top: 0; left: 0; width: 100%;"><div>
    <div class="ant-select-dropdown ant-select-dropdown-hidden"><div>
      <div role="listbox" id="rc_select_1_list" style="height: 0; width: 0; overflow: hidden;">
        <div role="option" id="rc_select_1_list_0" aria-selected="false" aria-label="Acme Ltd">Acme Ltd</div>
        <div role="option" id="rc_select_1_list_1" aria-selected="false" aria-label="Beta LLC">Beta LLC</div>
      </div>
      <div class="rc-virtual-list"><div class="rc-virtual-list-holder"><div class="rc-virtual-list-holder-inner">
        <div aria-selected="false" class="ant-select-item ant-select-item-option" title="Acme Ltd"><div class="ant-select-item-option-content">Acme Ltd</div></div>
        <div aria-selected="false" class="ant-select-item ant-select-item-option" title="Beta LLC"><div class="ant-select-item-option-content">Beta LLC</div></div>
      </div></div></div>
    </div></div>
  </div></div>
  <script>
    const input = document.querySelector('#rc_select_1');
    const dropdown = document.querySelector('.ant-select-dropdown');
    const setOpen = (open) => { dropdown.classList.toggle('ant-select-dropdown-hidden', !open); input.setAttribute('aria-expanded', String(open)); };
    input.addEventListener('mousedown', () => setOpen(true));
    input.addEventListener('input', () => {
      setOpen(true);
      document.querySelector('.ant-select-selection-placeholder')?.style.setProperty('display', input.value ? 'none' : '');
      for (const o of dropdown.querySelectorAll('.ant-select-item-option')) o.style.display = o.title.toLowerCase().includes(input.value.toLowerCase()) ? '' : 'none';
    });
    for (const o of dropdown.querySelectorAll('.ant-select-item-option')) o.addEventListener('click', () => {
      input.value = '';
      document.querySelector('.ant-select-selection-placeholder')?.remove();
      document.querySelector('.ant-select-selection-item')?.remove();
      input.parentElement.after(Object.assign(document.createElement('span'), { className: 'ant-select-selection-item', title: o.title, textContent: o.title }));
      o.setAttribute('aria-selected', 'true');
      setOpen(false);
    });
  </script>`;

// Without the listbox link (no aria-controls), the open list still belongs to
// the drawer while its combobox is open.
const unlinked = drawerSelect.replace(/ aria-owns="rc_select_1_list"| aria-controls="rc_select_1_list"| id="rc_select_1_list"/g, '');
for (const [variant, html] of [['', drawerSelect], [' (no listbox link)', unlinked]]) {
  test(`an antd select in a drawer: type to search, then click the visible option; the field is not typed again${variant}`, async ({ page }, testInfo) => {
    await page.setContent(html);
    const seen = {};
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      (state) => decision({ tool: 'type', target: pick((e) => e.label === 'Customer')(state) }),
      (state, questions) => {
        seen.open = { tools: Object.keys(questions.tool.criteria), elements: state.page.elements.map((e) => [e.role, e.label]) };
        return decision({ tool: 'click', target: pick((e) => e.role === 'option' && e.label === 'Acme Ltd')(state) });
      },
      (state, questions) => {
        seen.picked = { customer: state.page.elements.find((e) => e.label === 'Customer'), typable: Object.values(questions.type_target?.criteria || {}).map((c) => c.control) };
        return decision({ tool: 'none', done: 0.99 });
      },
    ]));
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Choose customer Acme Ltd on the new invoice', values: { customer: 'Acme' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
      expect(result.status).toBe('host_review_required');
      // The open list's visible option is observed, though it is drawn outside
      // the drawer. The hidden listbox and its copies are not, nor is the page
      // behind the drawer. SELECT on the open combobox would only close it.
      expect(seen.open.elements).toEqual([['combobox', 'Customer'], ['textbox', 'Reference'], ['button', 'Save as Draft'], ['option', 'Acme Ltd']]);
      expect(seen.open.tools).not.toContain('select');
      expect(result.actions.map((a) => [a.action, a.effect?.status])).toEqual([['type', 'confirmed'], ['click', 'changed']]);
      await expect(page.locator('.ant-select-selection-item')).toHaveText('Acme Ltd');
      // The search text cleared when the option was picked. The field shows
      // the option, so it is not offered for TYPE again.
      expect(seen.picked.customer).toMatchObject({ value: '', display: 'Acme Ltd' });
      expect(seen.picked.typable).toEqual(['[1] textbox "Reference"']);
    } finally { await mcp.close(); }
  });
}
