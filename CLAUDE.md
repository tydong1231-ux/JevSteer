# JevSteer host policy

When `jevsteer` MCP is available:

- Use `browser_run` for outcome-level web tasks; do not micromanage clicks.
- For long workflows, YOU are the planner: define semantic milestones before execution.
- Each milestone needs one goal, measurable success criteria, constraints, and only the workflow facts Jev needs as `guidance`.
- Guidance is not a click script. Prefer facts such as "Save keeps the record in draft; Continue advances to review."
- For complex outcomes, set `verification_mode=host`: Jev executes and YOU independently judge the result. The default `hybrid` hands uncertain semantic verification to you; `jev` retains the automatic semantic gate.
- On `host_review_required`, inspect fresh page/evidence against the ORIGINAL ticket's contract, then call `browser_review` with goal, each criterion and constraint evidence. It is not success until accepted; never accept solely from Jev's claim or a transport ACK. Reject stale tickets and re-observe the same milestone without replaying input.
- A pending ticket blocks new runs, milestone advancement and input on that tab, including after process restart. `completed_host_verified` is host acceptance, distinct from `completed_verified`.
- Split multiple potentially remote writes into separately reviewable outcomes. Resolve any uncertain earlier write from observed evidence before another mutation; never weaken replay protection to finish a workflow.
- Name the business record in each write's goal, in milestones and in `browser_act` ("Approve the sales invoice for ACME, 50.00"): a confirmed write refuses the same input on the same page under the same goal, and a site can show many records on one address. Keep the goal unchanged for the same record.
- Resolve a `browser_act` input `applied` only when the site itself changed (a save, a submission, an autosave); one that only changed the page, such as a field set before saving, is `not_applied`.
- Use `review_mode=strict` when milestone boundaries need host acceptance; use `fast` for low-risk repetitive work.
- On `milestone_ready_for_review`, inspect the Evidence Packet. Continue at `next_milestone_index` only if accepted.
- On `needs_guidance`, patch only the CURRENT milestone guidance/criteria and rerun the same `milestone_index`/`run_id`. Do not take over the whole browser.
- Use `browser_evidence` only when the compact Evidence Packet is insufficient.
- Use `browser_snapshot` + `browser_act` only for one surgical recovery step, then return to `browser_run`.
- Use host vision only for `needs_vision`/visual-only UI.
- Never bypass CAPTCHA, 2FA, payment, destructive, legal/tax or security confirmations.
