# Character plans — reference and runbook

A character is an **images-only** Spine 4.0 document (every image placed on one root bone), its PNG folder, and a **plan**: one JSON file holding every character-specific decision. The engine turns plan + images into an editable Spine 4.0 project and, when an artist version exists, measures the result against it. Design and evidence: [ADR-017](adr/ADR-017-character-plans-and-reference-acceptance.md). Schema: `CharacterPlan-0.1` in `schemas/src/character-plan.ts`.

The steps below need no code changes and can be run by any model or person who can edit JSON and call the CLI (or the MCP tools in brackets).

## Runbook

Work on copies. Never write into original artwork folders or an open Spine project with unsaved edits.

1. **Images-only input.** From an artist project export (Spine 4.0 JSON), strip everything but placements:

   ```text
   node packages/cli/dist/index.js strip-images artist.json images/ work/imagesOnly.json
   ```

   This writes `imagesOnly.json` and `imagesOnly.strip-report.json`. Check that `summary.over2px` is empty (this is A1, ≤ 2 px). Sheared placements become 4-corner quads and are listed in `quadMeshForShear`. If there is no artist project, export the layered art to Spine as regions on the root bone; that document is the images-only input.

2. **Write the plan** next to it (`source.imagesOnly` and `source.images` are relative to the plan). Start from a working plan (the synthetic one in `tests/character-fixture.ts`, or a previous character) and edit the parts. Part names are the slot names, or `slot#attachment` for non-setup attachments.

3. **Lint until clean** [`autospine_lint_character_plan`]:

   ```text
   node packages/cli/dist/index.js lint-plan work/plan.json
   ```

   Exit 2 means errors. Each line names the block and the problem: unknown joint or part, parent planned later, an image with no mesh and no region bone, an unknown `$param`, a duplicate control id. Warnings flag unused parameters and start values outside their search range.

4. **Build** into a new folder [`autospine_build_character`]:

   ```text
   node packages/cli/dist/index.js build-character work/plan.json work/build-1 [--params=best-params.json]
   ```

   The plan is linted first. `build-record.json` holds the joints, face mixes, IK bend sides, `setupDeviationPx` (must be ≤ 0.5), each QA seam's drift (≤ 11 px) and inversions (0), and the hashes of the plan and images-only file. The folder imports straight into Spine 4.0.64 (`images/` sits beside the JSON). `HANDOVER.md` explains the file to whoever edits it next, and bones are coloured by role: main blue, control red, face followers orange, chains green (ADR-026).

5. **Compare with the artist version** [`autospine_compare_reference`] when one exists:

   ```text
   node packages/cli/dist/index.js compare-reference work/plan.json work/build-1 artist.json work/compare-1
   ```

   It prints one PASS/FAIL line per criterion and exits 2 if any fails. A1 counts the slots the artist's animations show; A6 compares frame 0 with the artist's (ADR-024). Plan animations are loops, so the D1 critic uses phase-invariant chain metrics (ADR-020): `range:<probe>` and `lag:<probe>` replace peak time, overshoot and peak delay, and where the loop starts does not matter. `acceptance-results.json` has every measurement. In `compare-<animation>.png`, the top row is the artist version and the bottom row the build, at the same times.

   **Rest pose (pose-layout setups).** When the setup stacks several pose sets and the animation starts elsewhere, fit the rest pose to a reference image of that pose (a PNG covering `qa.view`, any scale) [`autospine_fit_pose`]:

   ```text
   node packages/cli/dist/index.js fit-pose work/plan.json work/build-1 reference.png work/pose.json
   ```

   Copy its `pose` into `motion.animations[].pose` and build again. Check `coverage` (below about 0.6, do not use the pose), `residual` and the parts marked `used: false`. Only the hips and IK targets translate, chains follow their parents, and expressions are not fitted (ADR-024, ADR-025).

6. **Review video** [`autospine_review_video`]: one MP4 per plan, every animation first with the mesh wireframe, then with the bones, then the plain motion; artist | build when an artist file is given. Needs ffmpeg.

   ```text
   node packages/cli/dist/index.js review-video work/plan.json work/build-1 [artist.json] work/review.mp4
   ```

