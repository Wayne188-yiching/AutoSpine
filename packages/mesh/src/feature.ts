import earcut from "earcut";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";
import {
  selectPrimaryComponent,
  signedArea2,
  simplifyClosed,
  simplifyContour,
  traceContour,
  type Point,
} from "./contour.js";

export interface FeatureMeshOptions {
  /** Enclosed holes of at least this fraction of the foreground become rings; smaller ones are covered. */
  minHoleFraction?: number;
  /** Longest hull or ring edge in pixels; longer simplified edges are subdivided. */
  edgeLength?: number;
  /** Interior lattice spacing in pixels. */
  spacing?: number;
  /**
   * Hull vertex count: the hull is reduced or split to this many vertices while it keeps covering
   * every opaque pixel; holes are covered and long edges are not subdivided.
   */
  hullVertices?: number;
  /**
   * Interior points. Without `bones`: lattice points, the spacing searched to give about this
   * many (0: none). With `bones`: exactly this many, joint rows first (ADR-042).
   */
  interiorVertices?: number;
  /**
   * Artist wiring (ADR-041) from the bones that weight the part ([] for a rigid part), in image
   * pixels, `joint` when the bone's parent also weights it. The hull gets as many vertices as the
   * outline simplified at 3 % of sqrt(width x height) has corners, times 0.67 (rigid), 0.9 (one
   * or two bones, or deformed by keys) or 1.5 (three or more). A part that bends (two or more
   * bones, or `deforms`) gets rows of interior points across each joint inside it and halfway
   * along each long bone, then spread points up to 0.27 x hull area / mean hull edge squared
   * (ADR-042). Explicit counts override.
   */
  bones?: { origin: Point; tip: Point; joint?: boolean }[];
  /** With `bones`: the part is also deformed by mesh deform keys, so it bends (ADR-042). */
  deforms?: boolean;
  /**
   * With a budget: enclosed holes of at least `minHoleFraction` keep their rings as without one
   * (eye sockets in a face plate, ADR-038) instead of being covered.
   */
  keepHoles?: boolean;
}
export interface FeatureMesh {
  mesh: MeshSpec;
  /** Ordered vertex indices of each feature ring (one per kept hole). */
  rings: number[][];
  /** Opaque pixels (alpha above 8) left out of the mesh: detached specks and stray fragments. */
  discarded: number;
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

/**
 * Whether cutting triangle a-v-b off a ring uncovers a solid pixel centre: one strictly on v's side
 * of the new edge a-b and inside or on the old edges a-v, v-b.
 */
function cutsSolid(a: Point, v: Point, b: Point, solid: Uint8Array, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], v[0], b[0]) - 0.5)),
    x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], v[0], b[0]))),
    y0 = Math.max(0, Math.floor(Math.min(a[1], v[1], b[1]) - 0.5)),
    y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], v[1], b[1])));
  const s = Math.sign(cross(a, v, b));
  if (!s) return false;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!solid[y * width + x]) continue;
      const p: Point = [x + 0.5, y + 0.5];
      if (cross(a, v, p) * s >= 0 && cross(v, b, p) * s >= 0 && cross(b, a, p) * s > 1e-9)
        return true;
    }
  return false;
}
/**
 * Reduces a covering ring (traced pixel-cell edges) to `target` vertices. Each step takes the
 * cheapest change in area that keeps every solid pixel centre covered, the ring simple and inside
 * the image: dropping a vertex (a concave one grows the ring; a convex one may cut empty pixels
 * only) or replacing two convex neighbours by the meeting point of their outer edges. A step never
 * grows the ring over a `stray` pixel centre (a dropped fragment, ADR-039). Long edges are then
 * split up to the target.
 */
