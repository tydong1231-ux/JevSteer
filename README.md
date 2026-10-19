# JevSteer

**Low-cost browser execution for Claude Code, Codex and other MCP hosts.**

```text
Host agent: plan + milestones + review
                ↓ MCP
             JevSteer
      Jev: decide inside a milestone
      Runtime: act + verify + evidence
                ↓
           BrowserDriver
                ↓
     Playwright / legacy Kapture
```

JevSteer keeps expensive agents out of repetitive browser loops without asking Jev to understand an entire product.

[Agent protocol](docs/PROTOCOL.md) · [Claude Code example](examples/claude-code.md)

## What problem does it solve?

A powerful host agent is good at planning a multi-step business task, but spending that agent's time on every browser click is expensive. A smaller executor can be cheaper, but should not be entrusted with the entire business workflow.

**JevSteer separates those responsibilities:** the host owns the plan and business judgment; the executor handles **one bounded milestone** at a time, checks the visible effect of its actions, and returns evidence or asks for guidance.

**Design considerations:** bounded tool execution, cost-aware orchestration, evidence-based verification, and human handoffs when a milestone needs additional judgment.

## Best use cases

- Multi-step SaaS, ERP, CRM, accounting and admin workflows.
- Repetitive 10–50 step tasks in authenticated web apps.
- Search, filter, inspect, configure, enter data and validate results.
- Workflows where the host knows the system/business logic better than the browser executor.

Not ideal for 1–4 step tasks, canvas/image-heavy UI, desktop cross-app automation, CAPTCHA, or fully autonomous irreversible actions.

## Long-task model

**The host defines the workflow. Jev executes only the current milestone.**

For each milestone the host should provide:

- `goal` — one observable stage outcome;
- `success_criteria` — what must be true before advancing;
- `constraints` — what must not happen;
- `guidance` — only workflow facts Jev cannot infer from the current DOM.

Do **not** give click-by-click instructions.

Inside a milestone JevSteer loops:

```text
observe → Jev decides → act → verify effect → observe → ...
```

If the next business transition is unclear, JevSteer returns `needs_guidance` instead of guessing. The host patches the current milestone guidance and resumes the same milestone.

### Review modes

- `fast` — verified milestones continue automatically; escalate only uncertainty/high-risk/unsupported steps.
- `strict` — after every verified milestone, return `milestone_ready_for_review` with an **Evidence Packet**. The host accepts by moving to `next_milestone_index`, or rejects by rerunning the same milestone with corrected guidance/criteria.

Evidence Packets contain action-effect checks, final verification and filtered network evidence. Full sanitized request/response evidence is expanded only on demand with `browser_evidence`.

## Example milestone (illustrative)

Imagine an agent needs to inspect an invoice in an authenticated business app before suggesting a next step. The host passes a milestone like this:

```text
Goal: Locate invoice INV-0142 and inspect its status.
Success criteria: Return the matching invoice's ID and visible status,
                  supported by browser evidence.
Constraints: Do not edit, approve, post, or delete any records.
Guidance: Use the accounting app's Invoices area.
```

JevSteer can search, inspect, and verify the observed result. **If it cannot confirm the invoice or the requested business transition, it returns for guidance instead of inventing a result.** This is a usage illustration, not a report of a live customer run.

## Product design trade-offs

| Design choice | Why it matters | Trade-off |
| --- | --- | --- |
| Host plans; executor handles one milestone | Prevents a low-cost agent from making unsupported cross-workflow decisions | Requires a clear milestone contract |
| Verify action effects, not only tool return values | Reduces silent browser failures and false success reports | Extra observations and evidence collection |
| Reuse a logged-in Chrome session | Supports real authenticated workflows | More variability than isolated browser tests |
| Fast and strict review modes | Adapts human oversight to consequence and uncertainty | Strict review costs more time |
| Fail closed for risky actions | Protects users when intent or authorization is unclear | Some operations require escalation |

