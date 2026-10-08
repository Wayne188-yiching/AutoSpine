import earcut from "earcut";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";
import {
  selectPrimaryComponent,
  signedArea2,
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
}
export interface FeatureMesh {
  mesh: MeshSpec;
  /** Ordered vertex indices of each feature ring (one per kept hole). */
  rings: number[][];
}

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

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
 * interiors are triangulated (the editor sees one ordinary hull), and an interior lattice gives
 * smooth deformations room to bend, with min-angle flips that never cross a ring.
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
    [options.edgeLength, options.spacing].some((v) => v !== undefined && !(v >= 2 && v <= 4096))
  )
    failMesh(
      "FEATURE_INPUT",
      "Alpha must match the mask; hole fraction (0, 1]; lengths 2..4096 px",
    );
  const solid = selectPrimaryComponent(
    Uint8Array.from(alpha, (a) => (a > 0 ? 255 : 0)),
    width,
    height,
    0.02,
  ).alpha;
  const foreground = solid.reduce((n, a) => n + (a ? 1 : 0), 0);
  const holes = enclosedHoles(solid, width, height),
    filled = Uint8Array.from(solid);
  for (const hole of holes) for (const i of hole) filled[i] = 255;
  const edgeLength = options.edgeLength ?? Math.max(4, Math.sqrt(foreground) / 16),
    spacing = options.spacing ?? Math.max(4, Math.sqrt(foreground / 48));
  const loop = (region: Uint8Array) => {
    const ring = simplifyContour(traceContour(region, width, height), region, width, height, true);
    return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
  };
  const outer = loop(filled);
  const rings = holes
    .filter((hole) => hole.length >= minHoleFraction * foreground)
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
  for (let y = spacing / 2 + 0.37; y < height; y += spacing)
    for (let x = spacing / 2 + 0.61; x < width; x += spacing) {
      const p: Point = [x, y];
      if (!inside(p, outer) || rings.some((r) => inside(p, r))) continue;
      if (boundaries.some((b) => distanceToPolygon(p, b) < 0.5 * spacing)) continue;
      const target = triangles.findIndex(
        ([a, b, c]) =>
          cross(points[a]!, points[b]!, p) > 1e-9 &&
          cross(points[b]!, points[c]!, p) > 1e-9 &&
          cross(points[c]!, points[a]!, p) > 1e-9,
      );
      if (target < 0) continue;
      const index = points.length,
        [a, b, c] = triangles[target]!;
      points.push(p);
      triangles.splice(target, 1, [a, b, index], [b, c, index], [c, a, index]);
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
  return { mesh, rings: ringIndices };
}
