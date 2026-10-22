import { fitChannel, fitShared, type ChannelCurve } from "./keys-fit.js";
import {
  readTimelines,
  setTimelineKeys,
  timelineValue,
  writeKeys,
  type PlannedKey,
  type Timeline,
  type TimelineKind,
} from "./keys-timeline.js";
import {
  boneReach,
  influence,
  parentScale,
  poseDifference,
  samplePose,
  type Influence,
  type Pose,
} from "./keys-world.js";
import { loadSkeleton, type LoadedSkeleton } from "./runtime.js";

/**
 * Key reduction (ADR-044): fewer keys within a stated error of how the animation plays.
 *
 * - `fidelity` keeps a subset of the original keys (the fewest per timeline whose refitted Spine
 *   Bezier segments stay within the channel tolerance) and inserts original keys back where the
 *   played result is off.
 * - `posable` keys the main bones on shared pose frames found in the motion (turning points of a
 *   group of bones that turn together), on whole frames, and keys follow parts and deform on their
 *   own turning points, so phase and lag stay as they were.
 *
 * Channel tolerances only pre-filter. Acceptance is the played result on the official runtime:
 * world vertex distances after the hierarchy, weights, constraints and deform, sampled on every
 * substep of every frame, every key and both sides of every state change, against the untouched
 * original. Where a sample is over the limit, a key is added on the worst part's timeline at that
 * time; past the budget, those timelines (then the whole animation) go back to the original keys.
 */
export type KeyReductionMode = "fidelity" | "posable";
export interface KeyLock {
  animation?: string;
  /** Timeline id (`bone:hip/rotate`) or owner name (bone, slot, constraint). */
  timeline?: string;
  /** Key time in seconds; omitted locks every key of the timeline. */
  time?: number;
}
export interface KeyReductionOptions {
  mode: KeyReductionMode;
  /** Frames per second; default the document's (`skeleton.fps`) or 30. */
  fps?: number;
  /** Largest world vertex distance, skeleton px; default by mode from the skeleton's size. */
  maxError?: number;
  /** World RMS limit, skeleton px; default by mode from the skeleton's size. */
  rmsError?: number;
  /** Colour channels, 0..1 (default 1/255). */
  colorTolerance?: number;
  /** Share of `maxError` one channel may use before the played check (default 0.5). */
  localShare?: number;
  /** Animations to reduce; default all. */
  animations?: string[];
  /** Timeline kinds to reduce; default all. */
  kinds?: TimelineKind[];
  /** Timelines left as they are: ids or owners. */
  skip?: string[];
  /** Keys (or whole timelines) kept exactly. */
  lock?: KeyLock[];
  /** Keep keys that sit on event times (default true). */
  protectEvents?: boolean;
  /** Played-check samples per frame (default 4). */
  substeps?: number;
  /** Keys added per animation before falling back (default 400). */
  maxInsertions?: number;
  /** Treat these animations as loops (default: start and end pose match). */
  loops?: string[];
  /**
   * The untouched original of an earlier reduction. An animation of the input that still plays
   * within the limit of the baseline's is reduced again from the baseline (the same result, so
   * running again never compounds error); one edited past the limit is reduced as it is now.
   */
  baseline?: Record<string, unknown>;
}

/** Default limits as fractions of the skeleton's size (its height, else its bounds' larger side). */
export const KEY_LIMITS: Record<KeyReductionMode, { max: number; rms: number }> = {
  fidelity: { max: 0.001, rms: 0.0003 },
  posable: { max: 0.003, rms: 0.001 },
};

export interface TimelineReport {
  id: string;
  kind: TimelineKind;
  before: number;
  after: number;
  status: "reduced" | "unchanged" | "constant" | "locked" | "skipped" | "restored";
  /** Channel tolerance used before the played check, and its unit. */
  tolerance: number;
  unit: string;
  /** Keys added back by the played check. */
  inserted: number;
  /** Largest channel error left (in the unit), on the fitting samples. */
  channelError: number;
  reason?: string;
}
export interface PoseNode {
  label: string;
  frame: number;
  time: number;
  /** Largest world vertex distance at this time, px. */
  error: number;
}
export interface MotionGroup {
  bones: string[];
  role: "main" | "follow" | "single";
  /** Shared pose frames (main) or own turning frames. */
  frames: number[];
  /** Frames this group turns after the group it hangs from (follow). */
  lagFrames?: number;
}
export interface FollowCheck {
  bone: string;
  /** Turning times of the bone's world rotation, frames. */
  peaksOriginal: number[];
  peaksReduced: number[];
  /** Largest shift of a turning time, frames (null: a turn was lost or added). */
  maxShift: number | null;
  /** Lag behind the bone it follows, frames (cross-correlation of rotation speed). */
  lagOriginal: number;
  lagReduced: number;
}
export interface AnimationReport {
  name: string;
  mode: KeyReductionMode;
  fps: number;
  duration: { before: number; after: number };
  loop: boolean;
  keys: {
    before: number;
    after: number;
    byKind: Record<string, { before: number; after: number }>;
    /** Keys removed from timelines that never change (one key kept each). */
    removedConstant: number;
    /** Keys removed from moving timelines (segments merged and refitted). */
    removedMotion: number;
  };
  timelines: TimelineReport[];
  limits: { maxError: number; rmsError: number; unit: string };
  world: {
    max: number;
    rms: number;
    worstTime: number;
    worstFrame: number;
    worstSlot: string | null;
    worstAttachment: string | null;
    /** RMS of the worst single sample. */
    worstSampleRms: number;
    samples: number;
    adaptiveSamples: number;
  };
  pass: boolean;
  discrete: {
    stateMismatches: number;
    orderMismatches: number;
    events: "unchanged";
    attachmentKeys: "unchanged";
  };
  poses: PoseNode[];
  groups: MotionGroup[];
  follow: FollowCheck[];
  contacts: { slots: string[]; from: number; to: number; slide: number; slideOriginal: number }[];
  seam: {
    poseOriginal: number;
    poseReduced: number;
    velocityJumpOriginal: number;
    velocityJumpReduced: number;
  } | null;
  insertions: { timeline: string; time: number; slot: string }[];
  fallbacks: string[];
  notes: string[];
}
export interface KeyReductionReport {
  mode: KeyReductionMode;
  spine: string;
  fps: number;
  /** Skeleton size the default limits scale with, px. */
  size: number;
  limits: { maxError: number; rmsError: number; colorTolerance: number; localShare: number };
  sampling: string;
  units: Record<string, string>;
  animations: AnimationReport[];
  keys: { before: number; after: number };
  /** Where each animation was reduced from (with a baseline). */
  sources: { animation: string; from: "input" | "baseline"; reason: string }[];
  pass: boolean;
}

type Raw = Record<string, unknown>;
const EPS = 1e-4;
const UNITS: Record<string, string> = {
  rotate: "deg",
  shear: "deg",
  shearx: "deg",
  sheary: "deg",
  translate: "px (parent space)",
  translatex: "px (parent space)",
  translatey: "px (parent space)",
  scale: "scale factor",
  scalex: "scale factor",
  scaley: "scale factor",
  deform: "px (mesh space)",
  color: "0..1 per channel",
  mix: "0..1",
};
const unitOf = (tl: Timeline) =>
  tl.kind === "bone"
    ? UNITS[tl.prop]!
    : tl.kind === "deform"
      ? UNITS.deform!
      : tl.kind === "slot"
        ? UNITS.color!
        : tl.kind === "path" && tl.prop !== "mix"
          ? "path units"
          : "0..1 mix, px softness";

/** Skeleton size: the editor's recorded height, else the setup bounds' larger side. */
function skeletonSize(doc: Raw, sk: LoadedSkeleton): number {
  const h = (doc.skeleton as Raw | undefined)?.height;
  if (typeof h === "number" && h > 0) return h;
  let lx = Infinity,
    ly = Infinity,
    hx = -Infinity,
    hy = -Infinity;
  for (const v of samplePose(sk, null, 0).verts)
    if (v)
      for (let k = 0; k + 1 < v.length; k += 2) {
        [lx, hx] = [Math.min(lx, v[k]!), Math.max(hx, v[k]!)];
        [ly, hy] = [Math.min(ly, v[k + 1]!), Math.max(hy, v[k + 1]!)];
      }
  const size = Math.max(hx - lx, hy - ly);
  return Number.isFinite(size) && size > 0 ? size : 100;
}

