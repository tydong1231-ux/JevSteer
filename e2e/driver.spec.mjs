// Real Chromium adapter conformance, with synthetic setup and independent UI
// oracles. These tests do not claim to measure live Jev decisions/site success.
import { test, expect } from '@playwright/test';
import { driverFor, choose, send } from './helpers.mjs';
import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtureServer } from '../test/helpers/fixture-server.mjs';

test('tab discovery does not capture events from unrelated user pages', async ({ page }) => {
  await page.setContent('<h1>Selected page</h1>');
  const other = await page.context().newPage();
  await other.setContent('<h1>Private unrelated page</h1>');
  const driver = new PlaywrightDriver({ context: page.context() });
  try {
    await driver.pages();
    expect([...driver.records.values()].every((r) => r.events === null)).toBe(true);
    const selected = [...driver.records.values()].find((r) => r.page === page);
    const unrelated = [...driver.records.values()].find((r) => r.page === other);
    await driver.observe(selected.pageId);
    expect(selected.events).not.toBeNull();
    expect(unrelated.events).toBeNull();
    await other.evaluate(() => console.log('private event'));
    expect(unrelated.events).toBeNull();
  } finally { await driver.close(); await other.close(); }
});

test('cursor-marked cards are discoverable but aria-disabled ancestry is never bypassed', async ({ page }) => {
  await page.setContent('<div class="cursor-pointer">Profit and Loss</div><table><tr role="button" aria-disabled="true"><td class="cursor-pointer">Disabled supplier</td></tr></table>');
  const { driver, id } = await driverFor(page);
  try {
    const snapshot = await driver.observe(id);
    expect(snapshot.elements.find((e) => e.text === 'Profit and Loss')?.disabled).toBe(false);
    expect(snapshot.elements.find((e) => e.tag === 'td')?.disabled).toBe(true);
    const card = await choose(driver, id, 'click', (e) => e.text === 'Profit and Loss');
    expect((await send(driver, id, card)).state).toBe('dispatched_ack');
    const disabled = await choose(driver, id, 'click', (e) => e.tag === 'td');
    await expect(driver.assertTargetFresh(id, disabled)).rejects.toThrow(/STALE_TARGET/);
  } finally { await driver.close(); }
});

