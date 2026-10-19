// Input widgets that keep their own copy of a field's value. The date picker
// below follows bootstrap-datepicker 1.9 (Selenium's web form): it parses the
// field on keyup and, on blur, writes its own parsed value back.
import { test, expect } from '@playwright/test';
import { driverFor, mcpFixture } from './helpers.mjs';
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
// Jev may click the option, or choose SELECT, as it did on ccMonet (Mac rerun,
// 2026-10-19): the open combobox then offers the option its list shows.
for (const [variant, html] of [['', drawerSelect], [' (no listbox link)', unlinked]]) for (const how of ['click', 'select']) {
  test(`an antd select in a drawer: type to search, then ${how === 'click' ? 'click the visible option' : 'SELECT the option the open list shows'}; the field is not typed again${variant}`, async ({ page }, testInfo) => {
    await page.setContent(html);
    const seen = {};
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      (state) => decision({ tool: 'type', target: pick((e) => e.label === 'Customer')(state) }),
      (state, questions) => {
        seen.open = {
          elements: state.page.elements.map((e) => [e.role, e.label]),
          select: Object.entries(questions.select_target?.criteria || {}).map(([key, c]) => [key, c.control, c.choose_option]),
        };
        const option = pick((e) => e.role === 'option' && e.label === 'Acme Ltd')(state);
        return decision(how === 'click' ? { tool: 'click', target: option } : { tool: 'select', target: `${pick((e) => e.label === 'Customer')(state)}>${option}` });
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
      // behind the drawer. SELECT on the open combobox would only close it, so
      // it offers the option the list shows instead (or none).
      expect(seen.open.elements).toEqual([['combobox', 'Customer'], ['textbox', 'Reference'], ['button', 'Save as Draft'], ['option', 'Acme Ltd']]);
      expect(seen.open.select).toEqual([['0>3', '[0] combobox "Customer"', 'Acme Ltd'], ['__none__', undefined, undefined]]);
      // Either way, the option is clicked.
      expect(result.actions.map((a) => [a.action, a.element, a.effect?.status])).toEqual([['type', 'combobox "Customer"', 'confirmed'], ['click', 'option "Acme Ltd"', 'changed']]);
      await expect(page.locator('.ant-select-selection-item')).toHaveText('Acme Ltd');
      // The search text cleared when the option was picked. The field shows
      // the option, so it is not offered for TYPE again.
      expect(seen.picked.customer).toMatchObject({ value: '', display: 'Acme Ltd' });
      expect(seen.picked.typable).toEqual(['[1] textbox "Reference"']);
    } finally { await mcp.close(); }
  });
}

// A multi-select, as antd draws one: a click on an option toggles it, so a
// click on one already chosen takes it out again. Tags is open and Labels is
// closed; each lists the same options.
const multiSelect = `<style>
    .ant-select { position: relative; width: 240px; height: 28px; border: 1px solid #ccc; margin-bottom: 12px; }
    .ant-select input { width: 100%; height: 26px; border: 0; }
    .ant-select-dropdown { position: absolute; top: 120px; left: 300px; width: 200px; background: #fff; border: 1px solid #ccc; z-index: 1050; }
    .ant-select-dropdown-hidden { display: none; }
    .ant-select-item-option { padding: 5px 12px; cursor: pointer; }
  </style>
  <h1>Edit contact</h1>
  <div class="ant-col"><div>Tags</div><div class="ant-select ant-select-multiple"><input id="tags" role="combobox" type="search" aria-expanded="true" aria-controls="tags_list" value=""></div></div>
  <div class="ant-col"><div>Labels</div><div class="ant-select ant-select-multiple"><input id="labels" role="combobox" type="search" aria-expanded="false" aria-controls="labels_list" value=""></div></div>
  ${['tags', 'labels'].map((id) => `<div class="ant-select-dropdown${id === 'labels' ? ' ant-select-dropdown-hidden' : ''}" id="${id}_dropdown"><div role="listbox" id="${id}_list" style="height:0;width:0;overflow:hidden"></div>
    ${['Acme', 'Beta', 'Gamma'].map((name) => `<div aria-selected="${id === 'tags' && name === 'Acme'}" class="ant-select-item ant-select-item-option" title="${name}">${name}</div>`).join('')}</div>`).join('')}
  <script>
    window.clicks = [];
    for (const o of document.querySelectorAll('.ant-select-item-option')) o.addEventListener('click', () => {
      window.clicks.push(o.parentElement.id + ':' + o.title);
      o.setAttribute('aria-selected', String(o.getAttribute('aria-selected') !== 'true'));
    });
  </script>`;
const markChosen = (page, name, chosen) => page.evaluate(([n, c]) => document.querySelector(`#tags_dropdown [title="${n}"]`).setAttribute('aria-selected', String(c)), [name, chosen]);

