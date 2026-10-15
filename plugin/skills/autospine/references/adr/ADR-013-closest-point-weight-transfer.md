<!-- Generated from docs/adr/ADR-013-closest-point-weight-transfer.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-013 — closest-point weight transfer for riding attachments

Context: v17 kept all 17 blurred outline images (`*ss` glows) as rigid regions on one bone, while the parts under them bend across several bones. As soon as a tail or arm curved, its glow separated from it. That effectively capped how far the motion could go: v17's tail glow already strayed 29 px from the tail surface. With the larger ADR-011 entrance it strays 77 px when left rigid. The hand-made file rigs its glows as meshes on the same bones as the parts they outline.

Decision: add `transferWeights(target, rig, sources, maxInfluences = 4)` in `packages/weights/src/transfer.ts`.

- Each target vertex finds the closest point on any source triangle (Ericson's closest-point-on-triangle test) and takes the barycentric blend of that triangle's vertex weights. It keeps the strongest influences and renormalizes.
- Vertices inside a source take its interpolated weights; vertices outside every source (a glow's blurred margin) take the nearest edge point's.
- Under bone translation the target follows the source surface exactly, because linear blend skinning is affine in the weights when all bones share one linear part. Under rotation the mismatch is second order in source triangle size.
- Multiple sources are supported, so an outline spanning separate parts takes the nearest one. Work is bounded at 20 M vertex-triangle tests.

Choosing the source and building the target mesh stay with the caller. In the reviewed build, each glow becomes a grid mesh over its image with cells of about 40 px. Its source is the mesh of the matching base slot (glow slot name minus the trailing `s`) whose world bounds overlap the glow's most. Glows over rigid region parts stay regions, which is already correct.

Evidence: `tests/weight-transfer.test.ts`.

- Under bone translation, transferred points stay on the source surface to 1e-9.
- Under a 25° + 25° bend, the transferred glow stays within 0.30 px of the surface while a rigid glow strays 28.4 px.
- Outside points take the nearest edge's weights; nearest-source selection, the influence limit and error codes are covered.

In the local mummy-cat review, the engine build converted all 17 glows. Glow points pinned to their base surfaces at setup stray at most 2.3 px in idle2 and 5.0 px in `in` (ears), against 50.4 px and 77.3 px for the same build with rigid glows. The output imports and exports through the Spine 4.0.64 editor with the same alignment.

Consequences: outlines, shadows and other attachments that ride a part can share its deformation without hand weighting. Accuracy follows the source's triangle size, so coarse sources (for example the 19-vertex ears) show a few pixels of error on large bends. Rollback: remove the module and its export.
