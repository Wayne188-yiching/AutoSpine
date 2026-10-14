# ADR-029 — pose sets faded in, odd cycles

Context: the BuddhaEX_Awaken loops (2026-10 batch blind test) keep the dance and dig arms, the bag and the second face at alpha 0 in setup. The artist's animations fade them in with colour keys. The loops are also 29 frames long. Three things failed:

- An ADR-021 part set switched the attachment but left the slot transparent, so the build drew no arms, bag or face.
- The comparison could not measure the head unit on a transparent head (`REFERENCE_UNIT`).
- A 29-frame loop could not be planned: the plan's cycle and the keypose cycle period had to be even.

Decision:

- A slot an animation `show`s while setup keeps it transparent (alpha ≤ 5/255) is held opaque for that animation. Its pulses and colours scale from full alpha.
- `headUnit` measures a transparent head as drawn.
- The main `cycle` and `cycles` periods may be odd: extremes then fall on half frames, and Spine keys are in seconds.

Evidence: `tests/character-posesets-alpha.test.ts`.

- A transparent slot is hidden without `show` and drawn with it.
- The head unit of a transparent head is measured.
- An 82-frame animation of two 41-frame cycles closes its loop within 0.01 px.

Consequences:

- Pose sets that artists fade rather than switch now build.
- Rollback: drop the opaque hold, the transparent head unit and the odd periods.
