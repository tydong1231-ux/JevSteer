# ccMonet native Playwright live investigation

Initial run: 2026-10-15; follow-up: 2026-10-16 (Asia/Shanghai). Tracking issue 3,
P6. This is an incomplete live acceptance record: C3 passed after Host correction,
but C1/C2 did not. It does **not** authorize P7 cutover.

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
The follow-up did include **two unintended report-favorite preference writes**;
see the incident below. Therefore the overall run cannot be called read-only
success even though no financial record save/payment/reconciliation occurred.

The user explicitly consented to sending necessary current DEMO page text and
bill/statement fields to OpenRouter for these tests. Cookies, passwords and other
tab content were not supplied to Jev. A later restricted execution account could
not read Chrome's DevToolsActivePort; running the authorized connection in the
normal user environment restored the same Page/session, without profile copying
or changing Chrome security settings. Driver restarts request fresh Chrome
permission, so fixes were grouped and the connection reused between them.

Raw observations, tables and transport results remain under ignored
`.test-artifacts/ccmonet-playwright`; durable action/review state remains under
ignored `.jevsteer-state`. Do not publish those directories, a browser profile,
provider credentials or session cookies. No key is included in this document.

## Results and failed gates

| Gate | Observed result | Acceptance |
| --- | --- | --- |
| C1 Approved list | First pause was All Bills and was rejected. Corrected Approved filter and loaded records were independently accepted. | List checkpoint only; Host-corrected |
| C1 actual supplier detail | Disabled row ancestry still prevents direct detail access. Follow-up isolated the unique approved record; two wrong Page Size inputs occurred before successful search (current Page Size input independently confirmed empty afterward). An enabled-toolbar alternative was blocked before dispatch by the earlier manual local-recovery replay barrier. | **Not passed**; no detail/line-item oracle |
| C2 report configuration | Original body-text assertions used input placeholders and failed. Corrected exact field assertions confirmed the actual P&L configuration. | Configuration checkpoint only; Host-corrected |
| C2 Q1 generation → Q2 | Q1 dates read back correctly; one Generate click was acknowledged, but no populated report/period heading appeared after bounded waits. Its durable action is still pending. Q2 was not attempted. | **Not passed**; no financial arithmetic oracle |
| C3 statement list | Exact DBS Demo May statement, six transactions and zero reconciled were independently read from the visible table. | List checkpoint only |
| C3 actual six-row detail | Static image hints distinguished detail/delete. One native detail click reached the exact statement; actual column labels required Host correction. Independent table readback confirmed six nonempty dated descriptions, every running balance, and the opening + deposits − withdrawals = closing equation in integer cents. After acceptance, fresh list readback still showed six transactions and zero reconciled. | **Passed, Host-corrected**, not first-try/unattended |

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
- Action verification now requires the originating full contract digest as well
  as run/milestone IDs. Changed goals or weaker criteria cannot clear old
  unknowns. Legacy digest-less journal entries require explicit reconciliation.
- Exact remote-effect checks now run for every guarded explore input, even
  when rough risk is low. Preference changes count as writes in read-only tasks.
  Batch retains its conservative any-offered-field safety frontier.
- Visible card text takes precedence over a nested favorite icon; static image
  filenames are explicitly `icon:` hints, not invented accessible names. URL
  queries are not included in these hints, and duplicate hints still reject.
- E2E output directories can be isolated below `.test-artifacts` so concurrent
  test runners do not clear each other's traces. Broad/outside paths are rejected.

## Follow-up preference-write incident

During read-only navigation to P&L, two clicks selected small favorite controls
instead of the report card body. The network evidence contains two successful
favorite-preference PUT requests. The native naming fallback had labeled both
card containers and their nested favorite icons as `star`; the rough effect
classifier also missed the remote preference effect. The later explicit
no-favorites constraint stopped another attempted click **before** input.

Live input was then stopped and the controller disconnected. No baseline
favorite state was captured, so two clicks or the current outlined-star display
cannot prove restoration. **Do not claim the preference state was restored.**
The Host needs the user's expected favorite state before any corrective change.
No financial records were saved, paid, approved, matched or reconciled.

The code fix separates parent card text from child icons and always performs the
exact explore action-effect check. Dedicated synthetic regressions verify that
the card opens without a favorite write and a low-rough-risk preference action
is blocked before input under a read-only constraint. These tests are not a
claim that the fixed build has passed a new live ccMonet run.

## Next acceptance work

Historical first-round verification: 162 offline tests passed, syntax check
passed for 63 modules, and the complete 23-case browser/MCP suite passed three
independent repetitions (69 passes, zero skips/retries). This includes six
provider-backed cases: three real Jev six-field comparisons and three real Jev
fill/save/business-readback scenarios. The remaining 63 passes use real Chromium
with fixture decisions or direct adapter conformance. No ccMonet gate is inferred
from those counts. [Updated controlled metrics](BATCH-FORM.md) include the stricter
explore constraint checks.

Latest follow-up validation: 167 offline tests passed; syntax check passed for
64 modules. The final 26-case browser/MCP suite passed three repetitions (78
passes, zero skips/retries/flaky cases), including six provider-backed cases and
72 other real Chromium conformance/fixture passes. Final private output is
`.test-artifacts/validation-20261016-readonly-guards/report.json`.
An initial restricted-account attempt failed to launch Chromium
with EPERM. A development test used an unsupported fixture helper and was fixed;
another overlapping runner removed shared trace files. Those attempts are not
counted as acceptance passes. Final reruns use isolated output directories.

Confirm/restore report favorite state with the user before further live input.
C1 needs a legitimate enabled detail path and reconciliation of the broad local
manual replay barrier, not journal deletion or disabled-state bypass. C2 needs
independent reconciliation of its original pending Generate action before retry.
Then rerun C1–C3 from clean starting states, recording first-try, recovered and
Host-corrected outcomes separately. Keep the current C3 acceptance provenance.

P5 cross-process cancellation/crash/migration matrices and P7 identical-model
Kapture/Playwright A/B remain open. The compatibility default stays Kapture;
this user's current live workflow remains explicitly Playwright. Do not merge,
close issue 3 or claim general cost savings from list/configuration checkpoints.