/** Per-frame values of a timeline, for turning points. */
function frameValues(
  tl: Timeline,
  fps: number,
  from: number,
  to: number,
): { frames: number[]; v: number[][] } {
  const frames: number[] = [];
  for (let f = Math.ceil(from * fps - EPS); f / fps <= to + EPS; f++) frames.push(f);
  return {
    frames,
    v: frames.map((f) =>
      timelineValue(tl.times, tl.values, tl.curves, tl.shared, Math.min(to, f / fps)),
    ),
  };
}
/**
 * Turning frames of a signal: extrema whose prominence reaches `tolerance`, and the frames where a
 * hold starts or ends. For a vector (deform), the distance from the first shape and the main axis.
 */
function turningFrames(
  frames: number[],
  v: number[][],
  tolerance: number[],
  shared: boolean,
): number[] {
  if (frames.length < 3) return [];
  let signals: number[][];
  let tols: number[];
  if (shared) {
    const a = v[0]!;
    // Main axis: from the first shape to the farthest one.
    let far = 0,
      fd = 0;
    v.forEach((x, i) => {
      const d = x.reduce((s, y, j) => s + (y - a[j]!) ** 2, 0);
      if (d > fd) [far, fd] = [i, d];
    });
    const axis = v[far]!.map((y, j) => y - a[j]!),
      len = Math.sqrt(fd) || 1;
    signals = [
      v.map((x) =>
        Math.sqrt(x.reduce((s, y, j) => s + (y - a[j]!) ** 2, 0) / Math.max(1, x.length / 2)),
      ),
      v.map((x) => x.reduce((s, y, j) => s + (y - a[j]!) * axis[j]!, 0) / len),
    ];
    tols = [tolerance[0]!, tolerance[0]!];
  } else {
    signals = tolerance.map((_, c) => v.map((x) => x[c]!));
    tols = tolerance;
  }
  const out = new Set<number>();
  signals.forEach((s, c) => {
    const tol = tols[c]!;
    // Extrema with prominence: walk the alternating sequence of local max/min.
    const ext: number[] = [];
    for (let i = 1; i < s.length - 1; i++) {
      const up = s[i]! - s[i - 1]!,
        down = s[i + 1]! - s[i]!;
      if ((up > 0 && down <= 0) || (up < 0 && down >= 0) || (up === 0 && down !== 0 && i > 0))
        ext.push(i);
    }
    const pts = [0, ...ext, s.length - 1];
    // Drop turns that move less than the tolerance from their neighbours.
    let changed = true;
    while (changed && pts.length > 2) {
      changed = false;
      for (let k = 1; k < pts.length - 1; k++) {
        const a = s[pts[k - 1]!]!,
          b = s[pts[k]!]!,
          d = s[pts[k + 1]!]!;
        if (Math.min(Math.abs(b - a), Math.abs(b - d)) < tol) {
          pts.splice(k, 1);
          changed = true;
          break;
        }
      }
    }
    for (const k of pts.slice(1, -1)) out.add(frames[k]!);
    // Holds of two frames or more that stay within a tenth of the tolerance: their ends are poses.
    const still = (i: number) => Math.abs(s[i + 1]! - s[i]!) < tol * 0.1;
    for (let i = 0; i < s.length - 1;) {
      if (!still(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < s.length - 1 && still(j)) j++;
      if (j - i >= 2 && Math.abs(s[j]! - s[0]!) + Math.abs(s[i]! - s.at(-1)!) >= tol) {
        if (i > 0) out.add(frames[i]!);
        if (j < s.length - 1) out.add(frames[j]!);
      }
      i = j;
    }
  });
  return [...out].sort((a, b) => a - b);
}

interface Work {
  tl: Timeline;
  tol: number[];
  /** Channel error in world px per unit, for choosing where a key helps most. */
  lever: number;
  /** Fitting samples (times inside the timeline) and the original values there. */
  st: number[];
  sv: number[][];
  /** Original key indices that must stay. */
  must: Set<number>;
  /** Original segments kept exactly (a stepped jump, a zero-length segment). */
  frozen: Set<number>;
  keys: PlannedKey[];
  status: TimelineReport["status"];
  reason?: string;
  inserted: number;
  channelError: number;
}

const same = (a: number[], b: number[], eps = 1e-6) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= eps);
function originalIndexAt(tl: Timeline, t: number): number | undefined {
  const i = tl.times.findIndex((x) => Math.abs(x - t) <= EPS);
  return i < 0 ? undefined : i;
}
function stateIndex(tl: Timeline, t: number): number {
  let i = 0;
  while (i < tl.times.length - 1 && tl.times[i + 1]! <= t + EPS) i++;
  return i;
}
const valueAt = (tl: Timeline, t: number) =>
  timelineValue(tl.times, tl.values, tl.curves, tl.shared, t);

