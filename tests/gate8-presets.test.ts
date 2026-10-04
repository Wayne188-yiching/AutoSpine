import { it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AnimationSpecSchema } from "@autospine/schemas";
import { generatePreset, presetNames, validateAnimation } from "@autospine/motion";
import { stripFixture } from "./engine-fixtures.js";

for (const type of presetNames)
  it("Gate 8 numeric preset: " + type, () => {
    const { rig } = stripFixture();
    const options = { type, duration: 2, fps: 60, amplitude: 20, seed: 42 };
    const a = generatePreset(rig, options);
    expect(Value.Check(AnimationSpecSchema, a)).toBe(true);
    expect(a.motions).toEqual([]);
    const channels = [a.rotationTimelines, a.translationTimelines, a.scaleTimelines].filter(
      Boolean,
    );
    expect(channels).toHaveLength(1);
    const serialized = JSON.stringify(a);
    for (let i = 0; i < 100; i++)
      expect(JSON.stringify(generatePreset(rig, options))).toBe(serialized);
    const keys = channels[0]!.at(-1)!.keys as { time: number }[];
    expect(keys[0]!.time).toBe(0);
    expect(keys.at(-1)!.time).toBe(2);
    expect(new Set(keys.map((k) => JSON.stringify({ ...k, time: 0 }))).size).toBeGreaterThan(2);
  });
it("Gate 8 blink responds to seed and squash-stretch preserves area", () => {
  const { rig } = stripFixture(),
    options = { type: "blink" as const, duration: 2, fps: 60, amplitude: 45, seed: 1 };
  expect(generatePreset(rig, options)).not.toEqual(generatePreset(rig, { ...options, seed: 2 }));
  const squash = generatePreset(rig, { ...options, type: "squash-stretch" });
  squash.scaleTimelines![0]!.keys.forEach((k) => expect(k.x * k.y).toBeCloseTo(1, 12));
});
it("Gate 8 rejects unknown presets, nonfinite/unsafe parameters and malformed timeline targets", () => {
  const { rig } = stripFixture();
  for (const patch of [
    { amplitude: NaN },
    { fps: 0 },
    { duration: 11 },
    { seed: -1 },
    { type: "unknown" },
    { unexpected: 1 },
  ])
    expect(() =>
      generatePreset(rig, {
        type: "wave",
        duration: 2,
        fps: 24,
        amplitude: 8,
        ...patch,
      } as Parameters<typeof generatePreset>[1]),
    ).toThrow();
  const bad = generatePreset(rig, { type: "wave", duration: 2, fps: 24, amplitude: 8 });
  bad.rotationTimelines![0]!.boneId = "foreign";
  expect(() => validateAnimation(bad, rig)).toThrow();
});
