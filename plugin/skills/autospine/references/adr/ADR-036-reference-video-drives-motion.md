<!-- Generated from docs/adr/ADR-036-reference-video-drives-motion.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-036 — a reference video drives the motion

Status: Accepted; implemented 2026-10-17 with the deviations under Implementation. The judging window (decision 2) still needs the art lead's agreement.
Date: 2026-10-17

## Context

- ADR-034 compares a build with its reference video and reports; the requester chose then (2026-10-15) that a failure is only reported. On 2026-10-17 the requester asked for the other half: the video should drive the motion automatically. Frames are taken from the video, fitted with fit-pose, the character is rebuilt, and compare-video checks the result.
- The pieces exist separately:
  - Video decoding at the plan's fps and figure registration (`videoFrames`, `foregroundMask`, `registerMasks`), used by `compare-video` and by the uncommitted `review-video --reference-video` tiles.
  - Key poses fitted over the build's pose on a frame (`fitKeyPoses`, ADR-033).
  - The V1–V4 acceptance (ADR-034).
- **BlanketOfficeWorker Idle** (2026-10-16/17, `C:/Wayne/Spine/被窩上班族/AutoSpine/_work`) was made this way by hand: 9 plans, 7 builds, at least 5 video comparisons, about 250 lines of one-off Python. It showed:
  1. **Placement** was a custom scale and offset search (`align2.py`, `make_refs.py`). `compare-video` already registers the same way.
  2. **Fitting every frame works**: 96 of 96 frames accepted, coverage 0.896–0.949. Only the eye whites and pupils (an expression) went unused. `--window=60 --max-rotate=40` were tuned by hand.
  3. **Folding the loop broke it**: the fits were folded onto a 24-frame cycle (`fold.py`, Huber Fourier fit, 3 harmonics). The body bobs every ~5.75 frames, which does not divide 24, so the fold cancelled the bounce (1–2 px left of ~21 px). That build passed every row (V3 size 0.78) while visibly missing the bounce.
  4. **Tempo drift**: the generated clip speeds up. A fixed loop is in step for about 2 s and drifts up to 4 frames by the end. With the bounce restored, V2 (0.61 % / 1.42 %) and V3 (size 0.74) fail for that reason, not for the pose.
  5. **Redrawn parts**: the generated video draws longer legs, so fit-pose cannot match them. A flutter-kick model was fitted to the leg pixels by hand (`legfit.py`) and used at 1.4×.
  6. **Swaps**: the blink (biyan_1–4 on frames 16–21) was read from the video by eye.
  7. **Keys**: the 30 fps plan writes a key pose on every frame: 3,791 keys. Artists key an idle about every 20 frames (ADR-032).
  8. **fps**: the studio standard is 30 fps. The plan had to move off 24.

## Decision

One command, `fit-video`, runs the loop. It reuses the engines above. The new code is the glue: frames to pictures, period and fold, key reduction, rounds.

### Inputs

