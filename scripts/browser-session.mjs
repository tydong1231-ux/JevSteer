// Interactive login helper. This owns only a dedicated test profile; a later
// MCP process may attach over its loopback CDP endpoint with explicit page IDs.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';

const [url, profilePath] = process.argv.slice(2);
if (!url || !profilePath) throw new Error('Usage: node scripts/browser-session.mjs <https-url> <dedicated-profile-path>');
const profile = resolve(profilePath);
const driver = new PlaywrightDriver({ userDataDir: profile, headless: false, launchOptions: { args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'] } });
try {
  const ref = await driver.createPage();
  await driver.open(url, { pageRef: ref.pageId });
  const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
  console.log(JSON.stringify({ status: 'login_browser_ready', profile, cdp_endpoint: `http://127.0.0.1:${port}`, tab_id: ref.pageId }));
  await new Promise((done) => {
    driver.context.once('close', done);
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
} finally { await driver.close(); }