test('an option the page chooses on its own after Jev looked is not clicked, so the multi-select keeps it', async ({ page }, testInfo) => {
  await page.setContent(multiSelect);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    async (state, questions) => {
      seen.offered = Object.values(questions.select_target?.criteria || {}).map((c) => c.choose_option).filter(Boolean);
      const answer = decision({ tool: 'select', target: `${pick((e) => e.label === 'Tags')(state)}>${pick((e) => e.role === 'option' && e.label === 'Beta')(state)}` });
      // A late update chooses Beta after Jev looked, before the click.
      await markChosen(page, 'Beta', true);
      return answer;
    },
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Tag the contact Beta', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    // Acme is chosen already, so the open list offers Beta and Gamma.
    expect(seen.offered).toEqual(['Beta', 'Gamma']);
    expect(result.actions[0]).toEqual({ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: the option is already chosen' });
    expect(result.pending_actions).toBeUndefined();
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
    await expect(page.locator('#tags_dropdown [title="Beta"]')).toHaveAttribute('aria-selected', 'true');
  } finally { await mcp.close(); }
});

test('before input, an option from an open list must still be unchosen and listed under the same open combobox', async ({ page }) => {
  await page.setContent(multiSelect);
  const { driver, id } = await driverFor(page);
  // The click Jev's SELECT on Tags' list becomes (see the runtime).
  const listed = async (name) => {
    const seen = await driver.observe(id);
    const box = seen.elements.find((e) => e.label === 'Tags');
    const option = seen.elements.find((e) => e.role === 'option' && e.label === name);
    expect(option.popup_of).toBe(box.i);
    return { tool: 'click', chosen_as: 'select', listed_in: box, target: option.i, el: option, observedUrl: seen.url };
  };
  const notListed = 'STALE_TARGET: the option is no longer listed under the combobox it was chosen from';
  try {
    // Chosen after the check, before the journal: refused, nothing journaled.
    let action = await listed('Beta');
    await driver.assertTargetFresh(id, action);
    await markChosen(page, 'Beta', true);
    let journaled = 0;
    let result = await driver.perform(id, action, action.el, { beforeDispatch: async () => { journaled++; } });
    expect([result.state, result.error, journaled]).toEqual(['predispatch_rejected', 'STALE_TARGET: the option is already chosen', 0]);
    // Chosen while the journal is written: still refused before input.
    await markChosen(page, 'Beta', false);
    action = await listed('Beta');
    await driver.assertTargetFresh(id, action);
    result = await driver.perform(id, action, action.el, { beforeDispatch: () => markChosen(page, 'Beta', true) });
    expect([result.state, result.error]).toEqual(['predispatch_rejected', 'STALE_TARGET: the option is already chosen']);
    // Its combobox closed, its list still drawn: refused at the check, before
    // the journal, and while the journal is written.
    await markChosen(page, 'Beta', false);
    const close = () => page.evaluate(() => document.querySelector('#tags').setAttribute('aria-expanded', 'false'));
    const reopen = () => page.evaluate(() => document.querySelector('#tags').setAttribute('aria-expanded', 'true'));
    action = await listed('Beta');
    await driver.assertTargetFresh(id, action);
    await close();
    journaled = 0;
    result = await driver.perform(id, action, action.el, { beforeDispatch: async () => { journaled++; } });
    expect([result.state, result.error, journaled]).toEqual(['predispatch_rejected', notListed, 0]);
    await reopen();
    action = await listed('Beta');
    await driver.assertTargetFresh(id, action);
    result = await driver.perform(id, action, action.el, { beforeDispatch: close });
    expect([result.state, result.error]).toEqual(['predispatch_rejected', notListed]);
    await reopen();
    action = await listed('Beta');
    await close();
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(notListed);
    // The same options now show under Labels.
    await page.evaluate(() => {
      document.querySelector('#tags_dropdown').classList.add('ant-select-dropdown-hidden');
      document.querySelector('#labels_dropdown').classList.remove('ant-select-dropdown-hidden');
      document.querySelector('#labels').setAttribute('aria-expanded', 'true');
    });
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(notListed);
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
    // Tags open again: an option it lists unchosen is clicked.
    await page.evaluate(() => {
      document.querySelector('#labels_dropdown').classList.add('ant-select-dropdown-hidden');
      document.querySelector('#labels').setAttribute('aria-expanded', 'false');
      document.querySelector('#tags_dropdown').classList.remove('ant-select-dropdown-hidden');
      document.querySelector('#tags').setAttribute('aria-expanded', 'true');
    });
    action = await listed('Gamma');
    await driver.assertTargetFresh(id, action);
    expect((await driver.perform(id, action, action.el)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => window.clicks)).toEqual(['tags_dropdown:Gamma']);
  } finally { await driver.close(); }
});

// Two antd selects with the same caption: identical controls. The first is
// open and empty; the second is closed and shows `shown` when given. Each
// lists the same options.
const twinTags = (shown) => `<style>
    .ant-select { position: relative; width: 240px; height: 28px; border: 1px solid #ccc; margin-bottom: 12px; }
    .ant-select input { width: 100%; height: 26px; border: 0; }
    .ant-select-dropdown { position: absolute; top: 140px; left: 300px; width: 200px; background: #fff; border: 1px solid #ccc; z-index: 1050; }
    .ant-select-dropdown-hidden { display: none; }
    .ant-select-item-option { padding: 5px 12px; cursor: pointer; }
  </style>
  <h1>Edit contact</h1>
  ${['a', 'b'].map((id) => `<div class="ant-col"><div>Tags</div><div class="ant-select ant-select-multiple"><div class="ant-select-selector">${id === 'b' && shown ? `<span class="ant-select-selection-item" title="${shown}">${shown}</span>` : ''}<span class="ant-select-selection-search"><input id="${id}" role="combobox" type="search" aria-expanded="${id === 'a'}" aria-controls="${id}_list" value=""></span></div></div></div>`).join('')}
  ${['a', 'b'].map((id) => `<div class="ant-select-dropdown${id === 'b' ? ' ant-select-dropdown-hidden' : ''}" id="${id}_dropdown"><div role="listbox" id="${id}_list" style="height:0;width:0;overflow:hidden"></div>
    ${['Acme', 'Beta', 'Gamma'].map((name) => `<div aria-selected="false" class="ant-select-item ant-select-item-option" title="${name}">${name}</div>`).join('')}</div>`).join('')}
  <script>
    window.clicks = [];
    for (const o of document.querySelectorAll('.ant-select-item-option')) o.addEventListener('click', () => {
      window.clicks.push(o.parentElement.id + ':' + o.title);
      o.setAttribute('aria-selected', String(o.getAttribute('aria-selected') !== 'true'));
    });
  </script>`;
const chooseUnderFirst = (state) => decision({ tool: 'select', target: `${state.page.elements.find((e) => e.role === 'combobox' && e.expanded)?.i}>${pick((e) => e.role === 'option' && e.label === 'Beta')(state)}` });

// Codex on ac65567: the open list moved from the chosen select to its twin
// after Jev looked. The twin's identical option is the only one shown, and
// its select matches the chosen one's identity. The chosen select is found by
// what it shows (nothing), not by being the open one; it is closed now.
test('an option is not clicked once its list has moved to an identical combobox', async ({ page }, testInfo) => {
  await page.setContent(twinTags('Urgent'));
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    async (state) => {
      const answer = chooseUnderFirst(state);
      await page.evaluate(() => {
        document.querySelector('#a').setAttribute('aria-expanded', 'false');
        document.querySelector('#a_dropdown').classList.add('ant-select-dropdown-hidden');
        document.querySelector('#b').setAttribute('aria-expanded', 'true');
        document.querySelector('#b_dropdown').classList.remove('ant-select-dropdown-hidden');
      });
      return answer;
    },
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Tag the contact Beta', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.actions[0]).toEqual({ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: the option is no longer listed under the combobox it was chosen from' });
    expect(result.pending_actions).toBeUndefined();
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
  } finally { await mcp.close(); }
});

