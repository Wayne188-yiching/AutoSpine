import type { KeyCurve, KeyposeEase } from "@autospine/schemas";
import { keyFraction } from "./curves.js";
import { easeCurve } from "./keyposes.js";
import { MOTION_PRIORS, oneShotKind } from "./priors.js";

/**
 * Tracks measured from a reference video (ADR-036): the period the channels share, a fold of the
 * first consistent cycles onto that period, and the reduction of per-frame values to key frames
 * shared by every channel. A channel is one bone's x, y or rotation per video frame; `null` marks a
 * frame whose picture gave no fit.
 */
export type Samples = readonly (number | null)[];

const known = (v: number | null | undefined): v is number => v !== null && v !== undefined;
const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const median = (v: readonly number[]) => {
  const s = [...v].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function pearson(pairs: readonly [number, number][]): number | null {
  if (pairs.length < 4) return null;
  const mx = mean(pairs.map((p) => p[0])),
    my = mean(pairs.map((p) => p[1]));
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 1e-12 && syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
}
/** A channel at a fractional frame, between its two known neighbours. */
function sampleAt(x: Samples, t: number): number | null {
  if (t < 0 || t > x.length - 1 + 1e-9) return null;
  const i = Math.min(x.length - 1, Math.floor(t)),
    f = t - i;
  const a = x[i],
    b = f > 1e-9 ? x[i + 1] : a;
  return known(a) && known(b) ? a + (b - a) * f : null;
}
/** Correlation of a channel with itself `lag` frames later, over the frames where both are known. */
export function autocorrelation(x: Samples, lag: number): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i + lag < x.length; i++) {
    const a = x[i],
      b = x[i + lag];
    if (known(a) && known(b)) pairs.push([a, b]);
  }
  return pearson(pairs);
}
/** Standard deviation of a channel's known values. */
export function spread(x: Samples): number {
  const v = x.filter(known),
    m = mean(v);
  return Math.sqrt(mean(v.map((a) => (a - m) ** 2)));
}

export interface PeriodEstimate {
  /** Frames, refined between whole frames. */
  period: number;
  /** Mean autocorrelation of the channels at the whole-frame peak. */
  correlation: number;
}
/**
 * A channel with lone bad frames replaced by the median of their neighbours (Hampel filter, three
 * known frames each side, three robust deviations): one bad fit must not hide the period.
 */
export function despike(x: Samples): (number | null)[] {
  return x.map((v, i) => {
    if (!known(v)) return v;
    const near: number[] = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(x.length - 1, i + 3); j++)
      if (known(x[j])) near.push(x[j]!);
    if (near.length < 4) return v;
    const m = median(near),
      d = 3 * 1.4826 * median(near.map((a) => Math.abs(a - m)));
    return Math.abs(v - m) > Math.max(d, 1e-9) ? m : v;
  });
}
/**
 * The first autocorrelation peak every channel shares: their mean autocorrelation peaks there after
 * a dip, at `minCorrelation` or more and at least 0.85 of the highest peak (later peaks are its
 * multiples), and no channel is out of step there (a limb that swings once per two bobs moves the
 * shared peak to the stride). Null when the channels repeat within no `maxLag`.
 */
