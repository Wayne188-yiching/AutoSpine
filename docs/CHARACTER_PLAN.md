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

   The plan is linted first. `build-record.json` holds the joints, face mixes, IK bend sides, `setupDeviationPx` (must be ≤ 0.5), each QA seam's drift (≤ 11 px) and inversions (0), and the hashes of the plan and images-only file. The folder imports straight into Spine 4.0.64 (`images/` sits beside the JSON).

5. **Compare with the artist version** [`autospine_compare_reference`] when one exists:

   ```text
   node packages/cli/dist/index.js compare-reference work/plan.json work/build-1 artist.json work/compare-1
   ```

   It prints one PASS/FAIL line per criterion and exits 2 if any fails. Plan animations are loops, so the D1 critic uses phase-invariant chain metrics (ADR-020): `range:<probe>` and `lag:<probe>` replace peak time, overshoot and peak delay, and where the loop starts does not matter. `acceptance-results.json` has every measurement. In `compare-<animation>.png`, the top row is the artist version and the bottom row the build, at the same times.

6. **Tune motion** [`autospine_optimize_motion`] when D1/D2 fail. Run it in chunks:

   ```text
   node packages/cli/dist/index.js optimize-motion work/plan.json artist.json work/opt --budget=150
   ```

   | Exit | Meaning                                   | Next step                                                                 |
   | ---- | ----------------------------------------- | ------------------------------------------------------------------------- |
   | 0    | Passed (with margin, inside shrunk bands) | Build with `--params=work/opt/best-params.json`                           |
   | 3    | Paused at the budget                      | Run the same command again (it resumes)                                   |
   | 4    | Converged without passing                 | Rerun with `--seed=n`, widen `motion.search`, or change the motion blocks |

   Then build and compare again. The search only moves parameters listed in `motion.search`. Results tuned against the artist version are **benchmark-tuned**, not blind; say so when reporting.

7. **Hand off**: import into the Spine editor (A5) and get an artist's review (E). Numeric acceptance is not artistic approval.

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

### Bones

Bones are created in order, and a parent must come earlier.

