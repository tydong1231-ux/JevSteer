# JevSteer protocol

## Responsibility split

- **Host:** understand user intent/system logic, define milestones, review milestone evidence, patch guidance.
- **Jev:** choose the next action inside one milestone.
- **Runtime:** DOM observation, action execution, deterministic effect checks, drift/safety gates, network evidence.
- **Kapture:** real Chrome control + DOM/network transport.

## Milestone contract

A milestone contains `goal`, `success_criteria`, optional `constraints`, `guidance`, and deterministic `assertions`.

Guidance must be just-in-time workflow knowledge, not selectors or click sequences.

## Loop

`observe -> decide -> act -> verify effect -> observe`

JevSteer never assumes an action succeeded only because the command returned. The next observation records a mechanical effect check; final milestone completion still requires strict semantic/assertion verification.

If workflow knowledge is missing, return `needs_guidance` instead of guessing. The host patches the current milestone and resumes.

## Host review

`strict`: return `milestone_ready_for_review` after each verified milestone. Host acceptance is expressed by starting `next_milestone_index`; rejection reruns the same milestone with corrected guidance/criteria.

`fast`: continue automatically across internally verified milestones.

## Evidence

Each milestone returns a compact Evidence Packet: actions/effects, verification, final page, filtered network evidence. Relevant request/response bodies are sanitized and referenced; expand only when needed via `browser_evidence`.

## Unconfirmed actions

`pending_actions` contains opaque action IDs and the originating run/milestone.
Intent is journaled before input under the same tab lease as network monitoring
and evidence collection, including guarded `browser_act` manual recovery.
Raw URLs, input values and financial record text are not stored in this journal.
A corrupt/unwritable journal prevents dispatch.

Never use a new `run_id` to bypass uncertainty. Inspect the saved record, exact
response or explicit rejection. Call `browser_resolve_action` with `tab_id`,
`action_id`, `resolution` (`applied` or `not_applied`) and a short `evidence` basis.
This declaration resolves uncertainty; it does not execute or undo an action.
An `applied` resolution retains a replay-protected marker for the same action
and semantic business goal even after `pending_actions` becomes empty. A
`not_applied` resolution permits retry. Replay markers are not evicted by the
routine 100-record journal cleanup. A genuinely different milestone goal may
reuse the same UI control, but a new `run_id` cannot bypass the same operation.
Then resume the semantic milestone. Successful independent verification resolves
pending records belonging to that run and milestone only.

Guarded `browser_act` actions return `action_unconfirmed` with an `action_id`
even when the HTTP command acknowledged success, because text fields may
autosave and a Save click may commit asynchronously. The host must inspect the
actual outcome and call `browser_resolve_action` before relying on a retry.
An error after browser dispatch likewise returns the journal ID rather than
hiding the uncertain mutation.

The runtime can continue after a lost acknowledgement only when a low-risk local
effect is mechanically confirmed, or return success when the final task outcome
passes independent verification. A clock tick, changed element count or HTTP 200
alone is not final success. Browser timeouts retain uncertainty and are not
misreported as a definitely open JavaScript dialog.

## Deterministic controls

`field_equals`: string `value` (including empty/multiline), exact `label`, optional
`context`. Invalid or secret fields do not pass. `control_checked`: boolean
`value`, exact `label`, optional `context`; an unknown property never counts as
false. `element_count`: nonnegative integer `value` plus `label`/`context`.
Unsupported/malformed assertions are rejected rather than dropped. Duplicate
labels require context; native dropdown option choices use distinct indices,
even when display labels are identical.

## Runtime limits

`max_actions` bounds decision rounds; `max_duration_ms` bounds starting more
browser input per milestone. Timeouts never cancel or roll back a submitted site
transaction. State journals persist locally; configure `JEVSTEER_STATE_DIR` to a
stable directory for short-lived MCP processes. Host acceptance, login, CAPTCHA,
irreversible confirmation and visual fallback remain explicit protocol outcomes.
