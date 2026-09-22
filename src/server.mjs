import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { JevSteerRuntime } from "./runtime.mjs";

const SERVER_POLICY = [
  "Use browser_run for outcome-level web tasks; do not micromanage clicks.",
  "For long tasks, the HOST defines milestones. Each milestone must describe one observable outcome, measurable success criteria, constraints, and only the workflow facts needed for that stage. Do not encode click scripts as guidance.",
  "JevSteer loops inside a milestone: observe -> decide -> act -> verify effect -> observe. It escalates instead of guessing when workflow knowledge is missing.",
  "On needs_guidance, add one or more concise workflow facts to the CURRENT milestone guidance and rerun the same milestone_index/run_id. Do not take over the whole browser unless the task needs vision or an unsupported interaction.",
  "In strict review_mode, browser_run returns milestone_ready_for_review after each verified milestone. Review its Evidence Packet; continue with next_milestone_index only if accepted. If rejected, rerun the same milestone with corrected guidance/criteria.",
  "Evidence Packets contain action-effect checks, final verification and filtered network evidence. Use browser_evidence only when a referenced request/response needs deeper inspection.",
  "Only completed_verified is automatic final success. milestone_ready_for_review means the executor passed its checks but the host still owns acceptance.",
  "Put secrets only in values. Never bypass CAPTCHA, 2FA, security prompts, destructive confirmations or payment/legal submission confirmation.",
].join(" ");

const text = (value) => {
  const content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  return value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value)
    ? { content, structuredContent: value }
    : { content };
};
const fail = (error) => ({ isError: true, content: [{ type: "text", text: String(error?.message ?? error).split("\n")[0] }] });
const wrap = (handler) => async (args) => { try { return await handler(args); } catch (error) { return fail(error); } };

const assertionSchema = z.object({
  type: z.enum(["text_contains", "text_not_contains", "title_contains", "url_contains", "url_matches"]),
  value: z.string().min(1).max(300),
  case_sensitive: z.boolean().optional().default(false),
  flags: z.string().max(8).optional(),
});

const milestoneSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  goal: z.string().min(1).max(1000).describe("One observable stage outcome, not click instructions."),
  success_criteria: z.array(z.string().min(1).max(500)).max(8).optional(),
  constraints: z.array(z.string().min(1).max(500)).max(8).optional(),
  guidance: z.array(z.string().min(1).max(500)).max(8).optional().describe("Just-in-time workflow facts. Example: 'Save keeps the user in the editor; Continue advances to review.' Do not give selector/click scripts."),
  assertions: z.array(assertionSchema).max(12).optional(),
  max_actions: z.number().int().min(1).max(40).optional(),
});

