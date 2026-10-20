// ccMonet's global search (Mac rerun, 2026-10-19): typing a name opens a
// floating panel of results under the box ("Vendor 1 CP-MEIJI CO.,LTD.").
// No role or ARIA links it to the box, and Jev read it as page text: the goal
// "Search results list CP-MEIJI CO.,LTD." stayed unmet at done 0.10. The
// markup follows the outerHTML the Mac captured.
import { test, expect } from '@playwright/test';
import { driverFor, mcpFixture, send } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';
import { toModelPage } from '../src/page-model.mjs';
import { closedOnly } from '../src/action-effect.mjs';

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

test('Enter that Jev chose for the box it typed in goes to that box, though its hint has gone', async ({ page }, testInfo) => {
  await page.setContent(bills);
  await page.evaluate(() => document.querySelector('.group input').addEventListener('keydown', (e) => { if (e.key === 'Enter') window.entered = e.target.value; }));
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: state.page.elements.find((e) => e.hint?.startsWith('Search contacts')).i }),
    (state, questions) => {
      const box = state.page.elements.find((e) => e.value === 'CP-MEIJI');
      seen.offered = questions.press_enter_target?.criteria?.[String(box.i)]?.control;
      return decision({ tool: 'press_enter', target: box.i });
    },
    () => decision({ tool: 'none', done: 0.99 }),
  ]));
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Search for vendor CP-MEIJI with the global search', success_criteria: ['Search results list CP-MEIJI CO.,LTD.'],
      values: { vendor: 'CP-MEIJI' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none',
    });
    expect(seen.offered).toBe('[1] textbox "Search contacts, vendor bills, sales invoices, payrolls..."');
    expect(await page.evaluate(() => window.entered)).toBe('CP-MEIJI');
    expect(result.status).toBe('host_review_required');
  } finally { await mcp.close(); }
});

// The same page with 300 more bills: more controls than Jev decides on at
// once. Jev first picks a group of controls from a summary of each, then a
// target in that group.
const manyBills = bills.replace('</tbody>', `${Array.from({ length: 300 }, (_, n) => `<tr><td><a href="#bill-${n}">Bill ${n}</a></td><td>฿ ${n}.00</td></tr>`).join('')}</tbody>`);

test('on a page too large for one decision, the group summary shows the box Jev typed in by its hint, and Enter goes to it', async ({ page }, testInfo) => {
  await page.setContent(manyBills);
  await page.evaluate(() => document.querySelector('.group input').addEventListener('keydown', (e) => { if (e.key === 'Enter') window.entered = e.target.value; }));
  const seen = {};
  const groupWith = (questions, words) => Object.entries(questions.group.criteria).find(([, summary]) => summary.includes(words))?.[0];
  const inGroup = (tool, g) => ({ ...decision({ tool, target: null }), group: { choice: g, probabilities: { [g]: 0.99 } } });
  const head = (key, i) => ({ [key]: { choice: String(i), probabilities: { [String(i)]: 0.99 } } });
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state, questions) => inGroup('type', groupWith(questions, 'Search contacts')),
    (state) => head('type_target', state.page.elements.find((e) => e.hint?.startsWith('Search contacts')).i),
    (state, questions) => {
      seen.group = groupWith(questions, 'Search contacts');
      return inGroup('press_enter', seen.group ?? '0');
    },
    (state, questions) => {
      const box = state.page.elements.find((e) => e.value === 'CP-MEIJI');
      seen.offered = questions.press_enter_target?.criteria?.[String(box.i)]?.control;
      return head('press_enter_target', box.i);
    },
    () => decision({ tool: 'none', done: 0.99 }),
  ]));
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Search for vendor CP-MEIJI with the global search', success_criteria: ['Search results list CP-MEIJI CO.,LTD.'],
      values: { vendor: 'CP-MEIJI' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none',
    });
    expect(seen.group).toBe('0');
    expect(seen.offered).toBe('[1] textbox "Search contacts, vendor bills, sales invoices, payrolls..."');
    expect(await page.evaluate(() => window.entered)).toBe('CP-MEIJI');
    expect(result.status).toBe('host_review_required');
  } finally { await mcp.close(); }
});

