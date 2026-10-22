import { bezierPoints, bezierValue, type ChannelCurve } from "./keys-fit.js";

/**
 * Spine 4.0 JSON timelines as numbers (ADR-044): every curve timeline of an animation becomes a
 * list of key times, value vectors and per-segment curves that evaluate exactly as the runtime
 * plays them, and can be written back. Attachment, draw order and event timelines are discrete and
 * are only listed (their times), never rewritten.
 */
export type TimelineKind = "bone" | "slot" | "ik" | "transform" | "path" | "deform";
type RawKey = Record<string, unknown>;
export interface Timeline {
  /** Stable id: `bone:<bone>/<prop>`, `slot:<slot>/<prop>`, `ik:<name>`, `deform:<skin>/<slot>/<attachment>`. */
  id: string;
  kind: TimelineKind;
  /** Bone, slot or constraint name. */
  owner: string;
  /** rotate, translate, …, rgba, mix, position; the attachment name for deform. */
  prop: string;
  skin?: string;
  /** The raw keys as read (never modified). */
  keys: RawKey[];
  times: number[];
  /** Each key's channel values (deform: offsets from the setup shape, zeros filled in). */
  values: number[][];
  /** Each segment's curve per channel (one entry when `shared`). */
  curves: (ChannelCurve | "stepped")[][];
  /** One curve for every channel (deform keys). */
  shared: boolean;
  /** Discrete key fields that switch at a key (IK bendPositive, compress, stretch). */
  discrete: string[];
}

const BONE_CHANNELS: Record<string, { names: string[]; base: number }> = {
  rotate: { names: ["value"], base: 0 },
  translate: { names: ["x", "y"], base: 0 },
  translatex: { names: ["value"], base: 0 },
  translatey: { names: ["value"], base: 0 },
  scale: { names: ["x", "y"], base: 1 },
  scalex: { names: ["value"], base: 1 },
  scaley: { names: ["value"], base: 1 },
  shear: { names: ["x", "y"], base: 0 },
  shearx: { names: ["value"], base: 0 },
  sheary: { names: ["value"], base: 0 },
};
const COLOR_PROPS: Record<string, { light: number; dark: number }> = {
  rgba: { light: 4, dark: 0 },
  rgb: { light: 3, dark: 0 },
  rgba2: { light: 4, dark: 3 },
  rgb2: { light: 3, dark: 3 },
};
const hex = (s: string, n: number) =>
  Array.from({ length: n }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255);
const toHex = (vs: number[]) =>
  vs
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const num = (k: RawKey, name: string, base: number) =>
  typeof k[name] === "number" ? (k[name] as number) : base;
export const keyTime = (k: RawKey) => (typeof k.time === "number" ? k.time : 0);

