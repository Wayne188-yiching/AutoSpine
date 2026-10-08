import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AnimationSpecSchema, Vector2Schema, type AnimationSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/**
 * Performance metrics (proposal P2-h): how a sampled animation moves, not which keys it has.
 * A host samples named probes (part centroids or hull centres) on a fixed frame grid; every
 * length is divided by `unit` (e.g. a measured head width) so characters of any size compare.
 */
export const PerformanceSampleSchema = Type.Object(
  {
    fps: Type.Integer({ minimum: 1, maximum: 120 }),
    unit: Type.Number({ exclusiveMinimum: 0 }),
    /** Image space (+y down) or Spine world space (+y up); "height" is measured against it. */
    yDown: Type.Boolean(),
    probes: Type.Record(
      Type.String({ minLength: 1, maxLength: 64 }),
      Type.Array(Vector2Schema, { minItems: 3, maxItems: 7200 }),
    ),
  },
  { additionalProperties: false },
);
export type PerformanceSample = Static<typeof PerformanceSampleSchema>;

export interface PerformanceOptions {
  /** Delay chain for one-shot moves: the first probe is the reference for every peak delay. */
  chain?: readonly string[];
  /** Probe compared with the chain root for the hand-relative-to-body range. */
  hand?: string;
  /** Peaks are searched from this time on, skipping the entry frames (seconds; default 0.1). */
  ignoreBefore?: number;
  /** A frame is a hold when its speed is below this fraction of the track's peak (default 0.15). */
  holdThreshold?: number;
}

/**
 * Keys on moving timelines only: rigs differ in how many static bones they key, so density is
 * keys per moving timeline per second (a 60 fps bake reads ~60, sparse keyposes a few).
 */
export const KeyStatsSchema = Type.Object(
  {
    keys: Type.Integer({ minimum: 0 }),
    timelines: Type.Integer({ minimum: 1 }),
    duration: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: false },
);
export type KeyStats = Static<typeof KeyStatsSchema>;
/** Moving bone timelines of an AnimationSpec (one per bone and channel; constant ones skipped). */
export function animationKeyStats(animation: AnimationSpec): KeyStats {
  if (!Value.Check(AnimationSpecSchema, animation))
    failStage("animation", "PERFORMANCE_ANIMATION", "Valid AnimationSpec required");
  const values = [
    ...(animation.rotationTimelines ?? []).map((t) => t.keys.map((k) => [k.degrees])),
    ...(animation.translationTimelines ?? []).map((t) => t.keys.map((k) => [k.x, k.y])),
    ...(animation.scaleTimelines ?? []).map((t) => t.keys.map((k) => [k.x, k.y])),
  ].filter((keys) => keys.some((v) => v.some((x, j) => x !== keys[0]![j])));
  if (!values.length)
    failStage("animation", "PERFORMANCE_ANIMATION", "At least one moving bone timeline required");
  return {
    keys: values.reduce((n, keys) => n + keys.length, 0),
    timelines: values.length,
    duration: animation.duration,
  };
}