export function sharedPeriod(
  channels: readonly Samples[],
  opts: { maxLag?: number; minCorrelation?: number } = {},
): PeriodEstimate | null {
  const n = Math.max(0, ...channels.map((c) => c.length));
  const maxLag = Math.min(opts.maxLag ?? Math.floor(n / 2), n - 4),
    minCorrelation = opts.minCorrelation ?? 0.5;
  if (!channels.length || maxLag < 3) return null;
  // Frames without a fit are bridged first, so every lag compares the same span (a fit of every
  // other frame leaves the odd lags without pairs).
  const per = channels
    .map((c) => (c.some(known) ? fillGaps(despike(c)) : c))
    .map((c) =>
      Array.from({ length: maxLag + 2 }, (_, lag) => (lag ? autocorrelation(c, lag) : 1)),
    );
  const avg = Array.from({ length: maxLag + 2 }, (_, lag) => {
    const v = per.map((r) => r[lag]).filter(known);
    return v.length ? mean(v) : -1;
  });
  const peaks: { lag: number; r: number }[] = [];
  let low = avg[1]!;
  for (let lag = 2; lag <= maxLag; lag++) {
    const r = avg[lag]!,
      reach = Math.max(1, Math.round(0.1 * lag));
    low = Math.min(low, avg[lag - 1]!);
    let top = true;
    for (let j = Math.max(1, lag - reach); j <= Math.min(maxLag + 1, lag + reach); j++)
      if (avg[j]! > r) top = false;
    if (!top || r < minCorrelation || low > r - 0.2) continue;
    if (per.some((c) => (c[lag] ?? 1) < 0.2)) continue;
    peaks.push({ lag, r });
  }
  if (!peaks.length) return null;
  const highest = Math.max(...peaks.map((p) => p.r));
  const { lag, r } = peaks.find((p) => p.r >= 0.85 * highest)!;
  const a = avg[lag - 1]!,
    b = avg[lag + 1]!,
    d = a - 2 * r + b;
  const shift = Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - b)) / d)) : 0;
  return { period: lag + shift, correlation: +r.toFixed(3) };
}

/** Normal equations of a small least-squares problem (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length,
    M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f) for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}
const basis = (phase: number, harmonics: number) => {
  const out = [1];
  for (let h = 1; h <= harmonics; h++)
    out.push(Math.cos(2 * Math.PI * h * phase), Math.sin(2 * Math.PI * h * phase));
  return out;
};
/** Fourier series of one channel over phase; Huber weights (IRLS) keep a bad fit from pulling. */
function fourierFit(
  t: readonly number[],
  y: readonly number[],
  period: number,
  harmonics: number,
  huber: boolean,
): { coefficients: number[]; rss: number; noise: number } {
  const rows = t.map((ti) => basis(ti / period, harmonics)),
    k = 2 * harmonics + 1;
  let w = y.map(() => 1),
    coefficients = new Array<number>(k).fill(0),
    residuals = [...y];
  for (let iter = 0; iter < (huber ? 8 : 1); iter++) {
    const A = Array.from({ length: k }, () => new Array<number>(k).fill(0)),
      b = new Array<number>(k).fill(0);
    rows.forEach((row, i) => {
      for (let p = 0; p < k; p++) {
        b[p]! += w[i]! * row[p]! * y[i]!;
        for (let q = 0; q < k; q++) A[p]![q]! += w[i]! * row[p]! * row[q]!;
      }
    });
    for (let p = 0; p < k; p++) A[p]![p]! += 1e-9;
    coefficients = solve(A, b);
    residuals = rows.map((row, i) => y[i]! - row.reduce((s, v, p) => s + v * coefficients[p]!, 0));
    if (!huber) break;
    const scale = 1.4826 * median(residuals.map(Math.abs));
    if (!(scale > 1e-9)) break;
    const delta = 1.345 * scale;
    w = residuals.map((r) => (Math.abs(r) <= delta ? 1 : delta / Math.abs(r)));
  }
  return {
    coefficients,
    rss: residuals.reduce((s, r) => s + r * r, 0),
    noise: residuals.length ? 1.4826 * median(residuals.map(Math.abs)) : 0,
  };
}

export interface Fold {
  /** Frames per cycle, refined over the cycles used. */
  period: number;
  /** Whole cycles from frame 0 that stay in step and were folded; the fold uses frames [0, frames). */
  cycles: number;
  frames: number;
  /** Frames the last whole cycle of the clip arrives late (negative: early) against the fold. */
  drift: number;
  harmonics: number;
  /** Fourier coefficients per channel: [mean, cos 1, sin 1, cos 2, ...] over the phase. */
  coefficients: number[][];
  /** Per channel, the robust spread of its samples about the fold (1.4826 x the median residual). */
  noise: number[];
}
/** A folded channel's value at a phase (0 = the video's frame 0, 1 = one period later). */
export function foldValue(fold: Fold, channel: number, phase: number): number {
  const c = fold.coefficients[channel]!;
  return basis(phase, fold.harmonics).reduce((s, v, p) => s + v * c[p]!, 0);
}
/**
 * Folds the channels onto one period (ADR-036). Cycles are used from frame 0 while each matches the
 * first (correlation `minConsistency`, default 0.8): a clip that speeds up drifts out of step and its
 * later cycles are left out, their drift reported. The period is refined within ±3 % over the cycles
 * used, and each channel is a robust (Huber) Fourier series over the phase: the fold is on the real
 * period, never on a whole number of frames it does not divide, so a fast bounce keeps its height.
 */
