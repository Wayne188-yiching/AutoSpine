# ADR-035 — a body mirrored for part of an animation

Context: the red-robed reindeer's Run follows a generated reference (`紅袍麋鹿國王_Seedance25_6秒小跳快走.mp4`). After the jump the clip turns the body the other way for the walk: the belly and tail change sides while the head keeps facing the same way. The art was drawn so that the body flipped left to right gives that walk. The plan had no way to say it: scale keys had to be positive, and a child always inherits its parents' reflection. The comparison (ADR-034) showed the body far from the reference on those frames (torso 8.7 % of the height) without saying why.

The requester's decision (2026-10-16): flip everything below the head on the walk's frames, arms and sceptre included (the sceptre changes hands for the walk), rather than re-rig the arms to stay on their sides.

Decision:

- **Plan**: `motion.animations[].mirror: { bone, keep?, frames: [[from, to], ...] }`.
  - `bone` and everything under it are flipped left to right on each range, inclusive. The flip switches on a range's first frame and back on the frame after its last.
  - A loop ends the way it started. A one-shot whose last range reaches its end stays flipped.
  - `keep` bones under it keep their drawing the right way round while they ride along: the head stays facing the same way where the flipped neck puts it.
- **Build** (on the compiled document, after the motion):
  - The bone gets a stepped scale timeline: three keys for one range. It is −1 on the bone axis that lies across the screen: x for a level bone, y for an upright one. A bone more than 5° from either is refused (`PLAN_MIRROR_BONE`), because a reflection along it would not be left to right.
  - A bone that already scales in that animation is refused (`PLAN_MIRROR_BONE`): mirror one without its own scale keys, such as the base.
  - Kept bones are set to `transform: noScaleOrReflection`. That holds in every animation, so a kept bone whose ancestor scales in any animation is refused (`PLAN_MIRROR_KEEP`): it would stop following that scale.
  - The handover notes give the frames, the bone and the kept bones.
- **Lint**: planned bones, kept bones under the mirrored one, and ranges that are ordered, inside the animation and neither overlapping nor touching.
- **Seam QA** runs on the motion before the mirror. A reflection moves a subtree rigidly, so seams inside it are unchanged; a seam between a kept bone and the flipped body is not measured, so check it in the video.
- **Sampling**: `frameTime` samples a microsecond after the frame. spine-core keeps key times as 32-bit floats, so `49 / 24` could land just before a stepped key on frame 49 and show the frame before it. Swaps had the same one-frame slip.
- **Comparison** (ADR-034): the part search also tries each part mirrored. `report.json` lists `mirrored`, the longest run of frames over which an asymmetric part showed mirrored (at least a tenth of the animation). A part is asymmetric when it matches its own mirror image below 0.8. The hints group parts flipped over the same frames: "drawn mirrored (left-right) in the reference on frames 49-130: ...".

Evidence:

- `tests/character-mirror.test.ts`:
  - Lint: unknown bone, a kept bone outside the subtree, a range past the end, a reversed range, touching ranges.
  - Fixture IDLE with `mirror: { bone: "hips", keep: ["head"], frames: [[20, 59]] }`. The upright hips get scale y −1 at 20/30 s and back at 60/30 s, and only the head is `noScaleOrReflection`.
  - On the official runtime, frames 5, 19, 60 and 79 are unchanged. On 20, 40 and 59, the thigh, foot, arm and spine are reflected about the hips' vertical line (positions within 0.001, determinant negative). The head and hair sit where the reflected neck puts them, with a positive determinant.
  - Refused: mirroring a thigh that scales in the legs' sink; keeping a foot under that thigh.
  - Handover notes name the frames and the bone.
- `tests/character-compare-video.test.ts`: a textured bar drawn mirrored is found `mirrored`; its mirror similarity is below 0.8; mirrored runs skip frames where the part was not found.
- **Red-robed reindeer** (plan-21 = plan-20 + `Run.mirror: { bone: "base", keep: ["head"], frames: [[49, 130]] }`). Rebuilt with this engine, plan-20 gives a byte-identical document to the reindeer session's build-20; plan-21 differs only by the mirror.
  - The comparison found the torso, collar, buttons and upper arm mirrored from about frame 49 to 130. The reference turns between its frames 48 and 51 and back between 128 and 132.
  - Against the reference, the torso's median error went from 8.65 % to 4.84 % of the height, the collar (bozi) from 7.06 % to 1.64 %, and the hand-on-hip upper arm from 8.14 % to 1.59 %.
  - The silhouette over the walk fell from 0.86 to 0.64, because the sceptre and arms change sides as decided while the reference keeps them. V1 and V2 still fail; V3 (lag 0, size 1.09) and V4 pass.
