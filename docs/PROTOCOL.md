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
A child frame is observed when its owner element is visible, also below the
fold, since a scroll reaches it. A frame fixed outside the window (it, or a box
it sits in, is `position: fixed` and drawn wholly outside the viewport) stays
out of view however the page scrolls, so it is left out with the frames inside
it: ccMonet parks a status page widget at left -9999px until an incident is
posted, and its text, which changed as it loaded, made a review ticket stale.
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
duplicate record exists) or change the constraint. The constraint request takes
`guidance` as such a fact, for example that an earlier attempt was rejected and
created nothing. A save or submit the site refused with a validation message
("Please fill in all required fields : Due Date") normally created nothing, so
making it again once the form is fixed is not a duplicate, unless the page or
the run history shows that a record was created. The effect request treats
`guidance` and `constraints` as host facts about what a control does, so a fact
such as "Generate only calculates the report" keeps a read-only button out of
the remote-write journal. Both requests are told that `proposed_action.element`
is the one control the action uses, and that its `context`, the text of the
row or box around it, can name controls beside it that the action does not
use: ccMonet's Save as Draft sits next to Approve ("Save as Draft Approve").
The effect request is also told that, when `guidance` says a form, panel or
dialog applies a choice only with its own Save, Confirm or Submit control
("Ticking a candidate only selects it; Confirm match applies the match"), a
checkbox ticked, an option chosen or a value entered there stays local until
that control is used. On ccMonet's Manual Match, the tick of the invoice to
match was judged a write, and the run stopped for a host review before Confirm
match. Without such a fact, a control there may save on its own and is judged
as any other, so an autosaving toggle keeps its replay barrier.
With more than one constraint rule, the constraint request also says which one
the action would most likely break. A rule is a sentence of a constraint: an
item that holds several sentences ("Demo company only. Do not send emails.")
is offered sentence by sentence, while the guard still judges the constraints
as written. A `constraint_blocked` stop names that rule in `info` and as
`pending.constraint` (with one rule, it is that one), so the host knows which
fact settles the doubt.

A TYPE or SELECT (also an option chosen from an open list, or clicked there)
gets one more question with the effect questions: does it set a field the task
does not call for, or put a task value into a field it does not belong in? A
field that `goal`, `success_criteria`, `values` or `guidance` never mention,
and that the page does not mark required or invalid (a tracking category, a
tag, a reference), keeps what it holds. A TYPE shows the guards the value's
name (`value_key`) and the text it enters (`value`), unless the field or the
value's name is secret. Where `guidance` says which field a value or a kind of
text goes into ("Line item text goes into Description"), any other field is
one that value does not belong in: ccMonet's invoice line got its item text
in the product picker, "Preferred Name". Jev's TYPE target head and the value
chooser are told the same. A click on a field's clear button is asked whether
the task calls for emptying that field: a value the task asks for there stays,
even one this run entered, and so does a value the task never mentions, that
this run did not enter and that fits the field (a default, a saved setting).
One this run entered that the task does not ask for there, one that
contradicts the task or belongs in another field, or one in a field the page
marks invalid, may be emptied. A click on an option its open list shows chosen
takes that option out of the field (a multi-select's list stays open after a
choice), and is asked the same way: an option the task asks for there stays,
even one this run chose, and so does one the task never mentions that this run
did not choose. Its refusal reads `combobox "Tracking Category" without HQ`.
At `JEVSTEER_UNREQUESTED_AT`
(default 0.7) or above no input is sent: Jev looks again with the refusal in
its history (`recovery: "reobserve"`, `reason: "not_requested"`, and a detail
such as `combobox "Preferred Name" -> item_a`), and the
third such choice stops the milestone as `needs_guidance`, naming the field.
Name a field the task needs, and its value, in `guidance` or `values`. Jev's
own operation question says the same: set only what the task asks for or the
page marks required or invalid, and never pick a value of its own for any
other field.

The page marks a field required by its `required` attribute or
`aria-required`, or (Playwright driver) by a mark on its label or its column's
header: a "*" before or after the words, or a class saying so (antd's
`ant-form-item-required`, a `th.required` header). It marks one invalid by
`aria-invalid` or the browser's own check, or (Playwright driver) by an error
class on the field or a box it is drawn in, up to its table cell, while the
box holds no other field (antd's `ant-select-status-error` and
`ant-form-item-has-error`, Bootstrap's `is-invalid`, a cell's `error` class;
`no-error` and the like do not count). On ccMonet's invoice nothing else said
Tracking Category was required: its header is marked so, and its cell took an
error class when Save as Draft was refused. Jev's page, its target heads, the
guards and `browser_snapshot` show these as `required` and `invalid`. A class
mark is the page's (`error_mark` in the observation): the effect check of a
TYPE reads only the browser's own check, so a field typed while its cell still
shows the error of a refused save is confirmed by its value.

