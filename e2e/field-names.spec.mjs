// Fields with no accessible name, as on ccMonet's manual sales invoice: an
// antd Select under a "Customer" caption, date pickers whose placeholder is
// "Select date", line inputs under a table header. Markup follows what a
// read-only probe of that form showed (2026-10-19).
import { test, expect } from '@playwright/test';
import { driverFor, mcpFixture, send } from './helpers.mjs';
import { twinsOf } from '../src/element-identity.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const select = (id, shown = '', placeholder = '') => `<div class="ant-select ant-select-single ant-select-allow-clear ant-select-show-arrow"><div class="ant-select-selector"><span class="ant-select-selection-wrap"><span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" aria-haspopup="listbox" aria-autocomplete="list" autocomplete="off" value=""></span>${shown ? `<span class="ant-select-selection-item" title="${shown}">${shown}</span>` : `<span class="ant-select-selection-placeholder">${placeholder}</span>`}</span></div><span class="ant-select-arrow"><span role="img" aria-label="down" class="anticon anticon-down"><svg width="12" height="12"></svg></span></span></div>`;
const picker = '<div class="ant-picker ant-picker-outlined"><div class="ant-picker-input"><input placeholder="Select date" aria-invalid="false" autocomplete="off" value=""><span class="ant-picker-suffix"><span role="img" aria-label="calendar" class="anticon anticon-calendar"><svg width="12" height="12"></svg></span></span></div></div>';
const col = (caption, field) => `<div class="ant-col ant-col-6" style="display:inline-block;width:220px;vertical-align:top;margin-right:16px"><div>${caption}</div>${field}</div>`;
const header = (name) => `<th class="flex"><div class="flex"><div class="flex-1"><p class="required">${name}</p></div></div></th>`;

const invoice = `<style>.ant-select-selection-search{display:block}.ant-select{border:1px solid #ccc;min-height:24px}</style>
  <div id="vendor-info">
    <div class="bg-bg-gray"><h1>Bill to</h1></div>
    <div class="ant-row">${col('Customer', select('rc_select_8'))}${col('Contact', select('rc_select_9', 'Jane Doe'))}${col('<label for="phone">Phone</label>', '<input id="phone">')}</div>
  </div>
  <div class="ant-row">${col('Invoice Date', picker)}${col('Payment Terms', select('rc_select_10', 'Net 30'))}${col('Due Date', picker)}</div>
  <table><thead class="grid relative"><tr class="flex relative">${header('Item')}${header('Quantity')}${header('Unit Price')}<th></th></tr></thead>
  <tbody><tr data-row-key="line-1"><td>${select('rc_select_11')}</td><td><input role="spinbutton" class="ant-input-number-input"></td><td><input></td><td><button aria-label="Delete line">x</button></td></tr></tbody></table>`;

test('unlabeled antd fields take the caption before them, and line inputs their column header', async ({ page }) => {
  await page.setContent(invoice);
  const { driver, id } = await driverFor(page);
  try {
    const { elements } = await driver.observe(id);
    const fields = elements.filter((e) => ['combobox', 'textbox', 'spinbutton'].includes(e.role));
    expect(fields.map((e) => e.label)).toEqual(['Customer', 'Contact', 'Phone', 'Invoice Date', 'Payment Terms', 'Due Date', 'Item', 'Quantity', 'Unit Price']);
    // The placeholder stays as it is; only the name changes.
    expect(fields.find((e) => e.label === 'Due Date').placeholder).toBe('Select date');
    // A select shows its value outside its input, which holds only search text.
    expect(fields.find((e) => e.label === 'Contact')).toMatchObject({ value: '', display: 'Jane Doe' });
    expect(fields.find((e) => e.label === 'Customer').display).toBeUndefined();
    expect(elements.find((e) => e.role === 'button').label).toBe('Delete line');
    // Line inputs belong to their row's item: Jev is told which column each is in.
    expect(fields.map((e) => e.column || '')).toEqual(['', '', '', '', '', '', 'Item', 'Quantity', 'Unit Price']);
    // Their headers mark them required.
    expect(fields.map((e) => !!e.required)).toEqual([false, false, false, false, false, false, true, true, true]);
  } finally { await driver.close(); }
});