// Search results under a box that sits past the page text that is read (the
// first 24,000 characters). What they say is read only as the box's popup,
// and the summary is in no control's own text.
const farResults = `<p>${'Bills imported from the bank feed. '.repeat(800)}</p>
  <div style="position:relative;width:600px">
    <div style="position:relative"><input type="text" placeholder="Search bills" style="width:100%"></div>
    <div id="results" style="position:absolute;left:0;right:0;top:100%;margin-top:8px;display:none;background:#fff">
      <p id="summary">1 bill matches CP-MEIJI: 9001563832, ฿1,732.00</p>
      <div><button type="button">See all results</button></div>
    </div>
  </div>
  <script>
    const box = document.querySelector('input');
    box.addEventListener('input', () => { document.querySelector('#results').style.display = box.value ? '' : 'none'; });
  </script>`;

test('a review ticket binds the results under the search box, so results that change before acceptance make it stale', async ({ page }, testInfo) => {
  await page.setContent(farResults);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: state.page.elements.find((e) => e.placeholder === 'Search bills').i }),
    { tool: 'none', done: 0.99 },
  ]));
  const search = () => mcp.call('browser_run', {
    tab_id: mcp.id, goal: 'Search bills for CP-MEIJI', success_criteria: ['The results show the CP-MEIJI bill 9001563832'],
    values: { vendor: 'CP-MEIJI' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none',
  });
  const review = (ticket) => mcp.call('browser_review', { tab_id: mcp.id, review_id: ticket.host_review.review_id, decision: 'accept', goal_evidence: 'The search box shows CP-MEIJI', criteria_evidence: ['The results under the box list bill 9001563832'] });
  try {
    const ticket = await search();
    expect(ticket.status).toBe('host_review_required');
    // The host reads the results from the popup; the page text stops before them.
    expect(ticket.verification.observation.popup.shows).toBe('1 bill matches CP-MEIJI: 9001563832, ฿1,732.00 See all results');
    expect(ticket.verification.observation.text).not.toContain('9001563832');
    await page.evaluate(() => { document.querySelector('#summary').textContent = 'No bills match CP-MEIJI'; });
    expect((await review(ticket)).status).toBe('host_review_stale');
  } finally { await mcp.close(); }
});

// A password box whose strength popup echoes what was typed, after more page
// text than Jev reads.
const secretEcho = `<p>${'Terms of service. '.repeat(560)}</p>
  <div class="pw" style="position:relative;width:300px">
    <input type="password" aria-label="Password" style="width:100%">
    <div id="strength" style="position:absolute;left:0;top:100%;margin-top:4px;display:none;background:#fff"><span id="echo"></span> is too common <button type="button">Suggest another</button></div>
  </div>
  <script>
    const pw = document.querySelector('.pw input');
    pw.addEventListener('input', () => { document.querySelector('#echo').textContent = pw.value; document.querySelector('#strength').style.display = pw.value ? '' : 'none'; });
  </script>`;

