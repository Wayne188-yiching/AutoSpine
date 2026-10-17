import type { SearchRange } from "@autospine/schemas";
import { reviewPerformance, animationKeyStats, type PerformanceProfile } from "@autospine/planning";
import {
  animateCharacter,
  compileCharacter,
  type CharacterRigging,
  type Params,
} from "@autospine/character";
import { loadSkeleton } from "./runtime.js";
import {
  performanceSample,
  sampleTracks,
  slotMotion,
  type PreparedReference,
  type Probes,
  type Tracks,
} from "./compare.js";

export interface ObjectiveOptions {
  probes: Probes;
  /** Parts whose centroid paths should follow the artist (default: probe parts except pupils). */
  trajectoryParts?: string[];
  deformExclude?: string[];
  /** Weight of the summed per-part trajectory RMS (head widths). Default 20. */
  trajectoryWeight?: number;
  /** Weight of the in-mesh deformation log error. Default 2. */
  deformWeight?: number;
  /** Search inside bands shrunk by this fraction of their width. Default 0.05. */
  bandShrink?: number;
  /** Required critic passes above the 60% line (0 = exactly the line). Default 1. */
  margin?: number;
  /** IK bend overrides used when compiling. */
  bend?: Record<string, boolean>;
}
export interface Evaluation {
  penalty: number;
  pass: boolean;
  perf: Record<string, { within: number; total: number; failing: string[] }>;
  trajectory: Record<string, number>;
  deformError: number;
  amplitude: Record<string, number>;
  recall: Record<string, number>;
  precision: Record<string, number>;
  inversions: number;
  stretch: number;
  loopSeam: number;
  error?: string;
}
const shrink = (p: PerformanceProfile, f: number): PerformanceProfile => ({
  ...p,
  targets: Object.fromEntries(
    Object.entries(p.targets).map(([k, t]) => {
      const w = t.max - t.min;
      return [
        k,
        {
          reference: t.reference,
          min: Math.min(t.reference, t.min + f * w),
          max: Math.max(t.reference, t.max - f * w),
        },
      ];
    }),
  ),
});
/** Distance outside a band, in band units (2-frame steps for timing, 0.15 for hold fractions, x1.5 factors otherwise). */
function bandDistance(
  f: { metric: string; value: number | null; min: number; max: number; status: string },
  fps: number,
): number {
  if (f.status === "within") return 0;
  if (f.value === null) return 10;
  const bound = f.status === "low" ? f.min : f.max;
  if (/^peak(Time|Delay):/.test(f.metric)) return Math.abs(f.value - bound) / (2 / fps);
  if (/HoldFraction$/.test(f.metric)) return Math.abs(f.value - bound) / 0.15;
  return Math.abs(Math.log(Math.max(1e-6, f.value) / Math.max(1e-6, bound))) / Math.log(1.5);
}

const triangleArea = (v: number[], a: number, b: number, c: number) =>
  (v[2 * b]! - v[2 * a]!) * (v[2 * c + 1]! - v[2 * a + 1]!) -
  (v[2 * b + 1]! - v[2 * a + 1]!) * (v[2 * c]! - v[2 * a]!);
/** One mesh's inverted triangles, largest edge stretch and loop seam against frame 0 (every second frame). */
function meshDeformation(t: Tracks["tr"][string], frames: number) {
  const out = { inversions: 0, stretch: 0, seam: 0 };
  const v0 = t.verts[0];
  if (!v0) return out;
  const tris = t.tris!;
  for (let f = 1; f <= frames; f += 2) {
    const v = t.verts[f];
    if (!v || v.length !== v0.length) continue;
    for (let k = 0; k < tris.length; k += 3) {
      const [x, y, z] = [tris[k]!, tris[k + 1]!, tris[k + 2]!];
      const A0 = triangleArea(v0, x, y, z),
        A1 = triangleArea(v, x, y, z);
      if (Math.abs(A0) > 1e-6 && A1 / A0 < 0) out.inversions++;
      for (const [p, q] of [
        [x, y],
        [y, z],
        [z, x],
      ] as [number, number][]) {
        const l0 = Math.hypot(v0[2 * q]! - v0[2 * p]!, v0[2 * q + 1]! - v0[2 * p + 1]!);
        if (l0 > 2)
          out.stretch = Math.max(
            out.stretch,
            Math.abs(Math.hypot(v[2 * q]! - v[2 * p]!, v[2 * q + 1]! - v[2 * p + 1]!) / l0 - 1),
          );
      }
    }
  }
  const vN = t.verts[frames];
  if (vN)
    for (let i = 0; i < vN.length; i++) out.seam = Math.max(out.seam, Math.abs(vN[i]! - v0[i]!));
  return out;
}

