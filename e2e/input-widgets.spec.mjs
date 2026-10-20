// Input widgets that keep their own copy of a field's value. The date picker
// below follows bootstrap-datepicker 1.9 (Selenium's web form): it parses the
// field on keyup and, on blur, writes its own parsed value back.
import { test, expect } from '@playwright/test';
import { driverFor, mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';
import { twinsOf } from '../src/element-identity.mjs';

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

// A country select that searches inside names, as many do: "US" lists only
// Australia, which holds it inside a word. Once Australia is picked, the
// field stays open to typing, so the right country can be searched for.
const countrySelect = drawerSelect.replaceAll('Acme Ltd', 'Australia').replaceAll('Beta LLC', 'United States')
  .replace('<div>Customer</div>', '<div>Country</div>').replace('Select a customer', 'Select a country');

test('an option that holds the typed text only inside a word leaves the field open to typing', async ({ page }, testInfo) => {
  await page.setContent(countrySelect);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'type', target: pick((e) => e.label === 'Country')(state) }),
    (state) => decision({ tool: 'click', target: pick((e) => e.role === 'option' && e.label === 'Australia')(state) }),
    (state, questions) => {
      seen.picked = { country: state.page.elements.find((e) => e.label === 'Country'), typable: Object.values(questions.type_target?.criteria || {}).map((c) => c.control) };
      return decision({ tool: 'none', done: 0.99 });
    },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Set the invoice country to US', values: { country: 'US' }, verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
    expect(result.actions.map((a) => [a.action, a.element, a.effect?.status])).toEqual([['type', 'combobox "Country"', 'confirmed'], ['click', 'option "Australia"', 'changed']]);
    expect(seen.picked.country).toMatchObject({ value: '', display: 'Australia' });
    expect(seen.picked.typable).toEqual(['[0] combobox "Country"', '[1] textbox "Reference"']);
  } finally { await mcp.close(); }
});

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

// Jev chooses Beta from Tags' open list: with SELECT, or with a click on the
// option, which the CLICK head offers too.
const betaFromTags = (how) => (state) => {
  const beta = pick((e) => e.role === 'option' && e.label === 'Beta')(state);
  return decision(how === 'select' ? { tool: 'select', target: `${pick((e) => e.label === 'Tags')(state)}>${beta}` } : { tool: 'click', target: beta });
};

for (const how of ['select', 'click']) {
  test(`an option the page chooses on its own after Jev looked is not clicked, so the multi-select keeps it (${how})`, async ({ page }, testInfo) => {
    await page.setContent(multiSelect);
    const seen = {};
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      async (state, questions) => {
        seen.offered = Object.values(questions.select_target?.criteria || {}).map((c) => c.choose_option).filter(Boolean);
        const answer = betaFromTags(how)(state);
        // A late update chooses Beta after Jev looked, before the click.
        await markChosen(page, 'Beta', true);
        return answer;
      },
      { tool: 'none', done: 0.99 },
    ]));
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Tag the contact Beta', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
      expect(await page.evaluate(() => window.clicks)).toEqual([]);
      await expect(page.locator('#tags_dropdown [title="Beta"]')).toHaveAttribute('aria-selected', 'true');
      // Acme is chosen already, so the open list offers Beta and Gamma.
      expect(seen.offered).toEqual(['Beta', 'Gamma']);
      expect(result.actions[0]).toEqual({ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: the option is already chosen' });
      expect(result.pending_actions).toBeUndefined();
    } finally { await mcp.close(); }
  });
}

// A click on a chosen option of a multi-select takes it out. Jev's click to
// take Acme out is sent while Acme is still chosen. Once the page has taken
// Acme out on its own after Jev looked, that click would put it back.
for (const late of [false, true]) {
  test(`a click Jev chooses to take an option out of a multi-select ${late ? 'is not sent once the page has taken it out on its own' : 'is sent while the option is still chosen'}`, async ({ page }, testInfo) => {
    await page.setContent(multiSelect);
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      async (state) => {
        const answer = decision({ tool: 'click', target: pick((e) => e.role === 'option' && e.label === 'Acme')(state) });
        if (late) await markChosen(page, 'Acme', false);
        return answer;
      },
      { tool: 'none', done: 0.99 },
    ]));
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: "Take the Acme tag off the contact", verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
      expect(await page.evaluate(() => window.clicks)).toEqual(late ? [] : ['tags_dropdown:Acme']);
      await expect(page.locator('#tags_dropdown [title="Acme"]')).toHaveAttribute('aria-selected', 'false');
      if (late) expect(result.actions[0]).toEqual({ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: the option is no longer chosen' });
    } finally { await mcp.close(); }
  });
}

