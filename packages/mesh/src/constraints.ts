import earcut from "earcut";
import type { MeshSpec } from "@autospine/schemas";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";

type Edge = [number, number];
type Point = [number, number];
const key = ([a, b]: Edge): string => `${Math.min(a, b)}:${Math.max(a, b)}`;
const cross = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Recover explicit structural edges without changing the supplied vertex positions.
 * The caller supplies feature connectivity, never inferred from a filename.
 * A crossed triangle strip is retriangulated on either side of each constraint.
 */
export function constrainMeshEdges(input: MeshSpec, requested: Edge[]): MeshSpec {
  const before = validateMeshSpec(input);
  if (before.status !== "passed") throw new MeshError(before);
  const mesh = structuredClone(input);
  const points = mesh.vertices;
  if (!Array.isArray(requested) || requested.length > 4096)
    failMesh("MESH_CONSTRAINTS", "Expected at most 4096 structural edges");
  const extent = Math.max(
    1,
    ...[0, 1].map((axis) => {
      const values = points.map((p) => p[axis]!);
      return Math.max(...values) - Math.min(...values);
    }),
  );
  const eps = extent * extent * 1e-12;
  const properCrossing = ([a, b]: Edge, [c, d]: Edge): boolean => {
    const signs = [
      cross(points[a]!, points[b]!, points[c]!),
      cross(points[a]!, points[b]!, points[d]!),
      cross(points[c]!, points[d]!, points[a]!),
      cross(points[c]!, points[d]!, points[b]!),
    ];
    return (
      ((signs[0]! > eps && signs[1]! < -eps) || (signs[0]! < -eps && signs[1]! > eps)) &&
      ((signs[2]! > eps && signs[3]! < -eps) || (signs[2]! < -eps && signs[3]! > eps))
    );
  };
  const constraints = new Map<string, Edge>();
  const hullKeys = new Set(
    mesh.hull.map((a, i) => key([a, mesh.hull[(i + 1) % mesh.hull.length]!])),
  );
  for (const edge of [...(mesh.manualEdges ?? []), ...requested]) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      edge.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= points.length) ||
      edge[0] === edge[1]
    )
      failMesh("MESH_CONSTRAINTS", "Constraint endpoints must be existing distinct vertices");
    const [a, b] = edge;
    const dx = points[b]![0] - points[a]![0],
      dy = points[b]![1] - points[a]![1];
    const length2 = dx * dx + dy * dy;
    // Split at existing vertices on the segment to prevent T-junctions.
    const along = points
      .map((p, index) => ({
        index,
        t: ((p[0] - points[a]![0]) * dx + (p[1] - points[a]![1]) * dy) / length2,
        area: Math.abs(cross(points[a]!, points[b]!, p)),
      }))
      .filter((p) => p.area <= eps && p.t >= 0 && p.t <= 1)
      .sort((x, y) => x.t - y.t || x.index - y.index);
    for (let i = 1; i < along.length; i++) {
      const segment: Edge = [along[i - 1]!.index, along[i]!.index].sort((x, y) => x - y) as Edge;
      if (hullKeys.has(key(segment)))
        failMesh("MESH_CONSTRAINT_BOUNDARY", "Structural constraints must be internal edges");
      constraints.set(key(segment), segment);
    }
  }
  const ordered = [...constraints.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++)
      if (properCrossing(ordered[i]!, ordered[j]!))
        failMesh("MESH_CONSTRAINT_CROSSING", "Structural constraints cross without a vertex");

  let triangles = Array.from({ length: mesh.triangles.length / 3 }, (_, i) =>
    mesh.triangles.slice(i * 3, i * 3 + 3),
  );
  for (const segment of ordered) {
    const edges = new Map<string, { endpoints: Edge; uses: number[] }>();
    triangles.forEach((t, i) => {
      for (let side = 0; side < 3; side++) {
        const endpoints: Edge = [t[side]!, t[(side + 1) % 3]!];
        const entry = edges.get(key(endpoints)) ?? { endpoints, uses: [] };
        entry.uses.push(i);
        edges.set(key(endpoints), entry);
      }
    });
    if (edges.has(key(segment))) continue;
    const removed = new Set<number>();
    for (const { endpoints, uses } of edges.values()) {
      if (!properCrossing(segment, endpoints)) continue;
      if (uses.length !== 2)
        failMesh("MESH_CONSTRAINT_OUTSIDE", "Constraint crosses the mesh hull");
      for (const i of uses) removed.add(i);
    }
    const boundary = new Map<number, number[]>();
    for (const {
      endpoints: [a, b],
      uses,
    } of edges.values()) {
      if (uses.filter((i) => removed.has(i)).length !== 1) continue;
      boundary.set(a, [...(boundary.get(a) ?? []), b]);
      boundary.set(b, [...(boundary.get(b) ?? []), a]);
    }
    const [start, end] = segment;
    if (
      !boundary.has(start) ||
      !boundary.has(end) ||
      [...boundary.values()].some((neighbors) => neighbors.length !== 2)
    )
      failMesh("MESH_CONSTRAINT_CAVITY", "Constraint does not define a simple triangle strip");
    const replacement: number[][] = [];
    for (const neighbor of boundary.get(start)!) {
      const chain = [start];
      let previous = start,
        current = neighbor;
      while (current !== end) {
        if (chain.includes(current) || chain.length > boundary.size)
          failMesh("MESH_CONSTRAINT_CAVITY", "Constraint strip boundary does not reach endpoint");
        chain.push(current);
        const next = boundary.get(current)!.find((i) => i !== previous)!;
        previous = current;
        current = next;
      }
      chain.push(end);
      const indices = earcut(chain.flatMap((i) => points[i]!));
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices.slice(i, i + 3).map((j) => chain[j]!);
        if (cross(points[t[0]!]!, points[t[1]!]!, points[t[2]!]!) < 0)
          [t[1], t[2]] = [t[2]!, t[1]!];
        replacement.push(t);
      }
    }
    triangles = triangles.filter((_, i) => !removed.has(i)).concat(replacement);
  }
  mesh.triangles = triangles
    .map((t) => {
      const i = t.indexOf(Math.min(...t));
      return [t[i]!, t[(i + 1) % 3]!, t[(i + 2) % 3]!];
    })
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!)
    .flat();
  mesh.manualEdges = ordered;
  const after = validateMeshSpec(mesh);
  if (after.status !== "passed") throw new MeshError(after);
  return mesh;
}