// ccMonet's invoice lines say what a line needs only by marks (Mac run on
// 9a83708): a required class on the column header, and an error class on the
// cell of a field Save as Draft found empty, kept until the next save.
// Elsewhere a "*" by the label or antd's classes mark them, and Bootstrap
// marks a refused field with a class of its own.
const markedForm = `<style>.ant-select-selection-search{display:block}.ant-select{border:1px solid #ccc;min-height:24px}</style>
  <table><thead><tr><th class="required">Preferred Name</th><th>Description</th><th><div class="flex"><p class="required">Tracking Category</p></div></th><th class="not-required">Memo</th></tr></thead>
  <tbody><tr data-row-key="line-1"><td class="cell-error"><input id="name"></td><td><textarea id="desc"></textarea></td><td class="cell-error">${select('tracking')}</td><td><input id="memo"></td></tr></tbody></table>
  <div style="width:300px"><span>Customer *</span>${select('customer')}</div>
  <div style="width:300px"><b>*</b><span>Due Date</span>${picker}</div>
  <label for="email">Email</label><input id="email" required>
  <div class="ant-form-item ant-form-item-has-error"><div class="ant-form-item-label"><label for="ref" class="ant-form-item-required">Reference</label></div><div class="ant-form-item-control"><input id="ref"></div></div>
  <input id="code" aria-label="Code" class="form-control is-invalid">
  <div class="no-error"><input id="note" aria-label="Note"></div>`;

test('fields the page marks as required or wrong carry those marks', async ({ page }) => {
  await page.setContent(markedForm);
  const { driver, id } = await driverFor(page);
  try {
    const { elements } = await driver.observe(id);
    const marks = Object.fromEntries(elements.filter((e) => e.label).map((e) => [e.label, [!!e.required, !!(e.invalid || e.error_mark)]]));
    expect(marks).toEqual({
      'Preferred Name': [true, true], Description: [false, false], 'Tracking Category': [true, true], Memo: [false, false],
      Customer: [true, false], 'Due Date': [true, false], Email: [true, true], Reference: [true, true], Code: [false, true], Note: [false, false],
    });
    // A class mark is the page's: the browser's own check still passes.
    expect(elements.find((e) => e.label === 'Preferred Name')).toMatchObject({ invalid: false, error_mark: true });
  } finally { await driver.close(); }
});

test('Jev and the guards read the marks; a field typed while its cell still shows an error is confirmed', async ({ page }, testInfo) => {
  await page.setContent(markedForm);
  const seen = {};
  const named = (state, label) => state.page.elements.find((e) => e.label === label);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state, questions) => {
      seen.model = named(state, 'Tracking Category');
      seen.offered = questions.type_target?.criteria[String(named(state, 'Preferred Name').i)];
      return decision({ tool: 'type', target: named(state, 'Preferred Name').i });
    },
    { tool: 'none', done: 0.99 },
  ], { inspect: (state, questions) => { if (questions.action_side_effect) seen.guarded = state.proposed_action; } }));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Name line 1 QA item A', values: { item: 'QA item A' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(seen.model).toMatchObject({ required: true, invalid: true });
    expect(seen.offered).toMatchObject({ table_column: 'Preferred Name', required: true, invalid: true });
    expect(seen.guarded).toMatchObject({ tool: 'type', element: 'textbox "Preferred Name"', required: true, invalid: true });
    expect(result.actions.map((a) => [a.action, a.effect?.status])).toEqual([['type', 'confirmed']]);
    await expect(page.locator('#name')).toHaveValue('QA item A');
  } finally { await mcp.close(); }
});

