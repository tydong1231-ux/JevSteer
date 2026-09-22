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
