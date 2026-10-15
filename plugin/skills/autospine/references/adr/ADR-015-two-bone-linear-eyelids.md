<!-- Generated from docs/adr/ADR-015-two-bone-linear-eyelids.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-015 — two-bone eyelids with a linear gradient

Context: v17 blinked by fading the closed-eye lid images in with per-frame alpha and squashing them with per-frame deform offsets: 241 lid deform keys and 1205 eye/lid colour keys in idle2. A name filter also skipped the right lid's deform entirely. The hand-made file uses two bones per lid: the top edge fixed, the bottom edge sliding up to open, so a blink is a few translate keys. A first smoothstep top-to-bottom gradient in the proof of concept folded 4016 triangles once the lid collapsed.

Decision: add `solveGradientWeights(mesh, rig, from, to)`. The `to` weight is the clamped projection onto the axis between the two bones' setup origins. The profile is linear on purpose. Pulling `to` back toward `from` by a fraction k of the span squashes the band uniformly to 1 − k and cannot fold before a full collapse, whereas a smoothstep (slope 1.5) folds once k passes 2/3. The same solver fits jaws, flaps and other hinge-free sliding parts.

In the reviewed build:

- Each lid gets a top bone on its opaque top edge and a bottom bone on its opaque bottom edge. Both are world-aligned children of `eye_white`.
- Lid controls in the pose table are authored in measured lid heights. Open is −0.9, collapsed to a tenth.
- Lids are shown only while they cover the eye (blinks and the look-down droop), from the first frame after they start moving; the collapsed open state would otherwise read as a dark band.
- The eye assembly (whites, pupils, lids) rides `eye_white` as one rigid unit with the dome-derived follow mix, as the hand-made file does. Only the face base and bandage take dome weights (ADR-012).
  - With dome-weighted eye whites, the rigid lids strayed up to 17.7 px from them at closed frames, because the dome value varies across one eye from 0.31 to 0.66.
  - With the rigid assembly they stay together exactly. The sockets now slide slightly over the oversized eye whites, which showed no gaps in close-up renders.

Evidence: `tests/gradient-weights.test.ts` checks the linear ramp at known points; a 90 % collapse with no folds and a 0.1 minimum area ratio, where the smoothstep profile folds; and the error codes.

In the local mummy-cat build:

- The idle2 blinks and droop take 26 bone keys and no deform keys.
- Lid vertices pinned to the eye whites stray 0 px at the closed frames, before and after a Spine 4.0.64 editor import/export.
- idle2 has 0 triangle flips.
- Face metrics stay near the hand-made file: face shift 0.068 / 0.060 head widths against 0.061 / 0.056, and pupil range 0.086 against 0.115.

Consequences: blinks and droops are ordinary pose-table keys on one bone per lid. A lid shape that must bend along its edge (for example a curved squint) would need more than two bones. Rollback: remove the module and its export.
