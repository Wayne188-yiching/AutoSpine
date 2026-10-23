import { failStage } from "@autospine/rig";

type Json = Record<string, unknown>;
type Tree = Record<string, Record<string, Record<string, unknown>>>;
type Key = Record<string, unknown>;

/**
 * A 4.0 skeleton laid out for another editor's import (ADR-046). From 4.1 deform keys live under
 * `animations.<a>.attachments.<skin>.<slot>.<attachment>.deform`; a 4.2 editor given the 4.0
 * `deform` imports the rest and drops every deform key. From 4.2 a bone's `transform` is
 * `inherit`. The rest of what AutoSpine writes reads the same in 4.1 and 4.2. 3.8 is written in
 * its own layout (ADR-047, `for38`). Returns a copy; a 4.0 version returns the document unchanged.
 */
export function forEditorVersion<T extends object>(document: T, version: string): T {
  const [major = 4, minor = 0] = version.split(".").map(Number);
  if (major === 4 && minor === 0) return document;
  const doc = structuredClone(document) as Json;
  doc.skeleton = {
    ...(doc.skeleton as Json),
    spine: version.split(".").length === 2 ? `${version}.0` : version,
  };
  if (major < 4) return for38(doc) as T;
  for (const animation of Object.values((doc.animations ?? {}) as Record<string, Json>)) {
    const deform = animation.deform as Tree | undefined;
    if (!deform) continue;
    const moved: Record<string, Tree> = {};
    for (const [skin, slots] of Object.entries(deform))
      for (const [slot, attachments] of Object.entries(slots))
        for (const [name, keys] of Object.entries(attachments))
          ((moved[skin] ??= {})[slot] ??= {})[name] = { deform: keys };
    animation.attachments = moved;
    delete animation.deform;
  }
  if (major > 4 || minor >= 2)
    for (const bone of (doc.bones ?? []) as Json[])
      if (bone.transform !== undefined) {
        bone.inherit = bone.transform;
        delete bone.transform;
      }
  return doc as T;
}