/** Channel reader and writer for one timeline type. */
interface Codec {
  channels: number;
  shared: boolean;
  discrete: string[];
  read(k: RawKey): number[];
  write(values: number[], template: RawKey): RawKey;
}
const round = (v: number, digits = 4) => {
  const r = +v.toFixed(digits);
  return Object.is(r, -0) ? 0 : r;
};
function boneCodec(prop: string): Codec | undefined {
  const spec = BONE_CHANNELS[prop];
  if (!spec) return undefined;
  return {
    channels: spec.names.length,
    shared: false,
    discrete: [],
    read: (k) => spec.names.map((n) => num(k, n, spec.base)),
    write: (values) => Object.fromEntries(spec.names.map((n, i) => [n, round(values[i]!)])),
  };
}
function colorCodec(prop: string): Codec | undefined {
  if (prop === "alpha")
    return {
      channels: 1,
      shared: false,
      discrete: [],
      read: (k) => [num(k, "value", 1)],
      write: (values) => ({ value: round(values[0]!) }),
    };
  const spec = COLOR_PROPS[prop];
  if (!spec) return undefined;
  return {
    channels: spec.light + spec.dark,
    shared: false,
    discrete: [],
    read: (k) => [
      ...hex(String(k.color ?? "ffffffff"), spec.light),
      ...(spec.dark ? hex(String(k.dark ?? "000000"), spec.dark) : []),
    ],
    write: (values) => ({
      color: toHex(values.slice(0, spec.light)),
      ...(spec.dark ? { dark: toHex(values.slice(spec.light)) } : {}),
    }),
  };
}
const IK: Codec = {
  channels: 2,
  shared: false,
  discrete: ["bendPositive", "compress", "stretch"],
  read: (k) => [num(k, "mix", 1), num(k, "softness", 0)],
  write: (values) => ({ mix: round(values[0]!, 5), softness: round(values[1]!) }),
};
const TRANSFORM: Codec = {
  channels: 6,
  shared: false,
  discrete: [],
  read: (k) => {
    const x = num(k, "mixX", 1),
      sx = num(k, "mixScaleX", 1);
    return [
      num(k, "mixRotate", 1),
      x,
      num(k, "mixY", x),
      sx,
      num(k, "mixScaleY", sx),
      num(k, "mixShearY", 1),
    ];
  },
  write: (v) => ({
    mixRotate: round(v[0]!, 5),
    mixX: round(v[1]!, 5),
    mixY: round(v[2]!, 5),
    mixScaleX: round(v[3]!, 5),
    mixScaleY: round(v[4]!, 5),
    mixShearY: round(v[5]!, 5),
  }),
};
const PATH_MIX: Codec = {
  channels: 3,
  shared: false,
  discrete: [],
  read: (k) => {
    const x = num(k, "mixX", 1);
    return [num(k, "mixRotate", 1), x, num(k, "mixY", x)];
  },
  write: (v) => ({ mixRotate: round(v[0]!, 5), mixX: round(v[1]!, 5), mixY: round(v[2]!, 5) }),
};
const PATH_VALUE: Codec = {
  channels: 1,
  shared: false,
  discrete: [],
  read: (k) => [num(k, "value", 0)],
  write: (v) => ({ value: round(v[0]!) }),
};
function deformCodec(length: number): Codec {
  return {
    channels: length,
    shared: true,
    discrete: [],
    read: (k) => {
      const out = new Array<number>(length).fill(0);
      const vs = k.vertices as number[] | undefined;
      if (vs) {
        const start = num(k, "offset", 0);
        for (let i = 0; i < vs.length && start + i < length; i++) out[start + i] = vs[i]!;
      }
      return out;
    },
    // Leading and trailing zeros are left out, as Spine writes them; all zeros is the setup shape.
    write: (values) => {
      const r = values.map((v) => round(v, 5));
      let a = 0,
        b = r.length;
      while (a < b && r[a] === 0) a++;
      while (b > a && r[b - 1] === 0) b--;
      if (a === b) return {};
      return { ...(a ? { offset: a } : {}), vertices: r.slice(a, b) };
    },
  };
}

/** Deform length of a mesh attachment in the document's skins: weighted pairs × 2, else vertices. */
export function deformLength(
  doc: Record<string, unknown>,
  skin: string,
  slot: string,
  attachment: string,
): number | undefined {
  const skins = doc.skins as {
    name: string;
    attachments: Record<string, Record<string, RawKey>>;
  }[];
  const find = (skinName: string, name: string): RawKey | undefined =>
    skins.find((s) => s.name === skinName)?.attachments?.[slot]?.[name];
  let att = find(skin, attachment);
  if (!att) return undefined;
  // A linked mesh deforms with its parent's vertices.
  for (let guard = 0; att && att.type === "linkedmesh" && guard < 8; guard++)
    att = find(String(att.skin ?? "default"), String(att.parent));
  if (!att) return undefined;
  const vertices = att.vertices as number[],
    uvs = att.uvs as number[];
  if (vertices.length === uvs.length) return vertices.length;
  let pairs = 0;
  for (let i = 0; i < vertices.length;) {
    const n = vertices[i]!;
    pairs += n;
    i += 1 + n * 4;
  }
  return pairs * 2;
}

function segmentCurves(k: RawKey, codec: Codec, next: RawKey): (ChannelCurve | "stepped")[] {
  const c = k.curve;
  const n = codec.shared ? 1 : codec.channels;
  if (c === "stepped") return new Array(n).fill("stepped");
  if (!Array.isArray(c)) return new Array(n).fill("linear");
  void next;
  return Array.from({ length: n }, (_, i) => {
    const h = c.slice(i * 4, i * 4 + 4) as number[];
    return h.length === 4 ? (h as [number, number, number, number]) : "linear";
  });
}
function makeTimeline(
  id: string,
  kind: TimelineKind,
  owner: string,
  prop: string,
  keys: RawKey[],
  codec: Codec,
  skin?: string,
): Timeline {
  const times = keys.map(keyTime);
  const values = keys.map((k) => codec.read(k));
  return {
    id,
    kind,
    owner,
    prop,
    ...(skin ? { skin } : {}),
    keys,
    times,
    values,
    curves: keys.slice(0, -1).map((k, i) => segmentCurves(k, codec, keys[i + 1]!)),
    shared: codec.shared,
    discrete: codec.discrete,
  };
}
export function codecFor(doc: Record<string, unknown>, tl: Timeline): Codec {
  if (tl.kind === "bone") return boneCodec(tl.prop)!;
  if (tl.kind === "slot") return colorCodec(tl.prop)!;
  if (tl.kind === "ik") return IK;
  if (tl.kind === "transform") return TRANSFORM;
  if (tl.kind === "path") return tl.prop === "mix" ? PATH_MIX : PATH_VALUE;
  const [, slot] = tl.id.slice("deform:".length).split("/");
  return deformCodec(deformLength(doc, tl.skin!, slot!, tl.prop) ?? tl.values[0]!.length);
}

