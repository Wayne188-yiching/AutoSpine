import { describe, expect, it } from "vitest";
import type { AssetPart, MeshSpec, WeightSpec } from "@autospine/schemas";
import { rigFromWorldFrames } from "@autospine/rig";
import { generateSurfaceMesh } from "@autospine/mesh";
import {
  measureDeformation,
  measureOverlapDrift,
  skinVertices,
  solveChainWeights,
} from "@autospine/weights";

const rig = rigFromWorldFrames("arm", "Arm", [
  { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "upper", name: "upper", parentId: "root", length: 50, world: [1, 0, 0, 1, 0, 0] },
  { id: "lower", name: "lower", parentId: "upper", length: 50, world: [1, 0, 0, 1, 50, 0] },
  { id: "hand", name: "hand", parentId: "lower", length: 16, world: [1, 0, 0, 1, 100, 0] },
]);
const grid = (id: string, x0: number, x1: number) =>
  generateSurfaceMesh(
    {
      id,
      name: id,
      sourcePath: id + ".png",
      bounds: { x: x0, y: -6, width: x1 - x0, height: 12 },
      drawOrder: 0,
    } as AssetPart,
    (x1 - x0) / 5,
    4,
  );
// Two separate images overlapping 18 px around the elbow at x = 50, like a sleeve and a forearm.
const upper = grid("upper-img", 0, 60),
  lower = grid("lower-img", 42, 102); // lattices offset by 2 px: pinned points fall inside triangles