// Twins that nothing tells apart but which one is open: an option from the
// open one's list is refused, as the open list could move to the other.
test('an option listed under one of two identical comboboxes nothing tells apart is refused, and the run stops as ambiguous', async ({ page }, testInfo) => {
  await page.setContent(twinTags());
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([chooseUnderFirst]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Tag the contact Beta', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('ambiguous');
    expect(result.info).toMatch(/^Jev chose option "Beta" from the list of one of several identical comboboxes on this page, and nothing tells them apart, so no input was sent/);
    expect(result.actions.map((a) => a.detail ?? a.error)).toEqual(["STALE_TARGET: ambiguous: the option's combobox has identical twins", "STALE_TARGET: ambiguous: the option's combobox has identical twins"]);
    expect(result.pending_actions).toBeUndefined();
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
  } finally { await mcp.close(); }
});

// ccMonet's invoice form (Mac rerun, 2026-10-19): with the Customer list open,
// Jev chose SELECT on "Currency :", which that list covers. The click that
// would open it waited after the journal until it timed out, and left a
// pending action. It is now tried before the journal: no input, nothing
// pending, and Jev looks again knowing what covers the target. Two such
// refusals in a row stop the run.
const covered = `<style>
    .ant-select { position: relative; width: 240px; height: 28px; border: 1px solid #ccc; margin-bottom: 12px; }
    .ant-select input { width: 100%; height: 26px; border: 0; }
    .ant-select-dropdown { position: absolute; width: 280px; height: 120px; background: #fff; border: 1px solid #ccc; z-index: 1050; }
  </style>
  <h1>New invoice</h1>
  <div class="ant-col"><div>Customer</div><div class="ant-select"><input id="customer" role="combobox" type="search" aria-expanded="true" aria-controls="customer_list" value="Acme"></div></div>
  <div class="ant-col"><div>Currency :</div><div class="ant-select" id="currency-box"><input id="currency" role="combobox" type="search" aria-expanded="false" aria-controls="currency_list" value=""></div></div>
  <div class="ant-select-dropdown"><div><div role="listbox" id="customer_list" style="height:0;width:0;overflow:hidden"></div>
    <div aria-selected="false" class="ant-select-item ant-select-item-option" title="Acme Ltd">Acme Ltd</div></div></div>
  <script>
    const box = document.querySelector('#currency-box').getBoundingClientRect();
    Object.assign(document.querySelector('.ant-select-dropdown').style, { top: box.top - 20 + 'px', left: box.left - 20 + 'px' });
    document.querySelector('#currency').addEventListener('mousedown', (e) => e.target.setAttribute('aria-expanded', 'true'));
    document.querySelector('.ant-select-item-option').addEventListener('click', () => {
      Object.assign(document.querySelector('#customer'), { value: 'Acme Ltd' }).setAttribute('aria-expanded', 'false');
      document.querySelector('.ant-select-dropdown').style.display = 'none';
    });
  </script>`;

