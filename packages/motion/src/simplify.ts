import type { AnimationSpec, KeyCurve } from "@autospine/schemas";
import { keyFraction } from "./curves.js";
import { easeCurve } from "./keyposes.js";
import { reduceKeys } from "./video-tracks.js";

type Key = { time: number; curve?: KeyCurve };

/** A timeline's channels on every frame 0..frames, as the runtime plays its keys. */
function sampleKeys<K extends Key>(
  keys: readonly K[],
  read: (k: K) => number[],
  times: readonly number[],
): number[][] {
  const channels = read(keys[0]!).map(() => [] as number[]);
  let i = 0;
  for (const t of times) {
    while (i < keys.length - 2 && keys[i + 1]!.time <= t) i++;
    const a = keys[i]!,
      b = keys[Math.min(i + 1, keys.length - 1)]!;
    const u = b.time > a.time ? keyFraction(a.curve, (t - a.time) / (b.time - a.time)) : 0;
    const va = read(a),
      vb = read(b);
    const value =
      t <= keys[0]!.time
        ? read(keys[0]!)
        : t >= keys.at(-1)!.time
          ? read(keys.at(-1)!)
          : va.map((v, j) => v + (vb[j]! - v) * u);
    value.forEach((v, j) => channels[j]!.push(v));
  }
  return channels;
}

/**
 * Re-keys one timeline with the fewest keys on whole frames that play within `tolerance` of it
 * (ADR-038). A timeline with a stepped key (a swap, a mirror flip) keeps its keys, and so does one
 * the cleanup would not shorten.
 */
function simplifyKeys<K extends Key>(
  keys: readonly K[],
  read: (k: K) => number[],
  write: (time: number, values: number[], curve: KeyCurve | undefined) => K,
  duration: number,
  fps: number,
  tolerance: number,
): K[] {
  if (keys.length <= 2 || keys.some((k) => k.curve?.type === "stepped")) return [...keys];
  const frames = Math.round(duration * fps);
  if (frames < 2) return [...keys];
  const times = Array.from({ length: frames + 1 }, (_, g) => (g === frames ? duration : g / fps));
  const channels = sampleKeys(keys, read, times);
  const reduced = reduceKeys(
    channels,
    channels.map(() => tolerance),
    { loop: false, minGap: 1, maxKeys: frames + 1, greedy: true },
  );
  if (reduced.frames.length >= keys.length) return [...keys];
  return reduced.frames.map((g, i) => {
    const next = reduced.eases[i + 1];
    const curve =
      next === undefined ? undefined : typeof next === "string" ? easeCurve(next) : next;
    return write(
      times[g]!,
      channels.map((c) => +c[g]!.toFixed(4)),
      i < reduced.frames.length - 1 ? curve : undefined,
    );
  });
}

/**
 * Key cleanup (ADR-038): every bone rotation, translation and scale timeline of an animation is
 * re-keyed with the fewest whole-frame keys that play within `tolerance` degrees or px (scale:
 * hundredths) of how it plays now, each segment on the named ease (or a fitted key curve) that
 * fits it. Adding key poses over procedural motion, or keying a video frame by frame, can leave a
 * key on almost every frame; an artist keys a few poses. Deform, colour and attachment timelines
 * are left as they are. A tolerance of 0 changes nothing.
 */
export function simplifyAnimation(
  animation: AnimationSpec,
  fps: number,
  tolerance: number,
): AnimationSpec {
  if (!(tolerance > 0)) return animation;
  const out = structuredClone(animation);
  const d = animation.duration;
  for (const t of out.rotationTimelines ?? [])
    t.keys = simplifyKeys(
      t.keys,
      (k) => [k.degrees],
      (time, [degrees], curve) => ({ time, degrees: degrees!, ...(curve ? { curve } : {}) }),
      d,
      fps,
      tolerance,
    );
  for (const [list, scale] of [
    [out.translationTimelines ?? [], tolerance],
    [out.scaleTimelines ?? [], tolerance / 100],
  ] as const)
    for (const t of list)
      t.keys = simplifyKeys(
        t.keys,
        (k) => [k.x, k.y],
        (time, [x, y], curve) => ({ time, x: x!, y: y!, ...(curve ? { curve } : {}) }),
        d,
        fps,
        scale,
      );
  return out;
}
