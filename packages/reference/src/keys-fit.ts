/**
 * Curve fitting for key reduction (ADR-044). Every error here is measured on the curve the Spine
 * 4.0 runtime actually plays: `CurveTimeline.setBezier` flattens a Bezier segment into ten straight
 * pieces through the curve at s = 0.1 … 0.9 (forward differencing), and `getBezierValue` reads the
 * value off those pieces by time. A fit that looks exact on the true Bezier can be off by about 1 %
 * of the segment's change on the runtime, so the runtime's pieces are reproduced, not the curve.
 */

/** The nine inner points (time, value) of a flattened Spine 4.0 Bezier segment. */
export function bezierPoints(
  t0: number,
  v0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  t1: number,
  v1: number,
): Float64Array {
  const out = new Float64Array(18);
  const tmpx = (t0 - cx1 * 2 + cx2) * 0.03,
    tmpy = (v0 - cy1 * 2 + cy2) * 0.03;
  const dddx = ((cx1 - cx2) * 3 - t0 + t1) * 0.006,
    dddy = ((cy1 - cy2) * 3 - v0 + v1) * 0.006;
  let ddx = tmpx * 2 + dddx,
    ddy = tmpy * 2 + dddy;
  let dx = (cx1 - t0) * 0.3 + tmpx + dddx * 0.16666667,
    dy = (cy1 - v0) * 0.3 + tmpy + dddy * 0.16666667;
  let x = t0 + dx,
    y = v0 + dy;
  for (let i = 0; i < 18; i += 2) {
    out[i] = x;
    out[i + 1] = y;
    dx += ddx;
    dy += ddy;
    ddx += dddx;
    ddy += dddy;
    x += dx;
    y += dy;
  }
  return out;
}
/** The runtime's value of a flattened Bezier segment at time t (t0 <= t <= t1). */
export function bezierValue(
  points: Float64Array,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  t: number,
): number {
  if (points[0]! > t) {
    const span = points[0]! - t0;
    return span > 0 ? v0 + ((t - t0) / span) * (points[1]! - v0) : points[1]!;
  }
  for (let i = 2; i < 18; i += 2)
    if (points[i]! >= t) {
      const x = points[i - 2]!,
        y = points[i - 1]!,
        span = points[i]! - x;
      return span > 0 ? y + ((t - x) / span) * (points[i + 1]! - y) : points[i + 1]!;
    }
  const x = points[16]!,
    y = points[17]!,
    span = t1 - x;
  return span > 0 ? y + ((t - x) / span) * (v1 - y) : v1;
}

/** A segment's curve for one channel: linear, or absolute Spine handles [cx1, cy1, cx2, cy2]. */
export type ChannelCurve = "linear" | [number, number, number, number];
/** The value one channel plays at t inside a segment (t0, v0) .. (t1, v1). */
export function curveValue(
  curve: ChannelCurve | "stepped",
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  t: number,
  points?: Float64Array,
): number {
  if (t <= t0) return v0;
  if (t >= t1) return curve === "stepped" ? v0 : v1;
  if (curve === "stepped") return v0;
  if (curve === "linear") return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
  const p = points ?? bezierPoints(t0, v0, curve[0], curve[1], curve[2], curve[3], t1, v1);
  return bezierValue(p, t0, v0, t1, v1, t);
}

/** Largest |played - target| over the samples. */
function maxError(
  curve: ChannelCurve,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  ts: ArrayLike<number>,
  vs: ArrayLike<number>,
): number {
  const p =
    curve === "linear"
      ? undefined
      : bezierPoints(t0, v0, curve[0], curve[1], curve[2], curve[3], t1, v1);
  let e = 0;
  for (let k = 0; k < ts.length; k++) {
    const d = Math.abs(curveValue(curve, t0, v0, t1, v1, ts[k]!, p) - vs[k]!);
    if (d > e) e = d;
  }
  return e;
}

