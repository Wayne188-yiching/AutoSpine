import { describe, expect, it } from "vitest";
import { encodeAlphaMask } from "@autospine/assets";
import type { AssetPart } from "@autospine/schemas";
import {
  generateMesh,
  MeshError,
  validateMeshSpec,
  type MeshGenerationOptions,
} from "@autospine/mesh";

function fixture(
  width: number,
  height: number,
  filled: (x: number, y: number) => boolean = () => true,
) {
  const alpha = Uint8Array.from({ length: width * height }, (_, i) =>
    filled(i % width, Math.floor(i / width)) ? 255 : 0,
  );
  const part: AssetPart = {
    id: "fixture",
    name: "Fixture",
    sourcePath: "test.png",
    drawOrder: 0,
    bounds: { x: 0, y: 0, width, height },
    alphaMask: encodeAlphaMask(width, height, alpha),
  };
  return { part, alpha };
}
const profile = (family: "strip-spine" | "strip-ladder"): MeshGenerationOptions => ({
  referenceTopology: { vertices: 24, hull: 18, maxAddedFraction: 0, family },
});
function code(action: () => unknown) {
  try {
    action();
    return "NO_ERROR";
  } catch (error) {
    if (error instanceof MeshError) return error.validation.issues[0]!.code;
    throw error;
  }
}

describe("explicit strip structural families", () => {
  for (const [width, height] of [
    [20, 120],
    [120, 20],
  ])
    for (const family of ["strip-spine", "strip-ladder"] as const)
      it(`creates actual structural edges for ${width}x${height} ${family}`, () => {
        const input = fixture(width!, height!);
        const saved = input.alpha.slice();
        const mesh = generateMesh(input.part, input.alpha, profile(family));
        expect(validateMeshSpec(mesh).status).toBe("passed");
        expect(mesh.vertices).toHaveLength(24);
        expect(mesh.hull).toHaveLength(18);
        expect(mesh.triangles).toHaveLength(28 * 3);
        expect(mesh.manualEdges).toHaveLength(family === "strip-spine" ? 7 : 19);
        expect(input.alpha).toEqual(saved);
        expect(Math.min(...mesh.uvs.flat())).toBe(0);
        expect(Math.max(...mesh.uvs.flat())).toBe(1);
      });
  it("keeps 100 identical runs and does not use the name or path as a selector", () => {
    const input = fixture(12, 48),
      options = profile("strip-spine");
    const mesh = generateMesh(input.part, input.alpha, options);
    for (let i = 0; i < 100; i++)
      expect(generateMesh(input.part, input.alpha, options)).toEqual(mesh);
    const renamed = generateMesh(
      { ...input.part, name: "Unrelated", sourcePath: "different.png" },
      input.alpha,
      options,
    );
    expect(renamed.vertices).toEqual(mesh.vertices);
    expect(renamed.triangles).toEqual(mesh.triangles);
    expect(renamed.manualEdges).toEqual(mesh.manualEdges);
  });
  it("transforms strip coordinates into display bounds without changing UVs or topology", () => {
    const input = fixture(20, 80),
      options = profile("strip-ladder");
    const plain = generateMesh(input.part, input.alpha, options);
    const moved = generateMesh(
      { ...input.part, bounds: { x: 13, y: -7, width: 40, height: 40 } },
      input.alpha,
      options,
    );
    expect(moved.uvs).toEqual(plain.uvs);
    expect(moved.triangles).toEqual(plain.triangles);
    expect(moved.manualEdges).toEqual(plain.manualEdges);
    moved.vertices.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(13 + 2 * plain.vertices[i]![0], 10);
      expect(y).toBeCloseTo(-7 + plain.vertices[i]![1] / 2, 10);
    });
    expect(validateMeshSpec(moved).status).toBe("passed");
  });
  it("does not enable structural constraints without explicit family intent", () => {
    const input = fixture(20, 80);
    const mesh = generateMesh(input.part, input.alpha, {
      referenceTopology: { vertices: 24, hull: 18, maxAddedFraction: 0 },
    });
    expect(mesh.manualEdges).toBeUndefined();
  });
  it("rejects invalid family contracts rather than silently falling back", () => {
    const input = fixture(20, 80);
    for (const referenceTopology of [
      { vertices: 24, hull: 18, maxAddedFraction: 0, family: "invented" },
      { vertices: 24, hull: 18, family: "strip-spine" },
      { vertices: 24, hull: 18, maxAddedFraction: 0, family: "strip-spine", bands: [] },
    ])
      expect(
        code(() =>
          generateMesh(input.part, input.alpha, { referenceTopology } as MeshGenerationOptions),
        ),
      ).toBe("MESH_REFERENCE");
    expect(
      code(() =>
        generateMesh(input.part, input.alpha, {
          referenceTopology: { vertices: 50, hull: 26, maxAddedFraction: 1, family: "strip-spine" },
        }),
      ),
    ).toBe("STRIP_PROFILE");
  });
  it("bounds quadratic fitting and rejects too few occupied rows", () => {
    const long = fixture(4, 1025),
      short = fixture(2, 6);
    expect(code(() => generateMesh(long.part, long.alpha, profile("strip-spine")))).toBe(
      "STRIP_COMPLEXITY",
    );
    expect(code(() => generateMesh(short.part, short.alpha, profile("strip-spine")))).toBe(
      "STRIP_TOO_SHORT",
    );
  });
  it("rejects a poor curve fit rather than waiving its pixel budget", () => {
    const input = fixture(
      80,
      240,
      (x, y) => Math.abs(x - 40 - 30 * Math.sin((4 * Math.PI * y) / 240)) < 3,
    );
    expect(
      code(() =>
        generateMesh(input.part, input.alpha, {
          referenceTopology: { vertices: 15, hull: 12, maxAddedFraction: 0, family: "strip-spine" },
        }),
      ),
    ).toBe("STRIP_MISSED_BUDGET");
  });
  it("covers a curved synthetic strip within independently counted pixel budgets", () => {
    const width = 32,
      height = 96;
    const input = fixture(
      width,
      height,
      (x, y) => Math.abs(x - 16 - 6 * Math.sin((2 * Math.PI * y) / height)) < 6,
    );
    const mesh = generateMesh(input.part, input.alpha, {
      referenceTopology: { vertices: 24, hull: 18, maxAddedFraction: 1, family: "strip-ladder" },
    });
    const ring = mesh.hull.map((i) => mesh.vertices[i]!);
    let foreground = 0,
      missed = 0,
      added = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let inside = false;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!;
          if (
            a[1] > y + 0.5 !== b[1] > y + 0.5 &&
            a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]) > x + 0.5
          )
            inside = !inside;
        }
        const filled = input.alpha[y * width + x]! > 0;
        foreground += Number(filled);
        missed += Number(filled && !inside);
        added += Number(!filled && inside);
      }
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(added / foreground).toBeLessThanOrEqual(1);
    expect(mesh.manualEdges).toHaveLength(19);
    expect(validateMeshSpec(mesh).status).toBe("passed");
  });
});
