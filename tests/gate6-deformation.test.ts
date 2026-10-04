import { it, expect } from "vitest";
import { stripFixture } from "./engine-fixtures.js";
import {
  deformationPasses,
  measureDeformation,
  skinVertices,
  solveWeightsV1,
} from "@autospine/weights";
import { generateWave, rotationsAt } from "@autospine/motion";

it("Gate 6: root, middle and sampled wave pass the predeclared engineering limits", () => {
  for (const width of [1, 2, 3]) {
    const { mesh, rig } = stripFixture(18, width),
      weights = solveWeightsV1(mesh, rig, { maxInfluences: 2, smoothingPasses: 1 });
    const poses = [{}, { [rig.bones[0]!.id]: 45 }, { [rig.bones[1]!.id]: 30 }];
    const wave = generateWave(rig, { duration: 2, fps: 24, amplitudeDegrees: 8, phaseDegrees: 45 });
    for (let i = 0; i <= 48; i++) poses.push(rotationsAt(wave, i / 24));
    for (const pose of poses) {
      const m = measureDeformation(mesh, skinVertices(mesh, rig, weights, pose));
      expect(deformationPasses(m), JSON.stringify(m)).toBe(true);
    }
  }
});
it("Gate 6: evaluator catches inversion, collapse, stretch and actual seam separation", () => {
  const { mesh } = stripFixture();
  expect(
    deformationPasses(
      measureDeformation(
        mesh,
        mesh.vertices.map((p) => [p[0], -p[1]]),
      ),
    ),
  ).toBe(false);
  expect(
    deformationPasses(
      measureDeformation(
        mesh,
        mesh.vertices.map((p) => [p[0], p[1] * 0.1]),
      ),
    ),
  ).toBe(false);
  expect(
    deformationPasses(
      measureDeformation(
        mesh,
        mesh.vertices.map((p) => [p[0] * 3, p[1]]),
      ),
    ),
  ).toBe(false);
  const seamMesh = { ...mesh, vertices: [...mesh.vertices, mesh.vertices[0]!] };
  const posed = [
    ...mesh.vertices,
    [mesh.vertices[0]![0] + 1, mesh.vertices[0]![1]] as [number, number],
  ];
  expect(measureDeformation(seamMesh, posed, [[0, posed.length - 1]]).maxSeamGap).toBe(1);
  expect(() => measureDeformation(mesh, [])).toThrow();
});
it("Gate 6: metrics have fixed units and repeatable baseline", () => {
  const { mesh } = stripFixture();
  const baseline = measureDeformation(mesh, mesh.vertices);
  expect(baseline).toEqual({
    inversionCount: 0,
    minAreaRatio: 1,
    maxEdgeStretch: 1,
    maxSeamGap: 0,
  });
  for (let i = 0; i < 100; i++) expect(measureDeformation(mesh, mesh.vertices)).toEqual(baseline);
});
