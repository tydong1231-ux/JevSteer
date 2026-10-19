// Host review tickets on a page with toasts: a success toast fades on its own,
// and an error toast can arrive after the ticket.
import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

// antd renders its message notices in a fixed container at the end of <body>.
const customer = `<h1>Customer JevSteer QA</h1><p id="state">Status: Draft</p><button>Save</button>
  <div class="ant-message" style="position:fixed;top:8px;left:0;right:0"></div>
  <script>
    window.toast = (text, ms, role) => {
      const notice = document.createElement('div');
      notice.className = 'ant-message-notice';
      if (role) notice.setAttribute('role', role);
      notice.textContent = text;
      document.querySelector('.ant-message').append(notice);
      setTimeout(() => notice.remove(), ms);
    };
    document.querySelector('button').onclick = () => { state.textContent = 'Status: Saved'; toast('Update successfully', 3000); };
  </script>`;

const save = () => scriptedDecider([
  (state) => decision({ tool: 'click', target: state.page.elements.find((e) => e.label === 'Save').i, side_effect: 0.9 }),
  { tool: 'none', done: 0.99 },
]);

const run = (mcp, extra = {}) => mcp.call('browser_run', { tab_id: mcp.id, goal: 'Save customer JevSteer QA', verification_mode: 'host', max_actions: 3, evidence_level: 'none', ...extra });
const review = (mcp, ticket, decision) => mcp.call('browser_review', { tab_id: mcp.id, review_id: ticket.host_review.review_id, decision, goal_evidence: 'Status shows Saved' });

test('a success toast that fades before acceptance does not make the ticket stale', async ({ page }, testInfo) => {
  await page.setContent(customer);
  const mcp = await mcpFixture(page, testInfo, save());
  try {
    const ticket = await run(mcp);
    expect(ticket.status).toBe('host_review_required');
    // The host sees the toast as evidence.
    expect(ticket.verification.observation.text).toContain('Update successfully');
    await expect(page.locator('.ant-message-notice')).toHaveCount(0);
    expect((await review(mcp, ticket, 'accept')).status).toBe('completed_host_verified');
  } finally { await mcp.close(); }
});

test('an error toast after the ticket makes it stale, and the rerun re-observes without input', async ({ page }, testInfo) => {
  await page.setContent(customer);
  const mcp = await mcpFixture(page, testInfo, save());
  try {
    const ticket = await run(mcp);
    expect(ticket.status).toBe('host_review_required');
    await page.evaluate(() => window.toast('Sync failed', 60000, 'alert'));
    expect((await review(mcp, ticket, 'accept')).status).toBe('host_review_stale');
    expect((await review(mcp, ticket, 'reject')).status).toBe('host_review_rejected');
    let clicks = 0;
    await page.exposeFunction('countClick', () => { clicks++; });
    await page.evaluate(() => document.querySelector('button').addEventListener('click', () => window.countClick()));
    const again = await run(mcp, { run_id: ticket.run_id });
    expect(again.status).toBe('host_review_required');
    expect(again.actions).toEqual([]);
    expect(again.verification.observation.text).toContain('Sync failed');
    expect(clicks).toBe(0);
  } finally { await mcp.close(); }
});

// ccMonet's sidebar: the Todo count sits in div.unread, a Tailwind pill with no
// role (read-only probe, 2026-10-19). Its success message has no role either,
// and an app can rename antd's class prefix.
const sidebar = `<nav>
    <a href="#ai"><div class="flex items-center pr-2"><span>AI Insights</span><span id="ai" style="display:inline-block;height:16px;min-width:16px;border-radius:8px;background:#ef4444;color:#fff;font-size:10px;text-align:center">42</span></div></a>
    <a href="#todo"><div class="flex items-center pr-2"><span>Todo</span><div class="unread ml-auto"><div class="rounded-full"><span id="todo">41</span></div></div></div></a>
  </nav>`;
const renamed = customer.replace("notice.className = 'ant-message-notice'", "notice.className = 'ccm-message-notice ccm-message-notice-success'");

test('a sidebar count that grows after the ticket, and a message under a renamed prefix, do not make it stale', async ({ page }, testInfo) => {
  await page.setContent(sidebar + renamed);
  const mcp = await mcpFixture(page, testInfo, save());
  try {
    const ticket = await run(mcp);
    expect(ticket.status).toBe('host_review_required');
    expect(ticket.verification.observation.text).toContain('Update successfully');
    // Creating the record added a to-do, as on ccMonet, and the message fades.
    await page.evaluate(() => { document.querySelector('#todo').textContent = '42'; document.querySelector('#ai').textContent = '43'; });
    await expect(page.locator('.ccm-message-notice')).toHaveCount(0);
    expect((await review(mcp, ticket, 'accept')).status).toBe('completed_host_verified');
  } finally { await mcp.close(); }
});

test('a changed record still makes the ticket stale when a count changed with it', async ({ page }, testInfo) => {
  await page.setContent(sidebar + customer);
  const mcp = await mcpFixture(page, testInfo, save());
  try {
    const ticket = await run(mcp);
    expect(ticket.status).toBe('host_review_required');
    await page.evaluate(() => { document.querySelector('#todo').textContent = '42'; state.textContent = 'Status: Draft'; });
    expect((await review(mcp, ticket, 'accept')).status).toBe('host_review_stale');
  } finally { await mcp.close(); }
});

