import earcut from "earcut";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { signedArea2, simplifyContour, traceContour, type Point } from "./contour.js";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";

export interface MeshGenerationOptions {
  /** Caller-supplied purpose, never inferred from the file name. */
  intent?: "rigid" | "chain" | "unknown";
  /** Counts and normalized cross-section profile from a matched artist attachment. */
  referenceTopology?: {
    vertices: number;
    hull: number;
    bands?: { position: number; widthFraction: number }[];
  };
}

/** Geometric validity is not an approval of artistic topology or animated deformation. */
export function generateMeshWithDiagnostics(
  part: AssetPart,
  alpha: Uint8Array,
  options: MeshGenerationOptions = {},
) {
  const mesh = generateMesh(part, alpha, options);
  const intent = options.intent ?? "unknown";
  const warnings = ["DEFORMATION_NOT_VERIFIED"];
  if (intent === "unknown") warnings.push("INTENT_UNKNOWN");
  const skinnyTriangles = Array.from({ length: mesh.triangles.length / 3 }, (_, i) =>
    minimumAngle(mesh.vertices, mesh.triangles.slice(i * 3, i * 3 + 3) as [number, number, number]),
  ).filter((angle) => angle < Math.PI / 18).length;
  if (skinnyTriangles) warnings.push("SKINNY_TRIANGLES");
  const reference = options.referenceTopology;
  if (reference && Math.abs(mesh.vertices.length - reference.vertices) * 5 > reference.vertices)
    warnings.push("ARTIST_VERTEX_BUDGET_EXCEEDED");
  return {
    mesh,
    diagnostics: {
      intent,
      requiresReview: true,
      deformationVerified: false,
      skinnyTriangles,
      referenceTopology: reference,
      warnings,
    },
  };
}

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

function minimumAngle(points: Point[], [a, b, c]: [number, number, number]): number {
  const sides = [
    Math.hypot(points[b]![0] - points[c]![0], points[b]![1] - points[c]![1]),
    Math.hypot(points[c]![0] - points[a]![0], points[c]![1] - points[a]![1]),
    Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1]),
  ];
  return Math.min(
    ...sides.map((side, index) =>
      Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (sides[(index + 1) % 3]! ** 2 + sides[(index + 2) % 3]! ** 2 - side ** 2) /
              (2 * sides[(index + 1) % 3]! * sides[(index + 2) % 3]!),
          ),
        ),
      ),
    ),
  );
}

