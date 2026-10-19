// Fields with no accessible name, as on ccMonet's manual sales invoice: an
// antd Select under a "Customer" caption, date pickers whose placeholder is
// "Select date", line inputs under a table header. Markup follows what a
// read-only probe of that form showed (2026-10-19).
import { test, expect } from '@playwright/test';
import { driverFor } from './helpers.mjs';

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
  } finally { await driver.close(); }
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