/**
 * Objective of the motion search (ADR-017): the critic's distance outside the artist bands, plus
 * how far each probe part's path and each part's in-mesh deformation are from the artist's, with
 * hard penalties for inversions, over-stretch, loop seams and amplitude / coverage shortfalls.
 */
export function makeObjective(
  rigging: CharacterRigging,
  reference: PreparedReference,
  options: ObjectiveOptions,
) {
  const fps = reference.fps,
    U = reference.unit;
  const profiles = Object.fromEntries(
    reference.animations.map((a) => [
      a,
      shrink(reference.profiles[a]!, options.bandShrink ?? 0.05),
    ]),
  );
  const probeParts = [
    options.probes.face,
    options.probes.eyes,
    ...(options.probes.chain ?? []).map(([, p]) => p),
    options.probes.hand?.[1],
  ].filter((p): p is string => !!p);
  const trajectoryParts = options.trajectoryParts ?? [...new Set(probeParts)];
  const exclude = (options.deformExclude ?? []).map((p) => new RegExp(p));
  const tw = options.trajectoryWeight ?? 20,
    dw = options.deformWeight ?? 2;
  const isCharacter = (slot: string, t: Tracks["tr"][string]) =>
    !exclude.some((re) => re.test(slot)) && (t.tris?.length ?? 0) >= 6;
  // The artist's stretch measured as the build's is (against frame 0, every second frame): the
  // reference's own measure is against the setup pose, so a build compared with itself could
  // exceed its own limit (ADR-038). The limit is never tighter than that measure gave.
  const artistStretch = Math.max(
    0,
    ...reference.animations.flatMap((a) => {
      const A = reference.tracks[a]!;
      return Object.entries(A.tr)
        .filter(([slot, t]) => isCharacter(slot, t))
        .map(([, t]) => meshDeformation(t, A.frames).stretch);
    }),
  );
  const stretchLimit =
    1.5 * Math.max(artistStretch, ...Object.values(reference.maxCharacterStretch));
  return (params: Params): Evaluation => {
    const { animations, colorTimelines } = animateCharacter(rigging, params);
    const doc = compileCharacter(rigging, animations, options.bend, colorTimelines);
    const sk = loadSkeleton(doc);
    const out: Evaluation = {
      penalty: 0,
      pass: false,
      perf: {},
      trajectory: {},
      deformError: 0,
      amplitude: {},
      recall: {},
      precision: {},
      inversions: 0,
      stretch: 0,
      loopSeam: 0,
    };
    let penalty = 0;
    for (const a of reference.animations) {
      const g: Tracks = sampleTracks(sk, a, fps),
        A = reference.tracks[a]!;
      const ir = animations.find((x) => x.name === a)!;
      const rev = reviewPerformance(
        performanceSample(g, options.probes, fps, U),
        profiles[a]!,
        animationKeyStats(ir),
      );
      out.perf[a] = {
        within: rev.within,
        total: rev.total,
        failing: rev.findings.filter((f) => f.status !== "within").map((f) => f.metric),
      };
      penalty += rev.findings.reduce((s, f) => s + bandDistance(f, fps), 0);
      let sum = 0;
      for (const s of trajectoryParts) {
        const ca = A.tr[s]?.c,
          cg = g.tr[s]?.c;
        if (!ca || !cg) continue;
        const a0 = ca.find(Boolean)!,
          g0 = cg.find(Boolean)!;
        let se = 0,
          n = 0;
        for (let f = 0; f <= g.frames; f++) {
          const pa = ca[f] ?? a0,
            pg = cg[f] ?? g0;
          const dx = (pg[0] - g0[0] - (pa[0] - a0[0])) / U,
            dy = (pg[1] - g0[1] - (pa[1] - a0[1])) / U;
          se += dx * dx + dy * dy;
          n++;
        }
        sum += Math.sqrt(se / n);
      }
      out.trajectory[a] = +(sum / Math.max(1, trajectoryParts.length)).toFixed(4);
      penalty += tw * sum;
      let both = 0,
        amp = 0,
        ampRows = 0,
        artMoving = 0,
        genMoving = 0;
      for (const [slot, ma] of Object.entries(reference.motion[a]!)) {
        const t = g.tr[slot];
        if (!t) continue;
        const mg = slotMotion(t);
        const character = isCharacter(slot, t);
        if (dw && character && (ma.deformPx ?? 0) > 2) {
          const e = Math.abs(Math.log(((mg.deformPx ?? 0) + 1) / (ma.deformPx! + 1)));
          out.deformError += e;
          penalty += dw * e;
        }
        if (ma.moves) artMoving++;
        if (mg.moves) genMoving++;
        if (ma.moves && mg.moves) {
          both++;
          if ((ma.peakPx ?? 0) > 0.5) {
            ampRows++;
            const r = (mg.peakPx ?? 0) / ma.peakPx!;
            if (r >= 0.5 && r <= 2) amp++;
          }
        }
        // inversions, stretch and loop seam on character meshes
        if (!character) continue;
        const m = meshDeformation(t, g.frames);
        out.inversions += m.inversions;
        out.stretch = Math.max(out.stretch, m.stretch);
        out.loopSeam = Math.max(out.loopSeam, m.seam);
      }
      out.amplitude[a] = ampRows ? +(amp / ampRows).toFixed(3) : 0;
      out.recall[a] = +(both / Math.max(1, artMoving)).toFixed(3);
      out.precision[a] = +(both / Math.max(1, genMoving)).toFixed(3);
      if (out.amplitude[a]! < 0.6) penalty += 20 * (0.6 - out.amplitude[a]!) + 5;
      if (out.recall[a]! < 0.8 || out.precision[a]! < 0.7) penalty += 20;
    }

    if (out.inversions) penalty += 50 + out.inversions;
    if (out.stretch > stretchLimit) penalty += 50;
    if (out.loopSeam > 0.5) penalty += 50;
    out.penalty = +penalty.toFixed(4);
    out.deformError = +out.deformError.toFixed(3);
    out.pass =
      reference.animations.every((a) => {
        const p = out.perf[a]!;
        return (
          p.within >= Math.ceil(0.6 * p.total) + (options.margin ?? 1) - 1 &&
          out.amplitude[a]! >= 0.6 &&
          out.recall[a]! >= 0.8 &&
          out.precision[a]! >= 0.7
        );
      }) &&
      !out.inversions &&
      out.stretch <= stretchLimit &&
      out.loopSeam <= 0.5;
    return out;
  };
}

