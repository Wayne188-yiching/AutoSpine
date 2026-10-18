import { describe, expect, it } from "vitest";
import type { AnimationSpec, CharacterPlan } from "@autospine/schemas";
import { artistBudget, assetFor, buildCharacter, type Keyposes } from "@autospine/character";
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
const rotation = (a: AnimationSpec, bone: string) =>
  a.rotationTimelines?.find((t) => t.boneId === bone);

describe("artist-density meshes by default (ADR-038)", () => {
  it("keeps a budget mesh's eye socket as a ring", () => {
    const p = blob(420, 360, true),
      asset = assetFor(p as never, "s"),
      b = artistBudget(p.width, p.height);
    const budget = { hullVertices: b.hull, interiorVertices: b.interior };
    const kept = generateFeatureMesh(asset.parts[0]!, p.alpha, { ...budget, keepHoles: true });
    const covered = generateFeatureMesh(asset.parts[0]!, p.alpha, budget);
    const fine = generateFeatureMesh(asset.parts[0]!, p.alpha, {});
    expect(kept.rings).toHaveLength(1);
    expect(kept.mesh.manualEdges?.length).toBe(kept.rings[0]!.length);
    expect(covered.rings).toHaveLength(0);
    // The ring adds its own points; the hull and the interior keep the budget.
    expect(kept.mesh.hull).toHaveLength(b.hull);
    expect(kept.mesh.vertices.length).toBeLessThan(fine.mesh.vertices.length / 2);
  });

  it("leaves a stray fragment out of a budget mesh and bridges two large pieces (ADR-039)", () => {
    // A sliver of a neighbouring image left in the picture's corner, apart from the art.
    const p = blob(300, 240);
    for (let y = 0; y < 30; y++) for (let x = 296; x < 300; x++) p.alpha[y * 300 + x] = 255;
    const asset = assetFor(p as never, "s"),
      b = artistBudget(p.width, p.height),
      budget = { hullVertices: b.hull, interiorVertices: b.interior };
    const r = generateFeatureMesh(asset.parts[0]!, p.alpha, budget);
    expect(r.discarded).toBe(120);
    expect(r.mesh.uvs.filter(([u, v]) => u * 300 > 285 && v * 240 < 40)).toHaveLength(0);
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

  it("meshes a planned feature part at the artist budget unless the plan asks for fine", () => {
    const head = (plan: CharacterPlan) =>
      buildCharacter(plan, fixtureLayout()).rigging.meshes.get("Head")!.mesh;
    const plan = fixturePlan();
    const layout = fixtureLayout(),
      part = layout.parts.get("Head")!,
      b = artistBudget(part.width, part.height);
    const budget = head(plan);
    expect(budget.hull).toHaveLength(b.hull);
    expect(budget.vertices.length).toBeLessThanOrEqual(b.hull + b.interior + 4);
    const fine = structuredClone(plan);
    for (const m of fine.meshes!)
      if (m.part === "Head" && m.mesh.type === "feature") m.mesh.density = "fine";
    expect(head(fine).vertices.length).toBeGreaterThan(2 * budget.vertices.length);
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
