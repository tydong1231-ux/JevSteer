# ccMonet native Playwright live investigation

Date: 2026-10-15 (Asia/Shanghai). Tracking issue 3, P6. This is an incomplete
live acceptance record, **not** a C1–C3 pass or permission for P7 cutover.

## Provenance and privacy

Windows, Node 24.19.0, installed user Chrome 155.0.8059.79, Playwright 1.64.1,
OpenRouter System One `jev-latest`. The user personally enabled remote debugging
and authorized attachment. The real stdio MCP server returned
`browser_driver=playwright`, `browser_mode=cdp` with the existing DEMO session.
`JEVSTEER_CDP_ENDPOINT=chrome` was used; no Kapture input or DOM write executed
these live tasks. A dedicated testing browser had previously encountered a
Cloudflare login block; no security bypass was attempted.

Target actions used MCP `browser_run`. The Host reviewed fresh observations and
used `browser_inspect` for a separate fixed read-only table/control oracle. One
explicit `browser_act` recovery cleared an accidentally selected table checkbox,
then independent readback and `browser_resolve_action` confirmed deselection.
This is a Host intervention, not unattended success. Report generation was
allowed as read-only; saves, payment, approval, reconciliation, AI Match, exports
and company changes were prohibited. No such business action was dispatched.

Raw observations, tables and transport results remain under ignored
`.test-artifacts/ccmonet-playwright`; durable action/review state remains under
ignored `.jevsteer-state`. Do not publish those directories, a browser profile,
provider credentials or session cookies. No key is included in this document.

## Results and failed gates

| Gate | Observed result | Acceptance |
| --- | --- | --- |
| C1 Approved list | First pause was All Bills and was rejected. Corrected Approved filter and loaded records were independently accepted. | List checkpoint only; Host-corrected |
| C1 actual supplier detail | Rows and descendant cells carry `aria-disabled=true` on a `role=button` row. Detail could not be safely dispatched. Jev incorrectly selected rows before the exact-constraint patch; recovery restored zero selection. | **Not passed**; no detail/line-item oracle |
| C2 report configuration | Original body-text assertions used input placeholders and failed. Corrected exact field assertions confirmed the actual P&L configuration. | Configuration checkpoint only; Host-corrected |
| C2 Q1 generation → Q2 | Q1 dates read back correctly; one Generate click was acknowledged, but no populated report/period heading appeared after bounded waits. Its durable action is still pending. Q2 was not attempted. | **Not passed**; no financial arithmetic oracle |
| C3 statement list | Exact DBS Demo May statement, six transactions and zero reconciled were independently read from the visible table. | List checkpoint only |
| C3 actual six-row detail | Repeated unnamed view/delete controls could not satisfy unique target freshness; no detail click was dispatched. Descendant-icon naming was patched and fixture-tested, but the following existing-Chrome reconnect timed out. | **Not passed**; no six-row balance equation oracle |

The pending Q1 action must be independently reconciled, never deleted or
resolved from its ACK or absence of a success message. Later read-only list
acceptance does not clear that earlier run's journal record. No new profile,
new run ID or changed goal may be used to evade this protection.

## Changes driven by this investigation

- Lazy per-page event monitoring: merely discovering user tabs collects no
  unrelated page network/console events.
- Exact constraint guard for low-risk explore inputs, including row-selection
  clicks; checked state is included in the guard context. The form strategy's
  existing all-offered-field constraint frontier stays batched.
- Read-only discovery of cursor-marked cards and accessible descendant icon
  names. True disabled ancestry is still respected; no force click or attribute
  removal is used.
- `browser_inspect`: bounded main-frame table/control oracle, independent of
  Jev's completion claim, with secret control redaction and disabled diagnostics.
- Local persistent stdio MCP host bridge and dedicated-profile login helper.
  Session-prefixed evidence filenames prevent overwrite after a restart.

## Next acceptance work

Local verification after these changes: 162 offline tests passed, syntax check
passed for 63 modules, and the complete 23-case browser/MCP suite passed three
independent repetitions (69 passes, zero skips/retries). This includes six
provider-backed cases: three real Jev six-field comparisons and three real Jev
fill/save/business-readback scenarios. The remaining 63 passes use real Chromium
with fixture decisions or direct adapter conformance. No ccMonet gate is inferred
from those counts. [Updated controlled metrics](BATCH-FORM.md) include the stricter
explore constraint checks.

Restore the user-authorized Chrome connection, inspect the actual icon names,
and rerun the same C3 detail milestone only if a unique non-destructive target
is available. C1 needs a legitimate enabled detail path, not disabled-state
bypass. C2 needs date-picker commit/Generate outcome investigation and independent
report readback before any retry. Then run all C1–C3 checks from clean starting
states, with first-try/recovered/Host-corrected outcomes reported separately.

P5 cross-process cancellation/crash/migration matrices and P7 identical-model
Kapture/Playwright A/B remain open. The compatibility default stays Kapture;
this user's current live workflow remains explicitly Playwright. Do not merge,
close issue 3 or claim general cost savings from list/configuration checkpoints.
