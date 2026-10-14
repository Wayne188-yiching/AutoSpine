import { describe, expect, it } from "vitest";
import {
  loopLag,
  loopPeriod,
  measurePerformance,
  reviewPerformance,
  targetBand,
  type PerformanceProfile,
  type PerformanceSample,
} from "@autospine/planning";

type Vec = [number, number];
const N = 240;
/** A closed loop (N + 1 samples, the last repeating the first) of `cycles` sine breaths. */
const wave = (amp: number, cycles: number, lag: number, x = 0): Vec[] =>
  Array.from({ length: N + 1 }, (_, i) => [
    x,
    amp * Math.sin((2 * Math.PI * cycles * (i - lag)) / N),
  ]);
/** A look: hold, move in 3 frames, hold, move back. */
const looks = (amp: number): Vec[] =>
  Array.from({ length: N + 1 }, (_, i) => {
    const f = i % N,
      t = f < 50 ? 0 : f < 53 ? (f - 50) / 3 : f < 150 ? 1 : f < 153 ? 1 - (f - 150) / 3 : 0;
    return [amp * t, 0];
  });
const sample = (): PerformanceSample => ({
  fps: 30,
  unit: 100,
  yDown: false,
  probes: {
    face: wave(4, 4, 0),
    eyes: wave(5, 4, 1, 0.5),
    pupils: looks(2).map(([x], i) => [x + 0.5, wave(5, 4, 1)[i]![1]] as Vec),
    body: wave(10, 4, 0),
    head: wave(8, 4, 3),
    hair: wave(12, 4, 10),
    hand: wave(14, 4, 2),
  },
});
/** Starts the same closed loop `k` frames later. */
const shifted = (s: PerformanceSample, k: number): PerformanceSample => ({
  ...s,
  probes: Object.fromEntries(
    Object.entries(s.probes).map(([name, t]) => {
      const open = t.slice(0, N);
      const rot = open.map((_, i) => open[(i + k) % N]!);
      return [name, [...rot, rot[0]!]];
    }),
  ),
});
const options = { chain: ["body", "head", "hair"], hand: "hand", loop: true };

describe("phase-invariant loop metrics (ADR-020)", () => {
  it("finds the breath period and the lag within one cycle", () => {
    const body = wave(10, 4, 0).map((p) => p[1]),
      hair = wave(12, 4, 10).map((p) => p[1]);
    expect(loopPeriod(body.slice(0, N))).toBe(60);
    expect(
      loopPeriod(
        wave(10, 1, 0)
          .map((p) => p[1])
          .slice(0, N),
      ),
    ).toBe(N);
    expect(loopPeriod(new Array<number>(N).fill(3))).toBe(N);
    // Four identical cycles: 10 frames, never 10 +- 60.
    expect(loopLag(body.slice(0, N), hair.slice(0, N), 30)).toBe(10);
    expect(loopLag(hair.slice(0, N), body.slice(0, N), 30)).toBe(-10);
    expect(loopLag(body.slice(0, N), new Array<number>(N).fill(1), 30)).toBe(0);
  });

  it("measures ranges and lags instead of peak times and overshoot", () => {
    const m = measurePerformance(sample(), options);
    expect(Object.keys(m).filter((k) => /^(peakTime|peakDelay|overshoot):/.test(k))).toEqual([]);
    expect(m["range:body"]).toBeCloseTo(0.2, 3);
    expect(m["range:hair"]).toBeCloseTo(0.24, 3);
    expect(m["lag:head"]).toBeCloseTo(3 / 30, 6);
    expect(m["lag:hair"]).toBeCloseTo(10 / 30, 6);
    expect(m.handVsBodyRange).toBeGreaterThan(0);
    // Without loop the same sample keeps the one-shot metrics.
    expect(
      measurePerformance(sample(), { ...options, loop: false })["peakTime:body"],
    ).toBeDefined();
  });

  it("gives the same metrics wherever the loop starts", () => {
    const base = measurePerformance(sample(), options);
    for (const k of [7, 13, 33, 101, 239]) {
      const m = measurePerformance(shifted(sample(), k), options);
      expect(Object.keys(m).sort()).toEqual(Object.keys(base).sort());
      for (const [key, v] of Object.entries(base)) expect(m[key]).toBeCloseTo(v, 5);
    }
    // The one-shot peak metrics move with the start; that is what the loop mode removes.
    const oneShot = { ...options, loop: false };
    expect(measurePerformance(shifted(sample(), 13), oneShot)["peakTime:body"]).not.toBeCloseTo(
      measurePerformance(sample(), oneShot)["peakTime:body"]!,
      2,
    );
  });

  it("reviews a loop profile with loop metrics and lag bands of two frames", () => {
    const metrics = measurePerformance(sample(), options);
    const profile: PerformanceProfile = {
      id: "loop-test",
      fps: 30,
      source: "synthetic",
      chain: options.chain,
      hand: "hand",
      loop: true,
      targets: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, targetBand(k, v, 30)]),
      ),
    };
    expect(targetBand("lag:head", 0.1, 30)).toEqual({
      reference: 0.1,
      min: 0.1 - 2 / 30,
      max: 0.1 + 2 / 30,
    });
    const late = shifted(sample(), 41);
    const review = reviewPerformance(late, profile);
    expect(review.within).toBe(review.total);
    // Delaying the hair by 4 more frames breaks only its lag.
    const s = sample();
    s.probes.hair = wave(12, 4, 14);
    const off = reviewPerformance(s, profile).findings.filter((f) => f.status !== "within");
    expect(off.map((f) => [f.metric, f.status, f.hint])).toEqual([
      ["lag:hair", "high", "reduce follow lag"],
    ]);
  });
});