function fitHullBudget(
  ring: Point[],
  target: number,
  solid: Uint8Array,
  width: number,
  height: number,
  stray?: Uint8Array,
): Point[] {
  const covers = (a: Point, v: Point, b: Point) =>
    stray !== undefined && cutsSolid(a, v, b, stray, width, height);
  // Collinear runs first: free and exact.
  let out = ring.filter((v, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length]!,
      b = ring[(i + 1) % ring.length]!;
    return Math.abs(cross(a, v, b)) > 1e-12;
  });
  const orient = Math.sign(signedArea2(out)) || 1,
    inImage = (p: Point) =>
      p[0] >= -1e-6 && p[1] >= -1e-6 && p[0] <= width + 1e-6 && p[1] <= height + 1e-6;
  const crossing = (edges: [Point, Point][], skip: Set<number>) =>
    out.some((c, k) => {
      if (skip.has(k)) return false;
      const d = out[(k + 1) % out.length]!;
      return edges.some(([a, b]) => properCrossing(a, b, c, d));
    });
  while (out.length > Math.max(3, target)) {
    const n = out.length,
      at = (i: number) => out[((i % n) + n) % n]!;
    type Step = { cost: number; apply: () => Point[]; edges: [Point, Point][]; skip: Set<number> };
    const steps: Step[] = [];
    for (let i = 0; i < n; i++) {
      const a = at(i - 1),
        v = at(i),
        b = at(i + 1);
      const turn = cross(a, v, b) * orient,
        area = Math.abs(cross(a, v, b)) / 2;
      if (turn <= 0 ? !covers(a, v, b) : !cutsSolid(a, v, b, solid, width, height))
        steps.push({
          cost: area,
          apply: () => out.filter((_, k) => k !== i),
          edges: [[a, b]],
          skip: new Set([(i - 1 + n) % n, i]),
        });
      // v and b both convex: extend edges a-v and c-b to meet beyond them.
      const c = at(i + 2);
      if (turn > 0 && cross(v, b, c) * orient > 0) {
        const d1: Point = [v[0] - a[0], v[1] - a[1]],
          d2: Point = [b[0] - c[0], b[1] - c[1]],
          den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den,
          P: Point = [a[0] + t * d1[0], a[1] + t * d1[1]];
        if (t <= 1 || !inImage(P)) continue;
        // Rounding past the image edge would put a UV outside [0, 1].
        P[0] = Math.min(width, Math.max(0, P[0]));
        P[1] = Math.min(height, Math.max(0, P[1]));
        if ((P[0] - b[0]) * d2[0] + (P[1] - b[1]) * d2[1] <= 0 || covers(v, P, b)) continue;
        const j = (i + 1) % n;
        steps.push({
          cost: Math.abs(cross(v, P, b)) / 2,
          apply: () => {
            const next = out.map((p, k) => (k === i ? P : p));
            return next.filter((_, k) => k !== j);
          },
          edges: [
            [a, P],
            [P, c],
          ],
          skip: new Set([(i - 1 + n) % n, i, j, (j + 1) % n]),
        });
      }
    }
    steps.sort((x, y) => x.cost - y.cost);
    const step = steps.find((x) => !crossing(x.edges, x.skip));
    if (!step) break;
    out = step.apply();
  }
  while (out.length < target) {
    let k = 0,
      longest = -1;
    out.forEach((a, i) => {
      const b = out[(i + 1) % out.length]!,
        l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > longest) [k, longest] = [i, l];
    });
    const a = out[k]!,
      b = out[(k + 1) % out.length]!;
    out.splice(k + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/**
 * One region for a budget hull: 4-connected components of alpha above 8 (specks under 0.1 % of
 * the foreground dropped), joined into a tree by 3 px bridges between their closest boundary
 * pixels, as an artist draws one outline around two eyes on one image.
 */
function bridgedSolid(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const on = Uint8Array.from(alpha, (a) => (a > 8 ? 1 : 0)),
    label = new Int32Array(on.length).fill(-1),
    comps: number[][] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || label[start]! >= 0) continue;
    const comp = [start];
    label[start] = comps.length;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k]!,
        x = i % width,
        y = (i - x) / width;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (on[j] && label[j]! < 0) {
          label[j] = comps.length;
          comp.push(j);
        }
      }
    }
    comps.push(comp);
  }
  const total = comps.reduce((n, c) => n + c.length, 0);
  if (!total) failMesh("FEATURE_EMPTY", "Part has no opaque pixels");
  const kept = comps.filter((c) => c.length >= Math.max(4, 0.001 * total));
  kept.sort((a, b) => b.length - a.length);
  const out = new Uint8Array(on.length);
  for (const c of kept) for (const i of c) out[i] = 255;
  if (kept.length === 1) return out;
  // Boundary pixels of each component, thinned to at most 400 for the pair search.
  const edges = kept.map((c) => {
    const id = label[c[0]!]!;
    const b = c.filter((i) => {
      const x = i % width,
        y = (i - x) / width;
      return [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].some(
        ([nx, ny]) =>
          nx! < 0 || ny! < 0 || nx! >= width || ny! >= height || label[ny! * width + nx!] !== id,
      );
    });
    const step = Math.max(1, Math.ceil(b.length / 400));
    return b.filter((_, k) => k % step === 0);
  });
  const joined = [0];
  while (joined.length < kept.length) {
    let best: [number, number, number, number] = [Infinity, 0, 0, 0];
    for (const a of joined)
      for (let b = 0; b < kept.length; b++) {
        if (joined.includes(b)) continue;
        for (const i of edges[a]!)
          for (const j of edges[b]!) {
            const dx = (i % width) - (j % width),
              dy = Math.floor(i / width) - Math.floor(j / width),
              d = dx * dx + dy * dy;
            if (d < best[0]) best = [d, i, j, b];
          }
      }
    const [, i, j, b] = best;
    const x0 = i % width,
      y0 = Math.floor(i / width),
      x1 = j % width,
      y1 = Math.floor(j / width),
      n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const cx = x0 + ((x1 - x0) * k) / n,
        cy = y0 + ((y1 - y0) * k) / n;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.round(cx) + dx,
            y = Math.round(cy) + dy;
          if (x >= 0 && y >= 0 && x < width && y < height) out[y * width + x] = 255;
        }
    }
    joined.push(b);
  }
  return out;
}
/**
 * The pixel-cell outline of a region, traced on a coarser grid (each cell the union of a k x k
 * block) when the full-resolution outline cannot be traced (too many corners, or pixels that touch
 * only at a corner): the coarse outline still covers every pixel.
 */
