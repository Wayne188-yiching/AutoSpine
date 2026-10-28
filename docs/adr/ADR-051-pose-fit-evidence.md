# ADR-051 — visible evidence and actual controls in pose fitting

Status: Accepted
Date: 2026-10-28 (plugin 0.5.17)

## Context

A source-level study of rig-c/core, Rev2D, OCS, Spine Animation AI and spine-mcp-server
found useful patterns around deterministic geometry, visible-only matching and explicit refusals.
AutoSpine already has its own deterministic core, frozen visibility samples, mesh QA, video
comparison and editable Spine delivery. Replacing these with another engine would lose working
behavior. The useful change is to strengthen evidence in the existing reference fitter.

Three reproducible gaps were found in the working tree at the start of this task:

- Two weighted meshes on root-parented slots were treated as one rigid group, although their
  nonzero vertex influences belong to independent movable bones. One part could be left behind.
- An 80 × 80 texture displayed as a 5-unit region contributed 1,600 apparent observations to
  a 120 × 120 picture although these occupied only 36 sampled screen pixels.
- A zero rotation span divided the ranking penalty by zero. Tracking with a zero span could
  also produce a zero-step loop. Refinement could escape the caller's translation window.

## Decision

- Resolve every positive-weight mesh influence through the official runtime to its nearest
  free ancestor. If all resolve to one control, use it. Ignore zero weights. Preserve a non-root
  slot's existing control hint when it contributes to a joint gradient. `owners` takes priority.
  Unresolved visible parts remain in the coverage denominator with `used: false` and a named
  `ambiguous-weighted-owner` or `no-free-owner` reason; no arbitrary majority vote is introduced.
- Add `bone` and `ownership` to each resolved part. Video fitting uses this actual owner for its
  tracking set, rather than reconstructing it from the slot bone.
- Keep the visibility mask frozen before candidate search. Within each part, count each visible
  sampled picture pixel at most once for the evidence minimum, coverage and shift statistics.
  Preserve the existing texture-space matching objective and solver target distribution: replacing
  those samples with one representative per pixel changed occluded tracking minima in regression.
  The existing 50-observation minimum now requires distinct sampled picture pixels; smaller parts
  are listed under `unobserved`. Coverage remains a diagnostic, not a measure of all the art.
- Ordinary search axes preserve the existing grid; a locked axis is exactly its seed. All
  refinements stay inside the caller's global window or the neighbour-frame tracking bounds.
  Zero spans have finite ranking penalties. Negative/non-finite spans raise `POSE_OPTIONS`.
- Keep Spine 4.0 compatibility, the existing solver, source documents and acceptance limits.

## Evidence

`tests/pose-fit-evidence.test.ts` exercises independent weighted parts, shared free ancestors,
ambiguous controls, explicit overrides, zero-weight influences, tiny picture evidence, missing
free controls, zero rotation, bounded refinement, locked tracking, determinism and invalid spans.
Existing rest-pose, key-picture and tracking tests are retained without loosening tolerances.

The before/after probes use the source snapshot saved at the start of this task, including the
user's existing uncommitted fixes. This is not a comparison with a pristine 0.5.16 release.
Inputs and results are in `docs/reports/competitor-study-20261028/`:

| Synthetic case                                  | Before                             | After                                         |
| ----------------------------------------------- | ---------------------------------- | --------------------------------------------- |
| Independent weighted parts, opposite 5 px moves | vertex RMS 3.5355 px; coverage 0.5 | RMS 0 px; coverage 1                          |
| Translation 8 px with rotation locked           | RMS 8 px; no fitted move           | RMS 0 px; translation 8 px                    |
| Tiny part occupying 36 sampled picture pixels   | reported fitted from 1,600 texels  | evidence insufficient; no fitted move claimed |

These verify mechanical cases, not artistic quality or unseen-character success rates. The
previous nine-clip results and pending artist approval are unchanged.

## Source provenance

See [the code study](../research/competitor-code-study-20261028.html) for pinned source links,
architecture explanations, licenses and the distinction between findings and adopted changes.
This implementation was written for AutoSpine; no external source was copied, no dependency was
added, no third-party image model was called, and no private art was uploaded. The noncommercial
Spine Animation AI source and spine-mcp-server's missing LICENSE were analyzed only.
