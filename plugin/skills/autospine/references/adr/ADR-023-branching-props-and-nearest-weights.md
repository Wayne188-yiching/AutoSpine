<!-- Generated from docs/adr/ADR-023-branching-props-and-nearest-weights.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-023 — branching props: chains grown from a joint, nearest-bone weights, mirrored meshes

Context: the GoldTree prop (2026-10-14) passed the automated acceptance in sample with rigid regions only: 32 bones, 0 meshes. Its review video and Spine file showed what the numbers did not:

|                   | Artist                                           | First build  |
| ----------------- | ------------------------------------------------ | ------------ |
| Bones             | 180 (depth 15)                                   | 32 (depth 3) |
| Weighted meshes   | 206                                              | none         |
| Trunk             | 2 bones, 29-vertex mesh                          | one bone     |
| Each bough        | a root plus a 4-bone chain, 36-vertex mesh       | one bone     |
| Each leaf cluster | a root plus 4 control bones, ~41-vertex mesh     | one bone     |
| Each coin         | a 5-bone chain hung from a bough, 58-vertex mesh | one bone     |

Three things blocked an artist-level structure:

- **Chain direction.** `chain.from` only offered `top` / `bottom`, which on a horizontal strand mean left / right. A bough must grow from the trunk side, whichever side that is.
- **Multi-bone weights for blobs.** A leaf cluster is driven by several bones that do not form a chain. Chain, gradient and dome weights do not fit.
- **Mirrored placements.** Artists reuse a flipped image (a negative determinant). `toWorldMesh` kept the image-space winding, so 43 of the GoldTree's meshes were invalid for Spine (`SPINE_MESH`).

Decision:

- **`chain.near`** (a joint reference): the chain starts at the strand end nearest that joint and overrides `from`, for example `near: "trunkTop"` for a bough. Lint checks the joint.
- **`weights: { type: "nearest", bones, maxInfluences?, smoothing? }`**:
  - Inverse-distance weights to the segments of the listed bones only, with up to 4 influences (default 4).
  - Smoothed over the mesh adjacency (default 2 passes).
  - `solveWeightsV1` gains a `bones` filter. Lint checks the bones.
- **Mirrored placements**: a part whose affine has a negative determinant gets reversed triangle winding and hull order in world space.
- **Prop rig template** (skill and `docs/CHARACTER_PLAN.md`):
  - Trunk: a 2-bone chain with a weighted mesh.
  - Boughs: 4-bone chains `near` the trunk top, with chain-weighted meshes.
  - Leaf clusters: a root at the inner end pointing to the centroid, plus 4 short control bones half to three quarters of the way to the cluster's extremes, with `nearest` weights.
  - Hanging ornaments: 4–5-bone chains from the top, parented to the bough bone nearest their hanging point, with chain-weighted meshes (blend 0.45).
  - Glows, sparks and halos: transfer weights from the part they ride.
  - Motion: trunk sway, bough waves, cluster sway and control-bone flutter, ornament chain waves.

Evidence:

- **`tests/character-branching.test.ts`** (3 tests):
  - A chain `near` the hair tip climbs instead of descending, and an unknown joint is reported.
  - `nearest` weights use only the listed bones, with the upper arm dominant at the top and the forearm at the bottom. An unknown bone is reported.
  - A mirrored arm builds (it failed before) with non-degenerate triangles over its placed rectangle.
- **GoldTree, in sample** (`docs/local-reviews/blind-tests/2026-10-14-goldtree-e2e/work3`, parameters tuned against the artist version):
  - Structure:

    |                 | Artist                    | Build                     |
    | --------------- | ------------------------- | ------------------------- |
    | Bones           | 180                       | 142 (depth 12)            |
    | Weighted meshes | 206                       | 206                       |
    | Boughs          | 36 vertices, 4 bones      | 36 vertices, 4 bones      |
    | Leaf clusters   | mean 41 vertices, 5 bones | mean 41 vertices, 5 bones |
    | Coins           | 58 vertices, 5 bones      | 45 vertices, 5 bones      |

  - Acceptance: all 11 automated criteria pass, and A5 too. Seam drift is 8.1 px; stretch is 0.268 against the artist's 0.267; D1 is 5/7; D2 is 0.98.
  - The review video shows comparable wireframes and skeletons.
  - Two tuning steps came from the build itself:
    - Coins hung on the crown drifted 19 px from their bough until parented to the bough.
    - Clusters pivoting at their centroid barely moved until pivoted at their inner end.

Consequences:

- Props built from many small parts can reach the artist's rig and mesh density from the images-only layout.
- The template's numbers are from one tree, so the next unseen prop is its first real test.
- Rollback: drop `near`, `nearest` and the mirror handling. Mirrored parts then need regions.
