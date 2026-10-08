import { describe, expect, it } from "vitest";
import type { AssetPart } from "@autospine/schemas";
import { encodeAlphaMask } from "@autospine/assets";
import { generateFeatureMesh, generateSurfaceMesh } from "@autospine/mesh";

// A face-like part: an elliptical silhouette with two eye sockets and one 2x2 speck hole.
const width = 240,
  height = 160,
  alpha = new Uint8Array(width * height);
const sockets = [
  [80, 70],
  [160, 70],
] as const;
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const p = [x + 0.5, y + 0.5];
    const face = ((p[0]! - 120) / 110) ** 2 + ((p[1]! - 80) / 72) ** 2 <= 1;
    const socket = sockets.some(
      ([cx, cy]) => ((p[0]! - cx) / 22) ** 2 + ((p[1]! - cy) / 14) ** 2 <= 1,
    );
    const speck = x >= 120 && x < 122 && y >= 120 && y < 122;
    if (face && !socket && !speck) alpha[y * width + x] = 255;
  }
const part: AssetPart = {
  id: "face",
  name: "Face",
  sourcePath: "face.png",
  bounds: { x: 0, y: 0, width, height },
  drawOrder: 0,
  alphaMask: encodeAlphaMask(width, height, alpha),
};
const area = (points: [number, number][], triangles: number[]) => {
  let sum = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => points[triangles[t + k]!]!);
    sum += Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) / 2;
  }
  return sum;
};

describe("silhouette and feature-ring mesh", () => {
  const { mesh, rings } = generateFeatureMesh(part, alpha);

  it("rings each socket with locked edges and ignores the speck", () => {
    expect(rings.length).toBe(2);
    const edges = new Set<string>();
    for (let t = 0; t < mesh.triangles.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = mesh.triangles[t + k]!,
          b = mesh.triangles[t + ((k + 1) % 3)]!;
        edges.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
      }
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(8);
      ring.forEach((v, k) => {
        const w = ring[(k + 1) % ring.length]!;
        expect(edges.has(`${Math.min(v, w)}:${Math.max(v, w)}`)).toBe(true);
        const [x, y] = mesh.vertices[v]!,
          rho = Math.min(...sockets.map(([cx, cy]) => Math.hypot((x - cx) / 22, (y - cy) / 14)));
        expect(Math.abs(rho - 1)).toBeLessThan(0.35); // on the socket rim within simplification
      });
    }
    expect(mesh.manualEdges?.length).toBe(rings.reduce((n, r) => n + r.length, 0));
  });

  it("covers the silhouette instead of the image rectangle, with bounded triangle quality", () => {
    const silhouette = Math.PI * 110 * 72,
      grid = generateSurfaceMesh(part, 14, 12);
    expect(area(mesh.vertices, mesh.triangles) / silhouette).toBeGreaterThan(0.97);
    expect(area(mesh.vertices, mesh.triangles) / silhouette).toBeLessThan(1.03);
    expect(area(grid.vertices, grid.triangles) / silhouette).toBeGreaterThan(1.5);
    let minAngle = Math.PI;
    for (let t = 0; t < mesh.triangles.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const [p, q, r] = [0, 1, 2].map((i) => mesh.vertices[mesh.triangles[t + ((k + i) % 3)]!]!);
        const u = [q![0] - p![0], q![1] - p![1]],
          v = [r![0] - p![0], r![1] - p![1]];
        minAngle = Math.min(
          minAngle,
          Math.acos(
            (u[0]! * v[0]! + u[1]! * v[1]!) / Math.hypot(u[0]!, u[1]!) / Math.hypot(v[0]!, v[1]!),
          ),
        );
      }
    expect((minAngle * 180) / Math.PI).toBeGreaterThan(5);
    expect(generateFeatureMesh(part, alpha)).toEqual({ mesh, rings });
  });

  it("rejects mismatched alpha and out-of-range lengths", () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]
          ?.code;
      }
      return "no error";
    };
    expect(code(() => generateFeatureMesh(part, alpha.slice(1)))).toBe("FEATURE_INPUT");
    expect(code(() => generateFeatureMesh(part, alpha, { spacing: 1 }))).toBe("FEATURE_INPUT");
  });
});
