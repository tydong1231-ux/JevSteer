# JevSteer protocol

## Responsibility split

- **Host:** understand user intent/system logic, define milestones, review milestone evidence, patch guidance.
- **Jev:** choose the next action inside one milestone.
- **Runtime:** DOM observation, action execution, deterministic effect checks, drift/safety gates, network evidence.
- **BrowserDriver:** live Page/Frame ownership, observation, real browser inputs
  and events. Playwright is opt-in during migration; Kapture remains available.

## BrowserDriver boundary

`src/browser/driver.mjs` defines the JavaScript contract. Runtime policy, leases,
journals and verification do not depend on Kapture transport commands. Drivers
provide page discovery/opening, observation, target validation, physical input,
bounded read-only waits, screenshots and event cursors. Public `tab_id` remains
compatible; Playwright exposes physical Chromium target IDs as `pw:<targetId>`
plus a separate logical `session_id`. Two CDP connection aliases to the same
physical Page therefore share the journal and lease key.

Playwright observations include immutable snapshot IDs and per-target page,
frame, document, form and record context. DOM positions only locate candidates.
Before input, the driver requires unique semantic identity and the same document,
then pins that node for a single dispatch. It checks the pinned node again after
the durable journal hook. Detachment or recycled record identity fails closed;
Playwright cannot retry that action against a different virtual row. Handles are
disposed immediately after the action, never persisted as business identities.

`ActionResult.state` distinguishes `predispatch_rejected`, `dispatched_ack` and
`dispatched_unknown`. A known predispatch rejection may resolve its intent as
`not_applied`; any exception after the first possible input is conservative
`dispatched_unknown`. No browser ACK is promoted to business verification by the
driver. Independent observation/verification/Host Review owns that transition.
Input mode and dispatch state appear in action evidence.

In explore mode, every state-changing input with explicit task constraints gets
an exact selected-action constraint check, including locally reversible clicks.
Low remote/irreversible risk does not authorize a forbidden row selection. The
restricted form frontier instead checks **any** offered control/value against
constraints before binding, then permits only those validated TYPE/SELECT inputs.
Every guarded explore input also gets an exact remote/irreversible effect check,
regardless of its rough score. Read-only excludes remote preference writes such
as favorite/star/bookmark/subscription toggles, not just financial record saves.

A profile/endpoint has a stable logical session namespace. An unresolved action
on a closed/replaced Page blocks new input on other Pages in that session. The
host can resolve the original `tab_id` and action ID after independent readback,
even when the physical Page no longer exists. Changing profile/driver is not an
automatic journal migration: finish/reconcile old workflows before switching.

Browser dialogs are held for host intervention; the driver never accepts them.
Visual-only controls still return to the host. Network events contain sanitized
metadata; response body capture is disabled by default. Only test setup and
independent read-only oracles may use fixture/application APIs; target operations
remain browser inputs.

`browser_inspect(tab_id)` is a Playwright-only fixed Host reader. It returns
bounded visible main-frame business table cells, control values and disabled
ancestry without Jev inference or browser input. Secret-like controls are
redacted; financial evidence remains private. Limits/truncation are explicit.
Visible virtual rows are not evidence of the entire dataset, and this reader
does not assert server persistence or create an acceptance receipt. Tab discovery
does not install event collectors on unrelated pages.

## Milestone contract

`execution_mode=explore` preserves normal one-step Jev decisions.
`execution_mode=form` is an opt-in strategy for native Playwright with
`verification_mode=host`, no unresolved actions, and 1–12 non-secret
current-stage values. It issues one independent binding head per value plus
shared remote-effect, irreversible, constraint, login and unsupported-state
checks. It uses the existing side-effect safety threshold; final assertions and
Host acceptance are unchanged. Uncertain bindings never fall through to input.

Before any field input, validate duplicate targets, confidence, exact host field
assertion conflicts, native option values and common form/record/Frame/document
ownership. Each resulting TYPE/native SELECT passes the ordinary target,
Journal and action-effect guards. Every prior field is checked again before the
next input; a dependency reset stops for guidance before further changes. The
host may resume the current stage with narrowed values or use explore for an
unsupported widget. Batch mode never executes Save, Enter, navigation or custom
combobox expansion. Commit remains a separate independently reviewable stage.

A milestone contains `goal`, `success_criteria`, optional `constraints`, `guidance`, and deterministic `assertions`.

Guidance must be just-in-time workflow knowledge, not selectors or click sequences.

## Loop

`observe -> decide -> act -> verify effect -> observe`

JevSteer never assumes an action succeeded only because the command returned. The next observation records a mechanical effect check; final milestone completion still requires strict semantic/assertion verification.

If workflow knowledge is missing, return `needs_guidance` instead of guessing. The host patches the current milestone and resumes.

## Host review

`verification_mode` controls who judges completion, independently of `review_mode`:

