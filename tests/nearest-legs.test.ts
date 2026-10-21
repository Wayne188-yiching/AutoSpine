import { describe, expect, it } from "vitest";
import { assetFor } from "@autospine/character";
import { generateFeatureMesh } from "@autospine/mesh";
import { rigFromWorldFrames } from "@autospine/rig";
import { measureDeformation, skinVertices, solveWeightsV1 } from "@autospine/weights";

type XY = [number, number];
/** A w x h part whose alpha is the polygon (pixel centres inside it). */
function polygonPart(w: number, h: number, polygon: XY[]) {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p: XY = [x + 0.5, y + 0.5];
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [ax, ay] = polygon[i]!,
          [bx, by] = polygon[j]!;
        if (ay > p[1] !== by > p[1] && p[0] < ((bx - ax) * (p[1] - ay)) / (by - ay) + ax)
          inside = !inside;
      }
      if (inside) alpha[y * w + x] = 255;
    }
  return {
    slot: "s",
    key: "s",
    path: "s",
    width: w,
    height: h,
    alpha,
    order: 0,
    affine: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    setup: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  };
}
type Part = ReturnType<typeof polygonPart>;
const featureMesh = (p: Part, options: Parameters<typeof generateFeatureMesh>[2]) =>
  generateFeatureMesh(assetFor(p as never, "s").parts[0]!, p.alpha, options).mesh;
const hullEdges = (mesh: { vertices: XY[]; hull: number[] }) =>
  mesh.hull.map((a, i) => {
    const p = mesh.vertices[a]!,
      q = mesh.vertices[mesh.hull[(i + 1) % mesh.hull.length]!]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });

// ADR-043: pants like the ThreePigWC wolf's (287 x 183 px), a band over two legs with a crotch
// arch, weighted `nearest` over the spine and each leg's thigh and calf with two influences.
const W = 287,
  H = 183;
const pants = polygonPart(W, H, [
  [100, 0],
  [190, 0],
  [250, 38],
  [287, 100],
  [287, 150],
  [262, 183],
  [210, 183],
  [204, 140],
  [165, 93],
  [145, 95],
  [120, 105],
  [104, 109],
  [90, 134],
  [83, 166],
  [60, 183],
  [25, 183],
  [0, 150],
  [0, 105],
  [40, 45],
]);
// Image pixels are world units (y down). As in the wolf's plan, the hips sit above the knees at the
// legs' outer thirds, so the crotch is nearest the spine.
const legs: { id: string; parent: string; origin: XY; length: number; up?: boolean }[] = [
  { id: "spine", parent: "body", origin: [W / 2, 49], length: 78, up: true },
  { id: "thigh_l", parent: "body", origin: [56, 49], length: 103 },
  { id: "calf_l", parent: "thigh_l", origin: [56, 152], length: 73 },
  { id: "thigh_r", parent: "body", origin: [231, 49], length: 103 },
  { id: "calf_r", parent: "thigh_r", origin: [231, 152], length: 73 },
];
const rig = rigFromWorldFrames("pants", "Pants", [
  { id: "body", name: "body", length: 0, world: [1, 0, 0, 1, W / 2, 49] },
  ...legs.map((b) => ({
    id: b.id,
    name: b.id,
    parentId: b.parent,
    length: b.length,
    world: [0, b.up ? -1 : 1, b.up ? 1 : -1, 0, ...b.origin] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  })),
]);
const ids = legs.map((b) => b.id);
/** The weighting bones in image pixels, a joint where the parent weights too (attachments.ts). */
const bones = legs.map((b) => ({
  origin: b.origin,
  tip: [b.origin[0], b.origin[1] + (b.up ? -b.length : b.length)] as XY,
  joint: ids.includes(b.parent),
}));
// The wolf's 02_Idle at its widest (frame 35): the body sways, both thighs swing one way and the
// knees bend back; local degrees from the setup pose.
const sway: Record<string, number> = {
  spine: -15,
  thigh_l: 33,
  calf_l: -80,
  thigh_r: 41,
  calf_r: -105,
};

describe("budget hulls spaced like an artist's (ADR-043)", () => {
  const mesh = featureMesh(pants, { bones });

  it("leave no hull edge under half the mean edge on a part over two legs", () => {
    // The cheapest-area fit alone left five, the shortest 0.15 of the mean, in the crotch.
    const edges = hullEdges(mesh),
      mean = edges.reduce((s, x) => s + x, 0) / edges.length;
    expect(mesh.hull.length).toBeGreaterThanOrEqual(20); // the 1.5x hull of five bones
    expect(Math.min(...edges) / mean).toBeGreaterThanOrEqual(0.5);
  });

  it("keep the part unfolded and within B3 in the wolf's sway with nearest weights", () => {
    const weights = solveWeightsV1(mesh, rig, { bones: ids, maxInfluences: 2, smoothingPasses: 2 });
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const pose = Object.fromEntries(Object.entries(sway).map(([id, d]) => [id, d * t]));
      const m = measureDeformation(mesh, skinVertices(mesh, rig, weights, pose));
      expect(m.inversionCount, `pose ${t}`).toBe(0);
      // B3 allows an edge 1 + 1.5 x 1.556 (the wolf artist's largest stretch) times its setup length.
      expect(m.maxEdgeStretch, `pose ${t}`).toBeLessThan(1 + 1.5 * 1.556);
    }
  });
});
