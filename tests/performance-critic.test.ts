import { describe, expect, it } from "vitest";
import type { AnimationSpec } from "@autospine/schemas";
import {
  PERFORMANCE_PROFILES,
  animationKeyStats,
  measurePerformance,
  reviewPerformance,
  targetBand,
  type PerformanceProfile,
  type PerformanceSample,
} from "@autospine/planning";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";

type P = [number, number];
const fps = 30;
/** Face fixed at the origin; eyes jump (2 frames) between looks and hold; pupils follow. */
function lookAround(look: P[], hold: number, move = 2): PerformanceSample {
  const eyes: P[] = [];
  let from: P = [0, 0];
  for (const to of look) {
    for (let i = 1; i <= move; i++)
      eyes.push([
        from[0] + ((to[0] - from[0]) * i) / move,
        from[1] + ((to[1] - from[1]) * i) / move,
      ]);
    for (let i = 0; i < hold; i++) eyes.push([...to]);
    from = to;
  }
  eyes.unshift([0, 0]);
  return {
    fps,
    unit: 100,
    yDown: true,
    probes: {
      face: eyes.map((): P => [0, 0]),
      eyes,
      pupils: eyes.map(([x, y]): P => [x * 1.5, y * 1.5]),
    },
  };
}
/** Baked sine look: no holds, smooth speed. */
function sineLook(frames: number): PerformanceSample {
  const eyes = Array.from({ length: frames + 1 }, (_, i): P => [
    3 * Math.sin((2 * Math.PI * i) / frames),
    2 * Math.sin((4 * Math.PI * i) / frames),
  ]);
  return {
    fps,
    unit: 100,
    yDown: true,
    probes: {
      face: eyes.map((): P => [0, 0]),
      eyes,
      pupils: eyes.map(([x, y]): P => [x * 1.2, y * 1.2]),
    },
  };
}
/** One-shot rise (y down): each probe peaks at its own frame, then settles to 0. */
function entrance(peaks: Record<string, [number, number]>, frames = 31): PerformanceSample {
  const probes: Record<string, P[]> = {};
  for (const [name, [frame, height]] of Object.entries(peaks))
    probes[name] = Array.from({ length: frames }, (_, i): P => {
      const h = i <= frame ? (height * i) / frame : height * Math.max(0, 1 - (i - frame) / 6);
      return [0, -h * 100];
    });
  return { fps, unit: 100, yDown: true, probes };
}

