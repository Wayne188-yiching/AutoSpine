import { describe, expect, it } from "vitest";
import type { MeshSpec } from "@autospine/schemas";
import {
  deformationPasses,
  deformationPassesWithVisibility,
  engineeringInversionTolerances,
  invertedTriangleIndices,
  measureDeformation,
  measureVisibleInversions,
  resolveInversionTolerance,
  strictInversionTolerance,
  visibleInversionsPass,
  type AlphaSurface,
  type InversionToleranceContract,
} from "@autospine/weights";

const WIDTH = 32,
  HEIGHT = 32;
const bounds = { x: 0, y: 0, width: WIDTH, height: HEIGHT }; // one world unit per pixel
// Left half opaque, right half transparent: 512 opaque pixels.
const halfOpaque = () => {
  const alpha = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < 16; x++) alpha[y * WIDTH + x] = 255;
  return alpha;
};
const surface = (): AlphaSurface => ({ width: WIDTH, height: HEIGHT, bounds, alpha: halfOpaque() });

// Triangle 0 is a large opaque fold, triangle 1 sits in the transparent half, triangle 2 is tiny.
const vertices: [number, number][] = [
  [2, 4],
  [12, 4],
  [7, 14],
  [20, 4],
  [28, 4],
  [24, 12],
  [2, 20],
  [4, 20],
  [3, 22],
];
const mesh: MeshSpec = {
  schemaVersion: "0.1",
  kind: "mesh",
  id: "visibility-mesh",
  name: "Visibility mesh",
  sourcePartId: "visibility-part",
  vertices,
  uvs: vertices.map((p) => [p[0] / WIDTH, p[1] / HEIGHT]),
  triangles: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  hull: [0, 1, 2],
};
/** Swapping two corners of one triangle flips its winding without moving any pixel it covers,
 * so the inverted coverage equals the triangle's own area exactly. */
