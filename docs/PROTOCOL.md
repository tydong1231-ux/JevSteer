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
on a closed/replaced Page blocks new input on other Pages in that session.
`browser_snapshot` still reads any page. Opening a page sends it no input, but
its address is a request to the site, which can change something (a GET that
saves, a logout) or wipe what the action left. So while the action is
unresolved, `browser_open` opens only `about:blank` or the address the action
was chosen on (kept as a digest in its journal record), such as the record
list in a new tab, to check on the site what the action did. Any other
address, and any navigation of a page whose own input is unresolved, is
refused with `UNCONFIRMED_SESSION_ACTION` before a request is made. The host
can resolve the original `tab_id` and action ID after independent readback,
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
Pre-input target checks and journal fingerprints stay exact. Two links with the
same text, context and address (Wikipedia's "20 | 50 | 100" pager above and
below a list) load the same page, so a click on either is the same click; any
other target that matches two identical controls is told apart from them only
by what it shows or holds and what is next to it: its hint, the value it shows,
its value, options and state, and the text and table column beside it (two
unnamed selects in one filter row, "Status" and "Vendor"). The control that
still shows what the chosen one showed is the one used, wherever the page has
moved it. Order never decides: a page can swap equal nodes without anything
observed changing. Controls that nothing observed tells apart are refused
before input (`STALE_TARGET: ambiguous`); Jev gets one more look, then the
milestone stops as `ambiguous` for the host. A refused choice sends no input, so
on the unchanged page it is not reported as a page error.

A field with no accessible name, placeholder or label element takes the name a
person reads next to it (Playwright driver): its column's header in a table (also
an antd header table kept apart from the body), else the text just before it in
the boxes around it that hold no other field, when that text sits just above it
or just before it on the same line (an antd Form.Item caption such as
"Customer" or "Due Date"). A search icon in the field's own box adds "(search)",
or names it "Search" alone. A placeholder that only says how to fill a field
("Select date", "请输入", "YYYY-MM-DD") gives way to such a label and stays in
`placeholder`. Text drawn over a field that has no placeholder attribute (a
global search's "Search contacts, vendor bills, ..." layer, or an antd select's
placeholder) is reported as `hint`: it tells Jev what an unnamed field is for,
but it is never the field's name, because it goes away once the field holds a
value. A field in a table cell also reports its column header as `column`; such
a field belongs to its row's item, such as an invoice line, and the value
chooser is told so. A select-like combobox whose input holds only search text
(antd, react-select) reports the value it shows as `display`, and a field this
run typed that now shows the typed value there is not offered for TYPE again.