test('a dnd-kit row with dragging off still takes clicks and typing; covered rows and other aria-disabled ancestors still block', async ({ page }) => {
  // dnd-kit's useSortable item attributes, as on ccMonet's Vendor Bills rows.
  const row = (key, text, cell = '<td>USD 120.00</td>') => `<tr role="button" tabindex="0" aria-disabled="true" aria-roledescription="sortable" aria-describedby="DndDescribedBy-0" data-row-key="${key}"><td class="cursor-pointer" onclick="window.opened = '${key}'">${text}</td>${cell}</tr>`;
  await page.setContent(`<table>${row('bill-1', 'Acme Supplies')}${row('line-1', 'Paper', '<td><label>Memo <input name="memo"></label></td>')}</table><div aria-disabled="true"><table>${row('bill-2', 'Locked Supplier')}</table></div><span id="DndDescribedBy-0" hidden>To pick up a draggable item, press the space bar.</span>`);
  const { driver, id } = await driverFor(page);
  try {
    const snapshot = await driver.observe(id);
    expect(snapshot.elements.find((e) => e.text === 'Acme Supplies')?.disabled).toBe(false);
    expect(snapshot.elements.find((e) => e.tag === 'tr' && e.record_key === 'bill-1')?.disabled).toBe(false);
    expect(snapshot.elements.find((e) => e.text === 'Locked Supplier')?.disabled).toBe(true);
    const open = await choose(driver, id, 'click', (e) => e.text === 'Acme Supplies');
    expect((await send(driver, id, open)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => window.opened)).toBe('bill-1');
    for (const inputMode of ['fast', 'realistic']) {
      const memo = await choose(driver, id, 'type', (e) => e.name === 'memo', `Rush ${inputMode}`);
      expect((await send(driver, id, { ...memo, inputMode })).state).toBe('dispatched_ack');
      await expect(page.locator('[name=memo]')).toHaveValue(`Rush ${inputMode}`);
    }
    const locked = await choose(driver, id, 'click', (e) => e.text === 'Locked Supplier');
    await expect(driver.assertTargetFresh(id, locked)).rejects.toThrow(/STALE_TARGET/);
    const blockers = (await driver.inspect(id)).controls.find((c) => c.label === 'Acme Supplies').disabled_ancestry;
    expect(blockers).toEqual([expect.objectContaining({ tag: 'tr', aria_disabled: 'true', drag_only: true })]);
    // Skipping Playwright's checks never clicks through an overlay.
    await page.evaluate(() => { window.opened = undefined; document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;background:#fff8"></div>'); });
    const covered = await choose(driver, id, 'click', (e) => e.text === 'Acme Supplies');
    expect((await send(driver, id, covered)).state).toBe('predispatch_rejected');
    expect(await page.evaluate(() => window.opened)).toBeUndefined();
  } finally { await driver.close(); }
});

test('named descendant icons distinguish view and delete in the same record', async ({ page }) => {
  await page.setContent('<table><tr data-row-key="statement-1"><td>Demo statement</td><td><button onclick="window.viewed=true"><span role="img" aria-label="View statement"><svg></svg></span></button><button onclick="window.deleted=true"><span role="img" aria-label="Delete statement"><svg></svg></span></button></td></tr></table>');
  const { driver, id } = await driverFor(page);
  try {
    const action = await choose(driver, id, 'click', (e) => e.label === 'View statement');
    expect(action.el.record_key).toBe('statement-1');
    expect((await send(driver, id, action)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => ({ viewed: !!window.viewed, deleted: !!window.deleted }))).toEqual({ viewed: true, deleted: false });
  } finally { await driver.close(); }
});

test('static image hints distinguish sibling icons without leaking URL secrets or bypassing duplicate identity', async ({ page }) => {
  await page.route('https://fixture.invalid/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>' }));
  await page.setContent('<table><tr data-row-key="statement-1"><td>Demo statement</td><td><button onclick="window.viewed=true"><img width="16" height="16" src="https://fixture.invalid/assets/detail.a1b2.svg?token=never-log-me"></button><button onclick="window.deleted=true"><img width="16" height="16" src="https://fixture.invalid/assets/delete.c3d4.svg"></button></td></tr></table>');
  const { driver, id } = await driverFor(page);
  try {
    const snapshot = await driver.observe(id);
    expect(JSON.stringify(snapshot)).not.toContain('never-log-me');
    const action = await choose(driver, id, 'click', (e) => e.label === 'icon: detail');
    expect((await send(driver, id, action)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => ({ viewed: !!window.viewed, deleted: !!window.deleted }))).toEqual({ viewed: true, deleted: false });
    // Fixture fault injection only; production observation/input never writes DOM.
    await page.locator('img').last().evaluate((e) => e.setAttribute('src', 'https://fixture.invalid/assets/detail.a1b2.svg'));
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(/STALE_TARGET/);
  } finally { await driver.close(); }
});

test('CSS-hidden alternate icons do not leak into a toggle button name', async ({ page }) => {
  await page.setContent('<style>.off{display:none}.ghost{visibility:hidden}</style><button onclick="window.fav=(window.fav||0)+1"><span role="img" aria-label="Unfavorite" class="off"></span><span role="img" aria-label="Archive" class="ghost"></span><span role="img" aria-label="Favorite"></span></button><button onclick="window.chart=true"><svg width="16" height="16"><title>Open chart</title><rect width="16" height="16"/></svg></button>');
  const { driver, id } = await driverFor(page);
  try {
    const labels = (await driver.observe(id)).elements.map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(['Favorite', 'Open chart']));
    expect(labels.join(' ')).not.toMatch(/Unfavorite|Archive/);
  } finally { await driver.close(); }
});

