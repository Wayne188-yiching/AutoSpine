import { Value } from "@sinclair/typebox/value";
import {
  MeshSpecSchema,
  type MeshSpec,
  type ValidationIssue,
  type ValidationReport,
} from "@autospine/schemas";

type Point = [number, number];

function issue(code: string, reason: string): ValidationIssue {
  return { code, stage: "mesh", severity: 3, reason };
}

function report(issues: ValidationIssue[]): ValidationReport {
  return {
    schemaVersion: "0.1",
    kind: "validation-report",
    id: "mesh-gate-3",
    status: issues.length ? "error" : "passed",
    issues,
  };
}

export class MeshError extends Error {
  constructor(readonly validation: ValidationReport) {
    super(validation.issues.map((entry) => entry.reason).join("; "));
    this.name = "MeshError";
  }
}

export function failMesh(code: string, reason: string): never {
  throw new MeshError(report([issue(code, reason)]));
}

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function polygonArea2(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!,
      b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

function onSegment(a: Point, b: Point, p: Point, lengthEps: number, areaEps: number): boolean {
  return (
    Math.abs(cross(a, b, p)) <= areaEps &&
    p[0] >= Math.min(a[0], b[0]) - lengthEps &&
    p[0] <= Math.max(a[0], b[0]) + lengthEps &&
    p[1] >= Math.min(a[1], b[1]) - lengthEps &&
    p[1] <= Math.max(a[1], b[1]) + lengthEps
  );
}

function segmentsMeet(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  lengthEps: number,
  areaEps: number,
): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (
    onSegment(a, b, c, lengthEps, areaEps) ||
    onSegment(a, b, d, lengthEps, areaEps) ||
    onSegment(c, d, a, lengthEps, areaEps) ||
    onSegment(c, d, b, lengthEps, areaEps)
  )
    return true;
  return (
    ((abC > areaEps && abD < -areaEps) || (abC < -areaEps && abD > areaEps)) &&
    ((cdA > areaEps && cdB < -areaEps) || (cdA < -areaEps && cdB > areaEps))
  );
}

function insidePolygon(point: Point, polygon: Point[], eps: number, areaEps: number): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!,
      b = polygon[(index + 1) % polygon.length]!;
    if (onSegment(a, b, point, eps, areaEps)) return true;
    const aboveA = a[1] > point[1],
      aboveB = b[1] > point[1];
    if (aboveA !== aboveB) {
      const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x > point[0]) inside = !inside;
    }
  }
  return inside;
}