// ccMonet's invoice lines (Mac probe, 2026-10-20): a dnd-kit sortable grid
// whose rows are buttons, with no key Jev reads; line 2's Unit Price got
// line 1's price. Rows are counted as a person sees them.
test('fields in table rows carry the number of their row', async ({ page }) => {
  const line = (n, item) => `<tr data-index="${n - 1}" class="flex w-full" role="button" tabindex="0" aria-roledescription="sortable" style="position:relative"><td>${n}</td><td><input value="${item}"></td><td><input class="price"></td><td><button aria-label="Delete line">x</button></td></tr>`;
  await page.setContent(`
    <table id="lines"><thead class="grid relative"><tr class="flex relative"><th>#</th><th>Description</th><th>Unit Price</th><th></th></tr></thead>
      <tbody class="relative grid">${line(1, 'Consulting')}${line(2, 'Support')}</tbody></table>
    <div class="ant-table-container">
      <div class="ant-table-header"><table><thead class="ant-table-thead"><tr><th>Account</th><th>Amount</th></tr></thead></table></div>
      <div class="ant-table-body"><table><tbody class="ant-table-tbody"><tr aria-hidden="true" class="ant-table-measure-row"><td style="padding:0"></td><td style="padding:0"></td></tr>
        <tr data-row-key="a"><td><input id="account-a"></td><td><input id="amount-a"></td></tr><tr style="display:none"><td><input id="gone"></td><td></td></tr><tr data-row-key="b"><td><input id="account-b"></td><td><input id="amount-b"></td></tr></tbody></table></div>
    </div>
    <table id="week"><tr><th>Day</th><th>Hours</th></tr><tr><th scope="row">Mon</th><td><input id="mon"></td></tr><tr><th scope="row">Tue</th><td><input id="tue"></td></tr></table>
    <div role="grid" aria-rowcount="80" id="virtual">
      <div role="rowgroup"><div role="row" aria-rowindex="1"><span role="columnheader">Code</span></div></div>
      <div role="rowgroup"><div><div role="row" aria-rowindex="37"><span role="gridcell"><input id="code-36"></span></div></div><div><div role="row" aria-rowindex="38"><span role="gridcell"><input id="code-37"></span></div></div></div>
    </div>
    <div role="grid" id="wrapped">
      <div role="row"><span role="columnheader">Note</span></div>
      <div><div role="row"><span role="gridcell"><input id="note-1"></span></div></div><div><div role="row"><span role="gridcell"><input id="note-2"></span></div></div>
    </div>
    <table id="layout"><tr><td>Memo</td><td><input id="memo"></td></tr><tr><td>Terms</td><td><input id="terms"></td></tr></table>
    <input id="outside">`);
  const { driver, id } = await driverFor(page);
  try {
    const { elements } = await driver.observe(id);
    const rows = elements.filter((e) => e.role === 'textbox').map((e) => [e.label, e.row]);
    expect(rows).toEqual([
      ['Description', 1], ['Unit Price', 1], ['Description', 2], ['Unit Price', 2],
      ['Account', 1], ['Amount', 1], ['Account', 2], ['Amount', 2],
      ['Hours', 1], ['Hours', 2],
      ['Code', 36], ['Code', 37],
      ['Note', 1], ['Note', 2],
      // A table that only lays a form out heads no columns: its rows hold no
      // items. The header table of another table, further up, heads nothing here.
      ['Memo', undefined], ['Terms', undefined],
      ['', undefined],
    ]);
    // A line's delete button is no field: it has no row of its own.
    expect(elements.filter((e) => e.label === 'Delete line').map((e) => e.row)).toEqual([undefined, undefined]);
  } finally { await driver.close(); }
});

// Codex on 440e142: two blank lines with no key or line number of their own
// hold fields alike in everything but their line.
const blankLines = `<table><thead><tr><th>Description</th><th>Unit Price</th></tr></thead>
  <tbody id="lines">${[1, 2].map(() => '<tr><td><input class="desc"></td><td><input class="price"></td></tr>').join('')}</tbody></table>`;
const prices = (page) => page.locator('.price').evaluateAll((list) => list.map((e) => e.value));