// Tags and Labels list the same names, and the open list floats apart from
// Tags. The guards must see which field a choice changes: a rule about Tags
// stops "Beta" chosen under Tags, whether Jev chose it with SELECT or a click.
for (const how of ['select', 'click']) {
  test(`the guards see which combobox an option from its open list changes, so a rule about that field stops it (${how})`, async ({ page }, testInfo) => {
    await page.setContent(multiSelect);
    const judged = {};
    const steps = scriptedDecider([betaFromTags(how)]);
    const decider = async (state, questions) => {
      if (questions.action_side_effect) {
        judged.effects = state.proposed_action;
        return { answers: { action_side_effect: { noul: 0.01 }, action_irreversible: { noul: 0.01 } }, ms: 1, tokens: 1 };
      }
      if (questions.violates) {
        const p = judged.constraint = state.proposed_action;
        const field = p.tool === 'select' ? p.element : p.option_of?.element;
        return { answers: { violates: { noul: field === 'combobox "Tags"' ? 0.99 : 0.01 } }, ms: 1, tokens: 1 };
      }
      return steps(state, questions);
    };
    const mcp = await mcpFixture(page, testInfo, decider);
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Label the contact Beta', constraints: ["Do not change the contact's Tags"], verification_mode: 'host', max_actions: 2, evidence_level: 'none' });
      expect(await page.evaluate(() => window.clicks)).toEqual([]);
      expect(result.status).toBe('constraint_blocked');
      expect(result.pending_actions).toBeUndefined();
      const seen = how === 'select'
        ? { tool: 'select', element: 'combobox "Tags"', selected_option: { text: 'Beta' } }
        : { tool: 'click', element: 'option "Beta"', option_of: expect.objectContaining({ element: 'combobox "Tags"' }), selected: false };
      expect(judged.effects).toMatchObject(seen);
      expect(judged.constraint).toMatchObject(seen);
    } finally { await mcp.close(); }
  });
}

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

test('before input, an option Jev clicks in an open list must still be chosen or unchosen as Jev saw it', async ({ page }) => {
  await page.setContent(multiSelect);
  const { driver, id } = await driverFor(page);
  // A click Jev chooses on an option of Tags' open list (see the runtime).
  const clickListed = async (name) => {
    const seen = await driver.observe(id);
    const box = seen.elements.find((e) => e.label === 'Tags');
    const option = seen.elements.find((e) => e.role === 'option' && e.label === name);
    expect(option.popup_of).toBe(box.i);
    return { tool: 'click', listed_in: box, target: option.i, el: option, observedUrl: seen.url };
  };
  const unchosen = 'STALE_TARGET: the option is no longer chosen';
  try {
    // Jev clicks chosen Acme to take it out. Taken out after the check,
    // before the journal: refused, nothing journaled.
    let action = await clickListed('Acme');
    await driver.assertTargetFresh(id, action);
    await markChosen(page, 'Acme', false);
    let journaled = 0;
    let result = await driver.perform(id, action, action.el, { beforeDispatch: async () => { journaled++; } });
    expect([result.state, result.error, journaled]).toEqual(['predispatch_rejected', unchosen, 0]);
    // Taken out while the journal is written: still refused before input.
    await markChosen(page, 'Acme', true);
    action = await clickListed('Acme');
    await driver.assertTargetFresh(id, action);
    result = await driver.perform(id, action, action.el, { beforeDispatch: () => markChosen(page, 'Acme', false) });
    expect([result.state, result.error]).toEqual(['predispatch_rejected', unchosen]);
    // Taken out before the check.
    await markChosen(page, 'Acme', true);
    action = await clickListed('Acme');
    await markChosen(page, 'Acme', false);
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(unchosen);
    // Unchosen Beta, chosen after the check: refused as a SELECT of it is.
    action = await clickListed('Beta');
    await driver.assertTargetFresh(id, action);
    await markChosen(page, 'Beta', true);
    result = await driver.perform(id, action, action.el);
    expect([result.state, result.error]).toEqual(['predispatch_rejected', 'STALE_TARGET: the option is already chosen']);
    // Its combobox closed: refused, as for SELECT.
    action = await clickListed('Gamma');
    await page.evaluate(() => document.querySelector('#tags').setAttribute('aria-expanded', 'false'));
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow('STALE_TARGET: the option is no longer listed under the combobox it was chosen from');
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
    // As Jev saw it, chosen: the click takes Beta out.
    await page.evaluate(() => document.querySelector('#tags').setAttribute('aria-expanded', 'true'));
    action = await clickListed('Beta');
    await driver.assertTargetFresh(id, action);
    expect((await driver.perform(id, action, action.el)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => window.clicks)).toEqual(['tags_dropdown:Beta']);
    await expect(page.locator('#tags_dropdown [title="Beta"]')).toHaveAttribute('aria-selected', 'false');
  } finally { await driver.close(); }
});

