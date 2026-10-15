<!-- Generated from docs/adr/ADR-006-model-strategy.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-006 — Model Escalation Strategy

Status: Accepted  
Date: 2026-09-23

## Context

Most repository work does not require the cost or latency of the strongest model, while geometry, weighting, architecture changes, and difficult regressions benefit from deeper reasoning.

## Decision

Use GPT-5.6 Sol High for routine development. Escalate geometry, Weight Solver design, constraint architecture, major IR changes, and difficult non-local regressions to GPT-6 Astra High or XHigh. Record every recommended escalation using the standard workflow format.

2026-10-03 owner-directed trial: Gate 4 development now uses GPT-6.1 Sol High (`gpt-6.1-sol`). A designated development agent runs the scoped trial; the coordinating chat model is not automatically switched. This changes Gate 4 only, not earlier execution records, other Gates, acceptance thresholds, or Jev's role. Official model ID and `high` reasoning support were checked against [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Jev independently decides whether a Gate has sufficient evidence to pass. It is an acceptance judge, not the implementation model.

## Alternatives

- Use one model for every task.
- Escalate based only on task size.

## Consequences

- Model choice follows risk rather than file count.
- Escalation remains scoped to a precise question.
- Gate acceptance remains separate from implementation confidence.
