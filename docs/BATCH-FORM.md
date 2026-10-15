# Batch form strategy and controlled comparison

Date: 2026-10-15 (Asia/Shanghai). Part of issue 3, P4; built on the BrowserDriver
foundation. The default remains `execution_mode=explore`.

`form` asks Jev once to bind each supplied current-stage value to an observed
field. Binding questions are independent, so the runtime validates collisions
and common form/record/document ownership before input. Explicit host field
assertions remain authoritative. Only ordinary editable fields and native
selects are supported; secrets and custom/dependent widgets use explore.
Remote/irreversible/constraint checks use the established safety policy, with
additional conservative login/unsupported-state gates. No completion threshold
is lowered. The same runtime handles target checks, durable intent, actual
browser input, exact readback, unknown actions and Host receipts.

All planned fields are re-observed between inputs. Previously filled values
must still match. If a dependency resets a field or changes available options,
the stage stops for guidance. It does not replay earlier fields or submit.
The host can resume the current stage with a smaller scope/value set. Form
completion always pauses for independent Host Review; commit is a separate
explore stage.

## Live six-field comparison

Same Windows host, Node 24.19.0, Playwright 1.64.1 / Chromium 156.0.8078.4,
OpenRouter `jev-latest`, isolated page, six synthetic values, exact field
assertions, constraints and workflow facts. One form contains five text fields
and one native select. Each variant starts blank, executes only through MCP
`browser_run`, and finishes with independent FormData equality, zero Save
counter and an accepted `browser_review` receipt. No hard-coded target clicks
or application write APIs execute the target task. The host oracle is test code,
not a separately billed Host model.

Final three independent repetitions:

| Run | Explore calls / input tokens | Batch calls / input tokens | Explore / batch wall time | Logical-call reduction |
| --- | --- | --- | --- | --- |
| 1 | 9 / 32,229 | 1 / 5,000 | 6.632s / 1.205s | 88.9% |
| 2 | 8 / 30,147 | 1 / 5,000 | 7.929s / 1.022s | 87.5% |
| 3 | 11 / 34,807 | 1 / 5,000 | 8.635s / 1.078s | 90.9% |

Tokens are provider-reported input tokens, not a price estimate. Calls count
logical runtime decisions, not hidden provider transport attempts. Durations
include the in-process MCP call, independent fixture oracle and acceptance.
An earlier comparison attempt failed on provider HTTP 499/internal_error and
was not counted as passed; no browser write was retried. These final fixture
measurements are not arbitrary-site success rates, ccMonet acceptance, or a
Kapture/Playwright A/B result. The controlled report remains under ignored
`.test-artifacts/batch-comparison-20261015.json`.

Regressions cover six-field input, binding collision, host-assertion conflict,
different form owners, uncertain effect safety and a dependency resetting an
earlier field. The baseline 162 offline tests remain in the suite.

## Follow-up after live constraint investigation

The ccMonet investigation exposed that even low-remote-risk explore actions can
violate a local-selection constraint. Explore now always checks the exact
state-changing action when explicit constraints exist. Batch retains its
existing conservative **any offered field/value** safety frontier and can only
execute its validated bindings; this is not a relaxed constraint threshold.
The complete updated suite passed 23 cases three times (69 passes, including
the six provider-backed cases). Updated six-field measurements on the same
model, fixture, contract and oracle:

| Run | Explore calls / input tokens | Batch calls / input tokens | Explore / batch wall time | Logical-call reduction |
| --- | --- | --- | --- | --- |
| 1 | 17 / 40,763 | 1 / 5,000 | 8.906s / 1.056s | 94.1% |
| 2 | 14 / 34,625 | 1 / 5,000 | 7.248s / 1.027s | 92.9% |
| 3 | 15 / 36,610 | 1 / 5,000 | 9.722s / 1.055s | 93.3% |

The earlier table remains historical pre-patch evidence. These are still
synthetic same-contract measurements, not ccMonet or cross-driver A/B savings.
Raw updated output is private under `.test-artifacts/playwright/report.json`.

## 2026-10-16 exact effect guard follow-up

After the unintended live favorite-preference writes, explore now checks exact
remote/irreversible effects for **every** guarded input, not only high rough
scores. Read-only includes preference writes. Form mode still validates the
same conservative all-offered-field frontier and never executes a favorite,
Save or navigation control. No threshold was relaxed to regain a pass.

The final 26-case suite passed three repetitions (78 passes). On the same
six-field fixture and oracle, all three runs used 19 explore calls / 44,466
provider-reported input tokens versus 1 form call / 5,000 tokens. Explore/form
wall times were 10.250s/1.104s, 10.593s/1.651s and 12.078s/1.074s. The logical
call reduction is 94.7% **only for this controlled synthetic contract**. These
are not ccMonet, separate-Host-model or cross-driver A/B measurements. Earlier
tables remain historical pre-fix evidence. The final private report is
`.test-artifacts/validation-20261016-readonly-guards/report.json`.
