<!-- Generated from docs/adr/ADR-018-plan-colour-motion-and-face-depth-layers.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-018 — plan colour motion, 2.5D face depth layers and aligned face followers

Context: the BaShouEnn_03 end-to-end blind test (2026-10-13) built a whole character from images only and compared it with the hand-made file. It found three gaps in `CharacterPlan-0.1` (ADR-017):

- **Colour motion.** The artist animates 17 additive light layers by transparency: bar, floor, AC and chair glows, light ramps and blurs. The plan's motion blocks only key bone rotation, translation and scale. Motion recall (C2) was therefore 0.73 against a threshold of 0.8.
- **2.5D layers.** The face dome (ADR-012) drives followers that sit on the face plate, but nothing else on the head. Bangs, back hair, the ponytail root and headwear stayed rigid with the head, so a face turn had no depth between layers.
- **Follower direction bug.** Followers copy the control's local translation through local, relative Transform constraints. Local values are only comparable between bones whose parents share an orientation. A follower hung on an upright head therefore moved 90° off the face control: on the synthetic fixture, a 12 px move to the right moved the eyes 8.4 px up. On BaShouEnn the critic measured horizontal parallax at about four times the artist band.

Decision:

- **`motion.pulses[]`** `{ id, slots, low, high, period, peak?, stagger? }`:
  - Each slot's alpha oscillates between `low` and `high` times its setup alpha, peaking at `peak`.
  - `stagger` delays each further slot, which gives a chase across lights.
  - Keys sit at the extremes with a sine curve between them; a partial edge segment stays linear.
  - `period` is a number of frames, `"cycle"` or `"animation"`, and must divide every animation, so the loop stays seamless.
- **`motion.colors[]`** `{ id, slots, keys: { anim: [{ frame, alpha?, color?, ease? }] } }`:
  - Explicit keys. `alpha` multiplies the setup alpha and `color` replaces the RGB.
  - A key's ease shapes the segment arriving at it, as with keypose beats.
  - Frame 0 defaults to the setup colour, and the loop closes on the first key.
- **Compilation and lint.**
  - Both blocks compile to the Spine adapter's existing `colorTimelines` (ADR-010 curves in rgba space). `animateCharacter` returns them and `compileCharacter` takes them, including in the CLI IK-flip pass and the optimizer.
  - Lint reports unknown slots, a slot coloured by two blocks, unknown animations and periods that do not divide an animation.
- **`face.layers[]`** `{ bone, depth }` (depth −2..2):
  - Each bone follows the face control with mix = depth × the measured dome peak, clamped to −1..1.
  - Depth 1 is the face surface at its centre; above 1 is in front (bangs, a hat brim); 0 rides the head rigidly; below 0 is behind and moves against the turn (back hair, a ponytail root, the far ear).
  - Lint rejects a layer that repeats a face bone or follower, or names an unknown bone.
- **Aligned carriers.**
  - Every follower or layer whose parent is rotated against the control's parent gets a carrier bone `<id>_frame`, aligned with the control's parent, at its own origin. The follower keeps its world setup and now translates in the control's frame.
  - This changes the bone count of plans whose followers hang on a rotated parent; the synthetic fixture goes from 19 to 20 bones. Plans whose followers are already aligned are unchanged.

Evidence:

- **`tests/character-colors-layers.test.ts`.**
  - Pulse keys sit at the expected extremes per slot with the stagger. The loop closes, and the official runtime reads alphas 1.0 and 0.4 at the peak and trough.
  - Keyed colours start from setup and close on it.
  - Lint and build reject bad slots, periods and ranges.
  - Layer mixes are −0.28 (depth −0.4 × peak 0.7) and clamp to 1.
  - On the official runtime, with the body held still, a face turn moves the eyes parallel to the control (within 5°) by their dome mix, and a back layer against it at 0.28 of the control.
- **Existing suites** pass with the fixture's bone count updated: 57 files, 491 passed, 1 skipped.
- **BaShouEnn_03, in sample.** These results were already seen, so this is not validation.
  - Pulsing the scene's 17 additive light layers lifted motion recall from 0.73 to 1.0, with precision staying at 1.0. These are exactly the 17 slots the artist animates.
  - With the carrier fix, horizontal parallax moved from 0.0236 (band 0.0036–0.0082) to 0.0057.
  - The critic went from 1/16 to 2/16. The remaining misses are style: body peak timing and overshoot, eye saccades and hand range.

Consequences: lights, glows and flashes can be planned as data, and a head turn can move bangs, back hair and headwear at different depths. Existing plans with rotated follower parents rebuild with an extra carrier bone and corrected follower motion. Benchmark-tuned parameters fitted against the old behaviour (Yuuna F4) should be re-checked. Rollback: remove the two motion blocks, `face.layers` and the carrier step; followers then return to copying local values across frames.
