import { describe, expect, it } from "vitest";
import { classifySpineMeshEdges } from "../tools/spine-edge-classification.mjs";

const square = {
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  hull: 4,
  triangles: [0, 1, 2, 0, 2, 3],
  edges: [0, 2, 2, 4, 4, 6, 6, 0],
};

describe("Spine edit-mesh line classification", () => {
  it("does not mistake a dashed automatic diagonal for an artist-authored line", () => {
    const result = classifySpineMeshEdges(square);
    expect(result.hullEdges).toHaveLength(4);
    expect(result.manualEdges).toEqual([]);
    expect(result.automaticTriangleEdges).toEqual([[0, 2]]);
  });

  it("recognizes an explicitly stored internal diagonal as manual, not dashed", () => {
    const result = classifySpineMeshEdges({ ...square, edges: [...square.edges, 0, 4] });
    expect(result.manualEdges).toEqual([[0, 2]]);
    expect(result.automaticTriangleEdges).toEqual([]);
  });

  it("refuses to infer manual-line absence when nonessential edges were not exported", () => {
    expect(() => classifySpineMeshEdges({ ...square, edges: undefined })).toThrow(
      /nonessential edges export/,
    );
  });

  it("rejects malformed or inconsistent exported connections", () => {
    for (const edges of [
      [0, 2, 2],
      [...square.edges, 1, 4],
      [...square.edges, 2, 6],
    ])
      expect(() => classifySpineMeshEdges({ ...square, edges })).toThrow();
  });
});
