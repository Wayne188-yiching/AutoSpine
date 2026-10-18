# ADR-039 — tracked video fit, stray fragments and input provenance

Status: Accepted
Date: 2026-10-18

## Context

A Pig run with only the images and the reference videos (2026-10-18, by Codex on the requester's computer; its improvement plan `video-only-improvement-plan-20261018.html`) did not get past the idle:

- **Stray fragments.** The PNGs hold slivers of neighbouring images, and they were drawn once the artist's meshes were gone.
- **Wrong matches turned into turns.** The idle showed the head and body flipped and parts apart: V1 mean 0.547, minimum 0.426, and the motion 1.96 times the reference's size.

The code explains both:

- **Fragments.** ADR-038 made the artist budget the default for planned `feature` meshes. A budget hull joined every detached piece of at least 0.1 % of the opaque pixels into one outline with 3 px bridges (ADR-024: two eyes on one image). The fine lattice it replaced kept the main piece and dropped detached pieces up to 2 %. So from plugin 0.5.0 a sliver at the edge of a picture was meshed and drawn.
- **Matches.** fit-video (ADR-036) fitted every frame alone, from the plan's pose on that frame. Each bone's parts were searched over the whole window (the figure's travel plus a tenth of its height) and up to 40 degrees by colour, with a slight preference for the smaller move. Nothing tied a frame to the one before. A look-alike nearer the plan's pose (the other leg, a similar colour, a part drawn over another) took the part on that frame. The fit turned the bone to reach it, and despiking and folding could not undo several such frames in a row.

Codex also proposed segmentation and optical-flow models (SAM 2, OpenCV), turnarounds and expressions. Those wait until a tracked idle has been measured on the Pig.

## Decision

### 1. Stray fragments

A budget hull first keeps the main piece and drops detached pieces up to 2 % of the opaque pixels, as the fine lattice does. Only when more would be lost (two eyes, fur tufts) are the pieces bridged into one outline as before. `generateFeatureMesh` returns `discarded` (opaque pixels left out), and a planned part with any appears in the build evidence as `<part>:alphaPrep`.

A region attachment still shows its whole picture. Clean source art (the layered PSD export) is the real fix for fragments, and the skill asks for it.

### 2. Tracked video fit

`fitRestPose` takes `predict`: per bone, the placement a neighbouring frame found.

- **Search near the prediction.** The bone's parts are searched there first, within `track.move` world units and `track.turn` degrees. A candidate further from the prediction ranks lower, by the same small preference as before but measured from the prediction instead of the plan's pose.
- **Lost bones.** A bone whose parts score under `minScore` near the prediction is searched over the whole window as before, and named in `lost`.
- **Joint limits.** The limits per joint stay: 25 degrees off the parent's fit for a child, and 40 for the solve.

fit-video tracks by default (`track: false` / `--no-track` fits every frame alone):

- **Forward pass**: from frame 0's placements, each fitted frame is searched near the frame before. The span is a twelfth of the figure's height and 12 degrees per fitted frame step (24 at `every: 2`), at most the whole window and 40 degrees.
- **Backward pass**: from the last frame, fitted alone, back to the first.
- **Agreement**: where both passes are accepted, each bone gets their mean. The mean also cancels the lag each pass's preference gives a moving part.
- **Disagreement**: a bone on which the passes differ by more than 8 degrees or 2 % of the figure's height followed a look-alike in one of them. That bone gets no value on that frame. The gap is filled from the frames around it, as frames left out by `every` are.
- **One pass accepted**: a frame only one pass accepted uses that pass, and is listed.
- **Report**: `summary.json` gives `tracking: { span, agreement, disagree: { bone: frames }, singlePass, lost }`. A hint names each bone with disagreements and its frames. Above 30 % of the frames, the hint says the part has a look-alike or moves faster than the track follows (look at `best/compare`, or fit every frame).

The later rounds' refits of single frames are not tracked yet.

### 3. Input provenance

fit-video's `summary.json` lists `inputs`: the path, size and SHA-256 of every file it read:

- the plan
- the images-only file and its images
- the build
- the video

A result can then show which files made it, and that the artist's Spine file was not one of them. The MCP tool returns the paths relative to its workspace. Keeping a blind run's inputs in a folder without the artist's files remains the requester's step; the engine reads only what it is given.

## Evidence

- `tests/artist-density.test.ts`: a sliver of 120 px in a picture's corner, apart from a 300 × 240 ellipse, is left out of the budget mesh (`discarded` 120, no vertex near it). Two eyes on one image are still covered by one outline.
- `tests/video-tracking.test.ts`, on the fixture rendered at 3×:
  - The arm swung 30 degrees with a copy of it hanging where the plan holds it. A frame fitted alone takes the copy (under 5 degrees). Tracked from the frame before (arm at 24 degrees), the arm is found within 1.5 degrees of 30.
  - A prediction nothing matches near is named `lost` and searched as without it.
  - `agreePoses` averages agreeing bones and leaves out the one the fits disagree on.
- `tests/character-fit-video.test.ts`:
  - **Clean idle** (`every: 2`): both passes agree on every frame and lose nothing; still passed in round 1.
    - Against fitting each frame alone, the fitted frames are closer to the truth: the hips' turn within 0.51 degree instead of 1.0, the spine 0.61 instead of 1.04, the left thigh 0.45 instead of 1.17, the right calf 0.60 instead of 0.98. The arm stays at 1.3.
    - V1 0.975 / 0.957 instead of 0.967 / 0.948. The capped keys stay within 1.98 tolerances instead of 2.50.
    - With the cap of four shared keys, the arm comes back within 1.63 degrees instead of 1.03, because the key frames moved. The test's bound went from 1.5 to 2 degrees.
    - The dense fit takes about twice as long (two passes): about 120 s instead of 65 s.
  - **Look-alike** (`every: 4`, one round): on frames 12–24 of each loop a copy of the arm, swung 28 degrees out, is drawn over the figure.
    - Fitted alone: the arm takes the copy, 27.5 degrees off on those frames. V1 minimum 0.839, V2 p90 3.11 %, V3 lag −3 frames and size 0.46: failed. The capped keys stay within only 8.78 tolerances.
    - Tracked: on every frame kept, the arm is within 1.2 degrees. On 5 of the 8 copy frames one pass had jumped to the copy (a 48-degree span at `every: 4`). They disagree and are left as gaps, and the hint names them. V1 0.976 / 0.96, V2 0.26 % / 0.93 %, V3 lag 0 and size 1.01: passed.
  - **Inputs**: the idle's summary lists the plan, the build, the video and the images, each with a SHA-256.
- **Not yet measured**: the Pig idle with tracking (V1 against 0.547, the size ratio against 1.96). The files are on the requester's computer.

## Consequences

- A clip with look-alikes keeps its parts on their track, and frames a track lost are visible in the summary instead of becoming a turn.
- The dense fit costs about twice as long.
- A part moving more than the span per fitted frame lags in both passes. If the passes then disagree, that frame is a gap. `every: 1` gives the track the most frames to follow. The span is not yet scaled by how fast the clip moves.
- Images with detached pieces under 2 % lose them from their meshes, as they did before ADR-038.
- Rollback: `track: false`; a budget hull back to always bridging.