/** A 4.0 Bezier segment (absolute handles) at time `t`: the handle curve solved for its x. */
function bezierAt(t0: number, v0: number, h: number[], t1: number, v1: number, t: number) {
  const [cx1, cy1, cx2, cy2] = h as [number, number, number, number];
  const at = (a: number, b: number, c: number, d: number, s: number) =>
    (1 - s) ** 3 * a + 3 * (1 - s) ** 2 * s * b + 3 * (1 - s) * s ** 2 * c + s ** 3 * d;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(t0, cx1, cx2, t1, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(v0, cy1, cy2, v1, (lo + hi) / 2);
}

/**
 * 4.0 keys to 3.8 keys. 4.0 gives each channel absolute handles; 3.8 one curve per key, as
 * fractions of the segment, shared by every channel (`curve`, `c2`, `c3`, `c4`). Where the
 * channels that change do not share one shape (a key-reduced file), the segment is written as
 * linear keys every 1/30 s, exact on those times.
 */
function keys38(
  keys: Key[],
  channels: ((k: Key) => number)[],
  write: (k: Key, values: number[]) => Key,
  /** Where each channel's handles sit in the 4.0 curve array (default: in channel order). */
  slot: number[] = channels.map((_, i) => i),
): Key[] {
  const out: Key[] = [];
  keys.forEach((k, i) => {
    const values = channels.map((c) => c(k));
    const key = write(k, values);
    const next = keys[i + 1];
    out.push(key);
    if (k.curve === "stepped") key.curve = "stepped";
    if (!Array.isArray(k.curve) || !next) return;
    const handles = k.curve as number[];
    const t0 = (k.time as number | undefined) ?? 0,
      t1 = (next.time as number | undefined) ?? 0,
      span = t1 - t0;
    const shapes: number[][] = [];
    channels.forEach((c, ch) => {
      const v0 = values[ch]!,
        v1 = c(next);
      const [cx1, cy1, cx2, cy2] = handles.slice(4 * slot[ch]!, 4 * slot[ch]! + 4) as [
        number,
        number,
        number,
        number,
      ];
      if (Math.abs(v1 - v0) > 1e-9 && span > 0)
        shapes.push([
          (cx1 - t0) / span,
          (cy1 - v0) / (v1 - v0),
          (cx2 - t0) / span,
          (cy2 - v0) / (v1 - v0),
        ]);
    });
    if (!shapes.length) return;
    if (shapes.every((s) => s.every((v, j) => Math.abs(v - shapes[0]![j]!) < 1e-4))) {
      // + 0 turns a falling channel's -0 into 0.
      const [c1, c2, c3, c4] = shapes[0]!.map((v) => v + 0);
      Object.assign(key, { curve: c1, c2, c3, c4 });
      return;
    }
    const steps = Math.max(2, Math.ceil(span * 30));
    for (let s = 1; s < steps; s++) {
      const t = t0 + (span * s) / steps;
      const sampled = channels.map((c, ch) =>
        bezierAt(t0, values[ch]!, handles.slice(4 * slot[ch]!, 4 * slot[ch]! + 4), t1, c(next), t),
      );
      out.push({ ...write(k, sampled), time: +t.toFixed(6) });
    }
  });
  return out;
}

const num = (k: Key, field: string, base: number) => (k[field] as number | undefined) ?? base;
const time = (k: Key) => (k.time === undefined ? {} : { time: k.time });

/**
 * The 3.8 layout (ADR-047): rotate keys hold `angle`; slot colours are `color` timelines;
 * transform constraints and their keys use `rotateMix`, `translateMix`, `scaleMix`, `shearMix`
 * (3.8 has one translate and one scale mix); curves are one per key (`keys38`). Deform keys stay
 * under `deform` with their curves in fractions of the segment. What 3.8 cannot hold stops with
 * SPINE_38_UNSUPPORTED rather than being dropped.
 */
function for38(doc: Json): Json {
  const unsupported = new Set<string>();
  const sameMix = (k: Key, where: string) => {
    const x = num(k, "mixX", 1),
      sx = num(k, "mixScaleX", 1);
    if (num(k, "mixY", x) !== x || num(k, "mixScaleY", sx) !== sx)
      unsupported.add(`${where}: separate x and y mixes`);
  };
  const transforms = (doc.transform ?? []) as Json[];
  doc.transform = transforms.map((c) => {
    sameMix(c, `transform constraint ${String(c.name)}`);
    const out: Json = {
      ...c,
      rotateMix: num(c, "mixRotate", 1),
      translateMix: num(c, "mixX", 1),
      scaleMix: num(c, "mixScaleX", 1),
      shearMix: num(c, "mixShearY", 1),
    };
    for (const f of ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"])
      delete out[f];
    return out;
  });
  if (!transforms.length) delete doc.transform;
  for (const field of ["path", "physics"]) if (doc[field]) unsupported.add(`${field} constraints`);

  const hex = (s: string, i: number) => parseInt(s.slice(2 * i, 2 * i + 2), 16) / 255;
  const toHex = (v: number[]) =>
    v
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const bone: Record<string, [string, number, number]> = {
    translate: ["x", 0, 0],
    scale: ["x", 1, 1],
    shear: ["x", 0, 0],
  };
  for (const [name, animation] of Object.entries((doc.animations ?? {}) as Record<string, Json>)) {
    for (const timelines of Object.values((animation.bones ?? {}) as Record<string, Json>))
      for (const [kind, keys] of Object.entries(timelines)) {
        if (kind === "rotate")
          timelines.rotate = keys38(keys as Key[], [(k) => num(k, "value", 0)], (k, [v]) => ({
            ...time(k),
            angle: v,
          }));
        else if (bone[kind]) {
          const base = bone[kind]![1];
          timelines[kind] = keys38(
            keys as Key[],
            [(k) => num(k, "x", base), (k) => num(k, "y", base)],
            (k, [x, y]) => ({ ...time(k), x, y }),
          );
        } else unsupported.add(`${name}: bone ${kind} timelines`);
      }
    for (const timelines of Object.values((animation.slots ?? {}) as Record<string, Json>))
      for (const [kind, keys] of Object.entries(timelines)) {
        if (kind === "attachment") continue;
        if (kind !== "rgba") {
          unsupported.add(`${name}: slot ${kind} timelines`);
          continue;
        }
        timelines.color = keys38(
          keys as Key[],
          [0, 1, 2, 3].map((i) => (k: Key) => hex(k.color as string, i)),
          (k, v) => ({ ...time(k), color: toHex(v) }),
        );
        delete timelines.rgba;
      }
    for (const slots of Object.values((animation.deform ?? {}) as Tree))
      for (const attachments of Object.values(slots))
        for (const [att, keys] of Object.entries(attachments))
          attachments[att] = (keys as Key[]).map((k, i, all) => {
            if (!Array.isArray(k.curve)) return k;
            const [cx1, cy1, cx2, cy2] = k.curve as number[];
            const t0 = num(k, "time", 0),
              span = num(all[i + 1] ?? {}, "time", 0) - t0;
            return { ...k, curve: (cx1! - t0) / span, c2: cy1, c3: (cx2! - t0) / span, c4: cy2 };
          });
    for (const [c, keys] of Object.entries((animation.ik ?? {}) as Record<string, Key[]>))
      (animation.ik as Json)[c] = keys38(
        keys,
        [(k) => num(k, "mix", 1), (k) => num(k, "softness", 0)],
        (k, [mix, softness]) => {
          const out: Key = { ...k, mix, softness };
          delete out.curve;
          return out;
        },
      );
    for (const [c, keys] of Object.entries((animation.transform ?? {}) as Record<string, Key[]>)) {
      keys.forEach((k) => sameMix(k, `${name}: transform ${c} keys`));
      (animation.transform as Json)[c] = keys38(
        keys,
        [
          (k) => num(k, "mixRotate", 1),
          (k) => num(k, "mixX", 1),
          (k) => num(k, "mixScaleX", 1),
          (k) => num(k, "mixShearY", 1),
        ],
        (k, [rotateMix, translateMix, scaleMix, shearMix]) => ({
          ...time(k),
          rotateMix,
          translateMix,
          scaleMix,
          shearMix,
        }),
        // 4.0 curves: mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY.
        [0, 1, 3, 5],
      );
    }
    for (const field of ["path", "attachments", "physics"])
      if (animation[field]) unsupported.add(`${name}: ${field} timelines`);
  }
  if (unsupported.size)
    failStage(
      "spine",
      "SPINE_38_UNSUPPORTED",
      `Spine 3.8 cannot hold: ${[...unsupported].join("; ")}`,
    );
  return doc;
}
