# Browser tool policy

When `jevsteer` MCP is available:

- Use `browser_run` as the default browser/computer-use executor for normal web pages.
- Give outcome-level goals, not click sequences.
- For multi-step or identity-sensitive tasks, include concise `success_criteria`.
- Put prohibited effects in `constraints`.
- Put text to enter in `values`; put passwords/tokens/secrets only in `values`.
- Treat only `completed_verified` as success.
- On any other status, follow `recovery.strategy` and `recovery.next_tool` when provided.
- `browser_snapshot` + `browser_act` are recovery-only; do one surgical correction, then resume `browser_run` with the same Task Contract and original values.
- For `needs_vision`, use native visual computer use for that step only, then resume `browser_run`.
- For `needs_confirmation`, ask the user before re-running with `allow_irreversible=true`.
- Never bypass CAPTCHA, login approval, 2FA, payment confirmation, destructive confirmation, or account security prompts without the user.