test('card text takes precedence over a nested favorite icon name', async ({ page }) => {
  await page.setContent('<div class="cursor-pointer" style="width:400px;height:160px" onclick="window.opened=true"><h2>Profit and Loss</h2><p>Revenue and expense report</p><button aria-label="Toggle favorite" onclick="event.stopPropagation();window.favorites=(window.favorites||0)+1"><span role="img" aria-label="star"></span></button></div>');
  const { driver, id } = await driverFor(page);
  try {
    const card = await choose(driver, id, 'click', (e) => e.tag === 'div');
    expect(card.el.label).toContain('Profit and Loss');
    expect(card.el.label).not.toBe('star');
    expect((await send(driver, id, card)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => ({ opened: !!window.opened, favorites: window.favorites || 0 }))).toEqual({ opened: true, favorites: 0 });
  } finally { await driver.close(); }
});

test('realistic input emits trusted keyboard/pointer events and never mutates DOM during observation', async ({ page }) => {
  await page.setContent(`<label>Company<input id="company"></label><label>Region<select><option value="a">North</option><option value="b">South</option></select></label><script>
    window.events=[];for(const t of ['keydown','keyup','input','click','change'])document.addEventListener(t,e=>events.push({type:t,trusted:e.isTrusted}));
    window.changes=[];new MutationObserver(m=>changes.push(...m.map(x=>x.type))).observe(document,{subtree:true,attributes:true,childList:true,characterData:true});
  </script>`);
  const { driver, id } = await driverFor(page);
  try {
    await driver.observe(id);
    expect((await driver.observe(id)).elements.find((e) => e.tag === 'select').label).toBe('Region');
    expect(await page.evaluate(() => changes)).toEqual([]);
    const action = await choose(driver, id, 'type', (e) => e.label === 'Company', 'Jev Fixture');
    let hooked = false;
    const result = await send(driver, id, action, async () => {
      expect(await page.locator('#company').inputValue()).toBe('');
      expect(await page.evaluate(() => events.length)).toBe(0);
      hooked = true;
    });
    expect(hooked).toBe(true);
    expect(result).toMatchObject({ state: 'dispatched_ack', input_mode: 'realistic' });
    await expect(page.locator('#company')).toHaveValue('Jev Fixture');
    const events = await page.evaluate(() => window.events);
    expect(events.some((e) => e.type === 'keydown')).toBe(true);
    expect(events.every((e) => e.trusted)).toBe(true);
    const select = await choose(driver, id, 'select', (e) => e.tag === 'select', 'b');
    expect((await send(driver, id, select)).input_mode).toBe('native_select');
    await expect(page.locator('select')).toHaveValue('b');
  } finally { await driver.close(); }
});

test('managed profile reopens with storage intact; CDP aliases share physical page identity and disconnect safely', async ({}, testInfo) => {
  const fixture = await startFixtureServer();
  // Chromium's Windows storage paths can exceed MAX_PATH below long report
  // slugs. Keep this disposable synthetic profile in a short temp directory.
  const profile = await mkdtemp(join(tmpdir(), 'jev-pw-'));
  // The same browser as the other tests: CI's bundled one, or a local Chrome.
  const executablePath = process.env.JEVSTEER_TEST_EXECUTABLE_PATH || undefined;
  // A brand-new profile's first navigation can take over 5 s on CI's Windows
  // runners (twice on Node 20, 2026-10-19), though this whole test usually
  // takes about 2 s. The managed drivers get the driver's default timeout.
  const timeoutMs = 15000;
  const driver = new PlaywrightDriver({ userDataDir: profile, headless: true, executablePath, timeoutMs, launchOptions: { args: ['--remote-debugging-port=0'] } });
  let attached;
  let alias;
  let reopened;
  try {
    const ref = await driver.createPage();
    await driver.open(fixture.base + '/controls', { pageRef: ref.pageId });
    const page = (await driver.record(ref.pageId)).page;
    await page.evaluate(() => localStorage.setItem('synthetic-login', 'fixture-state'));
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
    attached = new PlaywrightDriver({ cdpEndpoint: `http://127.0.0.1:${port}`, timeoutMs: 5000 });
    alias = new PlaywrightDriver({ cdpEndpoint: `http://localhost:${port}`, timeoutMs: 5000 });
    expect((await attached.pages()).some((p) => p.pageId === ref.pageId)).toBe(true);
    expect((await alias.pages()).some((p) => p.pageId === ref.pageId)).toBe(true);
    await attached.close();
    await alias.close();
    expect(page.isClosed()).toBe(false);
    await driver.close();
    reopened = new PlaywrightDriver({ userDataDir: profile, headless: true, executablePath, timeoutMs });
    expect(reopened.sessionId).toBe(driver.sessionId);
    const next = await reopened.createPage();
    await reopened.open(fixture.base + '/controls', { pageRef: next.pageId });
    expect(await (await reopened.record(next.pageId)).page.evaluate(() => localStorage.getItem('synthetic-login'))).toBe('fixture-state');
  } finally { await attached?.close(); await alias?.close(); await driver.close(); await reopened?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); }
});

