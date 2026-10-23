# ADR-045 — a part squashed to a line fails the QA

Status: Accepted
Date: 2026-10-23 (plugin 0.5.11)
Amends: ADR-017 (B rows), ADR-034 (V rows)

## Context

The Panda reference rebuild (blind test 2026-10-18, `Panda_Rebuilt`, 18/18 rows passed) shows, on its idle:

- a blue streak right of the body on frames 21–23;
- a thin line under the body on frames 21–23;
- a long diagonal line across the body in the wireframe on frame 15.

Each is a part flattened by its deform keys:

| Part        | Frames      | Smallest minor/major ratio against its own shape | Turns over through a line |
| ----------- | ----------- | ------------------------------------------------ | ------------------------- |
| `3_hand_R3` | 21–23       | 0.005                                            | frame 21.49               |
| `3_head`    | 20–23       | 0.05                                             | —                         |
| `2_scarf`   | 13.75–23.75 | 0.017                                            | frame 15.89               |
| `1_nose`    | 5.75–8      | 0.017                                            | frame 6.70                |

The rebuild came from per-character scripts in the project's `_work/notes`, not from the engine.

- The pixel fit kept every part opaque (`--opaque`).
- It let a part's scale fall to 0.015 against 0.14–0.55 for the same parts elsewhere.
- So a part the reference hides behind another was flattened instead of hidden.
- Fractional deform keys (1/16 frame) then kept the linear path from a mirrored fitted frame to an unmirrored one, which passes through zero area.
- The game runtime plays at any time, so the turn shows between whole frames too.

Why no check caught it:

- The project's fold audit counted only triangles of mixed orientation and called a whole mirrored part "not a local fold".
- The engine's `deformationQA` counts inverted triangles (so a mirrored part fails B1) but nothing looked at thinness.
- `compare-video` ran no deformation check at all.

## Decision

`deformationQA` also reports, for every shown part (alpha > 0.25) outside `qa.deformExclude`:

- `collapses`: the part's least-squares linear map from its own setup shape (an attachment swapped in uses its own, as for inversions). Its minor/major singular value ratio below `COLLAPSE.ratio` = 0.2 (narrower than 1:5 of its own shape) counts. Reported with the smallest ratio and the first and last frame.
- `flips`: the map's determinant changes sign between two samples. The interval is then halved 12 times toward the turn. The turn counts when the part gets thinner than the same ratio on the way.
  - A reflection keyed stepped (ADR-035 `mirror`, a scale of −1 from one frame) turns over whole and is not counted. It still shows as inverted triangles (B1), as before.
  - A part that goes and comes back between two whole frames is found, because the part is sampled 4 times a frame (`COLLAPSE.substeps`); inversions and stretch are still measured on whole frames.

Rows:

- **B4** (`checkAcceptance`, against an artist): parts in `collapses` or `flips` of the build that the artist's file does not have there. An artist who turns a card over by its scale gives the build the same right.
- **V5** (`compare-video`, against a reference video): no part in `collapses` or `flips`.
  - `report.json` gives `deformation`. The hints name each part with its frames:
    - squashed: hide it there (attachment off) if the reference hides it;
    - turning over: swap or mirror it in one step instead.
  - A failed V5 adds 1 to the fit penalty (ADR-036), as an untracked V2 does.

The thresholds are proposals, like ADR-034's.

## Evidence

- `tests/deformation-collapse.test.ts`:
  - The shape measure on a part squashed 1:10, a part mirrored and scaled, and a part with no area.
  - A card scaled from 1 to −1 and back (linear) is collapsed near frames 15 and 25 and turns over at 15 and 25.
  - The same scale keyed stepped turns over with no collapse and no turn, and still inverts its triangles.
  - A turn there and back between frames 10 and 11 is found twice, with no inversion on whole frames.
  - The same squash hidden by an attachment key, faded under alpha 0.25, or listed in `deformExclude` is not reported.
  - V5 passes with an empty list and fails with the parts named. A failed V5 adds exactly 1 to `videoPenalty`. A comparison without the QA has no V5.
  - B4 passes on the fixture compared with itself. It fails when the build alone has a turn, and passes again when the artist's file has the same part collapsed.
- **Panda idle** (`checks/delivery-r5/export/Panda_Rebuilt.json` against `panda-idle.mov`). V1, V3 and V4 are unchanged (0.962 / 0.88, lag 0 and size 1.03, seam 0).
  - V5 fails with 15 parts, among them `3_hand_R3` 0.005 on 21.25–23.75, `3_head` 0.05 on 20–23.75 and `2_scarf` 0.017 on 13.75–23.75.
  - Turns over at 6.70 (`1_nose`), 6.73 (`1_leg_R2`), 15.89 (`2_scarf`) and 21.49 (`3_hand_R3`).
  - The same Panda parts rigged without deforms (the Genielabs comparison of 2026-10-23) pass V5.
