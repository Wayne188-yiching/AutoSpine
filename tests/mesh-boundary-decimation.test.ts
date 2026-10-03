import { expect, it } from "vitest";
import type { AssetPart } from "@autospine/schemas";
import { encodeAlphaMask } from "@autospine/assets";
import { generateMesh, validateMeshSpec } from "@autospine/mesh";

it("midpoint fallback reaches five vertices after deletion stalls at six", () => {
  const { part, alpha, options } = fixture(24, 5);
  options.referenceTopology.maxAddedFraction = 0.1;
  const saved = structuredClone({ part, alpha, options });
  const mesh = generateMesh(part, alpha, { ...options, boundaryDecimation: true });
  expect(mesh.vertices).toHaveLength(5);
  expect(mesh.hull).toHaveLength(5);
  expect(validateMeshSpec(mesh).status).toBe("passed");
  expect(generateMesh(part, alpha, { ...options, boundaryDecimation: true })).toEqual(mesh);
  expect({ part, alpha, options }).toEqual(saved);
  const points = mesh.vertices.map(([x, y]) => [
    ((x - part.bounds.x) * 24) / part.bounds.width,
    ((y - part.bounds.y) * 24) / part.bounds.height,
  ]);
  let missed = 0,
    added = 0,
    foreground = 0;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      let inside = false;
      for (let j = 0; j < points.length; j++) {
        const a = points[j]!,
          b = points[(j + 1) % points.length]!;
        if (
          a[1]! > y + 0.5 !== b[1]! > y + 0.5 &&
          x + 0.5 < a[0]! + ((y + 0.5 - a[1]!) * (b[0]! - a[0]!)) / (b[1]! - a[1]!)
        )
          inside = !inside;
      }
      const filled = alpha[y * 24 + x]! > 0;
      foreground += Number(filled);
      missed += Number(filled && !inside);
      added += Number(!filled && inside);
    }
  expect(missed / foreground).toBeLessThanOrEqual(0.02);
  expect(added / foreground).toBeLessThanOrEqual(0.1);
});

function fixture(size = 24, count = 6) {
  const alpha = Uint8Array.from({ length: size * size }, (_, i) =>
    Math.hypot((i % size) + 0.5 - size / 2, Math.floor(i / size) + 0.5 - size / 2) < size * 0.43
      ? 255
      : 0,
  );
  const part: AssetPart = {
    id: "synthetic",
    name: "Synthetic",
    sourcePath: "synthetic.png",
    drawOrder: 0,
    bounds: { x: 17, y: -9, width: size * 1.7, height: size * 0.8 },
    alphaMask: encodeAlphaMask(size, size, alpha),
  };
  const options = {
    referenceTopology: { vertices: count, hull: count, maxAddedFraction: 0.15 },
    rasterRegion: { sourceAlpha: alpha, targetAlpha: alpha },
  };
  return { part, alpha, options };
}

it("reduces a synthetic boundary deterministically without mutating inputs, in arbitrary display bounds", () => {
  const { part, alpha, options } = fixture();
  const saved = structuredClone({ part, alpha, options });
  const baseline = generateMesh(part, alpha, options);
  expect(generateMesh(part, alpha, { ...options, boundaryDecimation: false })).toEqual(baseline);
  const mesh = generateMesh(part, alpha, { ...options, boundaryDecimation: true });
  expect(baseline.vertices.length).toBeGreaterThan(6);
  expect(mesh.vertices).toHaveLength(6);
  expect(mesh.hull).toHaveLength(6);
  expect(validateMeshSpec(mesh).status).toBe("passed");
  expect(generateMesh(part, alpha, { ...options, boundaryDecimation: true })).toEqual(mesh);
  expect({ part, alpha, options }).toEqual(saved);
  // Independent pixel-center point-in-polygon measurement of returned display geometry.
  const points = mesh.vertices.map(([x, y]) => [
    ((x - part.bounds.x) * 24) / part.bounds.width,
    ((y - part.bounds.y) * 24) / part.bounds.height,
  ]);
  let missed = 0,
    added = 0,
    foreground = 0;
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      let inside = false;
      for (let j = 0; j < points.length; j++) {
        const a = points[j]!,
          b = points[(j + 1) % points.length]!;
        if (
          a[1]! > y + 0.5 !== b[1]! > y + 0.5 &&
          x + 0.5 < a[0]! + ((y + 0.5 - a[1]!) * (b[0]! - a[0]!)) / (b[1]! - a[1]!)
        )
          inside = !inside;
      }
      const filled = alpha[y * 24 + x]! > 0;
      foreground += Number(filled);
      missed += Number(filled && !inside);
      added += Number(!filled && inside);
    }
  expect(missed / foreground).toBeLessThanOrEqual(0.02);
  expect(added / foreground).toBeLessThanOrEqual(0.15);
});

it("keeps a valid partial reduction when the requested count is infeasible", () => {
  const { part, alpha, options } = fixture(32, 5);
  const mesh = generateMesh(part, alpha, { ...options, boundaryDecimation: true });
  expect(mesh.vertices.length).toBeGreaterThan(5);
  expect(mesh.vertices.length).toBeLessThan(generateMesh(part, alpha, options).vertices.length);
  expect(validateMeshSpec(mesh).status).toBe("passed");
});

it("preserves interior topology", () => {
  const { part, alpha, options } = fixture();
  options.referenceTopology.vertices = 10;
  const baseline = generateMesh(part, alpha, options);
  expect(baseline.vertices.length).toBeGreaterThan(baseline.hull.length);
  expect(generateMesh(part, alpha, { ...options, boundaryDecimation: true })).toEqual(baseline);
});

it("preserves strip structural edges when boundary decimation is requested", () => {
  const width = 20,
    height = 80;
  const alpha = new Uint8Array(width * height).fill(255);
  const part: AssetPart = {
    id: "strip",
    name: "Strip",
    sourcePath: "synthetic.png",
    drawOrder: 0,
    bounds: { x: 0, y: 0, width, height },
    alphaMask: encodeAlphaMask(width, height, alpha),
  };
  const options = {
    referenceTopology: {
      vertices: 24,
      hull: 18,
      maxAddedFraction: 0,
      family: "strip-ladder" as const,
    },
    rasterRegion: { sourceAlpha: alpha, targetAlpha: alpha },
  };
  const baseline = generateMesh(part, alpha, options);
  expect(baseline.manualEdges).toHaveLength(19);
  expect(generateMesh(part, alpha, { ...options, boundaryDecimation: true })).toEqual(baseline);
});

it("rejects invalid flags and missing prerequisites", () => {
  const { part, alpha, options } = fixture();
  expect(() =>
    generateMesh(part, alpha, { ...options, boundaryDecimation: "yes" as unknown as boolean }),
  ).toThrow("must be boolean");
  expect(() => generateMesh(part, alpha, { boundaryDecimation: true })).toThrow(
    "requires raster region and reference counts",
  );
  expect(() =>
    generateMesh(part, alpha, {
      referenceTopology: options.referenceTopology,
      boundaryDecimation: true,
    }),
  ).toThrow("requires raster region and reference counts");
  expect(() =>
    generateMesh(part, alpha, {
      ...options,
      referenceTopology: { vertices: 6, hull: 6 },
      boundaryDecimation: true,
    }),
  ).toThrow("padding budget");
});