- `{ id, parent?, at, to?, angle?, length? }`: a bone at joint `at` pointing to `to`, or at a fixed world `angle` (degrees, clockwise on screen; `-90` points up; `"art"` uses the plan's `artAngle`). `length` defaults to the distance to `to`.
- `{ chain: { part, bones, parent, from?, prefix? } }`: `bones` bones along the medial line of a strand image, from its `top` (default) or `bottom`, named `${prefix}_1…n`. `prefix` defaults to the part name. Use it for hair, tails, ribbons and sleeves.

### Face

`face: { head, anchor, base, control, counter?, counterMix?, followers, pinMargin? }` measures a dome on the head image around `anchor`. The `control` bone moves the face surface. `counter` follows with `counterMix` (default −0.3). Each follower bone (eyes, brows, mouth) gets a local relative Transform whose mix is the dome value at its origin. Pins hold rings around eye holes to their follower's mix over `pinMargin` × head width (default 0.12). See ADR-012/016.

`face.layers: [{ bone, depth }]` adds 2.5D depth outside the face plate (ADR-018). Each bone follows the control with mix = depth × the dome peak, clamped to −1..1:

- depth 1 is the face surface;
- above 1 is in front (bangs, a hat brim);
- 0 rides the head;
- below 0 is behind and moves against the turn (back hair, a ponytail root).

Give bangs or back hair their own bone so they can be a layer. A follower or layer whose parent is rotated against the control's parent gets an aligned carrier bone `<id>_frame`, so it moves in the control's direction.

### Meshes and regions

`meshes[]: { part, mesh, weights }`, processed in order:

| `mesh.type` | Options                                     | When                                                                                                   |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `feature`   | `spacing`, `edgeLength`, `minHoleFraction`  | Faces and anything with cut-outs (eye holes, windows)                                                  |
| `contour`   | `intent` (chain/rigid/unknown), `cleanup[]` | Most limbs and clothing; `cleanup` lists alpha-repair budgets tried in order (default 0.03, 0.1, 0.25) |
| `surface`   | `cols`, `rows`                              | Thin strands and leafy parts; interior vertices bend without folding                                   |
| `quad`      | —                                           | Mouths, FX, sheared placements                                                                         |

| `weights.type` | Fields                                                  | Meaning                                                                                                     |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `chain`        | `bones[]` or `chain` (part), `blend?`                   | Joint-plane chain (ADR-014); blend width = `blend` (default 0.4) × the shorter adjacent bone                |
| `gradient`     | `from`, `to`                                            | Linear between two bone origins (ADR-015): torsos, eyelids, jaws                                            |
| `dome`         | —                                                       | Face dome with pins (needs `face`)                                                                          |
| `transfer`     | `sources[]`, `proxies?[{part, bone}]`, `maxInfluences?` | Copy from meshes planned **earlier** (ADR-013): glows, outlines, shadows; proxies stand in for region parts |
| `rigid`        | `bone`                                                  | Whole mesh on one bone                                                                                      |

`regions: { slot: bone }` puts region images rigidly on a bone. A sheared placement on a region slot becomes a rigid quad automatically. Every image needs a mesh (by key or slot) or a region bone, and lint reports any that has neither.

### Constraints

- `ik[]: { name, bones (1–2), target, mix?, bendPositive? }`: `"auto"` keeps the setup elbow side. The build also checks the setup on the official runtime and flips a bend that moves the setup by more than 2 px.
- `transform[]: { name, bones, target, mix*, local?, relative? }`: mixes are −1..1 and default to 0.

### Motion

All numbers can be `$param`, `-$param` or `=expression` (`=2*$lag`, `=($a+$b)/2`). `params` are the start values. `search` gives `{min, max, step, integer?, cyclic?}` for the parameters the optimizer may move; `cyclic` wraps modulo the cycle.

| Block                   | Shape                                                                               | Produces                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle`, `animations[]` | `{ name, frames, cycleScale? }`                                                     | `frames / cycle` repeats of the main cycle; `cycleScale[k]` scales cycle k's anticipation (a breath's depth)                                                                                                                                                              |
| `main`                  | `{ id, bone, channel, shape?, up?, down, hold?, rise?, depth, holdDepth?, eases? }` | `settle` (default): rest at 0, lift `rise` px at frame `up`, sink `depth` px at `down`, `depth + holdDepth` (default 1) at `down + hold`; needs 0 < up < down and down + hold < cycle. `breath`: rest at 0, `depth` px at `down` (usually half the cycle), sine both ways |
| `beats[]`               | `{ id, bone, channel, rest, up?, down?, hold?, scaleUp? }`                          | Values keyed on the main beats                                                                                                                                                                                                                                            |
| `sink[]`                | `legs` / `face` / `squash`                                                          | Derived from depth: thighs shorten and feet counter-scale (planted feet); the face slides `y` px at full depth with `x` as a ratio of it; a strand root shortens by `amount`                                                                                              |
| `follow[]`              | `{ id, bone, channel, gain \| travel + to, lag }`                                   | Rotation following the main vertical offset, `lag` frames later. `travel` with `to`: the `to` bone moves `travel` × the main's travel relative to `bone`; positive moves it with the main                                                                                 |
| `waves[]`               | `{ chain, amp, rootGain, peak, growth, step, rootLag?, rootGainScale? }`            | The chain root follows (lag 3 by default). Bone k swings `amp·(1 + growth·k)` per cycle, peaking `step` frames later per bone. Control ids are `<bone>_r`                                                                                                                 |
| `cycles[]`              | `{ id, bone, channel, amplitude, period, peak \| phase \| phaseFraction }`          | Sine on any channel; `period: "animation"` = one per animation                                                                                                                                                                                                            |
| `keyed[]`               | `{ id, bone, channel, rest, move?, keys: { anim: [{frame, value, ease}] } }`        | Explicit keys merged with the beats: props, light sweeps. With `move`, each key is a saccade: hold, then arrive `move` frames after `frame`; a loop ending away from `rest` gets a closing move                                                                           |
| `pulses[]`              | `{ id, slots, low, high, period, peak?, stagger? }`                                 | Slot alpha between `low` and `high` × setup alpha (sine at the extremes); `stagger` frames per further slot. `period` (frames, `cycle`, `animation`) must divide every animation                                                                                          |
| `colors[]`              | `{ id, slots, keys: { anim: [{frame, alpha?, color?, ease?}] } }`                   | Explicit slot colour keys: `alpha` × setup alpha, `color` replaces RGB; frame 0 defaults to setup and the loop closes on it                                                                                                                                               |

Eases: `linear`, `hold`, `ease`, `sine`, `out`, `in`, `drift`, or a curve. Every control id must be unique.

### QA and output

- `qa.seams: [[a, b]]`: mesh pairs measured for seam drift and inversions at `qa.at[animation]` seconds (default: half way).
- `qa.probes: { face, eyes, pupils, chain: [[name, part]], hand: [name, part] }`: parts sampled by the performance critic. The head width of `face` is the unit.
- `qa.deformExclude`: regular expressions for FX, glow and shadow parts that deformation QA ignores.
- `qa.view`: crop of the contact sheets, in Spine world units (y up).
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
- **Planted hands.** A hand holding or resting on something (a glass, a table, a tile, the forehead) barely moves with the body. Pin it with an IK constraint whose target bone hangs on that thing's bone (`root`, `head`); a `follow` makes it ride the breath. Give a free hand `travel` about 0.4.
- **Saccades.** Only 4 of 11 seen idles saccade; add `keyed` looks with `move` only when the brief asks for them.
- **Lights and glows.** Scene light layers that breathe or flicker need `pulses` or `colors`; bone motion alone leaves them static and costs motion recall (C2).
- **Benchmark tuning.** Parameters tuned against an artist version describe that version. They are a starting point for a similar character, not a blind result.