// The host's own click (browser_act) on an option the snapshot showed in an
// open list is checked the same way, against that snapshot.
test('browser_act clicks an option of an open list only while it is listed under the combobox the snapshot showed, chosen or not as shown', async ({ page }, testInfo) => {
  await page.setContent(multiSelect);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([]));
  const option = async (name) => {
    await mcp.runtime.snapshotText(mcp.id);
    return mcp.runtime.shown.elements.find((e) => e.role === 'option' && e.label === name).i;
  };
  const click = (element) => mcp.call('browser_act', { tab_id: mcp.id, action: 'click', element });
  const showList = (id, open) => page.evaluate(([id, open]) => {
    document.querySelector(`#${id}`).setAttribute('aria-expanded', String(open));
    document.querySelector(`#${id}_dropdown`).classList.toggle('ant-select-dropdown-hidden', !open);
  }, [id, open]);
  try {
    // Chosen by the page after the snapshot: a click would take it out.
    let beta = await option('Beta');
    await markChosen(page, 'Beta', true);
    await expect(click(beta)).rejects.toThrow('STALE_ELEMENT: option "Beta" is chosen now. Take a new browser_snapshot.');
    // The same options now listed under Labels, Tags closed.
    await markChosen(page, 'Beta', false);
    beta = await option('Beta');
    await showList('tags', false);
    await showList('labels', true);
    await expect(click(beta)).rejects.toThrow('STALE_ELEMENT: option "Beta" is no longer listed under the open combobox "Tags". Take a new browser_snapshot.');
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
    // Listed under Tags as the snapshot showed: clicked.
    await showList('labels', false);
    await showList('tags', true);
    await click(await option('Gamma'));
    expect(await page.evaluate(() => window.clicks)).toEqual(['tags_dropdown:Gamma']);
  } finally { await mcp.close(); }
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
// Jev chooses Beta from the open list: with SELECT on the open combobox, or
// with a click on the option.
const betaUnderOpen = (how) => (state) => {
  const beta = pick((e) => e.role === 'option' && e.label === 'Beta')(state);
  return decision(how === 'select' ? { tool: 'select', target: `${state.page.elements.find((e) => e.role === 'combobox' && e.expanded)?.i}>${beta}` } : { tool: 'click', target: beta });
};

for (const how of ['select', 'click']) {
  // Codex on ac65567: the open list moved from the chosen select to its twin
  // after Jev looked. The twin's identical option is the only one shown, and
  // its select matches the chosen one's identity. The chosen select is found
  // by what it shows (nothing), not by being the open one; it is closed now.
  test(`an option is not clicked once its list has moved to an identical combobox (${how})`, async ({ page }, testInfo) => {
    await page.setContent(twinTags('Urgent'));
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      async (state) => {
        const answer = betaUnderOpen(how)(state);
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
      expect(await page.evaluate(() => window.clicks)).toEqual([]);
      expect(result.actions[0]).toEqual({ recovery: 'reobserve', reason: 'stale_target', input_sent: false, detail: 'STALE_TARGET: the option is no longer listed under the combobox it was chosen from' });
      expect(result.pending_actions).toBeUndefined();
    } finally { await mcp.close(); }
  });

  // Twins that nothing tells apart but which one is open: an option from the
  // open one's list is refused, as the open list could move to the other.
  test(`an option listed under one of two identical comboboxes nothing tells apart is refused, and the run stops as ambiguous (${how})`, async ({ page }, testInfo) => {
    await page.setContent(twinTags());
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([betaUnderOpen(how)]));
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Tag the contact Beta', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
      expect(await page.evaluate(() => window.clicks)).toEqual([]);
      expect(result.status).toBe('ambiguous');
      expect(result.info).toMatch(/^Jev chose option "Beta" from the list of one of several identical comboboxes on this page, and nothing tells them apart, so no input was sent/);
      expect(result.actions.map((a) => a.detail ?? a.error)).toEqual(["STALE_TARGET: ambiguous: the option's combobox has identical twins", "STALE_TARGET: ambiguous: the option's combobox has identical twins"]);
      expect(result.pending_actions).toBeUndefined();
    } finally { await mcp.close(); }
  });
}

