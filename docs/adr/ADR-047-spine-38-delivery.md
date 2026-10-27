# ADR-047 — delivering to Spine 3.8

Status: Accepted
Date: 2026-10-23 (plugin 0.5.13)
Amends: ADR-046 (newer editors)

## Context

Teams on Spine 3.8 asked for the same delivery as 4.1 and 4.2 (ADR-046). An older editor cannot open a 4.0 project, and the 4.0 JSON is not in a layout 3.8 reads:

- curves: 4.0 gives every channel absolute Bezier handles; 3.8 gives each key one curve as fractions of the segment (`curve`, `c2`, `c3`, `c4`), shared by its channels;
- rotate keys hold `value` in 4.0 and `angle` in 3.8;
- slot colours are `rgba` in 4.0 and `color` in 3.8;
- transform constraints and their keys use `mixRotate`, `mixX`, `mixY`, `mixScaleX`, `mixScaleY`, `mixShearY` in 4.0. 3.8 has `rotateMix`, one `translateMix`, one `scaleMix` and `shearMix`.

The rest of what AutoSpine writes reads the same: bones with `transform`, slots, skins with weighted meshes, IK, deform keys (under `deform` in both), attachment, draw order and event keys.

## Decision

- `deliver --spine-version=3.8` (or `3.8.99`) is accepted; below 3.8 stops with `CLI_SPINE_VERSION`. The launcher's `-u 3.8` picks the latest 3.8.
- `forEditorVersion(document, "3.8…")` writes the 3.8 layout:
  - Curves become one per key from the channels that change. A key-reduced file can ease x and y differently. Where the changing channels do not share one shape, the segment is written as linear keys every 1/30 s, exact at those times.
  - Deform curves become fractions of the segment, with their 0–1 values kept.
  - IK keys take their curve from mix and softness.
  - Transform constraints and keys are renamed, and their curve channels read from the 4.0 positions of mixRotate, mixX, mixScaleX and mixShearY.
- What 3.8 cannot hold stops with `SPINE_38_UNSUPPORTED`, naming it, instead of being dropped:
  - split `translatex` / `scalex` / `shearx` timelines;
  - `rgb`, `alpha`, `rgba2` and `rgb2` slot timelines;
  - path and physics constraints;
  - a separate x and y mix;
  - 4.1 `attachments` timelines.

  AutoSpine builds write none of these; an artist's file passed through key reduction could.

- The JSON delivered without Spine uses the same layout.

## Evidence

- `tests/character-deliver.test.ts`:
  - Versions: `3.8` and `3.8.99` accepted, `3.7.94` refused.
  - Shared shapes become one curve (rotate, translate, rgba, IK, transform keys). The transform key's y-mix curve, which 3.8 has no place for, does not count.
  - A stepped key stays stepped.
  - A scale with x eased in and out and y eased out becomes 31 linear keys, x 1.5 at half time.
  - Deform curve fractions; the transform constraint renamed; the input unchanged.
  - Split, alpha and separate-mix timelines stop with `SPINE_38_UNSUPPORTED`.
- **Round trip through the editors**: the 4.0 build, then `forEditorVersion(…, "3.8.99")`, then Spine 3.8.99 import, project, then Spine 4.0.64 opening that 3.8 project (the editor's own upgrade), then a JSON export. That JSON was played beside the original on the official 4.0 runtime, 4 samples a frame:
  - Panda (61 bones, 46 weighted meshes, colour, attachment and deform keys, five animations): world vertices, slot colours and attachments identical (difference 0).
  - The bundled example (Bezier curves on rotate, translate and scale, two transform constraints): largest vertex difference 0.045 units (Leg_R, frame 56), colours and attachments identical.
- Spine 3.8.99 also exported each project to JSON (`spine: 3.8.99`). Spine 4.0.64 refuses to import that 3.8 JSON ("Error reading animation"); it opens the 3.8 project.
- `deliver … --spine-version=3.8` delivered the example as a 3.8 project.
