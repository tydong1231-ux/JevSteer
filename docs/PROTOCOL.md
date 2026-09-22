# JevSteer protocol

## Responsibility split

- **Host:** understand user intent/system logic, define milestones, review milestone evidence, patch guidance.
- **Jev:** choose the next action inside one milestone.
- **Runtime:** DOM observation, action execution, deterministic effect checks, drift/safety gates, network evidence.
- **Kapture:** real Chrome control + DOM/network transport.

## Milestone contract

A milestone contains `goal`, `success_criteria`, optional `constraints`, `guidance`, and deterministic `assertions`.

Guidance must be just-in-time workflow knowledge, not selectors or click sequences.

## Loop

`observe -> decide -> act -> verify effect -> observe`

JevSteer never assumes an action succeeded only because the command returned. The next observation records a mechanical effect check; final milestone completion still requires strict semantic/assertion verification.

If workflow knowledge is missing, return `needs_guidance` instead of guessing. The host patches the current milestone and resumes.

## Host review

`strict`: return `milestone_ready_for_review` after each verified milestone. Host acceptance is expressed by starting `next_milestone_index`; rejection reruns the same milestone with corrected guidance/criteria.

`fast`: continue automatically across internally verified milestones.

## Evidence

Each milestone returns a compact Evidence Packet: actions/effects, verification, final page, filtered network evidence. Relevant request/response bodies are sanitized and referenced; expand only when needed via `browser_evidence`.
