import { Value } from "@sinclair/typebox/value";
import {
  KeyposeSpecSchema,
  RigSpecSchema,
  type AnimationSpec,
  type KeyCurve,
  type KeyposeControl,
  type KeyposeEase,
  type KeyposeRule,
  type KeyposeSpec,
  type RigSpec,
} from "@autospine/schemas";
import { evaluateRig, failStage, inverseAffine } from "@autospine/rig";
import { keyFraction } from "./curves.js";
import { validateAnimation } from "./presets.js";

type Vec = number[];
/** `curve` shapes the segment from this key to the next one; frames may be fractional after a split. */
interface Key {
  frame: number;
  value: Vec;
  curve?: KeyCurve;
}
type Track = Key[];

const fail = (code: string, reason: string): never => failStage("animation", code, reason);
const EPS = 1e-6;
const bezier = (x1: number, y1: number, x2: number, y2: number): KeyCurve => ({
  type: "bezier",
  x1,
  y1,
  x2,
  y2,
});
/** Named eases describe how a pose is reached; each is one normalized segment curve. */
const NAMED: Record<Exclude<KeyposeEase, object>, KeyCurve | undefined> = {
  linear: undefined,
  hold: { type: "stepped" },
  ease: bezier(0.25, 0, 0.75, 1),
  sine: bezier(0.37, 0, 0.63, 1),
  out: bezier(0.12, 0.6, 0.45, 1),
  in: bezier(0.5, 0, 0.85, 0.5),
  drift: bezier(0.33, 0.25, 0.66, 0.9),
};
function curveOf(ease: KeyposeEase | undefined): KeyCurve | undefined {
  if (ease === undefined) return NAMED.ease;
  if (typeof ease === "string") return NAMED[ease];
  return ease.type === "linear" ? undefined : ease;
}
/** The key curve a named (or explicit) ease stands for; `undefined` means linear. */
export const easeCurve = (ease: KeyposeEase | undefined): KeyCurve | undefined => curveOf(ease);
const withCurve = (key: Key, curve: KeyCurve | undefined): Key =>
  curve ? { frame: key.frame, value: key.value, curve } : { frame: key.frame, value: key.value };

function segmentValue(a: Key, b: Key, frame: number): Vec {
  const e = keyFraction(a.curve, (frame - a.frame) / (b.frame - a.frame));
  return a.value.map((v, j) => v + (b.value[j]! - v) * e);
}

// ---- exact Bezier subdivision -------------------------------------------------------------
const cubic = (t: number, p1: number, p2: number) =>
  3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
function parameterAt(c: { x1: number; x2: number }, u: number) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    if (cubic(t, c.x1, c.x2) < u) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}
/**
 * Splits one normalized segment curve at time fraction u (de Casteljau, renormalized per piece).
 * `null` marks a piece whose value change vanishes or whose handles leave the IR bounds; the caller
 * then flattens that piece into ten exact samples, the same resolution Spine itself uses.
 */
