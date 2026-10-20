# ADR-024 — rest pose from a reference, artist-density wiring, review fixes

Context: the HorseYearFish blind test (2026-10-14, `L_[IDLE]`, brief "2 秒的 idle 呼吸") passed 10 of 11 automated criteria, yet the review video was clearly not artist work:

- **Rest pose.** The setup is a layout of several pose sets. The artist's idle starts away from it: the head 250–350 px (about 0.5 head widths) to the left and turned, the right hand 100–130 px higher. ADR-019's survey had found every idle starting at the setup pose, so the plan used it. No criterion compares absolute pose.
- **Expression.** A constant deform (equal keys at 0 s and 2 s) closes the setup's grinning mouth. Neither the images nor the brief say so.
- **Wiring.** The artist meshes all 36 shown parts (762 vertices). The build had 11 meshes and 25 rectangles, its leg meshes were too dense, and its soft strands (forelock, moustaches, ears) had no bones.
- **Measurement gaps.**
  - A1 failed on a hidden part of another pose set.
  - The review video drew all 725 artist bones, most of them for hidden pose sets.

Survey (meshes from the artist files already seen; local, not committed):

- Character meshes: 423 from HorseYearFish (328) and the mummy cat (95). With s = √(image width × height) px:

  | s       | Hull (median) | Interior (median) |
  | ------- | ------------- | ----------------- |
  | < 100   | 9             | 0                 |
  | 100–150 | 10            | 2                 |
  | 150–200 | 13            | 2                 |
  | 200–280 | 15            | 2                 |
  | 280–400 | 19            | 4                 |
  | ≥ 400   | 23            | 5                 |

- Deforming parts are denser: the horse's robe has 65 vertices and its face 87.
- The GoldTree prop has about 19 hull points regardless of size.

Decision:

- **Wiring**:
  - `feature` meshes take `density: "artist"`. The hull has round(√s) points, clamped to 6–40. There are no interior points below s = 100, and round(s / 80) above.
  - Explicit `hullVertices` and `interiorVertices` can be given instead.
  - The budget hull starts from the traced pixel outline and is reduced step by step. Each step either drops a vertex or merges two convex neighbours at the meeting point of their outer edges, whichever adds the least area. Every opaque pixel centre stays covered, the ring stays simple and inside the image.
  - Separate blobs (two eyes on one image) are joined by 3 px bridges into one outline.
- **`meshing.all`** (plan): every region part an animation shows becomes an artist-density mesh, rigidly weighted to its region bone. Collapsed and sheared placements keep their region or quad. Parts the mesher rejects stay regions and are listed in `build-record.json` (`meshingSkipped`).
- **Rest pose**:
  - `motion.animations[].pose: { bone: { x?, y?, rotate? } }` is added to every key of the animation. Values are IR offsets: the parent's frame, y down, clockwise degrees.
  - Seam QA (B2) measures drift against frame 0, so a static pose is not counted as an opened seam.
- **`fit-pose`** (CLI and `autospine_fit_pose`) measures a rest pose from a PNG reference covering `qa.view`:
  - **Matching.** Bones are matched top-down: each bone's parts together, as one rigid move. A part counts toward its nearest free bone, and a chain's parts also count toward the chain's parent. The score is the mean colour match of sampled texels, which tolerates overlap.
  - **Search window.** A child of a reliably matched bone searches near the predicted place: half its parts' extent and ±25°. Other bones search the whole window.
  - **Solve.** The plan bones' setup offsets are solved by damped least squares on the official runtime, so IK and face followers take effect. A bone that starts on its parent's origin or tip may only turn. A near-L1 pull keeps redundant bones still.
  - **Face rig excluded.** Face base, control, counter, followers and layers are not fitted; expressions are left out.
- **Criteria**:
  - A1 counts only the slots the compared animations show; hidden slots are reported apart.
  - New A6, the rest pose: on frame 0, each shown slot's mean UV-matched offset from the artist. It passes with a median ≤ 0.03 head widths and a 90th percentile ≤ 0.1 head widths. Both thresholds are provisional, calibrated on one in-sample case.
- **Review video**: the bones segment draws only the bones that move shown parts (slot bones, mesh weight bones, constraint targets, and their ancestors).
- **Plan rules** (skill and handbook):
  - A mesh that bridges a bending joint hangs between the bones outside it: neck from spine to head, robe from base to spine.
  - Soft strands (forelock, moustache, ears, beard, tassels) get a 3-bone chain on an artist-density contour.
  - When the setup is a pose layout, the brief must come with a reference image of the rest pose.

Evidence:

- **`tests/character-restpose.test.ts`** (7 tests):
  - The artist budget values.
  - A two-blob image gets one 12-point hull covering every opaque pixel; the default mesher rejects it.
  - `meshing.all` and part sets.
  - Pose keys, runtime angle and lint.
  - Seams with a static pose.
  - `fitRestPose` recovers a 6° spine turn and a −10° arm turn within 0.5° and leaves the head still.
  - A6 and shown-only A1.
  - Driving bones.
- **`tests/character-branching.test.ts`**: collapsed placements.
- **`tests/character-files.test.ts`**: the MCP tool, workspace-local output, refusing to overwrite.
- **HorseYearFish, in sample** (the answer seen; `docs/local-reviews/blind-tests/2026-10-14-horse-e2e/insample`):
  - Inputs: the blind plan plus `meshing.all`, strand chains, the bridging rule, and the rest pose fitted to the artist's frame 0.
  - Acceptance: all 12 automated criteria pass. A6 median is 0.012 head widths and p90 0.059, against 0.20 and 0.41 for the blind build. Seam drift 7.9 px; D1 8/13.
  - Structure over the 36 shown parts:

    |          | Artist | Build |
    | -------- | ------ | ----- |
    | Meshes   | 36     | 35    |
    | Vertices | 762    | 689   |
    | Bones    | 85     | 51    |

  - The review video shows the same pose; only the expression differs.

Consequences:

- A pose-layout rig needs one picture of the target pose. That is the only extra input; the motion is still planned blind.
- Expressions made with deform keys stay out of scope until a brief can name them.
- The A6 thresholds and the template come from one character; the next blind test is their first real check.
- Rollback: drop `meshing`, `density`, `pose`, `fit-pose` and A6. A1 returns to all slots, and seams to setup.
- The size budget (hull round(√s), interior round(s / 80)) is superseded by ADR-041 (2026-10-20): counts from the outline and the weighting bones. The covering hull, the bridges and `meshing.all` stand.