export interface AnimationTimelines {
  curves: Timeline[];
  /** Times where a discrete state changes: attachment keys, draw order keys, events. */
  discrete: { kind: "attachment" | "drawOrder" | "event"; owner: string; time: number }[];
  /** Largest key time over every timeline (the animation's duration in Spine). */
  duration: number;
}
/** Every timeline of one animation of a Spine 4.0 JSON document. */
export function readTimelines(doc: Record<string, unknown>, animation: string): AnimationTimelines {
  const anim = (doc.animations as Record<string, Record<string, unknown>>)[animation];
  if (!anim) throw new Error(`KEYS_ANIMATION: no animation ${animation}`);
  const curves: Timeline[] = [];
  const discrete: AnimationTimelines["discrete"] = [];
  let duration = 0;
  const seen = (keys: RawKey[]) => {
    for (const k of keys) duration = Math.max(duration, keyTime(k));
  };
  for (const [bone, props] of Object.entries(
    (anim.bones ?? {}) as Record<string, Record<string, RawKey[]>>,
  ))
    for (const [prop, keys] of Object.entries(props)) {
      seen(keys);
      const codec = boneCodec(prop);
      if (codec && keys.length)
        curves.push(makeTimeline(`bone:${bone}/${prop}`, "bone", bone, prop, keys, codec));
    }
  for (const [slot, props] of Object.entries(
    (anim.slots ?? {}) as Record<string, Record<string, RawKey[]>>,
  ))
    for (const [prop, keys] of Object.entries(props)) {
      seen(keys);
      if (prop === "attachment") {
        for (const k of keys) discrete.push({ kind: "attachment", owner: slot, time: keyTime(k) });
        continue;
      }
      const codec = colorCodec(prop);
      if (codec && keys.length)
        curves.push(makeTimeline(`slot:${slot}/${prop}`, "slot", slot, prop, keys, codec));
    }
  for (const [name, keys] of Object.entries((anim.ik ?? {}) as Record<string, RawKey[]>)) {
    seen(keys);
    if (keys.length) curves.push(makeTimeline(`ik:${name}`, "ik", name, "mix", keys, IK));
  }
  for (const [name, keys] of Object.entries((anim.transform ?? {}) as Record<string, RawKey[]>)) {
    seen(keys);
    if (keys.length)
      curves.push(makeTimeline(`transform:${name}`, "transform", name, "mix", keys, TRANSFORM));
  }
  for (const [name, props] of Object.entries(
    (anim.path ?? {}) as Record<string, Record<string, RawKey[]>>,
  ))
    for (const [prop, keys] of Object.entries(props)) {
      seen(keys);
      if (keys.length)
        curves.push(
          makeTimeline(
            `path:${name}/${prop}`,
            "path",
            name,
            prop,
            keys,
            prop === "mix" ? PATH_MIX : PATH_VALUE,
          ),
        );
    }
  for (const [skin, slots] of Object.entries(
    (anim.deform ?? {}) as Record<string, Record<string, Record<string, RawKey[]>>>,
  ))
    for (const [slot, atts] of Object.entries(slots))
      for (const [att, keys] of Object.entries(atts)) {
        seen(keys);
        const length = deformLength(doc, skin, slot, att);
        if (length === undefined || !keys.length) continue;
        curves.push(
          makeTimeline(
            `deform:${skin}/${slot}/${att}`,
            "deform",
            slot,
            att,
            keys,
            deformCodec(length),
            skin,
          ),
        );
      }
  for (const k of (anim.drawOrder ?? []) as RawKey[]) {
    duration = Math.max(duration, keyTime(k));
    discrete.push({ kind: "drawOrder", owner: "", time: keyTime(k) });
  }
  for (const k of (anim.events ?? []) as RawKey[]) {
    duration = Math.max(duration, keyTime(k));
    discrete.push({ kind: "event", owner: String(k.name), time: keyTime(k) });
  }
  return { curves, discrete, duration };
}

