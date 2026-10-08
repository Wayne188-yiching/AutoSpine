import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { failMesh, validateMeshSpec } from "./validation.js";

/** Explicit surface profile for layered faces with transparent cutouts.
 * Retains the original UV rectangle and texture alpha; no raster fill or reference topology.
 * It spends fill rate on transparent pixels to preserve a continuous deformable surface.
 */
export function generateSurfaceMesh(part: AssetPart, columns = 6, rows = 6): MeshSpec {
  const { x, y, width, height } = part.bounds;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2 ||
    columns > 32 ||
    rows > 32
  )
    failMesh("SURFACE_INPUT", "Finite positive bounds and 2..32 surface subdivisions required");
  const vertices: [number, number][] = [],
    uvs: [number, number][] = [],
    triangles: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      uvs.push([i / columns, j / rows]);
      vertices.push([x + (width * i) / columns, y + (height * j) / rows]);
    }
  const stride = columns + 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const a = j * stride + i,
        b = a + 1,
        c = a + stride,
        d = c + 1;
      triangles.push(a, b, c, b, d, c);
    }
  const hull = [
    ...Array.from({ length: columns + 1 }, (_, i) => i),
    ...Array.from({ length: rows }, (_, i) => (i + 1) * stride + columns),
    ...Array.from({ length: columns }, (_, i) => rows * stride + columns - i - 1),
    ...Array.from({ length: rows - 1 }, (_, i) => (rows - i - 1) * stride),
  ];
  const manualEdges: [number, number][] = [];
  for (let j = 1; j < rows; j++)
    for (let i = 0; i < columns; i++) manualEdges.push([j * stride + i, j * stride + i + 1]);
  for (let i = 1; i < columns; i++)
    for (let j = 0; j < rows; j++) manualEdges.push([j * stride + i, (j + 1) * stride + i]);
  const mesh: MeshSpec = {
    schemaVersion: "0.1",
    kind: "mesh",
    id: part.id + "-surface",
    name: part.name,
    sourcePartId: part.id,
    vertices,
    uvs,
    triangles,
    hull,
    manualEdges,
  };
  if (validateMeshSpec(mesh).status !== "passed")
    failMesh("SURFACE_TOPOLOGY", "Surface topology validation failed");
  return mesh;
}
