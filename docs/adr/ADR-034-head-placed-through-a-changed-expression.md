# ADR-034 — a head placed through a changed expression

Context: ADR-033 fits key poses from pictures. On the ThreePigWC wolf `Win` (in sample), the head was not placed on frames 8, 14 and 44, so the head tilt, the point of the animation, was not captured. A probe of the matching against the artist's own head placement (the `Face` bone) showed:

- The search already lands near the artist's head turn: −9.0°, 6.75° and 17.5° against −9.5°, 6.0° and 17.6°. The bone's score, 0.25–0.31, stays below `minScore` (0.35), so the turn is thrown away.
- A part was scored over all its texels, but the head's parts lie under one another. At the right placement on the rest frame, the ears scored 0.24–0.26 and the fur 0.41, because about half their texels are under other parts.
- The head's 13 face parts (mouth, teeth, tongue, eyes, pupils, brows, nose, face plate) change their drawing with the expression, and mostly score below 0.3 there. Each part had an equal say, so they outweigh the fur and ears.
- `--ignore` of the face parts placed the head on frame 14 only.

Decision:

- **Shown texels.** Before matching a picture, the build is rendered at its pose on that frame (the official runtime pose, the same textures, the reference's size). Each sampled texel counts as much as that picture shows it in its own colour. A texel under another part counts for nothing, since it cannot match in the reference either.
  - A part's score is its match over the texels it shows, and its say is those texels (still at most 400 sampled).
  - The search ranks placements by this weighted mean over all the bone's parts. Otherwise it is unchanged.
- **The better half.** A bone is accepted when the better-matching half of its say scores at least `minScore`. The parts are sorted by score and counted until half the say is reached; the last part counts in part.
  - Changed parts that hold up to half the say do not lower the score: the parts that kept their drawing decide. Changed parts can hold more when the rest match well, as in the fixture test below.
  - Changed parts still score below 0.6 × `minScore` and stay out of the solve, listed as `unused`, as before.
  - A one-part bone is judged on that part, and a two-part bone on its better part. This needs the shown texels: by plain texel counts, the wolf's chest would pass on its body part (0.37–0.44), whose matches lie under other parts. On the texels it shows, it scores about 0.2.
- `minScore`, the part limit, `coverage`, `zeroFrame`, `ignore` and `maxRotate` are unchanged.
- Tried and not kept:
  - The shown texels alone: of frames 8, 14 and 44, the wolf's head is placed on 14 only; D1 9/16.
  - The better half also ranking the search: about the same heads (−10.8°, 7.0°, 17.8°), D1 9/16.

Evidence:

- `tests/character-keyposes.test.ts`, new fixture test:
  - The fixture's head gets five face parts (eyes, brows, nose, mouth, cheeks). The picture turns the head 12° on frame 30 and redraws every face part.
  - The head comes back at 12.9° (the 1° overshoot is ADR-033's body-gradient limit), and exactly the five face parts are `unused`.
  - Both the old scoring and the shown texels alone reject that picture (coverage 0.44, head not placed).
- The rest-pose tests (`character-restpose`) and the other key-pose tests pass unchanged.
- **ThreePigWC wolf `Win`, in sample** (local `docs/local-reviews/blind-tests/2026-10-14-batch/wolf3p/insample-keyposes`; `sh run.sh` also prints the head report against `before-adr034/`, the ADR-033 run):

  | Build                                 | Head placed on 8 / 14 / 44 | Pictures used | Head tilt off artist (RMS) | Total | B2      | D1    | D2    |
  | ------------------------------------- | -------------------------- | ------------- | -------------------------- | ----- | ------- | ----- | ----- |
  | Key poses 8, 14, 44, 52, 60 — ADR-033 | no / no / no               | 3 of 5        | 10.3°                      | 10/11 | 26.0 px | 13/16 | 0.914 |
  | The same — ADR-034                    | −6.3° / 7.0° / 15.5°       | 5 of 5        | 1.2°                       | 10/11 | 25.6 px | 10/16 | 0.914 |
  | Plus frame 0 as zero — ADR-033        | no / no / no               | 3 of 5        | 10.6°                      | 10/11 | 22.6 px | 11/16 | 0.914 |
  | The same — ADR-034                    | −6.3° / 7.0° / 15.5°       | 5 of 5        | 1.1°                       | 10/11 | 26.1 px | 10/16 | 0.914 |
  | Zero, fitted a second time — ADR-033  |                            |               |                            | 8/11  | 19.0 px | 12/16 | 0.943 |
  | The same — ADR-034                    |                            |               |                            | 9/11  | 26.1 px | 11/16 | 0.943 |

  The head turns are world degrees, counter-clockwise, over the build's pose on that frame. The tilt is the head bone's world rotation from frame 0 against the artist's `Face` bone, over frames 0, 8, 14, 20, 30, 44, 52, 60.

  - The head's world tilt over frames 0–60 now follows the artist's: −8.5°, 6.4°, 7.0°, 9.8°, 14.3°, 9.0° on frames 8, 14, 20, 30, 44, 52, against −9.7°, 5.3°, 8.4°, 10.4°, 16.3°, 10.0°. Before, it turned the wrong way until frame 52 (−0.5° to −4.5°).
  - The head drawing's path from frame 0 is 5.3 px off the artist's on average, against 11.8 px before.
  - On frame 44, the fur, one ear, the face plate, the brows, one eye, the mouth and the lower teeth place the head. Left `unused`: the other ear, the tongue, the upper teeth, the other eye, the pupils and the nose.
  - The shown texels also remove the pants' 9° misfit that `--zero` corrected in ADR-033: the spine's matched turn on the rest picture is −1.0° instead of −9.25°, and the zero picture covers 1.0 instead of 0.824. The chest's shirt now matches on every picture.
  - Against `kp`, D1 loses three items, none of them the head (head peak time and overshoot still pass). With the zero, it loses the first two and gains the parallax hold.
    - Key density, 3.30 (was 2.33; artist 2.07, upper limit 3.11): five key poses instead of three. ADR-033's `kp-zero-55`, which took frames 8 and 14 at coverage 0.55, had the same 3.30.
    - Pupil holds, 0.533 (was 0.733; lower limit 0.55): measured as the pupil's offset from the eye on screen, which moves while the head turns.
    - The body's overshoot, 0.147 (was 0.149; lower limit 0.149).
  - B2 stays failed on the same seam, the right shoulder (`Cloth_01/Arm1_1`, ADR-033): 25.6–26.1 px, against 22.6–26.0 px before. More pictures now lean the torso while the hands stay. The second pass no longer flips the right upper arm (B1).
  - The neck and head still turn against each other where the head moves sideways: on frame 14 the neck turns 12.6° and the head −23.9° (plan units). The artist moves its `Face` bone; our neck only turns, so the solve carries the head over with the neck and turns it back. The head's world tilt stays within 2° of the artist's on every key frame.

Consequences:

- A changed expression no longer hides a head's turn: the face parts that changed are listed `unused`, and the rest place the head. `--ignore` is rarely needed.
- Every pose fit, rest poses included, scores a part on the texels it shows. A part under others (the wolf's pants and chest) no longer drags its bone. Rest-pose fits of real characters may change. The fixture's do not.
- Each picture costs one render of the build. The wolf's six pictures fitted in 32 s (about 40 s before).
- A bone whose changed parts outweigh what still matches is still not placed. The expression itself (deforms, swaps, a tongue) is still not fitted.
- More pictures are accepted, so more keys: the summed tracks exceed the artist's key density on the wolf. Thinning the key-pose layer is a follow-up.
- Rollback: drop the shown weights and the better-half score; the search and acceptance return to the plain mean.