const flip = (...triangles: number[]): [number, number][] => {
  const posed = vertices.map((p) => [...p] as [number, number]);
  for (const t of triangles) {
    const [a, b] = [mesh.triangles[t * 3]!, mesh.triangles[t * 3 + 1]!];
    [posed[a], posed[b]] = [posed[b]!, posed[a]!];
  }
  return posed;
};
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("visibility-aware inversion gate", () => {
  it("reports no inversion and passes every tolerance on the bind pose", () => {
    const metrics = measureVisibleInversions(mesh, vertices, surface());
    expect(metrics).toEqual({
      invertedTriangles: 0,
      visibleInvertedTriangles: 0,
      visibleInvertedPixels: 0,
      opaquePixels: 512,
      minAbsAreaRatio: 1,
      visibleAreaRatio: 0,
      maxTriangleAreaRatio: 0,
      triangles: [],
    });
    expect(visibleInversionsPass(metrics, strictInversionTolerance)).toBe(true);
    expect(
      deformationPassesWithVisibility(
        measureDeformation(mesh, vertices),
        metrics,
        strictInversionTolerance,
      ),
    ).toBe(true);
  });

  it("treats a fold over fully transparent pixels as invisible", () => {
    const posed = flip(1);
    expect(invertedTriangleIndices(mesh, posed)).toEqual([1]);
    expect(measureDeformation(mesh, posed).inversionCount).toBe(1);
    const metrics = measureVisibleInversions(mesh, posed, surface());
    expect(metrics.invertedTriangles).toBe(1);
    expect(metrics.visibleInvertedTriangles).toBe(0);
    expect(metrics.visibleInvertedPixels).toBe(0);
    expect(metrics.triangles).toEqual([
      { triangle: 1, visiblePixels: 0, areaRatio: 0, visible: false },
    ]);
    // The old global rule rejects this pose; the visibility rule accepts it.
    expect(deformationPasses(measureDeformation(mesh, posed))).toBe(false);
    expect(visibleInversionsPass(metrics, strictInversionTolerance)).toBe(true);
    expect(
      deformationPassesWithVisibility(
        measureDeformation(mesh, posed),
        metrics,
        strictInversionTolerance,
      ),
    ).toBe(true);
  });

  it("fails a fold that paints a large share of the opaque pixels", () => {
    const posed = flip(0);
    const metrics = measureVisibleInversions(mesh, posed, surface());
    expect(metrics.visibleInvertedTriangles).toBe(1);
    expect(metrics.visibleInvertedPixels).toBeGreaterThan(40);
    expect(metrics.visibleInvertedPixels).toBeLessThan(60);
    expect(metrics.visibleAreaRatio).toBeGreaterThan(0.08);
    expect(metrics.maxTriangleAreaRatio).toBe(metrics.visibleAreaRatio);
    expect(visibleInversionsPass(metrics, strictInversionTolerance)).toBe(false);
    expect(visibleInversionsPass(metrics)).toBe(false);
  });

  it("tolerates a sub-threshold fold while rejecting a large one at the same budget", () => {
    const tolerance = {
      maxVisibleAreaRatio: 0.005,
      maxSingleTriangleRatio: 0.005,
      maxVisibleTriangles: 8,
    };
    const tiny = measureVisibleInversions(mesh, flip(2), surface());
    expect(tiny.visibleInvertedTriangles).toBe(1);
    expect(tiny.visibleInvertedPixels).toBeLessThanOrEqual(2);
    expect(visibleInversionsPass(tiny, tolerance)).toBe(true);
    expect(visibleInversionsPass(tiny, strictInversionTolerance)).toBe(false);
    expect(
      visibleInversionsPass(measureVisibleInversions(mesh, flip(0), surface()), tolerance),
    ).toBe(false);
  });

  it("applies a different budget per part", () => {
    const contract: InversionToleranceContract = {
      default: { maxVisibleAreaRatio: 0.01, maxSingleTriangleRatio: 0.01, maxVisibleTriangles: 4 },
      byPart: {
        skirt: { maxVisibleAreaRatio: 0.2, maxSingleTriangleRatio: 0.2, maxVisibleTriangles: 4 },
        face: strictInversionTolerance,
      },
    };
    const metrics = measureVisibleInversions(mesh, flip(0), surface());
    expect(visibleInversionsPass(metrics, resolveInversionTolerance(contract, "skirt"))).toBe(true);
    expect(visibleInversionsPass(metrics, resolveInversionTolerance(contract, "face"))).toBe(false);
    // An unknown part falls back to the default budget rather than to the loosest one.
    expect(resolveInversionTolerance(contract, "tail")).toEqual(contract.default);
    expect(resolveInversionTolerance(contract)).toEqual(contract.default);
    expect(resolveInversionTolerance(engineeringInversionTolerances, "face")).toEqual(
      strictInversionTolerance,
    );
  });

  it("discounts a fold hidden behind a layer drawn in front of it", () => {
    const posed = flip(0);
    const occluders = [
      { width: WIDTH, height: HEIGHT, bounds, alpha: new Uint8Array(WIDTH * HEIGHT).fill(255) },
    ];
    const open = measureVisibleInversions(mesh, posed, surface());
    const hidden = measureVisibleInversions(mesh, posed, surface(), { occluders });
    expect(open.visibleInvertedPixels).toBeGreaterThan(0);
    expect(hidden.invertedTriangles).toBe(1);
    expect(hidden.visibleInvertedPixels).toBe(0);
    expect(visibleInversionsPass(hidden, strictInversionTolerance)).toBe(true);
  });

  it("rejects inconsistent geometry, masks, options and tolerances", () => {
    const good = surface();
    expect(code(() => measureVisibleInversions(mesh, vertices.slice(1), good))).toBe(
      "DEFORMATION_INPUT",
    );
    expect(
      code(() => measureVisibleInversions({ ...mesh, triangles: [0, 1, 99] }, vertices, surface())),
    ).toBe("DEFORMATION_INDEX");
    expect(
      code(() => measureVisibleInversions(mesh, vertices, { ...good, alpha: new Uint8Array(10) })),
    ).toBe("VISIBILITY_SURFACE");
    expect(
      code(() => measureVisibleInversions(mesh, vertices, { ...good, width: 0, height: 0 })),
    ).toBe("VISIBILITY_SURFACE");
    expect(
      code(() =>
        measureVisibleInversions(mesh, vertices, {
          ...good,
          bounds: { x: 0, y: 0, width: 0, height: 32 },
        }),
      ),
    ).toBe("VISIBILITY_SURFACE");
    expect(
      code(() => measureVisibleInversions(mesh, vertices, good, { opaqueThreshold: 255 })),
    ).toBe("VISIBILITY_OPTIONS");
    expect(
      code(() => measureVisibleInversions(mesh, vertices, good, { minVisiblePixels: 0 })),
    ).toBe("VISIBILITY_OPTIONS");
    const metrics = measureVisibleInversions(mesh, vertices, good);
    expect(
      code(() =>
        visibleInversionsPass(metrics, {
          maxVisibleAreaRatio: 1.5,
          maxSingleTriangleRatio: 0,
          maxVisibleTriangles: 0,
        }),
      ),
    ).toBe("VISIBILITY_TOLERANCE");
    expect(
      code(() =>
        visibleInversionsPass(metrics, {
          maxVisibleAreaRatio: 0,
          maxSingleTriangleRatio: -0.1,
          maxVisibleTriangles: 0,
        }),
      ),
    ).toBe("VISIBILITY_TOLERANCE");
    expect(
      code(() =>
        visibleInversionsPass(metrics, {
          maxVisibleAreaRatio: 0,
          maxSingleTriangleRatio: 0,
          maxVisibleTriangles: 1.5,
        }),
      ),
    ).toBe("VISIBILITY_TOLERANCE");
    // Metrics measured from different poses must not be combined.
    expect(
      code(() =>
        deformationPassesWithVisibility(
          measureDeformation(mesh, flip(0)),
          measureVisibleInversions(mesh, vertices, good),
        ),
      ),
    ).toBe("VISIBILITY_PAIRING");
  });

  it("is deterministic across repeated evaluations", () => {
    const posed = flip(0, 1, 2);
    const baseline = measureVisibleInversions(mesh, posed, surface());
    expect(baseline.invertedTriangles).toBe(3);
    expect(baseline.visibleInvertedTriangles).toBe(2);
    for (let i = 0; i < 50; i++)
      expect(measureVisibleInversions(mesh, posed, surface())).toEqual(baseline);
  });
});
