<!-- Generated from docs/adr/ADR-042-deformed-parts-bend.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-042 — parts deformed by keys are wired as parts that bend

Status: Accepted
Date: 2026-10-21
Amends: ADR-041 (interior points; the hull factor for rigid parts)

## Context

ADR-041 wires a `feature` mesh from its outline and the bones that weight it. A part with no bones, or one bone, is rigid: its hull has 0.67 times the outline's corners and it has no interior points.

The Pig rebuilt with ADR-041 (2026-10-20, `pig/AutoSpine/_work/notes/adr041-rebuild-20261020.md`) showed what that misses:

- **Pseudo-3D parts get no interior.** The plan weights the face, head, nose, body, loincloth and lashes rigidly, and the reference-sampled motion deforms them by keys. ADR-041 gave them 0 interior points and 8–12 hull points. The artist gives them 20–30 interior points.
- **Effect on the build.** Face parallax was too large: D1 appear 12/13 → 10/13 and idle 9/10 → 7/10, with "reduce face-control travel". The nose's setup shape moved: A2 32.6 → 73.7 px.
- **Panda.** Its unweighted pseudo-3D parts lost position for the same reason (ADR-041, Consequences).

A second survey of the same corpus (Yuuna, Panda, Pig with images, 164 meshes; local, not committed) split the meshes by weights and by whether an animation deforms them by keys:

| Group                    | n   | Interior, median (p25–p75) | Hull / outline corners | Interior / (0.27 × area / mean hull edge²) |
| ------------------------ | --- | -------------------------- | ---------------------- | ------------------------------------------ |
| Rigid, no deform keys    | 23  | 0 (0–0)                    | 0.57                   | —                                          |
| Rigid, deform keys       | 57  | 1 (0–3)                    | 0.83                   | 0.73                                       |
| 2+ bones, no deform keys | 40  | 3 (0–10)                   | 1.27                   | 0.97                                       |
| 2+ bones, deform keys    | 44  | 6.5 (3–13)                 | 1.37                   | 0.96                                       |

- **Count.** For every part that bends (2+ bones or deform keys), the interior count follows the hull's area in mean-hull-edge squares. Log correlation is 0.67; artist / rule medians are 0.85 overall, 0.97 for 2+ bones, and 1.06 on the Pig.
- **Count predictors that did no better.** An inner loop's length predicted it no better (correlation 0.69, ratio 0.65). Drawn-edge density inside the part does not predict the faces' excess (correlation −0.17).
- **Placement.** Interior points sit half to one and a half hull edges in from the outline: 26 % within half an edge, against 51 % of random points inside. Nearest-neighbour spacing is about 1.1 hull edges. They are not on drawn edges overall (percentile 0.48), though the Pig's face parts are (0.61–0.79).
- **Heavy parts.** Faces and wings (the 25 parts with 8 or more interior points) carry about 2.5 times the area rule. Neither their shape nor their drawn edges say so.

## Decision

- **A part that bends.** A part bends when two or more bones weight it, or when it is also deformed by mesh deform keys:
  - `generateFeatureMesh({ bones, deforms: true })` in the mesher;
  - `deform: true` on a plan's `feature` mesh;
  - automatically for parts named in `motion.deforms` (ADR-037).
- **Hull.** A part with deform keys and fewer than three bones takes the 1–2 bone factor, 0.9, instead of 0.67. Three or more bones stay at 1.5.
- **Interior count.** A part that bends gets ADR-041's joint rows first. Spread points then bring the total to round(0.27 × hull area / mean hull edge²). A rigid part still gets none.
- **Placement.** Each spread point goes where it is farthest from the points so far and from the boundaries counted at twice their distance. That is the spacing a point's mirror image across the hull would give, so spread points sit about half their spacing inside the outline, as the artists' do.
  - Candidates lie on a grid of a quarter hull edge, half an edge or more from every boundary and point.
  - The fill stops early when no candidate is half an edge from everything.
- **Explicit `interiorVertices` with `bones`.** Exactly that many points: joint rows first, then spread points. They no longer switch to the lattice. Without `bones` (the engine tool `autospine_feature_mesh`), the lattice search is unchanged.
- **Unchanged.** Hull placement, padding and coverage (ADR-041); hole rings; `density: "fine"`; Delaunay flips.

## Evidence

`tools/artist-wiring-check.mjs` now passes `deforms` for artist meshes an animation deforms by keys. Before is ADR-041 (193fc04), after is this change, over the 160 meshes both built:

| Corpus (meshes) | Run    | Hull error, median / mean | Hull within 25 % | Interior count error, median | Position, % diagonal, median / mean | Hull edge recall | Automatic edge recall |
| --------------- | ------ | ------------------------- | ---------------- | ---------------------------- | ----------------------------------- | ---------------- | --------------------- |
| Panda (42)      | before | 0.27 / 0.29               | 50 %             | 2                            | 10.98 / 10.98                       | 0.43             | 0.04                  |
|                 | after  | 0.22 / 0.30               | 60 %             | 1                            | 8.72 / 8.97                         | 0.52             | 0.32                  |
| Pig (51)        | before | 0.25 / 0.34               | 55 %             | 5                            | 8.17 / 8.39                         | 0.43             | 0.18                  |
|                 | after  | 0.25 / 0.40               | 55 %             | 4                            | 7.66 / 8.17                         | 0.43             | 0.19                  |
| Yuuna (67)      | before | 0.30 / 0.55               | 42 %             | 0                            | 5.37 / 7.02                         | 0.56             | 0.21                  |
|                 | after  | 0.30 / 0.55               | 42 %             | 2                            | 5.33 / 6.93                         | 0.56             | 0.21                  |
| **All (160)**   | before | 0.28 / 0.41               | 48 %             | 2                            | 7.86 / 8.50                         | 0.48             | 0.15                  |
|                 | after  | **0.25** / 0.43           | **51 %**         | 2                            | **7.33 / 7.86**                     | **0.51**         | **0.23**              |

- **Panda.** Its position error falls from 10.98 to 8.72 %, below the ADR-024 budget's 9.30. Its rigid keyed parts now get the artist's median of 2 interior points.
- **Yuuna.** It gains spread points on 2-bone and keyed parts where its artist has none (interior error median 0 → 2), yet its position still improves slightly. The artists disagree here: the Pig's 2-bone parts have 10 interior points, Yuuna's 0. The rule takes their common median.
- **Delaunay and speed.** All generated meshes remain 100 % locally Delaunay. A mesh takes 36 ms median.

**The Pig rebuilt** (`pig/AutoSpine/_work`) used the same rig and the same reference-sampled motion (`notes/quality-build-*.mjs`) in every arm; only the wiring differs. ADR-042 is `plans/plan-20.json` (plan-17 with `deform: true` on every `feature` mesh, since that pipeline deforms them all), `builds/build-21-adr042` and `checks/compare-21-adr042`:

|                                                             | Artist | Old counts (64/96 hulls) | ADR-041            | ADR-042         |
| ----------------------------------------------------------- | ------ | ------------------------ | ------------------ | --------------- |
| Vertices (54 artist meshes)                                 | 1379   | 5540                     | 852                | 986             |
| Hull count error, median                                    |        | 3.0                      | 0.36               | **0.28**        |
| Position, % diagonal, median                                |        | 4.06                     | 6.92               | 5.93            |
| Hull edge recall                                            |        | 0.26                     | 0.42               | **0.46**        |
| B1 inversions win1–5                                        |        | 1_Nose 2 each            | 0                  | **0**           |
| Fold frames left after regularisation                       |        | 147                      | 64                 | 74              |
| D1 appear / idle                                            |        | 12/13, 9/10              | 10/13, 7/10        | **12/13, 9/10** |
| Face parallax X / Y, idle (range 0.031–0.070 / 0.042–0.094) |        | 0.040 / 0.064            | 0.094 / 0.113 high | 0.065 / 0.088   |
| A2 1_Nose setup                                             |        | 32.6 px                  | 73.7 px            | **30.7 px**     |
| A6 rest pose idle, median / p90                             |        | 0.0002 / 0.001           | 0.0019 / 0.0146    | 0.0015 / 0.0081 |

- **Failing in every arm.** A1 (13.5 px, `1_arrow2`) and A2 fail: Quality v3's calibrated images-only file is refused by the current engine, so every arm is compared on the soft-v2 placements.
- **Tests.**
  - `tests/artist-density.test.ts`: a 3-bone part has rows at both joints and at least the area rule, all half an edge from the hull and from each other. A keyed rigid part has a larger hull than a rigid one and exactly the area rule's interior, a median 0.5–2 edges in. Explicit counts give exactly that many, joint rows first.
  - `tests/character-deforms.test.ts`: a `meshing.parts` part named in `motion.deforms` gets the larger hull.

## Consequences

- **What the plan must say.** A part that is deformed by keys but weighted rigidly must say so (`deform: true`, or be in `motion.deforms`). The engine cannot see keys that a later step adds.
- **Faces and wings.** They still get about a third of the artist's interior (Pig head 4 against 22, nose 3 against 29). Their excess is semantic, not geometric. Give them explicit `interiorVertices`, now placed like the rule's points instead of on a lattice.
- **Interior count follows the hull.** The count scales with the hull's edge length, so a hull sparser than the artist's (the Pig's face parts) also thins the interior.
- **Rollback.** Drop `deforms`, `deform` and `spread`; a bending part's interior returns to joint rows only.
