# AutoSpine Roadmap

The authoritative Gate rules and status live in [AUTOSPINE_DEVELOPMENT_WORKFLOW.md](AUTOSPINE_DEVELOPMENT_WORKFLOW.md). This file is only a compact milestone index.

## Current priority — 2026-10-05 owner override

Latest authority is sequential development through Gate 17 with assistant self-acceptance and one source-only GitHub checkpoint per completed Gate. Gates 5–17 engineering scopes are implemented and recorded under [the current status](docs/reviews/GATE_5_17_STATUS.json), with [explicit acceptance criteria](docs/GATE_5_17_AUTONOMOUS_PLAN.html). Gate 14 closes the Planner contract; Gate 15 closes the numeric Critic / correction contract, not live visual AI performance. See [continuation and limitations](docs/AUTONOMOUS_DEVELOPMENT.md). Historical artist failures are not relabelled as success.

## Foundation

- Gate 0 — Repository, architecture, IR, tooling, ADRs, Gate 1 plan
- Gate 1 — Minimal Spine 4.0.64 compiler
- Gate 2 — PNG Parts and PSD asset parsing

## Tail vertical slice

- Gate 3 — Tail mesh generation
- Gate 3.1 — Tail mesh density and triangle quality refinement
- Gate 3.2 — Reopened, deferred by owner on 2026-10-03 at 23/164 complete static passes: Yuuna/panda/pig artist topology calibration (absolute +/-5 vertices, positions, manual edges; tutorials support the review)
- Gate 4 — Approved on 2026-10-03 after deterministic chain-rig precision refinement; [latest acceptance](docs/reviews/gate-4-precision/review.html) and [scope / visual example](docs/reviews/gate-4-resume/review.html)
- Gate 5 — Weight Solver v1
- Gate 6 — Tail deformation metrics and regression

## Joint and animation validation

- Gate 7 — Arm and elbow deformation fixture
- Gate 8 — Procedural animation presets
- Gate 9 — Curve engine
- Gate 10 — Loop validator
- Gate 11 — Minimal preview

## Character and constraint expansion

- Gate 12 — Basic humanoid template
- Gate 13 — Engine-neutral constraints

## AI-assisted workflow

- Gate 14 — AI Planner to validated specs
- Gate 15 — Visual Critic to CorrectionSpec
- Gate 16 — MCP adapter
- Gate 17 — AutoSpine Skill

Under the latest 2026-10-05 override, each engineering Gate is verified and self-reviewed before the next Gate, then published. Earlier mandatory Jev / fish-only constraints remain historical. Next product-quality work is a separately scoped artist/generalization phase: real multi-part input, anatomical decisions and live visual-model evaluation. Existing Gate 3.2 23/164 and Gate 4 PNG-only 0/23 remain incomplete, as does Yuuna Body artist comparison. No quota-triggered delayed continuation is installed.
