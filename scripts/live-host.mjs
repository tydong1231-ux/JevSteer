// Local host bridge for a persistent, real stdio MCP session. Business actions
// still go through the shipped browser_run entry point, never a click script.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (process.env.JEVSTEER_BROWSER_DRIVER !== 'playwright') throw new Error('Live host requires JEVSTEER_BROWSER_DRIVER=playwright');
const token = randomUUID();
const output = resolve(process.env.JEVSTEER_LIVE_OUTPUT || '.test-artifacts/ccmonet-playwright');
await mkdir(output, { recursive: true });
const transport = new StdioClientTransport({ command: process.execPath, args: ['bin/jevsteer.mjs'], cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null)), stderr: 'pipe' });
const client = new Client({ name: 'jevsteer-live-host', version: '1.0.0' });
await client.connect(transport);
const allowed = new Set(['browser_doctor', 'browser_tabs', 'browser_snapshot', 'browser_inspect', 'browser_screenshot', 'browser_run', 'browser_review', 'browser_evidence', 'browser_resolve_action', 'browser_act']);
// Prefix each session so restarts cannot overwrite previous financial evidence.
const session = randomUUID();
let sequence = 0;
let closing = false;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('{"error":"POST required"}'); return; }
  try {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) throw new Error('Host request too large'); chunks.push(chunk); }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.name === 'close') { res.end('{"closed":true}'); await close(); return; }
    if (!allowed.has(request.name)) throw new Error('Unsupported host tool');
    const id = ++sequence;
    const started = Date.now();
    const response = await client.callTool({ name: request.name, arguments: request.arguments || {} }, undefined, { timeout: 600000 });
    const value = response.structuredContent || response.content?.find((c) => c.type === 'text')?.text || response.content?.find((c) => c.type === 'image');
    const result = { session_id: session, id, started_at: new Date(started).toISOString(), tool: request.name, isError: !!response.isError, result: value, wall_ms: Date.now() - started };
    // The bridge never stores its bearer nonce or the provider environment.
    await writeFile(join(output, `${session}-${String(id).padStart(3, '0')}-${request.name}.json`), JSON.stringify({ request, ...result }, null, 2), { mode: 0o600, flag: 'wx' });
    res.end(JSON.stringify(result));
  } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e.message).split('\n')[0] })); }
});
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await client.close();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, bearer: token, output })));