/** Samples strictly inside (a, b). */
function inside(w: Work, a: number, b: number): { ts: number[]; vs: number[][] } {
  let lo = 0,
    hi = w.st.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (w.st[m]! <= a + 1e-9) lo = m + 1;
    else hi = m;
  }
  const ts: number[] = [],
    vs: number[][] = [];
  for (let k = lo; k < w.st.length && w.st[k]! < b - 1e-9; k++) {
    ts.push(w.st[k]!);
    vs.push(w.sv[k]!);
  }
  return { ts, vs };
}
/** Fits the segment a -> b of a planned timeline; returns the curve per channel and the error ratio. */
function fitSegment(
  w: Work,
  a: PlannedKey,
  b: PlannedKey,
): { curve: (ChannelCurve | "stepped")[]; ratio: number; error: number; verbatim: boolean } {
  // Two neighbouring original keys keep their own segment.
  if (a.source !== undefined && b.source !== undefined && b.source === a.source + 1)
    return { curve: w.tl.curves[a.source]!, ratio: 0, error: 0, verbatim: true };
  const { ts, vs } = inside(w, a.time, b.time);
  if (w.tl.shared) {
    const f = fitShared(ts, vs, a.time, a.values, b.time, b.values, w.tol[0]!);
    return { curve: [f.curve], ratio: f.error / w.tol[0]!, error: f.error, verbatim: false };
  }
  let ratio = 0,
    error = 0;
  const curve = a.values.map((v0, c) => {
    const f = fitChannel(
      ts,
      vs.map((x) => x[c]!),
      a.time,
      v0,
      b.time,
      b.values[c]!,
      w.tol[c]!,
    );
    ratio = Math.max(ratio, f.error / w.tol[c]!);
    error = Math.max(error, f.error);
    return f.curve;
  });
  return { curve, ratio, error, verbatim: false };
}
function keyFromOriginal(tl: Timeline, i: number): PlannedKey {
  return { time: tl.times[i]!, values: tl.values[i]!, source: i, state: i };
}
function keyAt(tl: Timeline, t: number): PlannedKey {
  const src = originalIndexAt(tl, t);
  if (src !== undefined) return keyFromOriginal(tl, src);
  return { time: t, values: valueAt(tl, t), state: stateIndex(tl, t) };
}
/** Refits every segment; returns the largest error ratio. */
function refit(w: Work): number {
  let worst = 0,
    err = 0;
  for (let i = 0; i < w.keys.length - 1; i++) {
    const a = w.keys[i]!,
      b = w.keys[i + 1]!;
    const f = fitSegment(w, a, b);
    a.curve = f.curve;
    a.verbatim = f.verbatim;
    worst = Math.max(worst, f.ratio);
    err = Math.max(err, f.error);
  }
  const last = w.keys.at(-1)!;
  last.verbatim = last.source !== undefined && last.source === w.tl.keys.length - 1;
  w.channelError = err;
  return worst;
}
/** Fewest original keys whose refitted segments stay within tolerance (fidelity). */
function reduceSubset(w: Work): void {
  const n = w.tl.times.length;
  const must = [...w.must].sort((a, b) => a - b);
  const kept: number[] = [];
  for (let r = 0; r < must.length - 1; r++) {
    const from = must[r]!,
      to = must[r + 1]!;
    const cost = new Map<number, { keys: number; err: number; prev: number }>([
      [from, { keys: 0, err: 0, prev: -1 }],
    ]);
    for (let i = from; i < to; i++) {
      const ci = cost.get(i);
      if (!ci) continue;
      let failures = 0;
      for (let j = i + 1; j <= to; j++) {
        let ok: boolean, ratio: number;
        if (j === i + 1) [ok, ratio] = [true, 0];
        else {
          const f = fitSegment(w, keyFromOriginal(w.tl, i), keyFromOriginal(w.tl, j));
          ratio = f.ratio;
          ok = ratio <= 1;
        }
        if (!ok) {
          if (++failures >= 3) break;
          continue;
        }
        failures = 0;
        const next = { keys: ci.keys + 1, err: ci.err + ratio * ratio, prev: i };
        const cj = cost.get(j);
        if (!cj || next.keys < cj.keys || (next.keys === cj.keys && next.err < cj.err - 1e-12))
          cost.set(j, next);
      }
    }
    const path: number[] = [];
    for (let j = to; j !== from && j >= 0; j = cost.get(j)!.prev) path.push(j);
    kept.push(from, ...path.reverse().slice(0, -1));
  }
  kept.push(must.at(-1)!);
  w.keys = [...new Set(kept)].sort((a, b) => a - b).map((i) => keyFromOriginal(w.tl, i));
  void n;
  refit(w);
}
/** Top-down: from the given key times, add keys where a segment is past tolerance (posable, deform). */
function reduceRefine(w: Work, times: number[], fps: number, wholeFrames: boolean): void {
  const first = w.tl.times[0]!,
    last = w.tl.times.at(-1)!;
  const set = new Map<string, PlannedKey>();
  const add = (k: PlannedKey) => set.set(k.time.toFixed(6), k);
  for (const i of w.must) add(keyFromOriginal(w.tl, i));
  for (const t of times) if (t > first + EPS && t < last - EPS) add(keyAt(w.tl, t));
  w.keys = [...set.values()].sort((a, b) => a.time - b.time);
  for (let guard = 0; guard < 10_000; guard++) {
    let worst = -1,
      worstRatio = 1;
    for (let i = 0; i < w.keys.length - 1; i++) {
      const f = fitSegment(w, w.keys[i]!, w.keys[i + 1]!);
      w.keys[i]!.curve = f.curve;
      w.keys[i]!.verbatim = f.verbatim;
      if (f.ratio > worstRatio) [worst, worstRatio] = [i, f.ratio];
    }
    if (worst < 0) break;
    const t = insertionTime(w, worst, fps, wholeFrames);
    if (t === undefined) break;
    w.keys.splice(worst + 1, 0, keyAt(w.tl, t));
  }
  refit(w);
}
/** Where to add a key in segment i: at its worst sample, on a whole frame if one is inside, else an original key. */
function insertionTime(
  w: Work,
  i: number,
  fps: number,
  wholeFrames: boolean,
  near?: number,
): number | undefined {
  const a = w.keys[i]!,
    b = w.keys[i + 1]!;
  const { ts, vs } = inside(w, a.time, b.time);
  if (!ts.length) return undefined;
  // Worst sample on the current fit.
  let at = near ?? ts[0]!;
  if (near === undefined) {
    let worst = -1;
    const cur = a.curve ?? [];
    ts.forEach((t, k) => {
      const played = timelineValue([a.time, b.time], [a.values, b.values], [cur], w.tl.shared, t);
      const r = w.tl.shared
        ? Math.sqrt(played.reduce((s, v, j) => s + (v - vs[k]![j]!) ** 2, 0))
        : Math.max(...played.map((v, j) => Math.abs(v - vs[k]![j]!) / w.tol[j]!));
      if (r > worst) [worst, at] = [r, t];
    });
  }
  const originals = w.tl.times.filter((t) => t > a.time + EPS && t < b.time - EPS);
  if (wholeFrames) {
    const f = Math.round(at * fps),
      t = f / fps;
    if (t > a.time + EPS && t < b.time - EPS) return t;
    const g = at * fps > f ? f + 1 : f - 1;
    if (g / fps > a.time + EPS && g / fps < b.time - EPS) return g / fps;
  }
  if (originals.length)
    return originals.reduce(
      (best, t) => (Math.abs(t - at) < Math.abs(best - at) ? t : best),
      originals[0]!,
    );
  return undefined;
}

/** Times the played result is checked at. */
function checkTimes(
  timelines: { curves: Timeline[]; discrete: { time: number }[] },
  duration: number,
  fps: number,
  substeps: number,
): number[] {
  const end = Math.max(0, duration - 1e-5);
  const set = new Set<number>();
  const add = (t: number) => set.add(+Math.min(end, Math.max(0, t)).toFixed(7));
  const steps = Math.round(duration * fps * substeps);
  for (let k = 0; k <= steps; k++) add(k / (fps * substeps));
  for (const tl of timelines.curves) for (const t of tl.times) [t - 1e-4, t, t + 1e-4].forEach(add);
  for (const d of timelines.discrete) [d.time - 1e-4, d.time + 1e-4].forEach(add);
  add(end);
  return [...set].sort((a, b) => a - b);
}

interface Check {
  diffs: ReturnType<typeof poseDifference>[];
  max: number;
  rms: number;
  worst: number;
}
function summarize(diffs: ReturnType<typeof poseDifference>[]): Check {
  let max = 0,
    worst = 0,
    sum = 0,
    count = 0;
  diffs.forEach((d, i) => {
    sum += d.sumSq;
    count += d.count;
    if (d.max > max) [max, worst] = [d.max, i];
  });
  return { diffs, max, rms: count ? Math.sqrt(sum / count) : 0, worst };
}

/**
 * Cross-correlation lag (frames) of b behind a, on speeds; sub-frame by a parabola. `strength` is
 * the normalized correlation at that lag (1: b repeats a's speed exactly, later).
 */
function lagStrength(
  a: number[],
  b: number[],
  loop: boolean,
  maxLag = 12,
): { lag: number; strength: number } {
  // A loop's last frame is its first again: speeds over one period, read around the seam.
  const sa = loop ? a.slice(0, -1) : a,
    sb = loop ? b.slice(0, -1) : b;
  const speed = (s: number[]) =>
    s.map((v, i) => (loop ? s[(i + 1) % s.length]! - v : i + 1 < s.length ? s[i + 1]! - v : NaN));
  const da = speed(sa).filter((x) => !Number.isNaN(x)),
    db = speed(sb).filter((x) => !Number.isNaN(x));
  const n = Math.min(da.length, db.length);
  if (n < 4) return { lag: 0, strength: 0 };
  const ra = Math.sqrt(da.reduce((s, x) => s + x * x, 0) / n),
    rb = Math.sqrt(db.reduce((s, x) => s + x * x, 0) / n);
  // Mean product over the overlap (not the sum): a longer lag is not penalized for fewer pairs.
  const corr = (lag: number) => {
    let s = 0,
      m = 0;
    for (let i = 0; i < n; i++) {
      let j = i + lag;
      if (loop) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      s += da[i]! * db[j]!;
      m++;
    }
    return m && ra && rb ? s / m / (ra * rb) : 0;
  };
  let best = 0,
    bv = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const c = corr(lag);
    if (c > bv) [best, bv] = [lag, c];
  }
  const l = corr(best - 1),
    r = corr(best + 1),
    den = l - 2 * bv + r;
  return {
    lag: den < 0 && Math.abs(best) < maxLag ? best + (0.5 * (l - r)) / den : best,
    strength: bv,
  };
}
/**
 * Indices of the turns of a key sequence that rise or fall at least `prominence` on both sides
 * (smaller wiggles between them are skipped), the middle key of a flat top.
 */
