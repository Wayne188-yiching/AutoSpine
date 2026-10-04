import { it, expect } from "vitest";
import { generatePreset, presetNames, sampleAnimation, validateLoop } from "@autospine/motion";
import { stripFixture } from "./engine-fixtures.js";

it("Gate 10 validates all looping presets including 360-degree rotation wrap", () => {
  const { rig } = stripFixture();
  for (const type of presetNames) {
    const a = generatePreset(rig, { type, duration: 2, fps: 60, amplitude: 20, seed: 42 });
    const check = validateLoop(a, rig);
    expect(check.status).toBe(type === "overshoot" ? "not-applicable" : "passed");
    expect(check.score).toBe(0);
  }
});
it("Gate 10 diagnoses translation, rotation, scale and deform targets and stages", () => {
  const { rig, mesh } = stripFixture();
  for (const channel of ["rotation", "translation", "scale", "deform"] as const) {
    const a = generatePreset(rig, { type: "sway", duration: 2, fps: 24, amplitude: 8 });
    if (channel === "rotation") a.rotationTimelines![0]!.keys.at(-1)!.degrees += 5;
    if (channel === "translation")
      a.translationTimelines = [
        {
          boneId: rig.bones[0]!.id,
          keys: [
            { time: 0, x: 0, y: 0 },
            { time: 2, x: 1, y: 0 },
          ],
        },
      ];
    if (channel === "scale")
      a.scaleTimelines = [
        {
          boneId: rig.bones[0]!.id,
          keys: [
            { time: 0, x: 1, y: 1 },
            { time: 2, x: 1, y: 1.1 },
          ],
        },
      ];
    if (channel === "deform")
      a.deformTimelines = [
        {
          meshId: mesh.id,
          keys: [
            { time: 0, offsets: [[0, 0]] },
            { time: 2, offsets: [[1, 0]] },
          ],
        },
      ];
    const check = validateLoop(a, rig);
    expect(check.status).toBe("failed");
    expect(check.issues[0]).toMatchObject({
      stage: "animation",
      targetId: channel === "deform" ? mesh.id : rig.bones[0]!.id,
      channel,
    });
    for (let i = 0; i < 100; i++) expect(validateLoop(a, rig)).toEqual(check);
  }
});
it("Gate 10 samples all channels consistently, rejects malformed spans and invalid time", () => {
  const { rig } = stripFixture(),
    a = generatePreset(rig, { type: "bounce", duration: 2, fps: 24, amplitude: 8 });
  expect(sampleAnimation(a, rig, 0).translations[rig.bones[0]!.id]).toEqual([0, 0]);
  expect(sampleAnimation(a, rig, 0.5).translations[rig.bones[0]!.id]![1]).toBeCloseTo(8, 10);
  for (const t of [-1, 3, NaN]) expect(() => sampleAnimation(a, rig, t)).toThrow();
  a.translationTimelines![0]!.keys.at(-1)!.time = 1;
  expect(() => validateLoop(a, rig)).toThrow();
});