// The same for the host's own click: in the snapshot, only which one is open
// tells the two comboboxes apart.
test('browser_act does not click an option listed under one of two identical comboboxes nothing tells apart', async ({ page }, testInfo) => {
  await page.setContent(twinTags());
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([]));
  try {
    await mcp.runtime.snapshotText(mcp.id);
    const beta = mcp.runtime.shown.elements.find((e) => e.role === 'option' && e.label === 'Beta').i;
    await expect(mcp.call('browser_act', { tab_id: mcp.id, action: 'click', element: beta })).rejects.toThrow("STALE_TARGET: ambiguous: the option's combobox has identical twins");
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
  } finally { await mcp.close(); }
});

// A combobox with no ARIA link to its list, as some in-house widgets draw
// one: the list floats just under it. A bulk-actions menu floats at the
// bottom right of the page, its entries options too.
const inHouseCombo = `<style>
    .combo { width: 240px; height: 28px; border: 1px solid #ccc; }
    .combo input { width: 100%; height: 26px; border: 0; }
    .menu { position: absolute; width: 240px; background: #fff; border: 1px solid #ccc; }
    .menu div { padding: 5px 12px; cursor: pointer; }
  </style>
  <h1>Edit contact</h1>
  <div><div>Country</div><div class="combo"><input role="combobox" aria-expanded="true" value=""></div></div>
  <label>Notes <input name="notes"></label>
  <div class="menu" id="country_menu">${['Canada', 'France'].map((n) => `<div role="option" aria-selected="false">${n}</div>`).join('')}</div>
  <div class="menu" style="position: fixed; right: 16px; bottom: 16px">${['Delete all', 'Archive all'].map((n) => `<div role="option" aria-selected="false">${n}</div>`).join('')}</div>
  <script>
    window.clicks = [];
    window.underCombo = () => { const box = document.querySelector('.combo').getBoundingClientRect(); Object.assign(document.querySelector('#country_menu').style, { top: box.bottom + 4 + 'px', left: box.left + 'px' }); };
    underCombo();
    for (const o of document.querySelectorAll('[role=option]')) o.addEventListener('click', () => window.clicks.push(o.textContent));
  </script>`;

// Codex on b417c55: with no link, an option belonged to the one open
// combobox wherever it floated, so SELECT could click a menu entry.
test('an option floating away from the one open combobox is not its option, so SELECT never offers it', async ({ page }, testInfo) => {
  await page.setContent(inHouseCombo);
  const seen = {};
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state, questions) => {
      const box = pick((e) => e.role === 'combobox')(state);
      seen.owners ??= state.page.elements.filter((e) => e.role === 'option').map((e) => [e.label, e.popup_of === box]);
      seen.offered ??= Object.values(questions.select_target?.criteria || {}).map((c) => c.choose_option).filter(Boolean);
      return decision({ tool: 'none', done: 0.99 });
    },
  ]));
  try {
    await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Set the country to France', verification_mode: 'host', max_actions: 2, evidence_level: 'none' });
    expect(seen.owners).toEqual([['Canada', true], ['France', true], ['Delete all', false], ['Archive all', false]]);
    expect(seen.offered).toEqual(['Canada', 'France']);
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
  } finally { await mcp.close(); }
});

