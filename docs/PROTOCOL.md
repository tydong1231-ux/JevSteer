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
The effect and constraint questions are separate Jev requests sent at once; the
constraint request sees the page text only. A missing constraint answer counts
as a violation, and the constraint verdict is applied after the replay and
journal gates. `allow_irreversible` does not lift a `constraint_blocked` stop:
settle the doubt with a guidance fact the host has checked (for example, that no
duplicate record exists) or change the constraint. The effect request treats
`guidance` and `constraints` as host facts about what a control does, so a fact
such as "Generate only calculates the report" keeps a read-only button out of
the remote-write journal.

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

An `aria-disabled=true` ancestor disables every control inside it, except a
dnd-kit sortable or draggable item (`aria-roledescription` sortable/draggable, or
a `DndDescribedBy-N` description), whose `aria-disabled` only turns dragging off.
Input to a target inside one skips Playwright's enabled check once a trial hover
shows the target is visible, stable and not covered. `browser_inspect` marks such
an ancestor `drag_only`.

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

Pages often rewrite text next to a field as it is filled: live totals, formatted
previews, character counters, validation messages. The effect check, the
"already typed" filter and form-mode bindings first look for the exact control.
If only its surrounding text changed, they accept the one control with the same
label, name, form, record, frame and document, provided it was the only such
control before. Equal controls in unkeyed rows still need their record text.
Pre-input target checks and journal fingerprints stay exact.

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
That observation waits for the page to stay unchanged for
`JEVSTEER_REVIEW_QUIET_MS` (default 1000), so a field filled by a later request,
such as a bill's file type, is part of the ticket rather than making it stale
before the host accepts.

If Jev returns no next action while an originating remote request is still pending,
host mode can passively wait up to the remaining action-settling/time budget for a
nonempty assertion set to pass on a stable, non-busy page. This only observes; it
never replays the request, resolves the journal or accepts the result automatically.
Missing/busy outcomes time out and remain unconfirmed.

After a remote write this milestone sent, such as Create or Save, Jev may see no
clear next step because the goal is already reached. Before returning
`needs_guidance`, the runtime then checks the contract on the current page. A
pass completes the milestone (`completed_verified`, or `host_review_required` in
host mode or when hybrid verification is unsure); otherwise the milestone still
stops with `needs_guidance`. No input is sent for this check.

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

Typing a value that reads as a calendar date (`2026/1/1`, `10/20/2026`,
`2026年1月1日`, `Oct 20, 2026`) ends by leaving the field, unless it is a
combobox. Date pickers such as antd's commit a typed date only then, so a
Generate or Save click right after typing would otherwise read the old date.
The driver then waits for the page to draw two frames (at most 250 ms), the
frame in which such a picker writes its value back. The effect check then sees
the committed value and accepts the same date rewritten with other padding or
separators (`2026/01/01`). Fast input also sends a Shift key press after
filling, for widgets that parse fields on key events.

## Runtime limits

`max_actions` bounds decision rounds; `max_duration_ms` bounds starting more
browser input per milestone. Timeouts never cancel or roll back a submitted site
transaction. State journals persist locally; configure `JEVSTEER_STATE_DIR` to a
stable directory for short-lived MCP processes. Host acceptance, login, CAPTCHA,
irreversible confirmation and visual fallback remain explicit protocol outcomes.

Transient content-script teardown is retried a bounded number of times during
observation, as is a page read that a redirect interrupts ("Execution context was
destroyed"); up to five reads, 1.5 s in all.

With the Playwright driver, observation after an input also waits while XHR or
fetch requests the page started after that input are still open, up to the
action settle budget (`JEVSTEER_ACTION_SETTLE_MS`). A report whose Generate
button shows nothing until its request returns is then seen in the same round,
without waits or a second click. A request open for 8 s or more counts as a long
poll or stream; it and later requests to its endpoint are not waited on. A click
that has changed nothing yet is watched for 1 s more, since handlers can wait
before sending a request; clicks into text fields and native selects are not.
Each action in the result carries `requests`: how many data requests the page
sent after it. A click with an `unknown` effect and `requests: 0` did not reach
a handler that does anything visible or remote. Link navigation, the submit button of an explicit GET search form
and search Enter wait for route progress within `JEVSTEER_NAVIGATION_SETTLE_MS`;
no browser input is replayed by this wait. Checkboxes, radios and fields inside
that form, and same-page `#` links, are judged in place without that wait.
A `wait` after which the page did not change and nothing on it is loading is
marked `page_changed: false` in history. `JEVSTEER_MAX_IDLE_WAITS` (default 3)
such waits in a row stop the milestone as `stuck`; `JEVSTEER_MAX_WAITS`
(default 12) bounds all waits.
`browser_open` can return `navigation_unconfirmed` with a `tab_id` when its
acknowledgement is lost and fresh DOM metadata cannot confirm the exact requested
URL. Inspect that tab before another navigation. Redirects to a different URL
are not automatically treated as confirmation of the requested destination.
