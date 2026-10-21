<!-- Generated from docs/adr/ADR-043-even-hull-spacing.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-043 — hull points spaced like an artist's

Status: Accepted
Date: 2026-10-21
Amends: ADR-041 (hull placement)

## Context

The plugin 0.5.6 test of 2026-10-21 rebuilt the ThreePigWC wolf (`plugin-test-0.5.6/wolf/_work`, notes `plugin-0.5.6-test-20261021.md`). Its plan meshes `Pants_01`, one image over both legs, as a `feature` with `nearest` weights over spine, thigh_l, calf_l, thigh_r and calf_r (maxInfluences 2, smoothing 2):

| Build of `plan-01.json`, 02_Idle against the artist | Pants_01 vertices | B1 (visible inversions) | B3 (stretch / limit) |
| --------------------------------------------------- | ----------------- | ----------------------- | -------------------- |
| 0.5.3 (ADR-038 budget)                              | 18                | 0                       | pass                 |
| 0.5.6 (ADR-041/042)                                 | 35 (hull 27)      | Pants_01 1              | 3.261 / 2.334        |
| 0.5.6, explicit `hullVertices` 15, interior 3       | 18                | 0                       | 1.032 / 2.334        |
| 0.5.6, `density: "fine"`                            | 124               | fails                   | 4.525 / 2.334        |

ADR-041 had listed B1/B3 on a full rebuild as not yet measured.

**What fails.**

- **The hull, not the interior.** The joint rows and spread points stay inside their own leg; no row crosses both legs.
  - With `interiorVertices: 0`, the 27-point hull alone stretches 2.86.
  - Any hull of 24 points or fewer, with the rule's interior, stretches 0.99–1.08 with no inversion.
- **A short crotch edge.** The worst edge is a 16 px hull edge in the crotch notch, 0.48 of the mean hull edge.
  - One end is weighted spine 0.58 / thigh_l 0.42, the other thigh_l 0.72 / calf_l 0.28.
  - At the widest frame of 02_Idle, the thighs swing 33–41°, the knees bend back 47–64° and the spine turns −15°. The two ends separate by about 50 px whatever the wiring.
  - That doubles a 62 px edge (the 15-point hull) but quadruples a 16 px one.
  - The one inversion is a thin triangle on the other side of the crotch (two hull points and the mid-thigh row point next to them).
- **The weights' part.** `nearest` keeps the top `maxInfluences` bones and drops the rest outright.
  - At the crotch, spine, thigh and calf are almost equally near, so the spine's 0.58 falls to 0 across that one edge.
  - On the same 35-point wiring, `maxInfluences: 3` stretches 0.90.

**What artists do.** On the 166 artist meshes of the ADR-041 check, artists space hull points evenly:

- the median coefficient of variation of the hull edge lengths is 0.35;
- 9 % of their hull edges are shorter than half the mean edge (3 or more bones: 10 %).
- ADR-041's cheapest-area fit gives 0.62 and 22 % (3 or more bones: 0.70 and 25 %). It keeps points where the outline turns, so they pack into corners and notches like the wolf's crotch.
- The wolf artist's own `Pants_01` has 33 hull points, its shortest edge 0.52 of the mean.

## Decision