A profile/endpoint has a stable logical session namespace. An unresolved action
judged likely to change remote data (recorded risk at or above
`JEVSTEER_SESSION_LOCK_RISK_AT`, 0.5 by default; a record without a risk counts)
blocks new input on other Pages in that session, even once its own Page is
closed or replaced. An unresolved action judged possible but unlikely to write
(risk 0.25 to 0.5: a menu, a tab, a filter) blocks only its own repeat on its
own page; once the next observation shows its local effect with nothing in
flight and no write request (a method other than GET, HEAD or OPTIONS) after
it, its record closes as `applied` with no replay barrier. Low-risk input whose
acknowledgement was lost closes as `not_applied` when the page shows no effect
of it, has no request open and sent no write request, so the milestone can be
rerun without a hand resolution.
`browser_snapshot` and `browser_inspect` still read any page. Opening a page
sends it no input, but its address is a request to the site, which can change
something (a GET that saves, a logout) or wipe what the action left. That
holds for the address the action was chosen on too, since a page can be the
answer to such a GET. So while the action is unresolved, `browser_open` opens
only `about:blank` in a new tab. Any other address, and any navigation of a
page whose own input is unresolved, is refused with
`UNCONFIRMED_SESSION_ACTION` before a request is made. The host reads what
the action did from the open pages and the run's request evidence, and can
resolve the original `tab_id` and action ID after that independent readback,
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

A control is secret by its type (password), or by what names it: its label,
name or placeholder, the text drawn over it when it has no name of its own
(`hint`, such as "API token"), or its table column. That text goes once the
field holds a value, so a snapshot marks a field it saw as secret (`secret:
true`) and keeps that mark on the same node for as long as its document lives:
its value stays "[REDACTED]" to Jev, the guards, the host's review and
`browser_inspect`. The digest of its live value (`value_hash`) stands for it:
a typed secret field is confirmed, and not offered for TYPE again, by it, and
a review ticket binds it, so a ticket goes stale when the field's value
changes.
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
below a list) load the same page, so Jev choosing either is one choice. The
click still goes to the node Jev saw, wherever the page has moved it
(Playwright driver), because equal links can differ in what a script does on a
click; links the page has rebuilt since are refused like other identical
controls. Any other target that matches two identical controls is told apart from them only
by what it shows or holds and what is next to it: its hint, the value it shows,
its value, options and state, and the text and table column beside it (two
unnamed selects in one filter row, "Status" and "Vendor"). The control that
still shows what the chosen one showed is the one used, wherever the page has
moved it, also when only one of them is left: it may be the other. Order never
decides: a page can swap equal nodes without anything observed changing.
Fields alike in all of that on different lines of a table, such as the blank
"Unit Price" fields of two new invoice lines, are told apart by the line Jev saw
each on (`row`). A line number is an order, so the field used is the node Jev
saw on that line (Playwright driver), while it is still there and still on that
line; after the page rebuilds the line or moves it, the choice is refused
(`STALE_TARGET: the control chosen on line N of its table is gone or on another
line now`) and Jev looks again. Controls that nothing observed tells apart are refused
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
chooser is told so. It also reports which row of its table it is in as `row`,
counted as a person counts the rows they see: header rows and rows drawn with
no height (antd's measure row) do not count, and a grid that draws only the
rows in view numbers them by `aria-rowindex`. Jev's target heads, the guards
and the run history give it as `table_row`/`row`, and the value chooser hears
where this run already entered each value ("100 (this run already entered it
in textbox "Unit Price" in table row 1)"), so line 2 of ccMonet's invoice,
whose lines have no key of their own, takes its own item's price. The row is
not part of a control's identity: rows can be reordered. A select-like combobox whose input holds only search text
(antd, react-select) reports the value it shows as `display`, and Jev's target
heads give it as `shows`: unnamed selects, such as ccMonet's filter row
("Status", "Is", "Draft"), are told apart by it. An unnamed one that takes
typing (the field select of that row) is offered for TYPE by it, and the
value chooser and the guards hear it as `shows` too. A secret field's is never
given. A multi-select's chosen options are also read apart, as the page parts
them (`display_items`, with two or more): an option's own text can hold a
comma ("Doe, John"). A select that already shows the value Jev would type, as
one of a multi-select's options or as all it shows (ccMonet's Tracking
Category showing "Changi"), gets nothing typed: typing it there again would
only put it into the select's search box. The value must be a whole option: a
single option "Changi, Singapore" does not hold back "Changi". Jev looks again with that in its history
(`recovery: "reobserve"`, `reason: "already_shown"`), and the third such choice
stops the milestone as `needs_guidance`. A value that a shown option holds
only as part of its text ("Changi" in "Changi Airport") is still typed. A field this run
typed that now shows an option holding the typed text as whole words ("Acme" in
"Acme Ltd") is not offered for TYPE again. An option that holds it only inside
a word ("US" in "Australia", "1" in "10") is another option, so the field can
be typed in again. In scripts written without spaces between words (Chinese,
Japanese, Thai) each character stands alone.

