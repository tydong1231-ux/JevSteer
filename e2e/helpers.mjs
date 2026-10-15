import { PlaywrightDriver } from '../src/browser/playwright-driver.mjs';
import { JevSteerRuntime } from '../src/runtime.mjs';
import { ActionJournal } from '../src/action-journal.mjs';
import { HostReviewStore } from '../src/host-review.mjs';
import { TabLeaseManager } from '../src/lease.mjs';
import { createServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

export async function driverFor(page, options = {}) {
  const driver = new PlaywrightDriver({ context: page.context(), inputMode: 'realistic', timeoutMs: 800, ...options });
  await driver.ready();
  const ref = (await driver.pages()).find((p) => p.url === page.url());
  if (!ref) throw new Error('Fixture page not registered');
  return { driver, id: ref.pageId };
}

export async function choose(driver, id, tool, match, value) {
  const page = await driver.observe(id);
  const matches = page.elements.filter(match);
  if (matches.length !== 1) throw new Error(`Fixture target count ${matches.length}: ${JSON.stringify(page.elements.map((e) => [e.i, e.label, e.context, e.scope]))}`);
  const el = matches[0];
  return { tool, target: el.i, el, value, observedUrl: page.url };
}

export async function send(driver, id, action, beforeDispatch) {
  await driver.assertTargetFresh(id, action);
  return driver.perform(id, action, action.el, { beforeDispatch });
}

export async function mcpFixture(page, testInfo, decider, options = {}) {
  const { driver, id } = await driverFor(page, options.driver);
  const runtime = new JevSteerRuntime({
    driver, decider, observation: { maxMs: 500, quietMs: 0, pollMs: 20 },
    journal: new ActionJournal({ dir: testInfo.outputPath('journal') }),
    reviews: new HostReviewStore({ dir: testInfo.outputPath('reviews') }),
    leases: new TabLeaseManager({ dir: testInfo.outputPath('leases') }),
  });
  runtime.settle = async () => 0;
  const server = createServer({ runtime });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'jevsteer-native-fixture', version: '1.0.0' });
  await client.connect(clientTransport);
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 40000 });
    if (response.isError) throw new Error(response.content.find((c) => c.type === 'text')?.text);
    return response.structuredContent || JSON.parse(response.content[0].text);
  };
  return { runtime, driver, id, call, close: async () => { await client.close(); await server.close(); } };
}