test('a field alike but for its table line is the node seen on that line, until the page rebuilds or moves the line', async ({ page }) => {
  await page.setContent(blankLines);
  const { driver, id } = await driverFor(page);
  const chooseLine2 = async () => {
    const seen = await driver.observe(id);
    const fields = seen.elements.filter((e) => e.label === 'Unit Price');
    expect(fields.map((e) => [e.row, e.value])).toEqual([[1, ''], [2, '']]);
    const twins = twinsOf(fields[1], seen);
    expect(twins).toMatchObject({ count: 2, distinct: true, node: fields[1].node, row: 2 });
    return { tool: 'type', target: fields[1].i, el: fields[1], value: '50', observedUrl: seen.url, observed: { twins } };
  };
  const moved = 'STALE_TARGET: the control chosen on line 2 of its table is gone or on another line now';
  try {
    expect((await send(driver, id, await chooseLine2())).state).toBe('dispatched_ack');
    expect(await prices(page)).toEqual(['', '50']);
    // The page rebuilt the lines after Jev looked: no node is the one seen.
    await page.setContent(blankLines);
    let action = await chooseLine2();
    await page.evaluate(() => { const lines = document.querySelector('#lines'); lines.replaceWith(lines.cloneNode(true)); });
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(moved);
    // It moved line 2 up: the node seen is on line 1 now.
    await page.setContent(blankLines);
    action = await chooseLine2();
    await page.evaluate(() => { const [one, two] = document.querySelectorAll('#lines tr'); one.before(two); });
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(moved);
    expect(await prices(page)).toEqual(['', '']);
  } finally { await driver.close(); }
});

test('Jev fills the same field on two blank lines of a table', async ({ page }, testInfo) => {
  await page.setContent(blankLines);
  const price = (state, row) => state.page.elements.find((e) => e.label === 'Unit Price' && e.row === row)?.i;
  const steps = scriptedDecider([
    (state) => decision({ tool: 'type', target: price(state, 1) }),
    (state) => decision({ tool: 'type', target: price(state, 2) }),
    { tool: 'none', done: 0.99 },
  ]);
  const decider = async (state, questions) => {
    if (!questions.selected_value) return steps(state, questions);
    const key = { 1: 'price_1', 2: 'price_2' }[state.selected_field.table_row] || '__none__';
    return { answers: { selected_value: { choice: key, probabilities: { [key]: 0.95 } } }, ms: 1, tokens: 1 };
  };
  const mcp = await mcpFixture(page, testInfo, decider);
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Set the unit price of line 1 to 100 and of line 2 to 50', values: { price_1: '100', price_2: '50' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(result.actions.map((a) => [a.action, a.error ?? a.detail])).toEqual([['type', undefined], ['type', undefined]]);
    expect(await prices(page)).toEqual(['100', '50']);
  } finally { await mcp.close(); }
});

test('a separate header table names body cells; a search icon names a search box; text elsewhere names nothing', async ({ page }) => {
  await page.setContent(`
    <div style="display:flex;gap:300px"><span>ccMonet</span><span class="ant-input-affix-wrapper"><span class="ant-input-prefix"><span role="img" aria-label="search" class="anticon anticon-search"><svg width="12" height="12"></svg></span></span><input class="ant-input" type="text" value=""></span></div>
    <div class="ant-table-container">
      <div class="ant-table-header"><table><thead class="ant-table-thead"><tr><th>Description</th><th>Amount</th><th class="ant-table-cell-scrollbar"></th></tr></thead></table></div>
      <div class="ant-table-body"><table><tbody class="ant-table-tbody"><tr aria-hidden="true" class="ant-table-measure-row"><td style="padding:0"></td><td style="padding:0"></td></tr><tr data-row-key="1"><td><input></td><td><input></td></tr></tbody></table></div>
    </div>
    <div><span>Total</span><button>Recalculate</button><input id="after-button"></div>
    <div><span>Range</span><input id="from"><input id="to"></div>
    <div><p>Notes</p><div style="margin-top:200px"><textarea id="far"></textarea></div></div>`);
  const { driver, id } = await driverFor(page);
  try {
    const { elements } = await driver.observe(id);
    const fields = elements.filter((e) => ['textbox'].includes(e.role));
    expect(fields.map((e) => e.label)).toEqual(['Search', 'Description', 'Amount', 'Total', '', '', '']);
  } finally { await driver.close(); }
});