/** Resumable state of a coordinate pattern search. */
export interface SearchState {
  x: Params;
  step: Record<string, number>;
  evaluations: number;
  sweep: number;
  index: number;
  improved: boolean;
  best: Evaluation | null;
  finished: boolean;
}
export interface SearchLogEntry {
  evaluation: number;
  sweep: number;
  key?: string;
  value?: number;
  penalty?: number;
  within?: number[];
  pass?: boolean;
  shrink?: boolean;
  pattern?: boolean;
}
const clampTo = (r: SearchRange, cycle: number, v: number) => {
  let x = r.cyclic ? ((v % cycle) + cycle) % cycle : v;
  x = Math.min(r.max, Math.max(r.min, x));
  return r.integer ? Math.round(x) : +x.toFixed(4);
};
export function initialSearchState(
  params: Params,
  space: Record<string, SearchRange>,
  cycle: number,
  seed?: number,
): SearchState {
  const x: Params = { ...params };
  for (const [k, r] of Object.entries(space)) {
    if (x[k] === undefined)
      throw new Error(`SEARCH_PARAMETER: ${k} is searched but not a motion parameter`);
    x[k] = clampTo(r, cycle, x[k]!);
  }
  if (seed !== undefined) {
    // Seeded kick of up to one step per parameter, to leave a previous local minimum.
    let s = (seed * 2654435761) % 4294967296;
    const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (const [k, r] of Object.entries(space))
      x[k] = clampTo(r, cycle, x[k]! + (rnd() * 2 - 1) * r.step);
  }
  return {
    x,
    step: Object.fromEntries(Object.entries(space).map(([k, r]) => [k, r.step])),
    evaluations: 0,
    sweep: 1,
    index: 0,
    improved: false,
    best: null,
    finished: false,
  };
}
/**
 * Cyclic coordinate pattern search with step halving: try +/- one step per parameter, keep moving
 * while it improves, halve every step after a sweep without improvement, stop when the objective
 * passes or no step can shrink further. Runs until `deadline` (ms timestamp) and can be resumed.
 */
