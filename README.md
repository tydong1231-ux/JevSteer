# JevSteer

**Verified, low-cost browser execution for Claude Code and Codex.**

```text
Claude Code / Codex
        ↓ MCP
     JevSteer
   Jev decisions
        ↓
     Kapture
        ↓
 your existing Chrome
```

JevSteer keeps frontier models at the planning and recovery layer while Jev handles repetitive browser decisions cheaply.

## Best use cases

JevSteer is most useful for **multi-step, DOM-heavy work in authenticated web apps**:

- SaaS admin, ERP, CRM and accounting workflows.
- Repetitive 10–50 step browser tasks.
- Search, filter, inspect, enter data, open records and download files.
- Workflows that benefit from reusing the user's existing logged-in Chrome session.
- High-volume browser execution where Claude/Codex should plan once, then stay out of the action loop.

Typical examples:

```text
Find an organization → open Bills → filter records → inspect/download results
Search a CRM → open matching accounts → collect fields → update allowed values
Navigate an admin portal → check multiple records → report exceptions
```

JevSteer is **not the default choice** for:
- 1–4 step browser tasks where direct Claude/Codex control is already cheap;
- Canvas, maps, games, image-only or highly visual interfaces;
- desktop cross-app automation;
- workflows dominated by CAPTCHA, native file pickers, drag-and-drop or unsupported dialogs;
- irreversible actions that should stay under explicit host/user control.

## Why Kapture

JevSteer is built for **interactive browser work**, not deterministic test automation.

Kapture is a good fit because it:
- controls the Chrome session you already use;
- keeps existing cookies, logins, extensions and local state;
- exposes DOM + CDP-style browser controls through a thin local layer;
- avoids launching a separate automation browser for every task.

Playwright is excellent for isolated, repeatable testing. Kapture is usually a better default here because JevSteer wants to operate the user's real browser session.

## What JevSteer adds

- **`browser_run`** — one high-level goal can execute many internal browser steps.
- **Task contract** — goal, success criteria, constraints and values.
- **Drift detection** — detects when execution moves away from the goal.
- **Safe recovery** — only clearly reversible navigation mistakes are auto-rolled back.
- **Verified completion** — local assertions + an independent Jev verifier before success.
- **Structured recovery** — Claude/Codex gets an explicit next action when JevSteer cannot continue safely.
- **Secret redaction** — password/token-like values are not exposed to Jev.
- **Tab leases** — prevents multiple agents from driving the same tab at once.

The only success state is `completed_verified`.

## Tradeoffs

- Requires the Kapture browser extension.
- A real user browser is less deterministic than an isolated test browser.
- DOM-first execution works best on conventional web apps; Canvas/image-only UI is handed back to the host model.
- CAPTCHA, file pickers, drag-and-drop and unsupported native dialogs are not automated.
- Destructive or externally visible actions fail closed unless explicitly allowed.

## Quick start

Requirements: Node.js 20+, a TypeSafe API key with Jev access, Chrome/Chromium, and the [Kapture extension](https://github.com/williamkapke/kapture).

```bash
git clone https://github.com/tydong1231-ux/JevSteer.git
cd JevSteer
npm install
export TYPESAFE_API_KEY="ts_..."
npm test
```

Connect the Chrome tab you want to control in Kapture.

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

## Main MCP tools

- `browser_run` — default high-level executor.
- `browser_check` — verify a page condition.
- `browser_snapshot` — inspect DOM state during recovery.
- `browser_act` — one surgical manual action.
- `browser_screenshot` — visual fallback for Claude/Codex.
- `browser_doctor` — setup and connection diagnostics.

## Design goal

JevSteer is not another general-purpose agent. It is a bounded browser execution layer optimized for **low cost, verification, conservative recovery and MCP portability**.

MIT licensed. Kapture and the Jev browser-loop work referenced in `THIRD_PARTY_NOTICES.md` remain under their respective licenses.
