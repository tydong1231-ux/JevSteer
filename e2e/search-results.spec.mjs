// ccMonet's global search (Mac rerun, 2026-10-19): typing a name opens a
// floating panel of results under the box ("Vendor 1 CP-MEIJI CO.,LTD.").
// No role or ARIA links it to the box, and Jev read it as page text: the goal
// "Search results list CP-MEIJI CO.,LTD." stayed unmet at done 0.10. The
// markup follows the outerHTML the Mac captured.
import { test, expect } from '@playwright/test';
import { driverFor, mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const bills = `
  <header style="display:flex;gap:24px;align-items:center;height:56px">
    <div>[DEMO] MONET WONDERFUL PTE. LTD. Ultimate</div>
    <div class="group relative min-w-0 w-full max-w-[600px]" style="position:relative;width:600px">
      <div class="pointer-events-none absolute blur-xl" style="position:absolute;inset:0"></div>
      <div class="relative flex min-w-0 h-[44px] items-center gap-2 rounded-full border" style="position:relative;display:flex;align-items:center;height:44px;border:1px solid #ccc">
        <button type="button" class="flex h-7 w-7"><span role="img" aria-label="filter" class="anticon anticon-filter"><svg width="12" height="12"></svg></span></button>
        <div class="relative flex h-full min-w-0 flex-1 items-center" style="position:relative;flex:1">
          <input class="relative z-10 w-full border-none bg-transparent text-sm" type="text" value="" style="width:100%;border:none;background:transparent">
          <div id="tip" class="pointer-events-none absolute left-0 right-0 truncate text-sm" style="position:absolute;left:0;right:0;top:2px;pointer-events:none">Search contacts, vendor bills, sales invoices, payrolls...</div>
        </div>
        <div class="flex shrink-0 items-center gap-1"><span>Agent Mode</span><button type="button" role="switch" aria-checked="false" class="ant-switch ant-switch-small"></button></div>
      </div>
      <div id="results" style="position:absolute;left:0;right:0;top:100%;margin-top:8px;background:#fff;display:none"><div class="py-1">
        <div class="px-2 py-1"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span>Vendor</span><span>1</span></div></div>
          <div class="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2"><div class="min-w-0 flex-1"><div class="truncate text-sm"><span class="text-monet-2 font-medium">CP-MEIJI</span> CO.,LTD.</div><div class="truncate text-xs">2/9 MOO 4 PHAHONYOTHIN RD., NONGNAK, NONGKAE</div></div></div></div>
        <div class="px-2 py-1"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span>Vendor Bills</span><span>1</span></div></div>
          <div class="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2"><div class="min-w-0 flex-1"><div class="truncate text-sm">9001563832</div><div class="truncate text-xs">9001563832 · 2025/4/25</div></div><div class="shrink-0 pl-3 text-sm">฿1,732.00</div></div></div>
      </div></div>
    </div>
  </header>
  <main>
    <h1>Vendor Bills</h1><button>Search</button>
    <table><thead><tr><th>Vendor</th><th>Total</th></tr></thead><tbody>
      <tr data-row-key="1"><td>SIAM PAPER CO.,LTD.</td><td>฿ 820.00</td></tr>
      <tr data-row-key="2"><td>CP-MEIJI CO.,LTD.</td><td>฿ 1,732.00</td></tr>
    </tbody></table>
    <div><input role="combobox" aria-label="Page Size" value="20"></div>
  </main>
  <script>
    const input = document.querySelector('.group input');
    input.addEventListener('input', () => {
      document.querySelector('#tip').style.display = input.value ? 'none' : '';
      document.querySelector('#results').style.display = input.value ? '' : 'none';
    });
  </script>`;
const results = 'Vendor 1 CP-MEIJI CO.,LTD. 2/9 MOO 4 PHAHONYOTHIN RD., NONGNAK, NONGKAE Vendor Bills 1 9001563832 9001563832 · 2025/4/25 ฿1,732.00';

test('results drawn under a focused search box are its popup', async ({ page }) => {
  await page.setContent(bills);
  const { driver, id } = await driverFor(page);
  try {
    const before = await driver.observe(id);
    expect(before.popup).toBeUndefined();
    expect(before.elements.some((e) => e.popup_of != null)).toBe(false);
    await page.fill('.group input', 'CP-MEIJI');
    const after = await driver.observe(id);
    const box = after.elements.find((e) => e.tag === 'input' && e.value === 'CP-MEIJI');
    expect(after.popup).toEqual({ field: box.i, text: results });
    expect(after.elements.filter((e) => e.popup_of != null).map((e) => [e.label, e.popup_of])).toEqual([
      ['CP-MEIJI CO.,LTD. 2/9 MOO 4 PHAHONYOTHIN RD., NONGNAK, NONGKAE', box.i],
      ['9001563832 9001563832 · 2025/4/25 ฿1,732.00', box.i],
    ]);
    // Once focus leaves the box, its results are page text again.
    await page.locator('.group input').blur();
    expect((await driver.observe(id)).popup).toBeUndefined();
  } finally { await driver.close(); }
});

test('Jev reads the results as the search box\'s, and judges done by the success criteria', async ({ page }, testInfo) => {
  await page.setContent(bills);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: state.page.elements.find((e) => e.hint?.startsWith('Search contacts')).i }),
    (state, questions) => {
      seen.popup = state.page.popup;
      seen.done = questions.done.instructions;
      return decision({ tool: 'none', done: 0.99 });
    },
  ]));
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Search for vendor CP-MEIJI with the global search', success_criteria: ['Search results list CP-MEIJI CO.,LTD.'],
      values: { vendor: 'CP-MEIJI' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none',
    });
    expect(result.status).toBe('host_review_required');
    // The box keeps the hint it showed when Jev typed in it.
    expect(seen.popup).toEqual({ field: '[1] textbox "Search contacts, vendor bills, sales invoices, payrolls..."', field_value: 'CP-MEIJI', shows: results });
    expect(seen.done).toContain('task.success_criteria say what achieved looks like');
  } finally { await mcp.close(); }
});

