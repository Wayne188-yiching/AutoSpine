import { describe, expect, it } from "vitest";
import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { encodeAlphaMask } from "@autospine/assets";
import { fitRasterRegion, generateMesh, validateMeshSpec, MeshError } from "@autospine/mesh";

const bounds = { x: 0, y: 0, width: 10, height: 10 };
const source = new Uint8Array(100).fill(255);
const target = Uint8Array.from(source, (_, i) => (i % 10 < 9 ? 255 : 0));
function square(): MeshSpec {
  return {
    schemaVersion: "0.1",
    kind: "mesh",
    id: "test-mesh",
    name: "Test",
    sourcePartId: "test",
    vertices: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ],
    hull: [0, 1, 2, 3],
    triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    manualEdges: [
      [0, 4],
      [2, 4],
    ],
  };
}
function errorCode(action: () => unknown) {
  try {
    action();
    return "NO_ERROR";
  } catch (error) {
    if (error instanceof MeshError) return error.validation.issues[0]!.code;
    throw error;
  }
}
// Independent point-in-ring check, separate from the solver's scanline prefix sums.
function measure(
  mesh: MeshSpec,
  original: Uint8Array,
  selected: Uint8Array,
  displayBounds = bounds,
) {
  const vertices = mesh.vertices.map(([x, y]): [number, number] => [
    ((x - displayBounds.x) * 10) / displayBounds.width,
    ((y - displayBounds.y) * 10) / displayBounds.height,
  ]);
  let missed = 0,
    excluded = 0,
    added = 0,
    foreground = 0;
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      let inside = false;
      for (let j = 0; j < mesh.hull.length; j++) {
        const a = vertices[mesh.hull[j]!]!,
          b = vertices[mesh.hull[(j + 1) % mesh.hull.length]!]!;
        if (
          a[1] > y + 0.5 !== b[1] > y + 0.5 &&
          a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]) > x + 0.5
        )
          inside = !inside;
      }
      const i = y * 10 + x;
      foreground += Number(selected[i]! > 0);
      missed += Number(selected[i]! > 0 && !inside);
      excluded += Number(original[i]! > 0 && selected[i] === 0 && inside);
      added += Number(original[i] === 0 && inside);
    }
  return { missed, excluded, added, foreground };
}