test('Frame and open Shadow DOM targets retain form ownership and are operable', async ({ page }) => {
  await page.setContent(`<form id="outer"><label>Name<input></label></form><iframe srcdoc='<form id="inner"><label>Name<input></label></form>'></iframe><div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<form id="shadow-form"><label>Name<input></label></form>';</script>`);
  await page.frameLocator('iframe').locator('input').waitFor();
  const { driver, id } = await driverFor(page);
  try {
    const snapshot = await driver.observe(id);
    expect(snapshot.elements.filter((e) => e.label === 'Name')).toHaveLength(3);
    expect(new Set(snapshot.elements.filter((e) => e.label === 'Name').map((e) => e.form_key)).size).toBe(3);
    const frame = await choose(driver, id, 'type', (e) => e.form_key === 'inner', 'Frame value');
    expect((await send(driver, id, frame)).state).toBe('dispatched_ack');
    await expect(page.frameLocator('iframe').locator('input')).toHaveValue('Frame value');
    const shadow = await choose(driver, id, 'type', (e) => e.form_key === 'shadow-form', 'Shadow value');
    expect((await send(driver, id, shadow)).state).toBe('dispatched_ack');
    await expect(page.locator('#shadow input')).toHaveValue('Shadow value');
  } finally { await driver.close(); }
});

