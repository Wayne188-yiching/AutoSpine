---
name: autospine
description: Use the AutoSpine deterministic engines and local CLI or MCP tools to prepare PNG mesh, explicit rigs, weighted animation and editable Spine output, inspect build evidence, or propose bounded rebuilds. Use for AutoSpine workflows, not generic drawing or anatomy inference.
---

# AutoSpine

Keep the agent as an operator of existing engines, not a replacement geometry algorithm. Begin from the actual checkout, current job, and [engineering status](../../docs/reviews/GATE_5_17_STATUS.json). Read [MCP tool details](../../docs/MCP_ADAPTER.md) only when connecting or choosing a tool. This project bundle is not proof of global skill discovery or desktop MCP registration.

## Choose the supported workflow

- For progress or diagnosis, use `autospine_get_status` and existing evidence; do not build or publish merely because the user asked a question.
- For a file build, the currently exposed profile is `chain-wave`: one connected alpha region, with **explicit** chain endpoints and bone count. Use the artist-split PNG, not artist scoring mesh/bone answers. Missing composition or anatomical information is a real input gap; do not manufacture confident joint coordinates.
- For an in-memory plan, use `autospine_validate_plan` then `autospine_execute_plan`. Validation is not approval: `reviewRequired` or confidence below 0.8 blocks automatic execution. File compilation uses a separate host-approved BuildJob; planner proposals cannot supply filesystem paths.
- For a correction, use measured evidence with `autospine_review_metrics`, then `autospine_apply_correction`. It may reduce wave amplitude or regenerate weights/wave, never directly replace vertices, bones or weights. Corrections must match the current asset, manifest and input fingerprint. Unresolved seams require review; successful numeric rebuilding is not artist-quality acceptance.

## Build and hand off

Use `autospine_build` only for an authorized write into a **new** output directory within the host-configured workspace. Do not retry over existing outputs or alter original artwork. The engine produces the preview, versioned IR references, diagnostics and provenance. Inspect the actual preview and manifest-bound hashes before presenting visual claims. A render alone is not a direct visual review; an IR preview is not official editor playback.

If MCP is unavailable, use the existing CLI, not a rewritten engine:

```text
npm run build
node packages/cli/dist/index.js build <approved-job.json>
```

Job/schema details are in [the project quick start](../../README.md). Constraints, presets and humanoid templates are deterministic package APIs; their existence does not mean automatic multi-part anatomical inference is supported by this file-build profile.

## Evidence and boundaries

The Planner provider is a structured proposal port and the current Critic is numeric. Neither proves live vision-model accuracy. Keep local engineering checks, official Runtime/editor round-trip, private artist comparison and independent reviewer approval separately labelled. Latest user authority controls the acceptance process; old workflow text does not override a newer decision. Do not silently lower thresholds, reuse artist answers, call a paid model or upload private images to obtain a green label.

Git publication, paid reviews, client registration and global skill installation are separate authorized actions, not side effects of building. Preserve unrelated changes; publish only an explicitly reviewed source allowlist. Do not claim quota monitoring or delayed continuation unless the product tool has actually saved that automation.

For workflow changes, consult [the architecture](../../ARCHITECTURE.md) and [per-Gate criteria](../../docs/GATE_5_17_AUTONOMOUS_PLAN.html). Keep the Core independent of this skill and MCP. [Decision cases](decision-cases.json) record reference operator choices and their real tool checks; they are not a trained intent classifier or independent model evaluation.
