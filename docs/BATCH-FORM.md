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