export function foldTracks(
  channels: readonly Samples[],
  period: number,
  opts: {
    harmonics?: number;
    minConsistency?: number;
    /** Channels to fold with the period and cycles found on `channels` (default: those). */
    values?: readonly Samples[];
  } = {},
): Fold {
  const n = Math.max(0, ...channels.map((c) => c.length)),
    minConsistency = opts.minConsistency ?? 0.8;
  // Cycle k against cycle 0 at period P, over one period, shifted by s frames (gaps bridged).
  const bridged = channels.map((c) => (c.some(known) ? fillGaps(c) : c));
  const inStep = (k: number, s: number, P: number) => {
    const r: number[] = [];
    for (const c of bridged) {
      const pairs: [number, number][] = [];
      for (let t = 0; t < P; t++) {
        const a = sampleAt(c, t),
          b = sampleAt(c, t + k * P + s);
        if (known(a) && known(b)) pairs.push([a, b]);
      }
      const p = pearson(pairs);
      if (known(p)) r.push(p);
    }
    return r.length ? mean(r) : -1;
  };
  const bestShift = (k: number, P: number, span: number, around = 0) => {
    let best = -Infinity,
      shift = around;
    for (let s = around - span; s <= around + span + 1e-9; s += 0.1) {
      const r = inStep(k, s, P);
      if (r > best + 1e-9) [best, shift] = [r, s];
    }
    return { r: best, shift };
  };
  // The period of the whole clip is its mean tempo; a clip that speeds up starts slower. The first
  // two cycles give the starting tempo; each later cycle joins while it is in step at the period so
  // far (no shift), and then refines it.
  let P = period,
    cycles = 1;
  // A cycle fits the clip within a frame: the period is an estimate between whole frames.
  if (2 * P <= n + 1) {
    const first = bestShift(1, P, P / 4);
    if (first.r >= minConsistency) {
      P += first.shift;
      cycles = 2;
      while ((cycles + 1) * P <= n + 1 && inStep(cycles, 0, P) >= minConsistency) {
        const next = P + bestShift(cycles, P, P / 8).shift / cycles;
        // Every cycle already folded must stay in step at the refined period too.
        let held = true;
        for (let k = 1; k <= cycles && held; k++) held = inStep(k, 0, next) >= minConsistency;
        if (!held) break;
        P = next;
        cycles++;
      }
    }
  }
  const whole = Math.max(1, Math.floor((n + 1) / P));
  // Drift: the shift of the clip's last whole cycle, followed cycle by cycle (past half a period).
  let drift = 0;
  for (let k = 1; k < whole; k++) drift = bestShift(k, P, P / 4, drift).shift;
  const samplesOf = (of: readonly Samples[], Q: number) => {
    const until = Math.min(n, Math.ceil(cycles * Q - 1e-9));
    return of.map((c) => {
      const t: number[] = [],
        y: number[] = [];
      for (let i = 0; i < Math.min(until, c.length); i++)
        if (known(c[i])) {
          t.push(i);
          y.push(c[i]!);
        }
      return { t, y, until };
    });
  };
  const samples = (Q: number) => samplesOf(channels, Q);
  const variance = channels.map((c) => Math.max(1e-9, spread(c) ** 2));
  const harmonicsFor = (count: number) =>
    Math.max(
      1,
      Math.min(opts.harmonics ?? Math.max(3, Math.round(P / 8)), Math.floor((count - 1) / 4)),
    );
  // Refine the period over the cycles used: least residual of a plain fit.
  let refined = P,
    bestRss = Infinity;
  if (cycles > 1)
    for (let i = -30; i <= 30; i++) {
      const Q = P * (1 + i * 0.001),
        data = samples(Q);
      let rss = 0;
      data.forEach((d, c) => {
        if (d.t.length >= 4)
          rss += fourierFit(d.t, d.y, Q, harmonicsFor(d.t.length), false).rss / variance[c]!;
      });
      if (rss < bestRss - 1e-12) [bestRss, refined] = [rss, Q];
    }
  const data = opts.values ? samplesOf(opts.values, refined) : samples(refined);
  const harmonics = harmonicsFor(Math.min(...samples(refined).map((d) => d.t.length)));
  const fits = data.map((d) =>
    d.t.length >= 2 * harmonics + 1
      ? fourierFit(d.t, d.y, refined, harmonics, true)
      : {
          coefficients: [d.y.length ? median(d.y) : 0, ...new Array<number>(2 * harmonics).fill(0)],
          noise: 0,
        },
  );
  return {
    period: +refined.toFixed(4),
    cycles,
    frames: samples(refined)[0]?.until ?? 0,
    drift: +drift.toFixed(2),
    harmonics,
    coefficients: fits.map((f) => f.coefficients),
    noise: fits.map((f) => +f.noise.toFixed(4)),
  };
}

