import { describe, it, expect } from "vitest";
import { solveWeightsV1, validateWeights, skinVertices } from "@autospine/weights";
import { stripFixture } from "./engine-fixtures.js";

describe("Gate 5 weight solver v1", () => {
  const { mesh, rig } = stripFixture();
  it("normalizes every vertex, limits top K and preserves setup", () => {
    for (const k of [1, 2, 3, 4]) {
      const weights = solveWeightsV1(mesh, rig, { maxInfluences: k, smoothingPasses: 3 });
      weights.vertices.forEach((v) => {
        expect(v.influences.length).toBeLessThanOrEqual(k);
        expect(v.influences.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 12);
      });
      skinVertices(mesh, rig, weights).forEach((p, i) => {
        expect(p[0]).toBeCloseTo(mesh.vertices[i]![0], 10);
        expect(p[1]).toBeCloseTo(mesh.vertices[i]![1], 10);
      });
    }
  });
  it("radius misses and disconnected vertices receive a nearest bone", () => {
    const far = {
      ...mesh,
      vertices: mesh.vertices.map((p) => [p[0], p[1] + 1000] as [number, number]),
    };
    const weights = solveWeightsV1(far, rig, { candidateRadius: 0, smoothingPasses: 0 });
    expect(
      weights.vertices.every((v) => v.influences.length === 1 && v.influences[0]!.weight === 1),
    ).toBe(true);
    expect(solveWeightsV1({ ...mesh, triangles: [0, 2, 1] }, rig).vertices).toHaveLength(
      mesh.vertices.length,
    );
  });
  it("rejects negative, NaN, over-four, foreign and missing weights", () => {
    for (const change of ["negative", "nan", "foreign", "missing", "over-four"]) {
      const weights = solveWeightsV1(mesh, rig);
      if (change === "missing") weights.vertices.pop();
      else if (change === "over-four")
        weights.vertices[0]!.influences = Array.from({ length: 5 }, (_, i) => ({
          boneId: "bad" + i,
          weight: 0.2,
        }));
      else if (change === "foreign") weights.vertices[0]!.influences[0]!.boneId = "missing";
      else weights.vertices[0]!.influences[0]!.weight = change === "nan" ? NaN : -1;
      expect(() => validateWeights(mesh, rig, weights)).toThrow();
    }
  });
  it("smooths neighboring weights simultaneously, deterministically without mutating inputs", () => {
    const before = JSON.stringify({ mesh, rig });
    const plain = solveWeightsV1(mesh, rig, { smoothingPasses: 0 });
    const smooth = solveWeightsV1(mesh, rig, { smoothingPasses: 2 });
    expect(smooth).not.toEqual(plain);
    for (let i = 0; i < 100; i++)
      expect(solveWeightsV1(mesh, rig, { smoothingPasses: 2 })).toEqual(smooth);
    expect(JSON.stringify({ mesh, rig })).toBe(before);
  });
  it("rejects impossible topology, no deform bones and out of range options", () => {
    expect(() => solveWeightsV1({ ...mesh, triangles: [0, 1, 900] }, rig)).toThrow();
    expect(() =>
      solveWeightsV1(mesh, { ...rig, bones: rig.bones.map((b) => ({ ...b, length: 0 })) }),
    ).toThrow();
    for (const options of [
      { maxInfluences: 5 },
      { smoothingPasses: 9 },
      { smoothingStrength: NaN },
      { candidateRadius: -1 },
    ])
      expect(() => solveWeightsV1(mesh, rig, options)).toThrow();
  });
});