test('before input, an option of an unlinked list must still be drawn against its combobox', async ({ page }) => {
  await page.setContent(inHouseCombo);
  const { driver, id } = await driverFor(page);
  const listed = async (name) => {
    const seen = await driver.observe(id);
    const box = seen.elements.find((e) => e.role === 'combobox');
    const option = seen.elements.find((e) => e.role === 'option' && e.label === name);
    expect(option.popup_of).toBe(box.i);
    return { tool: 'click', chosen_as: 'select', listed_in: box, target: option.i, el: option, observedUrl: seen.url };
  };
  const away = () => page.evaluate(() => { document.querySelector('#country_menu').style.top = '520px'; });
  const notListed = 'STALE_TARGET: the option is no longer listed under the combobox it was chosen from';
  try {
    // The list moved away after the check: refused before the journal.
    let action = await listed('France');
    await driver.assertTargetFresh(id, action);
    await away();
    let journaled = 0;
    let result = await driver.perform(id, action, action.el, { beforeDispatch: async () => { journaled++; } });
    expect([result.state, result.error, journaled]).toEqual(['predispatch_rejected', notListed, 0]);
    // Seen there, its options belong to no combobox.
    expect((await driver.observe(id)).elements.find((e) => e.label === 'France').popup_of).toBeUndefined();
    // The list moved away while the journal was written: refused before the click.
    await page.evaluate(() => window.underCombo());
    action = await listed('France');
    await driver.assertTargetFresh(id, action);
    result = await driver.perform(id, action, action.el, { beforeDispatch: away });
    expect([result.state, result.error]).toEqual(['predispatch_rejected', notListed]);
    expect(await page.evaluate(() => window.clicks)).toEqual([]);
    // Drawn against it: clicked.
    await page.evaluate(() => window.underCombo());
    action = await listed('France');
    await driver.assertTargetFresh(id, action);
    expect((await driver.perform(id, action, action.el)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => window.clicks)).toEqual(['France']);
  } finally { await driver.close(); }
});

// Codex on b228cae: a second combobox that is open but hidden from view is
// not one the snapshot counts as open, so it still links the unlinked list
// to the visible one. The check before the click does not count it either.
const hiddenOpenBox = {
  'aria-hidden, as a dialog hides its background': '<div aria-hidden="true"><input role="combobox" aria-expanded="true" aria-label="Region"></div>',
  'inert': '<div inert><input role="combobox" aria-expanded="true" aria-label="Region"></div>',
  'visibility: hidden': '<div style="visibility: hidden"><input role="combobox" aria-expanded="true" aria-label="Region"></div>',
  'clipped to 1px': '<div style="position: absolute; width: 1px; height: 1px; overflow: hidden"><input role="combobox" aria-expanded="true" aria-label="Region"></div>',
};
for (const [how, html] of Object.entries(hiddenOpenBox)) {
  test(`an option of an unlinked list is clicked though another open combobox is hidden (${how})`, async ({ page }) => {
    await page.setContent(inHouseCombo + html);
    const { driver, id } = await driverFor(page);
    try {
      const seen = await driver.observe(id);
      const box = seen.elements.find((e) => e.role === 'combobox');
      const option = seen.elements.find((e) => e.role === 'option' && e.label === 'France');
      expect(seen.elements.filter((e) => e.role === 'combobox').map((e) => e.label)).toEqual(['Country']);
      expect(option.popup_of).toBe(box.i);
      const action = { tool: 'click', chosen_as: 'select', listed_in: box, target: option.i, el: option, observedUrl: seen.url };
      await driver.assertTargetFresh(id, action);
      expect((await driver.perform(id, action, action.el)).state).toBe('dispatched_ack');
      expect(await page.evaluate(() => window.clicks)).toEqual(['France']);
    } finally { await driver.close(); }
  });
}

// Web components keep their parts in an open shadow root, which the snapshot
// reads through. A combobox inside one with its list drawn on the page, and a
// combobox on the page with its list inside a floating component.
const shadowWidgets = {
  'a combobox inside a web component': `<style>.menu { position: absolute; width: 240px; background: #fff; border: 1px solid #ccc; } .menu div { padding: 5px 12px; }</style>
    <h1>Order</h1><div>Fruit</div><x-combo></x-combo>
    <div class="menu" id="list">${['Apple', 'Pear'].map((n) => `<div role="option" aria-selected="false">${n}</div>`).join('')}</div>
    <script>
      customElements.define('x-combo', class extends HTMLElement {
        connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = '<div style="width:240px;height:28px;border:1px solid #ccc"><input role="combobox" aria-expanded="true" style="width:100%;height:26px;border:0"></div>'; }
      });
      window.clicks = [];
      const box = document.querySelector('x-combo').getBoundingClientRect();
      Object.assign(document.querySelector('#list').style, { top: box.bottom + 4 + 'px', left: box.left + 'px' });
      for (const o of document.querySelectorAll('[role=option]')) o.addEventListener('click', () => window.clicks.push(o.textContent));
    </script>`,
  'a list inside a floating web component': `<h1>Order</h1><div>Fruit</div>
    <div style="width:240px;height:28px;border:1px solid #ccc"><input role="combobox" aria-expanded="true" style="width:100%;height:26px;border:0"></div>
    <x-menu style="position:absolute;width:240px;background:#fff;border:1px solid #ccc"></x-menu>
    <script>
      window.clicks = [];
      customElements.define('x-menu', class extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = ['Apple', 'Pear'].map((n) => '<div role="option" aria-selected="false" style="padding:5px 12px">' + n + '</div>').join('');
          for (const o of root.querySelectorAll('[role=option]')) o.addEventListener('click', () => window.clicks.push(o.textContent));
        }
      });
      const box = document.querySelector('input').getBoundingClientRect();
      Object.assign(document.querySelector('x-menu').style, { top: box.bottom + 4 + 'px', left: box.left + 'px' });
    </script>`,
};