/** Bezier parameter s for each normalized time u, for time handles x1, x2 (x(s) is monotonic). */
function parameters(x1: number, x2: number, us: ArrayLike<number>): Float64Array {
  const N = 48,
    xs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const s = i / N,
      m = 1 - s;
    xs[i] = 3 * m * m * s * x1 + 3 * m * s * s * x2 + s * s * s;
  }
  const out = new Float64Array(us.length);
  for (let k = 0; k < us.length; k++) {
    const u = us[k]!;
    let lo = 0,
      hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! < u) lo = mid;
      else hi = mid;
    }
    const span = xs[hi]! - xs[lo]!;
    let s = (lo + (span > 0 ? (u - xs[lo]!) / span : 0)) / N;
    // Two Newton steps on x(s) = u.
    for (let it = 0; it < 2; it++) {
      const m = 1 - s;
      const x = 3 * m * m * s * x1 + 3 * m * s * s * x2 + s * s * s - u;
      const dx = 3 * m * m * x1 + 6 * m * s * (x2 - x1) + 3 * s * s * (1 - x2);
      if (Math.abs(dx) > 1e-9) s = Math.min(1, Math.max(0, s - x / dx));
    }
    out[k] = s;
  }
  return out;
}

/**
 * Value handles y1, y2 for fixed time handles by weighted least squares. A small pull towards the
 * straight line keeps a segment with few samples from swinging wide (no overshoot the samples do
 * not show).
 */
function solveValues(
  x1: number,
  x2: number,
  us: ArrayLike<number>,
  vs: ArrayLike<number>,
  v0: number,
  v1: number,
  w: ArrayLike<number> | undefined,
): [number, number] {
  const s = parameters(x1, x2, us);
  let a11 = 0,
    a12 = 0,
    a22 = 0,
    r1 = 0,
    r2 = 0;
  for (let k = 0; k < us.length; k++) {
    const t = s[k]!,
      m = 1 - t,
      wk = w ? w[k]! : 1;
    const b1 = 3 * m * m * t,
      b2 = 3 * m * t * t,
      r = vs[k]! - (v0 * m * m * m + v1 * t * t * t);
    a11 += wk * b1 * b1;
    a12 += wk * b1 * b2;
    a22 += wk * b2 * b2;
    r1 += wk * b1 * r;
    r2 += wk * b2 * r;
  }
  const lambda = 1e-4 * (a11 + a22 + 1e-9);
  const l1 = v0 + (v1 - v0) * x1,
    l2 = v0 + (v1 - v0) * x2;
  a11 += lambda;
  a22 += lambda;
  r1 += lambda * l1;
  r2 += lambda * l2;
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-18) return [l1, l2];
  return [(r1 * a22 - r2 * a12) / det, (a11 * r2 - a12 * r1) / det];
}

export interface ChannelFit {
  curve: ChannelCurve;
  /** Largest error on the samples, in the channel's units, as the runtime plays it. */
  error: number;
}
const GRID = [0, 0.15, 0.33, 0.5, 0.67, 0.85, 1];
/**
 * The curve that best follows `vs` at times `ts` between (t0, v0) and (t1, v1): linear when that
 * is within `tolerance`, else the Bezier handles with the smallest largest error. Time handles stay
 * inside the segment and in order (the editor's rule); value handles may overshoot only as far as
 * the samples do.
 */
