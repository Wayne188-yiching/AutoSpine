import { describe, expect, it } from "vitest";
import { buildCharacter, lintCharacterPlan } from "@autospine/character";
import { loadSkeleton, pose } from "@autospine/reference";
import { measureOverlapDrift } from "@autospine/weights";
import type { MeshSpec } from "@autospine/schemas";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("logical character skeleton (ADR-025)", () => {
  it("aligns a joint to one joint's x and another's y", () => {
    const plan = clone(fixturePlan());
    plan.joints.hipLine = { rule: "align", x: "hipL", y: "pelvis" };
    plan.bones.push({ id: "hip_l_mark", parent: "hips", at: "hipLine", angle: 0, length: 5 });
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const world = buildCharacter(plan, fixtureLayout()).rigging.rigged.world;
    const mark = world.get("hip_l_mark")!.o,
      thigh = world.get("thigh_l")!.o,
      hips = world.get("hips")!.o;
    expect(mark[0]).toBeCloseTo(thigh[0], 6);
    expect(mark[1]).toBeCloseTo(hips[1], 6);
    plan.joints.bad = { rule: "align", x: "nowhere", y: "pelvis" };
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/nowhere/);
  });

  it("squashes a stance bone so its tip follows the hips", () => {
    // A vertical stance from the ground to the pelvis carries the legs: the breath squashes it
    // in step with the hips while the ground end stays put.
    const plan = clone(fixturePlan());
    plan.joints.ground = { rule: "align", x: "pelvis", y: "footL" };
    plan.bones.push({ id: "stance", parent: "root", at: "ground", to: "pelvis" });
    plan.motion.sink!.push({ kind: "squash", id: "stanceS", bone: "stance", track: true });
    const built = buildCharacter(plan, fixtureLayout());
    const sk = loadSkeleton(built.document);
    const at = (t: number) => {
      pose(sk, "IDLE", t);
      const s = sk.skeleton.findBone("stance")!,
        h = sk.skeleton.findBone("hips")!;
      const L = s.data.length;
      return { tip: s.worldY + s.c * L, base: s.worldY, hips: h.worldY };
    };
    const rest = at(0);
    // The main sinks at frame 16 of the 40-frame cycle.
    const down = at(16 / 30);
    expect(down.hips).toBeLessThan(rest.hips - 1);
    expect(down.tip - rest.tip).toBeCloseTo(down.hips - rest.hips, 1);
    expect(down.base).toBeCloseTo(rest.base, 6);
    // Track and amount are exclusive.
    const both = clone(plan);
    const sq = both.motion.sink!.at(-1)! as { amount?: number };
    sq.amount = 1;
    expect(() => buildCharacter(both, fixtureLayout())).toThrow(/amount or track/);
  });

  it("counts only the visible seam: the top part's outline over the other", () => {
    // A wide top quad over a lower quad whose far interior drifts and whose rim does not.
    const quad = (x0: number, y0: number, x1: number, y1: number): MeshSpec =>
      ({
        schemaVersion: "0.1",
        kind: "mesh",
        id: `q${x0}${y0}`,
        name: "q",
        sourcePartId: "p",
        vertices: [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [(x0 + x1) / 2, (y0 + y1) / 2],
        ],
        uvs: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0.5, 0.5],
        ],
        triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
        hull: [0, 1, 2, 3],
      }) as MeshSpec;
    const top = quad(0, 0, 100, 100),
      lower = quad(10, 20, 90, 110);
    const still = top.vertices.map((p) => [...p] as [number, number]);
    // The lower part's centre (deep under the top) slides 30 px; its rim stays.
    const moved = lower.vertices.map(
      (p, i) => [p[0], p[1] + (i === 4 ? 30 : 0)] as [number, number],
    );
    const all = measureOverlapDrift({ mesh: top, posed: still }, { mesh: lower, posed: moved });
    const seam = measureOverlapDrift(
      { mesh: top, posed: still },
      { mesh: lower, posed: moved },
      { top: "a", band: 10 },
    );
    expect(all.maxDrift).toBeGreaterThan(20);
    expect(seam.maxDrift).toBeLessThan(1);
  });
});
