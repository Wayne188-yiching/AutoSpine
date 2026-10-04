import { it, expect } from "vitest";
import {
  deformationPasses,
  measureDeformation,
  skinVertices,
  solveWeightsV1,
} from "@autospine/weights";
import { evaluateRig, transformPoint } from "@autospine/rig";
import { stripFixture } from "./engine-fixtures.js";

it("Gate 7: three-bone arm passes 0/30/60/90/120 degree elbow regression", () => {
  for (const width of [1, 2, 3]) {
    const { mesh, rig } = stripFixture(18, width);
    const weights = solveWeightsV1(mesh, rig, {
      maxInfluences: 2,
      smoothingPasses: 8,
      smoothingStrength: 0.5,
      candidateRadius: 0,
    });
    for (let angle = 0; angle <= 120; angle++) {
      const pose = { [rig.bones[1]!.id]: angle };
      const vertices = skinVertices(mesh, rig, weights, pose),
        metrics = measureDeformation(mesh, vertices);
      expect(deformationPasses(metrics), JSON.stringify({ width, angle, metrics })).toBe(true);
      const frames = evaluateRig(rig, pose);
      for (let i = 1; i < 3; i++) {
        const tip = transformPoint(frames.get(rig.bones[i - 1]!.id)!, [30, 0]);
        const head = transformPoint(frames.get(rig.bones[i]!.id)!, [0, 0]);
        expect(Math.hypot(tip[0] - head[0], tip[1] - head[1])).toBeLessThan(1e-8);
      }
    }
  }
});
it("Gate 7: successive bend frames have no numeric jumps", () => {
  const { mesh, rig } = stripFixture(18, 2),
    weights = solveWeightsV1(mesh, rig, {
      maxInfluences: 2,
      smoothingPasses: 8,
      smoothingStrength: 0.5,
      candidateRadius: 0,
    });
  for (const angle of [30, 60, 90, 120]) {
    const a = skinVertices(mesh, rig, weights, { [rig.bones[1]!.id]: angle });
    const b = skinVertices(mesh, rig, weights, { [rig.bones[1]!.id]: angle + 1e-5 });
    expect(Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1])))).toBeLessThan(
      1e-4,
    );
  }
});