function traceCovering(region: Uint8Array, width: number, height: number): Point[] {
  for (let k = 1; ; k++) {
    const w = Math.ceil(width / k),
      h = Math.ceil(height / k);
    let mask = region;
    if (k > 1) {
      mask = new Uint8Array(w * h);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (region[y * width + x]) mask[Math.floor(y / k) * w + Math.floor(x / k)] = 255;
    }
    try {
      const ring = traceContour(mask, w, h);
      return k === 1
        ? ring
        : ring.map(([x, y]) => [Math.min(width, x * k), Math.min(height, y * k)] as Point);
    } catch (error) {
      // Too many corners, or pixels touching only at a corner: a coarser grid fixes both.
      if (!(error instanceof MeshError) || k >= 16) throw error;
    }
  }
}

/** Transparent 4-connected regions that do not touch the image border. */
function enclosedHoles(solid: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(solid.length),
    holes: number[][] = [];
  for (let start = 0; start < solid.length; start++) {
    if (solid[start] || seen[start]) continue;
    const region = [start];
    let touchesBorder = false;
    seen[start] = 1;
    for (let k = 0; k < region.length; k++) {
      const i = region[k]!,
        x = i % width,
        y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!solid[j] && !seen[j]) {
          seen[j] = 1;
          region.push(j);
        }
      }
    }
    if (!touchesBorder) holes.push(region);
  }
  return holes;
}
/** The region grown by `r` px (every pixel centre within r of one of it), holes refilled. */
function grow(region: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = Uint8Array.from(region),
    R = Math.floor(r);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!region[i]) continue;
      if (x && y && x < width - 1 && y < height - 1)
        if (region[i - 1] && region[i + 1] && region[i - width] && region[i + width]) continue;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++)
          if (dx * dx + dy * dy <= r * r && x + dx >= 0 && y + dy >= 0)
            if (x + dx < width && y + dy < height) out[i + dy * width + dx] = 255;
    }
  for (const hole of enclosedHoles(out, width, height)) for (const i of hole) out[i] = 255;
  return out;
}
/**
 * Interior rows (ADR-041): a line across the part, square to the bone, at each joint inside it
 * and halfway along each bone longer than `LONG_BONE` times the hull's mean edge; points split
 * each line's span inside the hull into pieces about one hull edge long.
 */
