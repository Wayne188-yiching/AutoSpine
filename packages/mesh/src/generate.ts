import earcut from "earcut";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { signedArea2, simplifyContour, traceContour, type Point } from "./contour.js";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";
import { generateStripMesh } from "./strip.js";
import { fitRasterRegion, type RasterRegion } from "./raster-region.js";

export interface MeshGenerationOptions {
  /** Opt-in boundary-only count reduction under unchanged raster budgets. */
  boundaryDecimation?: boolean;
  /** Explicit selected foreground and original raster; never reference vertex coordinates. */
  rasterRegion?: RasterRegion;
  /** Caller-supplied purpose, never inferred from the file name. */
  intent?: "rigid" | "chain" | "unknown";
  /** Counts and normalized cross-section profile from a matched artist attachment. */
  referenceTopology?: {
    vertices: number;
    hull: number;
    /** Measured transparent area / foreground area of the SAME artist attachment. */
    maxAddedFraction?: number;
    /** Explicit coarse structural intent, never expected coordinates or connectivity. */
    family?: "strip-spine" | "strip-ladder";
    bands?: { position: number; widthFraction: number }[];
  };
}

/** A four-corner reference may intentionally span holes or separate visible islands.
 * Qualify from the unmodified raster and its explicit padding budget, not a file name
 * or reference coordinates. Linear scanning is bounded independently of contour tracing.
 */