for (const [what, html] of Object.entries(shadowWidgets)) {
  test(`with ${what}, the option the snapshot lists under the open combobox is clicked`, async ({ page }) => {
    await page.setContent(html);
    const { driver, id } = await driverFor(page);
    try {
      const seen = await driver.observe(id);
      const box = seen.elements.find((e) => e.role === 'combobox');
      const option = seen.elements.find((e) => e.role === 'option' && e.label === 'Pear');
      expect(option.popup_of).toBe(box.i);
      const action = { tool: 'click', chosen_as: 'select', listed_in: box, target: option.i, el: option, observedUrl: seen.url };
      await driver.assertTargetFresh(id, action);
      const result = await driver.perform(id, action, action.el);
      expect([result.state, result.error]).toEqual(['dispatched_ack', undefined]);
      expect(await page.evaluate(() => window.clicks)).toEqual(['Pear']);
    } finally { await driver.close(); }
  });
}

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
    expect(result.actions.map((a) => [a.action, a.error])).toEqual([['click', 'the target never became ready for input (it kept moving); no input was sent']]);
    expect(result.pending_actions).toBeUndefined();
  } finally { await mcp.close(); }
});

// antd v5 draws a single select's shown value as a span after its search
// input, positioned (position: relative) and, unlike its placeholder, not
// pointer-events: none, so the value lies over the input. A select with no
// search keeps that input read-only and transparent. ccMonet's bill filter
// (Mac rerun on 95f5f4c): the browser's check before a click on the input
// found the value "Is" on top and waited for it to move until it timed out,
// so SELECT never opened the list. A person clicks the value. Like rc-select,
// a mousedown anywhere in the selector toggles the list.
const antdSelect = ({ id, shown, search = false }) => `<div class="ant-select ant-select-outlined ant-select-single ant-select-show-arrow${search ? ' ant-select-show-search' : ''}">
    <div class="ant-select-selector">
      <span class="ant-select-selection-search"><input type="search" id="${id}" class="ant-select-selection-search-input" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-owns="${id}_list" aria-autocomplete="list" aria-controls="${id}_list" autocomplete="off"${search ? '' : ' readonly unselectable="on" style="opacity:0"'} value=""></span>
      ${shown ? `<span class="ant-select-selection-item" title="${shown}">${shown}</span>` : '<span class="ant-select-selection-placeholder">Select</span>'}
    </div>
    <span class="ant-select-arrow" unselectable="on" aria-hidden="true" style="user-select:none"><span role="img" aria-label="down" class="anticon anticon-down ant-select-suffix"><svg width="12" height="12"></svg></span></span>
  </div>`;
const antdList = (id, names, shown) => `<div class="ant-select-dropdown ant-select-dropdown-hidden" id="${id}_dropdown"><div>
    <div role="listbox" id="${id}_list" style="height:0;width:0;overflow:hidden"></div>
    <div class="rc-virtual-list"><div class="rc-virtual-list-holder-inner">${names.map((n) => `<div aria-selected="${n === shown}" class="ant-select-item ant-select-item-option" title="${n}"><div class="ant-select-item-option-content">${n}</div></div>`).join('')}</div></div>
  </div></div>`;