describe("explicit raster region fitting", () => {
  it("removes excluded foreground without changing topology, interiors or inputs", () => {
    const mesh = square(),
      saved = structuredClone(mesh),
      savedSource = source.slice(),
      savedTarget = target.slice();
    const fitted = fitRasterRegion(
      mesh,
      bounds,
      10,
      10,
      { sourceAlpha: source, targetAlpha: target },
      0,
    );
    expect(measure(fitted, source, target)).toEqual({
      missed: 0,
      excluded: 0,
      added: 0,
      foreground: 90,
    });
    expect(validateMeshSpec(fitted).status).toBe("passed");
    expect(fitted.vertices).toHaveLength(mesh.vertices.length);
    expect(fitted.vertices[4]).toEqual(mesh.vertices[4]);
    expect(fitted.triangles).toEqual(mesh.triangles);
    expect(fitted.manualEdges).toEqual(mesh.manualEdges);
    expect(fitted.hull).toEqual(mesh.hull);
    fitted.vertices.forEach(([x, y], i) =>
      expect(Math.hypot(x - mesh.vertices[i]![0], y - mesh.vertices[i]![1])).toBeLessThanOrEqual(
        1.5,
      ),
    );
    expect(mesh).toEqual(saved);
    expect(source).toEqual(savedSource);
    expect(target).toEqual(savedTarget);
  });
  it("keeps 100 deterministic repetitions", () => {
    const run = () =>
      fitRasterRegion(square(), bounds, 10, 10, { sourceAlpha: source, targetAlpha: target }, 0);
    const first = run();
    for (let i = 0; i < 100; i++) expect(run()).toEqual(first);
  });
  it("retains untouched interior coordinates and UVs exactly under fractional transforms", () => {
    const mesh = square(),
      fractional = { x: 13.17, y: -7.19, width: 19.73, height: 5.61 };
    mesh.vertices = mesh.vertices.map(([x, y]) => [
      fractional.x + (x * fractional.width) / 10,
      fractional.y + (y * fractional.height) / 10,
    ]);
    mesh.uvs[4] = [0.500000000001, 0.499999999999];
    const fitted = fitRasterRegion(
      mesh,
      fractional,
      10,
      10,
      { sourceAlpha: source, targetAlpha: target },
      0,
    );
    expect(fitted.vertices[4]).toEqual(mesh.vertices[4]);
    expect(fitted.uvs[4]).toEqual(mesh.uvs[4]);
    expect(fitted.triangles).toEqual(mesh.triangles);
  });
  it.each([5, 7, 26])(
    "checks returned pixel coverage and movement after fractional display conversion (%i)",
    (seed) => {
      const fractional = { x: seed / 13, y: -7.19, width: 10 + seed / 11, height: 10 };
      const mesh = square();
      mesh.vertices = mesh.vertices.map(([x, y]) => [
        fractional.x + (x * fractional.width) / 10,
        fractional.y + (y * fractional.height) / 10,
      ]);
      const fitted = fitRasterRegion(
        mesh,
        fractional,
        10,
        10,
        { sourceAlpha: source, targetAlpha: target },
        0,
      );
      // A mathematically exact 9.5 boundary can return as 9.500000000000002 PNG px.
      const measured = measure(fitted, source, target, fractional);
      expect(measured.excluded).toBe(0);
      expect(measured.missed / measured.foreground).toBeLessThanOrEqual(0.02);
      expect(measured.added).toBe(0);
      fitted.vertices.forEach(([x, y], i) => {
        const [beforeX, beforeY] = mesh.vertices[i]!;
        expect(
          Math.hypot(
            ((x - fractional.x) * 10) / fractional.width -
              ((beforeX - fractional.x) * 10) / fractional.width,
            ((y - fractional.y) * 10) / fractional.height -
              ((beforeY - fractional.y) * 10) / fractional.height,
          ),
        ).toBeLessThanOrEqual(1.5);
      });
      expect(fitted.vertices[4]).toEqual(mesh.vertices[4]);
      expect(fitted.uvs[4]).toEqual(mesh.uvs[4]);
      expect(fitted.hull).toEqual(mesh.hull);
      expect(fitted.triangles).toEqual(mesh.triangles);
      expect(fitted.manualEdges).toEqual(mesh.manualEdges);
      expect(validateMeshSpec(fitted).status).toBe("passed");
    },
  );
  it("preserves display transforms and UVs", () => {
    const mesh = square(),
      movedBounds = { x: 13, y: -7, width: 20, height: 5 };
    const moved = {
      ...mesh,
      vertices: mesh.vertices.map(([x, y]): [number, number] => [13 + 2 * x, -7 + y / 2]),
    };
    const fitted = fitRasterRegion(
      mesh,
      bounds,
      10,
      10,
      { sourceAlpha: source, targetAlpha: target },
      0,
    );
    const shifted = fitRasterRegion(
      moved,
      movedBounds,
      10,
      10,
      { sourceAlpha: source, targetAlpha: target },
      0,
    );
    expect(shifted.uvs).toEqual(fitted.uvs);
    expect(shifted.vertices).toEqual(fitted.vertices.map(([x, y]) => [13 + 2 * x, -7 + y / 2]));
    expect(validateMeshSpec(shifted).status).toBe("passed");
  });
  it("does not confuse permissible transparency with excluded foreground", () => {
    const transparent = Uint8Array.from(source, (_, i) => (i % 10 < 9 ? 255 : 0)),
      mesh = square();
    // The exact same zero-valued target pixels are transparent here, forbidden in the first test.
    expect(
      fitRasterRegion(
        mesh,
        bounds,
        10,
        10,
        { sourceAlpha: transparent, targetAlpha: target },
        10 / 90,
      ),
    ).toBe(mesh);
    const forbidden = fitRasterRegion(
      mesh,
      bounds,
      10,
      10,
      { sourceAlpha: source, targetAlpha: target },
      10 / 90,
    );
    expect(measure(forbidden, source, target).excluded).toBe(0);
  });
  it("does not waive the missed or transparent padding limits", () => {
    const narrow = Uint8Array.from(source, (_, i) => (i % 10 < 5 ? 255 : 0));
    expect(
      errorCode(() =>
        fitRasterRegion(square(), bounds, 10, 10, { sourceAlpha: source, targetAlpha: narrow }, 0),
      ),
    ).toBe("RASTER_REGION_BUDGET");
    expect(
      errorCode(() =>
        fitRasterRegion(square(), bounds, 10, 10, { sourceAlpha: narrow, targetAlpha: narrow }, 0),
      ),
    ).toBe("RASTER_REGION_BUDGET");
    const small = square();
    small.vertices = small.vertices.map(([x, y]) => [x * 0.5, y]);
    small.uvs = small.vertices.map(([x, y]) => [x / 10, y / 10]);
    expect(
      errorCode(() =>
        fitRasterRegion(small, bounds, 10, 10, { sourceAlpha: source, targetAlpha: source }, 0),
      ),
    ).toBe("RASTER_REGION_BUDGET");
  });
  it("validates dimensions, subset, nonempty target, padding and bounds", () => {
    for (const region of [
      { sourceAlpha: new Uint8Array(99), targetAlpha: target },
      { sourceAlpha: source, targetAlpha: new Uint8Array(99) },
      { sourceAlpha: new Uint8Array(100), targetAlpha: target },
      { sourceAlpha: source, targetAlpha: new Uint8Array(100) },
    ])
      expect(errorCode(() => fitRasterRegion(square(), bounds, 10, 10, region, 0))).toBe(
        "RASTER_REGION",
      );
    expect(
      errorCode(() =>
        fitRasterRegion(square(), bounds, 1.5, 10, { sourceAlpha: source, targetAlpha: target }, 0),
      ),
    ).toBe("RASTER_REGION");
    expect(
      errorCode(() =>
        fitRasterRegion(
          square(),
          bounds,
          10,
          10,
          { sourceAlpha: source, targetAlpha: target },
          NaN,
        ),
      ),
    ).toBe("RASTER_REGION");
    expect(
      errorCode(() =>
        fitRasterRegion(
          square(),
          { ...bounds, width: 0 },
          10,
          10,
          { sourceAlpha: source, targetAlpha: target },
          0,
        ),
      ),
    ).toBe("PART_BOUNDS");
  });
  it("bounds a failing large search rather than returning an unchecked mesh", () => {
    const bigSource = new Uint8Array(10 * 65537).fill(255),
      bigTarget = bigSource.slice();
    bigTarget[0] = 0;
    expect(
      errorCode(() =>
        fitRasterRegion(
          square(),
          bounds,
          10,
          65537,
          { sourceAlpha: bigSource, targetAlpha: bigTarget },
          0,
        ),
      ),
    ).toBe("RASTER_REGION_COMPLEXITY");
  });
  it("allows a wide raster when prefix-sum search work stays bounded", () => {
    const wideSource = new Uint8Array(600 * 600).fill(255);
    const wideTarget = Uint8Array.from(wideSource, (_, i) => (i % 600 < 599 ? 255 : 0));
    const mesh = square();
    const fitted = fitRasterRegion(
      mesh,
      bounds,
      600,
      600,
      { sourceAlpha: wideSource, targetAlpha: wideTarget },
      0,
    );
    expect(Math.max(...fitted.vertices.map((p) => p[0] * 60))).toBeLessThanOrEqual(599.5);
    expect(fitted.triangles).toEqual(mesh.triangles);
    expect(fitted.vertices[4]).toEqual(mesh.vertices[4]);
    expect(validateMeshSpec(fitted).status).toBe("passed");
  });
  it("integrates only when requested, including direct generateMesh validation", () => {
    const part: AssetPart = {
      id: "test",
      name: "Test",
      sourcePath: "private.png",
      drawOrder: 0,
      bounds,
      alphaMask: encodeAlphaMask(10, 10, source),
    };
    const referenceTopology = { vertices: 4, hull: 4, maxAddedFraction: 0 };
    const original = generateMesh(part, source, { referenceTopology });
    const constrained = generateMesh(part, source, {
      referenceTopology,
      rasterRegion: { sourceAlpha: source, targetAlpha: target },
    });
    expect(measure(original, source, target).excluded).toBe(10);
    expect(measure(constrained, source, target).excluded).toBe(0);
    expect(constrained.triangles).toEqual(original.triangles);
    expect(
      errorCode(() =>
        generateMesh(part, source, { rasterRegion: { sourceAlpha: source, targetAlpha: target } }),
      ),
    ).toBe("RASTER_REGION");
  });
  it("applies the same region guard to an explicitly generated structural strip", () => {
    const width = 20,
      height = 60,
      alpha = new Uint8Array(width * height).fill(255);
    const selected = Uint8Array.from(alpha, (_, i) => (i % width < width - 1 ? 255 : 0));
    const part: AssetPart = {
      id: "strip",
      name: "Strip",
      sourcePath: "private.png",
      drawOrder: 0,
      bounds: { x: 0, y: 0, width, height },
      alphaMask: encodeAlphaMask(width, height, alpha),
    };
    const referenceTopology = {
      vertices: 24,
      hull: 18,
      maxAddedFraction: 0,
      family: "strip-spine" as const,
    };
    const plain = generateMesh(part, alpha, { referenceTopology });
    const fitted = generateMesh(part, alpha, {
      referenceTopology,
      rasterRegion: { sourceAlpha: alpha, targetAlpha: selected },
    });
    expect(Math.max(...fitted.vertices.map((p) => p[0]))).toBeLessThanOrEqual(19.5);
    expect(fitted.vertices).toHaveLength(24);
    expect(fitted.manualEdges).toEqual(plain.manualEdges);
    expect(fitted.triangles).toEqual(plain.triangles);
    expect(validateMeshSpec(fitted).status).toBe("passed");
  });
});