/** Independent topology checks; accepting a schema shape alone is insufficient. */
export function validateMeshSpec(value: unknown): ValidationReport {
  if (!Value.Check(MeshSpecSchema, value))
    return report([issue("MESH_SCHEMA", "MeshSpec shape is invalid")]);
  const mesh = value as MeshSpec;
  const issues: ValidationIssue[] = [];
  const add = (code: string, reason: string): void => {
    if (issues.length < 30 && !issues.some((entry) => entry.code === code))
      issues.push(issue(code, reason));
  };
  const vertices = mesh.vertices as Point[];
  if (vertices.length > 4096 || mesh.triangles.length > 24_576 || mesh.hull.length > 2048)
    return report([issue("MESH_COMPLEXITY", "Mesh exceeds Gate 3 validation limits")]);
  if (mesh.uvs.length !== vertices.length) add("UV_COUNT", "UV and vertex counts differ");
  if (
    vertices.some((point) => !point.every(Number.isFinite)) ||
    mesh.uvs.some((point) => !point.every(Number.isFinite))
  )
    return report([issue("NONFINITE", "Mesh coordinates and UVs must be finite")]);
  if (mesh.uvs.some(([u, v]) => u < 0 || u > 1 || v < 0 || v > 1))
    add("UV_RANGE", "UVs must be in [0, 1]");
  let extent = 1;
  if (vertices.length) {
    const xs = vertices.map((point) => point[0]);
    const ys = vertices.map((point) => point[1]);
    extent = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  const lengthEps = extent * 1e-9,
    areaEps = extent * extent * 1e-12;
  for (let left = 0; left < vertices.length; left++) {
    for (let right = left + 1; right < vertices.length; right++) {
      if (
        Math.hypot(
          vertices[left]![0] - vertices[right]![0],
          vertices[left]![1] - vertices[right]![1],
        ) <= lengthEps
      ) {
        add("DUPLICATE_VERTEX", "Two mesh vertices share a position");
        break;
      }
    }
    if (issues.some((entry) => entry.code === "DUPLICATE_VERTEX")) break;
  }
  if (mesh.triangles.length % 3 !== 0)
    add("TRIANGLE_INDEX_COUNT", "Triangle index count must be divisible by three");
  if (
    mesh.triangles.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= vertices.length,
    ) ||
    mesh.hull.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)
  )
    return report([...issues, issue("INVALID_INDEX", "Mesh references a missing vertex")]);
  if (mesh.hull.length < 3 || new Set(mesh.hull).size !== mesh.hull.length)
    return report([...issues, issue("HULL_INVALID", "Hull must list distinct boundary vertices")]);

  const hull = mesh.hull.map((index) => vertices[index]!);
  const hullArea2 = polygonArea2(hull);
  if (hullArea2 <= areaEps) add("HULL_AREA", "Hull must have positive nonzero area");
  for (let left = 0; left < hull.length; left++) {
    const a = hull[left]!,
      b = hull[(left + 1) % hull.length]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= lengthEps)
      add("HULL_EDGE", "Hull has a zero-length edge");
    for (let right = left + 1; right < hull.length; right++) {
      if (right === left + 1 || (left === 0 && right === hull.length - 1)) continue;
      if (segmentsMeet(a, b, hull[right]!, hull[(right + 1) % hull.length]!, lengthEps, areaEps)) {
        add("HULL_SELF_INTERSECTION", "Hull boundary crosses or touches itself");
        break;
      }
    }
  }

  type EdgeUse = { triangle: number; from: number; to: number };
  const edges = new Map<string, EdgeUse[]>();
  const used = new Set<number>();
  const triangleKeys = new Set<string>();
  let areaSum2 = 0;
  for (let position = 0; position + 2 < mesh.triangles.length; position += 3) {
    const indices = mesh.triangles.slice(position, position + 3);
    const [a, b, c] = indices as [number, number, number];
    if (new Set(indices).size < 3) {
      add("DEGENERATE_TRIANGLE", "Triangle repeats a vertex index");
      continue;
    }
    const identity = [...indices].sort((x, y) => x - y).join(":");
    if (triangleKeys.has(identity)) add("DUPLICATE_TRIANGLE", "A triangle is repeated");
    triangleKeys.add(identity);
    const triangleArea2 = cross(vertices[a]!, vertices[b]!, vertices[c]!);
    if (triangleArea2 <= areaEps)
      add("DEGENERATE_TRIANGLE", "Triangle has zero area or wrong winding");
    areaSum2 += triangleArea2;
    const centroid: Point = [
      (vertices[a]![0] + vertices[b]![0] + vertices[c]![0]) / 3,
      (vertices[a]![1] + vertices[b]![1] + vertices[c]![1]) / 3,
    ];
    if (!insidePolygon(centroid, hull, lengthEps, areaEps))
      add("TRIANGLE_OUTSIDE", "Triangle lies outside the hull");
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      used.add(from!);
      used.add(to!);
      const key = `${Math.min(from!, to!)}:${Math.max(from!, to!)}`;
      const uses = edges.get(key) ?? [];
      uses.push({ triangle: position / 3, from: from!, to: to! });
      edges.set(key, uses);
    }
  }
  if (used.size !== vertices.length) add("UNUSED_VERTEX", "Mesh contains a vertex in no triangle");
  const hullEdges = new Set<string>();
  for (let index = 0; index < mesh.hull.length; index++) {
    const a = mesh.hull[index]!,
      b = mesh.hull[(index + 1) % mesh.hull.length]!;
    hullEdges.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
  }
  const adjacency = Array.from(
    { length: Math.floor(mesh.triangles.length / 3) },
    () => [] as number[],
  );
  for (const [key, uses] of edges) {
    if (uses.length > 2) add("NONMANIFOLD_EDGE", "An edge belongs to more than two triangles");
    if (hullEdges.has(key)) {
      if (uses.length !== 1) add("BOUNDARY_MISMATCH", "Hull edge must belong to one triangle");
    } else if (uses.length !== 2) {
      add("BOUNDARY_MISMATCH", "Triangle boundary does not match the declared hull");
    }
    if (uses.length === 2) {
      if (uses[0]!.from !== uses[1]!.to || uses[0]!.to !== uses[1]!.from)
        add("EDGE_WINDING", "Shared edge directions are inconsistent");
      adjacency[uses[0]!.triangle]!.push(uses[1]!.triangle);
      adjacency[uses[1]!.triangle]!.push(uses[0]!.triangle);
    }
  }
  if ([...hullEdges].some((key) => !edges.has(key)))
    add("BOUNDARY_MISMATCH", "Declared hull edge is missing from triangles");
  if (adjacency.length) {
    const reached = new Set([0]);
    const queue = [0];
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of adjacency[queue[index]!]!) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (reached.size !== adjacency.length)
      add("DISCONNECTED_MESH", "Triangles do not form one edge-connected surface");
  }
  if (Math.abs(areaSum2 - hullArea2) > Math.max(areaEps, Math.abs(hullArea2) * 1e-8))
    add("AREA_MISMATCH", "Triangle area does not equal hull area");

  // Crossing, overlap, and T-junction checks are bounded by the vertex limit above.
  const uniqueEdges = [...edges.keys()].map(
    (key) => key.split(":").map(Number) as [number, number],
  );
  outer: for (let left = 0; left < uniqueEdges.length; left++) {
    const [a, b] = uniqueEdges[left]!;
    for (let right = left + 1; right < uniqueEdges.length; right++) {
      const [c, d] = uniqueEdges[right]!;
      if (a === c || a === d || b === c || b === d) {
        const shared = a === c || a === d ? a : b;
        const otherLeft = a === shared ? b : a;
        const otherRight = c === shared ? d : c;
        if (
          onSegment(
            vertices[shared]!,
            vertices[otherRight]!,
            vertices[otherLeft]!,
            lengthEps,
            areaEps,
          ) ||
          onSegment(
            vertices[shared]!,
            vertices[otherLeft]!,
            vertices[otherRight]!,
            lengthEps,
            areaEps,
          )
        ) {
          add("EDGE_OVERLAP", "Mesh edges overlap or form a T-junction");
          break outer;
        }
        continue;
      }
      if (
        segmentsMeet(vertices[a]!, vertices[b]!, vertices[c]!, vertices[d]!, lengthEps, areaEps)
      ) {
        add("EDGE_CROSSING", "Mesh edges cross or form a T-junction");
        break outer;
      }
    }
  }
  return report(issues);
}