/** Whole cycles of `period` in an animation of `frames`, and how far that stretches the period. */
export function cyclesIn(frames: number, period: number): { cycles: number; stretch: number } {
  const cycles = Math.max(1, Math.round(frames / period));
  return { cycles, stretch: +(frames / cycles / period - 1).toFixed(4) };
}
/**
 * The shortest animation length holding a whole number of periods within `tolerance` stretch
 * (default 1 %): 5.75 frames gives 23 (four), 7.5 gives 15 (two).
 */
export function wholeCycleLength(
  period: number,
  tolerance = 0.01,
  max = 3600,
): { frames: number; cycles: number; stretch: number } | null {
  for (let k = 1; k * period <= max + 0.5; k++) {
    const frames = Math.round(k * period);
    if (frames < 2) continue;
    const stretch = frames / (k * period) - 1;
    if (Math.abs(stretch) <= tolerance) return { frames, cycles: k, stretch: +stretch.toFixed(4) };
  }
  return null;
}

/** Gaps filled linearly between known frames, held at the ends; a channel with none stays 0. */
export function fillGaps(x: Samples): number[] {
  const idx = x.flatMap((v, i) => (known(v) ? [i] : []));
  if (!idx.length) return x.map(() => 0);
  return x.map((v, i) => {
    if (known(v)) return v;
    const after = idx.find((j) => j > i),
      before = [...idx].reverse().find((j) => j < i);
    if (before === undefined) return x[after!]!;
    if (after === undefined) return x[before]!;
    return x[before]! + ((x[after]! - x[before]!) * (i - before)) / (after - before);
  });
}
/** Median of three neighbours (the ends keep their value): one bad frame does not make a key. */
export function median3(x: readonly number[]): number[] {
  return x.map((v, i) => (i === 0 || i === x.length - 1 ? v : median([x[i - 1]!, v, x[i + 1]!])));
}

/** The artists' key spacing for an animation (ADR-032), frames at 30 fps. */
export function keyGapPrior(name: string, loop: boolean): { category: string; frames: number } {
  const P = MOTION_PRIORS as unknown as Record<string, { keyGapFrames?: { median: number } }>;
  if (loop) return { category: "idle", frames: P.idle!.keyGapFrames!.median };
  const kind = oneShotKind(name),
    own = P[kind]?.keyGapFrames;
  return own
    ? { category: kind, frames: own.median }
    : { category: "characterOneShot", frames: P.characterOneShot!.keyGapFrames!.median };
}

const NAMED_EASES = ["linear", "sine", "ease", "out", "in", "drift"] as const;
export interface KeyReduction {
  /** Key frames shared by every channel, increasing, starting at 0. */
  frames: number[];
  /** Each key's arrival ease (a loop's first key: the ease of the segment wrapping into it). */
  eases: KeyposeEase[];
  /** Largest error left, in tolerances (1 = at the tolerance). */
  error: number;
  /** The key cap held: the tolerance was relaxed until the keys fitted under it. */
  capped: boolean;
}
/**
 * Shared key frames for per-frame targets (ADR-036). `targets[c][g]` is channel c on frame g for
 * g = 0..frames (a loop's frame `frames` is its frame 0 again, reached by the wrap into the first
 * key). Keys take the targets' values; each segment has one arrival ease for every channel, the
 * named ease that fits it best. The fewest keys that keep every channel within its tolerance are
 * found by dynamic programming over the frames, keys at least `minGap` apart (frame 0 always, a
 * one-shot's last frame too). When that takes more than `maxKeys`, the tolerance is relaxed until it
 * does not; a segment still past its tolerance then gets a key curve of its own, fitted to it.
 */
