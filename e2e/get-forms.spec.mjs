// A GET search form like arXiv's advanced search or Selenium's web form. Only
// its submit button loads the form's action. Its checkboxes, radios and fields,
// and same-page links, change the page in place and are not navigation.
import { test, expect } from '@playwright/test';
import { mcpFixture } from './helpers.mjs';
import { scriptedDecider, decision } from '../test/helpers/runtime.mjs';

const search = `<!doctype html><title>Advanced search</title><h1>Advanced search</h1>
<form action="/results" method="get">
  <label>Search term <input name="q" value="attention"></label>
  <label>From <input name="from" placeholder="YYYY-MM-DD" onclick="picker.hidden = false"></label>
  <div id="picker" hidden>Pick a date</div>
  <fieldset><legend>Subject</legend><label><input type="checkbox" name="cs" value="y"> Computer Science</label></fieldset>
  <fieldset><legend>Dates</legend>
    <label><input type="radio" name="date" value="all" checked> All dates</label>
    <label><input type="radio" name="date" value="first"> Submission date (original)</label>
  </fieldset>
  <a href="#" onclick="more.hidden = false; return false">More options</a><div id="more" hidden>Abstracts only</div>
  <button>Search</button>
</form>`;

const find = (match) => (state) => decision({ tool: 'click', target: state.page.elements.find(match)?.i });

test('clicks inside a GET form are confirmed in place; only its submit button waits for the next page', async ({ page }, testInfo) => {
  await page.route('https://jevsteer.test/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: url.pathname === '/results' ? `<title>Results</title><h1>Results</h1><p>${url.search}</p>` : search });
  });
  await page.goto('https://jevsteer.test/advanced');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([
    find((e) => e.name === 'cs'),
    find((e) => e.name === 'date' && e.value === 'first'),
    find((e) => e.name === 'from'),
    find((e) => e.tag === 'a'),
    find((e) => e.tag === 'button'),
    { tool: 'none', done: 0.99 },
  ]));
  // Production budget: a click wrongly taken for navigation waits all of it.
  mcp.runtime.observation = { ...mcp.runtime.observation, navigationMs: 15000 };
  try {
    const started = Date.now();
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Search Computer Science papers by original submission date', verification_mode: 'host', max_actions: 6, evidence_level: 'none' });
    const elapsed = Date.now() - started;
    expect(result.status).toBe('host_review_required');
    expect(result.actions.map((a) => [a.action, a.effect?.status, a.effect?.check])).toEqual([
      ['click', 'confirmed', 'checked_state'],
      ['click', 'confirmed', 'checked_state'],
      ['click', 'changed', 'page_change'],
      ['click', 'changed', 'navigation'],
      ['click', 'confirmed', 'navigation'],
    ]);
    expect(elapsed).toBeLessThan(10000);
    expect(page.url()).toBe('https://jevsteer.test/results?q=attention&from=&cs=y&date=first');
  } finally { await mcp.close(); }
});

test('a checkbox that submits its form on change is confirmed by the page it loads', async ({ page }, testInfo) => {
  await page.route('https://jevsteer.test/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: url.search
      ? `<title>Filtered</title><h1>Filtered ${url.search}</h1>`
      : `<title>Catalog</title><h1>Catalog</h1><form action="/catalog"><label><input type="checkbox" name="stock" value="1" onchange="this.form.submit()"> In stock only</label></form>` });
  });
  await page.goto('https://jevsteer.test/catalog');
  const mcp = await mcpFixture(page, testInfo, scriptedDecider([find((e) => e.name === 'stock'), { tool: 'none', done: 0.99 }]));
  mcp.runtime.observation = { ...mcp.runtime.observation, maxMs: 8000, navigationMs: 15000 };
  try {
    const started = Date.now();
    const result = await mcp.call('browser_run', { tab_id: mcp.id, goal: 'Show only products in stock', verification_mode: 'host', max_actions: 2, evidence_level: 'none' });
    expect(result.actions.map((a) => [a.action, a.effect?.status, a.effect?.check])).toEqual([['click', 'confirmed', 'navigation']]);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(page.url()).toBe('https://jevsteer.test/catalog?stock=1');
  } finally { await mcp.close(); }
});