/** The values a timeline plays at time t, as the runtime evaluates its keys. */
export function timelineValue(
  times: readonly number[],
  values: readonly number[][],
  curves: readonly (ChannelCurve | "stepped")[][],
  shared: boolean,
  t: number,
): number[] {
  const n = times.length;
  if (t <= times[0]!) return [...values[0]!];
  if (t >= times[n - 1]!) return [...values[n - 1]!];
  let i = 0;
  while (i < n - 2 && times[i + 1]! <= t) i++;
  const t0 = times[i]!,
    t1 = times[i + 1]!,
    a = values[i]!,
    b = values[i + 1]!;
  const seg = curves[i]!;
  if (shared) {
    const c = seg[0]!;
    if (c === "stepped") return [...a];
    let f: number;
    if (c === "linear") f = (t - t0) / (t1 - t0);
    else f = bezierValue(bezierPoints(t0, 0, c[0], c[1], c[2], c[3], t1, 1), t0, 0, t1, 1, t);
    return a.map((v, j) => v + (b[j]! - v) * f);
  }
  return a.map((v, j) => {
    const c = seg[j] ?? "linear";
    if (c === "stepped") return v;
    if (c === "linear") return v + ((t - t0) / (t1 - t0)) * (b[j]! - v);
    return bezierValue(bezierPoints(t0, v, c[0], c[1], c[2], c[3], t1, b[j]!), t0, v, t1, b[j]!, t);
  });
}

/** One key of a rewritten timeline. */
export interface PlannedKey {
  time: number;
  values: number[];
  /** The original key at this same time (its exact time and fields; with `verbatim`, its curve). */
  source?: number;
  /** The original key in force at this time, for discrete fields (IK bend, compress, stretch). */
  state?: number;
  /** Curve of the segment that starts here, per channel (one when shared); ignored on the last key. */
  curve?: (ChannelCurve | "stepped")[];
  /** Keep the source key exactly as it was (same next key: same segment). */
  verbatim?: boolean;
}
const roundCurve = (c: number[]) => c.map((v) => round(v, 5));
/** Writes planned keys back to Spine 4.0 JSON keys for a timeline. */
export function writeKeys(
  doc: Record<string, unknown>,
  tl: Timeline,
  keys: PlannedKey[],
): RawKey[] {
  const codec = codecFor(doc, tl);
  return keys.map((k, i) => {
    const last = i === keys.length - 1;
    if (k.verbatim && k.source !== undefined) {
      const raw = { ...tl.keys[k.source]! };
      if (last) delete raw.curve;
      return raw;
    }
    // Discrete fields (IK bend, compress, stretch) come from the key in force at this time.
    const template = tl.keys[k.source ?? k.state ?? 0] ?? {};
    const out: RawKey = {};
    const time = k.source !== undefined ? keyTime(tl.keys[k.source]!) : round(k.time, 4);
    if (time !== 0) out.time = time;
    Object.assign(out, codec.write(k.values, template));
    for (const d of codec.discrete) if (template[d] !== undefined) out[d] = template[d];
    if (!last && k.curve) {
      if (k.curve.every((c) => c === "stepped")) out.curve = "stepped";
      else if (!k.curve.every((c) => c === "linear"))
        out.curve = roundCurve(
          k.curve.flatMap((c, j) => {
            if (c !== "linear" && c !== "stepped") return c;
            // A linear channel beside Bezier ones: straight handles at thirds.
            const t0 = k.time,
              t1 = keys[i + 1]!.time;
            const v0 = tl.shared ? 0 : k.values[j]!,
              v1 = tl.shared ? 1 : keys[i + 1]!.values[j]!;
            return [
              t0 + (t1 - t0) / 3,
              v0 + (v1 - v0) / 3,
              t0 + ((t1 - t0) * 2) / 3,
              v0 + ((v1 - v0) * 2) / 3,
            ];
          }),
        );
    }
    return out;
  });
}

/** Replaces one timeline's keys in an animation object (same place it was read from). */
export function setTimelineKeys(anim: Record<string, unknown>, tl: Timeline, keys: RawKey[]): void {
  const at = (o: unknown, ...path: string[]) =>
    path.reduce((x, p) => (x as Record<string, unknown>)[p], o) as Record<string, unknown>;
  switch (tl.kind) {
    case "bone":
      at(anim, "bones", tl.owner)[tl.prop] = keys;
      return;
    case "slot":
      at(anim, "slots", tl.owner)[tl.prop] = keys;
      return;
    case "ik":
      at(anim, "ik")[tl.owner] = keys;
      return;
    case "transform":
      at(anim, "transform")[tl.owner] = keys;
      return;
    case "path":
      at(anim, "path", tl.owner)[tl.prop] = keys;
      return;
    case "deform":
      at(anim, "deform", tl.skin!, tl.owner)[tl.prop] = keys;
      return;
  }
}
