// Host driver: calls the project's actual browser_run MCP tool with a semantic contract.
// A contract without tab_id may name a start_url: it is opened in a new tab with
// browser_open and the run targets that tab. browser_run itself never reads it.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const source = JSON.parse(await readFile(process.argv[2], "utf8"));
const { start_url: startUrl, ...contract } = source;
const output = process.argv[3] || ".test-artifacts/contract-result.json";
const client = new Client({ name: "jevsteer-scenario-host", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["bin/jevsteer.mjs"], env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null)), stderr: "pipe" });
const textOf = (response) => response.content?.find((c) => c.type === "text")?.text;
try {
  await client.connect(transport);
  const doctor = await client.callTool({ name: "browser_doctor", arguments: {} });
  const readiness = doctor.structuredContent || (doctor.isError ? { status: "tool_error", error: textOf(doctor) } : JSON.parse(textOf(doctor)));
  console.log(`Doctor: ${readiness.status}; connected tabs: ${readiness.connected_tabs ?? 0}${readiness.error ? `; ${String(readiness.error).split("\n")[0]}` : ""}`);
  let opened;
  if (startUrl && contract.tab_id) console.log(`Using tab ${contract.tab_id}; start_url is only opened for a run without tab_id.`);
  else if (startUrl) {
    const response = await client.callTool({ name: "browser_open", arguments: { url: startUrl, new_tab: true } });
    opened = response.isError ? { error: textOf(response) } : response.structuredContent || JSON.parse(textOf(response));
    // navigation_unconfirmed also returns a tab_id. Never run on a page whose
    // destination was not confirmed.
    if (!opened.tab_id || opened.status || opened.error) throw new Error(`browser_open did not confirm ${startUrl}: ${opened.status || opened.error}`);
    console.log(`Opened ${opened.url} in tab ${opened.tab_id}`);
    contract.tab_id = opened.tab_id;
  }
  const response = await client.callTool({ name: "browser_run", arguments: contract }, undefined, { timeout: 600000 });
  const responseText = textOf(response);
  const result = response.structuredContent || (response.isError ? { status: "tool_error", error: responseText } : JSON.parse(responseText));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ contract: source, opened, response, result }, null, 2));
  console.log(JSON.stringify({ status: result.status, error: result.error, tab_id: contract.tab_id, run_id: result.run_id, milestone_index: result.milestone_index, actions: result.actions, next_milestone_index: result.next_milestone_index, verification: result.verification, info: result.info, page_text: result.page_text }, null, 2));
} finally {
  await client.close();
}
