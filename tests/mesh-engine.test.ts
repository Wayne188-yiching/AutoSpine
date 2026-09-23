import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { MeshSpecSchema, type AssetPart, type MeshSpec } from "@autospine/schemas";
import { decodeAlphaMask, encodeAlphaMask } from "@autospine/assets";
import {
  fillEnclosedHoles,
  generateMesh,
  MeshError,
  repairCornerPinches,
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

describe("Gate 3 deterministic mesh engine", () => {
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
    expect(largest).toBeLessThanOrEqual(512);
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
