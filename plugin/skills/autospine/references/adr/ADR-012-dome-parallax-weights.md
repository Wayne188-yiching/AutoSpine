<!-- Generated from docs/adr/ADR-012-dome-parallax-weights.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-012 — dome (parallax) weights for layered faces

Context: the hand-made mummy-cat file turns its head with one face control bone. Face vertices are weighted to that control by about 0.6 in the middle, falling off toward the rim; the rim stays on the head and drifts slightly against the turn through a counter bone (Transform mix -0.3); and the eye whites follow the control with a 0.6 mix. v17 instead used a 7×7 grid on two bones that was effectively rigid, faking the turn with per-frame deform offsets of about 8 px. Its face shift across idle2 was 0.034 / 0.002 head widths, against 0.061 / 0.056 in the hand-made file.

Decision: add `packages/weights/src/dome.ts`:

- `measureDomeField` builds the field from pixels. Radii are twice the alpha standard deviation (exact for a filled ellipse). The centre is the alpha centroid or a supplied feature anchor such as the eye whites' centroid. Defaults are peak 0.7 and counter 0.1. It takes a plain alpha array and a pixel-to-world affine, so the weights package gains no assets dependency.
- `solveDomeWeights` uses the normalized ellipse radius r: control weight `peak · max(0, 1 − r²)`, counter weight `counter · smoothstep(0.55, 1.1, r)`, and the remainder on the base bone. At most three influences are produced, and the result passes the existing weight validation.
- `domeValue(field, point)` returns the control weight at a point. Use it as the follow mix of a rigid feature, such as a pupil bone, so it lands on the skinned surface exactly.
- `domeFoldLimit(field)` returns `radius / (2 · peak)` per axis: the control displacement at which the surface folds at the rim. A moving counter bone tightens it slightly.

Every mesh of one head layer (face base, bandage, eye whites, eyelids) uses the same field, so cut-outs and stacked layers move identically wherever they overlap. Wiring the bones and constraints stays with the caller: a world-aligned control and counter bone at the field centre, the counter following the control with mix -0.3, and rigid features following with `domeValue`.

Evidence: `tests/dome-weights.test.ts` covers the moments on a synthetic ellipse (including a rotated placement), exact weights at known radii, skinned displacement equal to the dome value (layers sharing a field stay aligned to 1e-12), no folds at 0.9× the fold limit with folds at 1.3×, and error codes. In a local review the v17 operator script was rerun with only these weights, the two bones, two constraints and the ADR-011 idle2. It measured the same field as the hand-tuned proof of concept (centre 2.9, −635.9; radii 350.2 × 283.8; eye mix 0.521; the hand-made file uses 0.6) and reached the same runtime metrics (face shift 0.060 / 0.053 head widths, pupil range 0.092) with 0 triangle flips and a 0.25 minimum area ratio. It imports and exports through the Spine 4.0.64 editor with at most 0.054 world px of geometry drift.

Consequences: the fold limit gives the motion side a numeric bound for the face control's travel. The field is an axis-aligned ellipse, so strongly tilted heads would need a rotated field. Feature-ring topology (eye sockets, muzzle) is not part of this decision; the evidence above used a 14 × 12 surface grid. Rollback: remove the module and its export.
