import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { MeshSpecSchema, type AssetPart, type MeshSpec } from "@autospine/schemas";
import { decodeAlphaMask, encodeAlphaMask } from "@autospine/assets";
import {
  fillEnclosedHoles,
  generateMesh,
  generateMeshWithDiagnostics,
  MeshError,
  repairCornerPinches,
  referenceRectangleFits,
  selectPrimaryComponent,
  traceContour,
  validateMeshSpec,
} from "@autospine/mesh";

function part(
  rows: string[],
  bounds = { x: 0, y: 0, width: rows[0]!.length, height: rows.length },
) {
  const width = rows[0]!.length;
  if (rows.some((row) => row.length !== width)) throw new Error("Fixture rows must match");
  const alpha = Uint8Array.from(
    rows
      .join("")
      .split("")
      .map((pixel) => (pixel === "#" ? 255 : 0)),
  );
  const source: AssetPart = {
    id: "tail",
    name: "Tail",
    sourcePath: "tail.png",
    bounds,
    drawOrder: 0,
    alphaMask: encodeAlphaMask(width, rows.length, alpha),
  };
  return { source, alpha };
}

function codes(mesh: unknown): string[] {
  return validateMeshSpec(mesh).issues.map((entry) => entry.code);
}

function insidePolygon(points: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    if (a[1] > y !== b[1] > y) {
      const edgeX = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (edgeX > x) inside = !inside;
    }
  }
  return inside;
}

function minimumTriangleAngle(mesh: MeshSpec, index: number): number {
  const points = mesh.triangles.slice(index, index + 3).map((vertex) => mesh.vertices[vertex]!);
  const sides = [
    Math.hypot(points[1]![0] - points[2]![0], points[1]![1] - points[2]![1]),
    Math.hypot(points[2]![0] - points[0]![0], points[2]![1] - points[0]![1]),
    Math.hypot(points[0]![0] - points[1]![0], points[0]![1] - points[1]![1]),
  ];
  return Math.min(
    ...sides.map(
      (side, corner) =>
        (Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              (sides[(corner + 1) % 3]! ** 2 + sides[(corner + 2) % 3]! ** 2 - side ** 2) /
                (2 * sides[(corner + 1) % 3]! * sides[(corner + 2) % 3]!),
            ),
          ),
        ) *
          180) /
        Math.PI,
    ),
  );
}