A list that draws only the options in view (antd's virtual list, as on
ccMonet's bill filter, whose field list held "Vendor" below them) leaves room
for the others in the box it scrolls in. Its open combobox then reports
`more_options` (`below`, `above`, or `above and below`); a list that draws all
its options reports none, though it may scroll. When exactly one open
combobox has options below, Jev is told so with the operation choice, and
SCROLL turns that list instead of the page: the pointer goes over the middle
of the box the list scrolls in (so no option is first scrolled into view) and
the wheel turns by 80% of what the box shows, so the options shown next
overlap these. The run log names the combobox, with `scrolled: "its open
list"`. A `browser_act` SCROLL with an element turns the box around that
element that scrolls the same way, or the page under it. An open combobox that
takes typing (a select with search, whose input is not read-only) lists only
the options that match what is typed there: Jev is told to TYPE the option's
text into it, as `values` or `guidance` give it, rather than scroll its list
(on ccMonet's invoice Jev scrolled the Customer list instead), and to SCROLL
only to look through options whose text they do not give. The question whether
the next step is clear, asked apart, is told that typing such an option's text
into it is a clear next step: on ccMonet's invoice, Jev chose to type the
Category the guidance gave into its open list but did not find that clear, and
the run stopped for guidance three times. An open combobox that already shows a
value, and that the run has not used (a multi-select keeps its list open once
an option is chosen, and an earlier milestone left it so), is named to Jev with
the operation choice and the next-step question: when the goal needs
nothing more there, its open list is no step of its own, and Jev is told to
CLICK the next control the goal needs, as a person would, since that click also
closes the list. On ccMonet's invoice, Tracking Category kept its list open
after the fill; on the Approve milestone, Jev chose to close it with Escape
first, did not find that clear (0.29 to 0.44), and the run stopped for guidance
ten times.

antd draws a select's options in a portal at the end of `<body>`, as divs with
`aria-selected` and no role, and keeps `role=option` copies in a 0×0 listbox
for screen readers. The visible divs are observed as options, also while a
drawer or modal is open; the hidden copies are not (a click on them only waits
until it times out). An open combobox is not offered for SELECT itself, which
would only close its list again. SELECT offers the options its list shows
instead: those in the list its `aria-controls` or `aria-owns` names, or in the
floating box that holds that list (antd's visible copy), or, with no such link,
options floating on their own while it is the one open combobox, in a box
drawn for it: across from the box the combobox is drawn in and at most 64px
under or over it. A menu or another widget floating elsewhere on the page is
not its list. An open combobox hidden from view (hidden, inert, aria-hidden
like a dialog's background, or clipped away) does not count as open, neither
here nor in the check before the click. Each such
option carries `popup_of`, the `[i]` of its combobox, and choosing one is a
click on that option (the run log shows `tool: "click"`, `chosen_as: "select"`).
The effect and constraint guards see that click as what it does: a SELECT of
that option (`selected_option`) on its combobox, with the combobox's section,
context, field name and record, because the same option ("Closed", "Delete")
can sit under different fields. A CLICK Jev chooses on such an option shows
them its combobox as `option_of`, and whether the option is chosen now.
An option already chosen is not offered, because a click on a chosen option of
a multi-select takes it out again. Nor is one this run chose offered for CLICK
while its list still shows it chosen: a multi-select's list stays open after a
choice, and ccMonet's Tracking Category lost "HQ" to a second click. One chosen
before the run still is, so a task can take it out, and the same option in
another table line's list is offered as usual. The run history names the
combobox of a clicked option as `option_of`. Before the journal write, the option must
still be unchosen and still listed under the same combobox, which is still
open. That combobox is found as any target is: of identical comboboxes, the one
that still shows what it showed, leaving out which one is open, because a page
can move its open list to a twin. When only which one is open tells them
apart, the option is refused as ambiguous (`STALE_TARGET: ambiguous: the
option's combobox has identical twins`). The option and its combobox are then
pinned; after the write, just before the click, the option must still be
unchosen, and the combobox still open with its list holding the option (an
unlinked list still drawn for it).
Otherwise the click is refused before any input as a stale target
(`STALE_TARGET: the option is already chosen`, or `... no longer listed under
the combobox it was chosen from`), and Jev looks again.
A CLICK Jev chooses on an option an open combobox lists, chosen or not, goes
through the same checks, except that the option must still be chosen or
unchosen as Jev saw it: a chosen one the page took out on its own after Jev
looked is not clicked (`STALE_TARGET: the option is no longer chosen`), since
the click would put it back. So does a click `browser_act` sends to such an
option: from the `browser_snapshot` to the click, the option must stay listed
under the open combobox the snapshot showed it under, that combobox found as
the snapshot told it from identical ones, and stay chosen or unchosen as
shown; otherwise it fails with `STALE_ELEMENT` and nothing is sent. When only
which one is open told the comboboxes apart in the snapshot, it fails with the
ambiguity error above.
SELECT on a closed custom combobox opens it with a click. When another
combobox's open list covers it, that click is refused before the journal
(`predispatch_rejected`, nothing pending), and the error names the cover:
`the target is covered by another element (<div class="ant-select-dropdown">); no input was sent`.
Any covered target is refused this way, and Jev looks again with the refusal
in its history (`recovery: "reobserve"`, `reason: "target_covered"`), as after
a stale target; the same choice a third time on the same page stops the run as
`stuck`. The error names the cover by its tag and class whatever it holds:
text (`<span title="Is" class="ant-select-selection-item">Is</span>` in the
browser's log reads `(<span class="ant-select-selection-item">)`), other
elements, or nothing.
A field can be covered by a part of its own box: antd draws a select's shown
value as a positioned span over its input (ccMonet's filter popup, "Is"), and
a person opens the select by clicking that value. A click on a field (CLICK,
HOVER, SELECT that opens a custom combobox, and a realistic TYPE's first
click) lands on such a part instead, with the browser's checks on that part:
the part is what is on top at the middle of the field, inside the field's own
box (up to four levels around the field that hold no other field), and
neither it nor anything between it and that box is a control (a button, a
link, a clear button, an option). A control drawn over the field is never
clicked in its place, and anything outside the box still refuses the click as
above. After the journal is written, the click must still land on the same
part, or on the field itself if it did before; otherwise nothing is sent
(`STALE_TARGET`). A radio or checkbox drawn at no size takes no click (the
browser counts it as not visible), and what lies at its point need not be its
own: antd's Segmented draws each option's radio at 0×0 under the label a
person clicks (ccMonet's reconciliation view). Such a click lands on one of its
own labels instead, drawn, whose middle is no other control (a link, a
button, another field), so the click is a click on the radio. With no such
label the click is refused as above (`it is not visible`).
A target that never becomes ready for another reason stops the run as
`action_failed`, with nothing pending, and the error says what the browser
waited for: `the target never became ready for input (it kept moving); no
input was sent`, or it is not visible, the browser counts it as disabled, it
is not editable, it stays outside the viewport, or it left the page.

A field's clear button is a `button` named by its icon ("close-circle",
"close"), with `clears`, the `[i]` of the field it empties, and that field's
table `column`. antd draws a select's clear button, and the remove button of
each value a multi-select shows, as an aria-hidden span with no role, at
opacity 0 until the pointer is over the select; they are observed all the
same, as are antd's date picker and input clear buttons. Any class prefix
counts (`ant-select-clear`, `xyz-select-clear`). Jev's target heads show the
field as `clears: "[12] combobox \"Tracking Category\" showing \"Woodlands\""`,
with a note that a click empties it and is for a field the task wants empty;
the guards and the run history name it the same way. Two clear buttons on one
invoice line read alike and are told apart by their column.

A focused text field that holds text can draw results or suggestions under or
over itself with no ARIA link, such as ccMonet's global search ("Vendor 1
CP-MEIJI CO.,LTD."). A floating box in a wrapper up to four levels out from the
field, later in the page, across from it and at most 64 px under or over it,
that holds a control other than a text field, is the field's popup. Its
controls carry `popup_of`, and Jev's page gets
`popup: { field, field_value, shows }`, also in the first call of a two-stage
decision on a large page. In a target head such a control is marked
`in_popup_of` its field, with a note that a click anywhere else closes the
popup; the group summaries of a two-stage decision mark it too, and the popup's
controls and their field are offered in its second call whichever groups were
picked, because the popup is on top of the page (ccMonet's global search
results lost to the bill rows behind them). A secret field's popup is left out, because it can
echo what was typed there. The floating parts of the next line item (an antd
select's search box, a remove button at the row's end), a fixed bar above the
field and a footer far below it are not popups. A field this run typed keeps
the `hint` it showed then, also in the group summaries of a two-stage decision,
so the search box still reads as "Search contacts, ..." after its hint layer
goes, and an Enter Jev chooses for it goes to it.
When the contract has success criteria, Jev's
done question tells it to check each of them against the page as it is now,
`page.popup` included.

A click that did nothing but close what was open (a popup, a menu, a list) is
marked `closed_only` in Jev's history: the address stayed, the page sent no
request, controls went and none came, at most a few new words showed, and its
target is still there as it was. Each control that went was in an open popup,
and none is left in it (Playwright driver): a field's popup (`popup_of`), or a
box with a popup's role (tooltip, menu, listbox, dialog), as antd draws its
popover. A button that collapses a section of the page, showing no state of
its own, is not marked: a second click would open the section again. A toggle that showed its own popup open, or
whose expanded, checked or selected state changed, took the click itself and
is not marked. Otherwise the page did not pass the click on to its target, so
Jev's operation question tells it to click again if that target is still the
next step: a wait does not bring its result. A bill row clicked while
ccMonet's filter popup or search results were open opened nothing.

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
That state includes what a focused field's popup says (search results under a
search box, see above), which is read apart from the page text and also past
its cutoff, so results that change before acceptance make the ticket stale. A
secret field's popup is left out. It also includes each field's `hint` and
`column`, which tell the host which field an unnamed one is, and its table
`row`, which tells which line it is on, also where the text that shows them is
past the page text's cutoff. So it includes whether the page marks a field
`required` or `readonly`, which a page can change with no text around the field
changing, and a multi-select's options one by one (`display_items`).
A toast, such as antd's "Update successfully" message (under any class prefix),
a toast or snackbar, or another fixed-position alert or status region, goes away
on its own, so the state a ticket binds leaves its text out; the host still sees
it in the ticket's observation. The ticket keeps a digest of each toast it
showed, and any other toast at acceptance, such as a late error, makes the
ticket stale. A count in a badge (a sidebar "Todo 41" that becomes 42 when the
saved record adds a to-do) is left out of the bound state too: a badge has a
class hook (badge, unread, antd's scroll-number) or is a small filled pill.
antd draws each digit of a count apart, so the page text reads 41 as "4 1";
that is still one count.
When the milestone's contract speaks of a badge (it names the badge, such as
"Cart" or "Todo", states its number, or asks about counts, unread items or
notifications), its counts stay in the bound state, so "Cart 2" turning into
"Cart 3" makes the ticket stale. So do they when a text assertion rests on a
count in the page text: a `text_contains` the page meets only inside a count
("2" in "Todo 12"), or a `text_not_contains` a count could turn into, one with
a word a count could be ("3", "3 items" or "99+" while "Cart 2" shows; a
count never shares a word with letters, so never "INV-0003"). A toast over an open drawer or modal is part of
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
input is sent for this check. The same check runs when Jev chooses another
guarded input while that write is still unconfirmed (ccMonet's Approve, chosen
again after it had gone through): that input is not sent, and when the result
goes to the host, `info` says which input Jev chose and that it was not sent.
When the check fails, the milestone stops as `action_failed`, as before.

When Jev believes the goal reached, or half believes it (done 0.6 or more, not
from the host's assertions), and its next step is a click, or Enter, on a
target it is sure of, right after an input that changed nothing remote (a
ticked checkbox, a chosen option, a typed value), Jev is asked about that exact
click (`applies_choice`): is it the control that applies that choice, such as
the Save, Confirm, Submit or Match of the form, panel or dialog the choice was
made in, and does the goal need the choice applied, not only made? At
`JEVSTEER_APPLIES_CHOICE_AT` (0.5) or above, the goal waits for that click,
which goes through every guard like any input; the round shows
`applies_choice`. A missing answer holds nothing back. This holds however sure
Jev is: a goal checked before that click fails, or passes on a choice not yet
applied. On ccMonet's Manual Match, Jev ticked the invoice, half believed the
deposit matched (0.61) and chose Confirm match (0.97), and the run stopped for
a host review before that click. Told in the done questions that such a choice waits for its control,
Jev still found the deposit matched, and judged a filled invoice not done
(0.26) for its unused Save; the done questions ask only whether the page shows
the goal reached.

Multiple remote writes need separately reviewable outcomes. If an earlier write is
unconfirmed, independently inspect and resolve it before the next mutation; do not
treat any generic page change as proof that a transaction persisted.

`strict`: return `milestone_ready_for_review` after each verified milestone. Host acceptance is expressed by starting `next_milestone_index`; rejection reruns the same milestone with corrected guidance/criteria.

`fast`: continue automatically across internally verified milestones. Neither setting bypasses a `host_review_required` ticket; the explicit `browser_review` receipt is required first.

## Evidence

Each milestone returns a compact Evidence Packet: actions/effects, verification, final page, filtered network evidence. Relevant request/response bodies are sanitized and referenced; expand only when needed via `browser_evidence`.

## Unconfirmed actions

`pending_actions` contains opaque action IDs and the originating run/milestone.
Each dispatched action in `actions` carries `pointer` (viewport pixels of where
the input landed, the time it was sent and the viewport size), so a host that
records a run can draw the pointer; a Playwright observation reports
`writes_since_input` next to `requests_since_input`.
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
a new `run_id` cannot bypass the same operation. A `browser_act` input may
carry `goal`, the business operation it belongs to, naming its record as a
milestone goal does; its marker then holds that goal only, as a run's does,
and a run under the same goal is refused by it. A manual input given no goal
has no semantic goal hash and keeps the broader guard: once applied, the same
input on that page is refused under any goal, by hand or in a run.

A page that shows one record after another on the same address (an invoice
drawer over a list) gives each record's controls the same identity. A goal
that names no record ("Approve the invoice") then refuses Approve on the next
invoice; name the record in each write's goal ("Approve the sales invoice for
JevSteer QA CHAIN1020A, 50.00"), and keep the same goal for the same record.
The refusal says so, and says when a manual input with no goal holds it.
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
`applied` says the site itself changed (a save, a submission, an autosave);
an input that only changed the page (a field set before saving, a list
opened) is `not_applied`, so the same input stays possible on the next record.
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
than guessing. Without one, a value whose name is the field's label or name in
other words (`due_date` for "Due Date", `unitPrice` for "Unit Price") goes into
a field off any table line without a question; the lines of a table hold
different items, each with values of its own. The model is asked instead when
this run already entered that value somewhere, or when a field on a table line
has that name as its label, name or column: on ccMonet's invoice the line's
`description` also went into the header's Description. Otherwise the model chooses:
where `guidance` says which field a value or a kind of text goes into, that
comes first, then the selected field's explicit label/name. When no value
belongs in the field Jev chose (ccMonet's Due Date, which a milestone did not
name), nothing is typed: Jev looks again with that in its history
(`recovery: "reobserve"`, `reason: "no_value"`), and the third such choice
stops the milestone as `needs_guidance`, naming the field. Range pickers can still reorder coupled date endpoints;
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

A number field that groups the digits it takes (ccMonet's Unit Price shows a
typed 5000 as `5,000`) is confirmed when it shows the number typed with
grouping marks added between groups of three, or zeros added after the
decimal point (`5,000.00`; `1.50` for `1.5`) (`field_value_number`), and is
not offered for TYPE again. A text field may only add these: it never takes
away what was typed, so `123` for a typed `00123` (a reference cut short), `1`
for `1.0` (a version cut short) or `10%` for `10` (another value) fails the
TYPE. Only a field the page says holds a number (`type=number`, role
`spinbutton`) compares the numbers both read as, dropping leading zeros, a
plus sign, zeros after the point or a trailing percent sign. A currency sign,
a unit, another number, or a mark that does not part groups of three (`5.000`
for 5000) is no match. The digits are compared as text, not as a JavaScript
number, which keeps about 16 of them: a long account or reference number one
digit off is no match either.

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
verdicts (`unrequested_guard` too for an input that sets or empties a field;
`constraint_guard`, with the `constraint` it named), and the action as the
guards judged it: `judged_as`, the element (for
an option chosen from an open list, its combobox), its table `row` (or its
combobox's), the chosen `option`,
`option_of` for a click on an open combobox's option, `clears` for a click on
a field's clear button, and the element's scope and context. `explain: true` returns the round
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
