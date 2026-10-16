<!-- Generated from docs/adr/ADR-034-reference-video-acceptance.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-034 — acceptance against a reference video

Context: a requester often has the motion as a video: the artist's render of an earlier version, a Spine export from another project, or a generated clip. The red-robed reindeer was built against such videos and checked with a one-off script (`accept.py`: character-specific feature points, its own renderer, a hard-coded ffmpeg). The requester asked (2026-10-15) that every build be compared with its reference video's motion and accepted after the animation is made. Two choices were the requester's: the comparison is a separate video in the project folder, and a failure is only reported; the requester decides what to change (no automatic iteration).

Decision:

- **Plan**: `motion.animations[].reference: { video, start? }`. `video` is relative to the plan file; `start` is the second of the video that shows the animation's frame 0 (default 0).
- **Commands**:
  - CLI `compare-video <plan> <build> <new-dir> [--animation=name] [--video=file] [--start=s] [--font=file]`. Without `--video` it compares every animation that has a `reference`. Exit 2 when not passed.
  - MCP `autospine_compare_video` takes a workspace-local `videoPath` (the plan's own paths may point outside the workspace).
  - `deliver` runs it for every animation with a reference and writes `<Name>-vs-reference.mp4` beside the project (`<Name>-<animation>-vs-reference.mp4` when the plan has several animations). Its output gains `reference` (pass, rows and hints per animation). A comparison that cannot run (missing video, no plain background) is reported as `referenceError` and does not stop the delivery. `--no-reference` skips it; `--replace` moves the old comparison videos away with the old project.
- **Reading the video**: ffmpeg decodes from `start`, resampled to the plan's fps, at the video's own size. The background is the median border colour. At least 75 % of the border must be within 60 (RGB sum) of it, otherwise `CLI_VIDEO`: the comparison needs a single-colour background. The figure is every pixel further than 60 from it.
- **Placement**: the build's frame-0 bounds are scaled to the reference figure's height, then a pattern search over scale and offset maximises the silhouette overlap. It starts from the area ratio and the centroids; the steps halve down to 0.25 % and 1 px. The overlap reached is reported as `registration.iou`.
- **Rows** (thresholds are proposals, to tune with the art lead):
  - **V1 silhouette**: overlap of the two figures per frame, mean ≥ 0.9 and minimum ≥ 0.8.
  - **V2 part position**: each frame, each part's visible pixels in the build frame (the renderer records which slot covers each pixel; additive and screen slots own none) are searched for in the reference frame. The search is normalised cross-correlation on half-size grey images, within 8 % of the figure height, with turns up to ±30° and a sub-pixel shift. The part is grown by one pixel so a flat-coloured part keeps its outline, and sampled to at most 600 pixels. A score below 0.6 means not found. The search starts around last frame's answer and runs in full only when that scores below 0.75.
    - A lone jump of more than 1.5 % of the height from the median of the two frames either side is a mismatch and dropped.
    - The error is the distance between where the build draws the part and where the reference shows it, as a fraction of the figure height. Parts found in at least half the frames are judged.
    - Pass: the median of the part medians ≤ 0.6 % and the 90th percentile of the part p90s ≤ 1.5 %.
  - **V3 figure timing and size**: the silhouette centroid along the reference's busier axis. The lag (cross-correlation up to 12 frames, wrapped for loops) is ≤ 2 frames, and the ratio of spreads is 0.75–1.33. It is not judged when the reference figure moves less than 0.3 % of its height.
  - **V4 loop seam** (loops only): the build's last and first frames differ by at most 0.002 (mean absolute, 0–1).
- **Output** (in the new directory):
  - `<animation>/compare.mp4`: reference | build | difference ×4, captioned when a font is found (Microsoft JhengHei on Windows, `--font` elsewhere), at most 1800 px wide.
  - `<animation>/report.json`: rows, `hints`, per-part scores (median, p90, lag, size and correlation), `notJudged` parts and the silhouette overlap per frame.
  - `summary.json`.
- **Mirrored parts** (added with ADR-035): the part search also tries each part flipped left to right, and `report.json` lists the parts drawn mirrored in the reference for a stretch of frames, as a hint.
- **Hints** say the failed rows in words for the requester: the worst outline frame, the whole figure later or earlier, too small or too big, and the worst parts. A part's lag and size are given only where its motion and the reference's correlate at 0.6 or more; otherwise it reads "moving differently".
- **Why matching instead of tracking**: the first version tracked texture patches through each video separately. On the fixture the arm drifted (p90 8 % comparing a video with itself), because its patch turned and the body behind it changed. Matching the build's own part pixels into each reference frame has no drift and leaves covered pixels out. Searching turns removed the bias that placed a turned limb nearer its root.

Evidence:

- `tests/character-compare-video.test.ts`:
  - **Units**:
    - Lag and size of a shifted sine (3 frames, 0.5×).
    - Registration of a moved, scaled silhouette (overlap 0.99).
    - A textured part moved (+5, −3) and turned 20° is found within a pixel and 5°; a flat patch gives no template.
    - A lone mismatch is dropped.
    - A plain border is told from scenery.
    - Identical motion passes V2; one 5 frames late fails.
  - **The fixture against videos of itself** (textured fixture art, rendered off-centre on a plain background):
    - Same motion at scale 1.1: all pass. V1 0.979 / 0.976, V2 0.14 % / 0.5 % over 7 parts, V3 lag 0 and size 1.02.
    - The same video 6 frames ahead at scale 1.3: V2 and V3 fail. The hints name the figure 6 frames late and Arm_R 5 frames late, and Hair as moving differently (a bending chain).
  - **Delivery**: with `reference` in the plan, `deliver` leaves `<Name>.json` (or `.spine`), `<Name>.mp4`, `<Name>-vs-reference.mp4` and `images/` at the top, and reports a pass.
- `tests/character-files.test.ts`: the MCP tool refuses a video outside the workspace and compares one inside it.
- **Red-robed reindeer** (build 20 of the reindeer session, 938 × 982 at 24 fps, 47 parts):
  - **Idle** against `紅袍麋鹿__呼吸待機.mp4`: all pass. V1 0.964 / 0.945, V2 0.14 % / 0.87 %, V3 lag 0 and size 0.98, V4 0. The largest part differences are the upper arms (dabi_2 1.4 %, dabi_1 1.3 % median). 29 s.
  - **Run** (144 frames) against `紅袍麋鹿國王_Seedance25_6秒小跳快走.mp4`: V1 0.88 / 0.78 and V2 0.56 % / 10 % fail; V3 passes (lag 0, size 1.09). The generated clip redraws the torso facing front while the build keeps the three-quarter drawing; the hints name the upper and lower body. 46 s.
  - **Run** against `紅袍麋鹿_Run_Loop.mp4` (a different 97-frame run): every row fails, as it should. The first hint says only 97 of 144 frames were compared.
- **Limits**:
  - The background must be one colour.
  - The video must start at the animation's frame 0; `start` skips a lead-in.
  - Colour is not judged. The reindeer's reference shows the cape behind the legs bright red where the build draws it dark red; only the difference panel shows it.
  - Effects in the video (the run's dust) lower V1.
  - A generated clip that redraws a part fails V2 for that part.
  - Camera moves are not followed.
  - Expressions are compared only as placement.
