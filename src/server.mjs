import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { JevSteerRuntime } from "./runtime.mjs";

const SERVER_POLICY = [
  "Default browser executor: use browser_run for complete outcome-level browser tasks instead of issuing browser actions step by step.",
  "For multi-step or identity-sensitive tasks, include concise success_criteria. Add constraints for actions/effects that must not happen. Add deterministic assertions only when an exact URL/title/text condition is known.",
  "Jev runs the internal action loop cheaply. browser_run independently verifies completion before returning completed_verified.",
  "Do not treat any other status as success. Follow recovery.next_tool and recovery.strategy when present.",
  "For ambiguous, stuck, drifted, verification_failed or verification_uncertain, inspect with browser_snapshot and use browser_act only for one surgical correction, then resume browser_run with the same task contract.",
  "If browser_run returns needs_vision, use browser_screenshot or the host's native computer-use/vision capability for only the visual step, then resume browser_run.",
  "If it returns needs_confirmation, obtain explicit user authorization before re-running the same task contract with allow_irreversible=true.",
  "Put strings to type in values. Put secrets such as passwords in values, not in goal/success_criteria/constraints; secret-like value keys are redacted before Jev sees them.",
].join(" ");

const text = (value) => {
  const content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  if (value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value)) {
    return { content, structuredContent: value };
  }
  return { content };
};
const fail = (error) => ({ isError: true, content: [{ type: "text", text: String(error?.message ?? error).split("\n")[0] }] });
const wrap = (handler) => async (args) => {
  try { return await handler(args); } catch (error) { return fail(error); }
};

const assertionSchema = z.object({
  type: z.enum(["text_contains", "text_not_contains", "title_contains", "url_contains", "url_matches"]),
  value: z.string().min(1).max(300),
  case_sensitive: z.boolean().optional().default(false),
  flags: z.string().max(8).optional().describe("Only used by url_matches. Defaults to case-insensitive matching."),
});