export function patternSearch(
  state: SearchState,
  space: Record<string, SearchRange>,
  cycle: number,
  evaluate: (x: Params) => Evaluation,
  options: { deadline: number; maxEvaluations?: number; log?: (e: SearchLogEntry) => void },
): SearchState {
  const keys = Object.keys(space);
  const max = options.maxEvaluations ?? 5000;
  const log = options.log ?? (() => undefined);
  const score = (x: Params): Evaluation => {
    state.evaluations++;
    try {
      return evaluate(x);
    } catch (error) {
      return {
        penalty: 1e9,
        pass: false,
        perf: {},
        trajectory: {},
        deformError: 0,
        amplitude: {},
        recall: {},
        precision: {},
        inversions: 0,
        stretch: 0,
        loopSeam: 0,
        error: String(error).slice(0, 300),
      };
    }
  };
  const within = (e: Evaluation) => Object.values(e.perf).map((p) => p.within);
  if (!state.best) state.best = score(state.x);
  outer: while (!state.best.pass && !state.finished && state.evaluations < max) {
    for (; state.index < keys.length; state.index++) {
      if (state.best.pass || state.evaluations >= max || Date.now() > options.deadline) break outer;
      const k = keys[state.index]!,
        r = space[k]!;
      for (const dir of [1, -1]) {
        const cand = { ...state.x, [k]: clampTo(r, cycle, state.x[k]! + dir * state.step[k]!) };
        if (cand[k] === state.x[k]) continue;
        const e = score(cand);
        log({
          evaluation: state.evaluations,
          sweep: state.sweep,
          key: k,
          value: cand[k]!,
          penalty: e.penalty,
          within: within(e),
          pass: e.pass,
        });
        if (e.penalty < state.best.penalty - 1e-6) {
          state.x = cand;
          state.best = e;
          state.improved = true;
          for (let i = 0; i < 4 && !state.best.pass && state.evaluations < max; i++) {
            const c2 = { ...state.x, [k]: clampTo(r, cycle, state.x[k]! + dir * state.step[k]!) };
            if (c2[k] === state.x[k]) break;
            const e2 = score(c2);
            log({
              evaluation: state.evaluations,
              sweep: state.sweep,
              key: k,
              value: c2[k]!,
              penalty: e2.penalty,
              within: within(e2),
              pass: e2.pass,
              pattern: true,
            });
            if (e2.penalty < state.best.penalty - 1e-6) {
              state.x = c2;
              state.best = e2;
            } else break;
          }
          break;
        }
      }
    }
    if (state.index < keys.length) break;
    state.index = 0;
    state.sweep++;
    if (!state.improved) {
      let shrunk = false;
      for (const k of keys) {
        const r = space[k]!;
        const ns = r.integer ? Math.max(1, Math.floor(state.step[k]! / 2)) : state.step[k]! / 2;
        if (ns !== state.step[k] && ns >= r.step / 8) {
          state.step[k] = ns;
          shrunk = true;
        }
      }
      log({ evaluation: state.evaluations, sweep: state.sweep, shrink: true });
      if (!shrunk) state.finished = true;
    }
    state.improved = false;
  }
  return state;
}
