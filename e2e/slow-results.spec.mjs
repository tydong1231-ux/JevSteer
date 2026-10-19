// Results that arrive after the page looks settled: a report the server takes
// a while to compute, and a record field filled by a later request.
import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const pick = (match) => (state) => state.page.elements.find(match)?.i;

// Like ccMonet's Generate: the click shows nothing, no spinner, until the
// report request returns. This handler also waits before sending it.
const report = (handler) => `<title>Profit and Loss</title><h1>Profit and Loss</h1>
  <button>Generate</button><section id="report"></section>
  <script>document.querySelector('button').onclick = ${handler};</script>`;

async function serve(page, body) {
  await page.route('https://jevsteer.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/report') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ json: { heading: 'For the period 2026/1/1 - 2026/12/31', income: '12,500.00' } });
    }
    if (path.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ contentType: 'text/html', body });
  });
  await page.goto('https://jevsteer.test/profit-and-loss');
}

const generate = () => scriptedDecider([
  (state) => decision({ tool: 'click', target: pick((e) => e.label === 'Generate')(state) }),
  (state) => decision(state.page.text.includes('For the period') ? { tool: 'none', done: 0.99 } : { tool: 'none', done: 0.01 }),
]);

test('a Generate click is watched until its report request returns', async ({ page }, testInfo) => {
  await serve(page, report(`() => setTimeout(async () => {
    const data = await (await fetch('/api/report')).json();
    document.querySelector('#report').textContent = data.heading + ' Income ' + data.income;
  }, 300)`));
  const mcp = await mcpFixture(page, testInfo, generate());
  mcp.runtime.observation = { ...mcp.runtime.observation, maxMs: 8000, quietMs: 150 };
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the Profit and Loss report', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    // One click, seen to change the page; no wait and no second click.
    expect(result.actions.map((a) => [a.action, a.effect?.status, a.requests])).toEqual([['click', 'changed', 1]]);
    await expect(page.locator('#report')).toHaveText('For the period 2026/1/1 - 2026/12/31 Income 12,500.00');
  } finally { await mcp.close(); }
});

// Like ccMonet: Generate's requests return at once, and the report shows
// seconds later with nothing open or spinning. One wait watches until it does.
test('a report that shows seconds after its request returns is seen within one wait', async ({ page }, testInfo) => {
  await serve(page, report(`async () => {
    await fetch('/api/report/start');
    setTimeout(() => { document.querySelector('#report').textContent = 'For the period 2026/1/1 - 2026/12/31 Income 12,500.00'; }, 3500);
  }`));
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'click', target: pick((e) => e.label === 'Generate')(state) }),
    (state) => decision(state.page.text.includes('For the period') ? { tool: 'none', done: 0.99 } : { tool: 'wait' }),
  ]));
  mcp.runtime.observation = { ...mcp.runtime.observation, maxMs: 8000, quietMs: 150 };
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the Profit and Loss report', verification_mode: 'host', max_actions: 4, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(result.actions.map((a) => [a.action, a.effect?.status, a.requests, a.page_changed])).toEqual([['click', 'unknown', 1, undefined], ['wait', 'unknown', undefined, undefined]]);
    expect(result.verification.observation.text).toContain('For the period 2026/1/1 - 2026/12/31');
  } finally { await mcp.close(); }
});

test('a click that sends nothing and changes nothing is reported as such', async ({ page }, testInfo) => {
  await serve(page, report('() => {}'));
  const mcp = await mcpFixture(page, testInfo, generate());
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Generate the Profit and Loss report', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('stuck');
    expect(result.actions.map((a) => [a.action, a.effect?.status, a.requests])).toEqual([['click', 'unknown', 0]]);
  } finally { await mcp.close(); }
});

test('a host review ticket waits for a field that loads after the record', async ({ page }, testInfo) => {
  await page.setContent(`<h1>Bills</h1>
    <table><tr><td>ITALASIA</td><td>THB 264.83</td><td><button>Open bill</button></td></tr></table>
    <section id="detail" hidden><h2>Bill ITALASIA</h2><label>File Type <select id="type"><option value="">Loading</option></select></label></section>
    <script>document.querySelector('button').onclick = () => {
      detail.hidden = false;
      setTimeout(() => { type.innerHTML = '<option>Tax Invoice Delivery Order</option>'; }, 500);
    };</script>`);
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    (state) => decision({ tool: 'click', target: pick((e) => e.label === 'Open bill')(state) }),
    { tool: 'none', done: 0.99 },
  ]));
  mcp.runtime.observation = { ...mcp.runtime.observation, maxMs: 3000, reviewQuietMs: 800 };
  try {
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Open the ITALASIA bill', verification_mode: 'host', max_actions: 3, evidence_level: 'none' });
    expect(result.status).toBe('host_review_required');
    expect(result.verification.observation.elements.map((e) => e.value)).toContain('Tax Invoice Delivery Order');
    // The host reads the page after the field has loaded.
    await expect(page.locator('#type')).toHaveValue('Tax Invoice Delivery Order');
    const receipt = await mcp.call('browser_review', { tab_id: mcp.id, review_id: result.host_review.review_id, decision: 'accept', goal_evidence: 'The ITALASIA bill is open and its File Type is loaded' });
    expect(receipt.status).toBe('completed_host_verified');
  } finally { await mcp.close(); }
});
