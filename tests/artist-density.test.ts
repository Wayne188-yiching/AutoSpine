import { describe, expect, it } from "vitest";
import type { AnimationSpec, CharacterPlan } from "@autospine/schemas";
import { assetFor, buildCharacter, type Keyposes } from "@autospine/character";
import { generateFeatureMesh } from "@autospine/mesh";
import { rotationsAt, simplifyAnimation } from "@autospine/motion";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

/** An ellipse, optionally with an elliptic hole (an eye socket), as alpha. */
function blob(w: number, h: number, hole = false) {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / (w / 2 - 2),
        v = (y - h / 2) / (h / 2 - 2);
      const e = ((x - 0.35 * w) / (0.12 * w)) ** 2 + ((y - 0.45 * h) / (0.1 * h)) ** 2;
      if (u * u + v * v <= 1 && !(hole && e <= 1)) alpha[y * w + x] = 255;
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
/** Inside the polygon or on its boundary. */
function covers(poly: [number, number][], p: [number, number]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!,
      dx = xj - xi,
      dy = yj - yi,
      t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(xi + t * dx - p[0], yi + t * dy - p[1]) < 1e-6) return true;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const rotation = (a: AnimationSpec, bone: string) =>
  a.rotationTimelines?.find((t) => t.boneId === bone);

type Part = ReturnType<typeof blob>;
const mesh = (p: Part, options: Parameters<typeof generateFeatureMesh>[2]) =>
  generateFeatureMesh(assetFor(p as never, "s").parts[0]!, p.alpha, options).mesh;
/** A part of `w` x `h` whose alpha is `inside`. */
function shape(w: number, h: number, inside: (x: number, y: number) => boolean): Part {
  const p = blob(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) p.alpha[y * w + x] = inside(x, y) ? 255 : 0;
  return p;
}
const ellipse = (w: number, h: number) =>
  shape(
    w,
    h,
    (x, y) => ((x + 0.5 - w / 2) / (0.45 * w)) ** 2 + ((y + 0.5 - h / 2) / (0.45 * h)) ** 2 <= 1,
  );
/** A vertical chain of `n` bones down the middle of a w x h image, 10 px from top and bottom. */
const chain = (w: number, h: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    origin: [w / 2, 10 + ((h - 20) * i) / n] as [number, number],
    tip: [w / 2, 10 + ((h - 20) * (i + 1)) / n] as [number, number],
    joint: i > 0,
  }));