function prominentTurns(v: number[], prominence: number): number[] {
  const pts: number[] = [0];
  for (let i = 1; i < v.length - 1; i++) {
    const l = v[i]! - v[i - 1]!;
    let j = i;
    while (j < v.length - 1 && v[j + 1] === v[i]) j++;
    const r = j < v.length - 1 ? v[j + 1]! - v[j]! : 0;
    if (l * r < 0) pts.push((i + j) >> 1);
    i = j;
  }
  pts.push(v.length - 1);
  for (let changed = true; changed && pts.length > 2;) {
    changed = false;
    for (let k = 1; k < pts.length - 1; k++) {
      const b = v[pts[k]!]!;
      if (Math.min(Math.abs(b - v[pts[k - 1]!]!), Math.abs(b - v[pts[k + 1]!]!)) < prominence) {
        pts.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  return pts.slice(1, -1);
}
/** Turning times (frames, sub-frame) of a sampled signal with prominence. */
function peaks(s: number[], step: number, prominence: number): number[] {
  const out: number[] = [];
  const pts: number[] = [0];
  for (let i = 1; i < s.length - 1; i++)
    if ((s[i]! - s[i - 1]!) * (s[i + 1]! - s[i]!) < 0 || (s[i]! !== s[i - 1]! && s[i + 1] === s[i]))
      pts.push(i);
  pts.push(s.length - 1);
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let k = 1; k < pts.length - 1; k++) {
      const b = s[pts[k]!]!;
      if (Math.min(Math.abs(b - s[pts[k - 1]!]!), Math.abs(b - s[pts[k + 1]!]!)) < prominence) {
        pts.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  for (const i of pts.slice(1, -1)) {
    const l = s[i - 1]!,
      c = s[i]!,
      r = s[i + 1]!,
      den = l - 2 * c + r;
    out.push((i + (Math.abs(den) > 1e-12 ? (0.5 * (l - r)) / den : 0)) * step);
  }
  return out;
}

/** Reduces the keys of a Spine 4.0 JSON document. The input is not modified. */
export function reduceSpineKeys(
  document: Raw,
  options: KeyReductionOptions,
): { document: Raw; report: KeyReductionReport } {
  const sources: KeyReductionReport["sources"] = [];
  const original = structuredClone(document);
  if (options.baseline) adoptBaseline(original, options, sources);
  const out = structuredClone(original);
  const skel = (original.skeleton ?? {}) as Raw;
  const fps = options.fps ?? (typeof skel.fps === "number" ? skel.fps : 30);
  const sk0 = loadSkeleton(original);
  const size = skeletonSize(original, sk0);
  const limits = {
    maxError: options.maxError ?? +(size * KEY_LIMITS[options.mode].max).toFixed(3),
    rmsError: options.rmsError ?? +(size * KEY_LIMITS[options.mode].rms).toFixed(3),
    colorTolerance: options.colorTolerance ?? 1 / 255,
    localShare: options.localShare ?? 0.5,
  };
  const substeps = options.substeps ?? 4;
  const inf = influence(original);
  const names = Object.keys((original.animations ?? {}) as Raw).filter(
    (n) => !options.animations || options.animations.includes(n),
  );
  const reports = names.map((name) =>
    reduceAnimation(original, out, sk0, inf, name, options, { fps, size, limits, substeps }),
  );
  const keys = reports.reduce(
    (s, r) => ({ before: s.before + r.keys.before, after: s.after + r.keys.after }),
    { before: 0, after: 0 },
  );
  return {
    document: out,
    report: {
      mode: options.mode,
      spine: String(skel.spine ?? "unknown"),
      fps,
      size,
      limits,
      sampling: `${substeps} samples a frame from 0 to the end, every key time and 0.1 ms either side, 0.1 ms either side of every attachment, draw order and event key, the last instant before the loop wraps; then quarter points of every interval with an end over half the limit (up to three rounds)`,
      units: {
        world: "skeleton units (Spine px at skeleton scale 1, before any display scale)",
        rms: "square root of the mean squared vertex distance over every compared vertex of every sample",
        ...UNITS,
      },
      animations: reports,
      keys,
      sources,
      pass: reports.every((r) => r.pass),
    },
  };
}

/**
 * Puts the baseline's animation in place of the input's wherever the input still plays it within
 * the limit (so it is the earlier reduction's output, or untouched). Needs the same skeleton.
 */
function adoptBaseline(
  doc: Raw,
  options: KeyReductionOptions,
  sources: KeyReductionReport["sources"],
): void {
  const base = options.baseline!;
  const setup = (d: Raw) => JSON.stringify([d.bones, d.slots, d.ik, d.transform, d.path, d.skins]);
  const anims = (doc.animations ?? {}) as Raw,
    baseAnims = (base.animations ?? {}) as Raw;
  const names = Object.keys(anims).filter(
    (n) => !options.animations || options.animations.includes(n),
  );
  if (setup(doc) !== setup(base)) {
    for (const n of names)
      sources.push({ animation: n, from: "input", reason: "the baseline's skeleton differs" });
    return;
  }
  const fps =
    options.fps ??
    (typeof (doc.skeleton as Raw | undefined)?.fps === "number"
      ? ((doc.skeleton as Raw).fps as number)
      : 30);
  const skIn = loadSkeleton(doc),
    skBase = loadSkeleton(base);
  const size = skeletonSize(doc, skIn);
  const limit = options.maxError ?? size * KEY_LIMITS[options.mode].max;
  for (const n of names) {
    if (!baseAnims[n]) {
      sources.push({ animation: n, from: "input", reason: "not in the baseline" });
      continue;
    }
    const d0 = readTimelines(doc, n).duration,
      d1 = readTimelines(base, n).duration;
    if (Math.abs(d0 - d1) > 1e-6) {
      sources.push({
        animation: n,
        from: "input",
        reason: "its length differs from the baseline's",
      });
      continue;
    }
    let worst = 0;
    const steps = Math.max(1, Math.round(d0 * fps * 2));
    for (let k = 0; k <= steps; k++) {
      const t = Math.min(d0 - 1e-5, k / (fps * 2));
      worst = Math.max(worst, poseDifference(samplePose(skIn, n, t), samplePose(skBase, n, t)).max);
    }
    if (worst <= limit + 1e-6) {
      anims[n] = structuredClone(baseAnims[n]);
      sources.push({
        animation: n,
        from: "baseline",
        reason: `plays within ${worst.toFixed(3)} px of the baseline`,
      });
    } else
      sources.push({
        animation: n,
        from: "input",
        reason: `edited: ${worst.toFixed(3)} px from the baseline, reduced as it is now`,
      });
  }
}

function reduceAnimation(
  original: Raw,
  out: Raw,
  sk0: LoadedSkeleton,
  inf: Influence,
  name: string,
  options: KeyReductionOptions,
  ctx: {
    fps: number;
    size: number;
    limits: { maxError: number; rmsError: number; colorTolerance: number; localShare: number };
    substeps: number;
  },
): AnimationReport {
  const { fps, limits, substeps, size } = ctx;
  const mode = options.mode;
  const T = readTimelines(original, name);
  const duration = T.duration;
  const notes: string[] = [];
  const times = checkTimes(T, duration, fps, substeps);
  const origPoses = times.map((t) => samplePose(sk0, name, t));
  const frameCount = Math.round(duration * fps);
  const frameIndex = Array.from({ length: frameCount + 1 }, (_, f) => {
    const t = Math.min(f / fps, Math.max(0, duration - 1e-5));
    let best = 0;
    times.forEach((x, i) => {
      if (Math.abs(x - t) < Math.abs(times[best]! - t)) best = i;
    });
    return best;
  });
  const framePoses = frameIndex.map((i) => origPoses[i]!);
  const reach = boneReach(inf, framePoses.length ? framePoses : origPoses.slice(0, 1));
  const pscale = parentScale(inf, framePoses.length ? framePoses : origPoses.slice(0, 1));
  const boneIndex = new Map(inf.bones.map((b, i) => [b, i]));
  const slotIndex = new Map(inf.slots.map((s, i) => [s, i]));
  const e = limits.maxError * limits.localShare;
  const minReach = size * 0.05;
  const leverOf = (b: number) => Math.max(reach[b] ?? 0, minReach);
  const eventTimes = T.discrete.filter((d) => d.kind === "event").map((d) => d.time);
  const locks = (options.lock ?? []).filter((l) => !l.animation || l.animation === name);
  const inScope = (tl: Timeline) =>
    (!options.kinds || options.kinds.includes(tl.kind)) &&
    !(options.skip ?? []).some((s) => s === tl.id || s === tl.owner);

  // Channel tolerances from what one unit moves on screen.
  const work: Work[] = T.curves.map((tl) => {
    let tol: number[], lever: number;
    if (tl.kind === "bone") {
      const b = boneIndex.get(tl.owner) ?? 0;
      if (tl.prop.startsWith("rotate") || tl.prop.startsWith("shear")) {
        lever = (leverOf(b) * Math.PI) / 180;
      } else if (tl.prop.startsWith("translate")) lever = pscale[b]!;
      else lever = leverOf(b);
      tol = tl.values[0]!.map(() => e / lever);
    } else if (tl.kind === "deform") {
      lever = 1;
      tol = [e];
    } else if (tl.kind === "slot") {
      lever = 0;
      tol = tl.values[0]!.map(() => limits.colorTolerance);
    } else {
      const c = inf.constraints.get(tl.owner);
      const r = c ? Math.max(...c.bones.map(leverOf)) : minReach;
      lever = r * Math.PI;
      tol =
        tl.kind === "ik"
          ? [e / lever, e]
          : tl.kind === "path" && tl.prop !== "mix"
            ? [e / 100]
            : tl.values[0]!.map(() => e / lever);
    }
    // Fitting samples: every substep inside the timeline and every original key.
    const first = tl.times[0]!,
      last = tl.times.at(-1)!;
    const st = new Set<number>(tl.times);
    for (let k = Math.ceil(first * fps * substeps); k / (fps * substeps) < last; k++)
      st.add(k / (fps * substeps));
    const sts = [...st].filter((t) => t >= first && t <= last).sort((a, b) => a - b);
    // Must-keep keys: ends, both ends of a jump or a zero-length segment, a discrete switch, locks, events.
    const must = new Set<number>([0, tl.times.length - 1]);
    const frozen = new Set<number>();
    for (let i = 0; i < tl.times.length - 1; i++) {
      const jump =
        tl.curves[i]!.some((c) => c === "stepped") && !same(tl.values[i]!, tl.values[i + 1]!);
      if (jump || tl.times[i + 1]! - tl.times[i]! < 1e-6) {
        frozen.add(i);
        must.add(i);
        must.add(i + 1);
      }
      if (tl.discrete.some((d) => tl.keys[i]![d] !== tl.keys[i + 1]![d])) must.add(i + 1);
    }
    for (const l of locks)
      if (l.timeline === undefined || l.timeline === tl.id || l.timeline === tl.owner)
        if (l.time !== undefined) {
          const i = originalIndexAt(tl, l.time);
          if (i !== undefined) must.add(i);
        }
    // Peaks and rebounds: a key on a visible turn of its channel keeps the extreme pose.
    if (!tl.shared)
      for (let c = 0; c < tl.values[0]!.length; c++)
        for (const i of prominentTurns(
          tl.values.map((x) => x[c]!),
          tol[c]! / limits.localShare,
        ))
          must.add(i);
    if (options.protectEvents !== false)
      for (const t of eventTimes) {
        const i = originalIndexAt(tl, t);
        if (i !== undefined) must.add(i);
      }
    return {
      tl,
      tol: tol.map((x) => Math.max(1e-6, x)),
      lever,
      st: sts,
      sv: sts.map((t) => valueAt(tl, t)),
      must,
      frozen,
      keys: tl.times.map((_, i) => ({ ...keyFromOriginal(tl, i), verbatim: true })),
      status: "unchanged",
      inserted: 0,
      channelError: 0,
    };
  });

  // Motion groups: bones that turn on the same frames share pose frames (main); a bone that turns
  // on its own frames keeps them (follow parts keep their lag and phase).
  const turns = new Map<number, Set<number>>();
  for (const w of work) {
    if (w.tl.kind !== "bone" || w.tl.times.length < 2 || !inScope(w.tl)) continue;
    const { frames, v } = frameValues(w.tl, fps, w.tl.times[0]!, w.tl.times.at(-1)!);
    const b = boneIndex.get(w.tl.owner) ?? 0;
    const set = turns.get(b) ?? new Set<number>();
    for (const f of turningFrames(
      frames,
      v,
      w.tol.map((x) => x / limits.localShare),
      false,
    ))
      set.add(f);
    turns.set(b, set);
  }
  const animated = [...turns.keys()].filter((b) => turns.get(b)!.size > 0);
  const groupOf = new Map<number, number>(animated.map((b) => [b, b]));
  const find = (b: number): number => (groupOf.get(b) === b ? b : find(groupOf.get(b)!));
  const nearestAnimated = (b: number) => {
    for (let p = inf.parent[b]!; p >= 0; p = inf.parent[p]!) if (groupOf.has(p)) return p;
    return -1;
  };
  const jaccard = (a: Set<number>, b: Set<number>) => {
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return n / (a.size + b.size - n || 1);
  };
  for (const b of animated) {
    const p = nearestAnimated(b);
    if (p >= 0 && jaccard(turns.get(b)!, turns.get(p)!) >= 0.5) groupOf.set(find(b), find(p));
  }
  const members = new Map<number, number[]>();
  for (const b of animated) members.set(find(b), [...(members.get(find(b)) ?? []), b]);
  const groups: (MotionGroup & { root: number; ids: number[] })[] = [...members.values()].map(
    (ids) => {
      const count = new Map<number, number>();
      for (const b of ids) for (const f of turns.get(b)!) count.set(f, (count.get(f) ?? 0) + 1);
      const frames = [...count.entries()]
        .filter(([, n]) => n >= Math.ceil(ids.length / 2))
        .map(([f]) => f)
        .sort((a, b) => a - b);
      const top = ids.reduce((t, b) => (depth(inf, b) < depth(inf, t) ? b : t), ids[0]!);
      return {
        root: top,
        ids,
        bones: ids.map((b) => inf.bones[b]!),
        frames,
        role: ids.length > 1 ? "main" : "single",
      };
    },
  );
  // A loop: the last pose is the first again (or the request says so).
  const loop =
    options.loops?.includes(name) ??
    (origPoses.length > 1 &&
      poseDifference(origPoses[0]!, origPoses.at(-1)!).max <= Math.max(limits.maxError, 0.5));
  // Follow parts: a group that turns consistently later than the group it hangs from.
  const worldRot = (poses: Pose[], b: number) => poses.map((p) => p.bones[b * 4 + 2]!);
  const unwrap = (s: number[]) => {
    const o = [...s];
    for (let i = 1; i < o.length; i++)
      o[i] = o[i - 1]! + ((((o[i]! - o[i - 1]!) % 360) + 540) % 360) - 180;
    return o;
  };
  const anchorOf = new Map<number, number>();
  for (const g of groups) {
    const p = nearestAnimated(g.root);
    if (p < 0) continue;
    // A follow part repeats its anchor's motion later: a clear correlation at a lag of a frame or more.
    const { lag, strength } = lagStrength(
      unwrap(worldRot(framePoses, p)),
      unwrap(worldRot(framePoses, g.root)),
      loop,
    );
    if (lag >= 0.5 && lag <= 10 && strength >= 0.5) {
      g.role = "follow";
      g.lagFrames = +lag.toFixed(2);
      anchorOf.set(g.root, p);
    }
  }
  const groupFrames = new Map<number, number[]>();
  for (const g of groups)
    for (const b of g.ids) groupFrames.set(b, g.role === "main" ? g.frames : [...turns.get(b)!]);

  // Pose nodes from the motion: the main group nearest the root, its height, contacts.
  const mainRoot = groups
    .filter((g) => g.role === "main")
    .sort((a, b) => depth(inf, a.root) - depth(inf, b.root) || b.ids.length - a.ids.length)[0];
  const contacts = findContacts(framePoses, size);
  const nodes = poseNodes(
    mainRoot ? worldY(framePoses, mainRoot.root) : [],
    contacts,
    frameCount,
    loop,
    limits.maxError,
  );
  if (mainRoot) {
    const g = groupFrames.get(mainRoot.root)!;
    for (const n of nodes) if (!g.includes(n.frame)) g.push(n.frame);
    for (const b of mainRoot.ids) groupFrames.set(b, g);
  }

  // First pass per timeline.
  for (const w of work) {
    const tl = w.tl;
    if (!inScope(tl)) {
      [w.status, w.reason] = ["skipped", "outside the requested scope"];
      continue;
    }
    if (
      locks.some(
        (l) =>
          l.time === undefined &&
          (l.timeline === undefined || l.timeline === tl.id || l.timeline === tl.owner),
      )
    ) {
      [w.status, w.reason] = ["locked", "locked by the request"];
      continue;
    }
    if (tl.times.length < 2) continue;
    if (tl.values.every((v) => same(v, tl.values[0]!))) {
      // A constant timeline keeps one key: it still holds the value when animations are mixed.
      w.keys = [{ ...keyFromOriginal(tl, 0), verbatim: false, curve: undefined }];
      w.status = tl.times.length > 1 ? "constant" : "unchanged";
      if (tl.times.length > 1) w.reason = "constant: one key keeps the value for mixing";
      continue;
    }
    if (tl.times.length <= 2) continue;
    if (tl.kind === "deform") {
      // Important shapes first (turning points of the shape), then keys where an interval is off.
      const { frames, v } = frameValues(tl, fps, tl.times[0]!, tl.times.at(-1)!);
      const shapes = turningFrames(
        frames,
        v,
        w.tol.map((x) => x / limits.localShare),
        true,
      )
        .map((f) => snap(tl, f / fps, fps, mode))
        .filter((t): t is number => t !== undefined);
      reduceRefine(w, shapes, fps, mode === "posable");
    } else if (mode === "fidelity") reduceSubset(w);
    else {
      const b = tl.kind === "bone" ? boneIndex.get(tl.owner) : undefined;
      let frames: number[];
      if (b !== undefined && groupFrames.has(b)) frames = groupFrames.get(b)!;
      else {
        const fv = frameValues(tl, fps, tl.times[0]!, tl.times.at(-1)!);
        frames = turningFrames(
          fv.frames,
          fv.v,
          w.tol.map((x) => x / limits.localShare),
          false,
        );
      }
      reduceRefine(
        w,
        frames.map((f) => snap(tl, f / fps, fps, mode)).filter((t): t is number => t !== undefined),
        fps,
        true,
      );
    }
    w.status = w.keys.length < tl.times.length ? "reduced" : "unchanged";
    if (w.status === "unchanged")
      w.keys = tl.times.map((_, i) => ({ ...keyFromOriginal(tl, i), verbatim: true }));
  }

  // Played check against the original, with keys added where the result is off.
  const insertions: AnimationReport["insertions"] = [];
  const fallbacks: string[] = [];
  const maxInsertions = options.maxInsertions ?? 400;
  const candidate = () => {
    const doc = structuredClone(original);
    const anims = doc.animations as Raw;
    for (const n of Object.keys(anims)) if (n !== name) delete anims[n];
    const anim = anims[name] as Raw;
    for (const w of work)
      if (w.status === "reduced" || w.status === "constant")
        setTimelineKeys(anim, w.tl, writeKeys(original, w.tl, w.keys));
    keepDuration(original, anim, work, duration);
    return doc;
  };
  let check: Check | undefined;
  let candPoses: Pose[] = [];
  let checkTimesNow = [...times];
  let origNow = origPoses;
  let dirty: [number, number] | null = null;
  let adaptive = 0;
  const exhausted = new Set<string>();
  for (let round = 0; round < maxInsertions * 2 + 200; round++) {
    const sk = loadSkeleton(candidate());
    candPoses = checkTimesNow.map((t, i) =>
      !dirty || !candPoses[i] || (t >= dirty[0] - 1e-6 && t <= dirty[1] + 1e-6)
        ? samplePose(sk, name, t)
        : candPoses[i]!,
    );
    check = summarize(origNow.map((p, i) => poseDifference(p, candPoses[i]!)));
    const passing = check.max <= limits.maxError && check.rms <= limits.rmsError;
    if (passing) {
      // Adaptive samples: midpoints of every interval with an end over half the limit.
      const added: number[] = [];
      for (let i = 0; i < checkTimesNow.length - 1; i++) {
        const a = check.diffs[i]!.max,
          b = check.diffs[i + 1]!.max;
        if (
          Math.max(a, b) > limits.maxError * 0.5 &&
          checkTimesNow[i + 1]! - checkTimesNow[i]! > 1e-4
        ) {
          const t0 = checkTimesNow[i]!,
            t1 = checkTimesNow[i + 1]!;
          added.push(t0 + (t1 - t0) / 4, t0 + (t1 - t0) / 2, t0 + ((t1 - t0) * 3) / 4);
        }
      }
      if (!added.length || adaptive > 2) break;
      adaptive++;
      const merged = [...new Set([...checkTimesNow, ...added.map((t) => +t.toFixed(7))])].sort(
        (a, b) => a - b,
      );
      const oldIndex = new Map(checkTimesNow.map((t, i) => [t, i]));
      origNow = merged.map((t) =>
        oldIndex.has(t) ? origNow[oldIndex.get(t)!]! : samplePose(sk0, name, t),
      );
      candPoses = merged.map((t) =>
        oldIndex.has(t) ? candPoses[oldIndex.get(t)!]! : samplePose(sk, name, t),
      );
      checkTimesNow = merged;
      dirty = [Infinity, -Infinity];
      continue;
    }
    // Over the limit: the worst sample (by its largest distance, or by its RMS when only RMS fails).
    let si = check.worst;
    if (check.max <= limits.maxError) {
      let best = -1;
      check.diffs.forEach((d, i) => {
        const r = d.count ? d.sumSq / d.count : 0;
        if (r > best) [best, si] = [r, i];
      });
    }
    const d = check.diffs[si]!;
    const t = checkTimesNow[si]!;
    const slot = d.stateMismatches.length ? d.stateMismatches[0]! : d.slot;
    const affects = (w: Work) => {
      if (w.status === "skipped" || w.status === "locked" || w.status === "restored") return false;
      if (slot < 0) return true;
      const bones = inf.slotBones[slot]!;
      if (w.tl.kind === "bone") return bones.has(boneIndex.get(w.tl.owner) ?? -1);
      if (w.tl.kind === "deform") return slotIndex.get(w.tl.owner) === slot;
      if (w.tl.kind === "slot")
        return slotIndex.get(w.tl.owner) === slot && d.stateMismatches.includes(slot);
      const c = inf.constraints.get(w.tl.owner);
      return !!c && c.bones.some((b) => bones.has(b));
    };
    const pick = work
      .filter((w) => affects(w) && w.keys.length >= 2 && w.keys.length < w.tl.times.length + 64)
      .map((w) => {
        const played = timelineValue(
          w.keys.map((k) => k.time),
          w.keys.map((k) => k.values),
          w.keys.slice(0, -1).map((k) => k.curve ?? []),
          w.tl.shared,
          t,
        );
        const target = valueAt(w.tl, t);
        const err = w.tl.shared
          ? Math.sqrt(played.reduce((s, v, j) => s + (v - target[j]!) ** 2, 0))
          : Math.max(...played.map((v, j) => Math.abs(v - target[j]!)));
        const seg = Math.max(
          0,
          w.keys.findIndex((k, i) => i < w.keys.length - 1 && w.keys[i + 1]!.time > t),
        );
        return { w, err: err * (w.lever || 1), seg };
      })
      .filter((x) => x.err > 1e-6 && !exhausted.has(`${x.w.tl.id}@${x.seg}`))
      .sort((a, b) => b.err - a.err);
    let placed = false;
    if (insertions.length < maxInsertions)
      for (const { w, seg } of pick) {
        const at = insertionTime(w, seg, fps, mode === "posable", t);
        if (at === undefined) {
          exhausted.add(`${w.tl.id}@${seg}`);
          continue;
        }
        const a = w.keys[seg]!,
          b = w.keys[seg + 1]!;
        w.keys.splice(seg + 1, 0, keyAt(w.tl, at));
        refit(w);
        w.inserted++;
        insertions.push({ timeline: w.tl.id, time: +at.toFixed(4), slot: inf.slots[slot] ?? "" });
        dirty = [a.time, b.time];
        placed = true;
        break;
      }
    if (placed) continue;
    // Nothing left to add here, or over budget: the timelines behind the worst part go back.
    const back = work.filter(
      (w) => affects(w) && (w.status === "reduced" || w.status === "constant" || w.inserted),
    );
    if (back.length) {
      for (const w of back) {
        w.keys = w.tl.times.map((_, i) => ({ ...keyFromOriginal(w.tl, i), verbatim: true }));
        w.status = "restored";
        w.reason = `restored: ${inf.slots[slot] ?? "a part"} was off by ${d.max.toFixed(3)} px at ${t.toFixed(4)} s`;
      }
      fallbacks.push(
        `${back.length} timeline(s) behind ${inf.slots[slot] ?? "the worst part"} restored to the original keys (${d.max.toFixed(3)} px at ${t.toFixed(4)} s)`,
      );
      dirty = [-Infinity, Infinity];
      continue;
    }
    // Still off with every relevant timeline as it was: the whole animation goes back.
    for (const w of work) {
      w.keys = w.tl.times.map((_, i) => ({ ...keyFromOriginal(w.tl, i), verbatim: true }));
      if (w.status !== "skipped" && w.status !== "locked") w.status = "restored";
    }
    fallbacks.push(
      `whole animation restored: ${d.max.toFixed(3)} px at ${t.toFixed(4)} s could not be closed`,
    );
    dirty = [-Infinity, Infinity];
  }

  // Write the result.
  const anim = (out.animations as Raw)[name] as Raw;
  for (const w of work)
    if (w.status === "reduced" || w.status === "constant")
      setTimelineKeys(anim, w.tl, writeKeys(original, w.tl, w.keys));
  keepDuration(original, anim, work, duration);

  // Checks on the result.
  const reducedFrames = frameIndex.map(
    (i) => candPoses[checkTimesNow.indexOf(times[i]!)] ?? candPoses[i]!,
  );
  const worst = check!.diffs[check!.worst]!;
  const byKind: Record<string, { before: number; after: number }> = {};
  for (const w of work) {
    const k = (byKind[w.tl.kind] ??= { before: 0, after: 0 });
    k.before += w.tl.times.length;
    k.after += w.keys.length;
  }
  const follow: FollowCheck[] = groups
    .filter((g) => g.role === "follow")
    .map((g) => {
      const b = g.root,
        p = anchorOf.get(b)!;
      const so = unwrap(worldRot(framePoses, b)),
        sr = unwrap(worldRot(reducedFrames, b));
      const prom = (limits.maxError / leverOf(b)) * (180 / Math.PI);
      const po = peaks(so, 1, prom),
        pr = peaks(sr, 1, prom);
      const maxShift =
        po.length === pr.length
          ? po.reduce((m, x, i) => Math.max(m, Math.abs(x - pr[i]!)), 0)
          : null;
      return {
        bone: inf.bones[b]!,
        peaksOriginal: po.map((x) => +x.toFixed(2)),
        peaksReduced: pr.map((x) => +x.toFixed(2)),
        maxShift: maxShift === null ? null : +maxShift.toFixed(3),
        lagOriginal: +lagStrength(unwrap(worldRot(framePoses, p)), so, loop).lag.toFixed(3),
        lagReduced: +lagStrength(unwrap(worldRot(reducedFrames, p)), sr, loop).lag.toFixed(3),
      };
    });
  const contactChecks = contacts.map((c) => {
    let slide = 0,
      slideOriginal = 0;
    for (const [si, k] of c.vertices) {
      const o0 = framePoses[c.from]!.verts[si]!,
        r0 = reducedFrames[c.from]!.verts[si]!;
      for (let f = c.from; f <= c.to; f++) {
        const o = framePoses[f]!.verts[si]!,
          r = reducedFrames[f]!.verts[si]!;
        if (!o || !r || !o0 || !r0) continue;
        slideOriginal = Math.max(slideOriginal, Math.hypot(o[k]! - o0[k]!, o[k + 1]! - o0[k + 1]!));
        slide = Math.max(slide, Math.hypot(r[k]! - r0[k]!, r[k + 1]! - r0[k + 1]!));
      }
    }
    return {
      slots: [...new Set(c.vertices.map(([si]) => inf.slots[si]!))],
      from: c.from,
      to: c.to,
      slide: +slide.toFixed(3),
      slideOriginal: +slideOriginal.toFixed(3),
    };
  });
  let seam: AnimationReport["seam"] = null;
  if (loop && checkTimesNow.length > 2) {
    const h = 1 / (fps * substeps);
    const at = (t: number, sk: LoadedSkeleton) => samplePose(sk, name, t);
    const skR = loadSkeleton(candidate());
    const velJump = (sk: LoadedSkeleton) => {
      const s0 = at(0, sk),
        s1 = at(h, sk),
        e0 = at(Math.max(0, duration - h - 1e-5), sk),
        e1 = at(Math.max(0, duration - 1e-5), sk);
      let worst = 0;
      s0.verts.forEach((v, si) => {
        const a = s1.verts[si],
          b = e0.verts[si],
          c = e1.verts[si];
        if (!v || !a || !b || !c) return;
        for (let k = 0; k + 1 < v.length; k += 2) {
          const vs = [(a[k]! - v[k]!) / h, (a[k + 1]! - v[k + 1]!) / h],
            ve = [(c[k]! - b[k]!) / h, (c[k + 1]! - b[k + 1]!) / h];
          worst = Math.max(worst, Math.hypot(vs[0]! - ve[0]!, vs[1]! - ve[1]!) / fps);
        }
      });
      return worst;
    };
    seam = {
      poseOriginal: +poseDifference(origPoses[0]!, origPoses.at(-1)!).max.toFixed(4),
      poseReduced: +poseDifference(candPoses[0]!, candPoses.at(-1)!).max.toFixed(4),
      velocityJumpOriginal: +velJump(sk0).toFixed(4),
      velocityJumpReduced: +velJump(skR).toFixed(4),
    };
  }
  const durationAfter = readTimelines(out, name).duration;
  const nodeErrors = nodes.map((n) => ({
    ...n,
    time: +(n.frame / fps).toFixed(4),
    error: +(
      check!.diffs[checkTimesNow.indexOf(times[frameIndex[n.frame] ?? 0]!)]?.max ?? 0
    ).toFixed(4),
  }));
  const pass =
    check!.max <= limits.maxError &&
    check!.rms <= limits.rmsError &&
    check!.diffs.every((x) => !x.stateMismatches.length && !x.orderMismatch) &&
    Math.abs(durationAfter - duration) < 1e-6;
  if (mode === "posable" && !mainRoot)
    notes.push("no group of bones turns together: every bone keyed on its own turning frames");
  return {
    name,
    mode,
    fps,
    duration: { before: duration, after: durationAfter },
    loop,
    keys: {
      before: work.reduce((s, w) => s + w.tl.times.length, 0),
      after: work.reduce((s, w) => s + w.keys.length, 0),
      byKind,
      removedConstant: work
        .filter((w) => w.status === "constant")
        .reduce((s, w) => s + w.tl.times.length - w.keys.length, 0),
      removedMotion: work
        .filter((w) => w.status === "reduced")
        .reduce((s, w) => s + w.tl.times.length - w.keys.length, 0),
    },
    timelines: work.map((w) => ({
      id: w.tl.id,
      kind: w.tl.kind,
      before: w.tl.times.length,
      after: w.keys.length,
      status: w.status,
      tolerance: +Math.min(...w.tol).toPrecision(4),
      unit: unitOf(w.tl),
      inserted: w.inserted,
      channelError: +w.channelError.toPrecision(4),
      ...(w.reason ? { reason: w.reason } : {}),
    })),
    limits: { maxError: limits.maxError, rmsError: limits.rmsError, unit: "px" },
    world: {
      max: +check!.max.toFixed(4),
      rms: +check!.rms.toFixed(4),
      worstTime: +checkTimesNow[check!.worst]!.toFixed(4),
      worstFrame: +(checkTimesNow[check!.worst]! * fps).toFixed(2),
      worstSlot: worst.slot >= 0 ? inf.slots[worst.slot]! : null,
      worstAttachment: worst.slot >= 0 ? (origNow[check!.worst]!.atts[worst.slot] ?? null) : null,
      worstSampleRms: +Math.max(
        ...check!.diffs.map((x) => (x.count ? Math.sqrt(x.sumSq / x.count) : 0)),
      ).toFixed(4),
      samples: checkTimesNow.length,
      adaptiveSamples: checkTimesNow.length - times.length,
    },
    pass,
    discrete: {
      stateMismatches: check!.diffs.filter((x) => x.stateMismatches.length).length,
      orderMismatches: check!.diffs.filter((x) => x.orderMismatch).length,
      events: "unchanged",
      attachmentKeys: "unchanged",
    },
    poses: nodeErrors,
    groups: groups.map(({ bones, role, frames, lagFrames }) => ({
      bones,
      role,
      frames,
      ...(lagFrames !== undefined ? { lagFrames } : {}),
    })),
    follow,
    contacts: contactChecks,
    seam,
    insertions,
    fallbacks,
    notes,
  };
}

function depth(inf: Influence, b: number): number {
  let d = 0;
  for (let p = inf.parent[b]!; p >= 0; p = inf.parent[p]!) d++;
  return d;
}
/**
 * Where a turning frame becomes a key: on an original key within a frame of it (the source's own
 * pose, at its own time, sub-frame or not); otherwise, in posable mode, on the whole frame. In
 * fidelity mode a turn with no original key near it is left to the refit (undefined).
 */
function snap(tl: Timeline, t: number, fps: number, mode: KeyReductionMode): number | undefined {
  const near = tl.times.reduce(
    (best: number | undefined, x) =>
      best === undefined || Math.abs(x - t) < Math.abs(best - t) ? x : best,
    undefined,
  );
  if (near !== undefined && Math.abs(near - t) <= 1 / fps + EPS) return near;
  return mode === "fidelity" ? undefined : Math.round(t * fps) / fps;
}
/** The world height of a bone per frame. */
function worldY(poses: Pose[], b: number): number[] {
  return poses.map((p) => p.bones[b * 4 + 1]!);
}
/** Ground contact: vertices near the lowest point that stay still for two frames or more. */
function findContacts(
  poses: Pose[],
  size: number,
): { from: number; to: number; vertices: [number, number][] }[] {
  if (poses.length < 3) return [];
  let ground = Infinity;
  for (const p of poses)
    p.verts.forEach((v, si) => {
      if (!v || p.alpha[si]! <= 0.002) return;
      for (let k = 1; k < v.length; k += 2) ground = Math.min(ground, v[k]!);
    });
  const band = size * 0.01,
    still = size * 0.002;
  const touching = (f: number) => {
    const out: [number, number][] = [];
    const p = poses[f]!,
      q = poses[Math.min(poses.length - 1, f + 1)]!;
    p.verts.forEach((v, si) => {
      const w = q.verts[si];
      if (!v || !w || p.alpha[si]! <= 0.002) return;
      for (let k = 0; k + 1 < v.length; k += 2)
        if (v[k + 1]! - ground <= band && Math.hypot(w[k]! - v[k]!, w[k + 1]! - v[k + 1]!) <= still)
          out.push([si, k]);
    });
    return out;
  };
  const runs: { from: number; to: number; vertices: [number, number][] }[] = [];
  let cur: { from: number; to: number; vertices: [number, number][] } | null = null;
  for (let f = 0; f < poses.length; f++) {
    const t = touching(f);
    if (t.length) {
      if (!cur) cur = { from: f, to: f, vertices: t };
      else cur.to = f;
    } else if (cur) {
      if (cur.to > cur.from) runs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.to > cur.from) runs.push(cur);
  return runs;
}
/** Named pose nodes from the main group's height (y up) and the ground contacts. */
function poseNodes(
  y: number[],
  contacts: { from: number; to: number }[],
  frames: number,
  loop: boolean,
  prominence: number,
): Omit<PoseNode, "error">[] {
  const out: Omit<PoseNode, "error">[] = [];
  if (!y.length) return out;
  const turns = peaks(y, 1, prominence).map((f) => Math.round(f));
  const airborne = (f: number) =>
    contacts.length > 0 && !contacts.some((c) => f >= c.from && f <= c.to);
  const add = (label: string, frame: number) => {
    if (frame < 0 || frame > frames || out.some((n) => n.frame === frame)) return;
    out.push({ label, frame, time: 0 });
  };
  if (!loop) add("start", 0);
  turns.forEach((f, i) => {
    const high = y[f]! >= y[Math.max(0, f - 1)]! && y[f]! >= y[Math.min(y.length - 1, f + 1)]!;
    if (loop) return add(high ? (airborne(f) ? "airborne high" : "high") : "low", f);
    const rising = turns.some((g) => g > f && y[g]! > y[f]!);
    add(
      high
        ? airborne(f)
          ? "apex"
          : "high"
        : i === 0 && rising
          ? "anticipation / compression"
          : rising
            ? "low"
            : "cushion",
      f,
    );
  });
  // Launch: the fastest rise between a low and the next high.
  const v = (j: number) => (j >= 1 && j < y.length - 1 ? (y[j + 1]! - y[j - 1]!) / 2 : 0);
  for (let i = 1; i < y.length - 1; i++)
    if (v(i) > prominence && v(i) >= v(i - 1) && v(i) > v(i + 1)) add("launch", i);
  for (const c of contacts) {
    if (c.from > 0) add(loop ? "contact (support)" : "landing", c.from);
    if (c.to < frames) add(loop ? "passing / exchange" : "takeoff", c.to);
  }
  if (!loop) add("end / recovery", frames);
  return out.sort((a, b) => a.frame - b.frame);
}
/** A reduced animation must last as long as the original: if no kept key reaches the end, keep one. */
function keepDuration(doc: Raw, anim: Raw, work: Work[], duration: number): void {
  const last = Math.max(0, ...work.map((w) => w.keys.at(-1)!.time));
  if (last >= duration - 1e-6) return;
  const w = work.find((x) => x.tl.times.at(-1)! >= duration - 1e-6);
  if (!w) return;
  const end = keyFromOriginal(w.tl, w.tl.times.length - 1);
  if (w.keys.length === 1) w.keys[0]!.curve = w.tl.values[0]!.map(() => "linear" as const);
  w.keys.push(end);
  setTimelineKeys(anim, w.tl, writeKeys(doc, w.tl, w.keys));
}

export interface PlaybackDifference {
  animation: string;
  max: number;
  rms: number;
  worstTime: number;
  worstSlot: string | null;
  stateMismatches: number;
  orderMismatches: number;
  duration: [number, number];
  samples: number;
}
/**
 * How far two documents of the same skeleton play apart, animation by animation (world vertices
 * on the official runtime; every substep of every frame and every key time of either). For checking
 * that a Spine import and export changed nothing.
 */
export function comparePlayback(
  a: Raw,
  b: Raw,
  options: { fps?: number; substeps?: number; animations?: string[] } = {},
): PlaybackDifference[] {
  const fps =
    options.fps ??
    (typeof (a.skeleton as Raw | undefined)?.fps === "number"
      ? ((a.skeleton as Raw).fps as number)
      : 30);
  const skA = loadSkeleton(a),
    skB = loadSkeleton(b);
  const inf = influence(a);
  return Object.keys((a.animations ?? {}) as Raw)
    .filter((n) => !options.animations || options.animations.includes(n))
    .map((n) => {
      const ta = readTimelines(a, n);
      const db = (b.animations as Raw)[n] ? readTimelines(b, n).duration : NaN;
      if (Number.isNaN(db))
        return {
          animation: n,
          max: Infinity,
          rms: Infinity,
          worstTime: 0,
          worstSlot: null,
          stateMismatches: 0,
          orderMismatches: 0,
          duration: [ta.duration, NaN] as [number, number],
          samples: 0,
        };
      const tb = readTimelines(b, n);
      const times = checkTimes(
        { curves: [...ta.curves, ...tb.curves], discrete: [...ta.discrete, ...tb.discrete] },
        Math.max(ta.duration, db),
        fps,
        options.substeps ?? 4,
      );
      const c = summarize(
        times.map((t) => poseDifference(samplePose(skA, n, t), samplePose(skB, n, t))),
      );
      const w = c.diffs[c.worst]!;
      return {
        animation: n,
        max: +c.max.toFixed(4),
        rms: +c.rms.toFixed(4),
        worstTime: +times[c.worst]!.toFixed(4),
        worstSlot: w.slot >= 0 ? inf.slots[w.slot]! : null,
        stateMismatches: c.diffs.filter((x) => x.stateMismatches.length).length,
        orderMismatches: c.diffs.filter((x) => x.orderMismatch).length,
        duration: [ta.duration, db] as [number, number],
        samples: times.length,
      };
    });
}