describe("P2-h performance metrics", () => {
  it("measures parallax, pupil range, holds and saccade speed from probes", () => {
    const sample = lookAround(
      [
        [6, 0],
        [-2, 5],
        [0, 0],
      ],
      8,
    );
    const m = measurePerformance(sample);
    expect(m.parallaxRangeX).toBeCloseTo(0.08, 9);
    expect(m.parallaxRangeY).toBeCloseTo(0.05, 9);
    // 30 speeds: 6 moving frames, 24 holds.
    expect(m.parallaxHoldFraction).toBeCloseTo(24 / 30, 6);
    expect(m.pupilHoldFraction).toBeCloseTo(24 / 30, 6);
    expect(m.pupilRange).toBeCloseTo(0.03, 9); // pupil offset = half the eye travel, in units
    expect(m.pupilPeakToMeanSpeed).toBeGreaterThan(4);
    // A baked sine never holds and has a flat speed profile.
    const s = measurePerformance(sineLook(120));
    expect(s.parallaxHoldFraction).toBeLessThan(0.15);
    expect(s.pupilPeakToMeanSpeed).toBeLessThan(2);
  });

  it("measures delay-chain peak times, overshoot and hand range independent of y direction", () => {
    const sample = entrance({
      body: [10, 0.04],
      head: [13, 0.05],
      hand_l: [10, 0.3],
      tail: [15, 0.1],
    });
    const options = { chain: ["body", "head", "hand_l", "tail"], hand: "hand_l" };
    const m = measurePerformance(sample, options);
    expect(m["peakTime:body"]).toBeCloseTo(10 / 30, 6);
    expect(m["peakDelay:head"]).toBeCloseTo(3 / 30, 6);
    expect(m["peakDelay:hand_l"]).toBe(0);
    expect(m["peakDelay:tail"]).toBeCloseTo(5 / 30, 6);
    expect(m["overshoot:head"]).toBeCloseTo(0.05, 6);
    expect(m.handVsBodyRange).toBeGreaterThan(0.2);
    const flipped: PerformanceSample = {
      ...sample,
      yDown: false,
      probes: Object.fromEntries(
        Object.entries(sample.probes).map(([k, t]) => [k, t.map(([x, y]): P => [x, -y])]),
      ),
    };
    expect(measurePerformance(flipped, options)).toEqual(m);
  });

  it("counts key density on moving timelines only", () => {
    const animation: AnimationSpec = {
      schemaVersion: "0.1",
      kind: "animation",
      id: "a",
      name: "a",
      rigId: "r",
      duration: 2,
      loop: true,
      motions: [],
      rotationTimelines: [
        {
          boneId: "moving",
          keys: [
            { time: 0, degrees: 0 },
            { time: 1, degrees: 5 },
            { time: 2, degrees: 0 },
          ],
        },
        { boneId: "static", keys: [0, 0.5, 1, 1.5, 2].map((time) => ({ time, degrees: 3 })) },
      ],
      translationTimelines: [
        {
          boneId: "moving",
          keys: [
            { time: 0, x: 0, y: 0 },
            { time: 2, x: 0, y: 4 },
          ],
        },
      ],
    };
    const stats = animationKeyStats(animation);
    expect(stats).toEqual({ keys: 5, timelines: 2, duration: 2 });
    expect(measurePerformance(sineLook(10), {}, stats).keyDensity).toBe(1.25);
  });

  it("rejects mismatched probe lengths, unknown chain probes and nonpositive units", () => {
    const sample = lookAround([[3, 0]], 4);
    expect(() =>
      measurePerformance({
        ...sample,
        probes: {
          ...sample.probes,
          pupils: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
      }),
    ).toThrow(/one point per sampled frame/);
    expect(() => measurePerformance(sample, { chain: ["body"] })).toThrow(/Chain\/hand/);
    expect(() => measurePerformance({ ...sample, unit: 0 })).toThrow(/Valid performance sample/);
  });
});

describe("P2-h critic review against artist-statistics targets", () => {
  const custom: PerformanceProfile = {
    id: "custom",
    fps: 30,
    source: "test",
    targets: {
      parallaxRangeX: targetBand("parallaxRangeX", 0.08, 30),
      parallaxHoldFraction: targetBand("parallaxHoldFraction", 0.5, 30),
      pupilRange: targetBand("pupilRange", 0.3, 30),
      keyDensity: targetBand("keyDensity", 3, 30),
    },
  };
  it("reports within / low / high / missing with directional hints", () => {
    const review = reviewPerformance(
      lookAround(
        [
          [6, 0],
          [-2, 5],
          [0, 0],
        ],
        8,
      ),
      custom,
    );
    const status = Object.fromEntries(review.findings.map((f) => [f.metric, f.status]));
    expect(status).toEqual({
      parallaxRangeX: "within",
      parallaxHoldFraction: "high",
      pupilRange: "low",
      keyDensity: "missing",
    });
    expect(review.findings.find((f) => f.metric === "pupilRange")!.hint).toBe(
      "increase saccade gain",
    );
    expect(review.within).toBe(1);
    expect(review.artistQualityAccepted).toBe(false);
  });

  it("uses uncalibrated bands: fractions +-0.15, peak delays +-2 frames, magnitudes x/÷1.5", () => {
    expect(targetBand("pupilHoldFraction", 0.9, 30)).toEqual({ reference: 0.9, min: 0.75, max: 1 });
    expect(targetBand("peakDelay:head", 0.1, 30).max).toBeCloseTo(0.1 + 2 / 30, 12);
    expect(targetBand("keyDensity", 3, 30)).toEqual({ reference: 3, min: 2, max: 4.5 });
    for (const p of Object.values(PERFORMANCE_PROFILES))
      for (const t of Object.values(p.targets))
        expect(t.min <= t.reference && t.reference <= t.max).toBe(true);
    expect(PERFORMANCE_PROFILES.entrance!.chain![0]).toBe("body");
  });

  it("separates a hold-and-saccade look from a baked sine on the look-around profile", () => {
    const held = reviewPerformance(
      lookAround(
        [
          [3, 0],
          [-3, 3],
          [2, 4],
          [0, 0],
        ],
        4,
        3,
      ),
      "look-around",
      { keys: 24, timelines: 2, duration: 4 },
    );
    const baked = reviewPerformance(sineLook(120), "look-around", {
      keys: 242,
      timelines: 2,
      duration: 4,
    });
    const fails = (r: typeof held, m: string) =>
      r.findings.find((f) => f.metric === m)!.status !== "within";
    expect(fails(baked, "parallaxHoldFraction")).toBe(true);
    expect(fails(baked, "pupilPeakToMeanSpeed")).toBe(true);
    expect(fails(baked, "keyDensity")).toBe(true);
    expect(fails(held, "parallaxHoldFraction")).toBe(false);
    expect(fails(held, "keyDensity")).toBe(false);
    expect(held.within).toBeGreaterThan(baked.within);
  });

  it("rejects a sample at another frame rate and an inconsistent profile", () => {
    expect(() => reviewPerformance({ ...sineLook(60), fps: 15 }, "look-around")).toThrow(/30 fps/);
    expect(() => reviewPerformance(sineLook(60), "unknown")).toThrow(/Known profile/);
    expect(() =>
      reviewPerformance(sineLook(60), {
        ...custom,
        targets: { keyDensity: { reference: 3, min: 4, max: 5 } },
      }),
    ).toThrow(/min <= reference/);
  });

  it("is reachable as a read-only MCP tool", async () => {
    const tool = mcpTools.find((t) => t.name === "autospine_review_performance")!;
    expect(tool.annotations.readOnlyHint).toBe(true);
    const server = new AutoSpineMcpServer(process.cwd());
    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    const reply = (await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "autospine_review_performance",
        arguments: JSON.parse(JSON.stringify({ sample: sineLook(60), profile: "look-around" })),
      },
    })) as { result: { isError?: boolean; structuredContent: { total: number; profile: string } } };
    expect(reply.result.isError).not.toBe(true);
    expect(reply.result.structuredContent).toMatchObject({ profile: "look-around", total: 7 });
  });
});