describe("artist wiring rules (ADR-041)", () => {
  it("counts hull vertices from the outline, not the image size", () => {
    const hull = (p: Part) => mesh(p, { bones: [] }).hull.length;
    // The same ellipse at four times the size keeps its count; ADR-024 grew it from 11 to 22.
    expect(Math.abs(hull(ellipse(120, 100)) - hull(ellipse(480, 400)))).toBeLessThanOrEqual(1);
    // A star of the same size has more corners than the ellipse, so more hull vertices.
    const star = shape(240, 240, (x, y) => {
      const a = Math.atan2(y - 120, x - 120),
        r = Math.hypot(x - 120, y - 120);
      return r <= 60 + 50 * Math.cos(6 * a);
    });
    expect(hull(star)).toBeGreaterThan(1.3 * hull(ellipse(240, 240)));
  });

  it("scales the count by how many bones bend the part and covers every opaque pixel", () => {
    const p = ellipse(200, 300),
      rigid = mesh(p, { bones: [] }),
      one = mesh(p, { bones: chain(200, 300, 1) }),
      three = mesh(p, { bones: chain(200, 300, 3) });
    // 0.67 : 0.9 : 1.5 of the outline's corners.
    expect(rigid.hull.length).toBeLessThan(one.hull.length);
    expect(three.hull.length / rigid.hull.length).toBeGreaterThan(1.8);
    for (const m of [rigid, one, three]) {
      const hull = m.hull.map((i) => [m.uvs[i]![0] * 200, m.uvs[i]![1] * 300] as [number, number]);
      for (let y = 0; y < 300; y++)
        for (let x = 0; x < 200; x++)
          if (p.alpha[y * 200 + x]) expect(covers(hull, [x + 0.5, y + 0.5])).toBe(true);
    }
  });

  it("puts interior rows across the joints of a bending part and none in a rigid one", () => {
    const p = ellipse(200, 300),
      three = mesh(p, { bones: chain(200, 300, 3) });
    expect(mesh(p, { bones: [] }).vertices.length).toBe(mesh(p, { bones: [] }).hull.length);
    const interior = three.uvs.slice(three.hull.length).map(([u, v]) => [u * 200, v * 300]);
    expect(interior.length).toBeGreaterThanOrEqual(3);
    // Every point sits on a row square to the bones: at a joint (y 103.3, 196.7) or mid-bone.
    const rows = [56.7, 103.3, 150, 196.7, 243.3];
    for (const [, y] of interior)
      expect(Math.min(...rows.map((r) => Math.abs(r - y!)))).toBeLessThan(0.1);
    expect(interior.some(([, y]) => Math.abs(y! - 103.3) < 0.1)).toBe(true);
    // Delaunay: every interior edge's opposite angles sum to at most 180 degrees.
    const v = three.uvs.map(([a, b]) => [a * 200, b * 300] as const),
      opposite = new Map<string, number[]>();
    for (let t = 0; t < three.triangles.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const [a, b, c] = [0, 1, 2].map((j) => three.triangles[t + ((k + j) % 3)]!);
        const key = `${Math.min(a!, b!)}:${Math.max(a!, b!)}`,
          u = [v[a!]![0] - v[c!]![0], v[a!]![1] - v[c!]![1]],
          w = [v[b!]![0] - v[c!]![0], v[b!]![1] - v[c!]![1]];
        const angle = Math.acos(
          (u[0]! * w[0]! + u[1]! * w[1]!) / Math.hypot(u[0]!, u[1]!) / Math.hypot(w[0]!, w[1]!),
        );
        opposite.set(key, [...(opposite.get(key) ?? []), angle]);
      }
    for (const angles of opposite.values())
      if (angles.length === 2) expect(angles[0]! + angles[1]!).toBeLessThanOrEqual(Math.PI + 1e-6);
  });

  it("keeps a rule mesh's eye socket as a ring", () => {
    const p = blob(420, 360, true);
    const kept = mesh(p, { bones: [], keepHoles: true }),
      covered = mesh(p, { bones: [] }),
      fine = mesh(p, {});
    expect(kept.manualEdges?.length).toBeGreaterThan(4);
    expect(covered.manualEdges).toBeUndefined();
    // The ring adds its own points; the hull keeps the rule's count.
    expect(kept.hull).toHaveLength(covered.hull.length);
    expect(kept.vertices.length).toBeLessThan(fine.vertices.length / 2);
  });

  it("leaves a stray fragment out of a rule mesh and bridges two large pieces (ADR-039)", () => {
    // A sliver of a neighbouring image left in the picture's corner, apart from the art.
    const p = blob(300, 240);
    for (let y = 0; y < 30; y++) for (let x = 296; x < 300; x++) p.alpha[y * 300 + x] = 255;
    const asset = assetFor(p as never, "s"),
      budget = { bones: [] };
    const r = generateFeatureMesh(asset.parts[0]!, p.alpha, budget);
    expect(r.discarded).toBe(120);
    // The hull's few vertices reach towards the corner but never over the sliver.
    const hull = r.mesh.hull.map(
      (i) => [r.mesh.uvs[i]![0] * 300, r.mesh.uvs[i]![1] * 240] as [number, number],
    );
    for (let y = 0; y < 30; y++)
      for (let x = 296; x < 300; x++) expect(covers(hull, [x + 0.5, y + 0.5])).toBe(false);
    // Two eyes on one image are too large to drop: one outline covers both.
    const eyes = blob(300, 120);
    eyes.alpha.fill(0);
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 300; x++)
        if (((x % 150) - 75) ** 2 / 70 ** 2 + (y - 60) ** 2 / 55 ** 2 <= 1)
          eyes.alpha[y * 300 + x] = 255;
    const both = generateFeatureMesh(assetFor(eyes as never, "s").parts[0]!, eyes.alpha, budget);
    expect(both.discarded).toBe(0);
    const us = both.mesh.uvs.map(([u]) => u * 300);
    expect(Math.min(...us)).toBeLessThan(10);
    expect(Math.max(...us)).toBeGreaterThan(290);
  });

  it("wires a planned feature part by its weighting bones unless the plan asks for fine", () => {
    const head = (plan: CharacterPlan) =>
      buildCharacter(plan, fixtureLayout()).rigging.meshes.get("Head")!.mesh;
    const plan = fixturePlan();
    const ruled = head(plan);
    // The head's dome weights bend it on several bones: more hull vertices than a rigid part.
    const part = fixtureLayout().parts.get("Head")!,
      rigid = mesh(
        { ...blob(part.width, part.height), alpha: Uint8Array.from(part.alpha) },
        {
          bones: [],
        },
      );
    expect(ruled.hull.length).toBeGreaterThan(rigid.hull.length);
    const fine = structuredClone(plan);
    for (const m of fine.meshes!)
      if (m.part === "Head" && m.mesh.type === "feature") m.mesh.density = "fine";
    expect(head(fine).vertices.length).toBeGreaterThan(2 * ruled.vertices.length);
  });
});

