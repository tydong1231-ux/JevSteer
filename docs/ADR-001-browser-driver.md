# ADR 001: Native Playwright driver, staged migration

Date: 2026-10-15 (Asia/Shanghai). Tracking: [issue 3](https://github.com/tydong1231-ux/JevSteer/issues/3).

## Decision

Use the official `playwright-core` SDK behind a thin BrowserDriver. Keep Node
`>=20`, JavaScript modules, the Host/Milestone FSM, journal, verification and MCP
contract. The adapter is opt-in until the live business and comparison gates pass.
No upstream autonomous `run`/`resume` loop is embedded in the orchestrator.

The inspected tontoko revision is
`7d6335935043c680a005733b3bbf61af5c675ec5` (v0.16.0). Its documented `snapshot`,
`native` and `allowCommand` surfaces could support a borrowed Page and command
guard. We do **not** claim that it lacks hooks. Its declared Node `>=22.15.0`
requirement fails the existing Node20 compatibility gate. Direct Playwright
1.64.1 declares Node `>=20`. The native route also avoids importing a second
provider/lifecycle and keeps the journal hook directly next to physical input.

This is a compatibility-based selection of branch B. SDK branch A was reviewed
at the API/manifest level, not benchmarked on ccMonet. Reconsider it separately
if the project intentionally raises its minimum Node version. Native Windows
profile/CDP/physical-input fixtures establish adapter feasibility, not arbitrary
site success or lower Jev cost.

Sources inspected: [tontoko package](https://github.com/tontoko/jev-browser/blob/7d6335935043c680a005733b3bbf61af5c675ec5/package.json),
[SDK API](https://github.com/tontoko/jev-browser/blob/7d6335935043c680a005733b3bbf61af5c675ec5/docs/api.md),
[Playwright actionability](https://playwright.dev/docs/actionability),
[inputs](https://playwright.dev/docs/input),
[CDP lifecycle](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).

## Frozen P0 baseline

The pre-existing staged 10/15 host-review patch was preserved as commit
`683c480`, based on PR2 head `cdee8b4cab424ecc363db98fda08b31fb5009626`.
It includes host/hybrid/jev verification, durable review receipts, exact field
binding, modal/DOM fixes and bounded passive waiting. All 162 unique offline
tests passed locally on Windows/Node 24.19.0 before driver changes. This is the
123-test earlier baseline plus the patch coverage, not 285 independent tests.
Private ccMonet investigation artifacts stay in ignored `.test-artifacts`.

## Implementation boundary

- `browser/{driver,index,kapture-driver,playwright-driver}.mjs`: injected driver,
  input dispatch classification, managed profiles, CDP, legacy compatibility.
- `browser/{sessions,snapshot,events}.mjs`: physical Page IDs, logical sessions,
  Frame/Shadow/record/form observations, transient target pins, bounded events.
- Journal records add optional session/page metadata; existing legacy records
  and fingerprints remain readable. Unknown actions fence replacement Pages in
  the same namespace; the host can reconcile a closed Page without dispatch.
- MCP `browser_run`, `browser_review`, `browser_act`, `browser_snapshot`,
  `browser_tabs`, `browser_doctor`, screenshots and evidence use the same runtime.
- `@playwright/test` uses real Chromium plus actual MCP tool calls and independent
  DOM/fixture HTTP readback. Provider doubles and live Jev tests are labeled
  separately. Runner retries are zero. Failure artifacts stay local and ignored.

Native action handles are **single-dispatch pins**, not durable IDs. This avoids
a Locator indexed into a virtual table retrying against another record after
intent persistence. Keyboard mode uses the pinned handle's real Playwright
typing/press events. No DOM write, fabricated user event, `force:true`, private
application write API or second autonomous agent is used by the driver.

## Remaining gates (not claimed complete)

Local validation on Windows/Node 24.19.0 with Playwright 1.64.1 / Chromium
156.0.8078.4: 162 offline tests passed; eleven native/MCP fixture cases passed
three independent runs (33 passes). After configuring a process-local OpenRouter
key, the real `jev-latest` fill → host acceptance → one Save → independent
business readback → host acceptance scenario passed three independent runs.
Each used seven Jev logical calls; measured Playwright case durations were
5.432s, 4.565s and 4.130s. These include the in-process MCP host/oracle, not a
separate external Host model, and are not an A/B performance result. The broader
suite also ran headed on Windows; a long Windows test-profile path initially
prevented storage persistence, so the persistence fixture now uses a short
disposable profile. CDP attachment/disconnection and storage reuse passed.

P0 still needs the same-account live benchmark freeze. P1 has no live SDK-A vs B
comparison. P2/P3 include the native foundation, not all virtual-list, cross-origin
Frame, Canvas or custom-widget cases. P4's restricted batch field strategy is
implemented separately; [its controlled fixture comparison](BATCH-FORM.md)
does not establish general or ccMonet savings. P5 still needs explicit cross-driver migration,
cross-process browser crash/cancellation matrices and retention tests. P6 has
the real-browser MCP harness but ccMonet C1–C3 must run with an authorized DEMO
profile and independent business oracles. The initial authorized existing-Chrome
run is documented in [ccMonet evidence and failed gates](CCMONET-PLAYWRIGHT.md):
native connection/list/configuration checkpoints succeeded, but C1–C3 full
business acceptance did not. C4 mutations remain isolated fixtures.
P7 requires identical-model/account A/B evidence and live business acceptance
before changing the compatibility default or retiring Kapture/Cheerio.

Do not close issue 3 or merge on fixture counts alone. CI adds Windows/Linux and
Node20/22/24 checks; a configured matrix is not a claim that remote CI has passed.

## Benchmark set to freeze under identical conditions

| Case | Evidence / failure of interest |
| --- | --- |
| ccMonet C1 supplier bill | Unique record detail, line items and status, no row-selection false pass |
| ccMonet C2 Q1 to Q2 P&L | Exact current dates, generated period and independent totals |
| ccMonet C3 bank statement | Six nonempty rows, balance equation, zero reconciliation writes |
| Synthetic draft | Two fields, one Save, independent business ID and host receipt |
| Save ACK loss | One persisted request, restart/new run ID, no duplicate |
| Replaced Page | Unknown action remains discoverable and blocks new input |
| Recycled record row | No wrong-record click before/after journal fsync |
| Equal field names | Fieldset/form/record ownership, ambiguity rejection |
| Frame and Shadow | Correct target and exact field readback |
| Overlay/modal | No background action, no forced click |
| Persistent profile / CDP | Storage reuse, explicit page, canonical physical lease identity |
| Public navigation | Wikipedia/Python/Books, lost navigation ACK readback |
| Native/custom form controls | Selenium/arXiv; date swapping and live dependent fields |
| Product/cart workflow | SauceDemo record scope and zero duplicate additions |

For each case record first-try/recovered/host-corrected/blocked outcome, wrong
record and duplicate writes, unknown/reconciled dispatches, Jev requests/tokens/
latency, host interventions, browser/observation time and total wall time. A
synthetic provider cannot establish Jev savings; no improvement percentage is
reported before that controlled comparison exists.