- **Evening.** After a budget hull reaches its count (the rule's or an explicit `hullVertices`), it is evened out:
  - while an edge is shorter than half the mean edge, the cheapest step that removes or replaces it is taken. The steps are the fit's own: drop a point, or merge two convex neighbours where their outer edges meet.
  - Each step keeps every opaque pixel centre covered, the ring simple, and dropped fragments uncovered (ADR-039).
  - The longest edge is then split at its middle, which keeps the count.
  - A short edge that no step can remove (a covered spike) stays. The pass stops after twice the count of steps.
- **Unchanged.** Hull counts, padding and coverage; the interior rules (ADR-041/042); the weights.
- **Split points.** A split point lies on its edge, in line with its neighbours, and earcut can leave such a point out. Before, only a ring smaller than its count was split, and earcut kept those points. The evening splits more often, and the horse's `W_Face_3_A` came out with two points in no triangle. Points earcut leaves out now go back on their edge by splitting the triangle there, as long edges already did.

## Evidence

**Corpus.** `tools/artist-wiring-check.mjs` now also prints the hull edge CV (median) and the share of hull edges under half the mean (mean over meshes).

- Exports: Panda and Pig `png-rig-phase-2026-10-05/{panda,pig}`, and Yuuna `png-rig-phase-2026-10-05/yuuna/Character_Yuuna_03.json` (73 meshes; ADR-041/042 used a reference export with 67).
- Before is c4a085e (ADR-042), after is this change; the same 166 meshes build in both.

| Corpus (meshes) | Run    | Hull error, median / mean | Position, % diagonal, median / mean | Hull max, % diagonal, median | Hull edge recall | Automatic edge recall | Padding px, artist / generated | Hull edge CV, artist / generated | Edges under half the mean, artist / generated |
| --------------- | ------ | ------------------------- | ----------------------------------- | ---------------------------- | ---------------- | --------------------- | ------------------------------ | -------------------------------- | --------------------------------------------- |
| Panda (42)      | before | 0.22 / 0.30               | 8.72 / 8.97                         | 24.87                        | 0.522            | 0.323                 | 2.5 / 4.5                      | 0.26 / 0.56                      | 4 % / 20 %                                    |
|                 | after  | 0.22 / 0.30               | 8.31 / 8.55                         | 20.58                        | 0.621            | 0.363                 | 2.5 / 4.3                      | 0.26 / 0.32                      | 4 % / 4 %                                     |
| Pig (51)        | before | 0.25 / 0.40               | 7.66 / 8.17                         | 24.42                        | 0.434            | 0.189                 | 0.7 / 3.2                      | 0.34 / 0.71                      | 8 % / 24 %                                    |
|                 | after  | 0.25 / 0.40               | 7.33 / 7.86                         | 21.88                        | 0.510            | 0.238                 | 0.7 / 3.5                      | 0.34 / 0.31                      | 8 % / 4 %                                     |
| Yuuna (73)      | before | 0.29 / 0.52               | 5.33 / 7.13                         | 14.70                        | 0.569            | 0.223                 | 4.9 / 4.1                      | 0.38 / 0.58                      | 12 % / 21 %                                   |
|                 | after  | 0.29 / 0.52               | 5.11 / 7.07                         | 11.63                        | 0.607            | 0.274                 | 4.9 / 4.2                      | 0.38 / 0.31                      | 12 % / 7 %                                    |
| **All (166)**   | before | 0.25 / 0.43               | 7.36 / 7.91                         | 19.72                        | 0.516            | 0.238                 | 2.8 / 3.8                      | 0.35 / 0.62                      | 9 % / 22 %                                    |
|                 | after  | 0.25 / 0.43               | **7.23 / 7.69**                     | **18.04**                    | **0.581**        | **0.286**             | 2.8 / 3.8                      | 0.35 / **0.31**                  | 9 % / **5 %**                                 |

- Every position, hull-max and recall figure improves in every corpus. Counts, and so the count errors, do not change.
- All generated meshes stay 100 % locally Delaunay. A mesh takes 23 ms median (before 23), 632 ms at most (before 698).
- The same 3 meshes as before are skipped (an outline that touches itself, a crossing edge).

**The wolf** (`plugin-test-0.5.6/wolf/_work`, same plans and references; B2 and D1 fail as before and are not wiring):

| Plan                                                   | Pants_01 vertices | B1 before → after      | B3 before → after (limit)                                    |
| ------------------------------------------------------ | ----------------- | ---------------------- | ------------------------------------------------------------ |
| `plan-01`, 02_Idle                                     | 35 → 36 (hull 27) | Pants_01 1 → 0         | 3.261 → **1.714** (2.334)                                    |
| `plan-05`, explicit 15 / 3                             | 18                | 0 → 0                  | 1.032 → 1.000 (2.334); B2 12.34 → 12.08                      |
| `plan-09` (02_Idle + Win), `Pants_01` back on the rule | 35 → 36           | 02_Idle Pants_01 1 → 0 | 02_Idle 3.261 → 1.714 (2.334); Win 2.746 → **1.450** (2.568) |

**The wolf blind batch** (`blind-tests/2026-10-14-batch/wolf3p`, the same `Pants_01` plan in 10 animations against the artist's):

| Animation     | B3 limit | Pants_01 stretch before | after | Visible inversions before → after |
| ------------- | -------- | ----------------------- | ----- | --------------------------------- |
| 01_In         | 4.85     | 2.029                   | 1.085 | 0 → 0                             |
| 02_Idle       | 2.33     | **3.261**               | 1.714 | **1** → 0                         |
| 03_Blow_Start | 1.95     | **3.084**               | 1.625 | 0 → 0                             |
| 04_Blow_Loop  | 1.83     | **3.203**               | 1.664 | 0 → 0                             |
| 05_Blow_End   | 3.51     | 3.139                   | 1.627 | 0 → 0                             |
| 06_Idle       | 2.71     | **3.324**               | 1.751 | **1** → 0                         |
| 07_Out        | 6.53     | 3.439                   | 1.850 | 0 → 0                             |
| Change        | 4.85     | 2.017                   | 1.117 | 0 → 0                             |
| Win           | 2.57     | **3.169**               | 1.670 | 0 → 0                             |
| Win_2         | 3.79     | 3.169                   | 1.670 | 0 → 0                             |

- Every B1 and B3 failure the batch had (two and five) is gone; no other criterion changes outcome.
- A6 moves by under 0.01 head widths.

**The horse** (`2026-10-14-horse-e2e/insample/plan-025.json`, whose `W_Hat_1` is `nearest` over 6 bones with maxInfluences 2) passes every automatable criterion before and after.

**Tests.** `tests/nearest-legs.test.ts` builds pants of the wolf's size: a band over two legs with a crotch arch, the wolf plan's hips above the knees, and `nearest` over spine and both legs with two influences.

- No hull edge is under half the mean; ADR-042's fit left five, the shortest 0.15 of the mean.
- At a quarter, half, three quarters and all of the wolf's widest 02_Idle frame, the part has no inversion, and no edge stretches past B3's limit of 1 + 1.5 × 1.556.

## Consequences

- **Hull points are spread along the outline,** not packed into its turns. A split point lies on a straight hull edge, a little off the outline where the edge crosses a concave stretch; padding is unchanged in the median (Pig 3.2 → 3.5 px, Panda 4.5 → 4.3).
- **The crotch still tears.** Evening removes the short edges that the wolf's 50 px crotch tear concentrates on (1.6–1.9 stretch remains, against limits of 1.8–6.5); it does not make the weights smoother there.
  - The synthetic pants show the limit: their crotch edges are 25–30 px under both fits, and with the hips and knees moved about they stretch alike (2.2–3.1 times their length at the full sway, before or after).
  - A part over two legs with `nearest` should take `maxInfluences: 3` where spine, thigh and calf meet (the skill notes say so).
- **Weights not changed: a continuous top-k.** Subtracting the first bone left out from the kept ones fades a bone out where it leaves the top `maxInfluences` instead of dropping it. Measured as an alternative:
  - wolf `plan-01`: 3.26 → 1.95 with no inversion;
  - a rounded band over two legs: 2.07 → 3.10 times the setup length and 1 → 2 inversions, because the subtraction sharpens weights wherever three bones are near.
  - It is not adopted; a smoother `nearest` is a follow-up.
- **Rollback.** Drop the evening loop in `fitHullBudget`. The re-insertion of left-out hull points can stay; it only acts when earcut leaves points out.