// ccMonet's global search draws its hint over an input that has no
// placeholder, next to a "filter" button (Mac rerun, 2026-10-19). Its filter
// popup holds antd selects whose only text is their placeholder.
test('text drawn over an unnamed field is its hint, never its name', async ({ page }) => {
  await page.setContent(`
    <div style="display:flex;gap:300px"><span>ccMonet</span>
      <div class="global-search" style="position:relative;width:420px">
        <input class="ant-input" type="text" style="width:360px">
        <div class="search-tip" style="position:absolute;left:8px;top:2px;pointer-events:none;color:#999">Search contacts, vendor bills, sales invoices, payrolls...</div>
        <button aria-label="filter">⚙</button>
      </div>
    </div>
    <div class="filter-row" style="display:flex;gap:16px;width:600px">${select('rc_select_20', '', 'Select field')}${select('rc_select_21', '', 'Select condition')}</div>
    <script>document.querySelector('.ant-input').addEventListener('input', (e) => { document.querySelector('.search-tip').style.display = e.target.value ? 'none' : ''; });</script>`);
  const { driver, id } = await driverFor(page);
  try {
    const fields = async () => (await driver.observe(id)).elements.filter((e) => ['combobox', 'textbox'].includes(e.role)).map((e) => [e.role, e.label, e.hint]);
    expect(await fields()).toEqual([
      ['textbox', '', 'Search contacts, vendor bills, sales invoices, payrolls...'],
      ['combobox', '', 'Select field'],
      ['combobox', '', 'Select condition'],
    ]);
    // The hint goes away once the field holds text; the name stays the same.
    await page.fill('.ant-input', 'CHAIN1019');
    expect((await fields())[0]).toEqual(['textbox', '', undefined]);
  } finally { await driver.close(); }
});

// antd draws a select's clear button only while the select holds a value:
// an aria-hidden span with no role, at opacity 0 until the pointer is over
// the select, that empties it on mousedown (rc-select's TransBtn). Each
// value of a multi-select has a remove button like it. ccMonet's invoice
// lines have such selects under "Product" and "Tracking Category" (Mac
// rerun, 2026-10-20: Jev could not empty an unrequested "Woodlands").
const clearable = (id, shown) => `<div class="ant-select ant-select-single ant-select-allow-clear ant-select-show-arrow"><div class="ant-select-selector"><span class="ant-select-selection-wrap"><span class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" aria-expanded="false" aria-haspopup="listbox" aria-autocomplete="list" autocomplete="off" readonly unselectable="on" style="opacity:0" value=""></span>${shown ? `<span class="ant-select-selection-item" title="${shown}">${shown}</span>` : '<span class="ant-select-selection-placeholder">Select</span>'}</span></div><span class="ant-select-arrow" unselectable="on" aria-hidden="true"><span role="img" aria-label="down" class="anticon anticon-down"><svg width="12" height="12"></svg></span></span>${shown ? '<span class="ant-select-clear" unselectable="on" aria-hidden="true" style="user-select:none"><span role="img" aria-label="close-circle" class="anticon anticon-close-circle"><svg width="12" height="12"></svg></span></span>' : ''}</div>`;
const clearableInvoice = `<style>
    .ant-select { position: relative; width: 200px; height: 28px; border: 1px solid #ccc; }
    .ant-select-single .ant-select-selection-search { position: absolute; left: 8px; right: 30px; top: 0; bottom: 0; }
    .ant-select-selection-search-input { width: 100%; height: 26px; border: 0; }
    .ant-select-single .ant-select-selection-item, .ant-select-selection-placeholder { position: absolute; left: 8px; top: 5px; pointer-events: none; }
    .ant-select-arrow, .ant-select-clear { position: absolute; top: 50%; right: 11px; width: 12px; height: 12px; margin-top: -6px; }
    .ant-select-arrow { pointer-events: none; }
    .ant-select-clear { z-index: 1; cursor: pointer; opacity: 0; background: #fff; }
    .ant-select:hover .ant-select-clear { opacity: 1; }
    .ant-select-multiple .ant-select-selection-overflow { display: flex; gap: 4px; padding: 2px; }
    .ant-select-multiple .ant-select-selection-search { width: 40px; }
  </style>
  <h1>New invoice</h1>
  <div class="ant-row">${col('Currency', clearable('currency', 'SGD'))}${col('Labels', `<div class="ant-select ant-select-multiple ant-select-allow-clear"><div class="ant-select-selector"><div class="ant-select-selection-overflow"><div class="ant-select-selection-overflow-item"><span class="ant-select-selection-item" title="Urgent"><span class="ant-select-selection-item-content">Urgent</span><span class="ant-select-selection-item-remove" unselectable="on" aria-hidden="true" style="user-select:none"><span role="img" aria-label="close" class="anticon anticon-close"><svg width="10" height="10"></svg></span></span></span></div><div class="ant-select-selection-overflow-item ant-select-selection-overflow-item-suffix"><div class="ant-select-selection-search"><input id="labels" class="ant-select-selection-search-input" role="combobox" type="search" aria-expanded="false" autocomplete="off" value=""></div></div></div></div></div>`)}</div>
  <table><thead><tr><th>Description</th><th>Product</th><th>Tracking Category</th></tr></thead><tbody>
    <tr data-row-key="line-1"><td><input value="Consulting"></td><td>${clearable('product-1', 'Widget')}</td><td>${clearable('tracking-1', 'Woodlands')}</td></tr>
    <tr data-row-key="line-2"><td><input value="Support"></td><td>${clearable('product-2', '')}</td><td>${clearable('tracking-2', 'Woodlands')}</td></tr>
  </tbody></table>
  <script>
    document.addEventListener('mousedown', (event) => {
      const clear = event.target.closest('.ant-select-clear');
      if (!clear) return;
      event.preventDefault();
      const select = clear.closest('.ant-select');
      select.querySelector('.ant-select-selection-item').replaceWith(Object.assign(document.createElement('span'), { className: 'ant-select-selection-placeholder', textContent: 'Select' }));
      clear.remove();
      select.querySelector('input').focus();
    });
  </script>`;