test('a secret field\'s popup is left out of Jev\'s page, though the snapshot finds it', async ({ page }) => {
  await page.setContent(secretEcho);
  const { driver, id } = await driverFor(page);
  try {
    await page.fill('.pw input', 'hunter2');
    const seen = await driver.observe(id);
    const field = seen.elements.find((e) => e.type === 'password');
    expect(field.value).toBe('[REDACTED]');
    expect(seen.popup).toEqual({ field: field.i, text: 'hunter2 is too common Suggest another' });
    const model = toModelPage(seen);
    expect(model.popup).toBeUndefined();
    expect(model.text).not.toContain('hunter2');
  } finally { await driver.close(); }
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

// ccMonet (Mac rerun on f462b95): with the global search's results open, Jev
// clicked the CP-MEIJI row of the table behind them. The click only closed
// the results; no bill opened, and Jev waited three times for one. Here the
// results close on a click outside them, and that click goes no further.
const swallowing = bills
  .replace('<td>CP-MEIJI CO.,LTD.</td>', '<td class="cursor-pointer">CP-MEIJI CO.,LTD.</td>')
  .replace('</script>', `
    for (const row of document.querySelectorAll('tbody tr')) row.addEventListener('click', () => { window.opened = row.dataset.rowKey; document.querySelector('h1').textContent = 'Bill 9001563832 CP-MEIJI CO.,LTD. Unpaid'; });
    document.addEventListener('click', (e) => {
      const results = document.querySelector('#results');
      if (results.style.display !== 'none' && !e.target.closest('.group')) { results.style.display = 'none'; e.stopPropagation(); }
    }, true);
  </script>`);

test('a click that only closed the search results is marked closed_only, and Jev clicks again', async ({ page }, testInfo) => {
  await page.setContent(swallowing);
  const cell = (state) => state.page.elements.find((e) => e.tag === 'td' && e.label === 'CP-MEIJI CO.,LTD.').i;
  let after;
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: state.page.elements.find((e) => e.hint?.startsWith('Search contacts')).i }),
    (state) => decision({ tool: 'click', target: cell(state) }),
    (state) => {
      after = state.task.history.at(-1);
      return decision(after.closed_only ? { tool: 'click', target: cell(state) } : { tool: 'wait' });
    },
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', {
      tab_id: mcp.id, goal: 'Search for CP-MEIJI, then open its bill', values: { vendor: 'CP-MEIJI' },
      verification_mode: 'host', max_actions: 5, evidence_level: 'none',
    });
    expect(after).toMatchObject({ action: 'click', requests: 0, closed_only: { controls_gone: 2, such_as: ['div "CP-MEIJI CO.,LTD. 2/9 MOO 4 PHAHONYOTHIN RD., NONGNAK, NONGKAE"', 'div "9001563832 9001563832 · 2025/4/25 ฿1,732.00"'] } });
    expect(await page.evaluate(() => window.opened)).toBe('2');
    expect(result.status).toBe('host_review_required');
  } finally { await mcp.close(); }
});

// Codex on 440e142: only a click that closed an open popup is closed_only.
// ccMonet's bill filter is antd's popover ("Filter records", Mac probe),
// drawn at the end of the body, its body a tooltip; here a click outside it
// closes it and goes no further. A button that collapses a section of the
// page shows no state of its own: a second click would open it again.
const filterAndSection = `<style>
    .ant-popover { position: absolute; top: 40px; left: 320px; background: #fff; padding: 12px; border: 1px solid #ccc; }
    .ant-popover-hidden { display: none; }
  </style>
  <main>
    <h1>Vendor Bills</h1>
    <button type="button" id="filter">Filter</button>
    <button type="button" id="toggle" aria-label="Advanced search"><svg width="12" height="12"></svg></button>
    <div id="advanced"><label>Reference <input id="ref"></label> <label>Memo <input id="memo"></label></div>
    <table><thead><tr><th>Vendor</th><th>Total</th></tr></thead><tbody>
      <tr data-row-key="2"><td class="cursor-pointer" id="cp">CP-MEIJI CO.,LTD.</td><td>฿ 1,732.00</td></tr>
    </tbody></table>
  </main>
  <div><div class="ant-popover ant-popover-hidden" id="pop"><div class="ant-popover-content"><div class="ant-popover-inner" role="tooltip">
    <div class="ant-popover-title">Filter records</div>
    <div class="ant-popover-inner-content"><button type="button">+ Add Filter</button> <input aria-label="Value" value="CP-MEIJI"></div>
  </div></div></div></div>
  <script>
    window.opened = [];
    const pop = document.querySelector('#pop');
    document.querySelector('#filter').addEventListener('click', () => pop.classList.remove('ant-popover-hidden'));
    document.querySelector('#toggle').addEventListener('click', () => { const section = document.querySelector('#advanced'); section.hidden = !section.hidden; });
    document.querySelector('#cp').addEventListener('click', () => window.opened.push('2'));
    document.addEventListener('click', (e) => {
      if (!pop.classList.contains('ant-popover-hidden') && !pop.contains(e.target) && e.target.id !== 'filter') { pop.classList.add('ant-popover-hidden'); e.stopPropagation(); }
    }, true);
  </script>`;

