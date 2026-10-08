# ADR-016 — feature-ring meshes and pinned dome regions

Context: the face layers have transparent cut-outs. The face base has two eye sockets and the bandage has a face window and a mouth slot. Because of them, v17 meshed faces as rectangular surface grids over the whole image. Those grids cover the transparent corners, carry no vertices on the socket rims, and give the editor a rectangle hull. ADR-015 made the eye assembly (whites, pupils, lids) rigid. The dome-weighted face then moved differently from the eyes behind its sockets, so the rims slid 15–21 px over the eye whites and exposed the glow behind them in close-up renders. The hand-made face mesh has a silhouette hull of 22 points and interior vertex rings around each eye.

Decision:

- `generateFeatureMesh(part, alpha, options)` in `@autospine/mesh` builds a feature-ring mesh:
  - Hull: the opaque silhouette, after the existing contour tracing and simplification.
  - Rings: every enclosed hole of at least `minHoleFraction` of the foreground becomes a ring of vertices, locked as mesh edges and declared as manual edges. Smaller holes are covered.
  - Hole interiors are triangulated, so the editor sees one ordinary hull and the area check holds.
  - Earcut triangulates the silhouette with the rings as holes, then each ring separately. Long hull and ring edges are refined by splitting the triangles on them, because earcut drops collinear points. An interior lattice is inserted and min-angle flips run that never cross a ring.
  - The result passes `validateMeshSpec` and returns the ring vertex indices.
- `solveDomeWeights(..., pins)` and `domeValue(..., pins)` accept pins. A pin is a world polygon with a value and a margin. Inside the polygon the control weight equals the value, and it returns to the dome by smoothstep over the margin. The counter weight fades out by the same amount.
- In the reviewed build the face base's socket rings become pins. Their value is the eye assembly's follow mix and their margin is 0.12 × head width, so each socket rim moves exactly with the eyes behind it while the rest of the face still domes.

Evidence:

- `tests/feature-mesh.test.ts`, on a synthetic face with two sockets and a 2 × 2 speck:
  - Two rings sit on the socket rims; their edges exist and are declared, and the speck is ignored.
  - The mesh area is within 3 % of the silhouette, where the image-rectangle grid is over 150 %.
  - The minimum angle is above 5°, the output is deterministic, and invalid input fails with an error code.
- `tests/dome-weights.test.ts`: the control weight equals the pin value inside the polygon and the dome value beyond the margin, and a rigid feature at the pin value stays glued to the pinned surface.

In the local mummy-cat build:

|                                             | grid (v17 style) | feature-ring mesh              |
| ------------------------------------------- | ---------------- | ------------------------------ |
| Face base vertices / triangles              | 195 / 336        | 142 / 212                      |
| Face base: covered area that is transparent | 39 %             | 13 % (mostly socket interiors) |
| Bandage vertices / triangles                | 195 / 336        | 187 / 281                      |
| Bandage: covered area that is transparent   | 43 %             | 28 %                           |
| Editor-visible edges                        | 362 grid lines   | 115 (hull plus socket rings)   |

Visible socket slip was measured as rim points pinned at setup to both the face layers and the eye white:

|                   | idle2          | `in`           |
| ----------------- | -------------- | -------------- |
| Before pins       | 14.8 / 15.1 px | 21.0 / 21.3 px |
| Pinned, face base | 0 / 0 px       | 0 / 0 px       |
| Pinned, bandage   | 2.3 / 2.0 px   | 3.2 / 2.8 px   |

The bandage residual is an upper bound, sampled at rim points whether or not the bandage is opaque there. The dome centre keeps a control weight of 0.690 (0.700 unpinned). Face shift is 0.064 / 0.054 head widths against the hand-made 0.061 / 0.056. The output imports and exports through the Spine 4.0.64 editor with triangles, edges and slip unchanged.

Trade-offs found: a 0.06 × head-width margin folded 15 bandage triangles during the large `in` face whip, because the steeper pin transition adds to the dome's own gradient. A 0.12 margin removed those folds; 0.16 lowered the bandage residual further but pulls more of the face toward the eye mix. The hull is denser than the hand-made one (70 and 91 points against 22), and the minimum triangle angle is about 7° on these images.

Consequences: any layered part with cut-outs can be meshed by its silhouette and holes instead of its rectangle, and anything showing through a cut-out can stay locked to its rim. Rollback: remove the module, the pin parameter and their exports.