export function createServer() {
  const runtime = new JevSteerRuntime();
  const server = new McpServer({
    name: "jevsteer",
    title: "JevSteer Browser Runtime",
    version: "0.2.0",
    description: "Low-cost verified browser execution: Jev decisions + Kapture control of the user's existing Chrome."
  }, {
    instructions: SERVER_POLICY,
  });

  server.registerTool("browser_doctor", {
    title: "Browser Doctor",
    description: "Check TypeSafe configuration, Kapture server status, browser extension connection, connected tabs, and tab leases. Use this first when browser tools are not working.",
    inputSchema: z.object({}),
  }, wrap(async () => text(await runtime.doctor())));

  server.registerTool("browser_tabs", {
    title: "List Browser Tabs",
    description: "List Chrome/Chromium tabs currently connected through the Kapture extension, including tab ids and lease status.",
    inputSchema: z.object({}),
  }, wrap(async () => text({ tabs: await runtime.tabs() })));

  server.registerTool("browser_open", {
    title: "Open URL",
    description: "Open an absolute URL. By default creates a new real browser tab, preserving the user's normal Chrome profile/login environment.",
    inputSchema: z.object({
      url: z.string().url(),
      tab_id: z.string().optional().describe("Existing connected Kapture tab id. Used only when new_tab=false."),
      new_tab: z.boolean().optional().default(true),
    }),
  }, wrap(async ({ url, tab_id, new_tab }) => text(await runtime.open(url, { tabId: tab_id, newTab: new_tab }))));

  server.registerTool("browser_run", {
    title: "Run Verified Browser Goal",
    description: [
      "DEFAULT tool for browser interaction. Give it one outcome-level goal; it executes many browser steps internally with Jev + Kapture.",
      "For multi-step or identity-sensitive work, provide 1-5 measurable success_criteria so the final verifier can independently accept/reject the result. Example: ['Customer name is exactly ABC Pte Ltd', 'An invoice detail page is open', 'The shown invoice is the newest by date'].",
      "Use constraints for effects that must not happen, e.g. ['Do not edit or send anything']. The executor checks constraint risk before each action.",
      "Use assertions only for facts that can be checked deterministically from URL/title/visible text. Assertions are strict and all must pass.",
      "Put every string that may need typing/selecting in values with meaningful keys. Secrets belong only in values.",
      "Success status is completed_verified. Other statuses include verification_uncertain, verification_failed, needs_login, needs_confirmation, needs_vision, constraint_blocked, drifted, blocked, error, ambiguous, stuck and max_actions.",
      "On non-success, follow the structured recovery object. Use browser_snapshot/browser_act only for one surgical correction, then resume browser_run with the same contract.",
      "Only set allow_irreversible=true after explicit user authorization for the side effect.",
    ].join("\n"),
    inputSchema: z.object({
      goal: z.string().min(1).max(1000).describe("One observable browser outcome, not a list of click instructions."),
      success_criteria: z.array(z.string().min(1).max(500)).max(8).optional().describe("Measurable semantic conditions that must be true at completion. Strongly recommended for multi-step/identity-sensitive tasks."),
      constraints: z.array(z.string().min(1).max(500)).max(8).optional().describe("Actions/effects the executor must avoid throughout the task."),
      assertions: z.array(assertionSchema).max(12).optional().describe("Optional deterministic acceptance checks over URL/title/visible text. All assertions must pass."),
      tab_id: z.string().optional().describe("Connected Kapture tab id. Omit to use the active/visible connected tab."),
      values: z.record(z.string(), z.string()).optional().describe("Named strings Jev may choose to type/select. Secret-like keys are redacted before Jev sees content."),
      max_actions: z.number().int().min(1).max(40).optional().default(12),
      allow_irreversible: z.boolean().optional().default(false),
      explain: z.boolean().optional().default(false).describe("Include per-round Jev probabilities for debugging."),
    }),
  }, wrap(async ({ goal, success_criteria, constraints, assertions, tab_id, values, max_actions, allow_irreversible, explain }) => text(await runtime.run(goal, {
    tabId: tab_id,
    values: values || {},
    successCriteria: success_criteria || [],
    constraints: constraints || [],
    assertions: assertions || [],
    maxActions: max_actions,
    allowIrreversible: allow_irreversible,
    explain,
  }))));

  server.registerTool("browser_check", {
    title: "Check Browser Page",
    description: "Ask Jev a yes/no question about the current DOM-derived page state. This is a recovery/inspection helper; browser_run already performs final contract verification.",
    inputSchema: z.object({
      question: z.string().min(1),
      tab_id: z.string().optional(),
    }),
  }, wrap(async ({ question, tab_id }) => {
    const p = await runtime.check(question, { tabId: tab_id });
    return text({ question, p_yes: Number(p.toFixed(3)) });
  }));

  server.registerTool("browser_snapshot", {
    title: "Browser Snapshot",
    description: "RECOVERY tool. Compact visible text plus numbered interactive DOM elements. Use after ambiguous/stuck/drifted/verification failure, then perform at most one surgical browser_act before resuming browser_run.",
    inputSchema: z.object({ tab_id: z.string().optional() }),
  }, wrap(async ({ tab_id }) => text(await runtime.snapshotText(tab_id))));

  server.registerTool("browser_act", {
    title: "Manual Browser Action",
    description: "RECOVERY tool. Perform one low-level DOM browser action without Jev. Prefer browser_run. Element numbers must come from the latest browser_snapshot for the same tab; after correction, resume browser_run.",
    inputSchema: z.object({
      tab_id: z.string().optional(),
      action: z.enum(["click", "type", "press_enter", "press_key", "select", "hover", "scroll", "back", "wait"]),
      element: z.number().int().min(0).optional(),
      value: z.string().optional(),
      key: z.string().optional(),
    }),
  }, wrap(async ({ tab_id, ...rest }) => text(await runtime.actManual({ tabId: tab_id, ...rest }))));

  server.registerTool("browser_screenshot", {
    title: "Browser Screenshot",
    description: "RECOVERY/visual fallback tool. Capture the current viewport from a connected Kapture tab. Jev itself does not consume screenshots.",
    inputSchema: z.object({ tab_id: z.string().optional() }),
  }, wrap(async ({ tab_id }) => {
    const tab = await runtime.selectTab(tab_id);
    const shot = await runtime.kapture.screenshot(tab.tabId, { scale: 1, format: "png" });
    if (!shot?.data) throw new Error("Kapture screenshot did not return image data");
    return {
      content: [{ type: "image", data: shot.data, mimeType: shot.mimeType || "image/png" }],
    };
  }));

  const originalClose = server.close.bind(server);
  server.close = async () => {
    await runtime.close().catch(() => {});
    await originalClose();
  };

  return server;
}

export { SERVER_POLICY };