describe("key cleanup (ADR-038)", () => {
  /** A rotation keyed on every frame: a swing sampled the way a frame-by-frame fit keys it. */
  const everyFrame = (frames: number, fps = 30): AnimationSpec => ({
    schemaVersion: "0.1",
    kind: "animation",
    id: "a",
    name: "a",
    rigId: "r",
    duration: frames / fps,
    loop: true,
    motions: [],
    rotationTimelines: [
      {
        boneId: "arm",
        keys: Array.from({ length: frames + 1 }, (_, g) => ({
          time: g / fps,
          degrees:
            12 * Math.sin((2 * Math.PI * g) / frames) + 4 * Math.sin((4 * Math.PI * g) / frames),
        })),
      },
      {
        boneId: "flip",
        keys: [
          { time: 0, degrees: 0, curve: { type: "stepped" } },
          { time: 0.5, degrees: 90, curve: { type: "stepped" } },
          { time: 1, degrees: 90 },
          { time: frames / fps, degrees: 0 },
        ],
      },
    ],
  });

  it("re-keys a timeline keyed on every frame within the tolerance", () => {
    const dense = everyFrame(60),
      clean = simplifyAnimation(dense, 30, 0.25);
    const before = rotation(dense, "arm")!.keys,
      after = rotation(clean, "arm")!.keys;
    expect(after.length).toBeLessThan(before.length / 4);
    expect(after[0]!.time).toBe(0);
    expect(after.at(-1)!.time).toBeCloseTo(2, 9);
    // It plays as before within the tolerance, on every frame and between frames.
    for (let t = 0; t <= 2; t += 1 / 90) {
      const a = rotationsAt(dense, Math.min(2, t)).arm!,
        b = rotationsAt(clean, Math.min(2, t)).arm!;
      expect(Math.abs(a - b)).toBeLessThan(0.3);
    }
    // A stepped timeline (a swap, a mirror flip) keeps its keys; 0 changes nothing.
    expect(rotation(clean, "flip")).toEqual(rotation(dense, "flip"));
    expect(simplifyAnimation(dense, 30, 0)).toBe(dense);
  });

  it("thins key poses keyed every other frame in a built character", () => {
    const plan = fixturePlan();
    // Key poses fitted frame by frame: a smooth spine sway keyed every second frame.
    const keyposes: Keyposes = Array.from({ length: 39 }, (_, i) => ({
      frame: 2 * i + 2,
      ease: "linear" as const,
      pose: { spine: { rotate: +(6 * Math.sin((2 * Math.PI * (2 * i + 2)) / 80)).toFixed(3) } },
    }));
    plan.motion.animations[0]!.keyposes = keyposes;
    const exact = structuredClone(plan);
    exact.motion.keyTolerance = 0;
    const keys = (p: CharacterPlan) =>
      rotation(buildCharacter(p, fixtureLayout()).animations[0]!, "spine")!.keys.length;
    expect(keys(exact)).toBeGreaterThanOrEqual(40);
    expect(keys(plan)).toBeLessThan(keys(exact) / 2);
  });
});