**Try it:** follow [Quick start](#quick-start), run `npm test`, connect the MCP server to Claude Code or Codex, and begin with a read-only browser task in a test application. A hosted public demo is not provided here; the repository documents a local setup.

## Ultrafast-inspired execution policy

- **Speculative action-specific heads:** one Jev call decides the operation and
  independently ranks compatible targets for click, type, select, enter and hover.
  Only the chosen operation's target can execute.
- **Native dropdown shortcuts:** small menus choose a specific option in one
  call; large menus retain a follow-up option choice.
- **Separate text generation:** the host can pass named `values`, or optionally
  supply `TEXT_MODEL_API_KEY` / `TEXT_MODEL_BASE_URL` / `TEXT_MODEL` for a
  low-cost OpenAI-compatible model to fill ordinary fields from the goal. Missing
  values and secret-like fields always return for guidance.
- **Stale-target guard:** check visibility, element type and URL immediately
  before acting. Uncertain mutations stop rather than retry blindly.
- **Kapture snapshot optimization:** reuse DOM-response tab metadata on newer
  Kapture, dropping a normal snapshot from 3 requests to 2. Unlike Jev Ultrafast,
  Kapture does not supply a single atomic CDP node snapshot without enabling
  JavaScript execution. JevSteer keeps the default JS-execution gate disabled.
  Pages with native checkboxes/radios add one CSS `:checked` query to observe
  their actual property state; it does not enable arbitrary JavaScript.

Inspired by [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast),
while retaining host-defined milestones, Evidence Packets and Kapture.

**Privacy:** When the optional text helper is configured, the selected field
context, task goal and up to 2,800 characters of page text are sent to the
configured external model provider. Leave it unset to use host values only.

## Browser driver migration

The [Playwright-first refactor](https://github.com/tydong1231-ux/JevSteer/issues/3)
now has an opt-in native Playwright driver. Host milestones, verification modes,
MCP tools, the durable action journal and host receipts remain the orchestrator's
responsibility. The driver never runs a second autonomous agent.

Install Chromium with `npm run browser:install`, then set
`JEVSTEER_BROWSER_DRIVER=playwright`. The default mode launches a headed browser
with a dedicated persistent test profile; use `JEVSTEER_BROWSER_PROFILE` for a
short absolute profile path (for example `C:/jevsteer-profiles/demo` on Windows).
Sign into the dedicated test profile once. Set `JEVSTEER_BROWSER_CHANNEL=chrome`
to use installed Chrome, or `JEVSTEER_HEADLESS=1` for isolated CI fixtures.

`JEVSTEER_INPUT_MODE=realistic` uses focus, select-all, Backspace and browser
keyboard typing. `fast` (default) uses Playwright fill. Native selects use
`selectOption`; custom ARIA pickers use pointer/keyboard actions. Action evidence
records the input mode and dispatch state. Observation uses read-only DOM access;
no injected DOM click, direct value assignment or application write API executes
a target operation.

Optional `JEVSTEER_CDP_ENDPOINT` attaches to an already debug-enabled Chromium
with exactly one browser context. It never falls back to launching an unsigned-in
browser. Multiple pages require an explicit `tab_id`, or a page already selected
in this runtime. Ordinary Chrome without remote debugging is not attachable.

For Chrome 144+ and this pinned Playwright version, `JEVSTEER_CDP_ENDPOINT=chrome`
can attach to the existing default Chrome session without restarting it with a
port. The user must personally enable the switch at
`chrome://inspect/#remote-debugging` and approve Chrome's connection prompt.
This was exercised on Windows/Chrome 155. Do not automate security permission
prompts, copy a live profile or attempt a CAPTCHA/security bypass. An attachment
failure stops the task; it does not silently launch another browser. Tab listing
does not start network/console capture on unrelated pages. See the official
[existing-browser connection guide](https://playwright.dev/mcp/configuration/browser-extension).

`JEVSTEER_BROWSER_DRIVER=kapture` remains the compatibility default until real
Jev/ccMonet comparison gates pass. Kapture continues to control the existing
extension-connected Chrome session. Resolve old pending actions/reviews in that
driver before migrating a workflow; journals are not silently re-keyed to guessed
Playwright pages. See [driver ADR and acceptance gaps](docs/ADR-001-browser-driver.md).

`npm run test:e2e` runs real Chromium conformance and MCP fixture tests with
independent DOM/HTTP readback. Fixture decisions are deterministic test doubles;
the separately named live Jev test is skipped without a provider key. This suite
does not establish ccMonet C1–C3 success or a performance improvement. Run
`npm run test:e2e -- --repeat-each=3` for repeatability, or set
`JEVSTEER_E2E_HEADED=1` for visible browser coverage. Runner retries are disabled.

Failure screenshots/traces, test profiles and journals remain local in ignored
directories. Screenshots and traces may contain private data: inspect/redact
before sharing, and remove obsolete local artifacts according to your retention
policy. Network bodies are off by default in the Playwright driver.

`browser_inspect` is a fixed read-only Host oracle for visible main-frame table
cells, control values and disabled ancestry. It makes no Jev call and accepts no
executable JavaScript. Virtualized/truncated tables are not proof of all rows.
Its output is private evidence, not a public report. The local
`scripts/live-host.mjs` bridge drives the real stdio MCP server and archives each
request/result in ignored files with a fresh session prefix. It requires the
Playwright driver and process-local provider credentials. See
[ccMonet live evidence and open gates](docs/CCMONET-PLAYWRIGHT.md).

Before a live account test, obtain explicit consent for the necessary current
page content to be sent to the configured model provider. Keep unrelated tabs,
credentials and cookies out of model input. Read-only also excludes remote
preference writes such as favorites. The native snapshot gives visible card
text precedence over nested icon names; otherwise unnamed static image controls
may expose an explicit `icon:` filename hint. Duplicate hints remain ambiguous.

For independent test invocations set distinct `JEVSTEER_E2E_OUTPUT` directories
below `.test-artifacts` (for example `.test-artifacts/check-a`). Playwright clears
each run's `results` subdirectory; do not overlap runners on one output path.

For an independent unsaved form, set `execution_mode=form` and
`verification_mode=host`. Jev binds up to twelve supplied current-stage values
in one request; the existing guarded loop fills controls sequentially, reads
them back, and stops on collisions, changed ownership or field dependencies.
The form path never saves/submits. Use a separate `explore` stage for commit.
The [six-field live comparison](docs/BATCH-FORM.md) records scope, measurements
and limits; it is not a ccMonet or Kapture-to-Playwright performance claim.

## Safety and tradeoffs

- DOM-first execution cannot fully understand canvas/image-only interfaces; those are returned to host vision.
- A real user browser is less deterministic than an isolated test browser.
- Network evidence is filtered/redacted and unavailable on older Kapture extensions.
- CAPTCHA, native file pickers, drag-and-drop and unsupported native dialogs are not automated yet.
- Destructive or externally visible actions fail closed unless explicitly allowed.

## Quick start

Requirements: Node.js 20+, TypeSafe Jev API access, and either Playwright's
Chromium/installed Chrome or Chrome with the legacy Kapture extension.

```bash
git clone https://github.com/tydong1231-ux/JevSteer.git
cd JevSteer
npm install
export TYPESAFE_API_KEY="ts_..."
npm test
```

### Claude Code

```bash
claude mcp add jevsteer \
  -e TYPESAFE_API_KEY="$TYPESAFE_API_KEY" \
  -- node /absolute/path/to/JevSteer/bin/jevsteer.mjs
```

### Codex

```toml
[mcp_servers.jevsteer]
command = "node"
args = ["/absolute/path/to/JevSteer/bin/jevsteer.mjs"]
env_vars = ["TYPESAFE_API_KEY"]
```

## MCP tools

### OpenRouter and scenario testing

To call the real Jev model through OpenRouter, set `JEV_PROVIDER=openrouter`
and `OPENROUTER_API_KEY`. Jev uses OpenRouter's
[System One API](https://openrouter.ai/docs/guides/community/typesafe-sdk),
with `JEV_MODEL=jev-latest`; a chat model is not substituted. The default
TypeSafe configuration continues to work.

The ordinary `npm test` suite is offline. Real-browser scenarios are separate
and opt in to paid API calls:

```bash
node --env-file=.env scripts/smoke.mjs
node --env-file=.env scripts/live-scenarios.mjs
node --env-file=.env scripts/run-contract.mjs examples/ccmonet-readonly.json
```

`live-scenarios.mjs` creates its own Kapture tab and a local synthetic app.
It independently checks hotel filters, article search, invoice identity,
strict draft review, login/CAPTCHA handoffs, and rejection of false completion.
It also exercises delayed saves, duplicate field names, native dates, asynchronous
ARIA switches, duplicate labels in large selects, and modal combobox portals.
Its fixtures adapt the search/filter and guard-testing ideas from
[Jev Ultrafast](https://github.com/browser-use/jev-ultrafast).

`run-contract.mjs` calls this project's actual `browser_run` MCP tool with
host-defined semantic milestones. Use `browser_tabs` to select the intended
demo tab and add its `tab_id` to the JSON contract when multiple tabs are
connected. A contract without `tab_id` may name a `start_url` instead: the
script opens it in a new tab with `browser_open` and runs there. `start_url`
belongs to the scripts; `browser_run` ignores it. Review each returned Evidence
Packet before resuming at `next_milestone_index` with the same `run_id`. A
result that requires guidance or is uncertain is not an automatic pass. The
examples are workflow contracts, not selector scripts. Use a unique customer
name for creation runs and inspect existing records before creating another one.

Complex public-site contracts are in `examples/arxiv-advanced-readonly.json`
and `examples/selenium-public-form.json`. Each names its `start_url` (the arXiv
advanced search or the Selenium web form). Through `scripts/live-host.mjs`, call
`browser_open` with that URL and pass the returned `tab_id` to `browser_run`.
Review each ticket independently. Never auto-accept a ticket in a test runner.
The ccMonet read-only/report examples also use explicit host verification; reuse
the user's intended authenticated tab and organization, without editing records.
`examples/ccmonet-customer.json` creates one synthetic customer in the demo
company. It starts on the Customers list, fills the form (a contact's Add
included) in one milestone and clicks Create in the next, so the fill review
settles any doubt about Add before anything is saved.

Traces are stored in ignored `.test-artifacts/`; `.env` and raw customer data
must stay local. No tests run during normal MCP startup.

- `browser_run` — default executor; supports host-defined milestones.
- `browser_review` — independently accept/reject a complex outcome's durable review ticket; executes no browser input.
- `browser_evidence` — expand one referenced network evidence item.
- `browser_resolve_action` — resolve an unconfirmed action after inspecting its outcome.
- `browser_snapshot` / `browser_act` — recovery only.
- `browser_screenshot` — visual fallback.
- `browser_doctor` / `browser_tabs` / `browser_open` — setup/navigation helpers.

MIT licensed. See `THIRD_PARTY_NOTICES.md`.

## General browser reliability

For complex outcomes use `verification_mode: "host"`. Jev executes, deterministic
assertions remain mandatory, and the host independently judges the returned
`host_review_required` observation against the original milestone criteria and
constraints. Call `browser_review` with evidence for the goal, every criterion,
and constraints before continuing. Accepted results are `milestone_accepted` or
`completed_host_verified`, never mislabeled as Jev automatic success. The default
`hybrid` also hands uncertain semantic verification to the host; `jev` preserves
the legacy automatic semantic gate. Pending reviews survive MCP restarts and block
input/new runs on the tab; stale observations require rejection and re-observation.
Host acceptance cannot override failed assertions, CAPTCHA/login or safety stops.
See [protocol](docs/PROTOCOL.md#host-review) for the full receipt contract.

Controls are identified by their label, field name, record context and form/dialog
scope. A reused selector cannot silently change the target record. A surgical
manual recovery may relocate a uniquely matching control after a DOM reorder;
ambiguous matches require another observation. Native and ARIA dialogs focus the
action surface. Background context remains available to the model but cannot
satisfy a foreground text assertion.
Repeated plain-DIV cards also supply bounded record context, preserving product
name links even when those links have button roles. Identical Add/Remove controls
on different cards do not become the same business operation.

After an action, the runtime observes field values, selected options, checked and
expanded state, and `aria-busy`/progress indicators within a bounded settling
window. It rechecks the risk of the exact selected action when the preliminary
decision suggests a side effect. Opening a picker and submitting a record are
separate operations. Safety and verification thresholds remain unchanged.

Before dispatching an interaction, a durable journal records its intent. This
also covers guarded `browser_act` recovery, which returns an unresolved action
ID until the host verifies its outcome. An unconfirmed remote mutation survives
a changed `run_id`, milestone resume and process restart. Unrelated page changes do not release it. A lost acknowledgement
can be reconciled by an exact local control effect or independently verified final
outcome, without replaying input. Otherwise the host inspects evidence and calls
`browser_resolve_action` with an observed `applied`/`not_applied` outcome. Pending actions do not expire silently. A reviewed `applied` remote mutation remains protected against repeating the same
logical operation, while `not_applied` allows a retry. Confirmed low-risk
navigation, including meaningful same-document anchors, does not acquire a
permanent replay guard.

Keep `JEVSTEER_STATE_DIR` on persistent local storage
when running from changing working directories; do not share one state directory
between unrelated browsers that reuse tab IDs.

In addition to text/title/URL assertions, contracts support `field_equals`,
`control_checked`, and `element_count`. Match a control's exact accessible `label`
and optional row/fieldset `context`; multiple matches fail. Field values remain
exact, including whitespace and empty strings. For example:

```json
{
  "type": "field_equals",
  "label": "Name",
  "context": "Contact",
  "value": "Morgan Li"
}
```

`max_duration_ms` defaults to 300000 per milestone. The budget is cooperative: no
new input begins after exhaustion, while an already dispatched command retains
its transport timeout. `JEVSTEER_ACTION_SETTLE_MS` defaults to 8000 and
`JEVSTEER_OBSERVATION_QUIET_MS` to 250, and `JEVSTEER_REVIEW_QUIET_MS`, the
quiet period before a host review ticket binds the page, to 1000. A `wait`
watches the page for up to `JEVSTEER_WAIT_MS` (default 5000) and ends as soon as
it changes; `JEVSTEER_MAX_IDLE_WAITS` (default 2) waits in a row that saw
nothing change stop the milestone as `stuck`, one more if the page kept sending
requests. With the
Playwright driver each round waits for quiet full snapshots only, and for open
XHR/fetch requests the last input started, not counting analytics and ad
beacons; the Kapture DOM-metadata settle poll
is skipped because Playwright metadata carries no DOM size. Link navigation, explicit GET search-form
submissions and search Enter can wait up to `JEVSTEER_NAVIGATION_SETTLE_MS`
(default 15000) for an observed route change. Checkboxes, radios and fields in
such a form, and same-page `#` links, do not wait for one;
transient content-script teardown is retried through reads only. A lost
`browser_open` acknowledgement is accepted only after fresh DOM metadata confirms
the exact requested destination. Otherwise `navigation_unconfirmed` retains the
`tab_id` for inspection without retransmitting navigation.

Temporary Kapture selectors may be rebound to a uniquely matching semantic
control and rechecked for live visibility and unchanged field value before
journaling and dispatch. Record identity, duplicate-target and replay guards
remain in force. Modal containers are measured through Kapture visibility,
including text-only dialogs; CSS-hidden templates cannot become the foreground.
ARIA listbox containers are excluded from click/select targets: the executor
must choose a specific option. Verification also retains bounded button-state
summaries such as passenger counts without treating button presence as proof
that an action was performed. Semantic uncertainty still requires host review.

DOM snapshots are still non-atomic; opaque
iframes, closed shadow roots, canvas controls, uploads and native security dialogs
can require host intervention. This is an outcome-verified runtime, not an
exactly-once transaction protocol or a claim of universal site compatibility.