- `host`: deterministic assertions must pass, then return `host_review_required` with an observation and durable review ticket; Jev does not make the final semantic judgment.
- `hybrid` (default): use the automatic semantic gate, but hand uncertain results to the host. A failed assertion or hard semantic failure remains a failure.
- `jev`: retain the legacy automatic semantic gate and uncertainty status.

The host independently inspects the observation and any expanded evidence against
the originating ticket's contract, not just Jev's done score or an HTTP ACK. Call
`browser_review` with `tab_id`, `review_id`, `decision` (`accept`/`reject`),
`goal_evidence`, one `criteria_evidence` string per success criterion, and
`constraints_evidence` when constraints exist. Acceptance executes no browser input.
It returns `milestone_accepted` with the next index, or `completed_host_verified`
at the final milestone. This is distinct from automatic `completed_verified`.
In host mode, passing a nonempty assertion set is an immediate review checkpoint,
even if Jev's done score is low, preventing unnecessary extra actions. Assertions
must distinguish the requested result from the starting page. They are not a
substitute for the host checking all semantic criteria and rejecting weak matches.

A pending ticket blocks browser input, navigation and new runs on that tab across
MCP restarts. Acceptance requires the same observed page state and a non-busy page.
`host_review_stale` requires rejection and re-observation of the same milestone,
not replaying the earlier action. Rejection does not clear uncertain mutations;
acceptance resolves only the originating run/milestone's pending actions, retaining
remote replay guards. Review storage contains hashes and protocol metadata only,
not raw page, task values or evidence prose. CAPTCHA/login, irreversible actions,
failed assertions and safety stops cannot be overridden by host verification.
Ticket creation and acceptance use the same read-only inspection environment.
When network capture is enabled, a short inspection capture reproduces Chrome's
debugger-notice viewport so attach/detach does not create a false stale result.
Assertions are checked again on the stable ticket observation after evidence
cleanup. Inspection capture is always released and performs no browser input.

If Jev returns no next action while an originating remote request is still pending,
host mode can passively wait up to the remaining action-settling/time budget for a
nonempty assertion set to pass on a stable, non-busy page. This only observes; it
never replays the request, resolves the journal or accepts the result automatically.
Missing/busy outcomes time out and remain unconfirmed.

Multiple remote writes need separately reviewable outcomes. If an earlier write is
unconfirmed, independently inspect and resolve it before the next mutation; do not
treat any generic page change as proof that a transaction persisted.

`strict`: return `milestone_ready_for_review` after each verified milestone. Host acceptance is expressed by starting `next_milestone_index`; rejection reruns the same milestone with corrected guidance/criteria.

`fast`: continue automatically across internally verified milestones. Neither setting bypasses a `host_review_required` ticket; the explicit `browser_review` receipt is required first.

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
An `applied` resolution of a remote mutation (recorded risk at or above 0.25)
retains a replay-protected marker for the same action and semantic business goal
even after `pending_actions` becomes empty. Confirmed low-risk link/navigation
operations remain repeatable. A `not_applied` resolution permits retry. Replay
markers are not evicted by routine 100-record journal cleanup. For automated
runs a genuinely different milestone goal may reuse the same UI control, but
a new `run_id` cannot bypass the same operation. Manual recovery mutations
have no semantic goal hash and retain a broader same-action guard.
Then resume the semantic milestone. Successful independent verification resolves
pending records only when the run, milestone **and full originating contract
digest** match. Goal/criteria changes cannot certify an earlier unknown action.
Old journal records remain readable, but records without a contract digest need
explicit evidence-based `browser_resolve_action`; automatic/Host acceptance does
not silently migrate or clear them. Receipts expose any remaining pending IDs.

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

When several named values are supplied, a unique `field_equals` assertion for the
selected field binds its exact expected value to the one matching `task.values`
entry without another model choice. Duplicate labels need unique context; conflicting
assertions, missing values or duplicate matching entries stop for guidance rather
than guessing. With no applicable assertion the model uses the selected field's
explicit label/name first. Range pickers can still reorder coupled date endpoints;
keep intermediate ranges valid and verify both controls plus the generated heading.

## Runtime limits

`max_actions` bounds decision rounds; `max_duration_ms` bounds starting more
browser input per milestone. Timeouts never cancel or roll back a submitted site
transaction. State journals persist locally; configure `JEVSTEER_STATE_DIR` to a
stable directory for short-lived MCP processes. Host acceptance, login, CAPTCHA,
irreversible confirmation and visual fallback remain explicit protocol outcomes.

Transient content-script teardown is retried a bounded number of times during
observation. Link navigation, explicit GET search forms and search Enter wait for route progress
within `JEVSTEER_NAVIGATION_SETTLE_MS`; no browser input is replayed by this wait.
`browser_open` can return `navigation_unconfirmed` with a `tab_id` when its
acknowledgement is lost and fresh DOM metadata cannot confirm the exact requested
URL. Inspect that tab before another navigation. Redirects to a different URL
are not automatically treated as confirmation of the requested destination.
