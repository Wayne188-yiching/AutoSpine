import earcut from "earcut";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { signedArea2, traceContour, type Point } from "./contour.js";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function strictlyInside(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!,
      b = polygon[(index + 1) % polygon.length]!;
    if (
      Math.abs(cross(a, b, point)) < 1e-9 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1])
    )
      return false;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const x = a[0] + ((point[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x > point[0]) inside = !inside;
    }
  }
  return inside;
}

function canonicalTriangle(indices: [number, number, number]): [number, number, number] {
  const smallest = Math.min(...indices);
  const offset = indices.indexOf(smallest);
  return [indices[offset]!, indices[(offset + 1) % 3]!, indices[(offset + 2) % 3]!];
}

function splitAtCentroid(
  points: Point[],
  triangles: [number, number, number][],
  target: number,
): void {
  const [a, b, c] = triangles[target]!;
  const index = points.length;
  points.push([
    (points[a]![0] + points[b]![0] + points[c]![0]) / 3,
    (points[a]![1] + points[b]![1] + points[c]![1]) / 3,
  ]);
  triangles.splice(target, 1, [a, b, index], [b, c, index], [c, a, index]);
}

/** Build a single simple raster-part mesh. No bones, weights, or Spine JSON are produced. */
export function generateMesh(part: AssetPart, alpha: Uint8Array): MeshSpec {
  const mask = part.alphaMask;
  if (!mask || mask.encoding !== "rle8")
    failMesh("ALPHA_MISSING", "Part must include a Gate 2 alpha mask");
  const { width, height } = mask;
  if (
    !Number.isFinite(part.bounds.x) ||
    !Number.isFinite(part.bounds.y) ||
    !Number.isFinite(part.bounds.width) ||
    !Number.isFinite(part.bounds.height) ||
    part.bounds.width <= 0 ||
    part.bounds.height <= 0
  )
    failMesh("PART_BOUNDS", "Part display bounds must be finite and positive");
  const outline = traceContour(alpha, width, height);
  const points: Point[] = [...outline];
  const flat = outline.flatMap((point) => point);
  const raw = earcut(flat);
  if (raw.length < 3 || raw.length % 3 !== 0 || raw.length !== (outline.length - 2) * 3)
    failMesh("TRIANGULATION", "Outer polygon could not be fully triangulated");
  const triangles: [number, number, number][] = [];
  for (let index = 0; index < raw.length; index += 3) {
    const triangle: [number, number, number] = [raw[index]!, raw[index + 1]!, raw[index + 2]!];
    if (cross(points[triangle[0]]!, points[triangle[1]]!, points[triangle[2]]!) < 0)
      [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
    triangles.push(triangle);
  }
  if (
    Math.abs(
      triangles.reduce((sum, [a, b, c]) => sum + cross(points[a]!, points[b]!, points[c]!), 0) -
        signedArea2(outline),
    ) > 1e-8
  )
    failMesh("TRIANGULATION", "Triangulation area differs from contour area");

  // A bounded, uniform raster grid gives editable interior vertices without joint inference.
  const foreground = alpha.reduce((count, value) => count + Number(value > 0), 0);
  const spacing = Math.max(4, Math.ceil(Math.sqrt(foreground / 256)));
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      if (points.length >= 2560) failMesh("MESH_COMPLEXITY", "Mesh exceeds vertex budget");
      const point: Point = [x, y];
      if (!strictlyInside(point, outline) || alpha[Math.floor(y) * width + Math.floor(x)] === 0)
        continue;
      let target = -1;
      for (let index = 0; index < triangles.length; index++) {
        const [a, b, c] = triangles[index]!;
        const ab = cross(points[a]!, points[b]!, point);
        const bc = cross(points[b]!, points[c]!, point);
        const ca = cross(points[c]!, points[a]!, point);
        // Skip a grid point on an existing edge, avoiding nonconforming T-junctions.
        if (ab > 1e-9 && bc > 1e-9 && ca > 1e-9) {
          target = index;
          break;
        }
      }
      if (target < 0) continue;
      const index = points.length;
      points.push(point);
      const [a, b, c] = triangles[target]!;
      triangles.splice(target, 1, [a, b, index], [b, c, index], [c, a, index]);
    }
  }
  if (points.length === outline.length && foreground > 4) {
    const target = triangles.reduce(
      (best, triangle, index) =>
        cross(points[triangle[0]]!, points[triangle[1]]!, points[triangle[2]]!) >
        cross(
          points[triangles[best]![0]]!,
          points[triangles[best]![1]]!,
          points[triangles[best]![2]]!,
        )
          ? index
          : best,
      0,
    );
    splitAtCentroid(points, triangles, target);
  }
  while (true) {
    let target = -1,
      largestArea = 512;
    for (let index = 0; index < triangles.length; index++) {
      const [a, b, c] = triangles[index]!;
      const area = cross(points[a]!, points[b]!, points[c]!) / 2;
      if (area > largestArea) {
        largestArea = area;
        target = index;
      }
    }
    if (target < 0) break;
    if (points.length >= 2560) failMesh("MESH_COMPLEXITY", "Mesh exceeds vertex budget");
    splitAtCentroid(points, triangles, target);
  }
  const ordered = triangles
    .map(canonicalTriangle)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const mesh: MeshSpec = {
    schemaVersion: "0.1",
    kind: "mesh",
    id: `${part.id}-mesh`,
    name: `${part.name} Mesh`,
    sourcePartId: part.id,
    vertices: points.map(([x, y]) => [
      part.bounds.x + (x * part.bounds.width) / width,
      part.bounds.y + (y * part.bounds.height) / height,
    ]),
    uvs: points.map(([x, y]) => [x / width, y / height]),
    triangles: ordered.flatMap((triangle) => triangle),
    hull: outline.map((_, index) => index),
  };
  const validation = validateMeshSpec(mesh);
  if (validation.status === "error") throw new MeshError(validation);
  return mesh;
}