export function referenceRectangleFits(
  alpha: Uint8Array,
  width: number,
  height: number,
  reference: MeshGenerationOptions["referenceTopology"],
): boolean {
  if (
    reference?.vertices !== 4 ||
    reference.hull !== 4 ||
    reference.maxAddedFraction === undefined ||
    !Number.isFinite(reference.maxAddedFraction) ||
    reference.maxAddedFraction < 0 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216 ||
    alpha.length !== width * height
  )
    return false;
  let foreground = 0;
  for (const value of alpha) if (value > 0) foreground++;
  return foreground > 0 && (alpha.length - foreground) / foreground <= reference.maxAddedFraction;
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
  if (reference && Math.abs(mesh.vertices.length - reference.vertices) > 5)
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
  if (options.boundaryDecimation !== undefined && typeof options.boundaryDecimation !== "boolean")
    failMesh("MESH_DECIMATION", "Boundary decimation must be boolean");
  if (options.boundaryDecimation && (!options.rasterRegion || !reference))
    failMesh("MESH_DECIMATION", "Boundary decimation requires raster region and reference counts");
  if (options.rasterRegion && reference?.maxAddedFraction === undefined)
    failMesh(
      "RASTER_REGION",
      "Region constraints require an explicit same-attachment padding budget",
    );
  if (
    reference &&
    (!Number.isSafeInteger(reference.vertices) ||
      !Number.isSafeInteger(reference.hull) ||
      reference.hull < 3 ||
      reference.vertices < reference.hull ||
      reference.vertices > 2560 ||
      (reference.family !== undefined &&
        (!["strip-spine", "strip-ladder"].includes(reference.family) ||
          reference.bands !== undefined ||
          reference.maxAddedFraction === undefined)) ||
      (reference.maxAddedFraction !== undefined &&
        (!Number.isFinite(reference.maxAddedFraction) || reference.maxAddedFraction < 0)) ||
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
  const referenceRectangle = referenceRectangleFits(alpha, width, height, reference);
  const exactOutline: Point[] = referenceRectangle
    ? [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ]
    : traceContour(alpha, width, height);
  const fitRegion = (mesh: MeshSpec): MeshSpec =>
    options.rasterRegion
      ? fitRasterRegion(
          mesh,
          part.bounds,
          width,
          height,
          options.rasterRegion,
          reference!.maxAddedFraction!,
        )
      : mesh;
  if (reference?.family)
    return fitRegion(
      generateStripMesh(
        part,
        alpha,
        width,
        height,
        reference.vertices,
        reference.hull,
        reference.maxAddedFraction!,
        reference.family,
      ),
    );
  const xs = exactOutline.map(([x]) => x);
  const ys = exactOutline.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const lowPoly = width * height > 256;
  const outline = simplifyContour(
    exactOutline,
    alpha,
    width,
    height,
    lowPoly,
    reference?.hull,
    reference?.maxAddedFraction,
  );
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
  // Rectangle diagonals have equal angle quality. Use a fixed top-right/bottom-left
  // tie-break for this qualified profile, independent of artist XY or per-case edges.
  // Non-reference generation and non-rectangular profiles keep their existing behavior.
  if (referenceRectangle && points.length === 4) {
    triangles.splice(0, triangles.length, [0, 1, 3], [1, 2, 3]);
  }
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
  let current = fitRegion(mesh);
  // Preserve authored edges and interior topology. Bound both candidate count and
  // per-candidate raster work; reaching a limit keeps the last valid fitted mesh.
  if (
    !options.boundaryDecimation ||
    reference!.vertices !== reference!.hull ||
    current.hull.length !== current.vertices.length ||
    current.manualEdges?.length ||
    current.vertices.length > 64 ||
    width * height > 150_000 ||
    current.hull.length ** 2 * height > 1_000_000
  )
    return current;
  let attempts = 0;
  // BEGIN post-stall midpoint fallback
  let midpointAttempts = 0;
  // END post-stall midpoint fallback
  while (current.vertices.length > reference!.vertices && attempts < 128) {
    const raster = current.hull.map((index): Point => [
      ((current.vertices[index]![0] - part.bounds.x) * width) / part.bounds.width,
      ((current.vertices[index]![1] - part.bounds.y) * height) / part.bounds.height,
    ]);
    const removals = raster
      .map((point, index) => ({
        index,
        area: Math.abs(
          cross(
            raster[(index + raster.length - 1) % raster.length]!,
            point,
            raster[(index + 1) % raster.length]!,
          ),
        ),
      }))
      .sort((a, b) => a.area - b.area || a.index - b.index);
    let accepted = false;
    for (const { index } of removals) {
      if (attempts++ >= 128) break;
      const reduced = raster.filter((_, j) => j !== index);
      const raw = earcut(reduced.flat());
      if (raw.length !== (reduced.length - 2) * 3) continue;
      const triangles: [number, number, number][] = [];
      for (let j = 0; j < raw.length; j += 3) {
        const a = raw[j]!,
          b = raw[j + 1]!,
          c = raw[j + 2]!;
        triangles.push(cross(reduced[a]!, reduced[b]!, reduced[c]!) > 0 ? [a, b, c] : [a, c, b]);
      }
      improveTriangulation(reduced, triangles);
      const retained = current.hull.filter((_, j) => j !== index);
      const candidate: MeshSpec = {
        ...current,
        vertices: retained.map((j) => current.vertices[j]!),
        uvs: retained.map((j) => current.uvs[j]!),
        hull: retained.map((_, j) => j),
        triangles: triangles
          .map(canonicalTriangle)
          .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
          .flat(),
      };
      if (validateMeshSpec(candidate).status !== "passed") continue;
      try {
        // Each fit verifies the actual returned display geometry against the same
        // original/target rasters. The per-fit movement bound is not cumulative.
        current = fitRegion(candidate);
        accepted = true;
        break;
      } catch (error) {
        if (
          !(error instanceof MeshError) ||
          error.validation.issues.some((issue) => issue.code !== "RASTER_REGION_BUDGET")
        )
          throw error;
      }
    }
    // BEGIN post-stall midpoint fallback
    // Only extend a stalled deletion search, never one stopped by its work limit.
    // Existing results that reach their requested count never enter this branch.
    if (!accepted && attempts < 128 && midpointAttempts < 64) {
      const edges = raster
        .map((point, index) => ({
          index,
          length2:
            (point[0] - raster[(index + 1) % raster.length]![0]) ** 2 +
            (point[1] - raster[(index + 1) % raster.length]![1]) ** 2,
        }))
        .sort((a, b) => a.length2 - b.length2 || a.index - b.index);
      for (const { index } of edges) {
        if (midpointAttempts >= 64) break;
        midpointAttempts++;
        const next = (index + 1) % raster.length;
        const midpoint: Point = [
          (raster[index]![0] + raster[next]![0]) / 2,
          (raster[index]![1] + raster[next]![1]) / 2,
        ];
        const retained = current.hull.map((_, j) => j).filter((j) => j !== next);
        const reduced = retained.map((j) => (j === index ? midpoint : raster[j]!));
        const raw = earcut(reduced.flat());
        if (raw.length !== (reduced.length - 2) * 3) continue;
        const triangles: [number, number, number][] = [];
        for (let j = 0; j < raw.length; j += 3) {
          const a = raw[j]!,
            b = raw[j + 1]!,
            c = raw[j + 2]!;
          triangles.push(cross(reduced[a]!, reduced[b]!, reduced[c]!) > 0 ? [a, b, c] : [a, c, b]);
        }
        improveTriangulation(reduced, triangles);
        const candidate: MeshSpec = {
          ...current,
          vertices: retained.map((j) =>
            j === index
              ? [
                  part.bounds.x + (midpoint[0] * part.bounds.width) / width,
                  part.bounds.y + (midpoint[1] * part.bounds.height) / height,
                ]
              : current.vertices[current.hull[j]!]!,
          ),
          uvs: retained.map((j) =>
            j === index
              ? [midpoint[0] / width, midpoint[1] / height]
              : current.uvs[current.hull[j]!]!,
          ),
          hull: retained.map((_, j) => j),
          triangles: triangles
            .map(canonicalTriangle)
            .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
            .flat(),
        };
        if (validateMeshSpec(candidate).status !== "passed") continue;
        try {
          current = fitRegion(candidate);
          accepted = true;
          break;
        } catch (error) {
          if (
            !(error instanceof MeshError) ||
            error.validation.issues.some((issue) => issue.code !== "RASTER_REGION_BUDGET")
          )
            throw error;
        }
      }
    }
    // END post-stall midpoint fallback
    if (!accepted) break;
  }
  return current;
}