- The animation's `reference: { video, start, use? }` (ADR-034), or `--video` / `--start`. `plan.qa.view` and `motion.fps` are required (30 at the studio).
- `use` says what the video is for (decision 1):
  - `"check"` (the default) means compare only, as in ADR-034.
  - `"fit"` means follow it: `deliver` runs `fit-video` for that animation.
  - A generated clip that redraws the figure (the reindeer's Seedance run) stays `"check"`.
- CLI `fit-video <plan.json> <build-dir> <new-dir> [--animation=name] [--video=file] [--start=s] [--rounds=3] [--every=1] [--ignore=slot,...]`.
- MCP `autospine_fit_video` with workspace-local paths.
- Both write only into a new directory.
- Refused before any fitting (exit 2, with a hint):
  - The video has no plain background, or no figure (the ADR-034 checks).
  - The video is shorter than a one-shot, or shorter than two cycles of a loop.
  - The frame-0 fit covers less than 0.6: the video does not draw these images.

### Steps

1. **Frames to pictures.**
   - Decode from `start` at the plan's fps (`videoFrames`).
   - Register frame 0's figure on the build's frame 0 (bounds, then `registerMasks`), as `compare-video` does. The camera is assumed still, so the same placement serves every frame.
   - Write each frame as an RGBA PNG over `qa.view`, with alpha from `foregroundMask`.
   - One shared function replaces the two copies of this placement (`compareOneVideo`, `referenceTiles`).
2. **Base build.**
   - A copy of the plan with the fitted bones' guessed motion taken out: the main beat's depth is 0, and there are no `keyposes`.
   - Waves, cycles, follows and the face rig stay. fit-pose holds those bones fixed (ADR-025, ADR-033), so the video does not fit them.
   - Build it.
3. **Dense fit.**
   - `fitKeyPoses` on every frame (`--every=k` thins), with frame 0 as the zero frame.
   - The search window comes from the reference's own travel: the figure centroid's largest move from frame 0, plus 10 % of the figure height. The manual run set 60 by hand.
   - `maxRotate` is 40 by default, the manual value.
4. **Shape the tracks** from the dense offsets, per bone channel.
   - **Loop**:
     - Find the period from the fitted channels and the silhouette centroid: the first autocorrelation peak that every moving channel shares.
     - The loop length L is the smallest whole number of frames that holds a whole number of periods within 2 % stretch. For example, 5.75 at 24 fps gives 23, and 7.5 at 30 fps gives 15.
     - Fold onto L, and never onto a length the period does not divide. Use a robust Fourier fit (Huber, as in `fold.py`) over the first cycles whose autocorrelation stays above 0.8. Later cycles that drifted are left out, and the drift is reported.
   - **One-shot**: robust smoothing (median of 3, then the reduction below). Frame 0 and the last frame are kept.
   - **Key reduction** (no schema change):
     - `keyposes` share key frames across bones, and a bone missing from a key means no offset there (ADR-033). So all bones get one set of key frames.
     - Start with frame 0 and each channel's extremes.
     - Each segment's arrival ease is one curve for all bones. Use a named ease, or a raw key curve fitted by least squares over every channel's normalised segment.
     - Insert the worst frame until every channel is within 0.5° / 0.5 px.
     - Keys stay at least 2 frames apart, with at most 256 keys (the schema limit).
     - Cap (decision 3): at most twice the category's key density (ADR-032; an idle keys about every 20 frames). When the tolerance needs more keys than that, the tolerance is relaxed until the cap holds, and the error reached is reported.
     - Report keys per second against the category prior.
   - **Unfitted bones**: bones whose parts were unused in more than half the frames get no offsets, and their plan motion stays. The summary names them (for example, "legs redrawn in the video: not fitted").
5. **Build and compare.** Lint, build, then `compare-video` (ADR-034) with unchanged thresholds.
   - Loops are judged on the cycles the fold used (decision 2). A loop cannot follow a clip that speeds up, so frames past those cycles are not actionable.
   - `compare-video` gains a frame window for this. Whole-clip rows and the measured drift are still reported, as information.
   - One-shots are judged on the whole clip.
6. **Rounds 2…N** (3 in total by default), each on the previous round's build:
   - **Refit the bad frames**: refit only the frames whose part error is above the V2 median limit, add the new offsets (the fit is relative to the build's pose), then shape and reduce again. This needs per-frame part errors in `report.json`; today they are written only under `AUTOSPINE_DEBUG_TRACKS`.
   - **Chains and tufts** (decision 4): these stay procedural. Where `report.json` gives a part's amplitude and lag with correlation ≥ 0.6, divide the wave's amplitude by that part's amplitude ratio and shift its phase by the lag.
   - Where a chain's part is "moving differently" (correlation < 0.6), fit only the chain's root bone from the video. The root carries the whole strand's pixels; fitting every link zig-zagged by ±24° in ADR-025.
   - **Stop** when every row passes, when the penalty improves by less than 5 % twice in a row, or after N rounds.
7. **Pick and hand over.**
   - A round's penalty is the sum, over the rows, of how far each value is past its threshold, as a fraction of the threshold.
   - The round with the lowest penalty becomes `best/`.
   - Every round stays in `<new-dir>/round-k/{pictures/, plan.json, build/, compare/}`.
   - `summary.json` lists, per round: the rows, the keys, the drift, the unfitted parts and the hints.
   - The source plan is not changed.
   - Exit 0 when a round passes, 2 otherwise.

### Delivery and labels

- `deliver` follows each animation's `reference.use`:
  - `"fit"`: run `fit-video` first and deliver `best/`.
  - `"check"` (the default): compare and report only, the requester's 2026-10-15 choice.
- The skill: when the requester gives a reference video, use `fit-video` instead of the name templates. Key-pose pictures (ADR-033) remain for storyboards.
- Results fitted to a video are labelled **reference-fitted**, never blind.

## Not in this ADR (later phases)

- **Swaps** (blinks, mouths): for a slot with alternative images in the layout, pick per frame the image that matches the video best, compress the picks to runs, and write `swaps`. In the manual run this was the blink on frames 16–21.
- **Mirrored stretches** (ADR-035): `compare-video` already names them. Proposing a `mirror` block automatically comes later.
- **Scale and alpha**: character entries start at scale 0.48 and alpha 0.51 (ADR-032), and the pose fit has no scale channel.
- **Redrawn parts**: nothing automatic replaces the manual leg model. They are reported.
- **Time-warped comparison** (DTW): it would absorb drift, but it could also hide real timing errors, and V3 judges timing.
- **Per-bone key times**: a `keyposes` key would leave a missing bone interpolating instead of at zero offset. Fewer keys, but a schema change to ADR-033's semantics. Revisit if the density cap binds often. (ADR-040 keeps the shared frames and plays a bone's whole layer a few frames off them instead.)
- **Colour normalisation** of the video (H.264 shifts): only if frame-0 coverage turns out low on real clips. The manual clip covered 0.90–0.95 without it.
- **Camera moves and scenery backgrounds.**

## Alternatives

- **Pick a few key frames instead of fitting every frame** (the centroid's extremes, then the worst frames):
  - Pro: fewer fits.
  - Con: a picking rule to get right, while the manual run showed dense fitting is accepted on every frame.
  - Kept only as `--every=k`.
- **Solve bones directly from compare-video's part tracks**:
  - Pro: no pictures.
  - Con: a second solver beside fit-pose, and the tracks carry only part centres and turns.
- **Tune the plan's motion parameters with `optimize-motion` against the video rows**:
  - Pro: keeps the plan procedural and sparse.
  - Con: each evaluation is a full comparison (29–46 s on the reindeer), and parameters cannot make poses the plan does not have.
  - Possible later for V3 size alone, with a silhouette-only objective.

## Evidence planned

- **Units**:
  - The period of a 5.75-frame sine with 4 % drift gives L = 23, and the folded bounce keeps at least 95 % of its amplitude (the 2026-10-16 regression).
  - Shared-key reduction of three phase-shifted 150-frame sines stays within 0.5 and uses at most one key per 6 frames.
  - The penalty orders rounds as the rows do.
- **Fixture**:
  - Render a video from the fixture with known key poses and a bounce, on a plain background (as ADR-034's tests do). Starting from the unposed build, every row passes within 3 rounds, and the fitted bones come back within 1°.
  - Negative case: a video of other art stops at the coverage check (exit 2, with a hint) and runs no rounds.
- **Real cases**, labelled reference-fitted:
  - **BlanketOfficeWorker Idle** against the manual build-07 (V2 0.61 % / 1.42 %, V3 0.74, 3,791 keys, ~250 lines of scripts): the same or better rows with a tenth of the keys and no scripts, and the legs reported as redrawn.
  - **Red-robed reindeer Idle**: still passes every row.
  - **ThreePigWC wolf `Win`**, with the artist's render as the video (in sample): compare with ADR-033's five pictures (D1 13/16).
- The time per round is recorded.

## Consequences

- A reference video replaces the animation name as the motion source when the requester has one.
- Each run writes one PNG per frame per round, under its new directory only.
- The fit still cannot see expressions, mesh deforms, scale or redrawn parts. The summary names them, so the requester knows what is left to do by hand.
- This depends on the uncommitted `review-video --reference-video` change: its tile placement becomes the shared function.
- Rollback: drop `fit-video`, the MCP tool, `reference.use` and the compare window. ADR-034 then reports only, as before.

## Implementation (2026-10-17)

Code: `fitVideoFiles` (CLI `fit-video`, `packages/cli/src/character.ts`), MCP `autospine_fit_video`, `deliver` with `reference.use: "fit"`; the track maths in `@autospine/motion` (`video-tracks.ts`: `sharedPeriod`, `foldTracks`, `reduceKeys`, `cyclesIn`, `wholeCycleLength`, `keyGapPrior`); `videoPenalty` in `@autospine/reference`.

What the steps do, and where they differ from the design above:

- **Placement**: `placeOnVideo` is the one shared function; `compare-video` uses it. The uncommitted `review-video --reference-video` tiles should switch to it when they are committed (they are not in the repository).
- **Pictures** are written once to `pictures/` (they are the same every round), at the video's resolution up to 1024 px over `qa.view`. A loop reads at most three times its length of video; a one-shot its own frames.
- **Base**: depth 0, and also `rise` 0 and `holdDepth` 0 (a settle adds `holdDepth` px at the hold). The motion compiler now accepts a main without depth: the face slide and squash it derives are 0 (they divided by the depth).
- **The main bone is fitted** even when it hangs on the root: fit-pose holds the bones on the root fixed (a rest pose does not move the ground), but the base took the main's motion out, so the video must give it back. Without this the fixture's bob was not fitted at all.
- **Period**: lone bad frames are replaced by their neighbours' median and gaps bridged before the autocorrelation; the shared peak is the first that reaches 0.85 of the highest. The first two cycles give the starting tempo (a clip that speeds up starts slower than its mean); each later cycle joins while it is in step at the period so far, and every folded cycle stays in step at the refined period. Drift is followed cycle by cycle. No period over two cycles, and a clip as long as the loop: its first frames are taken as one loop (hinted). Shorter: refused.
- **Loop length**: the animation keeps the plan's length, since its cycle, waves and periods divide it. The fold is in phase on the real period, so a period that does not divide the length is never cancelled; the length holds `round(frames / period)` cycles, and the stretch is reported with the shortest length that holds whole cycles. That length uses a 1 % tolerance: with 2 % the design's own example, 5.75 frames, would give 17, not 23.
- **Key reduction**: the fewest shared key frames by dynamic programming over the frames (best named ease per segment), not worst-frame insertion; the cap is binding more often than the design expected, and insertion spent keys there. A channel's tolerance is 0.5 degree or px, or twice its own fit noise (the fold's robust residual) when that is larger. The cap is twice the category's key density (decision 3) or four keys a folded cycle, whichever allows more: an idle's 20-frame spacing cannot hold a 6-frame bounce. When the cap holds, the tolerance is relaxed until it fits and a segment still past it gets its own key curve; the error reached is reported in tolerances.
- **Rounds**: the bad frames are those whose median part error (`frameError`, now always in `report.json`) passes 0.6 % inside the judged frames. Waves are rescaled (ratio clamped to 0.25-4) and shifted by the part's lag when it correlates at 0.6; a chain whose part moves differently gets its root freed, and that round refits every frame. A round with nothing to refit and no wave to change ends the loop.
- **compare-video** gained `window` (judge only the first frames, the fold's cycles; `wholeRows` keeps the rest) and per-frame `frameError`; the hints say when a window was used.
- **deliver** fits each `use: "fit"` animation in turn, and delivers the last best build; a fit that cannot run is `fitError` and the build as given is delivered.
- Refusals (frame 0 covering under 0.6, a clip too short) are `CLI_FIT_VIDEO` (exit 2) or `MCP_FIT_VIDEO`, before any round.

Known limits, seen on the fixture:

- **Motion that only follows the main** is 0 in the base: sink scales (legs that shorten), the face slide, follows and wave roots driven by the main's offset. Fitted bones get it back from the video; fixed bones (the face rig, chains) and scales do not. The fixture's scale-sinking legs were bent instead of shortened. Feeding the fitted main track into the main control (ADR-033's follow-up) would cover these.
- **Spurious turns**: the fit can trade a degree of hips turn against the legs; under a tight cap that degree decides where the keys go.

## Evidence (produced)

- `tests/video-tracks.test.ts`:
  - A 5.75-frame bounce whose tempo rises 4 % over 96 frames: the period is found within 0.25 frame and at least 14 of its 16 cycles stay in step; the folded bounce keeps over 95 % of its height. 5.75 frames gives 23 (four cycles within 1 %), 7.5 gives 15; 24 frames hold 4 cycles at 4.35 % stretch.
  - A clip that speeds up 30 %: only the first cycles are folded, the bounce keeps over 90 %, and the last cycle is reported early.
  - A limb that swings once per two bobs moves the shared period to the stride; a drift gives no period.
  - Gaps and one 8x outlier: the period within 0.05 frame, and the fold within 0.6 of the true value.
  - Three phase-shifted 150-frame sines: within 0.5 on every frame, keys at least 2 frames apart and at most one per 6 frames. A step one-shot keeps its first and last frames; a cap of 3 binds and is reported.
- `tests/character-fit-video.test.ts` (fixture, value-noise art, 300 x 360 H.264 at 30 fps):
  - **Fitted idle**: the fixture plan guesses a settle cycle of depth 5; the video shows two loops of a 40-frame idle whose hips bob 3 px twice while the spine sways and the arm swings (key poses on frames 10, 20 and 30). Every other frame was fitted (`every: 2`, 41 pictures, all accepted; frame 0 covers 1.0). Period 40.09 over 2 folded cycles. **Round 1 passes**: V1 0.977 / 0.959, V2 0.22 % / 0.60 %, V3 lag 0 and size 0.90, V4 0. Four key frames (the cap: twice the idle density), 34 bone keys, within 2.1 tolerances; uncapped, six key frames would be within 0.95. The bones come back within 1.33 degrees and the hips within a pixel; the plan file is unchanged. About 65 s, nearly all of it the dense fit.
  - **Negative**: the same figure in inverted colours stops at frame 0 (`CLI_FIT_VIDEO`, exit 2; `MCP_FIT_VIDEO` without paths) and writes no round.
  - **deliver** with `use: "fit"` and no `qa.view`: `fitError`, and the build as given is delivered.
  - `videoPenalty` sums how far each row is past its threshold.
- **Not yet run**: BlanketOfficeWorker Idle, the red-robed reindeer Idle and the ThreePigWC wolf `Win`. Their files are on the requester's computer, not in the repository; those comparisons are still to be made there.

## Decisions (requester, 2026-10-17)

1. **Turning it on**: per animation in the plan, `reference.use: "fit" | "check"`, default `"check"`. This replaces the `--fit-reference` flag first proposed: one requester's videos can be meant to follow or only to compare.
2. **Tempo drift**: loops are judged on the fitted cycles, with whole-clip rows and drift reported as information; one-shots on the whole clip. Under the first proposal, BlanketOfficeWorker build-07 would fail forever for drift alone. This narrows ADR-034's acceptance window, so it still needs the art lead's agreement before it ships.
3. **Key density**: the tolerance (0.5° / 0.5 px) decides, capped at twice the category prior; when the cap binds, the error reached is reported.
4. **Chains**: procedural, corrected by the reported amplitude and lag; the chain's root is fitted from the video only where the part moves differently.

## Amendment (2026-10-21, plugin 0.5.9): when frame 0 is really off

Context: on the ThreePigWC wolf's Win (plugin-test-0.5.8, plan-05, build-02) fit-video said "frame 0 of the video is 30.0 degrees or px off the build's frame 0: fit the rest pose from it first", although the plan's Win rest pose was fitted and A6 passes on frame 0 (median 0.0098, p90 0.032 head widths against the artist, who rendered the video). The number was the largest offset of any bone in the zero frame's fit: `finger2_l` turned -30.05 degrees, the edge of a child's search (25 + 5 degrees). Four fingers per hand look alike in a 0.6 px-per-unit video, and the next offsets were fingers, a hand and forearms (8-19 degrees). That is the matching's own error, which the zero frame exists to take off the other frames (ADR-033); the body, spine, chest, neck and head were within 6 degrees and 4 units.

Decision:

- Each fitted part reports `shift`: the RMS distance of its texels from where the posed build draws them to where the picture shows them, world units.
- The zero frame's measure is `shifted`: the share of its matched parts, by texels, whose `shift` exceeds the V2 p90 limit (1.5 % of the figure height). Matching errors are a few parts on their own; a rest pose that is off moves whole limbs.
- The hint fires when `shifted` exceeds a quarter, and names the largest parts that moved: "frame 0 of the video draws N% of the matched parts (by area: ...) more than 1.5% of the figure height from the build's frame 0: its rest pose is off; ...".
- `summary.json` `zero` gives `shifted` and `largestOffset` (`{ bone, channel, value }`), in place of `offset`.

Evidence:

- Wolf Win zero frame, three rest poses (figure height 516 units, limit 7.7):
  - Plan-05 as fitted: `shifted` 0.12 (Arm2_1, matched 47 units away at score 0.355, and the look-alike Finger2_01). No hint; the largest offset is still `finger2_l` -30.05.
  - The same plan without its Win rest pose: 0.36. Arms turned 20 degrees off the fitted pose: 0.64. Both get the hint.
- `tests/character-restpose.test.ts`: the fixture with its spine turned 6 degrees and arm 10 degrees moves half the figure by area (0.50); fitted over a build already in that pose, nothing moves (every part under 1 unit).
- `tests/character-fit-video.test.ts`: the fitted idle (frame 0 is the build's pose) has `shifted` 0 and no frame-0 hint; a video whose rest pose has the spine turned 8 degrees and the arm 15 gets the hint, naming Body.