7. **Tune motion** [`autospine_optimize_motion`] when D1/D2 fail. Run it in chunks:

   ```text
   node packages/cli/dist/index.js optimize-motion work/plan.json artist.json work/opt --budget=150
   ```

   | Exit | Meaning                                   | Next step                                                                 |
   | ---- | ----------------------------------------- | ------------------------------------------------------------------------- |
   | 0    | Passed (with margin, inside shrunk bands) | Build with `--params=work/opt/best-params.json`                           |
   | 3    | Paused at the budget                      | Run the same command again (it resumes)                                   |
   | 4    | Converged without passing                 | Rerun with `--seed=n`, widen `motion.search`, or change the motion blocks |

   Then build and compare again. The search only moves parameters listed in `motion.search`. Results tuned against the artist version are **benchmark-tuned**, not blind; say so when reporting.

8. **Hand off**: import into the Spine editor (A5) and get an artist's review (E). Numeric acceptance is not artistic approval.

## Plan reference

### Joints

`joints` maps names to rules. A reference to another joint is its name or an inline rule. IR world is x right, y down, in pixels of the composed art.

| Rule         | Fields                                                  | Use for                                                                                 |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `centroid`   | `part`                                                  | Mean of the opaque pixels: face anchors, small props                                    |
| `center`     | `part`                                                  | Centre of the image rectangle (placement, not pixels)                                   |
| `overlap`    | `parts: [a, b]`                                         | Centroid of where both images are opaque: neck, waist, a hair root                      |
| `end`        | `part`, `dir: [x, y]`, `band?` (px)                     | Mean of pixels within `band` of the extreme along `dir`: crown, sole                    |
| `axisEnd`    | `part`, `pick` (top/bottom/left/right/near/far), `ref?` | One end of the principal axis: shoulder / hand of a limb image. `near`/`far` need `ref` |
| `lerp`       | `a`, `b`, `t` (−4..4)                                   | Elbow, knee, points along a segment                                                     |
| `project`    | `point`, `a`, `b`                                       | Projection onto a line                                                                  |
| `narrowest`  | `part`, `a`, `b`, `range: [from, to]`                   | Thinnest cross-section between fractions of a–b: wrist, ankle                           |
| `domeCenter` | —                                                       | Centre of the measured face dome (needs `face`)                                         |
| `point`      | `at: [x, y]`                                            | Scene anchors only; never for anatomy                                                   |

`axisEnd` needs an elongated part. A round part (a head, a ball) has no principal axis, so use `end` with a direction.

`align { x, y }` takes the x of one joint and the y of another, for example a hip under its leg at the pelvis height (ADR-025).

### Bones

Bones are created in order, and a parent must come earlier.