antd draws a select's options in a portal at the end of `<body>`, as divs with
`aria-selected` and no role, and keeps `role=option` copies in a 0×0 listbox
for screen readers. The visible divs are observed as options, also while a
drawer or modal is open; the hidden copies are not (a click on them only waits
until it times out). An open combobox is not offered for SELECT itself, which
would only close its list again. SELECT offers the options its list shows
instead: those in the list its `aria-controls` or `aria-owns` names, or in the
floating box that holds that list (antd's visible copy), or, with no such link,
options floating on their own while it is the one open combobox. Each such
option carries `popup_of`, the `[i]` of its combobox, and choosing one is a
click on that option (the run log shows `tool: "click"`, `chosen_as: "select"`).
SELECT on a closed custom combobox opens it with a click. When another
combobox's open list covers it, that click is refused before the journal
(`predispatch_rejected`, nothing pending), and the error names the cover:
`the target is covered by another element (<div class="ant-select-dropdown">); no input was sent`.
Any covered target is refused this way, and Jev looks again with the refusal
in its history (`recovery: "reobserve"`, `reason: "target_covered"`), as after
a stale target; the same choice a third time on the same page stops the run as
`stuck`. A target that never becomes ready for another reason (it keeps
moving, say) stops the run as `action_failed`, with nothing pending.

A focused text field that holds text can draw results or suggestions under or
over itself with no ARIA link, such as ccMonet's global search ("Vendor 1
CP-MEIJI CO.,LTD."). A floating box in a wrapper up to four levels out from the
field, later in the page, across from it and at most 64 px under or over it,
that holds a control other than a text field, is the field's popup. Its
controls carry `popup_of`, and Jev's page gets
`popup: { field, field_value, shows }`, also in the first call of a two-stage
decision on a large page. The floating parts of the next line item (an antd
select's search box, a remove button at the row's end), a fixed bar above the
field and a footer far below it are not popups. A field this run typed keeps
the `hint` it showed then, so the search box still reads as "Search contacts,
..." after its hint layer goes. When the contract has success criteria, Jev's
done question tells it to check each of them against the page as it is now,
`page.popup` included.

If workflow knowledge is missing, return `needs_guidance` instead of guessing. The host patches the current milestone and resumes.
A target head with only one offered target can also answer `__none__`: that
target does not fit the action toward the goal (after the global search was
typed, "Page Size" was the only TYPE target left). When it is the chosen
action's head, no input is sent and the milestone stops with `needs_guidance`;
`info` says the one control does not fit task.goal.

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
A toast, such as antd's "Update successfully" message (under any class prefix),
a toast or snackbar, or another fixed-position alert or status region, goes away
on its own, so the state a ticket binds leaves its text out; the host still sees
it in the ticket's observation. The ticket keeps a digest of each toast it
showed, and any other toast at acceptance, such as a late error, makes the
ticket stale. A count in a badge (a sidebar "Todo 41" that becomes 42 when the
saved record adds a to-do) is left out of the bound state too: a badge has a
class hook (badge, unread, antd's scroll-number) or is a small filled pill.
When the milestone's contract speaks of a badge (it names the badge, such as
"Cart" or "Todo", states its number, or asks about counts, unread items or
notifications), its counts stay in the bound state, so "Cart 2" turning into
"Cart 3" makes the ticket stale. A toast over an open drawer or modal is part of
the page text too. A new ticket waits while a toast shows, up to
`JEVSTEER_REVIEW_TOAST_WAIT_MS` (default 4000), because the app may still be
closing a drawer and reloading its list behind it. Acceptance does not wait: a
toast then still makes the ticket stale. A deterministic assertion passes a
ticket only when it also holds on what the ticket binds, the page without its
toasts, so it still holds when the host accepts. An assertion met only by a
toast fails with `verification_failed`: assert what the page keeps (a status,
a saved row) instead.
`host_review_stale` requires rejection and re-observation of the same milestone,
not replaying the earlier action. After a stale ticket is rejected, rerunning
that milestone with the same `run_id` re-observes: in host and hybrid modes the
runtime checks the contract on the current page before Jev decides anything, and
issues a fresh ticket when it holds. Only when the check fails does Jev act
again. A ticket rejected for its result rather than for staleness resumes
normally. Rejection does not clear uncertain mutations;
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
clear next step, no action at all, or no confident target, because the goal is
already reached. Before stopping with `needs_guidance`, `stuck` or `ambiguous`,
the runtime then checks the contract on the current page. Completion still takes
both keys: Jev's own reading (a done score of at least 0.35) and the verifier.
A verifier pass that Jev does not share goes to the host
(`host_review_required` in host and hybrid modes; `verification_uncertain` in
jev mode, with the write still pending). A pass both agree on completes the
milestone (`completed_verified`, or `host_review_required` in host mode). When
Jev did not find the goal reached and the result goes to the host, its `info`
says what the write left behind: the message the page showed after it, or that
none appeared, and that the page sent no data request after it when that is so.
A Save that a required field stopped without a word looks like this; check the
site before accepting. When the check fails, the milestone stops as before. No
input is sent for this check.

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
hiding the uncertain mutation. `press_key` Escape, on an element or on none, is
journaled the same way. It usually only closes a menu, popup or dialog, but a
page can answer it (an autosave, a cancel) on channels the runtime cannot fully
see: a WebSocket opened before JevSteer attached, a service worker, a save it
debounces. So the runtime never infers its outcome from quiet traffic; the host
checks the page and resolves it. `not_applied` says nothing changed on the site
(a menu, popup or dialog only closed), and Escape can be pressed again.
`applied` says it saved or cancelled something on the site, and then the same
Escape on that page is refused as a replay, like any applied input.

The runtime can continue after a lost acknowledgement only when a low-risk local
effect is mechanically confirmed, or return success when the final task outcome
passes independent verification. A clock tick, changed element count or HTTP 200
alone is not final success. Browser timeouts retain uncertainty and are not
misreported as a definitely open JavaScript dialog.

## Deterministic controls

`field_equals`: string `value` (including empty/multiline), exact `label`, optional
`context`. A select-like combobox whose input holds only search text is compared
by the value it shows (`display`). Invalid or secret fields do not pass. `control_checked`: boolean
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
without waits or a second click. A slow report or save is waited on until it
returns; a request still open after 30 s counts as a stream and is no longer
waited on. When a request held open for 8 s or more returns and the page sends
another to the same endpoint within a second, with no input in the second before
it, the endpoint is a long poll: from then on its requests are neither waited on
nor counted. A click that has changed nothing yet is watched for 1 s more, since
handlers can wait before sending a request; clicks into text fields and native
selects are not.
Each action in the result carries `requests`: how many data requests the page
sent after it. A click with an `unknown` effect and `requests: 0` did not reach
a handler that does anything visible or remote. Jev's next decision sees these
counts; the effect and constraint guards do not, so a form that checks a name
as it is typed does not make its Add button look like a save. Analytics,
advertising and error-monitoring beacons (Google Analytics and Ads, Amplitude,
Segment, Sentry, Datadog RUM and similar) are not counted, waited on or listed
as relevant evidence: a form interaction fires them whether or not anything is
saved. Their URLs are recorded without query strings, which carry visitor ids
and hashed emails. Link navigation, the submit button of an explicit GET search form
and search Enter wait for route progress within `JEVSTEER_NAVIGATION_SETTLE_MS`;
no browser input is replayed by this wait. Checkboxes, radios and fields inside
that form, and same-page `#` links, are judged in place without that wait.
A `wait` watches the page for up to `JEVSTEER_WAIT_MS` (default 5000, never more
than the action settle budget) and ends as soon as the page changes. ccMonet's
Profit and Loss report, for example, shows 6 to 10 s after Generate, after its
requests have returned and with no spinner; one or two waits see it. A wait after
which the page did not change, nothing on it is loading and the page sent no new
request is marked `page_changed: false` in history. `JEVSTEER_MAX_IDLE_WAITS`
(default 2) such waits in a row stop the milestone as `stuck`. A page that keeps
sending requests, such as one polling badge counters, stops after one more wait
than that with nothing visible changing. `JEVSTEER_MAX_WAITS` (default 12)
bounds all waits.

With `JEVSTEER_LOG=1`, stderr gets one row per round: Jev's scores, the chosen
action, `observe_ms` (watching the previous input or wait), `decide_ms` and
`requests`. A guarded input adds a `guards` row with the effect and constraint
verdicts and the target's scope and context. `explain: true` returns the round
rows, guard verdicts included, in the result.
Playwright observations read at most 2000 interactive elements
(`JEVSTEER_MAX_ELEMENTS`; Wikipedia's history at 100 revisions holds about
1100). The snapshot crosses from the page as one JSON string, which reads a page
of 1100 controls in about 0.2 s. A page over
that limit, as when a search swaps its old list for the new one, is read again
within the observation window. One still over it when the window ends stops the
milestone as `observation_limit`: no further input is sent, and the result keeps
the actions taken. Rerun once the page settles, start on a narrower page, or use
`browser_screenshot` (`browser_snapshot` stops at the same limit).
`browser_open` can return `navigation_unconfirmed` with a `tab_id` when its
acknowledgement is lost and fresh DOM metadata cannot confirm the exact requested
URL. Inspect that tab before another navigation. Redirects to a different URL
are not automatically treated as confirmation of the requested destination.
