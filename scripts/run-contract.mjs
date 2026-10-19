// Host driver: calls the project's actual browser_run MCP tool with a semantic contract.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const contract = JSON.parse(await readFile(process.argv[2], "utf8"));
const output = process.argv[3] || ".test-artifacts/contract-result.json";
const client = new Client({ name: "jevsteer-scenario-host", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["bin/jevsteer.mjs"], env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null)), stderr: "pipe" });
try {
  await client.connect(transport);
  const doctor = await client.callTool({ name: "browser_doctor", arguments: {} });
  const readiness = doctor.structuredContent || JSON.parse(doctor.content.find((c) => c.type === "text").text);
  console.log(`Doctor: ${readiness.status}; connected tabs: ${readiness.connected_tabs}`);
  const response = await client.callTool({ name: "browser_run", arguments: contract }, undefined, { timeout: 600000 });
  const responseText = response.content.find((c) => c.type === "text")?.text;
  const result = response.structuredContent || (response.isError ? { status: "tool_error", error: responseText } : JSON.parse(responseText));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ contract, response, result }, null, 2));
  console.log(JSON.stringify({ status: result.status, milestone_index: result.milestone_index, actions: result.actions, next_milestone_index: result.next_milestone_index, verification: result.verification, info: result.info, page_text: result.page_text }, null, 2));
} finally {
  await client.close();
}