// An invoice's line items: antd draws each Product select's search input in an
// absolute box, and a row can carry a floating remove button. Neither is a
// popup of the Description field typed in the row above.
const lines = (n) => `<table style="border-collapse:collapse"><tbody>${Array.from({ length: n }, (_, i) => `
  <tr style="height:40px">
    <td><input aria-label="Description ${i + 1}" value=""></td>
    <td><div class="ant-select" style="position:relative;width:200px;height:32px"><div class="ant-select-selector" style="position:relative;height:32px">
      <span class="ant-select-selection-search" style="position:absolute;top:0;bottom:0;left:11px;right:11px"><input role="combobox" aria-expanded="false" aria-label="Product ${i + 1}" style="width:100%"></span>
    </div></div></td>
    <td style="position:relative;width:60px"><button type="button" style="position:absolute;right:4px;top:4px">Remove ${i + 1}</button></td>
  </tr>`).join('')}</tbody></table>`;

// A page's fixed bar of links sits above its fields, in the same wrapper.
const layout = `<div class="layout">
  <nav style="position:fixed;top:0;left:0;right:0;height:40px;background:#eee"><a href="#home">Home</a> <a href="#bills">Bills</a></nav>
  <div class="item" style="margin-top:60px"><input aria-label="Reference" value=""></div>
  <div style="height:900px"></div>
  <footer style="position:absolute;left:0;right:0;bottom:0"><button type="button">Save</button></footer>
</div>`;

for (const [what, content, field] of [['the next line item', lines(2), 'Description 1'], ['a fixed bar or footer', layout, 'Reference']]) {
  test(`${what} is not a popup of the field typed next to it`, async ({ page }) => {
    await page.setContent(content);
    const { driver, id } = await driverFor(page);
    try {
      await page.fill(`input[aria-label="${field}"]`, 'Consulting');
      const seen = await driver.observe(id);
      expect(seen.popup).toBeUndefined();
      expect(seen.elements.filter((e) => e.popup_of != null).map((e) => e.label)).toEqual([]);
    } finally { await driver.close(); }
  });
}