export function createServer() {
  const runtime = new JevSteerRuntime();
  const server = new McpServer({
    name: "jevsteer",
    title: "JevSteer Browser Runtime",
    version: "0.3.0",
    description: "Host-planned, verified low-cost browser execution: milestones by the host, Jev inside each milestone, Kapture on the user's Chrome.",
  }, { instructions: SERVER_POLICY });

  server.registerTool("browser_doctor", {
    title: "Browser Doctor",
    description: "Check TypeSafe, Kapture, connected tabs and tab leases.",
    inputSchema: z.object({}),
  }, wrap(async () => text(await runtime.doctor())));

  server.registerTool("browser_tabs", {
    title: "List Browser Tabs",
    description: "List Chrome tabs connected through Kapture.",
    inputSchema: z.object({}),
  }, wrap(async () => text({ tabs: await runtime.tabs() })));

  server.registerTool("browser_open", {
    title: "Open URL",
    description: "Open an absolute URL in the user's real Chrome session.",
    inputSchema: z.object({
      url: z.string().url(),
      tab_id: z.string().optional(),
      new_tab: z.boolean().optional().default(true),
    }),
  }, wrap(async ({ url, tab_id, new_tab }) => text(await runtime.open(url, { tabId: tab_id, newTab: new_tab }))));

  server.registerTool("browser_run", {
    title: "Run Browser Task",
    description: [
      "DEFAULT browser executor. For short tasks, pass goal + success_criteria. For long workflows, the HOST should define milestones before execution.",
      "A milestone is a semantic checkpoint: one outcome + measurable success_criteria + optional constraints/guidance/assertions. Guidance should contain only product/workflow facts Jev cannot infer reliably from the current DOM; never provide click-by-click instructions.",
      "Inside each milestone JevSteer repeatedly observes the DOM, chooses one action, executes it, records a mechanical action-effect check, and re-observes before choosing the next action.",
      "If Jev cannot safely infer the next business transition it returns needs_guidance. Patch only the current milestone guidance and rerun the same milestone_index with the same run_id.",
      "review_mode=strict returns milestone_ready_for_review after every internally verified milestone with an Evidence Packet. The host accepts by invoking the same plan at next_milestone_index; reject by rerunning the same milestone with corrected guidance/criteria.",
      "review_mode=fast automatically proceeds across verified milestones and only escalates uncertainty/unsupported/high-risk steps.",
      "evidence_level=relevant captures network metadata plus sanitized request/response evidence for mutating/error requests when Kapture network monitoring is available.",
    ].join("\n"),
    inputSchema: z.object({
      goal: z.string().min(1).max(1000).describe("Overall outcome."),
      milestones: z.array(milestoneSchema).max(12).optional().describe("Host-defined semantic checkpoints for long workflows."),
      review_mode: z.enum(["fast", "strict"]).optional().default("fast"),
      milestone_index: z.number().int().min(0).max(11).optional().default(0).describe("Which milestone to execute/resume. In strict mode use next_milestone_index after host acceptance."),
      run_id: z.string().max(120).optional().describe("Reuse the returned run_id across milestone reviews/retries so evidence references remain grouped."),
      success_criteria: z.array(z.string().min(1).max(500)).max(8).optional().describe("Single-goal mode only."),
      constraints: z.array(z.string().min(1).max(500)).max(8).optional().describe("Global constraints; inherited by every milestone."),
      guidance: z.array(z.string().min(1).max(500)).max(8).optional().describe("Global workflow facts; inherited by every milestone. Prefer milestone-specific guidance."),
      assertions: z.array(assertionSchema).max(12).optional().describe("Single-goal mode only."),
      tab_id: z.string().optional(),
      values: z.record(z.string(), z.string()).optional().describe("Named strings Jev may type/select. Secret-like keys are hidden from Jev."),
      max_actions: z.number().int().min(1).max(40).optional().default(12),
      evidence_level: z.enum(["none", "summary", "relevant"]).optional().default("relevant"),
      allow_irreversible: z.boolean().optional().default(false),
      explain: z.boolean().optional().default(false),
    }),
  }, wrap(async ({ goal, milestones, review_mode, milestone_index, run_id, success_criteria, constraints, guidance, assertions, tab_id, values, max_actions, evidence_level, allow_irreversible, explain }) => text(await runtime.run(goal, {
    milestones: milestones || [],
    reviewMode: review_mode,
    milestoneIndex: milestone_index,
    runId: run_id,
    successCriteria: success_criteria || [],
    constraints: constraints || [],
    guidance: guidance || [],
    assertions: assertions || [],
    tabId: tab_id,
    values: values || {},
    maxActions: max_actions,
    evidenceLevel: evidence_level,
    allowIrreversible: allow_irreversible,
    explain,
  }))));

  server.registerTool("browser_evidence", {
    title: "Inspect Evidence",
    description: "Expand one sanitized network request/response referenced by a milestone Evidence Packet. Use only when the compact packet is insufficient.",
    inputSchema: z.object({ evidence_ref: z.string().min(1).max(300) }),
  }, wrap(async ({ evidence_ref }) => text(runtime.getEvidence(evidence_ref))));

  server.registerTool("browser_check", {
    title: "Check Browser Page",
    description: "Ask Jev one semantic yes/no question about the current DOM state.",
    inputSchema: z.object({ question: z.string().min(1), tab_id: z.string().optional() }),
  }, wrap(async ({ question, tab_id }) => text({ question, p_yes: Number((await runtime.check(question, { tabId: tab_id })).toFixed(3)) })));

  server.registerTool("browser_snapshot", {
    title: "Browser Snapshot",
    description: "RECOVERY tool: compact DOM state. Prefer patching milestone guidance over manual control when status=needs_guidance.",
    inputSchema: z.object({ tab_id: z.string().optional() }),
  }, wrap(async ({ tab_id }) => text(await runtime.snapshotText(tab_id))));

  server.registerTool("browser_act", {
    title: "Manual Browser Action",
    description: "RECOVERY ONLY. Perform one surgical DOM action, then return to browser_run.",
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
    description: "Visual fallback for the host. Jev itself remains DOM-first.",
    inputSchema: z.object({ tab_id: z.string().optional() }),
  }, wrap(async ({ tab_id }) => {
    const tab = await runtime.selectTab(tab_id);
    const shot = await runtime.kapture.screenshot(tab.tabId, { scale: 1, format: "png" });
    if (!shot?.data) throw new Error("Kapture screenshot did not return image data");
    return { content: [{ type: "image", data: shot.data, mimeType: shot.mimeType || "image/png" }] };
  }));

  const originalClose = server.close.bind(server);
  server.close = async () => { await runtime.close().catch(() => {}); await originalClose(); };
  return server;
}

export { SERVER_POLICY };
