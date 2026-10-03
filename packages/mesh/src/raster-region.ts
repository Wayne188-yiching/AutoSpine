import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";
import type { Point } from "./contour.js";

export interface RasterRegion {
  /** Original, unmodified image alpha, before region selection or cleanup. */
  sourceAlpha: Uint8Array;
  /** Selected foreground before cleanup. Must be a subset of source foreground. */
  targetAlpha: Uint8Array;
}

/** Preserve connectivity and counts while fitting explicit raster-only region intent.
 * No artist coordinates, edge indices, names or reference comparison scores are used.
 */
export function fitRasterRegion(
  mesh: MeshSpec,
  bounds: AssetPart["bounds"],
  width: number,
  height: number,
  region: RasterRegion,
  padding: number,
): MeshSpec {
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    failMesh("PART_BOUNDS", "Part display bounds must be finite and positive");
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216 ||
    !(region?.sourceAlpha instanceof Uint8Array) ||
    !(region?.targetAlpha instanceof Uint8Array) ||
    region.sourceAlpha.length !== width * height ||
    region.targetAlpha.length !== width * height ||
    !Number.isFinite(padding) ||
    padding < 0
  )
    failMesh("RASTER_REGION", "Region alpha dimensions and padding must be valid");
  const before = validateMeshSpec(mesh);
  if (before.status !== "passed") throw new MeshError(before);
  const { sourceAlpha: source, targetAlpha: target } = region;
  let foreground = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i]! > 0 && source[i] === 0)
      failMesh("RASTER_REGION", "Target foreground must be a subset of source foreground");
    foreground += Number(target[i]! > 0);
  }
  if (!foreground) failMesh("RASTER_REGION", "Region requires nonempty target foreground");
  // Three row-prefix channels distinguish target, forbidden foreground, and transparency.
  const prefixes = Array.from({ length: 3 }, () => new Int32Array((width + 1) * height));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        base = y * (width + 1) + x;
      const labels = [target[i]! > 0, source[i]! > 0 && target[i] === 0, source[i] === 0];
      for (let k = 0; k < 3; k++) prefixes[k]![base + 1] = prefixes[k]![base]! + Number(labels[k]);
    }
  const inspect = (points: Point[]) => {
    const sums = [0, 0, 0];
    for (let y = 0; y < height; y++) {
      const hits: number[] = [];
      for (let j = 0; j < mesh.hull.length; j++) {
        const a = points[mesh.hull[j]!]!,
          b = points[mesh.hull[(j + 1) % mesh.hull.length]!]!;
        if (a[1] > y + 0.5 !== b[1] > y + 0.5)
          hits.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      hits.sort((a, b) => a - b);
      for (let j = 0; j + 1 < hits.length; j += 2) {
        const start = Math.max(0, Math.min(width, Math.ceil(hits[j]! - 0.5))),
          end = Math.max(0, Math.min(width, Math.ceil(hits[j + 1]! - 0.5))),
          base = y * (width + 1);
        for (let k = 0; k < 3; k++)
          sums[k] = sums[k]! + prefixes[k]![base + end]! - prefixes[k]![base + start]!;
      }
    }
    const missed = foreground - sums[0]!,
      excluded = sums[1]!,
      added = sums[2]!;
    return {
      missed,
      excluded,
      added,
      score:
        Math.max(0, missed - 0.02 * foreground) +
        4 * Math.max(0, added - padding * foreground) +
        4 * excluded +
        (missed + added) * 0.0001,
    };
  };
  const fits = (m: ReturnType<typeof inspect>) =>
    m.excluded === 0 && m.missed / foreground <= 0.02 && m.added / foreground <= padding;
  const toRaster = ([x, y]: Point): Point => [
    ((x - bounds.x) * width) / bounds.width,
    ((y - bounds.y) * height) / bounds.height,
  ];
  const initial = mesh.vertices.map(toRaster);
  let points = initial,
    measurement = inspect(points);
  let result = mesh;
  if (fits(measurement)) return mesh;
  // Prefix sums remove the image-width factor from each scanline query.
  // Bound hull candidates times hull intersections per row, with fixed 40 sweeps.
  if (mesh.hull.length * mesh.hull.length * height > 1_000_000)
    failMesh("RASTER_REGION_COMPLEXITY", "Region refinement exceeds bounded search work");
  const create = (index: number, point: Point): MeshSpec => ({
    ...result,
    vertices: result.vertices.map((vertex, j) =>
      j !== index
        ? vertex
        : [
            bounds.x + (point[0] * bounds.width) / width,
            bounds.y + (point[1] * bounds.height) / height,
          ],
    ),
    uvs: result.uvs.map((uv, j) => (j !== index ? uv : [point[0] / width, point[1] / height])),
  });
  for (const step of [1, 0.5, 0.25, 0.125, 0.0625])
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const index of mesh.hull) {
        let best = points,
          bestMeasure = measurement,
          bestMesh = result;
        for (const dx of [-step, 0, step])
          for (const dy of [-step, 0, step]) {
            if (dx === 0 && dy === 0) continue;
            const requested: Point = [
              Math.max(0, Math.min(width, points[index]![0] + dx)),
              Math.max(0, Math.min(height, points[index]![1] + dy)),
            ];
            const candidateMesh = create(index, requested),
              point = toRaster(candidateMesh.vertices[index]!);
            if (Math.hypot(point[0] - initial[index]![0], point[1] - initial[index]![1]) > 1.5)
              continue;
            const candidate = points.map((p, j) => (j === index ? point : p)),
              value = inspect(candidate);
            if (
              value.score >= bestMeasure.score ||
              validateMeshSpec(candidateMesh).status !== "passed"
            )
              continue;
            best = candidate;
            bestMeasure = value;
            bestMesh = candidateMesh;
          }
        if (best !== points) {
          points = best;
          measurement = bestMeasure;
          result = bestMesh;
          changed = true;
        }
      }
      if (!changed) break;
    }
  // Recheck the returned display geometry, including its floating-point round trip.
  const actual = result.vertices.map(toRaster);
  if (
    !fits(inspect(actual)) ||
    mesh.hull.some(
      (index) =>
        Math.hypot(actual[index]![0] - initial[index]![0], actual[index]![1] - initial[index]![1]) >
        1.5,
    )
  )
    failMesh(
      "RASTER_REGION_BUDGET",
      "Cannot fit zero excluded foreground, 2% missed and same-attachment padding",
    );
  const validation = validateMeshSpec(result);
  if (validation.status !== "passed") throw new MeshError(validation);
  return result;
}
