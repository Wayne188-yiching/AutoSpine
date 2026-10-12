import type { Affine } from "@autospine/rig";

/** IR world point: x right, y down. */
export type Vec = [number, number];

/**
 * One image of the character as it sits in the setup pose. `affine` maps an image pixel
 * (x right, y down from the top-left corner) into IR world: x' = a*x + c*y + tx, y' = b*x + d*y + ty.
 */
export interface CharacterPart {
  /** Slot name for the setup attachment, otherwise `slot#attachment`. */
  key: string;
  slot: string;
  attachment: string;
  path: string;
  setup: boolean;
  /** Draw-order index of the slot. */
  order: number;
  width: number;
  height: number;
  /** Exact 8-bit alpha, row-major. */
  alpha: Uint8Array;
  affine: Affine;
  /** The placement shears, so a region cannot carry it; the image becomes a rigid quad mesh. */
  sheared: boolean;
  color?: string;
}

export const apply = (m: Affine, p: Vec): Vec => [
  m[0] * p[0] + m[2] * p[1] + m[4],
  m[1] * p[0] + m[3] * p[1] + m[5],
];
export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det;
  return [a, b, c, d, -a * m[4] - c * m[5], -b * m[4] - d * m[5]];
}
export const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
export const dist = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** IR degrees (y down, clockwise on screen). */
export const angleOf = (a: Vec, b: Vec) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
export function project(p: Vec, a: Vec, b: Vec): Vec {
  const d: Vec = [b[0] - a[0], b[1] - a[1]],
    L2 = d[0] ** 2 + d[1] ** 2,
    t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2;
  return lerp(a, b, t);
}

/** World bounding box of the pixels whose alpha exceeds `threshold`. */
export function opaqueWorldBox(p: CharacterPart, threshold = 16): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++)
      if (p.alpha[y * p.width + x]! > threshold)
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const [X, Y] = apply(p.affine, [x + dx, y + dy]);
          minX = Math.min(minX, X);
          minY = Math.min(minY, Y);
          maxX = Math.max(maxX, X);
          maxY = Math.max(maxY, Y);
        }
  return [minX, minY, maxX, maxY];
}
const inverses = new WeakMap<CharacterPart, Affine>();
/** Nearest-pixel alpha at a world point; 0 outside the image. */
export function alphaAt(p: CharacterPart, X: number, Y: number): number {
  let inv = inverses.get(p);
  if (!inv) inverses.set(p, (inv = invert(p.affine)));
  const [px, py] = apply(inv, [X, Y]);
  const ix = Math.floor(px),
    iy = Math.floor(py);
  if (ix < 0 || iy < 0 || ix >= p.width || iy >= p.height) return 0;
  return p.alpha[iy * p.width + ix]!;
}
/** Opaque world sample points on a `step` px grid. */
export function opaquePoints(p: CharacterPart, step = 2, threshold = 64): Vec[] {
  const [x0, y0, x1, y1] = opaqueWorldBox(p, threshold);
  const out: Vec[] = [];
  for (let Y = Math.floor(y0); Y <= y1; Y += step)
    for (let X = Math.floor(x0); X <= x1; X += step)
      if (alphaAt(p, X + 0.5, Y + 0.5) > threshold) out.push([X + 0.5, Y + 0.5]);
  return out;
}
/** Centroid of the world overlap of two images (null when they do not touch). */
export function overlapCentroid(
  a: CharacterPart,
  b: CharacterPart,
  step = 2,
  threshold = 64,
): Vec | null {
  const A = opaqueWorldBox(a, threshold),
    B = opaqueWorldBox(b, threshold);
  const x0 = Math.max(A[0], B[0]),
    y0 = Math.max(A[1], B[1]),
    x1 = Math.min(A[2], B[2]),
    y1 = Math.min(A[3], B[3]);
  let n = 0,
    sx = 0,
    sy = 0;
  for (let Y = Math.floor(y0); Y <= y1; Y += step)
    for (let X = Math.floor(x0); X <= x1; X += step)
      if (alphaAt(a, X + 0.5, Y + 0.5) > threshold && alphaAt(b, X + 0.5, Y + 0.5) > threshold) {
        n++;
        sx += X + 0.5;
        sy += Y + 0.5;
      }
  return n ? [sx / n, sy / n] : null;
}
export interface Principal {
  centroid: Vec;
  axis: Vec;
  ends: [Vec, Vec];
  elongation: number;
}
/** Principal axis of a point cloud and its two extreme points along it. */
export function principal(pts: Vec[]): Principal {
  const n = pts.length;
  let mx = 0,
    my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax: Vec = [Math.cos(ang), Math.sin(ang)];
  let lo = Infinity,
    hi = -Infinity;
  for (const [x, y] of pts) {
    const t = (x - mx) * ax[0] + (y - my) * ax[1];
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  const root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2),
    ev1 = (sxx + syy) / 2 + root,
    ev2 = (sxx + syy) / 2 - root;
  return {
    centroid: [mx, my],
    axis: ax,
    ends: [
      [mx + ax[0] * lo, my + ax[1] * lo],
      [mx + ax[0] * hi, my + ax[1] * hi],
    ],
    elongation: Math.sqrt(ev1 / Math.max(ev2, 1e-9)),
  };
}
/** Mean of the points within `band` of the extreme along `dir`. */
export function endCentroid(pts: Vec[], dir: Vec, band: number): Vec {
  let best = -Infinity;
  for (const [x, y] of pts) best = Math.max(best, x * dir[0] + y * dir[1]);
  let n = 0,
    sx = 0,
    sy = 0;
  for (const [x, y] of pts)
    if (x * dir[0] + y * dir[1] >= best - band) {
      n++;
      sx += x;
      sy += y;
    }
  return [sx / n, sy / n];
}
/**
 * Medial polyline of a strand: n+1 joints from its top (or bottom) end. Interior joints take the
 * pixel run closest to the straight line in each slice, so a curved strand stays on its own pixels.
 */