const covering = 'the target is covered by another element (<div class="ant-select-dropdown">); no input was sent';
const currency = (state) => decision({ tool: 'select', target: pick((e) => e.label === 'Currency')(state) });

test('SELECT on a combobox that an open list covers is refused before any input; Jev looks again and picks from the list', async ({ page }, testInfo) => {
  await page.setContent(covered);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    currency,
    (state) => {
      seen.history = state.task.history.at(-1);
      return decision({ tool: 'select', target: `${pick((e) => e.label === 'Customer')(state)}>${pick((e) => e.role === 'option')(state)}` });
    },
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Choose customer Acme Ltd on the new invoice', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(seen.history).toEqual({ recovery: 'reobserve', reason: 'target_covered', input_sent: false, detail: covering });
    expect(result.actions.map((a) => [a.action ?? a.recovery, a.element ?? a.reason, a.effect?.status])).toEqual([
      ['reobserve', 'target_covered', undefined],
      ['click', 'option "Acme Ltd"', 'changed'],
    ]);
    expect(result.pending_actions).toBeUndefined();
    await expect(page.locator('#currency')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#customer')).toHaveValue('Acme Ltd');
  } finally { await mcp.close(); }
});

// The third same choice on the same page is not tried again.
test('a target chosen again while it stays covered stops the run with nothing pending', async ({ page }, testInfo) => {
  await page.setContent(covered);
  const again = await mcpFixture(page, testInfo, scriptedDecider([currency]));
  try {
    const result = await again.call('browser_run', { tab_id: again.id, goal: 'Choose customer Acme Ltd on the new invoice', verification_mode: 'host', max_actions: 5, evidence_level: 'none' });
    expect(result.status).toBe('stuck');
    expect(result.actions.map((a) => [a.action ?? a.recovery, a.error ?? a.detail])).toEqual([['reobserve', covering], ['reobserve', covering]]);
    expect(result.pending_actions).toBeUndefined();
    await expect(page.locator('#currency')).toHaveAttribute('aria-expanded', 'false');
  } finally { await again.close(); }
});

// A button that never holds still: the browser waits for it to stop moving
// until its timeout. No input was sent, so nothing is pending.
test('a target that never becomes ready is refused before any input', async ({ page }, testInfo) => {
  await page.setContent(`<style>@keyframes shake { from { transform: translateX(0) } to { transform: translateX(40px) } }</style>
    <h1>Report</h1><button style="animation: shake 0.2s infinite alternate">Generate</button>`);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([(state) => decision({ tool: 'click', target: pick((e) => e.label === 'Generate')(state) })]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the report', verification_mode: 'host', max_actions: 2, evidence_level: 'none' });
    expect(result.status).toBe('action_failed');
    expect(result.info).toMatch(/^The browser refused this action before sending any input/);
    expect(result.actions.map((a) => [a.action, a.error])).toEqual([['click', 'the target never became ready for input; no input was sent']]);
    expect(result.pending_actions).toBeUndefined();
  } finally { await mcp.close(); }
});
