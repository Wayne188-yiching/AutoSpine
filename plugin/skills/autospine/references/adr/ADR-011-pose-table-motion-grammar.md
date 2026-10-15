<!-- Generated from docs/adr/ADR-011-pose-table-motion-grammar.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-011 — pose-table motion grammar

Context: with per-key curves (ADR-010) the IR can carry sparse, eased keys, but authoring still meant writing every key by hand. Generators fell back to 60fps sine waves: in mummy-cat v17 every part moved in phase, with no holds and no saccades, and the arms rose in step with the body (hand range relative to the body was 0.025 head widths; the hand-made file has 0.51).

Decision: add an outer authoring contract, `KeyposeSpec` (schemas, `$id` `KeyposeSpec-0.1`), and `buildKeyposeAnimation(rig, spec)` in `@autospine/motion`. Like `BuildJob`, the spec is not part of the IR registry. It compiles to a validated AnimationSpec.

- **Grid and controls.** Times are integer frames on the spec's `fps` grid. A control binds one bone channel (rotate/translate/scale) with an optional `unit` (degrees or pixels per authored unit, such as a measured head width) and, for translation, `space`. `"world"` means IR image axes at setup; offsets are converted through the parent's inverse setup frame.
- **Beats.** The beat table sets primary poses. Each beat's `ease` (named: linear, hold, ease, sine, out, in, drift; or a raw key curve) describes how the pose is reached, so it becomes the curve of the previous key. In a loop the first beat's ease closes the seam.
- **Rules.** Rules derive the secondary timing:
  - `follow`: delay chain, overlap, mirrored side. The source's offset from rest is shifted by an integer lag and scaled per channel, or one component of a vector source is read.
  - `saccade`: jump to the source's next pose within `move` frames, hold, optionally lead.
  - `settle`: hold a dragged pose until `start`, travel, overshoot relative to the travel, then decay by `damping` every `period` frames.
  - `cycle`: oscillation keyed only at its extremes.
- **One driver per control.** Every control is driven exactly once (beats or one rule). Dependency cycles, double drivers, missing drivers, channel-count mismatches, settle in loops and cycle periods that do not divide a loop are rejected with `KEYPOSE_*` codes.

Shifting or cropping a curved segment uses an exact de Casteljau split renormalized to the IR's normalized handles. A follower therefore equals its source, delayed and scaled, to 1e-9, across a loop seam as well. If a sub-piece cannot be represented (no value change, or handles outside the IR bounds), it is flattened into ten exact samples, the same resolution Spine's runtime uses. Every authored-to-IR conversion is linear, so curves pass through unchanged.

Evidence: `tests/keyposes.test.ts`. In a local review, the hand-scripted mummy-cat proof of concept was re-expressed as two pose tables: idle2 with 45 beats and 23 rules, `in` with 1 beat and 27 rules. Spine runtime metrics match the hand-written keys: face shift 0.060/0.053 against 0.061/0.053 head widths, pupil range 0.092, the same hold fractions, and hand range relative to body 0.236 against 0.245. The output imports and exports through the Spine 4.0.64 editor; the editor only re-marks constant segments as stepped, and geometry differs by at most 0.73 world px after its two-decimal rounding.

Consequences: generators now write pose tables and rules, not keys. The primary beat timing is still an input from the caller (Skill or planner); choosing where those beats fall automatically is not part of this decision. Layering two motions on one channel is not supported; drive layers through separate bones. Rollback: remove the schema, the module and its export.