function splitCurve(
  curve: KeyCurve | undefined,
  u: number,
): { left: KeyCurve | undefined | null; right: KeyCurve | undefined | null; y: number } {
  if (!curve || curve.type === "linear") return { left: undefined, right: undefined, y: u };
  if (curve.type === "stepped") return { left: curve, right: curve, y: 0 };
  const s = parameterAt(curve, u);
  const lerp = (a: number[], b: number[]) => [
    a[0]! + (b[0]! - a[0]!) * s,
    a[1]! + (b[1]! - a[1]!) * s,
  ];
  const P0 = [0, 0],
    P1 = [curve.x1, curve.y1],
    P2 = [curve.x2, curve.y2],
    P3 = [1, 1];
  const Q01 = lerp(P0, P1),
    Q12 = lerp(P1, P2),
    Q23 = lerp(P2, P3),
    R0 = lerp(Q01, Q12),
    R1 = lerp(Q12, Q23),
    S = lerp(R0, R1);
  const normalize = (h1: number[], h2: number[], from: number[], to: number[]) => {
    const dx = to[0]! - from[0]!,
      dy = to[1]! - from[1]!;
    if (dx <= EPS || Math.abs(dy) <= 1e-9) return null;
    const x1 = (h1[0]! - from[0]!) / dx,
      y1 = (h1[1]! - from[1]!) / dy,
      x2 = (h2[0]! - from[0]!) / dx,
      y2 = (h2[1]! - from[1]!) / dy;
    if (
      [x1, x2].some((x) => x < -1e-9 || x > 1 + 1e-9) ||
      Math.max(Math.abs(y1), Math.abs(y2)) > 10
    )
      return null;
    return bezier(Math.min(1, Math.max(0, x1)), y1, Math.min(1, Math.max(0, x2)), y2);
  };
  return { left: normalize(Q01, R0, P0, S), right: normalize(R1, Q23, S, P3), y: S[1]! };
}
function flatten(a: Key, b: Key, from: number, to: number): Key[] {
  return Array.from({ length: 10 }, (_, j) => {
    const frame = from + ((to - from) * j) / 10;
    return { frame, value: segmentValue(a, b, frame) };
  });
}
function splitAt(track: Track, frame: number): Track {
  const i = track.findIndex((k) => k.frame >= frame - EPS);
  if (i <= 0 || Math.abs(track[i]!.frame - frame) <= EPS) return track;
  const a = track[i - 1]!,
    b = track[i]!,
    { left, right, y } = splitCurve(a.curve, (frame - a.frame) / (b.frame - a.frame));
  const mid: Key = { frame, value: a.value.map((v, j) => v + (b.value[j]! - v) * y) };
  return [
    ...track.slice(0, i - 1),
    ...(left === null ? flatten(a, b, a.frame, frame) : [withCurve(a, left)]),
    ...(right === null ? flatten(a, b, frame, b.frame) : [withCurve(mid, right)]),
    ...track.slice(i),
  ];
}
/** Exact sub-range; the track must already cover [from, to]. */
function crop(track: Track, from: number, to: number): Track {
  if (track[0]!.frame > from + EPS || track.at(-1)!.frame < to - EPS)
    fail("KEYPOSE_INTERNAL", "Track does not cover the requested range");
  const cut = splitAt(splitAt(track, from), to).filter(
    (k) => k.frame >= from - EPS && k.frame <= to + EPS,
  );
  cut[0] = { ...cut[0]!, frame: from };
  cut[cut.length - 1] = withCurve({ ...cut.at(-1)!, frame: to }, undefined);
  return cut;
}
/** One period of keys (last key's curve is the wrap segment) repeated, then cut to [0, N]. */
function periodic(keys: Key[], N: number): Track {
  const one = [...keys].sort((a, b) => a.frame - b.frame);
  const repeated = [-2, -1, 0, 1, 2].flatMap((p) =>
    one.map((k) => ({ ...k, frame: k.frame + p * N })),
  );
  return crop(repeated, 0, N);
}