export function strandJoints(pts: Vec[], n: number, from: "top" | "bottom"): Vec[] {
  const pr = principal(pts);
  const vertical = Math.abs(pr.axis[1]) >= Math.abs(pr.axis[0]);
  const dir: Vec = vertical ? [0, 1] : [1, 0];
  const neg: Vec = [-dir[0], -dir[1]];
  const a = endCentroid(pts, from === "top" ? neg : dir, 6),
    b = endCentroid(pts, from === "top" ? dir : neg, 6);
  const joints: Vec[] = [];
  const key = vertical ? 1 : 0,
    other = 1 - key;
  for (let k = 0; k <= n; k++) {
    const c = lerp(a, b, k / n);
    const band = pts.filter((p) => Math.abs(p[key]! - c[key]!) <= 4);
    if (k === 0 || k === n || !band.length) {
      joints.push(c);
      continue;
    }
    band.sort((p, q) => p[other]! - q[other]!);
    let best = 0,
      bestD = Infinity,
      run: Vec[] = [band[0]!];
    const flush = () => {
      const m = run.reduce((s, p) => s + p[other]!, 0) / run.length;
      const d = Math.abs(m - c[other]!);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    };
    for (let i = 1; i < band.length; i++) {
      if (band[i]![other]! - band[i - 1]![other]! > 6) {
        flush();
        run = [];
      }
      run.push(band[i]!);
    }
    flush();
    const j: Vec = [0, 0];
    j[key] = c[key]!;
    j[other] = best;
    joints.push(j);
  }
  return joints;
}
/** Centre of the narrowest cross-section between fractions [t0, t1] of a -> b. */
export function narrowest(
  pts: Vec[],
  a: Vec,
  b: Vec,
  t0: number,
  t1: number,
): { point: Vec; width: number } | null {
  const d: Vec = [b[0] - a[0], b[1] - a[1]],
    L = Math.hypot(d[0], d[1]),
    u: Vec = [d[0] / L, d[1] / L],
    v: Vec = [-u[1], u[0]];
  let best: Vec | null = null,
    bestW = Infinity;
  for (let t = t0; t <= t1; t += 0.01) {
    const c = lerp(a, b, t);
    const band = pts
      .filter((p) => Math.abs((p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]) <= 2)
      .map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
    if (band.length < 4) continue;
    const hi = Math.max(...band),
      lo = Math.min(...band);
    if (hi - lo < bestW) {
      bestW = hi - lo;
      best = [c[0] + v[0] * ((hi + lo) / 2), c[1] + v[1] * ((hi + lo) / 2)];
    }
  }
  return best ? { point: best, width: bestW } : null;
}