test("a select's clear button is a button that names the field it empties, and a click empties that field only", async ({ page }) => {
  await page.setContent(clearableInvoice);
  const { driver, id } = await driverFor(page);
  try {
    const observed = await driver.observe(id);
    const at = (label, row = '') => observed.elements.find((e) => e.role === 'combobox' && e.label === label && (e.record_key || '') === row)?.i;
    const clears = observed.elements.filter((e) => e.clears != null).map((e) => [e.role, e.label, e.column, e.record_key || '', e.clears]);
    expect(clears).toEqual([
      ['button', 'close-circle', undefined, '', at('Currency')],
      ['button', 'close', undefined, '', at('Labels')],
      ['button', 'close-circle', 'Product', 'line-1', at('Product', 'line-1')],
      ['button', 'close-circle', 'Tracking Category', 'line-1', at('Tracking Category', 'line-1')],
      ['button', 'close-circle', 'Tracking Category', 'line-2', at('Tracking Category', 'line-2')],
    ]);
    // The remove button of a multi-select's value is told by that value.
    expect(observed.elements.find((e) => e.label === 'close').context).toBe('Urgent');
    // Its arrow is no control.
    expect(observed.elements.filter((e) => e.label === 'down')).toEqual([]);

    // Both clear buttons of a line read the same; their columns tell them apart.
    const clear = observed.elements.find((e) => e.clears === at('Tracking Category', 'line-1'));
    const twins = twinsOf(clear, observed);
    expect(twins).toMatchObject({ count: 2, distinct: true });
    const action = { tool: 'click', target: clear.i, el: clear, observedUrl: observed.url, observed: { twins } };
    await driver.assertTargetFresh(id, action);
    await driver.perform(id, action, action.el);
    const after = await driver.observe(id);
    const shown = after.elements.filter((e) => e.role === 'combobox').map((e) => [e.label, e.record_key || '', e.display]);
    expect(shown).toEqual([
      ['Currency', '', 'SGD'], ['Labels', '', 'Urgent'],
      ['Product', 'line-1', 'Widget'], ['Tracking Category', 'line-1', undefined],
      ['Product', 'line-2', undefined], ['Tracking Category', 'line-2', 'Woodlands'],
    ]);
    expect(after.elements.filter((e) => e.clears != null).map((e) => [e.column, e.record_key || ''])).toEqual([
      [undefined, ''], [undefined, ''], ['Product', 'line-1'], ['Tracking Category', 'line-2'],
    ]);
  } finally { await driver.close(); }
});