const filterPopup = ({ value = 'Draft' } = {}) => `<style>
    body { font: 14px sans-serif; }
    .ant-popover { position: absolute; top: 60px; left: 20px; background: #fff; padding: 12px; box-shadow: 0 6px 16px rgba(0,0,0,.08); }
    .filter-row { display: flex; gap: 8px; margin: 8px 0; }
    .ant-select { position: relative; display: inline-flex; cursor: pointer; width: 160px; height: 32px; box-sizing: border-box; }
    .ant-select-single .ant-select-selector { display: flex; position: relative; width: 100%; height: 100%; padding: 0 11px; border: 1px solid #d9d9d9; border-radius: 6px; box-sizing: border-box; background: #fff; }
    .ant-select-single .ant-select-selector .ant-select-selection-search { position: absolute; top: 0; bottom: 0; inset-inline-start: 11px; inset-inline-end: 11px; }
    .ant-select-single .ant-select-selector .ant-select-selection-search-input { width: 100%; height: 30px; padding: 0; margin: 0; border: 0; background: transparent; outline: none; appearance: none; font: inherit; }
    .ant-select .ant-select-selection-item { flex: 1; position: relative; user-select: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 30px; padding-inline-end: 18px; }
    .ant-select .ant-select-selection-placeholder { flex: 1; overflow: hidden; color: rgba(0,0,0,.25); white-space: nowrap; line-height: 30px; pointer-events: none; }
    .ant-select .ant-select-arrow { position: absolute; top: 50%; inset-inline-end: 11px; height: 12px; margin-top: -6px; display: flex; align-items: center; pointer-events: none; }
    .ant-select-dropdown { position: absolute; z-index: 1050; background: #fff; padding: 4px; box-shadow: 0 6px 16px rgba(0,0,0,.08); }
    .ant-select-dropdown-hidden { display: none; }
    .ant-select-item-option { padding: 5px 12px; cursor: pointer; }
  </style>
  <h1>Bills</h1><button>Filter</button>
  <div class="ant-popover"><div class="ant-popover-inner" role="tooltip">
    <div class="ant-popover-title">Filter records</div>
    <div class="filter-row">${antdSelect({ id: 'field', shown: 'Status' })}${antdSelect({ id: 'op', shown: 'Is' })}${antdSelect({ id: 'value', shown: value, search: true })}</div>
    <button>Apply</button>
  </div></div>
  ${antdList('field', ['Status', 'Vendor'], 'Status')}${antdList('op', ['Is', 'Is not'], 'Is')}${antdList('value', ['Draft', 'Paid'], value)}
  <script>
    window.events = [];
    for (const box of document.querySelectorAll('.ant-select')) {
      const input = box.querySelector('input');
      const dropdown = document.getElementById(input.id + '_dropdown');
      const setOpen = (open) => {
        input.setAttribute('aria-expanded', String(open));
        dropdown.classList.toggle('ant-select-dropdown-hidden', !open);
        const r = box.getBoundingClientRect();
        Object.assign(dropdown.style, { top: r.bottom + scrollY + 4 + 'px', left: r.left + scrollX + 'px', width: r.width + 'px' });
      };
      box.querySelector('.ant-select-selector').addEventListener('mousedown', (e) => {
        window.events.push(input.id + ' mousedown on ' + e.target.className);
        if (e.target !== input) e.preventDefault();
        setOpen(input.getAttribute('aria-expanded') !== 'true');
      });
      box.addEventListener('click', (e) => { if (e.target !== input) input.focus(); });
      for (const o of dropdown.querySelectorAll('.ant-select-item-option')) o.addEventListener('click', () => {
        box.querySelector('.ant-select-selection-item, .ant-select-selection-placeholder')
          .replaceWith(Object.assign(document.createElement('span'), { className: 'ant-select-selection-item', title: o.title, textContent: o.title }));
        for (const x of dropdown.querySelectorAll('.ant-select-item-option')) x.setAttribute('aria-selected', String(x === o));
        setOpen(false);
      });
    }
  </script>`;

for (const [what, id, shows] of [['a read-only select', 'op', 'Is'], ['a searchable select', 'value', 'Draft']]) {
  test(`SELECT on ${what} whose shown value lies over its input opens its list with a click on that value`, async ({ page }) => {
    await page.setContent(filterPopup());
    const { driver, id: tab } = await driverFor(page);
    try {
      const seen = await driver.observe(tab);
      const box = seen.elements.find((e) => e.role === 'combobox' && e.display === shows);
      const action = { tool: 'select', target: box.i, el: box, observedUrl: seen.url, observed: { twins: twinsOf(box, seen) } };
      await driver.assertTargetFresh(tab, action);
      const result = await driver.perform(tab, action, action.el);
      expect([result.state, result.error]).toEqual(['dispatched_ack', undefined]);
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-expanded', 'true');
      expect(await page.evaluate(() => window.events)).toEqual([`${id} mousedown on ant-select-selection-item`]);
    } finally { await driver.close(); }
  });
}

