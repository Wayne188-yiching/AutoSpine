import { describe, expect, it } from "vitest";
import { assetFor, type CharacterPart } from "@autospine/character";
import { generateFeatureMesh } from "@autospine/mesh";

const part = (w: number, h: number, inside: (x: number, y: number) => boolean): CharacterPart => {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) alpha[y * w + x] = 255;
  return {
    key: "P",
    slot: "P",
    attachment: "P",
    path: "P",
    setup: true,
    order: 0,
    width: w,
    height: h,
    alpha,
    affine: [1, 0, 0, 1, 0, 0],
    sheared: false,
  };
};
const covered = (p: [number, number], poly: [number, number][]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!;
    const dx = xj - xi,
      dy = yj - yi,
      t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(xi + t * dx - p[0], yi + t * dy - p[1]) < 1e-6) return true;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

describe("feature mesh outline fallbacks (ADR-028)", () => {
  it("traces a coarser covering outline when the full one has too many corners", () => {
    // A large ragged disc: its pixel outline has thousands of corners (SoccerWolf glove, chest).
    const n = 1200,
      r = 560;
    const p = part(n, n, (x, y) => {
      const d = Math.hypot(x - n / 2, y - n / 2);
      return d < r + ((x * 7 + y * 13) % 5) - 2;
    });
    const asset = assetFor(p, "disc");
    for (const options of [{}, { hullVertices: 24, interiorVertices: 6 }]) {
      const m = generateFeatureMesh(asset.parts[0]!, p.alpha, options).mesh;
      const hull = m.hull.map((i) => m.vertices[i]!);
      for (const [x, y] of [
        [n / 2 + r - 2, n / 2],
        [n / 2, n / 2 - r + 2],
        [n / 2 - r + 2, n / 2 + 1],
      ] as [number, number][])
        expect(covered([x + 0.5, y + 0.5], hull)).toBe(true);
    }
  });

  it("meshes pixels that touch only at a corner", () => {
    // Two squares meeting at one corner: not 4-connected (a hand drawn in two strokes).
    const p = part(
      80,
      80,
      (x, y) => (x < 40 && y < 40) || (x >= 40 && y >= 40 && x < 79 && y < 79),
    );
    const m = generateFeatureMesh(assetFor(p, "corner").parts[0]!, p.alpha).mesh;
    const hull = m.hull.map((i) => m.vertices[i]!);
    expect(covered([10.5, 10.5], hull)).toBe(true);
    expect(covered([70.5, 70.5], hull)).toBe(true);
  });
});