// ccMonet's status page widget (Mac probe, 2026-10-20): a cross-site iframe,
// aria-hidden, position:fixed at left -9999px until an incident is posted.
// Its text changed as it loaded, and a host review ticket went stale.
test('a frame fixed outside the window, and frames inside it, are not observed; frames a scroll reaches are', async ({ page }) => {
  const doc = (text, extra = '') => `<p id=t>${text}</p><a href="#latest">View latest updates</a>${extra}`.replace(/"/g, '&quot;');
  await page.setContent(`<h1>Bills</h1>
    <iframe id="status" title="Status" aria-hidden="true" style="position:fixed;left:-9999px;bottom:20px;width:320px;height:115px;z-index:9999"
      srcdoc="${doc('Status embed installed', `<iframe srcdoc='<button>Inner</button>'></iframe>`)}"></iframe>
    <div style="position:fixed;top:0;left:0;width:0;height:0"><iframe id="parked" style="position:absolute;left:0;top:-500px;height:100px" srcdoc="${doc('Parked above')}"></iframe></div>
    <iframe id="chat" style="position:fixed;right:8px;bottom:8px;width:200px;height:120px" srcdoc="${doc('Chat with us')}"></iframe>
    <iframe id="below" style="position:absolute;top:3000px;left:0;height:100px" srcdoc="${doc('Below the fold')}"></iframe>`);
  for (const id of ['status', 'parked', 'chat', 'below']) await page.frameLocator(`#${id}`).locator('#t').waitFor();
  await page.frameLocator('#status').frameLocator('iframe').locator('button').waitFor();
  const { driver, id } = await driverFor(page);
  try {
    const before = await driver.observe(id);
    expect(before.text).not.toContain('Status embed');
    expect(before.text).not.toContain('Parked above');
    expect(before.text).toContain('Chat with us');
    expect(before.text).toContain('Below the fold');
    expect(before.elements.map((e) => e.label)).toEqual(['View latest updates', 'View latest updates']);
    expect(before.metrics.frame_count).toBe(3);
    // What the widget says as it loads changes nothing Jev or a ticket sees.
    await page.frameLocator('#status').locator('#t').evaluate((p) => { p.textContent = 'Status embed installed correctly'; });
    const after = await driver.observe(id);
    expect(after.text).toBe(before.text);
    // Once the widget slides into view, it is seen.
    await page.locator('#status').evaluate((f) => { f.style.left = 'auto'; f.style.right = '8px'; });
    const shown = await driver.observe(id);
    expect(shown.text).toContain('Status embed installed correctly');
    expect(shown.elements.filter((e) => e.label === 'Inner')).toHaveLength(1);
  } finally { await driver.close(); }
});

test('modal excludes background controls; occluded inputs never reach the journal hook', async ({ page }) => {
  await page.setContent('<button>Background save</button><dialog open aria-label="Editor"><button>Save</button></dialog>');
  const { driver, id } = await driverFor(page);
  try {
    expect((await driver.observe(id)).elements.map((e) => e.label)).toEqual(['Save']);
    await page.setContent('<button id="save">Save</button><div style="position:fixed;inset:0;background:white;z-index:99"></div>');
    const action = await choose(driver, id, 'click', (e) => e.label === 'Save');
    let hooked = false;
    const result = await send(driver, id, action, async () => { hooked = true; });
    expect(result.state).toBe('predispatch_rejected');
    expect(hooked).toBe(false);
  } finally { await driver.close(); }
});

test('recycled row rejects before input; a detached pinned node cannot click its replacement', async ({ page }) => {
  await page.setContent('<article data-record-id="A">Supplier A<button id="save">Save</button></article>');
  const { driver, id } = await driverFor(page);
  try {
    const old = await choose(driver, id, 'click', (e) => e.label === 'Save');
    await page.setContent('<article data-record-id="B">Supplier B<button id="save">Save</button></article>');
    await expect(driver.assertTargetFresh(id, old)).rejects.toThrow(/STALE_TARGET/);
    const fresh = await choose(driver, id, 'click', (e) => e.label === 'Save');
    let clicks = 0;
    await page.exposeFunction('clicked', () => clicks++);
    const result = await send(driver, id, fresh, async () => {
      await page.setContent('<article data-record-id="C">Supplier C<button onclick="clicked()">Save</button></article>');
    });
    expect(result.state).toBe('predispatch_rejected');
    expect(clicks).toBe(0);
  } finally { await driver.close(); }
});

test('navigation invalidates a target even if the new document looks identical', async ({ page }) => {
  await page.goto('data:text/html,<button>Save</button>');
  const { driver, id } = await driverFor(page);
  try {
    const action = await choose(driver, id, 'click', (e) => e.label === 'Save');
    await page.reload();
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow(/STALE_TARGET/);
  } finally { await driver.close(); }
});

test('journal failure precedes any input; post-dispatch failure is explicitly unknown', async ({ page }) => {
  await page.setContent('<label>Name<input></label>');
  const { driver, id } = await driverFor(page);
  try {
    const action = await choose(driver, id, 'type', (e) => e.label === 'Name', 'New');
    const result = await send(driver, id, action, async () => { throw new Error('disk full'); });
    expect(result.state).toBe('predispatch_rejected');
    await expect(page.locator('input')).toHaveValue('');
    // Detachment after the first key can leave a partial value. Never label it
    // as a safe retry, even if no transport acknowledgement was returned.
    await page.locator('input').evaluate((e) => e.addEventListener('keydown', () => e.remove(), { once: true }));
    const next = await choose(driver, id, 'type', (e) => e.label === 'Name', 'New');
    expect((await send(driver, id, next)).state).toBe('dispatched_unknown');
  } finally { await driver.close(); }
});

test('driver borrows context without closing it, exposes screenshots and rejects invalid CDP without fallback', async ({ page }) => {
  await page.setContent('<h1>Read only</h1>');
  const { driver, id } = await driverFor(page);
  expect((await driver.screenshot(id)).mimeType).toBe('image/png');
  const first = id;
  const sessionId = driver.sessionId;
  await driver.close();
  expect(page.isClosed()).toBe(false);
  const second = await driverFor(page, { sessionId });
  expect(second.id).toBe(first);
  await second.driver.close();
  const bad = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:1', timeoutMs: 300 });
  await expect(bad.ready()).rejects.toThrow();
  expect(bad.context).toBeUndefined();
  await bad.close();
});

test('two links to the same page are one click; links that open elsewhere and identical buttons stay ambiguous', async ({ page }) => {
  // Wikipedia's search results show the same "(20 | 50 | 100)" pager above and below the list.
  const pager = (extra = '') => `<div>(<a href="/list?limit=20">20</a> | <a href="/list?limit=100"${extra}>100</a>)</div>`;
  const pages = { '/list': `<h1>Results</h1>${pager()}<ul><li>One</li></ul>${pager()}`, '/split': `<h1>Results</h1>${pager()}<ul><li>One</li></ul>${pager(' target="_blank"')}<div><button>Load</button></div><div><button>Load</button></div>` };
  await page.route('https://fixture.invalid/**', (route) => {
    const url = new URL(route.request().url());
    route.fulfill({ contentType: 'text/html', body: url.searchParams.get('limit') ? `<h1>Showing ${url.searchParams.get('limit')}</h1>` : pages[url.pathname] });
  });
  await page.goto('https://fixture.invalid/list');
  const { driver, id } = await driverFor(page);
  try {
    const before = await driver.observe(id);
    const hundred = before.elements.filter((e) => e.label === '100');
    expect(hundred).toHaveLength(2);
    const action = { tool: 'click', target: hundred[1].i, el: hundred[1], observedUrl: before.url };
    expect((await send(driver, id, action)).state).toBe('dispatched_ack');
    // The link the decision named is the one clicked.
    expect(action.el.ordinal).toBe(hundred[1].ordinal);
    await page.waitForURL('**/list?limit=100');
    await page.goto('https://fixture.invalid/split');
    const split = await driver.observe(id);
    const opens = split.elements.filter((e) => e.label === '100');
    await expect(driver.assertTargetFresh(id, { tool: 'click', target: opens[0].i, el: opens[0], observedUrl: split.url })).rejects.toThrow('STALE_TARGET: ambiguous: 2 identical controls');
    const load = split.elements.filter((e) => e.label === 'Load');
    await expect(driver.assertTargetFresh(id, { tool: 'click', target: load[0].i, el: load[0], observedUrl: split.url })).rejects.toThrow('STALE_TARGET: ambiguous: 2 identical controls');
  } finally { await driver.close(); }
});

// Codex on b417c55: equal links to one address can differ in what a script
// does on a click. The click goes to the node Jev saw, wherever the page has
// moved it; links the page has rebuilt since are refused.
test('of two same-address links, the click goes to the node Jev saw, wherever it moved; rebuilt links are refused', async ({ page }) => {
  const pager = (where) => `<div id="${where}">(<a href="/list?limit=20">20</a> | <a href="/list?limit=100">100</a>)</div>`;
  await page.route('https://fixture.invalid/**', (route) => route.fulfill({ contentType: 'text/html', body: `<h1>Results</h1>${pager('top')}<ul><li>One</li></ul>${pager('bottom')}
    <script>
      window.clicks = [];
      for (const where of ['top', 'bottom']) document.querySelector('#' + where + ' a[href$="100"]').addEventListener('click', (e) => { e.preventDefault(); window.clicks.push(where); });
    </script>` }));
  await page.goto('https://fixture.invalid/list');
  const { driver, id } = await driverFor(page);
  const hundred = async () => {
    const seen = await driver.observe(id);
    const links = seen.elements.filter((e) => e.label === '100');
    expect(links).toHaveLength(2);
    expect(links[0].node).not.toBe(links[1].node);
    return { seen, links };
  };
  try {
    // Jev chose the bottom one; the page then moved the bottom pager to the top.
    let { seen, links } = await hundred();
    await page.evaluate(() => document.body.insertBefore(document.querySelector('#bottom'), document.querySelector('#top')));
    let action = { tool: 'click', target: links[1].i, el: links[1], observedUrl: seen.url };
    expect((await send(driver, id, action)).state).toBe('dispatched_ack');
    expect(await page.evaluate(() => window.clicks)).toEqual(['bottom']);
    // Both pagers rebuilt after Jev looked: nothing shows which copy is the
    // node Jev saw, so neither is clicked.
    ({ seen, links } = await hundred());
    await page.evaluate(() => { for (const where of ['top', 'bottom']) { const div = document.querySelector('#' + where); div.replaceWith(div.cloneNode(true)); } });
    action = { tool: 'click', target: links[0].i, el: links[0], observedUrl: seen.url };
    await expect(driver.assertTargetFresh(id, action)).rejects.toThrow('STALE_TARGET: ambiguous: 2 identical controls');
    expect(await page.evaluate(() => window.clicks)).toEqual(['bottom']);
  } finally { await driver.close(); }
});

// Wikipedia's history with limit=100 holds about 1,100 controls (Mac rerun,
// 2026-10-19): each revision row has a radio pair, a checkbox and links.
test('a page of about 1,100 controls is observed whole; the limit is a driver option', async ({ page }) => {
  const row = (n) => `<li><input type="checkbox" aria-label="Select ${n}"><input type="radio" name="oldid" value="${n}"><input type="radio" name="diff" value="${n}"><a href="?oldid=${n}">12:${String(n % 60).padStart(2, '0')}, ${n} October 2026</a> <a href="/wiki/User:U${n}">U${n}</a> <a href="/wiki/User_talk:U${n}">talk</a> <a href="?diff=${n}">undo</a> <a href="?thank=${n}">thank</a> <button>Edit summary ${n}</button> <a href="?prev=${n}">prev</a> <a href="?cur=${n}">cur</a></li>`;
  await page.setContent(`<h1>Revision history</h1><ul>${Array.from({ length: 100 }, (_, n) => row(n)).join('')}</ul>${Array.from({ length: 50 }, (_, n) => `<a href="/wiki/Page_${n}">Page ${n}</a>`).join('')}`);
  const { driver, id } = await driverFor(page);
  try { expect((await driver.observe(id)).elements.length).toBe(1150); }
  finally { await driver.close(); }
  const { driver: capped } = await driverFor(page, { maxElements: 1000 });
  try { await expect(capped.observe(id)).rejects.toThrow(/^OBSERVATION_LIMIT: 1150 interactive elements, more than 1000/); }
  finally { await capped.close(); }
});

// The snapshot crosses from the page as one JSON string. Old Prototype.js
// changes how arrays encode; such a page still reads the same.
test('a page that changed how JSON encodes arrays is read as usual', async ({ page }) => {
  const html = '<h1>Orders</h1><label>Customer <select name="c"><option>Acme</option><option selected>Beta</option></select></label><button>Search</button>';
  await page.setContent(html);
  const plain = await driverFor(page);
  const expected = await plain.driver.observe(plain.id);
  await plain.driver.close();
  await page.setContent(html + '<script>Array.prototype.toJSON = function () { return "[" + this.length + " items]"; };</script>');
  const { driver, id } = await driverFor(page);
  try {
    const observed = await driver.observe(id);
    const pick = (o) => o.elements.map((e) => [e.role, e.label, e.options?.map((x) => [x.text, x.selected])]);
    expect(pick(observed)).toEqual(pick(expected));
    expect(pick(observed)[0][2]).toEqual([['Acme', false], ['Beta', true]]);
  } finally { await driver.close(); }
});