// ---- drivers -------------------------------------------------------------------------------
function shifted(track: Track, lag: number, N: number, loop: boolean): Track {
  if (loop) {
    const wrapped = ((lag % N) + N) % N; // a loop repeats, so any lag is a phase within one cycle
    return wrapped === 0
      ? track
      : periodic(
          track.slice(0, -1).map((k) => ({ ...k, frame: k.frame + wrapped })),
          N,
        );
  }
  if (lag === 0) return track;
  const keys = track.map((k) => ({ ...k, frame: k.frame + lag }));
  if (keys[0]!.frame > 0) keys.unshift({ frame: 0, value: [...keys[0]!.value] });
  if (keys.at(-1)!.frame < N) keys.push({ frame: N, value: [...keys.at(-1)!.value] });
  return crop(keys, 0, N);
}
function saccade(source: Track, move: number, moveCurve: KeyCurve | undefined): Track {
  const keys: Key[] = [];
  for (let i = 0; i < source.length - 1; i++) {
    const a = source[i]!,
      b = source[i + 1]!;
    keys.push(withCurve({ frame: a.frame, value: a.value }, moveCurve));
    if (b.frame - a.frame > move)
      keys.push({ frame: a.frame + move, value: b.value, curve: { type: "stepped" } });
  }
  keys.push({ frame: source.at(-1)!.frame, value: source.at(-1)!.value });
  return keys;
}
function settle(from: Vec, to: Vec, rule: Extract<KeyposeRule, { rule: "settle" }>, N: number) {
  const delta = to.map((v, j) => v - from[j]!),
    keys: Key[] = [];
  if (rule.start > 0) keys.push({ frame: 0, value: from });
  keys.push(withCurve({ frame: rule.start, value: from }, curveOf(rule.travelEase ?? "out")));
  // Overshoot is relative to the travel, so a long rise can end in a small, readable bounce.
  let frame = rule.start + rule.travel,
    amount = rule.overshoot,
    sign = 1;
  const bounces = rule.bounces ?? 12;
  for (let n = 0; n < bounces && amount > 0 && amount >= rule.overshoot * 0.1; n++) {
    keys.push({
      frame,
      value: to.map((v, j) => v + delta[j]! * amount * sign),
      curve: NAMED.ease!,
    });
    frame += rule.period;
    amount *= rule.damping;
    sign = -sign;
  }
  keys.push({ frame, value: to });
  if (frame < N) keys.push({ frame: N, value: to });
  return crop(keys, 0, N);
}
function cycle(center: Vec, amplitude: Vec, period: number, phase: number, N: number): Track {
  const half = period / 2,
    base = phase + Math.round(period / 4),
    keys: Key[] = [];
  for (let k = Math.floor(-base / half) - 2; base + k * half <= N + 2 * half; k++) {
    const sign = ((k % 2) + 2) % 2 === 0 ? 1 : -1;
    keys.push({
      frame: base + k * half,
      value: center.map((c, j) => c + amplitude[j]! * sign),
      curve: NAMED.sine!,
    });
  }
  return crop(keys, 0, N);
}

// ---- compile -------------------------------------------------------------------------------
const REST: Record<KeyposeControl["channel"], Vec> = {
  rotate: [0],
  translate: [0, 0],
  scale: [1, 1],
};
/**
 * Compiles a pose table plus timing rules into a sparse, curved AnimationSpec.
 * Beats give primary poses; follow/saccade/settle/cycle rules derive every secondary key.
 * Each control is driven exactly once; layer motions on separate bones.
 */
