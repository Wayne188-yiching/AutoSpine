import type { MeshSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

export interface DeformationMetrics {
  inversionCount: number;
  minAreaRatio: number;
  maxEdgeStretch: number;
  maxSeamGap: number;
}
export const engineeringDeformationLimits = Object.freeze({
  inversionCount: 0,
  minAreaRatio: 0.2,
  maxEdgeStretch: 2,
  maxSeamGap: 1e-8,
});
export function measureDeformation(
  mesh: MeshSpec,
  posed: [number, number][],
  seams: [number, number][] = [],
): DeformationMetrics {
  if (
    posed.length !== mesh.vertices.length ||
    posed.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
    mesh.triangles.length % 3
  )
    failStage(
      "weights",
      "DEFORMATION_INPUT",
      "Finite complete posed vertices and triangles required",
    );
  let inversionCount = 0,
    minAreaRatio = Infinity,
    maxEdgeStretch = 0,
    maxSeamGap = 0;
  const edges = new Set<string>();
  const area = (p: [number, number][]) =>
    (p[1]![0] - p[0]![0]) * (p[2]![1] - p[0]![1]) - (p[1]![1] - p[0]![1]) * (p[2]![0] - p[0]![0]);
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const tri = mesh.triangles.slice(i, i + 3);
    if (tri.some((j) => !Number.isInteger(j) || j < 0 || j >= posed.length))
      failStage("weights", "DEFORMATION_INDEX", "Invalid triangle index");
    const bind = area(tri.map((j) => mesh.vertices[j]!)),
      next = area(tri.map((j) => posed[j]!));
    if (!Number.isFinite(bind) || bind === 0 || !Number.isFinite(next))
      failStage("weights", "DEFORMATION_AREA", "Nondegenerate finite bind area required");
    const ratio = next / bind;
    if (ratio <= 0) inversionCount++;
    minAreaRatio = Math.min(minAreaRatio, ratio);
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!,
        b = tri[(k + 1) % 3]!;
      edges.add(Math.min(a, b) + ":" + Math.max(a, b));
    }
  }
  for (const edge of edges) {
    const [a, b] = edge.split(":").map(Number) as [number, number];
    const distance = (points: [number, number][]) =>
      Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1]);
    const ratio = distance(posed) / distance(mesh.vertices);
    if (!Number.isFinite(ratio))
      failStage("weights", "DEFORMATION_EDGE", "Finite nonzero bind edge required");
    maxEdgeStretch = Math.max(maxEdgeStretch, ratio);
  }
  for (const [a, b] of seams) {
    if (
      !posed[a] ||
      !posed[b] ||
      Math.hypot(
        mesh.vertices[a]![0] - mesh.vertices[b]![0],
        mesh.vertices[a]![1] - mesh.vertices[b]![1],
      ) > 1e-8
    )
      failStage("weights", "DEFORMATION_SEAM", "Seam pairs must be coincident bind vertices");
    maxSeamGap = Math.max(
      maxSeamGap,
      Math.hypot(posed[a]![0] - posed[b]![0], posed[a]![1] - posed[b]![1]),
    );
  }
  if (!Number.isFinite(minAreaRatio))
    failStage("weights", "DEFORMATION_EMPTY", "Triangles required for deformation evaluation");
  return { inversionCount, minAreaRatio, maxEdgeStretch, maxSeamGap };
}
export function deformationPasses(m: DeformationMetrics): boolean {
  return (
    Object.values(m).every(Number.isFinite) &&
    m.inversionCount === 0 &&
    m.minAreaRatio >= engineeringDeformationLimits.minAreaRatio &&
    m.maxEdgeStretch <= engineeringDeformationLimits.maxEdgeStretch &&
    m.maxSeamGap <= engineeringDeformationLimits.maxSeamGap
  );
}
