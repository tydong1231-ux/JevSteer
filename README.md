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

[Product portfolio](https://botly.cc) · [Agent protocol](docs/PROTOCOL.md) · [Example: Claude Code](examples/claude-code.md)

## What problem does it solve?

A powerful host agent is good at planning a multi-step business task, but spending that agent's time on every browser click is expensive. A smaller executor can be cheaper, but should not be entrusted with the entire business workflow.

**JevSteer separates those responsibilities:** the host owns the plan and business judgment; the executor handles **one bounded milestone** at a time, checks the visible effect of its actions, and returns evidence or asks for guidance.

**What this project demonstrates:** agent orchestration, tool boundaries, cost-aware architecture, human-in-the-loop handoffs, and outcome verification—not simply browser automation.

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

- `browser_run` — default executor; supports host-defined milestones.
- `browser_evidence` — expand one referenced network evidence item.
- `browser_snapshot` / `browser_act` — recovery only.
- `browser_screenshot` — visual fallback.
- `browser_doctor` / `browser_tabs` / `browser_open` — setup/navigation helpers.

MIT licensed. See `THIRD_PARTY_NOTICES.md`.
