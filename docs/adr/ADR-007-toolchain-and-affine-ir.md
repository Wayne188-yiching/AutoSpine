# ADR-007: A build job and affine IR for the first complete toolchain

Status: accepted for implementation by the owner's 2026-10-05 instruction to follow the development review and prioritize the complete tool architecture. This is not Gate or artistic acceptance.

BuildJob is an outer CLI/tool contract, not a ninth engine IR. It selects the explicit `chain-wave` slice with one PNG, a supplied chain, numeric motion parameters and a new output directory. Future MCP can call the same contract. No model or artist reference is required.

RigSpec 0.1 gains optional `scaleX`, `scaleY`, `shearX`, `shearY` with defaults 1, 1, 0, 0. These are neutral 2D local transform parameters in degrees, composed with Math.PI, not Spine inheritance modes or Spine numeric constants. Existing records remain valid. The new image-space pipeline uses x-right/y-down for mesh and rig; the weighted Spine adapter reflects y and angle exactly once. The existing minimal Spine adapter retains its older already-bone-local input contract.

`rig` owns FK and world-frame assembly, `weights` owns solving and skinning, `motion` owns timelines, and `pipeline` composes only neutral IR. `spine` alone serializes the target format. `cli` alone owns filesystem paths, image copying and atomic directory publication. Core remains a small schema facade. No production package imports experimental tools or private scoring data.

Old Gate prototypes and reference reports remain historical diagnostics. This slice does not retroactively pass the 164-case calibration or replace the separately recorded 23-case result. Blind generation and animation deformation diagnostics become the product path; explicit imported input must never be called AI-generated. Paid Jev and publication still require separate authorization.
