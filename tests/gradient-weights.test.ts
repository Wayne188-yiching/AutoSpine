import { describe, expect, it } from "vitest";
import type { AssetPart, WeightSpec } from "@autospine/schemas";
import { rigFromWorldFrames } from "@autospine/rig";
import { generateSurfaceMesh } from "@autospine/mesh";
import { measureDeformation, skinVertices, solveGradientWeights } from "@autospine/weights";

// An eyelid: top edge bone at y = 0, bottom edge bone 40 px below (image space, +y down).
const rig = rigFromWorldFrames("lid", "Lid", [
  { id: "eye", name: "eye", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "top", name: "top", parentId: "eye", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "bottom", name: "bottom", parentId: "top", length: 0, world: [1, 0, 0, 1, 0, 40] },
  { id: "same", name: "same", parentId: "eye", length: 0, world: [1, 0, 0, 1, 0, 0] },
]);
const lid = generateSurfaceMesh(
  {
    id: "lid",
    name: "lid",
    sourcePath: "lid.png",
    bounds: { x: -30, y: 0, width: 60, height: 40 },
    drawOrder: 0,
  } as AssetPart,
  12,
  16,
);
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("linear two-bone gradient (eyelids)", () => {
  const weights = solveGradientWeights(lid, rig, "top", "bottom");
  const bottomWeight = (y: number) =>
    weights.vertices[
      lid.vertices.findIndex((p) => p[0] === 0 && Math.abs(p[1] - y) < 1e-9)
    ]!.influences.find((i) => i.boneId === "bottom")?.weight ?? 0;

  it("ramps linearly from the top bone to the bottom bone", () => {
    expect(bottomWeight(0)).toBe(0);
    expect(bottomWeight(10)).toBeCloseTo(0.25, 12);
    expect(bottomWeight(20)).toBeCloseTo(0.5, 12);
    expect(bottomWeight(40)).toBe(1);
  });

  it("collapses uniformly without folding, where a smoothstep profile folds", () => {
    const collapse = { translations: { bottom: [0, -36] as [number, number] } }; // 90 % closed
    const linear = measureDeformation(lid, skinVertices(lid, rig, weights, {}, collapse));
    expect(linear.inversionCount).toBe(0);
    expect(linear.minAreaRatio).toBeCloseTo(0.1, 9);
    const smooth: WeightSpec = {
      ...weights,
      id: "lid-smooth",
      vertices: lid.vertices.map((p, vertexIndex) => {
        const t = Math.min(1, Math.max(0, p[1] / 40)),
          s = t * t * (3 - 2 * t);
        return {
          vertexIndex,
          influences: [
            { boneId: "top", weight: 1 - s },
            { boneId: "bottom", weight: s },
          ].filter((i) => i.weight > 0),
        };
      }),
    };
    expect(
      measureDeformation(lid, skinVertices(lid, rig, smooth, {}, collapse)).inversionCount,
    ).toBeGreaterThan(0);
  });

  it("rejects identical, missing or coincident bones", () => {
    expect(code(() => solveGradientWeights(lid, rig, "top", "top"))).toBe("GRADIENT_BONES");
    expect(code(() => solveGradientWeights(lid, rig, "top", "nope"))).toBe("GRADIENT_BONES");
    expect(code(() => solveGradientWeights(lid, rig, "top", "same"))).toBe("GRADIENT_BONES");
  });
});