- `{ id, parent?, at, to?, angle?, length? }`: a bone at joint `at` pointing to `to`, or at a fixed world `angle` (degrees, clockwise on screen; `-90` points up; `"art"` uses the plan's `artAngle`). `length` defaults to the distance to `to`.
- `{ chain: { part, bones, parent, from?, near?, prefix? } }`: `bones` bones along the medial line of a strand image, from its `top` (default) or `bottom` (on a horizontal strand: left or right), or from the end nearest joint `near` (ADR-023), named `${prefix}_1…n`. `prefix` defaults to the part name. Use it for hair, tails, ribbons, sleeves, boughs and hanging ornaments.

### Face

`face: { head, anchor, base, control, counter?, counterMix?, followers, pinMargin? }` measures a dome on the head image around `anchor`. The `control` bone moves the face surface. `counter` follows with `counterMix` (default −0.3). Each follower bone (eyes, brows, mouth) gets a local relative Transform whose mix is the dome value at its origin. Pins hold rings around eye holes to their follower's mix over `pinMargin` × head width (default 0.12). See ADR-012/016.

`face.layers: [{ bone, depth }]` adds 2.5D depth outside the face plate (ADR-018). Each bone follows the control with mix = depth × the dome peak, clamped to −1..1:

- depth 1 is the face surface;
- above 1 is in front (bangs, a hat brim);
- 0 rides the head;
- below 0 is behind and moves against the turn (back hair, a ponytail root).

Give bangs or back hair their own bone so they can be a layer. A follower or layer whose parent is rotated against the control's parent gets an aligned carrier bone `<id>_frame`, so it moves in the control's direction.

### Skeleton template (ADR-025)

Every bone runs from its joint to the next one, so chains are continuous and the bones view reads like the body:

| Region                      | Bones                                                                                                                                                                                                   | Joints                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ground                      | `base` under the pelvis                                                                                                                                                                                 | `align(x: pelvis, y: feet)`                                                    |
| Hips and torso              | `body` (main) at the pelvis; `spine` pelvis → chest; `chest` chest → neck base                                                                                                                          | pelvis between the leg tops; chest halfway                                     |
| Neck and head               | `neck` neck base → neck top; `head` neck top → crown                                                                                                                                                    | part overlaps                                                                  |
| Legs                        | vertical `stance` ground → pelvis, squashed with `sink: { kind: "squash", bone: "stance", track: true }`; per leg `thigh` (hip → knee) and `calf` (knee → ankle) on it; `foot` (ankle → sole) on `base` | hip `align(x: leg top, y: pelvis)`; knee = leg/sock overlap; sole = lowest end |
| Arms                        | from `chest`: shoulder → elbow → wrist → hand; hands on the body pinned by IK to `body`                                                                                                                 | part overlaps and ends                                                         |
| Soft strands                | 3-bone chains from the attached end: hair, ears, moustache, beard, tail, mane                                                                                                                           | `chain.from` / `chain.near`                                                    |
| Ornaments sharing one image | one 3-bone chain each, from where it hangs to its far end; `nearest` weights over all of them                                                                                                           | `end` per side                                                                 |

Weights follow the bones: a robe or skirt over the legs takes a gradient `base` → `spine` (the stance squashes the legs over the same span), pants chain weights on thigh and calf, sock and shoe a gradient calf → foot, the neck chest → head. Mesh a deforming torso denser than the artist median.

### Meshes and regions

`meshes[]: { part, mesh, weights }`, processed in order:

| `mesh.type` | Options                                                                                             | When                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature`   | `spacing`, `edgeLength`, `minHoleFraction`, `density: "artist"`, `hullVertices`, `interiorVertices` | Faces and anything with cut-outs (eye holes, windows). `density: "artist"` gives artist vertex counts (ADR-024): hull round(√s), 6–40, interior 0 below s 100 else round(s / 80), s = √(width × height) |
| `contour`   | `intent` (chain/rigid/unknown), `cleanup[]`                                                         | Most limbs and clothing; `cleanup` lists alpha-repair budgets tried in order (default 0.03, 0.1, 0.25)                                                                                                  |
| `surface`   | `cols`, `rows`                                                                                      | Thin strands and leafy parts; interior vertices bend without folding                                                                                                                                    |
| `quad`      | —                                                                                                   | Mouths, FX, sheared placements                                                                                                                                                                          |

| `weights.type` | Fields                                                  | Meaning                                                                                                     |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `chain`        | `bones[]` or `chain` (part), `blend?`                   | Joint-plane chain (ADR-014); blend width = `blend` (default 0.4) × the shorter adjacent bone                |
| `gradient`     | `from`, `to`                                            | Linear between two bone origins (ADR-015): torsos, eyelids, jaws                                            |
| `dome`         | —                                                       | Face dome with pins (needs `face`)                                                                          |
| `transfer`     | `sources[]`, `proxies?[{part, bone}]`, `maxInfluences?` | Copy from meshes planned **earlier** (ADR-013): glows, outlines, shadows; proxies stand in for region parts |
| `rigid`        | `bone`                                                  | Whole mesh on one bone                                                                                      |
| `nearest`      | `bones[]`, `maxInfluences?`, `smoothing?`               | Inverse distance to the listed bones' segments, smoothed (ADR-023): leaf clusters and other blobs           |

`meshing: { all: true }` meshes every region part an animation shows at artist density, rigid to its region bone (ADR-024). Use it for every character: artists mesh every shown part.

`regions: { slot: bone }` puts region images rigidly on a bone. A sheared placement on a region slot becomes a rigid quad automatically. Every image needs a mesh (by key or slot) or a region bone, and lint reports any that has neither.

### Constraints

- `ik[]: { name, bones (1–2), target, mix?, bendPositive? }`: `"auto"` keeps the setup elbow side. The build also checks the setup on the official runtime and flips a bend that moves the setup by more than 2 px.
- `transform[]: { name, bones, target, mix*, local?, relative? }`: mixes are −1..1 and default to 0.

### Motion

All numbers can be `$param`, `-$param` or `=expression` (`=2*$lag`, `=($a+$b)/2`). `params` are the start values. `search` gives `{min, max, step, integer?, cyclic?}` for the parameters the optimizer may move; `cyclic` wraps modulo the cycle.

| Block                   | Shape                                                                               | Produces                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle`, `animations[]` | `{ name, frames, cycleScale?, show?, hide?, pose? }`                                | `frames / cycle` repeats of the main cycle; `cycleScale[k]` scales cycle k's anticipation (a breath's depth). `show` / `hide` switch part sets for the whole animation (ADR-021): `show` names a slot or `slot#attachment`, `hide` names slots. `pose: { bone: { x?, y?, rotate? } }` is a rest pose added to every key (ADR-024; parent frame, y down, clockwise degrees), usually from `fit-pose`                     |
| `main`                  | `{ id, bone, channel, shape?, up?, down, hold?, rise?, depth, holdDepth?, eases? }` | `settle` (default): rest at 0, lift `rise` px at frame `up`, sink `depth` px at `down`, `depth + holdDepth` (default 1) at `down + hold`; needs 0 < up < down and down + hold < cycle. `breath`: rest at 0, `depth` px at `down` (usually half the cycle), sine both ways                                                                                                                                               |
| `beats[]`               | `{ id, bone, channel, rest, up?, down?, hold?, scaleUp? }`                          | Values keyed on the main beats                                                                                                                                                                                                                                                                                                                                                                                          |
| `sink[]`                | `legs` / `face` / `squash`                                                          | Derived from depth: thighs shorten and feet counter-scale (planted feet); the face slides `y` px at full depth, or `parallax` head widths of eye travel against the face plate (ADR-022, the engine derives the slide), with `x` as a ratio of it and an optional `move` that holds the face between beats; a strand root shortens by `amount`, or with `track: true` its tip follows the main (a stance bone, ADR-025) |
| `follow[]`              | `{ id, bone, channel, gain \| travel + to, lag }`                                   | Rotation following the main vertical offset, `lag` frames later. `travel` with `to`: the `to` bone moves `travel` × the main's travel relative to `bone`; positive moves it with the main                                                                                                                                                                                                                               |
| `waves[]`               | `{ chain, amp, rootGain, peak, growth, step, rootLag?, rootGainScale? }`            | The chain root follows (lag 3 by default). Bone k swings `amp·(1 + growth·k)` per cycle, peaking `step` frames later per bone. Control ids are `<bone>_r`                                                                                                                                                                                                                                                               |
| `cycles[]`              | `{ id, bone, channel, amplitude, period, peak \| phase \| phaseFraction }`          | Sine on any channel; `period: "animation"` = one per animation                                                                                                                                                                                                                                                                                                                                                          |
| `keyed[]`               | `{ id, bone, channel, rest, move?, keys: { anim: [{frame, value, ease}] } }`        | Explicit keys merged with the beats: props, light sweeps. With `move`, each key is a saccade: hold, then arrive `move` frames after `frame`; a loop ending away from `rest` gets a closing move                                                                                                                                                                                                                         |
| `pulses[]`              | `{ id, slots, low, high, period, peak?, stagger? }`                                 | Slot alpha between `low` and `high` × setup alpha (sine at the extremes); `stagger` frames per further slot. `period` (frames, `cycle`, `animation`) must divide every animation                                                                                                                                                                                                                                        |
| `swaps[]`               | `{ slot, keys: { anim: [{frame, attachment \| null}] } }`                           | Attachment switches inside an animation (ADR-027): blinks, mouth shapes; the slot keeps its part-set or setup attachment before the first key; the loop closes on the frame-0 attachment                                                                                                                                                                                                                                |
| `colors[]`              | `{ id, slots, keys: { anim: [{frame, alpha?, color?, ease?}] } }`                   | Explicit slot colour keys: `alpha` × setup alpha, `color` replaces RGB; frame 0 defaults to setup and the loop closes on it                                                                                                                                                                                                                                                                                             |