export function fitChannel(
  ts: ArrayLike<number>,
  vs: ArrayLike<number>,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  tolerance: number,
): ChannelFit {
  const linear = maxError("linear", t0, v0, t1, v1, ts, vs);
  if (linear <= tolerance || ts.length === 0) return { curve: "linear", error: linear };
  const span = t1 - t0;
  const us = Float64Array.from(ts, (t) => (t - t0) / span);
  let lo = Math.min(v0, v1),
    hi = Math.max(v0, v1);
  for (let k = 0; k < vs.length; k++) {
    lo = Math.min(lo, vs[k]!);
    hi = Math.max(hi, vs[k]!);
  }
  const reach = Math.max(hi - lo, 1e-6) * 3;
  const make = (x1: number, x2: number, w?: Float64Array): ChannelFit => {
    let [y1, y2] = solveValues(x1, x2, us, vs, v0, v1, w);
    y1 = Math.min(hi + reach, Math.max(lo - reach, y1));
    y2 = Math.min(hi + reach, Math.max(lo - reach, y2));
    const curve: ChannelCurve = [t0 + x1 * span, y1, t0 + x2 * span, y2];
    return { curve, error: maxError(curve, t0, v0, t1, v1, ts, vs) };
  };
  let best: ChannelFit = { curve: "linear", error: linear },
    bx = [0.33, 0.67];
  // Time handles in order (x1 <= x2): time runs forward through the segment, as the editor shows it.
  for (const x1 of GRID)
    for (const x2 of GRID) {
      if (x1 > x2) continue;
      const f = make(x1, x2);
      if (f.error < best.error) [best, bx] = [f, [x1, x2]];
    }
  // Pattern search on the time handles, then a few Lawson reweightings towards the minimax fit.
  for (const step of [0.08, 0.04, 0.02, 0.01]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [d1, d2] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ] as const) {
        const x1 = Math.min(1, Math.max(0, bx[0]! + d1)),
          x2 = Math.min(1, Math.max(0, bx[1]! + d2));
        if (x1 > x2) continue;
        const f = make(x1, x2);
        if (f.error < best.error - 1e-12) {
          [best, bx, moved] = [f, [x1, x2], true];
        }
      }
    }
  }
  if (best.curve !== "linear" && best.error > tolerance) {
    const w = new Float64Array(us.length).fill(1);
    for (let it = 0; it < 4; it++) {
      const c = best.curve as [number, number, number, number];
      const p = bezierPoints(t0, v0, c[0], c[1], c[2], c[3], t1, v1);
      let sum = 0;
      for (let k = 0; k < us.length; k++) {
        w[k] = w[k]! * (Math.abs(bezierValue(p, t0, v0, t1, v1, ts[k]!) - vs[k]!) + 1e-9);
        sum += w[k]!;
      }
      for (let k = 0; k < us.length; k++) w[k] = (w[k]! / sum) * us.length;
      const f = make(bx[0]!, bx[1]!, w);
      if (f.error < best.error) best = f;
    }
  }
  return best;
}

/**
 * One curve shared by every channel of a segment, as a Spine deform key has: the shape moves along
 * the straight line from `a` to `b` at the pace of one scalar curve. `vectors[k]` is the shape at
 * `ts[k]`; the error is the largest point distance (pairs of channels are x, y), in shape units.
 * A shape that leaves the line between the end shapes cannot be followed by any curve.
 */
export function fitShared(
  ts: ArrayLike<number>,
  vectors: readonly ArrayLike<number>[],
  t0: number,
  a: ArrayLike<number>,
  t1: number,
  b: ArrayLike<number>,
  tolerance: number,
): ChannelFit {
  const n = a.length;
  let dd = 0;
  for (let i = 0; i < n; i++) dd += (b[i]! - a[i]!) ** 2;
  // Each sample's fraction along the line a -> b.
  const fractions = new Float64Array(ts.length);
  for (let k = 0; k < ts.length; k++) {
    if (dd < 1e-12) continue;
    let dot = 0;
    const v = vectors[k]!;
    for (let i = 0; i < n; i++) dot += (v[i]! - a[i]!) * (b[i]! - a[i]!);
    fractions[k] = dot / dd;
  }
  const error = (curve: ChannelCurve) => {
    const p =
      curve === "linear"
        ? undefined
        : bezierPoints(t0, 0, curve[0], curve[1], curve[2], curve[3], t1, 1);
    let e = 0;
    for (let k = 0; k < ts.length; k++) {
      const f = curveValue(curve, t0, 0, t1, 1, ts[k]!, p),
        v = vectors[k]!;
      for (let i = 0; i + 1 < n; i += 2) {
        const dx = a[i]! + (b[i]! - a[i]!) * f - v[i]!,
          dy = a[i + 1]! + (b[i + 1]! - a[i + 1]!) * f - v[i + 1]!;
        const d = dx * dx + dy * dy;
        if (d > e) e = d;
      }
    }
    return Math.sqrt(e);
  };
  const linear = error("linear");
  if (linear <= tolerance || dd < 1e-12) return { curve: "linear", error: linear };
  // Fit the pace with a fraction tolerance scaled from the shape tolerance.
  let reach = 0;
  for (let i = 0; i + 1 < n; i += 2)
    reach = Math.max(reach, Math.hypot(b[i]! - a[i]!, b[i + 1]! - a[i + 1]!));
  const paced = fitChannel(ts, fractions, t0, 0, t1, 1, tolerance / Math.max(reach, 1e-9));
  const e = paced.curve === "linear" ? linear : error(paced.curve);
  return e < linear ? { curve: paced.curve, error: e } : { curve: "linear", error: linear };
}
