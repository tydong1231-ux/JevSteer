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
  "Use verification_mode=host for complex outcomes: Jev executes, the runtime checks assertions, and the HOST independently judges the result. The default hybrid mode also hands uncertain Jev verification to the host. host_review_required is not success. Call browser_review with evidence for every criterion and constraints; the receipt is bound to the observed page and originating milestone. Never accept solely from Jev's completion claim or a transport ACK.",
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
  type: z.enum(["text_contains", "text_not_contains", "title_contains", "url_contains", "url_matches", "field_equals", "control_checked", "element_count"]),
  value: z.union([z.string().max(4000), z.boolean(), z.number().int().nonnegative()]),
  label: z.string().min(1).max(180).optional().describe("Exact accessible control name; required for field_equals, control_checked and element_count."),
  context: z.string().min(1).max(300).optional().describe("Row, dialog or fieldset context that distinguishes duplicate names."),
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

export function createServer({ runtime = new JevSteerRuntime() } = {}) {
  const server = new McpServer({
    name: "jevsteer",
    title: "JevSteer Browser Runtime",
    version: "0.4.0",
    description: "Host-planned, verified low-cost browser execution with Playwright or legacy Kapture.",
  }, { instructions: SERVER_POLICY });

  server.registerTool("browser_doctor", {
    title: "Browser Doctor",
    description: "Check the Jev provider, selected browser driver, connected pages and page leases.",
    inputSchema: z.object({}),
  }, wrap(async () => text(await runtime.doctor())));

  server.registerTool("browser_tabs", {
    title: "List Browser Tabs",
    description: "List pages in the selected browser session. Choose tab_id explicitly when multiple pages exist.",
    inputSchema: z.object({}),
  }, wrap(async () => text({ tabs: await runtime.tabs() })));

  server.registerTool("browser_open", {
    title: "Open URL",
    description: "Open an absolute URL in the user's real Chrome session. Lost navigation acknowledgements are reconciled by observing the exact requested destination without replay. navigation_unconfirmed returns the tab_id for inspection; do not blindly retry.",
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
      verification_mode: z.enum(["hybrid", "host", "jev"]).optional().default("hybrid").describe("Use host for complex results. hybrid hands uncertain semantic verification to the host; jev retains the legacy automatic semantic gate. Host acceptance never overrides failed assertions or safety stops."),
      milestone_index: z.number().int().min(0).max(11).optional().default(0).describe("Which milestone to execute/resume. In strict mode use next_milestone_index after host acceptance."),
      run_id: z.string().max(120).optional().describe("Reuse the returned run_id across milestone reviews/retries so evidence references remain grouped."),
      success_criteria: z.array(z.string().min(1).max(500)).max(8).optional().describe("Single-goal mode only."),
      constraints: z.array(z.string().min(1).max(500)).max(8).optional().describe("Global constraints; inherited by every milestone."),
      guidance: z.array(z.string().min(1).max(500)).max(8).optional().describe("Global workflow facts; inherited by every milestone. Prefer milestone-specific guidance."),
      assertions: z.array(assertionSchema).max(12).optional().describe("Single-goal mode only."),
      tab_id: z.string().optional(),
      values: z.record(z.string(), z.string()).optional().describe("Named strings Jev may type/select. Secret-like keys are hidden from Jev."),
      max_actions: z.number().int().min(1).max(40).optional().default(12),
      max_duration_ms: z.number().int().min(1000).max(900000).optional().default(300000).describe("Cooperative time budget per milestone. No new browser input starts after this budget; an in-flight request keeps its transport timeout."),
      evidence_level: z.enum(["none", "summary", "relevant"]).optional().default("relevant"),
      allow_irreversible: z.boolean().optional().default(false),
      explain: z.boolean().optional().default(false),
    }),
  }, wrap(async ({ goal, milestones, review_mode, verification_mode, milestone_index, run_id, success_criteria, constraints, guidance, assertions, tab_id, values, max_actions, max_duration_ms, evidence_level, allow_irreversible, explain }) => text(await runtime.run(goal, {
    milestones: milestones || [],
    reviewMode: review_mode,
    verificationMode: verification_mode,
    milestoneIndex: milestone_index,
    runId: run_id,
    successCriteria: success_criteria || [],
    constraints: constraints || [],
    guidance: guidance || [],
    assertions: assertions || [],
    tabId: tab_id,
    values: values || {},
    maxActions: max_actions,
    maxDurationMs: max_duration_ms,
    evidenceLevel: evidence_level,
    allowIrreversible: allow_irreversible,
    explain,
  }))));

  server.registerTool("browser_review", {
    title: "Review Browser Outcome",
    description: "HOST ONLY. Independently inspect the result, then accept/reject its durable review ticket. Acceptance requires evidence for the goal, each criterion and all constraints, and an unchanged observed page. It never executes browser input or bypasses failed assertions. Host-verified success is distinct from Jev automatic verification. Reject stale/incorrect results before resuming the same milestone.",
    inputSchema: z.object({
      tab_id: z.string(), review_id: z.string().uuid(), decision: z.enum(["accept", "reject"]),
      goal_evidence: z.string().trim().min(1).max(2000),
      criteria_evidence: z.array(z.string().trim().min(1).max(1000)).max(8).optional().default([]),
      constraints_evidence: z.string().trim().min(1).max(2000).optional(),
    }),
  }, wrap(async ({ tab_id, review_id, decision, goal_evidence, criteria_evidence, constraints_evidence }) => text(await runtime.reviewResult({
    tabId: tab_id, reviewId: review_id, decision, goalEvidence: goal_evidence,
    criteriaEvidence: criteria_evidence, constraintsEvidence: constraints_evidence,
  }))));

  server.registerTool("browser_evidence", {
    title: "Inspect Evidence",
    description: "Expand one sanitized network request/response referenced by a milestone Evidence Packet. Use only when the compact packet is insufficient.",
    inputSchema: z.object({ evidence_ref: z.string().min(1).max(300) }),
  }, wrap(async ({ evidence_ref }) => text(runtime.getEvidence(evidence_ref))));

  server.registerTool("browser_resolve_action", {
    title: "Resolve Unconfirmed Action",
    description: "RECOVERY ONLY. Resolve a pending action after independently inspecting the site outcome. Applied permanently guards confirmed remote mutations across run IDs/process restarts; ordinary navigation remains repeatable. not_applied allows a retry. Neither a transport ACK nor changed page text proves server persistence. Never guess.",
    inputSchema: z.object({
      tab_id: z.string(), action_id: z.string().uuid(),
      resolution: z.enum(["applied", "not_applied"]),
      evidence: z.string().min(1).max(1000).describe("Observed evidence supporting the resolution."),
    }),
  }, wrap(async ({ tab_id, action_id, resolution, evidence }) => text(await runtime.resolveAction({ tabId: tab_id, actionId: action_id, resolution, evidence }))));

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
    description: "RECOVERY ONLY. Perform one surgical DOM action. Guarded operations are journaled before dispatch and return action_unconfirmed plus action_id until their actual outcome is reviewed with browser_resolve_action. Never replay an uncertain action.",
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
    const shot = await runtime.driver.screenshot(tab.tabId, { scale: 1, format: "png" });
    if (!shot?.data) throw new Error("Browser screenshot did not return image data");
    return { content: [{ type: "image", data: shot.data, mimeType: shot.mimeType || "image/png" }] };
  }));

  const originalClose = server.close.bind(server);
  server.close = async () => { await runtime.close().catch(() => {}); await originalClose(); };
  return server;
}

export { SERVER_POLICY };
