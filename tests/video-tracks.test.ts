import { describe, expect, it } from "vitest";
import {
  cyclesIn,
  easeCurve,
  fillGaps,
  foldTracks,
  foldValue,
  keyFraction,
  median3,
  reduceKeys,
  sharedPeriod,
  wholeCycleLength,
} from "@autospine/motion";
import type { KeyposeEase } from "@autospine/schemas";

/** A bounce of `period` frames whose tempo rises by `speedUp` over the clip (a generated clip). */
const bounce = (frames: number, period: number, speedUp: number, height = 10) => {
  let phase = 0;
  return Array.from({ length: frames }, (_, t) => {
    const v = height * Math.sin(2 * Math.PI * phase);
    phase += (1 + (speedUp * t) / frames) / period;
    return v;
  });
};
/** Peak-to-peak height of a fold's first channel. */
const height = (fold: ReturnType<typeof foldTracks>) => {
  let lo = Infinity,
    hi = -Infinity;
  for (let k = 0; k < 200; k++) {
    const v = foldValue(fold, 0, k / 200);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
};
/** A key reduction's value on frame g, as the key pose layer plays it. */
const played = (
  target: readonly number[],
  keys: { frames: number[]; eases: KeyposeEase[] },
  g: number,
  loop: boolean,
) => {
  const f = keys.frames,
    ends = loop ? [...f, target.length - 1] : f;
  const i = ends.findIndex((k, j) => k <= g && g <= (ends[j + 1] ?? k));
  const a = ends[i]!,
    b = ends[i + 1] ?? a;
  if (b === a) return target[a]!;
  const ease = keys.eases[(i + 1) % keys.frames.length]!;
  const curve = typeof ease === "string" ? easeCurve(ease) : ease;
  return target[a]! + (target[b]! - target[a]!) * keyFraction(curve, (g - a) / (b - a));
};

describe("reference-video tracks (ADR-036)", () => {
  it("finds a 5.75-frame bounce in a clip that speeds up and folds it without losing it", () => {
    const y = bounce(96, 5.75, 0.04);
    // A head that follows the bounce, later and smaller.
    const head = y.map((_, t) => 0.6 * (y[t - 2] ?? 0));
    const p = sharedPeriod([y, head]);
    expect(p).not.toBeNull();
    expect(Math.abs(p!.period - 5.75)).toBeLessThan(0.25);
    const fold = foldTracks([y, head], p!.period);
    // A 4 % rise keeps every bounce in step: the fold takes the clip's mean tempo.
    expect(fold.period).toBeGreaterThan(5.55);
    expect(fold.period).toBeLessThan(5.8);
    expect(fold.cycles).toBeGreaterThanOrEqual(14);
    // The folded bounce keeps at least 95 % of its height (folding onto 24 frames kept 5-10 %).
    expect(height(fold) / 20).toBeGreaterThan(0.95);
    // Four bounces of 5.75 make 23 frames within 1 %; 7.5 frames make 15.
    expect(wholeCycleLength(5.75)).toMatchObject({ frames: 23, cycles: 4 });
    expect(wholeCycleLength(7.5)).toMatchObject({ frames: 15, cycles: 2 });
    expect(cyclesIn(24, 5.75)).toEqual({ cycles: 4, stretch: 0.0435 });
  });

  it("folds only the cycles that stay in step when the clip drifts far", () => {
    const y = bounce(144, 8, 0.3);
    const fold = foldTracks([y], sharedPeriod([y])!.period);
    expect(fold.cycles).toBeGreaterThanOrEqual(2);
    expect(fold.cycles).toBeLessThan(Math.floor(143 / 8));
    expect(fold.frames).toBeLessThan(144);
    // The cycles it folds stay in step: the bounce keeps its height; the last cycle comes early.
    expect(height(fold) / 20).toBeGreaterThan(0.9);
    expect(fold.drift).toBeLessThan(0);
  });

  it("shares the stride, not the bob, when a limb swings once per two bobs", () => {
    const n = 120,
      stride = 20;
    const bob = Array.from({ length: n }, (_, t) => 3 * Math.cos((4 * Math.PI * t) / stride));
    const limb = Array.from({ length: n }, (_, t) => 30 * Math.sin((2 * Math.PI * t) / stride));
    expect(sharedPeriod([bob])!.period).toBeCloseTo(10, 0);
    expect(sharedPeriod([bob, limb])!.period).toBeCloseTo(20, 0);
    // Channels that never repeat give no period.
    const drift = Array.from({ length: n }, (_, t) => t * 0.3);
    expect(sharedPeriod([drift])).toBeNull();
  });

  it("ignores frames without a fit and one bad frame", () => {
    const y = bounce(90, 15, 0).map((v, t): number | null => (t % 11 === 5 ? null : v));
    y[40] = 80;
    const fold = foldTracks([y], sharedPeriod([y])!.period);
    expect(Math.abs(fold.period - 15)).toBeLessThan(0.05);
    // Huber weights keep the outlier from pulling the fold.
    expect(Math.abs(foldValue(fold, 0, 0.25) - 10)).toBeLessThan(0.6);
    expect(fillGaps([null, 2, null, 6, null])).toEqual([2, 2, 4, 6, 6]);
    expect(median3([0, 0, 9, 0, 1])).toEqual([0, 0, 0, 1, 1]);
  });

  it("keys three phase-shifted sines within half a unit on shared, sparse key frames", () => {
    const frames = 150,
      period = 150;
    const targets = [0, 1, 2].map((c) =>
      Array.from(
        { length: frames + 1 },
        (_, g) => 12 * Math.sin((2 * Math.PI * g) / period + (c * Math.PI) / 3),
      ),
    );
    const keys = reduceKeys(targets, [0.5, 0.5, 0.5], { loop: true });
    expect(keys.frames[0]).toBe(0);
    expect(keys.capped).toBe(false);
    expect(keys.error).toBeLessThanOrEqual(1);
    expect(keys.frames.length).toBeLessThanOrEqual(frames / 6);
    for (let i = 1; i < keys.frames.length; i++)
      expect(keys.frames[i]! - keys.frames[i - 1]!).toBeGreaterThanOrEqual(2);
    for (const t of targets)
      for (let g = 0; g <= frames; g++)
        expect(Math.abs(played(t, keys, g, true) - t[g]!)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("keeps a one-shot's first and last frames and reports a cap that binds", () => {
    const target = Array.from({ length: 61 }, (_, g) => (g < 20 ? 0 : g < 40 ? 30 : 10));
    const free = reduceKeys([target], [0.5], { loop: false });
    expect(free.frames[0]).toBe(0);
    expect(free.frames.at(-1)).toBe(60);
    const capped = reduceKeys([target], [0.5], { loop: false, maxKeys: 3 });
    expect(capped.capped).toBe(true);
    expect(capped.frames.length).toBe(3);
    expect(capped.error).toBeGreaterThan(1);
  });
});
