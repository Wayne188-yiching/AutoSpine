<!-- Generated from docs/adr/ADR-041-artist-wiring-rules.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-041 — artist wiring from the outline and the bones

Status: Accepted
Date: 2026-10-20
Supersedes: the vertex budget of ADR-024 and ADR-038 (hull round(√s), interior round(s / 80))

## Context

The requester says the meshes' wiring (佈線) still does not look like artist work. ADR-024 set the hull to round(√s) points with s = √(width × height) px and filled the interior with a uniform lattice; ADR-038 made that the default. Both read only the image size, and ignore the outline's shape and the bones.

A survey of 205 artist meshes (Yuuna, Panda, Pig and two Wild West asset-pack characters; local, not committed) measured:

- **Hull count.** Image size barely predicts it: log correlation 0.21 overall, −0.02 on single-outline parts. The outline simplified by Douglas-Peucker at 3 % of s predicts it far better: correlation 0.64, median artist / outline ratio 1.00.
- **Deformation.** Rigid or unweighted parts have about 0.67 times the outline's corners and no interior points. Parts on 1–2 bones have about 0.9 times. Parts on 3 or more bones have about 1.5 times, with a median of 5–7 interior points.
- **Interior points** sit nearer the bone joints than random points do (median percentile 0.37). They do not sit on colour edges (0.49, the same as random), and they are not a lattice (nearest-neighbour CV 0.25). Blended-weight vertices sit 0.34 of the mesh size from a joint, against 0.47 for single-bone vertices.
- **Triangulation.** 97–99 % of the artists' free interior edges are locally Delaunay in the Spine 3.8 and 4.0 files.

## Decision

`generateFeatureMesh` takes `bones`: the bones that weight the part, in image pixels (origin and tip), each marked `joint` when its parent also weights the part. `[]` means rigid. With `bones`, and no explicit counts:

- **Hull count.** Take the largest opaque piece (alpha above 8, holes filled), trace its outline, and simplify it by Douglas-Peucker at 0.03 × √(width × height) px. Multiply its corners by 0.67 with no bones, 0.9 with one or two, and 1.5 with three or more.
- **Hull placement.** Covering is unchanged (ADR-024). The traced outline of the opaque pixels, grown by 1 px, is reduced to that count by the cheapest area step. Every opaque pixel centre stays covered and the vertices land on corners. With fewer vertices, the polygon overshoots at its corners, so its vertices sit a median of 4 px from the opaque pixels (the artists' 3 px). A step never grows the hull over an opaque fragment that was dropped (ADR-039), so the hull's few corners cannot reach a neighbour's sliver. When that keeps the hull above its count, the hull is fitted again without the guard: Yuuna's sun-ray effects are scattered rays, each under 2 %, and the artist wraps them all in one 4-point quad.
- **Opaque threshold.** A rule hull covers alpha above 8, the threshold `discarded` already used. A faint fringe (alpha 1–8) spiked the outline and doubled the corner count on the Panda.
- **Interior.** A rigid part, or one on a single bone, gets none. A part on two or more bones gets rows of points:
  - one row through each joint inside the hull;
  - one row halfway along each bone longer than two mean hull edges.

  Each row is the line across the part, square to the bone. Its span inside the hull is split into pieces about one hull edge long. Points closer than half an edge to the hull or to an earlier point are dropped. The uniform lattice is gone from this path.

- **Triangulation.** Unchanged: earcut, then min-angle (Lawson) flips, which give the Delaunay triangulation away from locked rings.
- **Overrides.** Explicit `hullVertices` replaces the hull count, and explicit `interiorVertices` replaces the rows with the lattice search (as before). `density: "fine"` / `spacing` / `edgeLength` are the fine lattice, and `keepHoles` is as in ADR-038. A caller that gives only `hullVertices` (the engine tool `autospine_feature_mesh`) keeps its old interior.

The character build (`packages/character/src/attachments.ts`) passes `bones` for every `feature` mesh that is not fine:

- **Plan meshes** take the bones their weights will use: `chain` (its bones), `gradient` (from, to), `nearest` (its bones), `dome` (base, control, counter), `transfer` (the bones in its sources' weights, plus proxies), and `rigid` (none). Bone frames are mapped into the image through the inverse placement.
- **`meshing.all` and `meshing.parts`** regions are rigid: `[]`.

`artistBudget` is removed.

## Evidence

`tools/artist-wiring-check.mjs` rebuilds every artist mesh of a Spine 3.8/4.0 export from its PNG. It passes the artist skeleton's bones that weight that mesh, mapped into the image by a least-squares fit of the mesh's setup vertices to its UVs. It then scores the result against the artist mesh with `tools/reference-topology.mjs`:

- **Hull error:** |generated − artist| / artist hull count.
- **Position:** the symmetric mean nearest-vertex distance over all vertices, as a share of the PNG diagonal.
- **Hull max:** `compareVertexPositions`' bottleneck hull distance.
- **Edge recall:** `compareTypedEdges`, hull and automatic. The Pig's 3.8 export has no `edges`, so its automatic recall covers all interior edges.

"Before" is the ADR-024 budget passed as explicit counts, on b034bef, which is what `density: "artist"` and `meshing.all` built. "After" is this change. Corpus: Panda (`panda/_work/input/export/panda.json`), Pig (`pig/pig.json`) and Yuuna (`Character_Yuuna_03.reference-export.json`), with their images.

Over the 157 meshes both runs built:

| Corpus (meshes) | Run    | Hull error, median / mean | Hull within 25 % | Interior count error, median | Position, % diagonal, median / mean | Hull max, % diagonal, median | Hull edge recall | Automatic edge recall | Padding px, artist / generated |
| --------------- | ------ | ------------------------- | ---------------- | ---------------------------- | ----------------------------------- | ---------------------------- | ---------------- | --------------------- | ------------------------------ |
| Panda (42)      | before | 0.15 / 0.23               | 64 %             | 1                            | 9.30 / 9.38                         | 25.61                        | 0.55             | 0.28                  | 2.5 / 5.3                      |
|                 | after  | 0.27 / 0.29               | 50 %             | 2                            | 10.98 / 10.98                       | 23.51                        | 0.43             | 0.04                  | 2.5 / 4.5                      |
| Pig (48)        | before | 0.46 / 0.44               | 25 %             | 5                            | 9.60 / 10.00                        | 22.24                        | 0.28             | 0.06                  | 0.7 / 4.2                      |
|                 | after  | 0.19 / 0.34               | 58 %             | 5                            | 8.17 / 8.26                         | 26.58                        | 0.45             | 0.18                  | 0.7 / 3.5                      |
| Yuuna (67)      | before | 0.42 / 1.25               | 31 %             | 2                            | 6.33 / 8.81                         | 14.04                        | 0.34             | 0.11                  | 4.5 / 4.3                      |
|                 | after  | 0.30 / 0.55               | 42 %             | 0                            | 5.37 / 7.02                         | 14.70                        | 0.56             | 0.21                  | 4.5 / 4.1                      |
| **All (157)**   | before | 0.35 / 0.73               | 38 %             | 2                            | 8.85 / 9.33                         | 19.72                        | 0.38             | 0.14                  | 2.8 / 4.3                      |
|                 | after  | **0.28 / 0.41**           | **49 %**         | 2                            | **7.84 / 8.46**                     | 19.94                        | **0.49**         | **0.16**              | 2.8 / 3.9                      |

- **Interior counts by weighting bones**, artist / generated medians:

  | Bones  | 0     | 1     | 2     | 3–4   | 5+    |
  | ------ | ----- | ----- | ----- | ----- | ----- |
  | Before | 1 / 2 | 0 / 0 | 2 / 0 | 6 / 2 | 5 / 2 |
  | After  | 1 / 0 | 0 / 0 | 3 / 0 | 6 / 4 | 5 / 7 |

  Many 2-bone parts have no joint inside them (a face on base and control, an eyelid whose child bone starts outside it).

- **Meshes the mesher rejected.** Before: 6 (Pig `1_Head`, `2_ear_R`, `1_bow`, `2_bow`, `2_arrow`; Yuuna's 2.6-megapixel `SunFront`). After: 4 (`1_arrow2` instead of `1_Head`, `2_ear_R` and `2_arrow`). A rejected `meshing.all` part stays a region (`meshingSkipped`).
- **Constants.** PAD 1 px and LONG_BONE 2 hull edges were chosen on this corpus, against 0 px (position 7.68 %, but 7 meshes rejected) and 4 hull edges (2 interior points for 3–4 bones). The counts' factors are the survey's.
- **Delaunay.** 100 % of the generated meshes' free interior edges are locally Delaunay, against the artists' 97 % (Panda, Pig) and 99 % (Yuuna).
- **Speed.** 20–40 ms a mesh, median.

- `tests/artist-density.test.ts`:
  - The same ellipse at 1× and 4× size keeps its hull count; a star of the same size gets more.
  - 0, 1 and 3 bones order the counts, and each hull covers every opaque pixel.
  - A rigid part has no interior points. A 3-bone chain's interior points all lie on rows at its joints or mid-bone, and every free edge is locally Delaunay.
  - The eye socket kept as a ring.
  - The ADR-039 sliver is never covered.
  - The fixture head (dome weights) gets more hull vertices than a rigid part, and fewer than half the fine lattice's vertices.
- `tests/character-restpose.test.ts`: a `meshing.all` region has the rigid hull count and no interior points.
- `tests/character-deforms.test.ts`: the squint moves the outline 6 × 2/3 px (the hull sits 1 px outside the opaque edge), not 5 × 2/3.

## Consequences

- A part's vertex count follows its outline and how it bends, not its pixel size. A large plain shape gets few vertices; a small jagged one gets more. A chain-weighted strand gets rows at its joints, where the blend falls.
- **Panda: worse on both counts.** The ADR-024 size budget happened to fit the Panda's hulls (0.15 median error), and the outline rule fits them less well (0.27). Its position error also rises: its unweighted pseudo-3D parts carry 1–3 interior points each (eyes 27, nose 17), presumably for deform keys, and the rigid rule gives none. Such parts belong in `meshing.parts` with explicit counts (ADR-037). The Pig and Yuuna, and the corpus as a whole, improve.
- **Hull max** (the worst hull vertex) did not improve (19.7 → 19.9 % median). With few vertices, one corner of a covering hull still sits far out.
- **Not yet measured.** A full Pig or Yuuna rebuild from a plan, against its artist file (B1 inversions and B3 stretch with the new rows).
- **Hull padding.** The hull sits a median of 1 px further out than the old covering hull's opaque edge. Numbers measured at the outline (deform keys, B3 stretch) move by about that much.
- **Rows only from known bones.** Interior rows need bones known before the weights are solved. A `transfer` mesh takes every bone in its sources, which may overcount.
- **Amended by ADR-042 (2026-10-21).** Parts deformed by keys bend too, and every part that bends gets spread points up to an area rule after its joint rows.
- **Amended by ADR-043 (2026-10-21).** The fitted hull is evened out: no hull edge under half the mean where a covering step can remove it. The cheapest-area fit packed points into notches; on the ThreePigWC wolf's pants a 16 px crotch edge stretched 3.26 in the idle (B1, B3 failed).
- **Rollback.** Drop `bones` from the caller and restore `artistBudget`; the engine without `bones` behaves as before, except that a budget hull now covers alpha above 8, is padded 1 px and avoids dropped fragments.
