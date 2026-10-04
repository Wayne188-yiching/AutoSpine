# Gate 14 — assistant engineering acceptance

Decision: **APPROVED_CONTRACT**, 2026-10-05. `GATE_14_SELF_CHECKS_2026-10-05.json`: 30 planner/toolchain tests, format/lint/types passed.

An injected planner provider returns unknown structured output; strict PlannerProposal schema plus matching asset ID, canvas bounds, distinct endpoints and confidence >=0.8 precede Core. Provider context contains only asset ID/dimensions/part names/order by default, not images, file paths or artist answers. Host retains job source/output paths. Accepted fixture proposals execute the actual PNG/mesh/rig/weights/wave pipeline; invalid/stale/extra-field/degenerate/low-confidence proposals execute Core zero times. Validation clones input and numerical output repeats identically.

This Gate closes the AI-to-deterministic-Core **contract**, not live visual-model performance. No model API, new model weights, network requests or paid service are installed or called. A host Codex/model can supply a proposal using this port or the upcoming MCP tool. Automatic anatomical decisions and production image evaluation remain unverified. The numerical IR registry stays at eight entries (ADR-009).