const rigid = (mesh: MeshSpec, boneId: string, rigId = rig.id): WeightSpec => ({
  schemaVersion: "0.1",
  kind: "weights",
  id: mesh.id + "-rigid",
  meshId: mesh.id,
  rigId,
  vertices: mesh.vertices.map((_, vertexIndex) => ({
    vertexIndex,
    influences: [{ boneId, weight: 1 }],
  })),
});
const seam = (wu: WeightSpec, wl: WeightSpec, degrees: number) =>
  measureOverlapDrift(
    { mesh: upper, posed: skinVertices(upper, rig, wu, { lower: degrees }) },
    { mesh: lower, posed: skinVertices(lower, rig, wl, { lower: degrees }) },
  );
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("cross-joint limb weights", () => {
  const chain = ["upper", "lower", "hand"],
    widths = [20, 7];

  it("keeps separate limb images joined at a bent elbow when they share one chain field", () => {
    const shared = [
      solveChainWeights(upper, rig, chain, widths),
      solveChainWeights(lower, rig, chain, widths),
    ] as const;
    const split = seam(rigid(upper, "upper"), rigid(lower, "lower"), 40),
      joined = seam(...shared, 40);
    expect(split.points).toBe(joined.points);
    expect(split.points).toBeGreaterThan(20);
    expect(split.maxDrift).toBeGreaterThan(6); // about distance-from-elbow x bend angle
    expect(joined.maxDrift).toBeLessThan(split.maxDrift / 10);
    expect(seam(...shared, 0).maxDrift).toBeLessThan(1e-9);
    for (const [mesh, w] of [
      [upper, shared[0]],
      [lower, shared[1]],
    ] as const)
      expect(
        measureDeformation(mesh, skinVertices(mesh, rig, w, { lower: 40 })).inversionCount,
      ).toBe(0);
  });

  it("accepts one blend width per joint, each bounded by both neighbouring segments", () => {
    expect(code(() => solveChainWeights(upper, rig, chain, 20))).toBe("WEIGHT_CHAIN"); // hand is 16 long
    expect(code(() => solveChainWeights(upper, rig, chain, [20, 9]))).toBe("WEIGHT_CHAIN");
    expect(code(() => solveChainWeights(upper, rig, chain, [20]))).toBe("WEIGHT_CHAIN");
    expect(code(() => solveChainWeights(upper, rig, chain, [20, 0]))).toBe("WEIGHT_CHAIN");
    expect(solveChainWeights(upper, rig, ["upper", "lower"], [12])).toEqual(
      solveChainWeights(upper, rig, ["upper", "lower"], 12),
    );
    const probe = grid("probe", 0, 100),
      w = solveChainWeights(probe, rig, chain, widths);
    const at = (x: number) =>
      Object.fromEntries(
        w.vertices[
          probe.vertices.findIndex((p) => Math.abs(p[0] - x) < 1e-9 && p[1] === -6)
        ]!.influences.map((i) => [i.boneId, i.weight]),
      );
    expect(at(50)).toEqual({ upper: 0.5, lower: 0.5 }); // joint centre
    expect(at(75)).toEqual({ lower: 1 }); // outside both bands
    expect(Object.keys(at(95))).toEqual(["lower", "hand"]); // inside the short wrist band
  });

  it("stays continuous on the inner side of a bent elbow and keeps bent images joined", () => {
    const a = (110 * Math.PI) / 180; // a sharp 70-degree elbow, like the cat's setup arms
    const bent = rigFromWorldFrames("bent", "Bent", [
      { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
      { id: "upper", name: "upper", parentId: "root", length: 50, world: [1, 0, 0, 1, 0, 0] },
      {
        id: "lower",
        name: "lower",
        parentId: "upper",
        length: 50,
        world: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 50, 0],
      },
    ]);
    const box = (id: string, x: number, y: number, w: number, h: number, step: number) =>
      generateSurfaceMesh(
        {
          id,
          name: id,
          sourcePath: id + ".png",
          bounds: { x, y, width: w, height: h },
          drawOrder: 0,
        } as AssetPart,
        w / step,
        h / step,
      );
    // Inner wedge between the two bones, sampled every pixel: nearest-segment projection jumps here.
    const wedge = box("wedge", 20, 0, 30, 30, 1),
      field = solveChainWeights(wedge, bent, ["upper", "lower"], 20);
    const lowerWeight = (i: number) =>
      field.vertices[i]!.influences.find((v) => v.boneId === "lower")?.weight ?? 0;
    let jump = 0;
    for (let j = 0; j <= 30; j++)
      for (let i = 0; i <= 30; i++) {
        const k = j * 31 + i;
        if (i < 30) jump = Math.max(jump, Math.abs(lowerWeight(k) - lowerWeight(k + 1)));
        if (j < 30) jump = Math.max(jump, Math.abs(lowerWeight(k) - lowerWeight(k + 31)));
      }
    expect(jump).toBeLessThanOrEqual((1.5 * 1) / (2 * 20) + 1e-9); // smoothstep slope x 1 px
    const sleeve = box("sleeve", -4, -8, 64, 16, 4),
      forearm = box("forearm", 18, -2, 44, 56, 4); // lattice offset 2 px from the sleeve
    const posed = (mesh: MeshSpec, w: WeightSpec) => skinVertices(mesh, bent, w, { lower: 30 });
    const drift = (ws: WeightSpec, wf: WeightSpec) =>
      measureOverlapDrift(
        { mesh: sleeve, posed: posed(sleeve, ws) },
        { mesh: forearm, posed: posed(forearm, wf) },
      );
    const split = drift(rigid(sleeve, "upper", "bent"), rigid(forearm, "lower", "bent")),
      joined = drift(
        solveChainWeights(sleeve, bent, ["upper", "lower"], 20),
        solveChainWeights(forearm, bent, ["upper", "lower"], 20),
      );
    expect(split.points).toBeGreaterThan(30);
    expect(joined.maxDrift).toBeLessThan(split.maxDrift / 5);
  });

  it("reports overlap drift only where meshes overlap and rejects bad poses", () => {
    const same = measureOverlapDrift(
      { mesh: upper, posed: upper.vertices },
      { mesh: upper, posed: upper.vertices },
    );
    expect(same.points).toBe(2 * upper.vertices.length);
    expect(same.maxDrift).toBe(0);
    const apart = measureOverlapDrift(
      { mesh: grid("a", 0, 20), posed: grid("a", 0, 20).vertices },
      { mesh: grid("b", 30, 50), posed: grid("b", 30, 50).vertices },
    );
    expect(apart).toEqual({ points: 0, maxDrift: 0, meanDrift: 0 });
    expect(
      code(() =>
        measureOverlapDrift(
          { mesh: upper, posed: upper.vertices.slice(1) },
          { mesh: lower, posed: lower.vertices },
        ),
      ),
    ).toBe("DEFORMATION_INPUT");
  });
});