// A multi-select's chosen options, as antd draws them: a tag each.
const tags = (id, caption, values) => col(caption, `<div class="ant-select ant-select-multiple"><div class="ant-select-selector"><div class="ant-select-selection-overflow">${values.map((v) => `<div class="ant-select-selection-overflow-item"><span class="ant-select-selection-item" title="${v}"><span class="ant-select-selection-item-content">${v}</span><span class="ant-select-selection-item-remove" unselectable="on" aria-hidden="true"><span role="img" aria-label="close" class="anticon anticon-close"><svg width="10" height="10"></svg></span></span></span></div>`).join('')}<div class="ant-select-selection-overflow-item ant-select-selection-overflow-item-suffix"><div class="ant-select-selection-search"><input id="${id}" class="ant-select-selection-search-input" role="combobox" type="search" aria-expanded="false" autocomplete="off" value=""></div></div></div></div></div>`);

// An option's own text can hold a comma (Codex on 37c131e): the options are
// read apart, as the page parts them, never split from the joined text.
test("a multi-select's chosen options are read apart, as the page parts them; a secret field's are not read", async ({ page }) => {
  await page.setContent(`<style>.ant-select-multiple .ant-select-selection-overflow { display: flex; gap: 4px; } .ant-select{border:1px solid #ccc;min-height:24px}</style>
    <h1>Edit contact</h1>
    <div class="ant-row">${tags('tracking', 'Tracking Category', ['HQ', 'Changi'])}${tags('owner', 'Owner', ['Doe, John'])}${tags('tokens', 'API token', ['tok-1', 'tok-2'])}</div>`);
  const { driver, id } = await driverFor(page);
  try {
    const { elements } = await driver.observe(id);
    expect(elements.filter((e) => e.role === 'combobox').map((e) => [e.label, e.display, e.display_items])).toEqual([
      ['Tracking Category', 'HQ, Changi', ['HQ', 'Changi']],
      ['Owner', 'Doe, John', undefined],
      ['API token', '[REDACTED]', undefined],
    ]);
  } finally { await driver.close(); }
});

test('Jev is told which field a clear button empties, and so are the guards and the run history', async ({ page }, testInfo) => {
  await page.setContent(clearableInvoice);
  const seen = {};
  const line1 = (state) => state.page.elements.find((e) => e.role === 'combobox' && e.label === 'Tracking Category' && e.record_key === 'line-1').i;
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state, questions) => {
      seen.field = line1(state);
      seen.clear = state.page.elements.find((e) => e.clears === seen.field).i;
      seen.offered = questions.click_target?.criteria[String(seen.clear)];
      seen.instructions = questions.click_target?.instructions;
      return decision({ tool: 'click', target: seen.clear });
    },
    (state) => { seen.history = state.task.history.at(-1); return decision({ tool: 'none', done: 0.99 }); },
  ], { inspect: (state, questions) => { if (questions.action_side_effect) seen.guarded = state.proposed_action; } }));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Empty the Tracking Category of the Consulting line', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    const field = `[${seen.field}] combobox "Tracking Category" in table row 1 showing "Woodlands"`;
    expect(seen.offered).toMatchObject({ control: `[${seen.clear}] button "close-circle"`, clears: field, record: 'line-1', table_column: 'Tracking Category', table_row: 1 });
    expect(seen.instructions).toContain('A target marked clears is that field\'s clear button: a click empties the field.');
    expect(seen.guarded).toMatchObject({ tool: 'click', element: 'button "close-circle"', clears: field, table_column: 'Tracking Category', table_row: 1 });
    expect(seen.history).toMatchObject({ action: 'click', element: 'button "close-circle"', clears: field, row: 1 });
    expect(result.actions.map((a) => [a.action, a.element, a.effect?.status])).toEqual([['click', 'button "close-circle"', 'changed']]);
    // Only that line's category is empty now.
    await expect(page.locator('.ant-select-selection-item')).toHaveText(['SGD', 'Urgent', 'Widget', 'Woodlands']);
  } finally { await mcp.close(); }
});