type Vec = [number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const range = (values: number[]) => Math.max(...values) - Math.min(...values);
const speeds = (track: Vec[]) =>
  track.slice(1).map((p, i) => Math.hypot(p[0] - track[i]![0], p[1] - track[i]![1]));
function holds(v: number[], threshold: number) {
  const peak = Math.max(...v);
  return peak > 0 ? v.filter((s) => s < threshold * peak).length / v.length : 1;
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Measures the metrics whose probes are present:
 * - `face` + `eyes`: parallax range x/y (eye assembly against the face outline) and its hold fraction;
 * - `eyes` + `pupils`: pupil range, hold fraction and peak/mean speed (saccade read);
 * - `options.chain`: per-probe peak time and overshoot, and peak delay behind the chain's first probe;
 * - `options.hand` with a chain: range of the hand's height relative to the chain root;
 * - `keyStats`: bone keys per timeline-second.
 */
export function measurePerformance(
  sample: PerformanceSample,
  options: PerformanceOptions = {},
  keyStats?: KeyStats,
): Record<string, number> {
  if (!Value.Check(PerformanceSampleSchema, sample))
    failStage("animation", "PERFORMANCE_SAMPLE", "Valid performance sample required");
  const tracks = Object.values(sample.probes),
    frames = tracks[0]?.length ?? 0;
  if (!frames || tracks.some((t) => t.length !== frames))
    failStage("animation", "PERFORMANCE_SAMPLE", "Probes need one point per sampled frame");
  const { chain = [], hand, ignoreBefore = 0.1, holdThreshold = 0.15 } = options;
  if (
    !Number.isFinite(ignoreBefore) ||
    ignoreBefore < 0 ||
    !(holdThreshold > 0 && holdThreshold < 1) ||
    [...chain, ...(hand ? [hand] : [])].some((p) => !sample.probes[p])
  )
    failStage("animation", "PERFORMANCE_OPTIONS", "Chain/hand probes must exist; bounded options");
  const u = sample.unit,
    probe = (name: string) => sample.probes[name] as Vec[] | undefined,
    out: Record<string, number> = {};
  const face = probe("face"),
    eyes = probe("eyes"),
    pupils = probe("pupils");
  if (face && eyes) {
    const rel = eyes.map((e, i) => sub(e, face[i]!).map((v) => v / u) as Vec);
    out.parallaxRangeX = range(rel.map((p) => p[0]));
    out.parallaxRangeY = range(rel.map((p) => p[1]));
    out.parallaxHoldFraction = holds(speeds(rel), holdThreshold);
  }
  if (eyes && pupils) {
    const rel = pupils.map((p, i) => sub(p, eyes[i]!).map((v) => v / u) as Vec),
      v = speeds(rel),
      mean = v.reduce((s, x) => s + x, 0) / v.length;
    out.pupilRange = range(rel.map((p) => Math.hypot(p[0] - rel[0]![0], p[1] - rel[0]![1])));
    out.pupilHoldFraction = holds(v, holdThreshold);
    if (mean > 0) out.pupilPeakToMeanSpeed = Math.max(...v) / mean;
  }
  if (chain.length) {
    const height = (p: Vec) => (sample.yDown ? -p[1] : p[1]) / u,
      first = Math.min(frames - 1, Math.ceil(ignoreBefore * sample.fps - 1e-9)),
      peaks = new Map<string, number>();
    for (const name of chain) {
      const h = probe(name)!.map(height);
      let best = first;
      for (let i = first + 1; i < frames; i++) if (h[i]! > h[best]!) best = i;
      peaks.set(name, best / sample.fps);
      out["peakTime:" + name] = best / sample.fps;
      out["overshoot:" + name] = h[best]! - h[frames - 1]!;
    }
    for (const name of chain.slice(1))
      out["peakDelay:" + name] = peaks.get(name)! - peaks.get(chain[0]!)!;
    if (hand) {
      const root = probe(chain[0]!)!,
        rel = probe(hand)!.map((p, i) => height(p) - height(root[i]!));
      out.handVsBodyRange = range(rel.slice(Math.floor(frames / 10)));
    }
  }
  if (keyStats) {
    if (!Value.Check(KeyStatsSchema, keyStats))
      failStage("animation", "PERFORMANCE_KEYS", "Positive key statistics required");
    out.keyDensity = keyStats.keys / (keyStats.timelines * keyStats.duration);
  }
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v))
      failStage("animation", "PERFORMANCE_NUMERIC", `Metric ${k} is nonfinite`);
    out[k] = round(v);
  }
  return out;
}

const Target = Type.Object(
  { reference: Type.Number(), min: Type.Number(), max: Type.Number() },
  { additionalProperties: false },
);
export const PerformanceProfileSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    /** Hold fractions and speed ratios depend on the sampling rate; samples must match it. */
    fps: Type.Integer({ minimum: 1, maximum: 120 }),
    source: Type.String({ minLength: 1, maxLength: 512 }),
    chain: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    ),
    hand: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    targets: Type.Record(Type.String({ minLength: 1, maxLength: 96 }), Target),
  },
  { additionalProperties: false },
);
export type PerformanceProfile = Static<typeof PerformanceProfileSchema>;

/**
 * Target interval around an artist reference statistic. Uncalibrated engineering bands:
 * fractions +-0.15; peak delays +-2 frames; every other magnitude within a factor of 1.5.
 */
export function targetBand(metric: string, reference: number, fps: number) {
  if (!Number.isFinite(reference) || !(fps > 0))
    failStage("animation", "PERFORMANCE_TARGET", "Finite reference and positive fps required");
  if (/HoldFraction$/.test(metric))
    return { reference, min: Math.max(0, reference - 0.15), max: Math.min(1, reference + 0.15) };
  if (/^peak(Delay|Time):/.test(metric))
    return { reference, min: reference - 2 / fps, max: reference + 2 / fps };
  return { reference, min: reference / 1.5, max: reference * 1.5 };
}
const profile = (
  id: string,
  source: string,
  references: Record<string, number>,
  extra: Pick<PerformanceProfile, "chain" | "hand"> = {},
): PerformanceProfile => ({
  id,
  fps: 30,
  source,
  ...extra,
  targets: Object.fromEntries(
    Object.entries(references).map(([k, v]) => [k, targetBand(k, v, 30)]),
  ),
});
/**
 * Statistics measured from one hand-made Spine file (mummy cat, official 4.0 runtime, 30 fps,
 * lengths in head widths). n = 1 character: these are comparison targets, not artist approval,
 * and they hold no keys, bones or timing from that file.
 */
