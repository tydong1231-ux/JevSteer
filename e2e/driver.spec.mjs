// Real Chromium adapter conformance, with synthetic setup and independent UI
// oracles. These tests do not claim to measure live Jev decisions/site success.
import { test, expect } from '@playwright/test';
import { driverFor, choose, send } from './helpers.mjs';
import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtureServer } from '../test/helpers/fixture-server.mjs';

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
  const driver = new PlaywrightDriver({ userDataDir: profile, headless: true, timeoutMs: 5000, launchOptions: { args: ['--remote-debugging-port=0'] } });
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
    reopened = new PlaywrightDriver({ userDataDir: profile, headless: true, timeoutMs: 5000 });
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
