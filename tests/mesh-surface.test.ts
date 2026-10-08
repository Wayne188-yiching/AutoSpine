import { describe, expect, it } from "vitest";
import { generateSurfaceMesh, generateMesh, validateMeshSpec } from "@autospine/mesh";
import { encodeAlphaMask } from "@autospine/assets";
import type { AssetPart } from "@autospine/schemas";
describe("explicit semantic mesh profiles", () => {
  it("covers a cutout surface once with consistent UVs, retaining source alpha and editable rows", () => {
    const alpha = new Uint8Array(100).fill(255);
    alpha[44] = 0;
    alpha[45] = 0;
    const part: AssetPart = {
      id: "face",
      name: "Face",
      sourcePath: "face.png",
      bounds: { x: -12, y: 7, width: 100, height: 80 },
      drawOrder: 0,
      alphaMask: encodeAlphaMask(10, 10, alpha),
    };
    const snapshot = structuredClone(part),
      mesh = generateSurfaceMesh(part, 4, 3);
    let area = 0;
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const [a, b, c] = mesh.triangles.slice(i, i + 3).map((j) => mesh.vertices[j]!);
      const cross = (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
      expect(cross).toBeGreaterThan(0);
      area += cross / 2;
    }
    expect(area).toBeCloseTo(8000, 8);
    mesh.vertices.forEach(([x, y], i) => {
      expect(mesh.uvs[i]![0]).toBeCloseTo((x + 12) / 100, 9);
      expect(mesh.uvs[i]![1]).toBeCloseTo((y - 7) / 80, 9);
    });
    expect(new Set(mesh.hull).size).toBe(14);
    expect(mesh.manualEdges!.length).toBeGreaterThan(0);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(part).toEqual(snapshot);
    expect(() => generateSurfaceMesh(part, 33, 3)).toThrow(/subdivisions/);
  });
  it("inserts valid image-space feature candidates without moving the silhouette and rejects unbounded input", () => {
    const alpha = new Uint8Array(400).fill(255),
      part: AssetPart = {
        id: "strip",
        name: "Strip",
        sourcePath: "strip.png",
        bounds: { x: 0, y: 0, width: 20, height: 20 },
        drawOrder: 0,
        alphaMask: encodeAlphaMask(20, 20, alpha),
      };
    const mesh = generateMesh(part, alpha, {
      intent: "chain",
      featurePoints: [
        [5.13, 9.21],
        [13.3, 11.4],
      ],
    });
    expect(mesh.vertices).toContainEqual([5.13, 9.21]);
    expect(mesh.vertices).toContainEqual([13.3, 11.4]);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(() => generateMesh(part, alpha, { featurePoints: [[NaN, 1]] })).toThrow();
    expect(() => generateMesh(part, alpha, { featurePoints: [[21, 1]] })).toThrow();
  });
});