const meanEdge = (ring: Point[]) =>
  ring.reduce((s, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return s + Math.hypot(b[0] - a[0], b[1] - a[1]) / ring.length;
  }, 0);
/**
 * `count` more interior points (ADR-042), each where it is farthest from the points so far and
 * from the boundaries counted at twice their distance (a point's mirror image across the hull),
 * so they sit about half their spacing inside the outline, as artists' do. Candidates lie on a
 * grid of a quarter hull edge, at least half an edge from every boundary and every point.
 */
function spread(
  boundaries: Point[][],
  rings: Point[][],
  existing: Point[],
  count: number,
  step: number,
): Point[] {
  if (count <= 0) return [];
  const outer = boundaries[0]!,
    xs = outer.map((p) => p[0]),
    ys = outer.map((p) => p[1]),
    // ponytail: candidate grid capped near 20k cells; a finer one only matters for huge parts.
    cell = Math.max(step / 4, Math.sqrt(Math.abs(signedArea2(outer)) / 2 / 20000));
  const candidates: Point[] = [],
    score: number[] = [];
  for (let y = Math.min(...ys) + cell / 2; y < Math.max(...ys); y += cell)
    for (let x = Math.min(...xs) + cell / 2; x < Math.max(...xs); x += cell) {
      const p: Point = [x, y];
      if (!inside(p, outer) || rings.some((r) => inside(p, r))) continue;
      const d = Math.min(...boundaries.map((b) => distanceToPolygon(p, b)));
      if (d < step / 2) continue;
      candidates.push(p);
      score.push(Math.min(2 * d, ...existing.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
    }
  const out: Point[] = [];
  while (out.length < count) {
    let best = -1;
    score.forEach((s, i) => {
      if (best < 0 || s > score[best]!) best = i;
    });
    if (best < 0 || score[best]! < step / 2) break;
    const p = candidates[best]!;
    out.push(p);
    candidates.forEach((c, i) => {
      score[i] = Math.min(score[i]!, Math.hypot(c[0] - p[0], c[1] - p[1]));
    });
  }
  return out;
}
function jointRows(bones: NonNullable<FeatureMeshOptions["bones"]>, outer: Point[]): Point[] {
  const step = meanEdge(outer);
  const out: Point[] = [];
  for (const { origin, tip, joint } of bones) {
    const d: Point = [tip[0] - origin[0], tip[1] - origin[1]],
      length = Math.hypot(d[0], d[1]);
    if (!length) continue;
    const across: Point = [-d[1] / length, d[0] / length];
    const rows = [
      ...(joint ? [origin] : []),
      ...(length > LONG_BONE * step ? [[origin[0] + d[0] / 2, origin[1] + d[1] / 2] as Point] : []),
    ];
    for (const at of rows) {
      if (!inside(at, outer)) continue;
      // The line's span through `at`: the nearest hull crossing on either side.
      let lo = -Infinity,
        hi = Infinity;
      outer.forEach((a, i) => {
        const b = outer[(i + 1) % outer.length]!,
          e: Point = [b[0] - a[0], b[1] - a[1]],
          den = across[0] * e[1] - across[1] * e[0];
        if (Math.abs(den) < 1e-12) return;
        const w: Point = [a[0] - at[0], a[1] - at[1]],
          s = (w[0] * e[1] - w[1] * e[0]) / den,
          u = (w[0] * across[1] - w[1] * across[0]) / den;
        if (u < 0 || u > 1) return;
        if (s < 0) lo = Math.max(lo, s);
        else hi = Math.min(hi, s);
      });
      if (!Number.isFinite(hi - lo)) continue;
      const pieces = Math.max(2, Math.round((hi - lo) / step));
      for (let k = 1; k < pieces; k++) {
        const s = lo + ((hi - lo) * k) / pieces;
        out.push([at[0] + across[0] * s, at[1] + across[1] * s]);
      }
    }
  }
  // Keep points apart from each other and from the hull by half an edge.
  const kept: Point[] = [];
  for (const p of out)
    if (
      distanceToPolygon(p, outer) >= step / 2 &&
      kept.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= step / 2)
    )
      kept.push(p);
  return kept;
}
/**
 * ADR-041: the budget hull covers the opaque pixels grown by PAD px (its fewer vertices overshoot
 * corners, about 4 px in all on the artist corpus against the artists' 3), and a bone longer than
 * LONG_BONE hull edges gets a mid-bone row.
 */
const PAD = 1,
  LONG_BONE = 2;

/** Insert w on edge u-v of every triangle using it, keeping orientation (a hull edge has one). */
function splitEdge(triangles: [number, number, number][], u: number, v: number, w: number) {
  for (let t = triangles.length - 1; t >= 0; t--) {
    const tri = triangles[t]!,
      k = [0, 1, 2].find((i) => {
        const p = tri[i]!,
          q = tri[(i + 1) % 3]!;
        return (p === u && q === v) || (p === v && q === u);
      });
    if (k === undefined) continue;
    const p = tri[k]!,
      q = tri[(k + 1) % 3]!,
      r = tri[(k + 2) % 3]!;
    triangles.splice(t, 1, [p, w, r], [w, q, r]);
  }
}
function inside(p: Point, polygon: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
function distanceToPolygon(p: Point, polygon: Point[]): number {
  let best = Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  });
  return best;
}
function properCrossing(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a),
    d2 = cross(c, d, b),
    d3 = cross(a, b, c),
    d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function minimumAngle(points: Point[], [a, b, c]: [number, number, number]): number {
  const angle = (p: Point, q: Point, r: Point) => {
    const u = [q[0] - p[0], q[1] - p[1]],
      v = [r[0] - p[0], r[1] - p[1]];
    return Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!)),
        ),
      ),
    );
  };
  return Math.min(
    angle(points[a]!, points[b]!, points[c]!),
    angle(points[b]!, points[c]!, points[a]!),
    angle(points[c]!, points[a]!, points[b]!),
  );
}
/** Lawson flips that raise the smaller minimum angle; ring edges are never flipped. */
function improve(points: Point[], triangles: [number, number, number][], locked: Set<string>) {
  for (let pass = 0; pass < 100; pass++) {
    const edges = new Map<string, { triangle: number; opposite: number }[]>();
    triangles.forEach(([a, b, c], triangle) => {
      for (const [from, to, opposite] of [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ] as const) {
        const key = edgeKey(from, to);
        edges.set(key, [...(edges.get(key) ?? []), { triangle, opposite }]);
      }
    });
    const touched = new Set<number>();
    let flips = 0;
    for (const [key, uses] of edges) {
      if (locked.has(key) || uses.length !== 2 || uses.some((u) => touched.has(u.triangle)))
        continue;
      const [a, b] = key.split(":").map(Number) as [number, number],
        [c, d] = uses.map((u) => u.opposite) as [number, number];
      if (
        cross(points[c]!, points[d]!, points[a]!) * cross(points[c]!, points[d]!, points[b]!) >=
        -1e-9
      )
        continue; // not a convex quad
      const orient = (x: number, y: number, z: number): [number, number, number] =>
        cross(points[x]!, points[y]!, points[z]!) > 0 ? [x, y, z] : [x, z, y];
      const nextA = orient(c, d, a),
        nextB = orient(d, c, b);
      const before = Math.min(...uses.map((u) => minimumAngle(points, triangles[u.triangle]!)));
      if (Math.min(minimumAngle(points, nextA), minimumAngle(points, nextB)) <= before + 1e-7)
        continue;
      triangles[uses[0]!.triangle] = nextA;
      triangles[uses[1]!.triangle] = nextB;
      touched.add(uses[0]!.triangle).add(uses[1]!.triangle);
      flips++;
    }
    if (!flips) break;
  }
}