// The whole step through browser_run: SELECT opens the operator's list, then
// SELECT chooses "Is not" from it.
test('Jev changes a filter operator whose shown value lies over its input', async ({ page }, testInfo) => {
  await page.setContent(filterPopup());
  const operator = (state) => state.page.elements.find((e) => e.role === 'combobox' && ['Is', 'Is not'].includes(e.display));
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'select', target: operator(state).i }),
    (state) => decision({ tool: 'select', target: `${operator(state).i}>${pick((e) => e.role === 'option' && e.label === 'Is not')(state)}` }),
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Filter bills whose status is not Draft', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(result.actions.map((a) => [a.action, a.error])).toEqual([['select', undefined], ['click', undefined]]);
    await expect(page.locator('.ant-select-selection-item')).toHaveText(['Status', 'Is not', 'Draft']);
    await expect(page.locator('#op')).toHaveAttribute('aria-expanded', 'false');
  } finally { await mcp.close(); }
});

// A realistic TYPE clicks the field first: on a searchable select that shows
// a value, that click lands on the value too, and opens the list.
test('a realistic TYPE into a searchable select that shows a value clicks that value, then types', async ({ page }) => {
  await page.setContent(filterPopup());
  const { driver, id: tab } = await driverFor(page);
  try {
    const seen = await driver.observe(tab);
    const box = seen.elements.find((e) => e.role === 'combobox' && e.display === 'Draft');
    const action = { tool: 'type', target: box.i, el: box, value: 'Pa', observedUrl: seen.url, observed: { twins: twinsOf(box, seen) } };
    await driver.assertTargetFresh(tab, action);
    const result = await driver.perform(tab, action, action.el);
    expect([result.state, result.error]).toEqual(['dispatched_ack', undefined]);
    await expect(page.locator('#value')).toHaveValue('Pa');
    await expect(page.locator('#value')).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => window.events)).toEqual(['value mousedown on ant-select-selection-item']);
  } finally { await driver.close(); }
});

// What lies over a field is clicked in its place only when it is part of the
// field's own box and no control of its own: here a button drawn over the
// field takes no click, and the refusal names it.
test('a control of a field\'s own box drawn over the field is not clicked in its place', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Account</h1>
    <div class="ant-input-affix-wrapper" style="position:relative;width:240px">
      <input id="key" role="combobox" aria-expanded="false" aria-label="API key" style="width:100%;height:28px">
      <button class="reveal" style="position:absolute;inset:0;opacity:.5" onclick="window.revealed = true">Reveal</button>
    </div>
    <script>document.querySelector('#key').addEventListener('mousedown', (e) => e.target.setAttribute('aria-expanded', 'true'));</script>`);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([(state) => decision({ tool: 'select', target: pick((e) => e.label === 'API key')(state) })]));
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Open the API key list', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.actions.map((a) => [a.action ?? a.recovery, a.error ?? a.detail])).toEqual([
      ['reobserve', 'the target is covered by another element (<button class="reveal">); no input was sent'],
      ['reobserve', 'the target is covered by another element (<button class="reveal">); no input was sent'],
    ]);
    expect(result.pending_actions).toBeUndefined();
    expect(await page.evaluate(() => window.revealed)).toBeUndefined();
    await expect(page.locator('#key')).toHaveAttribute('aria-expanded', 'false');
  } finally { await mcp.close(); }
});

// The browser's log names what covers a target as markup, with its text when
// it holds only text, or none: the refusal names it either way.
for (const [what, cover, named] of [
  ['text', '<div class="cookie-banner" title="Cookies">We use cookies</div>', '<div class="cookie-banner">'],
  ['nothing', '<div class="mask"></div>', '<div class="mask">'],
]) {
  test(`a target covered by an element holding ${what} is refused, and the refusal names the cover`, async ({ page }, testInfo) => {
    await page.setContent(`<style>.cookie-banner, .mask { position: fixed; top: 0; left: 0; width: 400px; height: 120px; background: rgba(0,0,0,.2); }</style>
      <h1>Report</h1><button onclick="window.generated = true">Generate</button>${cover}`);
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([(state) => decision({ tool: 'click', target: pick((e) => e.label === 'Generate')(state) })]));
    try {
      const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the report', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
      expect(result.actions.map((a) => a.error ?? a.detail)).toEqual([
        `the target is covered by another element (${named}); no input was sent`,
        `the target is covered by another element (${named}); no input was sent`,
      ]);
      expect(await page.evaluate(() => window.generated)).toBeUndefined();
    } finally { await mcp.close(); }
  });
}
