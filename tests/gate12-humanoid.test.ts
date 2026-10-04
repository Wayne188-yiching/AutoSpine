import { it, expect } from "vitest";
import { generateHumanoidRig, evaluateRig, orderBones, transformPoint } from "@autospine/rig";
import { solveWeightsV1, skinVertices } from "@autospine/weights";
import { generatePreset } from "@autospine/motion";
import { compileWeightedSpine40 } from "@autospine/spine";
import type { AssetSpec } from "@autospine/schemas";
import { RigSpecSchema } from "@autospine/schemas";
import { Value } from "@sinclair/typebox/value";
import { stripFixture } from "./engine-fixtures.js";

const input = {
  id: "humanoid",
  name: "Basic T-pose",
  origin: [45, 50] as [number, number],
  height: 100,
  shoulderWidth: 30,
};
it("Gate 12 explicit basic template has parent-first hierarchy and mirrored limbs", () => {
  const rig = generateHumanoidRig(input);
  expect(Value.Check(RigSpecSchema, rig)).toBe(true);
  expect(rig.bones).toHaveLength(18);
  expect(orderBones(rig.bones)).toEqual(rig.bones);
  expect(rig.bones.map((b) => b.name).join(" ")).not.toMatch(/finger|eye|clothes/);
  const frames = evaluateRig(rig);
  for (const key of ["upper_arm", "forearm", "hand", "thigh", "shin", "foot"]) {
    const l = transformPoint(frames.get(input.id + "-" + key + "_L")!, [0, 0]),
      r = transformPoint(frames.get(input.id + "-" + key + "_R")!, [0, 0]);
    expect(l[0] + r[0]).toBeCloseTo(input.origin[0] * 2, 10);
    expect(l[1]).toBeCloseTo(r[1], 10);
  }
  for (let i = 0; i < 100; i++) expect(generateHumanoidRig(input)).toEqual(rig);
});
it("Gate 12 template integrates with weights, presets and weighted Spine adapter", () => {
  const rig = generateHumanoidRig(input),
    { mesh } = stripFixture(),
    weights = solveWeightsV1(mesh, rig);
  const asset: AssetSpec = {
    schemaVersion: "0.1",
    kind: "asset",
    id: "fixture",
    name: "Synthetic strip",
    source: { type: "png-parts", path: "synthetic.png" },
    width: 80,
    height: 6,
    parts: [
      {
        id: mesh.sourcePartId,
        name: "Strip",
        sourcePath: "synthetic.png",
        bounds: { x: 0, y: -3, width: 80, height: 6 },
        drawOrder: 0,
      },
    ],
  };
  const animation = generatePreset(rig, { type: "sway", duration: 2, fps: 24, amplitude: 5 });
  const doc = compileWeightedSpine40({
    asset,
    mesh,
    rig,
    weights,
    animation,
    imagesPath: "./images/",
  });
  expect(doc.bones).toHaveLength(18);
  expect(doc.animations.sway).toBeDefined();
  const restored = skinVertices(mesh, rig, weights);
  restored.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(mesh.vertices[i]![0], 10);
    expect(p[1]).toBeCloseTo(mesh.vertices[i]![1], 10);
  });
});
it("Gate 12 invalid dimensions and origins fail before generating a rig", () => {
  for (const patch of [
    { height: 0 },
    { height: Infinity },
    { shoulderWidth: 101 },
    { origin: [NaN, 0] },
    { extra: true },
  ])
    expect(() => generateHumanoidRig({ ...input, ...patch } as typeof input)).toThrow();
});