/**
 * Silhouette-and-feature mesh for layered parts with cut-outs (a face base with eye sockets, a
 * bandage with a face window). The hull follows the opaque silhouette instead of the image
 * rectangle; every enclosed hole of at least `minHoleFraction` becomes a ring of vertices locked
 * as mesh edges, so the hole rim can be weighted to move with whatever shows through it. Hole
 * interiors are triangulated (the editor sees one ordinary hull), and interior points (a lattice,
 * or with `bones` rows at the joints) give deformations room to bend, with min-angle (Delaunay)
 * flips that never cross a ring.
 */
export function generateFeatureMesh(
  part: AssetPart,
  alpha: Uint8Array,
  options: FeatureMeshOptions = {},
): FeatureMesh {
  const mask = part.alphaMask;
  if (!mask || mask.encoding !== "rle8")
    failMesh("ALPHA_MISSING", "Part must include a Gate 2 alpha mask");
  const { width, height } = mask;
  const { minHoleFraction = 0.01 } = options;
  if (
    alpha.length !== width * height ||
    !(minHoleFraction > 0 && minHoleFraction <= 1) ||
    [options.edgeLength, options.spacing].some((v) => v !== undefined && !(v >= 2 && v <= 4096)) ||
    (options.hullVertices !== undefined &&
      !(Number.isInteger(options.hullVertices) && options.hullVertices >= 3)) ||
    (options.interiorVertices !== undefined &&
      !(Number.isInteger(options.interiorVertices) && options.interiorVertices >= 0)) ||
    (options.bones !== undefined &&
      !(
        Array.isArray(options.bones) &&
        options.bones.every((b) => [...b.origin, ...b.tip].every(Number.isFinite))
      ))
  )
    failMesh(
      "FEATURE_INPUT",
      "Alpha must match the mask; hole fraction (0, 1]; lengths 2..4096 px; budgets are integers; bones finite",
    );
  const budget = options.hullVertices !== undefined || options.bones !== undefined;
  // Detached pieces up to 2 % of the opaque pixels are dropped (specks, a sliver of a neighbouring
  // image left in the picture); pieces too large to drop (fur tufts beside a face, two eyes on one
  // image) are bridged into one outline. A budget hull did not drop them before (ADR-039). A
  // budget hull covers the opaque pixels (alpha above 8): a faint fringe would spike its outline.
  const opaque = Uint8Array.from(alpha, (a) => (a > (budget ? 8 : 0) ? 255 : 0));
  const primary = () => {
    try {
      return selectPrimaryComponent(opaque, width, height, 0.02).alpha;
    } catch (error) {
      if (
        !(error instanceof MeshError) ||
        !error.validation.issues.some((i) => i.code === "DISCARD_BUDGET")
      )
        throw error;
      return bridgedSolid(alpha, width, height);
    }
  };
  const solid = primary();
  let discarded = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! > 8 && !solid[i]) discarded++;
  const foreground = solid.reduce((n, a) => n + (a ? 1 : 0), 0);
  const holes = enclosedHoles(solid, width, height),
    filled = Uint8Array.from(solid);
  for (const hole of holes) for (const i of hole) filled[i] = 255;
  const edgeLength = budget
      ? Infinity
      : (options.edgeLength ?? Math.max(4, Math.sqrt(foreground) / 16)),
    interior = options.interiorVertices;
  const loop = (region: Uint8Array) => {
    const ring = simplifyContour(traceCovering(region, width, height), region, width, height, true);
    return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
  };
  const covering = (region: Uint8Array) => {
    const ring = traceCovering(region, width, height);
    return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
  };
  // A budget hull starts from the traced pixel-cell outline of the region grown by PAD px, which
  // covers every pixel. Its count (ADR-041): the corners of the largest piece's outline at 3 %
  // tolerance, scaled by how many bones bend the part (measured on 205 artist meshes).
  let outer: Point[];
  if (budget) {
    const corners = () => {
      const largest = selectPrimaryComponent(opaque, width, height, 1).alpha;
      for (const hole of enclosedHoles(largest, width, height))
        for (const i of hole) largest[i] = 255;
      return simplifyClosed(covering(largest), 0.03 * Math.sqrt(width * height)).length;
    };
    const n = options.bones?.length ?? 0,
      hull =
        options.hullVertices ??
        Math.max(3, Math.round(corners() * (n >= 3 ? 1.5 : n || options.deforms ? 0.9 : 0.67))),
      padded = grow(filled, width, height, PAD),
      stray = Uint8Array.from(alpha, (a, i) => (a > 8 && !padded[i] ? 255 : 0));
    const fit = (avoid?: Uint8Array) =>
      fitHullBudget(covering(padded), hull, padded, width, height, avoid);
    outer = fit(discarded ? stray : undefined);
    // Avoiding them stalls above the count when they surround the art (an effect's rays).
    if (outer.length > hull) outer = fit();
  } else outer = loop(filled);
  const rings = holes
    .filter((hole) => (!budget || options.keepHoles) && hole.length >= minHoleFraction * foreground)
    .map((hole) => {
      const region = new Uint8Array(width * height);
      for (const i of hole) region[i] = 255;
      return loop(region);
    });
  const boundaries = [outer, ...rings];
  boundaries.forEach((p, i) =>
    boundaries.slice(i + 1).forEach((q) => {
      p.forEach((a, k) =>
        q.forEach((c, m) => {
          if (properCrossing(a, p[(k + 1) % p.length]!, c, q[(m + 1) % q.length]!))
            failMesh("FEATURE_RINGS", "A simplified feature ring crosses another ring or the hull");
        }),
      );
    }),
  );
  if (rings.some((ring) => ring.some((p) => !inside(p, outer))))
    failMesh("FEATURE_RINGS", "A feature ring leaves the silhouette");

  const points: Point[] = [...outer],
    ringIndices = rings.map((ring) => {
      const start = points.length;
      points.push(...ring);
      return ring.map((_, k) => start + k);
    });
  const triangles: [number, number, number][] = [];
  const pushTriangles = (indices: number[], map: (i: number) => number) => {
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [map(indices[t]!), map(indices[t + 1]!), map(indices[t + 2]!)];
      triangles.push(cross(points[a]!, points[b]!, points[c]!) > 0 ? [a, b, c] : [a, c, b]);
    }
  };
  pushTriangles(
    earcut(
      points.flat(),
      ringIndices.map((r) => r[0]!),
      2,
    ),
    (i) => i,
  );
  ringIndices.forEach((indices, k) => pushTriangles(earcut(rings[k]!.flat()), (i) => indices[i]!));
  // Earcut drops collinear points, so long edges are refined only now, by splitting their triangles.
  const refine = (loop: number[]) =>
    loop.flatMap((a, i) => {
      const b = loop[(i + 1) % loop.length]!,
        pa = points[a]!,
        pb = points[b]!,
        n = Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / edgeLength);
      const added: number[] = [];
      for (let k = 1, previous = a; k < n; k++) {
        const w =
          points.push([pa[0] + ((pb[0] - pa[0]) * k) / n, pa[1] + ((pb[1] - pa[1]) * k) / n]) - 1;
        splitEdge(triangles, previous, b, w);
        added.push(w);
        previous = w;
      }
      return [a, ...added];
    });
  const hull = refine(outer.map((_, i) => i));
  ringIndices.splice(0, ringIndices.length, ...ringIndices.map(refine));

  const locked = new Set(
    ringIndices.flatMap((r) => r.map((v, k) => edgeKey(v, r[(k + 1) % r.length]!))),
  );
  const lattice = (spacing: number) => {
    const out: Point[] = [];
    for (let y = spacing / 2 + 0.37; y < height; y += spacing)
      for (let x = spacing / 2 + 0.61; x < width; x += spacing) {
        const p: Point = [x, y];
        if (!inside(p, outer) || rings.some((r) => inside(p, r))) continue;
        if (boundaries.some((b) => distanceToPolygon(p, b) < 0.5 * spacing)) continue;
        out.push(p);
      }
    return out;
  };
  let grid: Point[] = [];
  if (options.bones) {
    // ADR-042: a part that bends gets joint rows, then spread points up to the area rule.
    const bends = options.bones.length > 1 || !!options.deforms,
      rows = jointRows(bends ? options.bones : [], outer).filter(
        (p) => !rings.some((r) => inside(p, r)),
      ),
      step = meanEdge(outer),
      area = Math.abs(signedArea2(outer)) / 2,
      target = interior ?? (bends ? Math.round((0.27 * area) / (step * step)) : 0);
    grid = rows.slice(0, interior ?? rows.length);
    // An explicit count denser than the hull's edges allows packs closer, so all of it fits.
    const spacing = interior ? Math.min(step, Math.sqrt(area / interior)) : step;
    grid.push(...spread(boundaries, rings, grid, target - grid.length, spacing));
  } else if (interior === undefined)
    grid = lattice(options.spacing ?? Math.max(4, Math.sqrt(foreground / 48)));
  else if (interior > 0) {
    // The count falls as the spacing grows: bisect the spacing in log space for the closest count.
    let lo = 2,
      hi = Math.max(width, height);
    grid = lattice(hi);
    for (let k = 0; k < 24; k++) {
      const mid = Math.sqrt(lo * hi),
        g = lattice(mid);
      if (Math.abs(g.length - interior) < Math.abs(grid.length - interior)) grid = g;
      if (g.length > interior) lo = mid;
      else hi = mid;
    }
  }
  /** An unlocked edge two triangles share that runs through p, strictly between its ends. */
  const edgeThrough = (p: Point): [number, number] | undefined => {
    const uses = new Map<string, number>();
    const sides = (t: [number, number, number]) =>
      [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ] as const;
    for (const t of triangles)
      for (const [u, v] of sides(t)) uses.set(edgeKey(u, v), (uses.get(edgeKey(u, v)) ?? 0) + 1);
    for (const t of triangles)
      for (const [u, v] of sides(t)) {
        const a = points[u]!,
          b = points[v]!,
          l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2,
          along = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
        if (Math.abs(cross(a, b, p)) > 1e-9 * l2 || along <= 0 || along >= l2) continue;
        if (uses.get(edgeKey(u, v)) === 2 && !locked.has(edgeKey(u, v))) return [u, v];
      }
  };
  for (const p of grid) {
    const index = points.length,
      target = triangles.findIndex(
        ([a, b, c]) =>
          cross(points[a]!, points[b]!, p) > 1e-9 &&
          cross(points[b]!, points[c]!, p) > 1e-9 &&
          cross(points[c]!, points[a]!, p) > 1e-9,
      );
    if (target >= 0) {
      const [a, b, c] = triangles[target]!;
      points.push(p);
      triangles.splice(target, 1, [a, b, index], [b, c, index], [c, a, index]);
      continue;
    }
    // A point in line with two vertices (a grid candidate) splits the triangles on both sides.
    const edge = edgeThrough(p);
    if (!edge) continue;
    points.push(p);
    splitEdge(triangles, edge[0], edge[1], index);
  }
  improve(points, triangles, locked);

  const canonical = (t: [number, number, number]) => {
    const k = t.indexOf(Math.min(...t));
    return [t[k]!, t[(k + 1) % 3]!, t[(k + 2) % 3]!] as [number, number, number];
  };
  const mesh: MeshSpec = {
    schemaVersion: "0.1",
    kind: "mesh",
    id: `${part.id}-feature-mesh`,
    name: `${part.name} Feature Mesh`,
    sourcePartId: part.id,
    vertices: points.map(([x, y]) => [
      part.bounds.x + (x * part.bounds.width) / width,
      part.bounds.y + (y * part.bounds.height) / height,
    ]),
    uvs: points.map(([x, y]) => [x / width, y / height]),
    triangles: triangles
      .map(canonical)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      .flat(),
    hull,
    ...(locked.size
      ? {
          manualEdges: ringIndices.flatMap((r) =>
            r.map((v, k): [number, number] => [v, r[(k + 1) % r.length]!]),
          ),
        }
      : {}),
  };
  const report = validateMeshSpec(mesh);
  if (report.status !== "passed") throw new MeshError(report);
  return { mesh, rings: ringIndices, discarded };
}
