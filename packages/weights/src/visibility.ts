import type { MeshSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import {
  engineeringDeformationLimits,
  scanTriangleInversions,
  type DeformationMetrics,
} from "./deformation.js";

/**
 * Visibility-aware inversion scoring.
 *
 * A flipped triangle only matters when the audience can see it. Hand-delivered reference
 * animations ship with dozens of inversions, so a global `inversionCount === 0` gate rejects
 * motion amplitudes artists already accept. This module replaces the count with "how much
 * opaque, unoccluded screen area does the flipped geometry actually paint", plus a per-part
 * budget.
 *
 * Coordinates follow the rest of the image pipeline: +x right, +y down, with pixel (0, 0)
 * covering the top-left corner of `bounds`, exactly the mapping mesh generation uses.
 */
export interface PixelGrid {
  width: number;
  height: number;
  /** Display/document rectangle the pixel grid covers. */
  bounds: { x: number; y: number; width: number; height: number };
}
/**
 * A decoded alpha layer. Decode with `decodeAlphaMask` (@autospine/assets) at the call site:
 * weights stays on the `schemas + rig` dependency layer, so it consumes bytes, never the
 * encoded mask, and no second decoder is introduced.
 */
export interface AlphaSurface extends PixelGrid {
  alpha: Uint8Array;
}
export interface VisibleInversionOptions {
  /** Raster frame for the posed pose. Defaults to the part's own grid; pass the composite frame
   * when the pose can travel outside the bind rectangle. */
  canvas?: PixelGrid;
  /** Layers drawn in front of this part. Each may use its own grid. */
  occluders?: readonly AlphaSurface[];
  /** Alpha strictly above this counts as opaque. */
  opaqueThreshold?: number;
  /** Visible-pixel count below which a flipped triangle is treated as sub-perceptual. */
  minVisiblePixels?: number;
}
export interface InvertedTriangleVisibility {
  /** Index into `mesh.triangles / 3`. */
  triangle: number;
  visiblePixels: number;
  /** `visiblePixels` over the part's opaque pixel count. */
  areaRatio: number;
  visible: boolean;
}
export interface VisibleInversionMetrics {
  invertedTriangles: number;
  visibleInvertedTriangles: number;
  visibleInvertedPixels: number;
  /** Opaque pixels of the part itself; the denominator for every ratio below. */
  opaquePixels: number;
  /** Collapse measured independently of winding; see `InversionScan.minAbsAreaRatio`. */
  minAbsAreaRatio: number;
  visibleAreaRatio: number;
  maxTriangleAreaRatio: number;
  /** One entry per inverted triangle, in ascending triangle order. */
  triangles: InvertedTriangleVisibility[];
}
/** Per-part budget. All-zero expresses "this part tolerates no visible inversion at all". */
export interface InversionTolerance {
  /** Share of the part's opaque area the visible inversions may cover in total. */
  maxVisibleAreaRatio: number;
  /** Same budget for the worst single triangle, so one big fold cannot hide in a loose total. */
  maxSingleTriangleRatio: number;
  /** Hard cap on how many flipped triangles may be visible. */
  maxVisibleTriangles: number;
}
export interface InversionToleranceContract {
  default: InversionTolerance;
  /** Keyed by part id or role; `resolveInversionTolerance` falls back to `default`. */
  byPart: Readonly<Record<string, InversionTolerance>>;
}
/** The historical behaviour of `deformationPasses`, kept addressable as an explicit policy. */
export const strictInversionTolerance: InversionTolerance = Object.freeze({
  maxVisibleAreaRatio: 0,
  maxSingleTriangleRatio: 0,
  maxVisibleTriangles: 0,
});
const softInversionTolerance: InversionTolerance = Object.freeze({
  maxVisibleAreaRatio: 0.02,
  maxSingleTriangleRatio: 0.008,
  maxVisibleTriangles: 32,
});
/**
 * Starting policy, not a measured constant: silhouette-reading parts keep the strict budget and
 * soft secondary parts get a small one. Productions are expected to override `byPart`.
 */
export const engineeringInversionTolerances: InversionToleranceContract = Object.freeze({
  default: Object.freeze({
    maxVisibleAreaRatio: 0.005,
    maxSingleTriangleRatio: 0.002,
    maxVisibleTriangles: 8,
  }),
  byPart: Object.freeze({
    face: strictInversionTolerance,
    eye: strictInversionTolerance,
    mouth: strictInversionTolerance,
    hair: softInversionTolerance,
    cloth: softInversionTolerance,
  }),
});
function checkTolerance(t: InversionTolerance): InversionTolerance {
  if (
    !t ||
    !(t.maxVisibleAreaRatio >= 0 && t.maxVisibleAreaRatio <= 1) ||
    !(t.maxSingleTriangleRatio >= 0 && t.maxSingleTriangleRatio <= 1) ||
    !Number.isInteger(t.maxVisibleTriangles) ||
    t.maxVisibleTriangles < 0
  )
    failStage(
      "weights",
      "VISIBILITY_TOLERANCE",
      "Inversion tolerance needs ratios in [0, 1] and a nonnegative integer triangle cap",
    );
  return t;
}
/** Resolve the budget for one part; an unknown key deliberately falls back to the default. */
export function resolveInversionTolerance(
  contract: InversionToleranceContract,
  partKey?: string,
): InversionTolerance {
  if (!contract || typeof contract.default !== "object" || typeof contract.byPart !== "object")
    failStage(
      "weights",
      "VISIBILITY_TOLERANCE",
      "Tolerance contract needs a default and a byPart map",
    );
  checkTolerance(contract.default);
  for (const value of Object.values(contract.byPart)) checkTolerance(value);
  return (partKey !== undefined && contract.byPart[partKey]) || contract.default;
}
type Point = [number, number];
/** Scanned-pixel ceiling, matching the raster budgets used elsewhere in the pipeline. */
const SCAN_BUDGET = 16_777_216;

function checkGrid(grid: PixelGrid, alpha?: Uint8Array): void {
  const bounds = grid?.bounds;
  if (
    !grid ||
    !Number.isSafeInteger(grid.width) ||
    !Number.isSafeInteger(grid.height) ||
    grid.width < 1 ||
    grid.height < 1 ||
    grid.width * grid.height > SCAN_BUDGET ||
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    (alpha !== undefined &&
      (!(alpha instanceof Uint8Array) || alpha.length !== grid.width * grid.height))
  )
    failStage(
      "weights",
      "VISIBILITY_SURFACE",
      "Alpha surface needs integer dimensions, finite positive bounds and matching pixel count",
    );
}
const toPixel = (grid: PixelGrid, p: Point): Point => [
  ((p[0] - grid.bounds.x) * grid.width) / grid.bounds.width,
  ((p[1] - grid.bounds.y) * grid.height) / grid.bounds.height,
];
/** Sample a surface at a world point; outside its grid reads as transparent, never clamped. */
function opaqueAt(surface: AlphaSurface, world: Point, threshold: number): boolean {
  const [px, py] = toPixel(surface, world);
  const x = Math.floor(px),
    y = Math.floor(py);
  if (!(x >= 0 && x < surface.width && y >= 0 && y < surface.height)) return false;
  return surface.alpha[y * surface.width + x]! > threshold;
}
/**
 * Visible impact of every flipped triangle, by deterministic textured rasterization.
 *
 * For each inverted triangle we scan the pixel centres its *posed* shape covers on the canvas,
 * map each centre back through barycentric coordinates onto the *bind* triangle to read this
 * part's own alpha, and count it when that texel is opaque and no occluder covers the same world
 * point. That answers the question the gate actually cares about -- how many delivered pixels the
 * fold paints -- instead of counting topology events. A fold over transparent texture, behind
 * another layer, or squashed below pixel size scores zero without a special case.
 *
 * Pixel centres plus integer floors make the result exactly reproducible; there is no sampling
 * jitter and no random seed.
 */
export function measureVisibleInversions(
  mesh: MeshSpec,
  posed: Point[],
  surface: AlphaSurface,
  options: VisibleInversionOptions = {},
): VisibleInversionMetrics {
  const { opaqueThreshold = 0, minVisiblePixels = 1 } = options;
  if (
    !Number.isInteger(opaqueThreshold) ||
    opaqueThreshold < 0 ||
    opaqueThreshold > 254 ||
    !Number.isInteger(minVisiblePixels) ||
    minVisiblePixels < 1
  )
    failStage(
      "weights",
      "VISIBILITY_OPTIONS",
      "Opaque threshold must be an integer in [0, 254] and minVisiblePixels a positive integer",
    );
  checkGrid(surface, surface?.alpha);
  const canvas = options.canvas ?? {
    width: surface.width,
    height: surface.height,
    bounds: surface.bounds,
  };
  checkGrid(canvas);
  for (const occluder of options.occluders ?? []) checkGrid(occluder, occluder?.alpha);

  let opaquePixels = 0;
  for (const value of surface.alpha) if (value > opaqueThreshold) opaquePixels++;

  const { inverted, minAbsAreaRatio } = scanTriangleInversions(mesh, posed);
  const triangles: InvertedTriangleVisibility[] = [];
  let scanned = 0,
    visibleInvertedPixels = 0,
    visibleInvertedTriangles = 0,
    maxTriangleAreaRatio = 0;
  for (const triangle of inverted) {
    const ids = mesh.triangles.slice(triangle * 3, triangle * 3 + 3);
    const [qa, qb, qc] = ids.map((j) => toPixel(canvas, posed[j]!)) as [Point, Point, Point];
    const [ta, tb, tc] = ids.map((j) => toPixel(surface, mesh.vertices[j]!)) as [
      Point,
      Point,
      Point,
    ];
    const det = (qb[0] - qa[0]) * (qc[1] - qa[1]) - (qb[1] - qa[1]) * (qc[0] - qa[0]);
    let visiblePixels = 0;
    // A posed triangle without finite nonzero extent paints nothing, so it cannot be visible.
    if (Number.isFinite(det) && det !== 0 && [qa, qb, qc].flat().every(Number.isFinite)) {
      const left = Math.max(0, Math.floor(Math.min(qa[0], qb[0], qc[0]) - 0.5)),
        right = Math.min(canvas.width - 1, Math.ceil(Math.max(qa[0], qb[0], qc[0]))),
        top = Math.max(0, Math.floor(Math.min(qa[1], qb[1], qc[1]) - 0.5)),
        bottom = Math.min(canvas.height - 1, Math.ceil(Math.max(qa[1], qb[1], qc[1])));
      scanned += Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1);
      if (scanned > SCAN_BUDGET)
        failStage(
          "weights",
          "VISIBILITY_BUDGET",
          "Inverted triangle rasterization exceeds the 16777216 scanned pixel budget",
        );
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const px = x + 0.5,
            py = y + 0.5;
          // Affine coordinates of the pixel centre in the posed triangle; sign of det is
          // irrelevant, which is exactly why a flipped triangle still rasterizes normally.
          const wb = ((px - qa[0]) * (qc[1] - qa[1]) - (py - qa[1]) * (qc[0] - qa[0])) / det,
            wc = ((qb[0] - qa[0]) * (py - qa[1]) - (qb[1] - qa[1]) * (px - qa[0])) / det;
          if (wb < 0 || wc < 0 || wb + wc > 1) continue;
          const wa = 1 - wb - wc;
          // Texture lookup through the bind triangle: the fold carries its bind-space pixels.
          const tx = Math.floor(wa * ta[0] + wb * tb[0] + wc * tc[0]),
            ty = Math.floor(wa * ta[1] + wb * tb[1] + wc * tc[1]);
          if (!(tx >= 0 && tx < surface.width && ty >= 0 && ty < surface.height)) continue;
          if (!(surface.alpha[ty * surface.width + tx]! > opaqueThreshold)) continue;
          const world: Point = [
            canvas.bounds.x + (px * canvas.bounds.width) / canvas.width,
            canvas.bounds.y + (py * canvas.bounds.height) / canvas.height,
          ];
          if ((options.occluders ?? []).some((o) => opaqueAt(o, world, opaqueThreshold))) continue;
          visiblePixels++;
        }
    }
    const areaRatio = opaquePixels ? visiblePixels / opaquePixels : 0;
    const visible = visiblePixels >= minVisiblePixels;
    if (visible) {
      visibleInvertedTriangles++;
      visibleInvertedPixels += visiblePixels;
      maxTriangleAreaRatio = Math.max(maxTriangleAreaRatio, areaRatio);
    }
    triangles.push({ triangle, visiblePixels, areaRatio, visible });
  }
  return {
    invertedTriangles: inverted.length,
    visibleInvertedTriangles,
    visibleInvertedPixels,
    opaquePixels,
    minAbsAreaRatio,
    visibleAreaRatio: opaquePixels ? visibleInvertedPixels / opaquePixels : 0,
    maxTriangleAreaRatio,
    triangles,
  };
}
/** Replacement for the global `inversionCount === 0` rule. Invisible folds cost nothing. */
export function visibleInversionsPass(
  metrics: VisibleInversionMetrics,
  tolerance: InversionTolerance = engineeringInversionTolerances.default,
): boolean {
  checkTolerance(tolerance);
  if (
    !metrics ||
    ![
      metrics.visibleInvertedTriangles,
      metrics.visibleAreaRatio,
      metrics.maxTriangleAreaRatio,
    ].every(Number.isFinite)
  )
    failStage("weights", "VISIBILITY_METRICS", "Finite visible inversion metrics required");
  return (
    metrics.visibleInvertedTriangles <= tolerance.maxVisibleTriangles &&
    metrics.visibleAreaRatio <= tolerance.maxVisibleAreaRatio &&
    metrics.maxTriangleAreaRatio <= tolerance.maxSingleTriangleRatio
  );
}
/**
 * Alternative to `deformationPasses`: identical area, stretch and seam limits, but inversions are
 * judged by what they paint. `deformationPasses` itself stays untouched for existing callers.
 */
export function deformationPassesWithVisibility(
  deformation: DeformationMetrics,
  visibility: VisibleInversionMetrics,
  tolerance: InversionTolerance = engineeringInversionTolerances.default,
): boolean {
  // Mismatched counts mean the two measurements came from different poses; refuse to guess.
  if (deformation?.inversionCount !== visibility?.invertedTriangles)
    failStage(
      "weights",
      "VISIBILITY_PAIRING",
      "Deformation and visibility metrics must describe the same posed mesh",
    );
  return (
    Object.values(deformation).every(Number.isFinite) &&
    // Collapse is judged on the unsigned ratio: the signed `minAreaRatio` is negative for any
    // inversion, which would reinstate the global ban this gate is replacing.
    visibility.minAbsAreaRatio >= engineeringDeformationLimits.minAreaRatio &&
    deformation.maxEdgeStretch <= engineeringDeformationLimits.maxEdgeStretch &&
    deformation.maxSeamGap <= engineeringDeformationLimits.maxSeamGap &&
    visibleInversionsPass(visibility, tolerance)
  );
}
