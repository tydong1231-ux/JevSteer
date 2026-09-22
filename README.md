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
