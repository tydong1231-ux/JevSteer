import { contractForResume } from "./task-contract.mjs";

const MAP = {
  ambiguous: ["host_dom_choice", "browser_snapshot", true],
  stuck: ["inspect_and_replan", "browser_snapshot", true],
  max_actions: ["inspect_and_replan", "browser_snapshot", true],
  drifted: ["inspect_and_replan", "browser_snapshot", true],
  needs_guidance: ["host_guidance_patch", null, true],
  needs_vision: ["host_visual_step", "browser_screenshot", true],
  needs_login: ["user_login", null, true],
  needs_confirmation: ["user_confirmation", null, true],
  verification_uncertain: ["host_verify", "browser_snapshot", true],
  verification_failed: ["inspect_and_replan", "browser_snapshot", true],
  blocked: ["resolve_external_blocker", "browser_snapshot", true],
  error: ["inspect_error", "browser_snapshot", true],
  constraint_blocked: ["refine_or_confirm_contract", "browser_snapshot", false],
  needs_tab_selection: ["select_tab", "browser_tabs", true],
};

export function recoveryFor(status, { tabId, contract, checkpoint, failedStep, candidates, info } = {}) {
  const spec = MAP[status];
  if (!spec) return undefined;
  const [strategy, nextTool, resumeAfter] = spec;
  return {
    strategy,
    ...(nextTool ? { next_tool: nextTool } : {}),
    resume_after: resumeAfter,
    ...(info ? { reason: info } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(failedStep ? { failed_step: failedStep } : {}),
    ...(candidates?.length ? { candidates } : {}),
    resume_context: {
      tab_id: tabId,
      ...(contract ? contractForResume(contract) : {}),
    },
  };
}
