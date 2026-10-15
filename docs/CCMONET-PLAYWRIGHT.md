# Playwright live-integration notes

Public implementation and acceptance-boundary notes for issue 3. Account-specific
observations and raw live results are kept in ignored local artifacts, not this
document. A technical test pass does not authorize default-driver cutover.

## Connection and privacy

Use the native Playwright driver with an explicitly authorized persistent test
profile or existing CDP session. For the pinned SDK, the `chrome` channel can
attach to a user-enabled default Chrome debugging session. The user personally
enables remote debugging and approves the connection; never automate that prompt,
copy a live profile or bypass security challenges.

Keep one connection during a validation session. When a restricted process cannot
read the debugging endpoint, report the permission problem rather than silently
launching an unsigned-in browser or repeatedly asking the user to change settings.

Obtain explicit consent before sending necessary current-page data to the chosen
model provider. Keep unrelated pages, credentials and cookies out of model input.
Merely discovering tabs must not start event collectors on unrelated pages.

## Execution and evidence

Target actions go through the actual stdio MCP `browser_run` entry point.
The Host uses fresh observations and the fixed read-only `browser_inspect`
oracle to check business outcomes. Native screenshots are an explicit private
fallback, not a replacement for action identity or a way to force disabled input.
Raw screenshots, network evidence, profiles and journals remain local/ignored.

Every guarded explore input gets exact remote/irreversible-effect and constraint
checks. Read-only excludes remote preference writes as well as business saves.
The restricted form strategy keeps its conservative all-offered-field frontier.
Card text takes precedence over child icons; static image filenames are explicitly
hints, never fabricated accessible names. Duplicate/disabled targets still reject.

Unknown actions remain durable. Verification must match their originating full
contract digest as well as run/milestone IDs. Changed goals or weaker assertions
cannot certify older unknowns; legacy entries require explicit reconciliation.

## Validation and remaining gates

Local follow-up: 167 offline tests passed, 64 modules syntax checked, and 26
real-browser/MCP cases passed three repetitions (78 passes, no skips/retries/flaky
cases). Provider-backed cases use isolated synthetic data. These results do not
establish full live-site acceptance or broad cost/performance gains.

Independent test invocations use separate `JEVSTEER_E2E_OUTPUT` subdirectories
below `.test-artifacts`. Broad/outside paths are rejected because Playwright
clears its results directory. See [controlled form measurements](BATCH-FORM.md)
for synthetic-only comparisons.

Full record-detail, report-period/arithmetic and statement-detail gates must be
verified with authorized live evidence and first-try/recovered/Host-corrected
outcomes distinguished. Migration, cross-process crash/cancellation matrices and
same-contract cross-driver A/B remain open. Keep the compatibility default until
the required gates pass; do not close issue 3 from fixture counts alone.