export function buildKeyposeAnimation(rig: RigSpec, spec: KeyposeSpec): AnimationSpec {
  for (const [schema, value, what] of [
    [RigSpecSchema, rig, "RigSpec"],
    [KeyposeSpecSchema, spec, "KeyposeSpec"],
  ] as const) {
    const error = Value.Errors(schema, value).First();
    if (error) fail("KEYPOSE_INPUT", `Invalid ${what} at ${error.path || "/"}: ${error.message}`);
  }
  if (spec.rigId !== rig.id) fail("KEYPOSE_REFERENCE", "KeyposeSpec rigId must match the rig");
  const N = spec.frames,
    loop = spec.loop,
    bones = new Map(rig.bones.map((b) => [b.id, b])),
    controls = new Map<string, KeyposeControl>(),
    channels = new Set<string>();
  for (const c of spec.controls) {
    if (controls.has(c.id)) fail("KEYPOSE_CONTROL", `Duplicate control ${c.id}`);
    if (!bones.has(c.boneId)) fail("KEYPOSE_CONTROL", `Control ${c.id} targets a missing bone`);
    if (channels.has(c.boneId + "\u0000" + c.channel))
      fail("KEYPOSE_CONTROL", `Bone ${c.boneId} ${c.channel} is driven by two controls`);
    if (c.space !== undefined && c.channel !== "translate")
      fail("KEYPOSE_CONTROL", `Control ${c.id}: space applies to translate only`);
    if (c.unit !== undefined && c.channel === "scale")
      fail("KEYPOSE_CONTROL", `Control ${c.id}: scale factors take no unit`);
    controls.set(c.id, c);
    channels.add(c.boneId + "\u0000" + c.channel);
  }
  const arity = (id: string) => REST[controls.get(id)!.channel].length;
  const vec = (id: string, v: number | [number, number], what: string): Vec => {
    if ((typeof v === "number" ? 1 : 2) !== arity(id))
      fail("KEYPOSE_VALUE", `${what} for ${id} needs ${arity(id) === 1 ? "a number" : "[x, y]"}`);
    return typeof v === "number" ? [v] : [...v];
  };
  const driver = new Map<string, string>();
  const claim = (id: string, by: string) => {
    if (!controls.has(id)) fail("KEYPOSE_REFERENCE", `${by} references unknown control ${id}`);
    if (driver.has(id) && driver.get(id) !== by)
      fail("KEYPOSE_DRIVER", `Control ${id} is driven by both ${driver.get(id)} and ${by}`);
    driver.set(id, by);
  };

  // Beats: arrival ease belongs to the segment that ends at the beat.
  const posed = new Map<string, { frame: number; value: Vec; ease?: KeyposeEase }[]>();
  spec.beats.forEach((beat, i) => {
    if (i > 0 && beat.frame <= spec.beats[i - 1]!.frame)
      fail("KEYPOSE_BEATS", "Beat frames must increase strictly");
    if (loop ? beat.frame >= N : beat.frame > N)
      fail("KEYPOSE_BEATS", loop ? "Looping beats lie in [0, frames)" : "Beats lie in [0, frames]");
    for (const [id, entry] of Object.entries(beat.poses)) {
      claim(id, "beats");
      const value = typeof entry === "object" && !Array.isArray(entry) ? entry.value : entry;
      const ease = typeof entry === "object" && !Array.isArray(entry) ? entry.ease : beat.ease;
      posed.set(id, [
        ...(posed.get(id) ?? []),
        { frame: beat.frame, value: vec(id, value, "Pose"), ...(ease ? { ease } : {}) },
      ]);
    }
  });
  for (const r of spec.rules) {
    claim(r.control, r.rule);
    if ((r.rule === "follow" || r.rule === "saccade") && !controls.has(r.source))
      fail("KEYPOSE_REFERENCE", `${r.rule} for ${r.control} references unknown source ${r.source}`);
    if (r.rule === "settle" && loop)
      fail("KEYPOSE_RULE", "settle is one-shot; use a non-looping spec");
    if (r.rule === "cycle" && loop && N % r.period !== 0)
      fail("KEYPOSE_RULE", `cycle period ${r.period} must divide ${N} looping frames`);
  }
  for (const id of controls.keys())
    if (!driver.has(id)) fail("KEYPOSE_DRIVER", `Control ${id} has no beats or rule`);

  const tracks = new Map<string, Track>();
  for (const [id, entries] of posed) {
    const keys = entries.map((e, i, all) => {
      const next = loop ? all[(i + 1) % all.length]! : all[i + 1];
      return withCurve({ frame: e.frame, value: e.value }, next && curveOf(next.ease));
    });
    if (loop) tracks.set(id, periodic(keys, N));
    else {
      if (keys[0]!.frame > 0) keys.unshift({ frame: 0, value: [...keys[0]!.value] });
      if (keys.at(-1)!.frame < N) keys.push({ frame: N, value: [...keys.at(-1)!.value] });
      tracks.set(id, keys);
    }
  }
  const gainOf = (id: string, gain: number | [number, number]): Vec => {
    if (typeof gain !== "number" && arity(id) !== 2)
      fail("KEYPOSE_RULE", `A [x, y] gain needs a two-channel control (${id})`);
    return typeof gain === "number" ? Array(arity(id)).fill(gain) : [...gain];
  };
  // Resolve rules in dependency order; a source must be resolved before its followers.
  const resolve = (r: KeyposeRule) => {
    const rest = REST[controls.get(r.control)!.channel];
    if (r.rule === "settle") {
      const to = r.to === undefined ? rest : vec(r.control, r.to, "settle to");
      return settle(vec(r.control, r.from, "settle from"), to, r, N);
    }
    if (r.rule === "cycle") {
      const center = r.center === undefined ? rest : vec(r.control, r.center, "cycle center");
      return cycle(
        center,
        vec(r.control, r.amplitude, "cycle amplitude"),
        r.period,
        r.phase ?? 0,
        N,
      );
    }
    // follow / saccade: affine map of the source's offset from rest, so curves carry over unchanged.
    const sourceRest = REST[controls.get(r.source)!.channel],
      gain = gainOf(r.control, r.gain);
    let pick = (v: Vec) => v,
      pickRest = sourceRest;
    if (r.rule === "follow" && r.component !== undefined) {
      const j = r.component === "x" ? 0 : 1;
      if (arity(r.control) !== 1 || arity(r.source) !== 2)
        fail(
          "KEYPOSE_RULE",
          `component maps a two-channel source to a scalar control (${r.control})`,
        );
      pick = (v) => [v[j]!];
      pickRest = [sourceRest[j]!];
    } else if (arity(r.control) !== arity(r.source))
      fail("KEYPOSE_RULE", `${r.control} and ${r.source} have different channel counts`);
    const source = tracks.get(r.source)!,
      timed =
        r.rule === "follow"
          ? shifted(source, r.lag, N, loop)
          : shifted(
              saccade(source, r.move ?? 2, curveOf(r.moveEase ?? "out")),
              -(r.lead ?? 0),
              N,
              loop,
            );
    return timed.map((k) => ({
      ...k,
      value: pick(k.value).map((v, j) => rest[j]! + (v - pickRest[j]!) * gain[j]!),
    }));
  };
  let pending = [...spec.rules];
  while (pending.length) {
    const waiting: KeyposeRule[] = [];
    for (const r of pending)
      if ((r.rule === "follow" || r.rule === "saccade") && !tracks.has(r.source)) waiting.push(r);
      else tracks.set(r.control, resolve(r));
    if (waiting.length === pending.length)
      fail(
        "KEYPOSE_CYCLE",
        "Rules form a dependency cycle: " + waiting.map((r) => r.control).join(", "),
      );
    pending = waiting;
  }

  // Authored units/axes -> IR channel values. All maps are linear, so segment curves are unchanged.
  const world = evaluateRig(rig),
    timelines = {
      rotate: [] as NonNullable<AnimationSpec["rotationTimelines"]>,
      translate: [] as NonNullable<AnimationSpec["translationTimelines"]>,
      scale: [] as NonNullable<AnimationSpec["scaleTimelines"]>,
    };
  for (const c of spec.controls) {
    let track = tracks.get(c.id)!;
    if (track.every((k) => k.value.every((v, j) => Math.abs(v - track[0]!.value[j]!) <= 1e-12)))
      track = [
        { frame: 0, value: track[0]!.value },
        { frame: N, value: track[0]!.value },
      ];
    const unit = c.unit ?? 1,
      parent = bones.get(c.boneId)!.parentId,
      inv =
        c.channel === "translate" && (c.space ?? "world") === "world" && parent
          ? inverseAffine(world.get(parent)!)
          : undefined;
    const convert = (v: Vec): Vec => {
      if (c.channel !== "translate") return c.channel === "rotate" ? [v[0]! * unit] : v;
      const x = v[0]! * unit,
        y = v[1]! * unit;
      return inv ? [inv[0] * x + inv[2] * y, inv[1] * x + inv[3] * y] : [x, y];
    };
    const keys = track.map((k, i) => {
      const v = convert(k.value),
        curve = i < track.length - 1 ? k.curve : undefined;
      return { time: k.frame / spec.fps, v, ...(curve ? { curve: { ...curve } } : {}) };
    });
    if (c.channel === "rotate")
      timelines.rotate.push({
        boneId: c.boneId,
        keys: keys.map(({ time, v, ...rest }) => ({ time, degrees: v[0]!, ...rest })),
      });
    else
      timelines[c.channel].push({
        boneId: c.boneId,
        keys: keys.map(({ time, v, ...rest }) => ({ time, x: v[0]!, y: v[1]!, ...rest })),
      });
  }
  const animation: AnimationSpec = {
    schemaVersion: "0.1",
    kind: "animation",
    id: spec.id,
    name: spec.name,
    rigId: rig.id,
    duration: N / spec.fps,
    loop,
    motions: [],
    ...(timelines.rotate.length ? { rotationTimelines: timelines.rotate } : {}),
    ...(timelines.translate.length ? { translationTimelines: timelines.translate } : {}),
    ...(timelines.scale.length ? { scaleTimelines: timelines.scale } : {}),
  };
  validateAnimation(animation, rig);
  return animation;
}
