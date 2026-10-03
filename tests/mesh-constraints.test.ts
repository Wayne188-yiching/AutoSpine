import { describe, expect, it } from "vitest";
import type { MeshSpec } from "@autospine/schemas";
import { constrainMeshEdges, validateMeshSpec } from "@autospine/mesh";

function square(): MeshSpec {
  return {
    schemaVersion: "0.1",
    kind: "mesh",
    id: "square",
    name: "Square",
    sourcePartId: "square-part",
    vertices: [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    triangles: [0, 1, 2, 0, 2, 3],
    hull: [0, 1, 2, 3],
  };
}

describe("Explicit structural constraints", () => {
  it("recovers the other diagonal without moving points or changing the input", () => {
    const source = square(),
      snapshot = structuredClone(source);
    const mesh = constrainMeshEdges(source, [[1, 3]]);
    expect(mesh.manualEdges).toEqual([[1, 3]]);
    expect(mesh.triangles).toEqual([0, 1, 3, 1, 2, 3]);
    expect(mesh.vertices).toEqual(snapshot.vertices);
    expect(mesh.uvs).toEqual(snapshot.uvs);
    expect(source).toEqual(snapshot);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    for (let i = 0; i < 100; i++)
      expect(JSON.stringify(constrainMeshEdges(source, [[1, 3]]))).toBe(JSON.stringify(mesh));
  });

  it("preserves existing manual edges and rejects crossing requests", () => {
    const mesh = constrainMeshEdges(square(), [[0, 2]]);
    expect(constrainMeshEdges(mesh, [[2, 0]]).manualEdges).toEqual([[0, 2]]);
    expect(() => constrainMeshEdges(mesh, [[1, 3]])).toThrow("cross");
  });
  it("recovers every diagonal of a convex hexagon, including multi-triangle strips", () => {
    const source = square();
    source.vertices = [
      [0, 30],
      [50, 0],
      [100, 30],
      [100, 70],
      [50, 100],
      [0, 70],
    ];
    source.uvs = source.vertices.map(([x, y]) => [x / 100, y / 100]);
    source.hull = [0, 1, 2, 3, 4, 5];
    source.triangles = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
    for (let a = 0; a < 6; a++)
      for (let b = a + 2; b < 6; b++) {
        if (a === 0 && b === 5) continue;
        const result = constrainMeshEdges(source, [[a, b]]);
        expect(result.manualEdges).toEqual([[a, b]]);
        expect(result.vertices).toEqual(source.vertices);
        expect(validateMeshSpec(result).status).toBe("passed");
      }
    const result = constrainMeshEdges(source, [
      [1, 3],
      [1, 4],
      [1, 5],
    ]);
    expect(validateMeshSpec(result).status).toBe("passed");
    expect(result.manualEdges).toHaveLength(3);
  });

  it("splits a structural segment at a shared centre rather than making a T-junction", () => {
    const mesh = square();
    mesh.vertices.push([50, 50]);
    mesh.uvs.push([0.5, 0.5]);
    mesh.triangles = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
    const result = constrainMeshEdges(mesh, [
      [0, 2],
      [1, 3],
    ]);
    expect(result.manualEdges).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
    expect(validateMeshSpec(result).status).toBe("passed");
  });

  it("rejects invalid endpoints, hull labels and labels missing from actual triangles", () => {
    for (const edge of [
      [0, 9],
      [0, 0],
      [0.5, 2],
      [0, 1],
    ])
      expect(() => constrainMeshEdges(square(), [edge as [number, number]])).toThrow();
    for (const manualEdges of [
      [[1, 3]],
      [[0, 1]],
      [[0, 0]],
      [[0, 9]],
      [
        [0, 2],
        [2, 0],
      ],
    ]) {
      const result = validateMeshSpec({ ...square(), manualEdges });
      expect(result.status).toBe("error");
      expect(result.issues.some((i) => i.code.startsWith("MANUAL_EDGE"))).toBe(true);
    }
  });
});