export const PERFORMANCE_PROFILES: Readonly<Record<string, PerformanceProfile>> = Object.freeze({
  "look-around": profile("look-around", "mummy-cat artist idle2 (4 s loop), n=1", {
    parallaxRangeX: 0.0616,
    parallaxRangeY: 0.057,
    parallaxHoldFraction: 0.567,
    pupilRange: 0.1146,
    pupilHoldFraction: 0.858,
    pupilPeakToMeanSpeed: 9.81,
    keyDensity: 2.956,
  }),
  entrance: profile(
    "entrance",
    "mummy-cat artist in (1 s one-shot), n=1",
    {
      parallaxRangeX: 0.052,
      parallaxRangeY: 0.1277,
      "peakDelay:head": 0.1,
      "peakDelay:hand_l": 0,
      "peakDelay:hand_r": 0,
      "peakDelay:tail": 0.1667,
      "overshoot:body": 0.0372,
      "overshoot:head": 0.0501,
      "overshoot:hand_l": 0.1687,
      "overshoot:hand_r": 0.2544,
      "overshoot:tail": 0.106,
      handVsBodyRange: 0.5101,
      keyDensity: 4.706,
    },
    { chain: ["body", "head", "hand_l", "hand_r", "tail"], hand: "hand_l" },
  ),
});

const HINTS: [RegExp, string, string][] = [
  [/^parallaxRange/, "increase face-control travel", "reduce face-control travel"],
  [/^parallaxHoldFraction$/, "add holds between looks", "shorten holds or drift between looks"],
  [/^pupilRange$/, "increase saccade gain", "reduce saccade gain"],
  [/^pupilHoldFraction$/, "hold the eyes after each saccade", "shorten eye holds"],
  [/^pupilPeakToMeanSpeed$/, "shorten saccade moves", "lengthen saccade moves or add drift"],
  [/^peakDelay:/, "increase follow lag", "reduce follow lag"],
  [/^overshoot:/, "increase settle overshoot", "reduce settle overshoot"],
  [/^handVsBodyRange$/, "increase hand travel against the body", "reduce hand travel"],
  [/^keyDensity$/, "add breakdown keys", "use fewer keyposes instead of baking"],
];
export interface PerformanceFinding {
  metric: string;
  value: number | null;
  reference: number;
  min: number;
  max: number;
  status: "within" | "low" | "high" | "missing";
  hint?: string;
}
/**
 * Critic check (P2-h): measure with the profile's chain/hand and compare every target.
 * Findings only propose adjustments; a host or planner decides and the Core rebuilds.
 */
export function reviewPerformance(
  sample: PerformanceSample,
  profileInput: PerformanceProfile | string,
  keyStats?: KeyStats,
) {
  const p = typeof profileInput === "string" ? PERFORMANCE_PROFILES[profileInput] : profileInput;
  if (!p || !Value.Check(PerformanceProfileSchema, p))
    failStage("animation", "PERFORMANCE_PROFILE", "Known profile id or valid profile required");
  if (Object.values(p.targets).some((t) => !(t.min <= t.reference && t.reference <= t.max)))
    failStage("animation", "PERFORMANCE_PROFILE", "Each target needs min <= reference <= max");
  if (Value.Check(PerformanceSampleSchema, sample) && sample.fps !== p.fps)
    failStage("animation", "PERFORMANCE_FPS", `Profile ${p.id} needs samples at ${p.fps} fps`);
  const metrics = measurePerformance(
    sample,
    {
      ...(p.chain?.every((c) => sample.probes[c]) ? { chain: p.chain } : {}),
      ...(p.hand && sample.probes[p.hand] && p.chain?.every((c) => sample.probes[c])
        ? { hand: p.hand }
        : {}),
    },
    keyStats,
  );
  const eps = 1e-6;
  const findings: PerformanceFinding[] = Object.entries(p.targets).map(([metric, t]) => {
    const value = metrics[metric] ?? null,
      status =
        value === null
          ? "missing"
          : value < t.min - eps
            ? "low"
            : value > t.max + eps
              ? "high"
              : "within",
      hint = HINTS.find(([re]) => re.test(metric));
    return {
      metric,
      value,
      ...t,
      status,
      ...(hint && (status === "low" || status === "high")
        ? { hint: status === "low" ? hint[1] : hint[2] }
        : {}),
    };
  });
  return {
    profile: p.id,
    metrics,
    findings,
    within: findings.filter((f) => f.status === "within").length,
    total: findings.length,
    artistQualityAccepted: false as const,
  };
}
