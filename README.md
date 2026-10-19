# JevSteer

**Low-cost browser execution for Claude Code, Codex and other MCP hosts.**

```text
Host agent: plan + milestones + review
                ↓ MCP
             JevSteer
      Jev: decide inside a milestone
      Runtime: act + verify + evidence
                ↓
             Kapture
                ↓
        your existing Chrome
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

## Why Kapture

Kapture controls the user's existing Chrome session, preserving cookies, logins, extensions and local state. It also exposes DOM and network/CDP data, which lets JevSteer verify workflows without making screenshots the primary control surface.

Playwright is better for isolated deterministic tests. Kapture is a better default for interactive work in the user's real browser.

## Safety and tradeoffs

- DOM-first execution cannot fully understand canvas/image-only interfaces; those are returned to host vision.
- A real user browser is less deterministic than an isolated test browser.
- Network evidence is filtered/redacted and unavailable on older Kapture extensions.
- CAPTCHA, native file pickers, drag-and-drop and unsupported native dialogs are not automated yet.
- Destructive or externally visible actions fail closed unless explicitly allowed.

## Quick start

Requirements: Node.js 20+, TypeSafe Jev API access, Chrome/Chromium and the Kapture extension.

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
connected. Review each returned Evidence Packet before resuming at
`next_milestone_index` with the same `run_id`. A result that requires guidance
or is uncertain is not an automatic pass. The examples are workflow contracts,
not selector scripts. Use a unique customer name for creation runs and inspect
existing records before creating another one.

Traces are stored in ignored `.test-artifacts/`; `.env` and raw customer data
must stay local. No tests run during normal MCP startup.

- `browser_run` — default executor; supports host-defined milestones.
- `browser_evidence` — expand one referenced network evidence item.
- `browser_resolve_action` — resolve an unconfirmed action after inspecting its outcome.
- `browser_snapshot` / `browser_act` — recovery only.
- `browser_screenshot` — visual fallback.
- `browser_doctor` / `browser_tabs` / `browser_open` — setup/navigation helpers.

MIT licensed. See `THIRD_PARTY_NOTICES.md`.

## General browser reliability

Controls are identified by their label, field name, record context and form/dialog
scope. A reused selector cannot silently change the target record. A surgical
manual recovery may relocate a uniquely matching control after a DOM reorder;
ambiguous matches require another observation. Native and ARIA dialogs focus the
action surface. Background context remains available to the model but cannot
satisfy a foreground text assertion.

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
`JEVSTEER_OBSERVATION_QUIET_MS` to 250. DOM snapshots are still non-atomic; opaque
iframes, closed shadow roots, canvas controls, uploads and native security dialogs
can require host intervention. This is an outcome-verified runtime, not an
exactly-once transaction protocol or a claim of universal site compatibility.
