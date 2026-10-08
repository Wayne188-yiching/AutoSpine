import { describe, expect, it } from "vitest";
import type { AssetPart, MeshSpec, WeightSpec } from "@autospine/schemas";
import { rigFromWorldFrames, type BoneAdjustments } from "@autospine/rig";
import { generateSurfaceMesh } from "@autospine/mesh";
import { skinVertices, solveChainWeights, transferWeights } from "@autospine/weights";
import { stripFixture } from "./engine-fixtures.js";

const rig = rigFromWorldFrames("tail", "Tail", [
  { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "b1", name: "b1", parentId: "root", length: 30, world: [1, 0, 0, 1, 0, 0] },
  { id: "b2", name: "b2", parentId: "b1", length: 30, world: [1, 0, 0, 1, 30, 0] },
  { id: "b3", name: "b3", parentId: "b2", length: 20, world: [1, 0, 0, 1, 60, 0] },
  { id: "other", name: "other", parentId: "root", length: 10, world: [1, 0, 0, 1, 0, 40] },
]);
const { mesh: tail } = stripFixture(16, 3); // x 0..80 every 5 px, y -3..3
const tailWeights = solveChainWeights(tail, rig, ["b1", "b2", "b3"], 8);
const grid = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
) =>
  generateSurfaceMesh(
    {
      id,
      name: id,
      sourcePath: id + ".png",
      bounds: { x, y, width, height },
      drawOrder: 0,
    } as AssetPart,
    cols,
    rows,
  );
const glow = grid("glow", -6, -9, 92, 18, 23, 9); // a halo 6 px beyond the tail on every side
const rigid = (mesh: MeshSpec, boneId: string): WeightSpec => ({
  schemaVersion: "0.1",
  kind: "weights",
  id: mesh.id + "-rigid",
  meshId: mesh.id,
  rigId: rig.id,
  vertices: mesh.vertices.map((_, vertexIndex) => ({
    vertexIndex,
    influences: [{ boneId, weight: 1 }],
  })),
});
/** Where an inside point lies on the posed source surface (containing triangle, barycentric). */
function onSurface(p: [number, number], posed: [number, number][]): [number, number] | undefined {
  for (let t = 0; t < tail.triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => tail.vertices[tail.triangles[t + k]!]!) as [
      number,
      number,
    ][];
    const det = (b![1] - c![1]) * (a![0] - c![0]) + (c![0] - b![0]) * (a![1] - c![1]),
      l1 = ((b![1] - c![1]) * (p[0] - c![0]) + (c![0] - b![0]) * (p[1] - c![1])) / det,
      l2 = ((c![1] - a![1]) * (p[0] - c![0]) + (a![0] - c![0]) * (p[1] - c![1])) / det,
      l3 = 1 - l1 - l2;
    if (Math.min(l1, l2, l3) < -1e-9) continue;
    const [pa, pb, pc] = [0, 1, 2].map((k) => posed[tail.triangles[t + k]!]!);
    return [l1 * pa![0] + l2 * pb![0] + l3 * pc![0], l1 * pa![1] + l2 * pb![1] + l3 * pc![1]];
  }
  return undefined;
}
function surfaceError(
  weights: WeightSpec,
  rotations: Record<string, number>,
  adjustments: BoneAdjustments,
) {
  const posedTail = skinVertices(tail, rig, tailWeights, rotations, adjustments),
    posedGlow = skinVertices(glow, rig, weights, rotations, adjustments);
  let worst = 0,
    inside = 0;
  glow.vertices.forEach((p, i) => {
    const q = onSurface(p, posedTail);
    if (!q) return;
    inside++;
    worst = Math.max(worst, Math.hypot(posedGlow[i]![0] - q[0], posedGlow[i]![1] - q[1]));
  });
  return { worst, inside };
}
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("closest-point weight transfer", () => {
  const transferred = transferWeights(glow, rig, [{ mesh: tail, weights: tailWeights }]);

  it("follows the source surface exactly under bone translation", () => {
    const moved = surfaceError(
      transferred,
      {},
      {
        translations: { b1: [2, -3], b2: [5, 1], b3: [-4, 6] },
      },
    );
    expect(moved.inside).toBeGreaterThan(30);
    expect(moved.worst).toBeLessThan(1e-9);
  });

  it("stays on a bending surface where a rigid glow tears off", () => {
    const bend = { b2: 25, b3: 25 };
    const ours = surfaceError(transferred, bend, {}),
      region = surfaceError(rigid(glow, "b1"), bend, {});
    expect(region.worst).toBeGreaterThan(20);
    expect(ours.worst).toBeLessThan(0.5);
    expect(ours.worst).toBeLessThan(region.worst / 50);
  });

  it("gives outside vertices the weights of the nearest edge point", () => {
    const of = (x: number, y: number) =>
      transferred.vertices[
        glow.vertices.findIndex((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9)
      ]!.influences;
    expect(of(86, 1)).toEqual([{ boneId: "b3", weight: 1 }]); // beyond the tip
    expect(of(-6, -9)).toEqual([{ boneId: "b1", weight: 1 }]); // beyond the root corner
  });

  it("uses the nearest of several sources and respects the influence limit", () => {
    const fin = grid("fin", 0, 37, 20, 6, 4, 2);
    const both = grid("both", -2, -4, 24, 48, 6, 12);
    const w = transferWeights(both, rig, [
      { mesh: tail, weights: tailWeights },
      { mesh: fin, weights: rigid(fin, "other") },
    ]);
    both.vertices.forEach((p, i) => {
      const bones = w.vertices[i]!.influences.map((v) => v.boneId);
      if (p[1] > 30) expect(bones).toEqual(["other"]);
      if (p[1] < 8) expect(bones).not.toContain("other");
    });
    const single = transferWeights(glow, rig, [{ mesh: tail, weights: tailWeights }], 1);
    expect(
      single.vertices.every((v) => v.influences.length === 1 && v.influences[0]!.weight === 1),
    ).toBe(true);
  });

  it("rejects missing sources, bad limits and mismatched source weights", () => {
    expect(code(() => transferWeights(glow, rig, []))).toBe("TRANSFER_INPUT");
    expect(code(() => transferWeights(glow, rig, [{ mesh: tail, weights: tailWeights }], 5))).toBe(
      "TRANSFER_INPUT",
    );
    expect(
      code(() => transferWeights(glow, rig, [{ mesh: tail, weights: rigid(glow, "b1") }])),
    ).toBe("WEIGHT_REFERENCE");
  });
});