export function reduceKeys(
  targets: readonly (readonly number[])[],
  tolerance: readonly number[],
  opts: {
    loop: boolean;
    minGap?: number;
    maxKeys?: number;
    maxSpan?: number;
    /** Reach as far as each key can instead of the exact fewest keys: near the fewest, far faster. */
    greedy?: boolean;
  },
): KeyReduction {
  const length = Math.max(0, ...targets.map((t) => t.length)),
    last = length - 1,
    minGap = Math.max(1, opts.minGap ?? 2),
    maxKeys = Math.max(1, opts.maxKeys ?? 256),
    maxSpan = Math.max(minGap, opts.maxSpan ?? 240);
  if (length < 2 || last < minGap)
    return { frames: [0], eases: ["linear"], error: 0, capped: false };
  // Eased fractions per segment length and ease.
  const tables = new Map<number, Float64Array[]>();
  const table = (span: number) => {
    let t = tables.get(span);
    if (!t)
      tables.set(
        span,
        (t = NAMED_EASES.map((e) => {
          const curve = easeCurve(e),
            out = new Float64Array(span + 1);
          for (let k = 0; k <= span; k++) out[k] = keyFraction(curve, k / span);
          return out;
        })),
      );
    return t;
  };
  // The best named ease of segment a..b and its error, computed once.
  const errors = new Float32Array(length * (maxSpan + 1)).fill(NaN),
    eases = new Uint8Array(length * (maxSpan + 1));
  const segment = (a: number, b: number) => {
    const id = a * (maxSpan + 1) + (b - a);
    if (Number.isNaN(errors[id]!)) {
      const tab = table(b - a);
      let best = Infinity,
        which = 0;
      tab.forEach((fraction, e) => {
        let error = 0;
        for (let c = 0; c < targets.length && error < best; c++) {
          const t = targets[c]!,
            from = t[a]!,
            d = t[b]! - from,
            tol = tolerance[c]!;
          for (let g = a + 1; g < b; g++) {
            const x = Math.abs(from + d * fraction[g - a]! - t[g]!) / tol;
            if (x > error) error = x;
          }
        }
        if (error < best) [best, which] = [error, e];
      });
      errors[id] = best;
      eases[id] = which;
    }
    return { error: errors[id]!, ease: eases[id]! };
  };
  // A key may sit on frame 0, on the last frame (a loop's wrap end), or minGap from both.
  const node = (g: number) => g === 0 || g === last || (g >= minGap && g <= last - minGap);
  const reach = (scale: number) => {
    const path = [0];
    let error = 0;
    while (path.at(-1)! < last) {
      const a = path.at(-1)!;
      let best = -1,
        bestError = 0,
        misses = 0;
      for (let b = a + minGap; b <= Math.min(last, a + maxSpan); b++) {
        if (!node(b)) continue;
        const e = segment(a, b).error;
        if (e <= scale) [best, bestError, misses] = [b, e, 0];
        else if (++misses >= 8 && e > 4 * scale) break;
      }
      if (best < 0) return null;
      path.push(best);
      error = Math.max(error, bestError);
    }
    return { path, error };
  };
  const solve = (scale: number) => (opts.greedy ? reach(scale) : exact(scale));
  const exact = (scale: number) => {
    const cost = new Int32Array(length).fill(1 << 30),
      worst = new Float64Array(length).fill(Infinity),
      prev = new Int32Array(length).fill(-1);
    cost[0] = 1;
    worst[0] = 0;
    for (let a = 0; a < last; a++) {
      if (cost[a]! >= 1 << 30 || !node(a)) continue;
      let misses = 0;
      for (let b = a + minGap; b <= Math.min(last, a + maxSpan); b++) {
        if (!node(b)) continue;
        const { error } = segment(a, b);
        if (error <= scale) {
          misses = 0;
          const c = cost[a]! + 1,
            w = Math.max(worst[a]!, error);
          if (c < cost[b]! || (c === cost[b]! && w < worst[b]!))
            [cost[b], worst[b], prev[b]] = [c, w, a];
        } else if (++misses >= 8 && error > 4 * scale) break;
      }
    }
    if (prev[last]! < 0) return null;
    const path = [last];
    while (path[0] !== 0) path.unshift(prev[path[0]!]!);
    return { path, error: worst[last]! };
  };
  const keyCount = (path: number[]) => (opts.loop ? path.length - 1 : path.length);
  // The smallest tolerance scale (from 1) at which `ok` holds: double, then halve the bracket.
  const relax = (ok: (r: ReturnType<typeof solve>) => boolean) => {
    if (ok(solve(1))) return 1;
    let lo = 1,
      hi = 2;
    while (!ok(solve(hi)) && hi < 1 << 16) [lo, hi] = [hi, hi * 2];
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (ok(solve(mid))) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  // Keys closer than minGap may be what the motion needs: first the scale any keys reach, then the
  // scale the cap allows.
  const reachable = solve(relax((r) => r !== null))!;
  const capped = keyCount(reachable.path) > maxKeys;
  const found = capped ? solve(relax((r) => r !== null && keyCount(r.path) <= maxKeys)) : reachable;
  const path = found!.path;
  // A segment still past its tolerance gets its own key curve: coordinate search from its ease.
  const own = (a: number, b: number, from: KeyCurve | undefined) => {
    const error = (curve: KeyCurve) => {
      let e = 0;
      targets.forEach((t, c) => {
        for (let g = a + 1; g < b; g++) {
          const v = t[a]! + (t[b]! - t[a]!) * keyFraction(curve, (g - a) / (b - a));
          e = Math.max(e, Math.abs(v - t[g]!) / tolerance[c]!);
        }
      });
      return e;
    };
    const curve = (q: number[]): KeyCurve => ({
      type: "bezier",
      x1: +q[0]!.toFixed(3),
      y1: +q[1]!.toFixed(3),
      x2: +q[2]!.toFixed(3),
      y2: +q[3]!.toFixed(3),
    });
    let p =
        from?.type === "bezier" ? [from.x1, from.y1, from.x2, from.y2] : [0.33, 0.33, 0.67, 0.67],
      best = error(curve(p));
    for (const step of [0.1, 0.05, 0.02, 0.01])
      for (let improved = true, rounds = 0; improved && rounds < 20; rounds++) {
        improved = false;
        for (let j = 0; j < 4; j++)
          for (const dir of [-1, 1]) {
            const q = [...p];
            q[j] =
              j % 2
                ? Math.min(2, Math.max(-1, q[j]! + dir * step))
                : Math.min(1, Math.max(0, q[j]! + dir * step));
            const e = error(curve(q));
            if (e < best - 1e-9) [p, best, improved] = [q, e, true];
          }
      }
    return { curve: curve(p), error: best };
  };
  let error = 0;
  const arrivals = path.slice(1).map((b, i) => {
    const a = path[i]!,
      s = segment(a, b);
    let ease: KeyposeEase = NAMED_EASES[s.ease]!,
      e = s.error;
    if (e > 1 && b - a >= 4) {
      const fitted = own(a, b, easeCurve(NAMED_EASES[s.ease]!));
      if (fitted.error < e - 1e-9) [ease, e] = [fitted.curve, fitted.error];
    }
    error = Math.max(error, e);
    return ease;
  });
  const frames = opts.loop ? path.slice(0, -1) : path;
  return {
    frames,
    eases: frames.map((_, i) =>
      i === 0 ? (opts.loop ? arrivals.at(-1)! : "linear") : arrivals[i - 1]!,
    ),
    error: +error.toFixed(3),
    capped,
  };
}

/** Channel values (frames 0..N, a loop's frame N being its frame 0) moved `d` frames earlier. */
function advance(t: readonly number[], d: number, loop: boolean): number[] {
  const N = t.length - 1;
  return t.map((_, g) =>
    loop ? t[(((g + d) % N) + N) % N]! : t[Math.min(N, Math.max(0, g + d))]!,
  );
}
/** Each channel's largest gap from the keys' eased segments, in tolerances. */
function keyErrors(
  targets: readonly (readonly number[])[],
  tolerance: readonly number[],
  reduced: KeyReduction,
  loop: boolean,
): number[] {
  const last = Math.max(0, ...targets.map((t) => t.length)) - 1,
    ends = loop ? [...reduced.frames, last] : reduced.frames;
  const curves = ends.map((_, i) =>
    easeCurve(loop && i === ends.length - 1 ? reduced.eases[0]! : reduced.eases[i]!),
  );
  return targets.map((t, c) => {
    let e = 0;
    for (let i = 1; i < ends.length; i++) {
      const a = ends[i - 1]!,
        b = ends[i]!;
      for (let g = a + 1; g < b; g++) {
        const v = t[a]! + (t[b]! - t[a]!) * keyFraction(curves[i], (g - a) / (b - a));
        e = Math.max(e, Math.abs(v - t[g]!) / tolerance[c]!);
      }
    }
    return e;
  });
}
/**
 * What a one-shot channel played `d` frames late loses at its ends, in tolerances: it holds its
 * frame-d value before frame d (its last-but-|d| value after N - |d| when early).
 */
function endError(t: readonly number[], d: number, tolerance: number): number {
  const N = t.length - 1;
  let e = 0;
  if (d > 0) for (let g = 0; g < d; g++) e = Math.max(e, Math.abs(t[d]! - t[g]!));
  else if (d < 0) for (let g = N + d + 1; g <= N; g++) e = Math.max(e, Math.abs(t[N + d]! - t[g]!));
  return e / tolerance;
}
export interface KeyLags {
  /** Frames each group plays after the shared keys (negative: before them); 0 = on the keys. */
  lags: number[];
  /** The targets with each group moved its lag earlier: what the shared keys stand for. */
  targets: number[][];
  reduced: KeyReduction;
}
/**
 * Shared key frames with a time offset per group of channels (ADR-040; a group is one bone's
 * channels). A bone that trails the others by a few frames (a head behind the body, an arm behind
 * the shoulder) reaches its extremes between the shared keys, so with few keys its swing is cut and
 * its timing lost.
 *
 * Each group's lag is measured behind the group it hangs from (`parents`, skipping groups that do
 * not move that way): the shift, up to `maxLag` frames, at which its most moving channel
 * correlates best with one of the parent's of the same kind (`kinds`: a rotation with a rotation,
 * never with the hips' bob), at least 0.6 and better than in step. Lags add down the hierarchy: a
 * hand 2 frames behind the forearm that is 3 behind the body plays 5 frames after the body. A
 * group that moves its own way correlates with nothing, and one that does not move rides along:
 * both stay in step with their parent.
 *
 * Each group is moved earlier by its lag and the keys are found again for the moved targets; the
 * build plays the group that many frames later. A loop's keys always include frame 0, so where
 * they fit depends on the layer's timing as a whole: the lags are tried with every common offset
 * up to `maxLag` (all groups moved alike; what plays stays the same motion), and the best fit is
 * taken. A one-shot counts what a move loses at its ends (a group played late holds its frame-d
 * value before frame d). The lags are kept when their keys are no more and fit the channels
 * better on average without a worse channel past 5 %; where the plain keys already play within the
 * tolerance, only when they are fewer. Otherwise every lag is 0 and the plain reduction is
 * returned.
 */
export function lagKeys(
  targets: readonly (readonly number[])[],
  tolerance: readonly number[],
  groups: readonly (readonly number[])[],
  opts: Parameters<typeof reduceKeys>[2] & {
    maxLag: number;
    parents?: readonly (number | undefined)[];
    /** Each channel's kind ("rotate", "x", "y"): a lag is measured between channels of one kind. */
    kinds?: readonly string[];
  },
): KeyLags {
  const base = reduceKeys(targets, tolerance, opts),
    plain = { lags: groups.map(() => 0), targets: targets.map((t) => [...t]), reduced: base };
  const maxLag = Math.floor(opts.maxLag);
  if (maxLag < 1 || !groups.length) return plain;
  const loop = opts.loop;
  const moved = (lags: readonly number[]) => {
    const out = targets.map((t) => [...t]);
    groups.forEach((g, k) => {
      if (lags[k]) for (const c of g) out[c] = advance(targets[c]!, lags[k]!, loop);
    });
    return out;
  };
  const fit = (lags: readonly number[], reduced: KeyReduction) => {
    const keys = keyErrors(moved(lags), tolerance, reduced, loop);
    if (!loop)
      groups.forEach((g, k) => {
        for (const c of g)
          keys[c] = Math.max(keys[c]!, endError(targets[c]!, lags[k]!, tolerance[c]!));
      });
    return { mean: mean(keys), max: Math.max(0, ...keys) };
  };

  // Each group behind the nearest group above it that moves the same way (a rotation behind a
  // rotation, never behind the hips' bob): the shift at which they correlate best.
  const score = (c: number) => spread(targets[c]!) / tolerance[c]!;
  const moving = (k: number) => groups[k]!.filter((c) => score(c) >= 1);
  const behind = groups.map((_, k) => {
    // A group that does not move rides along with its parent.
    const own = moving(k);
    if (!own.length) return { parent: opts.parents?.[k], lag: 0 };
    const c = own.reduce((a, b) => (score(b) > score(a) ? b : a)),
      like = (q: number) => moving(q).filter((x) => !opts.kinds || opts.kinds[x] === opts.kinds[c]);
    let p = opts.parents?.[k];
    while (p !== undefined && !like(p).length) p = opts.parents?.[p];
    if (p === undefined) return { parent: undefined, lag: 0 };
    const refs = like(p);
    const r = (d: number) => {
      const x = advance(targets[c]!, d, loop);
      return Math.max(
        0,
        ...refs.map((q) => Math.abs(pearson(targets[q]!.map((v, g) => [v, x[g]!])) ?? 0)),
      );
    };
    const r0 = r(0);
    let best = 0,
      bestR = r0;
    for (let d = -maxLag; d <= maxLag; d++) {
      const v = r(d);
      if (v > bestR + 1e-9 || (Math.abs(v - bestR) <= 1e-9 && Math.abs(d) < Math.abs(best)))
        [best, bestR] = [d, v];
    }
    return { parent: p, lag: bestR >= 0.6 && bestR > r0 + 0.005 ? best : 0 };
  });
  // Added down the hierarchy; a loop's total wraps into half its length, a one-shot's is held to it.
  const N = Math.max(1, ...targets.map((t) => t.length - 1));
  const total: (number | undefined)[] = groups.map(() => undefined);
  const lagOf = (k: number, depth = 0): number => {
    if (total[k] === undefined) {
      const p = behind[k]!.parent,
        sum = behind[k]!.lag + (p === undefined || depth > groups.length ? 0 : lagOf(p, depth + 1));
      total[k] = loop
        ? ((((sum + Math.floor(N / 2)) % N) + N) % N) - Math.floor(N / 2)
        : Math.max(-Math.floor(N / 2), Math.min(Math.floor(N / 2), sum));
    }
    return total[k]!;
  };
  const fromParents = groups.map((_, k) => lagOf(k));

  // A loop's keys may start off frame 0's timing (the whole layer moved by one offset) where they
  // fit better; what plays stays the video's motion. Offsets are scored on the fast reduction, and
  // the best is reduced exactly.
  if (fromParents.every((d) => d === 0)) return plain;
  let lags = fromParents,
    least = Infinity;
  for (let k = 0; loop && k <= 2 * maxLag; k++) {
    const shift = k % 2 ? (k + 1) / 2 : -k / 2,
      shifted = fromParents.map((d) => d + shift),
      r = reduceKeys(moved(shifted), tolerance, { ...opts, greedy: true }),
      m = fit(shifted, r).mean;
    if (m < least - 1e-9) [lags, least] = [shifted, m];
  }
  const aligned = moved(lags),
    r = reduceKeys(aligned, tolerance, opts),
    before = fit(plain.lags, base),
    after = fit(lags, r);
  // Keys that already play within the tolerance take lags only to save keys.
  const better = base.capped
    ? after.mean < before.mean - 1e-9
    : r.frames.length < base.frames.length;
  return r.frames.length <= base.frames.length && better && after.max <= 1.05 * before.max + 1e-9
    ? { lags, targets: aligned, reduced: r }
    : plain;
}