test('only a click that closed an open popup is marked closed_only, not one that collapsed a section of the page', async ({ page }) => {
  await page.setContent(filterAndSection);
  const { driver, id } = await driverFor(page);
  const clickOn = async (label) => {
    const before = await driver.observe(id);
    const el = before.elements.find((e) => e.label === label);
    const action = { tool: 'click', target: el.i, el, observedUrl: before.url };
    expect((await send(driver, id, action)).state).toBe('dispatched_ack');
    const after = await driver.observe(id);
    return { before, after, closed: closedOnly(before, after, action) };
  };
  try {
    await clickOn('Filter');
    let step = await clickOn('CP-MEIJI CO.,LTD.');
    const layers = step.before.elements.filter((e) => e.layer != null);
    expect(layers.map((e) => e.label)).toEqual(['+ Add Filter', 'Value']);
    expect(new Set(layers.map((e) => e.layer)).size).toBe(1);
    expect(step.closed).toMatchObject({ controls_gone: 2 });
    expect(await page.evaluate(() => window.opened)).toEqual([]);
    // With nothing open, the click opens the bill.
    step = await clickOn('CP-MEIJI CO.,LTD.');
    expect(step.closed).toBeUndefined();
    expect(await page.evaluate(() => window.opened)).toEqual(['2']);
    step = await clickOn('Advanced search');
    const fields = (observed) => observed.elements.filter((e) => ['Reference', 'Memo'].includes(e.label));
    expect(fields(step.before).map((e) => e.layer)).toEqual([undefined, undefined]);
    expect(fields(step.after)).toEqual([]);
    expect(step.closed).toBeUndefined();
  } finally { await driver.close(); }
});

test('on a page too large for one decision, what the focused box\'s popup shows is offered whichever group Jev picks, marked as its', async ({ page }, testInfo) => {
  await page.setContent(manyBills);
  let offered;
  const groupWith = (questions, words) => Object.entries(questions.group.criteria).find(([, summary]) => summary.includes(words))?.[0];
  const inGroup = (tool, g) => ({ ...decision({ tool, target: null }), group: { choice: g, probabilities: { [g]: 0.99 } } });
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state, questions) => inGroup('type', groupWith(questions, 'Search contacts')),
    (state) => {
      const box = String(state.page.elements.find((e) => e.hint?.startsWith('Search contacts')).i);
      return { type_target: { choice: box, probabilities: { [box]: 0.99 } } };
    },
    (state, questions) => {
      offered = { summary: questions.group.criteria[groupWith(questions, 'CP-MEIJI CO.,LTD. 2/9')] };
      // Jev picks the group of a far bill: the results are offered all the same.
      return inGroup('click', groupWith(questions, 'Bill 250'));
    },
    (state, questions) => {
      offered.criteria = Object.values(questions.click_target.criteria);
      return { click_target: { choice: '__none__', probabilities: { __none__: 0.99 } } };
    },
  ]));
  try {
    await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Search for CP-MEIJI, then open its vendor record', values: { vendor: 'CP-MEIJI' }, verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(offered.summary).toContain('div "CP-MEIJI CO.,LTD. 2/9 MOO 4 PHAHONYOTHIN RD., NONGNAK, NONGKAE" (in popup of [1])');
    expect(offered.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ control: expect.stringMatching(/^\[\d+\] div "CP-MEIJI CO\.,LTD\. 2\/9 MOO 4/), in_popup_of: '[1] textbox "Search contacts, vendor bills, sales invoices, payrolls..."' }),
      expect.objectContaining({ control: expect.stringMatching(/^\[\d+\] link "Bill 250"/) }),
    ]));
  } finally { await mcp.close(); }
});
