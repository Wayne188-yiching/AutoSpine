# AutoSpine Roadmap

The authoritative Gate rules and status live in [AUTOSPINE_DEVELOPMENT_WORKFLOW.md](AUTOSPINE_DEVELOPMENT_WORKFLOW.md). This file is only a compact milestone index.

## Foundation

- Gate 0 — Repository, architecture, IR, tooling, ADRs, Gate 1 plan
- Gate 1 — Minimal Spine 4.0.64 compiler
- Gate 2 — PNG Parts and PSD asset parsing

## Tail vertical slice

- Gate 3 — Tail mesh generation
- Gate 3.1 — Tail mesh density and triangle quality refinement
- Gate 4 — Deterministic chain rig
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

No Gate begins until the preceding Gate has passed developer verification and Jev acceptance.