// ccMonet's Save as Draft with a required field left empty: nothing visible
// happens, no request goes out (Mac rerun, 2026-10-19). Or a message says
// what is missing.
const draft = (onSave = '') => `<div role="dialog" aria-modal="true" aria-label="New invoice"><h2>New invoice</h2>
    <label>Payment Terms <input name="terms"></label><button>Save as Draft</button></div>
  <div class="ant-message" style="position:fixed;top:8px;left:0;right:0"></div>
  <script>
    window.toast = (text, ms) => {
      const notice = Object.assign(document.createElement('div'), { className: 'ant-message-notice', textContent: text });
      document.querySelector('.ant-message').append(notice);
      setTimeout(() => notice.remove(), ms);
    };
    document.querySelector('button').onclick = () => { ${onSave} };
  </script>`;
const unseen = () => scriptedDecider([
  (state) => decision({ tool: 'click', target: state.page.elements.find((e) => e.label === 'Save as Draft').i, side_effect: 0.9 }),
  { tool: 'none', done: 0.01 },
]);

for (const [name, onSave, said] of [
  ['nothing', '', 'no message appeared after it'],
  ['only a message', "toast('Please select Payment Terms', 3000);", 'the page then showed "Please select Payment Terms"'],
]) {
  test(`a save that shows ${name} goes to the host as a result Jev did not see`, async ({ page }, testInfo) => {
    await page.setContent(draft(onSave));
    const mcp = await mcpFixture(page, testInfo, unseen());
    try {
      const ticket = await run(mcp, { goal: 'Save the invoice as a draft' });
      expect(ticket.status).toBe('host_review_required');
      expect(ticket.info).toBe(`Jev did not find task.goal reached after a write this milestone sent (click on button "Save as Draft"): ${said}, and the page sent no data request after it. A required field or a rule on the page may have stopped the write. Check the site before accepting this result, and resolve the pending action from what it shows. No input was replayed.`);
      expect(ticket.actions).toHaveLength(1);
      // A message over the drawer is part of what the page says.
      if (onSave) expect(ticket.verification.observation.text).toContain('Please select Payment Terms');
    } finally { await mcp.close(); }
  });
}

// ccMonet after Create in its customer drawer: the success message shows, the
// drawer closes, and the list reloads behind it a moment later (Mac rerun,
// 2026-10-19). A ticket issued at once missed the new row.
const created = `<h1>Customers</h1>
  <table><tbody id="rows"><tr data-row-key="1"><td><input type="checkbox" aria-label="Select row"></td><td>Existing customer</td></tr></tbody></table>
  <div role="dialog" aria-modal="true" aria-label="New customer" id="drawer"><label>Name <input name="name" value="JevSteer QA"></label><button>Create</button></div>
  <div class="ant-message" style="position:fixed;top:8px;left:0;right:0"></div>
  <script>
    window.toast = (text, ms) => {
      const notice = Object.assign(document.createElement('div'), { className: 'ant-message-notice', textContent: text });
      document.querySelector('.ant-message').append(notice);
      setTimeout(() => notice.remove(), ms);
    };
    document.querySelector('#drawer button').onclick = () => {
      toast('Create successfully', 2500);
      setTimeout(() => document.querySelector('#drawer').remove(), 200);
      setTimeout(() => document.querySelector('#rows').insertAdjacentHTML('beforeend', '<tr data-row-key="2"><td><input type="checkbox" aria-label="Select row"></td><td>JevSteer QA</td></tr>'), 1500);
    };
  </script>`;

for (const [waitMs, status] of [[4000, 'completed_host_verified'], [0, 'host_review_stale']]) {
  test(`a new ticket waits for the message to go before binding the list (toast wait ${waitMs} ms)`, async ({ page }, testInfo) => {
    await page.setContent(created);
    const mcp = await mcpFixture(page, testInfo, scriptedDecider([
      (state) => decision({ tool: 'click', target: state.page.elements.find((e) => e.label === 'Create').i, side_effect: 0.9 }),
      { tool: 'none', done: 0.99 },
    ]));
    Object.assign(mcp.runtime.observation, { maxMs: 6000, reviewToastWaitMs: waitMs });
    try {
      const ticket = await run(mcp, { goal: 'Create customer JevSteer QA' });
      expect(ticket.status).toBe('host_review_required');
      await expect(page.locator('#rows tr')).toHaveCount(2);
      await expect(page.locator('.ant-message-notice')).toHaveCount(0);
      expect((await review(mcp, ticket, 'accept')).status).toBe(status);
    } finally { await mcp.close(); }
  });
}

// A badge the contract speaks of is part of what the host reviews: "Cart 2"
// turning into "Cart 3" after the ticket makes it stale.
const shop = `<nav><a href="#cart">Cart <span class="badge" id="cart">1</span></a></nav>
  <h1>The Grand Design</h1><button>Add to cart</button>
  <script>document.querySelector('button').onclick = () => { cart.textContent = '2'; };</script>`;

test('a count the contract names is bound into the ticket', async ({ page }, testInfo) => {
  await page.setContent(shop);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'click', target: state.page.elements.find((e) => e.label === 'Add to cart').i, side_effect: 0.9 }),
    { tool: 'none', done: 0.99 },
  ]));
  try {
    const ticket = await run(mcp, { goal: 'Add The Grand Design to the cart once' });
    expect(ticket.status).toBe('host_review_required');
    await page.evaluate(() => { document.querySelector('#cart').textContent = '3'; });
    expect((await review(mcp, ticket, 'accept')).status).toBe('host_review_stale');
  } finally { await mcp.close(); }
});