function improveTriangulation(points: Point[], triangles: [number, number, number][]): void {
  for (let pass = 0; pass < 50; pass++) {
    const edges = new Map<string, { triangle: number; opposite: number }[]>();
    triangles.forEach(([a, b, c], triangle) => {
      for (const [from, to, opposite] of [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ]) {
        const key = `${Math.min(from!, to!)}:${Math.max(from!, to!)}`;
        const uses = edges.get(key) ?? [];
        uses.push({ triangle, opposite: opposite! });
        edges.set(key, uses);
      }
    });
    const touched = new Set<number>();
    let flips = 0;
    for (const [key, uses] of edges) {
      if (uses.length !== 2 || uses.some((use) => touched.has(use.triangle))) continue;
      const [a, b] = key.split(":").map(Number) as [number, number];
      const [c, d] = uses.map((use) => use.opposite) as [number, number];
      const sideA = cross(points[c]!, points[d]!, points[a]!);
      const sideB = cross(points[c]!, points[d]!, points[b]!);
      if (sideA * sideB >= -1e-9) continue;
      const orient = (x: number, y: number, z: number): [number, number, number] =>
        cross(points[x]!, points[y]!, points[z]!) > 0 ? [x, y, z] : [x, z, y];
      const nextA = orient(c, d, a);
      const nextB = orient(d, c, b);
      const before = Math.min(...uses.map((use) => minimumAngle(points, triangles[use.triangle]!)));
      const after = Math.min(minimumAngle(points, nextA), minimumAngle(points, nextB));
      if (after <= before + 1e-7) continue;
      triangles[uses[0]!.triangle] = nextA;
      triangles[uses[1]!.triangle] = nextB;
      touched.add(uses[0]!.triangle);
      touched.add(uses[1]!.triangle);
      flips++;
    }
    if (flips === 0) break;
  }
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

function subdivideOversized(
  points: Point[],
  triangles: [number, number, number][],
  maxArea: number,
): void {
  while (true) {
    let target = -1,
      largestArea = maxArea;
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
}

/** Build a single simple raster-part mesh. No bones, weights, or Spine JSON are produced. */
export function generateMesh(
  part: AssetPart,
  alpha: Uint8Array,
  options: MeshGenerationOptions = {},
): MeshSpec {
  const intent = options.intent ?? "unknown";
  if (!["rigid", "chain", "unknown"].includes(intent))
    failMesh("MESH_INTENT", "Mesh intent must be rigid, chain, or unknown");
  const reference = options.referenceTopology;
  if (
    reference &&
    (!Number.isSafeInteger(reference.vertices) ||
      !Number.isSafeInteger(reference.hull) ||
      reference.hull < 3 ||
      reference.vertices < reference.hull ||
      reference.vertices > 2560 ||
      (reference.bands &&
        (reference.bands.length * 2 !== reference.vertices - reference.hull ||
          reference.bands.some(
            ({ position, widthFraction }) =>
              !Number.isFinite(position) ||
              position <= 0 ||
              position >= 1 ||
              !Number.isFinite(widthFraction) ||
              widthFraction <= 0 ||
              widthFraction >= 1,
          ))))
  )
    failMesh("MESH_REFERENCE", "Reference topology counts are invalid");
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
  const exactOutline = traceContour(alpha, width, height);
  const xs = exactOutline.map(([x]) => x);
  const ys = exactOutline.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const lowPoly = width * height > 256;
  const outline = simplifyContour(exactOutline, alpha, width, height, lowPoly, reference?.hull);
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

  // A chain is an explicit purpose. Unknown parts receive a bounded geometric starter.
  const foreground = alpha.reduce((count, value) => count + Number(value > 0), 0);
  const candidates: Point[] = [];
  if (reference && reference.vertices > reference.hull) {
    // The reference supplies normalized structural bands; actual points are rebuilt from
    // this PNG's filled cross-sections, so a different raster can reuse the topology profile.
    const needed = reference.vertices - reference.hull;
    const sections = Math.ceil(needed / 2);
    for (let section = 1; section <= sections; section++) {
      const band = reference.bands?.[section - 1];
      const y = Math.min(
        height - 1,
        Math.floor(
          band ? band.position * height : Math.min(...ys) + (spanY * section) / (sections + 1),
        ),
      );
      const filled = Array.from({ length: width }, (_, x) => x).filter(
        (x) => alpha[y * width + x]! > 0,
      );
      if (filled.length < 2) continue;
      const left = filled[0]!,
        right = filled[filled.length - 1]! + 1;
      const halfSpread = (band?.widthFraction ?? 1 / 3) / 2;
      for (const fraction of [0.5 - halfSpread, 0.5 + halfSpread]) {
        if (candidates.length < needed)
          candidates.push([left + (right - left) * fraction, y + 0.5]);
      }
    }
  } else if (intent === "chain" && lowPoly && !reference) {
    const vertical = spanY >= spanX;
    const start = vertical ? Math.min(...ys) : Math.min(...xs);
    const span = vertical ? spanY : spanX;
    for (let section = 1; section <= 5; section++) {
      const fraction = section / 6;
      const coordinate = Math.min(
        (vertical ? height : width) - 1,
        Math.floor(start + span * fraction),
      );
      let runStart = -1,
        bestStart = -1,
        bestEnd = -1;
      for (let cross = 0; cross <= (vertical ? width : height); cross++) {
        const filled =
          cross < (vertical ? width : height) &&
          alpha[vertical ? coordinate * width + cross : cross * width + coordinate]! > 0;
        if (filled && runStart < 0) runStart = cross;
        if (!filled && runStart >= 0) {
          if (cross - runStart > bestEnd - bestStart) {
            bestStart = runStart;
            bestEnd = cross;
          }
          runStart = -1;
        }
      }
      if (bestStart >= 0) {
        const middle = (bestStart + bestEnd) / 2;
        candidates.push(vertical ? [middle, coordinate + 0.5] : [coordinate + 0.5, middle]);
      }
    }
  } else if (!lowPoly && intent !== "rigid" && !reference) {
    const spacing = Math.max(4, Math.ceil(Math.sqrt(foreground / 256)));
    for (let y = spacing / 2; y < height; y += spacing)
      for (let x = spacing / 2; x < width; x += spacing) candidates.push([x, y]);
  }
  for (const point of candidates) {
    if (points.length >= 2560) failMesh("MESH_COMPLEXITY", "Mesh exceeds vertex budget");
    if (
      !strictlyInside(point, outline) ||
      alpha[Math.floor(point[1]) * width + Math.floor(point[0])] === 0
    )
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
  if (intent !== "rigid" && !reference && points.length === outline.length && foreground > 4) {
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
  // Relative area avoids increasing topology density merely with texture resolution.
  const maxArea = lowPoly ? foreground / 6 : 512;
  if (intent !== "rigid" && !reference) subdivideOversized(points, triangles, maxArea);
  improveTriangulation(points, triangles);
  if (intent !== "rigid" && !reference) subdivideOversized(points, triangles, maxArea);
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
