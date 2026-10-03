import { describe, expect, it } from "vitest";
import { referenceStructureFamily } from "../tools/reference-structure.mjs";
const make = () => ({
  vertices: Array.from({ length: 21 }, () => [0, 0]),
  hull: Array.from({ length: 16 }, (_, i) => i),
  manualEdges: [
    [0, 16],
    [16, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [20, 8],
  ],
});
describe("coarse reference structure conditioning", () => {
  it("returns only a label for a connected spine through every interior vertex", () => {
    const mesh = make(),
      saved = globalThis.structuredClone(mesh);
    expect(referenceStructureFamily(mesh, 37, 177)).toBe("strip-spine");
    expect(mesh).toEqual(saved);
    expect(referenceStructureFamily(mesh, 177, 37)).toBe("strip-spine");
  });
  it("distinguishes a ladder with interior crossbars", () => {
    const mesh = make();
    mesh.manualEdges.push(
      ...[16, 17, 18, 19, 20].flatMap((i, k) => [
        [i, k + 1],
        [i, k + 9],
      ]),
    );
    expect(referenceStructureFamily(mesh, 30, 180)).toBe("strip-ladder");
  });
  it("rejects disconnected cycles, branches, unknown labels and broad patches", () => {
    const disconnected = make();
    disconnected.manualEdges = [
      [0, 8],
      [16, 17],
      [17, 18],
      [18, 19],
      [19, 20],
      [20, 16],
    ];
    expect(referenceStructureFamily(disconnected, 30, 180)).toBeUndefined();
    const branch = make();
    branch.manualEdges.push([18, 4]);
    expect(referenceStructureFamily(branch, 30, 180)).toBeUndefined();
    const unknown = make();
    unknown.manualEdges = null;
    expect(referenceStructureFamily(unknown, 30, 180)).toBeUndefined();
    expect(referenceStructureFamily(make(), 100, 100)).toBeUndefined();
  });
  it("does not propose a family whose count cannot meet the existing budget", () => {
    const mesh = make();
    mesh.vertices.push(...Array.from({ length: 20 }, () => [0, 0]));
    expect(referenceStructureFamily(mesh, 30, 180)).toBeUndefined();
    expect(referenceStructureFamily(make(), 0, 100)).toBeUndefined();
  });
});