describe("Gate 3 deterministic mesh engine", () => {
  it("uses a stable geometric diagonal tie-break for qualified four-corner references", () => {
    for (const rows of [
      ["####", "####"],
      ["##", "##", "##", "##"],
    ]) {
      const { source, alpha } = part(rows);
      const options = { referenceTopology: { vertices: 4, hull: 4, maxAddedFraction: 0 } };
      const mesh = generateMesh(source, alpha, options);
      expect(mesh.triangles).toEqual([0, 1, 3, 1, 2, 3]);
      expect(mesh.vertices).toHaveLength(4);
      expect(mesh.manualEdges).toBeUndefined(); // A deterministic diagonal is still automatic.
      expect(validateMeshSpec(mesh).status).toBe("passed");
      expect(
        generateMesh({ ...source, name: "Unrelated", sourcePath: "other.png" }, alpha, options)
          .triangles,
      ).toEqual(mesh.triangles);
      for (let i = 0; i < 100; i++) expect(generateMesh(source, alpha, options)).toEqual(mesh);
    }
  });
  it("keeps an explicit four-corner reference intact across islands and holes without cleanup", () => {
    const input = part(["##...", "#....", "...##", "...##"], {
      x: -12,
      y: 5,
      width: 50,
      height: 80,
    });
    const original = input.alpha.slice();
    const referenceTopology = { vertices: 4, hull: 4, maxAddedFraction: 13 / 7 };
    expect(referenceRectangleFits(input.alpha, 5, 4, referenceTopology)).toBe(true);
    const mesh = generateMesh(input.source, input.alpha, { referenceTopology });
    expect(mesh.vertices).toEqual([
      [-12, 5],
      [38, 5],
      [38, 85],
      [-12, 85],
    ]);
    expect(mesh.uvs).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(mesh.triangles.length).toBe(6);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(input.alpha).toEqual(original);
    for (let i = 0; i < 100; i++)
      expect(generateMesh(input.source, input.alpha, { referenceTopology })).toEqual(mesh);
    expect(() => generateMesh(input.source, input.alpha)).toThrow(MeshError);
    expect(() =>
      generateMesh(input.source, input.alpha, { referenceTopology: { vertices: 4, hull: 4 } }),
    ).toThrow(MeshError);
  });

  it("does not borrow rectangle padding, clean alpha, or ignore reference structure", () => {
    const input = part(["###", "#.#", "###"]);
    for (const reference of [
      { vertices: 4, hull: 4, maxAddedFraction: 0.1249 },
      { vertices: 5, hull: 4, maxAddedFraction: 10 },
      { vertices: 5, hull: 5, maxAddedFraction: 10 },
      { vertices: 4, hull: 4, maxAddedFraction: NaN },
      { vertices: 4, hull: 4, maxAddedFraction: Infinity },
      { vertices: 4, hull: 4, maxAddedFraction: -1 },
    ]) {
      expect(referenceRectangleFits(input.alpha, 3, 3, reference)).toBe(false);
      expect(() =>
        generateMesh(input.source, input.alpha, { referenceTopology: reference }),
      ).toThrow(MeshError);
    }
    expect(
      referenceRectangleFits(input.alpha, 3, 3, { vertices: 4, hull: 4, maxAddedFraction: 0.125 }),
    ).toBe(true);
    expect(
      referenceRectangleFits(new Uint8Array(9), 3, 3, {
        vertices: 4,
        hull: 4,
        maxAddedFraction: 10,
      }),
    ).toBe(false);
    expect(
      referenceRectangleFits(input.alpha, 3, 4, { vertices: 4, hull: 4, maxAddedFraction: 10 }),
    ).toBe(false);
    expect(
      referenceRectangleFits(input.alpha, 4097, 4097, {
        vertices: 4,
        hull: 4,
        maxAddedFraction: 10,
      }),
    ).toBe(false);
  });

  it("handles a large qualified rectangle without expanding contour tracing limits", () => {
    const width = 1800,
      height = 1800;
    const alpha = new Uint8Array(width * height).fill(255);
    alpha[Math.floor(alpha.length / 2)] = 0;
    const source: AssetPart = {
      id: "large",
      name: "Large",
      sourcePath: "synthetic.png",
      drawOrder: 0,
      bounds: { x: 0, y: 0, width, height },
      alphaMask: encodeAlphaMask(width, height, alpha),
    };
    const mesh = generateMesh(source, alpha, {
      referenceTopology: { vertices: 4, hull: 4, maxAddedFraction: 1 / (alpha.length - 1) },
    });
    expect(mesh.vertices.length).toBe(4);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(alpha[Math.floor(alpha.length / 2)]).toBe(0);
    expect(() => generateMesh(source, alpha)).toThrow(MeshError);
    expect(() => traceContour(alpha, width, height)).toThrow(MeshError);
  });

  it.each(
    [
      [
        [15.2, 1.5],
        [19, 1],
        [70, 95],
        [66, 95.5],
      ],
      [
        [12, 2],
        [16, 2],
        [68, 66],
        [7, 98],
        [5, 95],
        [64, 65],
      ],
      [
        [25, 0],
        [28, 0],
        [80, 67],
        [0, 100],
        [0, 97],
        [76, 65],
      ],
      [
        [10.25, 2.25],
        [15.25, 2.25],
        [69.25, 96.25],
        [64.25, 96.25],
      ],
    ].map((polygon) => ({ polygon: polygon as [number, number][] })),
  )(
    "fits raster-only slanted boundaries without adding transparent pixels: $polygon",
    ({ polygon }) => {
      const width = 80,
        height = 100;
      const input = part(
        Array.from({ length: height }, (_, y) =>
          Array.from({ length: width }, (_, x) =>
            insidePolygon(polygon, x + 0.5, y + 0.5) ? "#" : ".",
          ).join(""),
        ),
      );
      const original = input.alpha.slice();
      const options = {
        referenceTopology: { vertices: polygon.length, hull: polygon.length, maxAddedFraction: 0 },
      };
      // The engine receives only the raster and counts, never polygon coordinates.
      const mesh = generateMesh(input.source, input.alpha, options);
      expect(traceContour(input.alpha, width, height).length).toBeGreaterThan(100);
      expect(Math.abs(mesh.vertices.length - polygon.length)).toBeLessThanOrEqual(5);
      expect(mesh.vertices.some((p) => p.some((v) => !Number.isInteger(v)))).toBe(true);
      expect(validateMeshSpec(mesh).status).toBe("passed");
      expect(mesh.uvs.every((p) => p.every((v) => v >= 0 && v <= 1))).toBe(true);
      const hull = mesh.hull.map((i) => mesh.vertices[i]!);
      let missed = 0,
        added = 0,
        foreground = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const filled = input.alpha[y * width + x]! > 0;
          const covered = insidePolygon(hull, x + 0.5, y + 0.5);
          foreground += Number(filled);
          missed += Number(filled && !covered);
          added += Number(!filled && covered);
        }
      expect(added).toBe(0);
      expect(missed / foreground).toBeLessThanOrEqual(0.02);
      expect(input.alpha).toEqual(original);
      for (let i = 0; i < 3; i++)
        expect(generateMesh(input.source, input.alpha, options)).toEqual(mesh);
    },
  );

  it("retains a dense valid fallback when subpixel fitting cannot satisfy the raster budget", () => {
    const polygon: [number, number][] = [
      [20.2, 3.2],
      [23.4, 3.5],
      [66.8, 58.7],
      [67.1, 62.4],
      [4.2, 93.6],
      [3.6, 90.4],
      [63, 59.8],
    ];
    const width = 72,
      height = 96;
    const input = part(
      Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) =>
          insidePolygon(polygon, x + 0.5, y + 0.5) ? "#" : ".",
        ).join(""),
      ),
    );
    const { mesh, diagnostics } = generateMeshWithDiagnostics(input.source, input.alpha, {
      referenceTopology: { vertices: 7, hull: 7, maxAddedFraction: 0 },
    });
    expect(mesh.vertices.length).toBeGreaterThan(12);
    expect(diagnostics.warnings).toContain("ARTIST_VERTEX_BUDGET_EXCEEDED");
    expect(validateMeshSpec(mesh).status).toBe("passed");
    const hull = mesh.hull.map((i) => mesh.vertices[i]!);
    let missed = 0,
      added = 0,
      foreground = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const filled = input.alpha[y * width + x]! > 0;
        const covered = insidePolygon(hull, x + 0.5, y + 0.5);
        foreground += Number(filled);
        missed += Number(filled && !covered);
        added += Number(!filled && covered);
      }
    expect(added).toBe(0);
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
  });

  it("preserves short clipping caps on a raster-only bent ribbon", () => {
    const polygon: [number, number][] = [
      [31.4, 0],
      [34.2, 0],
      [80, 64.4],
      [80, 67],
      [0, 100],
      [0, 97.8],
      [76.7, 65.2],
    ];
    const width = 80,
      height = 100;
    const { source, alpha } = part(
      Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) =>
          insidePolygon(polygon, x + 0.5, y + 0.5) ? "#" : ".",
        ).join(""),
      ),
    );
    const original = alpha.slice();
    const options = { referenceTopology: { vertices: 7, hull: 7, maxAddedFraction: 0 } };
    const mesh = generateMesh(source, alpha, options);
    expect(mesh.vertices).toHaveLength(7);
    // Subpixel fitting may move a cap inward to respect the zero-padding budget.
    // Require every geometric corner to survive, not exact image-border coordinates.
    for (const [x, y] of polygon)
      expect(
        Math.min(...mesh.vertices.map(([mx, my]) => Math.hypot(mx - x, my - y))),
      ).toBeLessThanOrEqual(1.5);
    expect(mesh.manualEdges).toBeUndefined();
    expect(validateMeshSpec(mesh).status).toBe("passed");
    let foreground = 0,
      missed = 0,
      added = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const filled = alpha[y * width + x]! > 0;
        const covered = insidePolygon(mesh.vertices, x + 0.5, y + 0.5);
        foreground += Number(filled);
        missed += Number(filled && !covered);
        added += Number(!filled && covered);
      }
    expect(added).toBe(0);
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(alpha).toEqual(original);
    expect(
      generateMesh({ ...source, name: "Different", sourcePath: "other.png" }, alpha, options)
        .vertices,
    ).toEqual(mesh.vertices);
  });

  it("uses artist padding without changing default budgets or the missed-foreground limit", () => {
    const input = part(
      Array.from({ length: 12 }, (_, y) =>
        Array.from({ length: 32 }, (_, x) => (y === 0 && x >= 8 && x < 24 ? "." : "#")).join(""),
      ),
    );
    const baseline = generateMesh(input.source, input.alpha, {
      referenceTopology: { vertices: 4, hull: 4 },
    });
    const original = input.alpha.slice();
    const options = { referenceTopology: { vertices: 4, hull: 4, maxAddedFraction: 16 / 368 } };
    const mesh = generateMesh(input.source, input.alpha, options);
    expect(mesh.hull.length).toBe(4);
    expect(baseline.hull.length).toBeGreaterThan(mesh.hull.length);
    let missed = 0,
      added = 0,
      foreground = 0;
    const polygon = mesh.hull.map((i) => mesh.vertices[i]!);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 32; x++) {
        const filled = input.alpha[y * 32 + x]! > 0,
          covered = insidePolygon(polygon, x + 0.5, y + 0.5);
        foreground += Number(filled);
        missed += Number(filled && !covered);
        added += Number(!filled && covered);
      }
    expect(added / foreground).toBeGreaterThan(0.02);
    expect(added / foreground).toBeLessThanOrEqual(options.referenceTopology.maxAddedFraction);
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(input.alpha).toEqual(original);
    for (let i = 0; i < 100; i++)
      expect(generateMesh(input.source, input.alpha, options)).toEqual(mesh);
    expect(
      generateMesh(input.source, input.alpha, { referenceTopology: { vertices: 4, hull: 4 } }),
    ).toEqual(baseline);
  });

  it("does not trade a thin foreground tip for a larger padding allowance", () => {
    const input = part(
      Array.from({ length: 32 }, (_, y) =>
        Array.from({ length: 32 }, (_, x) =>
          x < 12 || (y >= 14 && y < 18 && x < 30) ? "#" : ".",
        ).join(""),
      ),
    );
    const mesh = generateMesh(input.source, input.alpha, {
      referenceTopology: { vertices: 4, hull: 4, maxAddedFraction: 10 },
    });
    const polygon = mesh.hull.map((i) => mesh.vertices[i]!);
    let missed = 0,
      foreground = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        if (input.alpha[y * 32 + x]) {
          foreground++;
          missed += Number(!insidePolygon(polygon, x + 0.5, y + 0.5));
        }
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    for (const maxAddedFraction of [-1, NaN, Infinity])
      expect(() =>
        generateMesh(input.source, input.alpha, {
          referenceTopology: { vertices: 4, hull: 4, maxAddedFraction },
        }),
      ).toThrow(MeshError);
  });
  it("uses matched artist counts to preserve editable outer and interior structure", () => {
    const rows = Array.from({ length: 64 }, (_, y) => {
      const halfWidth = y < 16 ? Math.max(2, y * 2) : y > 50 ? 33 : 29;
      return Array.from({ length: 80 }, (_, x) => (Math.abs(x - 40) <= halfWidth ? "#" : ".")).join(
        "",
      );
    });
    const input = part(rows);
    const starter = JSON.stringify(generateMesh(input.source, input.alpha, { intent: "rigid" }));
    const options = {
      intent: "rigid" as const,
      referenceTopology: {
        vertices: 25,
        hull: 19,
        bands: [
          { position: 0.31, widthFraction: 0.8 },
          { position: 0.48, widthFraction: 0.65 },
          { position: 0.8, widthFraction: 0.6 },
        ],
      },
    };
    const { mesh, diagnostics } = generateMeshWithDiagnostics(input.source, input.alpha, options);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(mesh.vertices.length).toBeGreaterThanOrEqual(20);
    expect(mesh.vertices.length).toBeLessThanOrEqual(30);
    expect(mesh.vertices.length - mesh.hull.length).toBeGreaterThan(0);
    const interiorRows = mesh.uvs.slice(mesh.hull.length).map((point) => Math.floor(point[1] * 64));
    expect(interiorRows).toContain(19);
    expect(interiorRows).toContain(30);
    expect(interiorRows).toContain(51);
    const hull = mesh.hull.map((index) => mesh.vertices[index]!);
    let foreground = 0,
      missed = 0,
      added = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 80; x++) {
        const filled = input.alpha[y * 80 + x]! > 0;
        const covered = insidePolygon(hull, x + 0.5, y + 0.5);
        foreground += Number(filled);
        missed += Number(filled && !covered);
        added += Number(!filled && covered);
      }
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(added / foreground).toBeLessThanOrEqual(0.02);
    expect(diagnostics.warnings).not.toContain("ARTIST_VERTEX_BUDGET_EXCEEDED");
    const golden = JSON.stringify(mesh);
    for (let run = 0; run < 100; run++)
      expect(JSON.stringify(generateMesh(input.source, input.alpha, options))).toBe(golden);
    expect(JSON.stringify(generateMesh(input.source, input.alpha, { intent: "rigid" }))).toBe(
      starter,
    );
  });

  it("rejects invalid reference counts instead of silently copying artist positions", () => {
    const input = part(Array.from({ length: 32 }, () => "#".repeat(32)));
    for (const referenceTopology of [
      { vertices: 10, hull: 11 },
      { vertices: 2, hull: 2 },
      { vertices: 2600, hull: 5 },
      { vertices: 25.5, hull: 19 },
      { vertices: 25, hull: 19, bands: [{ position: 0.3, widthFraction: 0.5 }] },
    ])
      expect(() => generateMesh(input.source, input.alpha, { referenceTopology })).toThrow(
        MeshError,
      );
    const mesh = generateMesh(input.source, input.alpha, {
      referenceTopology: { vertices: 4, hull: 4 },
      intent: "rigid",
    });
    expect(mesh.hull).toHaveLength(4);
  });

  it("keeps rigid broad parts sparse at different resolutions", () => {
    for (const size of [32, 128]) {
      const input = part(Array.from({ length: size }, () => "#".repeat(size)));
      const original = input.alpha.slice();
      const { mesh, diagnostics } = generateMeshWithDiagnostics(input.source, input.alpha, {
        intent: "rigid",
      });
      expect(mesh.vertices).toHaveLength(4);
      expect(mesh.triangles).toHaveLength(6);
      expect(diagnostics).toMatchObject({
        intent: "rigid",
        deformationVerified: false,
        requiresReview: true,
      });
      expect(diagnostics.warnings).not.toContain("INTENT_UNKNOWN");
      for (let run = 0; run < 100; run++)
        expect(generateMesh(input.source, input.alpha, { intent: "rigid" })).toEqual(mesh);
      expect(input.alpha).toEqual(original);
    }
  });

  it("reduces a small curved part within separate two-percent raster budgets", () => {
    const width = 39,
      height = 59;
    const rows = Array.from({ length: height }, (_, y) => {
      const radius = 8 * Math.sqrt(1 - ((y + 0.5 - height / 2) / (height / 2)) ** 2);
      const center = 18 + 5 * Math.sin(y / 18);
      return Array.from({ length: width }, (_, x) =>
        Math.abs(x + 0.5 - center) <= radius ? "#" : ".",
      ).join("");
    });
    const input = part(rows);
    const { mesh, diagnostics } = generateMeshWithDiagnostics(input.source, input.alpha, {
      intent: "chain",
    });
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(mesh.vertices.length).toBeLessThanOrEqual(36);
    const hull = mesh.hull.map((index) => mesh.vertices[index]!);
    let missed = 0,
      added = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const filled = input.alpha[y * width + x]! > 0;
        const covered = insidePolygon(hull, x + 0.5, y + 0.5);
        missed += Number(filled && !covered);
        added += Number(!filled && covered);
      }
    const foreground = input.alpha.filter(Boolean).length;
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(added / foreground).toBeLessThanOrEqual(0.02);
    expect(diagnostics.deformationVerified).toBe(false);
    for (let run = 0; run < 100; run++)
      expect(generateMesh(input.source, input.alpha, { intent: "chain" })).toEqual(mesh);
  });

  it("does not infer animation readiness or intent from a part name", () => {
    const input = part(Array.from({ length: 32 }, () => "#".repeat(32)));
    const result = generateMeshWithDiagnostics(input.source, input.alpha);
    expect(result.diagnostics.warnings).toEqual(["DEFORMATION_NOT_VERIFIED", "INTENT_UNKNOWN"]);
    expect(result.diagnostics.requiresReview).toBe(true);
    const renamed = { ...input.source, name: "head-with-deform" };
    expect(generateMesh(renamed, input.alpha).vertices).toEqual(result.mesh.vertices);
    expect(() => generateMesh(input.source, input.alpha, { intent: "invalid" as "chain" })).toThrow(
      MeshError,
    );
  });

  it("meshes a tapered curved tail with internal vertices and byte-identical output", () => {
    const input = part([
      "##.........",
      "#####......",
      ".#######...",
      "..########.",
      "...#######.",
      ".....#####.",
      ".......##..",
    ]);
    const original = JSON.stringify(input.source);
    const mesh = generateMesh(input.source, input.alpha);
    expect(Value.Check(MeshSpecSchema, mesh)).toBe(true);
    expect(mesh).toEqual(
      JSON.parse(
        readFileSync(resolve(process.cwd(), "fixtures/tail/synthetic.expected.json"), "utf8"),
      ),
    );
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(mesh.vertices.length).toBeGreaterThan(mesh.hull.length);
    expect(mesh.triangles.length % 3).toBe(0);
    expect(JSON.stringify(input.source)).toBe(original);
    const golden = JSON.stringify(mesh);
    for (let run = 0; run < 100; run++)
      expect(JSON.stringify(generateMesh(input.source, input.alpha))).toBe(golden);
  });

  it("keeps pixel-edge bounds, full-raster UVs, and nonuniform display scaling", () => {
    const input = part(["##", "##"], { x: 10, y: -3, width: 8, height: 4 });
    const mesh = generateMesh(input.source, input.alpha);
    expect(mesh.vertices.slice(0, 4)).toEqual([
      [10, -3],
      [18, -3],
      [18, 1],
      [10, 1],
    ]);
    expect(mesh.uvs.slice(0, 4)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(mesh.hull).toEqual([0, 1, 2, 3]);
    const single = part(["#"]);
    expect(validateMeshSpec(generateMesh(single.source, single.alpha)).status).toBe("passed");
  });

  it("subdivides oversized triangles without leaving disconnected topology", () => {
    const rows = Array.from({ length: 128 }, (_, y) => "#".repeat(y + 1) + ".".repeat(127 - y));
    const input = part(rows);
    const mesh = generateMesh(input.source, input.alpha);
    expect(validateMeshSpec(mesh).status).toBe("passed");
    let largest = 0;
    for (let index = 0; index < mesh.triangles.length; index += 3) {
      const a = mesh.vertices[mesh.triangles[index]!]!;
      const b = mesh.vertices[mesh.triangles[index + 1]!]!;
      const c = mesh.vertices[mesh.triangles[index + 2]!]!;
      largest = Math.max(
        largest,
        ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2,
      );
    }
    expect(largest).toBeLessThanOrEqual(input.alpha.filter(Boolean).length / 6);
  });

  it("simplifies a large curved silhouette and avoids fan-like skinny triangles", () => {
    const width = 240;
    const height = 320;
    const rows = Array.from({ length: height }, (_, y) => {
      const offset = (y + 0.5 - height / 2) / (height / 2);
      const radius = 70 * Math.sqrt(1 - offset * offset);
      const center = width / 2 + 24 * Math.sin(y / 70);
      return Array.from({ length: width }, (_, x) =>
        Math.abs(x + 0.5 - center) <= radius ? "#" : ".",
      ).join("");
    });
    const input = part(rows);
    const exact = traceContour(input.alpha, width, height);
    const mesh = generateMesh(input.source, input.alpha, { intent: "chain" });
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(mesh.hull.length).toBeLessThan(exact.length / 3);
    expect(mesh.vertices.length).toBeLessThanOrEqual(32);
    expect(mesh.vertices.length - mesh.hull.length).toBeGreaterThanOrEqual(5);
    const hull = mesh.hull.map((index) => mesh.vertices[index]!);
    let foreground = 0;
    let missed = 0;
    let added = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const filled = input.alpha[y * width + x]! > 0;
        const covered = insidePolygon(hull, x + 0.5, y + 0.5);
        if (filled) foreground++;
        if (filled && !covered) missed++;
        if (!filled && covered) added++;
      }
    }
    expect(missed / foreground).toBeLessThanOrEqual(0.02);
    expect(added / foreground).toBeLessThanOrEqual(0.02);
    const smallAngles = Array.from(
      { length: mesh.triangles.length / 3 },
      (_, index) => minimumTriangleAngle(mesh, index * 3) < 10,
    ).filter(Boolean).length;
    expect(smallAngles / (mesh.triangles.length / 3)).toBeLessThan(0.1);
    expect(JSON.stringify(generateMesh(input.source, input.alpha, { intent: "chain" }))).toBe(
      JSON.stringify(mesh),
    );
  });

  it("rejects empty, disconnected, diagonal-touching, and holed alpha", () => {
    for (const [rows, expected] of [
      [["...", "..."], "ALPHA_EMPTY"],
      [["#.#"], "ALPHA_DISCONNECTED"],
      [["#.", ".#"], "ALPHA_DISCONNECTED"],
      [["###", "#.#", "###"], "ALPHA_HOLE"],
    ] as const) {
      const input = part([...rows]);
      expect(() => generateMesh(input.source, input.alpha)).toThrow(MeshError);
      try {
        generateMesh(input.source, input.alpha);
      } catch (error) {
        expect((error as MeshError).validation.issues[0]?.code).toBe(expected);
      }
    }
  });

  it("only drops detached pixels with an explicit, reported budget", () => {
    const input = part(["###.", "###.", "....", "...#"]);
    const original = Array.from(input.alpha);
    expect(() => selectPrimaryComponent(input.alpha, 4, 4, 0.1)).toThrow(MeshError);
    const selected = selectPrimaryComponent(input.alpha, 4, 4, 0.2);
    expect(selected).toMatchObject({ keptPixels: 6, discardedPixels: 1, componentCount: 2 });
    expect(Array.from(input.alpha)).toEqual(original);
    expect(validateMeshSpec(generateMesh(input.source, selected.alpha)).status).toBe("passed");
  });

  it("only bridges corner pinches with an explicit, reported fill budget", () => {
    const input = part(["##.", "#.#", "###"]);
    expect(() => generateMesh(input.source, input.alpha)).toThrow(MeshError);
    expect(() => repairCornerPinches(input.alpha, 3, 3, 0)).toThrow(MeshError);
    const repaired = repairCornerPinches(input.alpha, 3, 3, 0.2);
    expect(repaired.filledPixels).toBe(1);
    expect(validateMeshSpec(generateMesh(input.source, repaired.alpha)).status).toBe("passed");
  });

  it("only fills enclosed holes with an explicit, reported fill budget", () => {
    const input = part(["###", "#.#", "###"]);
    expect(() => generateMesh(input.source, input.alpha)).toThrow(MeshError);
    expect(() => fillEnclosedHoles(input.alpha, 3, 3, 0)).toThrow(MeshError);
    const filled = fillEnclosedHoles(input.alpha, 3, 3, 0.2);
    expect(filled).toMatchObject({ filledPixels: 1, holeCount: 1 });
    expect(validateMeshSpec(generateMesh(input.source, filled.alpha)).status).toBe("passed");
  });

  it("validates independent mutations, not just generated meshes", () => {
    const input = part(["##", "##"]);
    const base = generateMesh(input.source, input.alpha);
    const changed = (edit: (mesh: MeshSpec) => void): string[] => {
      const mesh = structuredClone(base);
      edit(mesh);
      return codes(mesh);
    };
    expect(changed((mesh) => (mesh.triangles[0] = 99))).toContain("INVALID_INDEX");
    expect(changed((mesh) => (mesh.vertices[1] = mesh.vertices[0]!))).toContain("DUPLICATE_VERTEX");
    expect(changed((mesh) => (mesh.triangles[1] = mesh.triangles[0]!))).toContain(
      "DEGENERATE_TRIANGLE",
    );
    expect(changed((mesh) => (mesh.hull = [0, 2, 1, 3]))).toContain("HULL_SELF_INTERSECTION");
    expect(changed((mesh) => mesh.triangles.push(...mesh.triangles.slice(0, 3)))).toContain(
      "DUPLICATE_TRIANGLE",
    );
    expect(changed((mesh) => (mesh.uvs[0] = [2, 0]))).toContain("UV_RANGE");
    expect(
      changed((mesh) => {
        mesh.vertices.push([3, 0], [4, 0], [3, 1]);
        mesh.uvs.push([0, 0], [0, 0], [0, 0]);
        mesh.triangles.push(4, 5, 6);
      }),
    ).toContain("DISCONNECTED_MESH");
    const tJunction: MeshSpec = {
      ...base,
      vertices: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [1, 1],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0.5, 0.5],
      ],
      triangles: [0, 1, 2, 0, 4, 3, 4, 2, 3],
      hull: [0, 1, 2, 3],
    };
    expect(codes(tJunction)).toContain("EDGE_OVERLAP");
  });

  it("accepts a Gate 2 parser-produced alpha mask without changing its data", () => {
    const asset = JSON.parse(
      readFileSync(resolve(process.cwd(), "fixtures/assets/png-parts.expected.json"), "utf8"),
    ) as { parts: AssetPart[] };
    const source = asset.parts.find((entry) => entry.id === "front")!;
    const original = JSON.stringify(source);
    const mesh = generateMesh(source, decodeAlphaMask(source.alphaMask!));
    expect(mesh.sourcePartId).toBe("front");
    expect(validateMeshSpec(mesh).status).toBe("passed");
    expect(JSON.stringify(source)).toBe(original);
    expect(traceContour(decodeAlphaMask(source.alphaMask!), 2, 2)).toHaveLength(4);
  });
});
