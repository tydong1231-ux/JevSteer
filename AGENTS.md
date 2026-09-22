# JevSteer host policy

When `jevsteer` MCP is available:

- Use `browser_run` for outcome-level web tasks; do not micromanage clicks.
- For long workflows, YOU are the planner: define semantic milestones before execution.
- Each milestone needs one goal, measurable success criteria, constraints, and only the workflow facts Jev needs as `guidance`.
- Guidance is not a click script. Prefer facts such as "Save keeps the record in draft; Continue advances to review."
- Use `review_mode=strict` when milestone boundaries need host acceptance; use `fast` for low-risk repetitive work.
- On `milestone_ready_for_review`, inspect the Evidence Packet. Continue at `next_milestone_index` only if accepted.
- On `needs_guidance`, patch only the CURRENT milestone guidance/criteria and rerun the same `milestone_index`/`run_id`. Do not take over the whole browser.
- Use `browser_evidence` only when the compact Evidence Packet is insufficient.
- Use `browser_snapshot` + `browser_act` only for one surgical recovery step, then return to `browser_run`.
- Use host vision only for `needs_vision`/visual-only UI.
- Never bypass CAPTCHA, 2FA, payment, destructive, legal/tax or security confirmations.
