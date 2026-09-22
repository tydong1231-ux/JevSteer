# JevSteer host/executor protocol

## Roles

- **Host (Claude Code / Codex):** understand user intent, form a Task Contract, resolve ambiguity/vision/high-risk situations.
- **JevSteer:** execute bounded browser actions, detect drift, verify completion, return structured recovery.
- **Jev:** typed low-cost decisions only; no free-form planning or text generation.
- **Kapture:** observe/control the user's real Chrome tab.

## Normal flow

```text
Host
  -> browser_run(Task Contract)
      -> Jev/Kapture internal loop
      -> strict final verification
  <- completed_verified
```

The host should not inspect every internal step.

Tool results keep a JSON text fallback and also expose structured MCP content when the host supports it, so status/recovery can be consumed without parsing prose.

## Task Contract

`goal` is required.

For multi-step or identity-sensitive tasks, the host SHOULD provide `success_criteria`. Criteria should describe final observable facts, not instructions.

Good:

- `Customer name is exactly ABC Pte Ltd`
- `Invoice INV-42 detail page is open`

Bad:

- `Click Customers, type ABC, click the first row`

Use `constraints` for prohibited effects and `assertions` only for exact machine-checkable facts.

## Completion rule

Only `completed_verified` is success.

`done` from the internal executor is only a candidate completion signal; it is never returned as final success.

## Recovery rule

When `recovery` is present:

1. Follow `recovery.next_tool` if supplied.
2. Perform the minimum correction needed.
3. Do not expand into click-by-click manual control unless JevSteer remains blocked.
4. If `resume_after=true`, call `browser_run` again with the same Task Contract and original values.

## Visual fallback

For `needs_vision`, use the host's native computer-use/vision capability (or `browser_screenshot`) for only the visual step, then resume JevSteer.

## Irreversible actions

For `needs_confirmation`, the host must get explicit user authorization before re-running with `allow_irreversible=true`.

## Drift

The internal loop continuously scores `on_track`. A wrong navigation is auto-reversed only when JevSteer can conservatively prove it was navigation-like and low-side-effect. Otherwise it returns `drifted` to the host.
