# ADR-014 — joint-plane chain weights shared across limb images

Context: v17 bound each limb image to one bone. Where a sleeve image and a forearm image overlap at the elbow, a bend makes the two copies of the overlap separate by roughly distance-from-joint × angle. In the reviewed engine build, the larger ADR-011 motion separated them by up to 52–72 px at the elbows (`in`) and 41–67 px at the knees (idle2). Sharing `solveChainWeights` between overlapping images did not fix this, for two reasons:

- Its nearest-segment projection jumps between bones on the inner side of a bent joint. The cat's setup elbows and knees are bent by about 65–70°, so overlapping images received different weights there.
- One blend width was checked against every segment, so the elbow's band had to fit the short wrist.

Decision:

- `solveChainWeights` blends each joint by signed distance to the joint plane, the bisector of the joint's two bones. The field is linear in position and continuous on both sides of a bent joint. For a straight chain it equals the previous along-the-chain blend, and the existing tests pass unchanged.
- `blendWidth` may be a single number, as before, or one width per joint. Each width may be at most half of both adjacent segments.
- `measureOverlapDrift(a, b)` pins each vertex of one mesh that lies inside the other to that surface point and reports how far the two posed copies separate. It is a seam QA metric for joints, glows and any other overlap.
- Images that meet at a joint share one chain and one set of widths, so they get identical weights wherever they overlap. Pieces that only sit over a joint keep their own bones. The hand-made cat does the same: gradient legs, rigid paws over the wrist. In the reviewed build, a paw solved on the arm chain picked up upper-arm weights because, in setup, it reaches back toward the elbow.

Evidence: `tests/limb-weights.test.ts`. On a straight joint with offset lattices, shared weights separate 0.15 px against 7.98 px for one-bone images. At a 70° elbow, adjacent pixels on the inner side differ by at most 0.031 in weight (smoothstep bound 0.0375), and the shared images separate 0.027 px against 16.9 px for one-bone images. Per-joint width validation and the drift metric's error codes are also covered.

Local mummy-cat build, with 0.4 × the shorter neighbouring bone per joint:

| Seam drift (px)    | idle2 elbow L / R | idle2 knee L / R | `in` elbow L / R | `in` knee L / R |
| ------------------ | ----------------- | ---------------- | ---------------- | --------------- |
| one bone per image | 6.5 / 7.4         | 41.4 / 67.0      | 52.1 / 72.4      | 20.1 / 32.7     |
| shared joints      | 0.9 / 0.8         | 6.7 / 10.7       | 7.2 / 7.8        | 3.3 / 5.2       |

Wrists stay rigid in both builds because the paws cover them. Triangle flips are 0 in idle2 and 2 in `in` (lower right leg, under the stage mask), against 0 and 0 with one bone per image.

Trade-offs found:

- Narrower bands fold more: at 0.15, up to 11 flips.
- Adding an interior point lattice cuts the remaining drift to about 0.2–3.5 px but folded 56–173 triangles. The lattice was inserted by triangle splitting, so it may form slivers; whether the folds come from those slivers or from linear blend skinning itself was not determined. The default therefore keeps the contour mesh.
- Glow points on the now-deforming legs stray up to 8.3 px from their surface, against 2.3 px before, because the leg source meshes are coarse.

Consequences: limb images can overlap generously and stay joined through bends. Seam quality depends on mesh resolution across the band. Better-shaped refinement (edge flips or Delaunay insertion) would let the lattice help without folding. On this character the legs sit under the stage mask and the paws cover the elbows, so the visible gain is small; the metric gain applies to any character with exposed joints. Rollback: restore nearest-segment projection and the single width, and remove the drift metric.
