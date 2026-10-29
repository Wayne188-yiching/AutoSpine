<!-- Generated from docs/adr/ADR-052-fit-video-big-travel.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-052 — fit-video on clips that travel further than the figure

Status: Accepted
Date: 2026-10-29 (plugin 0.5.21)

## Context

The Pig blind test (2026-10-28, `C:/Wayne/Spine/Pseudo-3D/pig/AutoSpine/Pig-blind`) fitted its
`appear` reference: a one-shot in which the figure rises about 1.3 figure heights, overshoots and
settles. Two things went wrong in `fit-video`:

- **Frame 0 was refused.** `check-video-fit` on the same plan and build was ready (unreachable
  share 0.155). `fit-video` refused with `CLI_FIT_RIG` (0.722): its leg parts were placed up to
  198 units away. Both run the same preflight, but its search window was
  `travel + 0.1 × figure height`, and `travel` is the silhouette's largest move over the decoded
  frames. `check-video-fit` decodes one frame, so its travel is 0; `fit-video` decodes the clip,
  so frame 0 was searched over the whole rise and pink look-alikes took the legs. Frame 0 is posed
  at the build's own frame 0 (the zero frame, ADR-033); the clip's travel says nothing about where
  its parts are.
- **Fast travel lost the track.** ADR-039 searches each part near the neighbouring frame's
  placement, within a twelfth of the figure height per fitted step. A rise of 60–100 units a frame
  leaves that span, the part is `lost`, and it is searched again over the whole-clip window around
  the base pose, which does not move. The fixture reproduction (below) left the hips 15 units
  (5 % of the figure) off the video.

`fit-video` has no `--window`, so the only way through was fit-pose key poses on a hand-measured
path.

## Decision

- Frame 0 (the zero fit, or the plain fit with `--no-zero`) is searched over a tenth of the figure
  height, the window `check-video-fit` uses. `first-frame.json` records it as `limits.window`, so
  the two reports can be compared. The dense frames keep the travel window when nothing predicts
  them.
- A tracked prediction is carried by the silhouette's travel since the placement was found: each
  predicted placement moves by the foreground centroid's change between that frame and this one.
  The camera is still (ADR-036), so the whole figure's move is the best guess for every part; the
  track span, the agreement test and the turn checks are unchanged.
- `--no-track` is unchanged: a frame fitted alone still searches the travel window around the base
  pose.

## Evidence

`tests/character-fit-video.test.ts` "fits a one-shot whose figure travels further than its own
height" renders the fixture rising 380 units (1.3 figure heights) over 12 frames on a 760-pixel
canvas:

- Before: the preflight carried no window, and the fitted hips were up to 15.0 units off the
  video's.
- After: `fit-video` and `check-video-fit` report the same window, coverage and unreachable share;
  every frame's hips are within 9 units (3 % of the figure); V3 passes.

The Pig `appear` on 0.5.21 (`fit-appear-04-v0521`, after one rest-pose composition as
`CLI_FIT_REST_POSE` asked):

- `fit-video` no longer refuses it, and its preflight equals `check-video-fit`'s (coverage 0.783,
  shifted 0.219, unreachable 0.159, window 61 units).
- The fit itself is still poor: frames 11–30 cover under 0.6 (open mouth, wide eyes and scale,
  which the fit does not model), and the torso bones (`body1`, `spine1`, `chest1`) are lost near
  their carried prediction from frame 1 and left as identity gaps, so only frames 36–40 are keyed
  (V1 0.34 / 0.05). Their parts were already beyond the part distance on frame 0 (`1_body`,
  `1_toga` unreachable). That clip still needs the key-pose route (a measured Layout path, then
  `fit-pose`), which reached V1 0.708 / V2 4.77 %.

## Consequences

- Big-travel one-shots (entries, exits, fly-ins) can go through `fit-video` instead of a
  hand-measured Layout path.
- A silhouette that changes for other reasons (an effect switching on, a part leaving the frame)
  moves the prediction by that change; the track span and the forward/backward agreement still
  decide whether the part is kept.
- Pose-set switches, projectiles and effect sequences inside one animation (the Pig's wins) are
  still out of scope.