Eases: `linear`, `hold`, `ease`, `sine`, `out`, `in`, `drift`, or a curve. Every control id must be unique.

### QA and output

- `qa.seams: [[a, b]]`: mesh pairs measured for seam drift (against frame 0, along the visible seam: the later-drawn part's outline over the other, ADR-025) and inversions at `qa.at[animation]` seconds (default: half way).
- `qa.probes: { face, eyes, pupils, chain: [[name, part]], hand: [name, part] }`: parts sampled by the performance critic. The head width of `face` is the unit.
- `qa.deformExclude`: regular expressions for FX, glow and shadow parts that deformation QA ignores.
- `qa.view`: crop of the contact sheets, review videos and `fit-pose` references, in Spine world units (y up).
- `output.imagesPath`: the image folder written into the skeleton (default `./images/`).

## Pitfalls seen so far

- **Round parts and `axisEnd`.** The axis is arbitrary on round parts, and the joint lands off-centre. Use `end` with a direction.
- **Thin strands and contour meshes.** A contour mesh on a narrow strand has no interior vertices and can fold when the chain bends. Use `surface` (for example 2 × 10).
- **IK bend.** Spine's bend side flips when the setup elbow is nearly straight. `"auto"` plus the runtime check handles it; `build-record.json` records which side was used.
- **Transfer order.** Transfer sources must be meshed earlier in `meshes`.
- **Main timing.** The main beats must fit inside the cycle. Every animation's `frames` should be a whole number of cycles, otherwise the loop seam (A4) breaks.
- **FX in deformation QA.** Glows and shadows stretch by design, so list them in `deformExclude`; otherwise B3 compares them with the artist's character stretch.
- **Optimizer margin.** The optimizer searches inside bands shrunk by 5 %, so its own critic count is lower than the official one. Use `--band-shrink=0` to read the official count.
- **Idle shape.** Artist idles are symmetric breaths (10 of 11 seen idles, including the YoLu blind test): use `shape: "breath"` with `down` at half the cycle. The settle template's anticipation and hold put the beats in the wrong place for an idle. Artists may start a loop mid-breath; that phase cannot be read from the images.
- **Planted hands and held props.** A hand resting on scenery or on the body (a bar, a table, the floor, the forehead) barely moves with the body: pin it with an IK constraint whose target bone hangs on that thing's bone (`root`, `head`). A prop the character holds (a cane, a cup, a fan) is part of the hand: hang it on the hand bone so it rides with the hand, and treat the hand as free unless the prop also rests on scenery (a glass on a bar). Give a free hand `travel` about 0.4 (the range across characters is wide).
- **Props.** Rigid regions can pass the numbers but not the review video. Give trunks and boughs chains (`chain.near` the trunk top for boughs), leaf clusters an inner-end root plus four short control bones with `nearest` weights, hanging ornaments chains parented to their bough, and glows transfer weights (ADR-023).
- **Pose sets.** Check which slots each animation shows before planning: an animation may hide the setup pose and show a set that is hidden in setup. Rig that set (a hidden slot with one attachment can be named by its slot) and switch it with `show` / `hide`. Planning the setup set for such an animation leaves recall at 0.
- **Face slide.** Plan the face by `parallax` (head widths), not `y` px: the same slide gives 0.33–0.6 of it in eye parallax depending on the dome, and px rules overshot 1.8–2.7× on unseen characters. Start at the artists' median, 0.03 with `x` 0.2. Add `move` only when the face should hold between breaths (3 of 12 seen idles).
- **Saccades.** Only 4 of 11 seen idles saccade; add `keyed` looks with `move` only when the brief asks for them.
- **Lights and glows.** Scene light layers that breathe or flicker need `pulses` or `colors`; bone motion alone leaves them static and costs motion recall (C2).
- **Pose layouts.** A setup that stacks pose sets may not be any animation's pose (HorseYearFish: the idle's head sits half a head width left). Ask for a picture of the rest pose and run `fit-pose`; A6 checks it.
- **Legs under a robe.** Shortening each thigh along its axis (`sink.legs`) slides splayed feet inward. Put the legs on a vertical stance bone squashed with `track: true`, feet on the ground bone, and weight the robe `base` → `spine` (ADR-025).
- **Bridging meshes.** A mesh across a bending joint hangs between the bones outside that joint: the neck from spine to head, a robe from base to spine. Weighted to the joint's own bone, its hidden end swings and opens the seam.
- **Soft strands.** Artists give a forelock, moustache, beard, ears and tassels 3-bone chains on artist-density contours, and wave the forelock and moustaches a little in idles. A rectangle grid (`surface`) reads as unfinished in the wireframe; prefer `feature` with `density: "artist"` and chain weights.
- **Benchmark tuning.** Parameters tuned against an artist version describe that version. They are a starting point for a similar character, not a blind result.
