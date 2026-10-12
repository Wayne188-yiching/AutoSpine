import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { CharacterPlanSchema, type CharacterPlan } from "@autospine/schemas";
import {
  PartIndex,
  animateCharacter,
  buildCharacter,
  lintCharacterPlan,
  num,
  planRig,
  rigCharacter,
} from "@autospine/character";
import { loadSkeleton, placementDelta } from "@autospine/reference";
import { fixtureImagesOnly, fixtureLayout, fixturePlan } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { validation?: { id: string } }).validation?.id ?? (e as Error).message;
  }
  return "no error";
};

describe("character plan (ADR-017)", () => {
  it("validates the fixture plan and rejects malformed numbers", () => {
    expect(Value.Check(CharacterPlanSchema, fixturePlan())).toBe(true);
    for (const gain of ["2*$lag", "$", "-lag", "=", "$1x"]) {
      const plan = clone(fixturePlan());
      plan.motion.follow![0]!.gain = gain;
      expect(Value.Check(CharacterPlanSchema, plan), gain).toBe(false);
    }
  });

  it("evaluates parameter expressions with a parser, not eval", () => {
    const p = { a: 3, b: 5 };
    expect(num(2, p, "t")).toBe(2);
    expect(num("$a", p, "t")).toBe(3);
    expect(num("-$b", p, "t")).toBe(-5);
    expect(num("=2*$a+1", p, "t")).toBe(7);
    expect(num("=($a+$b)/2", p, "t")).toBe(4);
    expect(num("=-$a*-2", p, "t")).toBe(6);
    expect(num("=.5*$b-1.5", p, "t")).toBe(1);
    expect(code(() => num("$zz", p, "t"))).toBe("PLAN_PARAMETER");
    expect(code(() => num("=$a+", p, "t"))).toBe("PLAN_EXPRESSION");
    expect(code(() => num("=process", p, "t"))).toBe("PLAN_EXPRESSION");
    expect(code(() => num("=$a/0", p, "t"))).toBe("PLAN_EXPRESSION");
  });

  it("lints cross-references before any pixels are read", () => {
    const layout = fixtureLayout();
    const clean = lintCharacterPlan(fixturePlan(), layout.parts.keys());
    expect(clean.errors).toEqual([]);
    expect(clean.warnings).toEqual([]);
    expect(clean.bones).toHaveLength(19);
    expect(clean.bones).toContain("hair_3");

    const plan = clone(fixturePlan()) as CharacterPlan;
    plan.joints.kneeL = { rule: "lerp", a: "hipL", b: "ghost", t: 0.5 };
    plan.joints.loopA = { rule: "lerp", a: "loopB", b: "neck", t: 0.5 };
    plan.joints.loopB = { rule: "lerp", a: "loopA", b: "neck", t: 0.5 };
    plan.joints.dome = { rule: "domeCenter" };
    delete plan.face;
    plan.bones.splice(1, 0, { id: "early", parent: "spine", at: "neck", angle: 0 });
    plan.meshes![0]!.part = "Missing";
    plan.meshes!.unshift({
      part: "Shadow",
      mesh: { type: "quad" },
      weights: { type: "transfer", sources: ["Body"] },
    });
    plan.motion.follow![0]!.gain = "=$nope*2";
    plan.motion.search!.ghost = { min: 0, max: 1, step: 0.5 };
    plan.motion.keyed![0]!.keys.WALK = [{ frame: 1, value: [0, 0], ease: "linear" }];
    plan.motion.cycles![0]!.id = "headF";
    plan.motion.beats![0]!.id = "hair_2_r";
    const lint = lintCharacterPlan(plan, layout.parts.keys());
    const has = (s: string) =>
      expect(
        lint.errors.some((e) => e.includes(s)),
        s,
      ).toBe(true);
    has("unknown joint ghost");
    has("joints: cycle");
    has("domeCenter needs a face block");
    has("parent spine must be planned before early");
    has("no part Missing");
    has("no part Shadow");
    has("transfer source Body must be meshed earlier");
    has("Hair has no mesh and no region bone");
    has("dome weights need a face block");
    has("unknown parameter nope");
    has("motion.search.ghost: not a parameter");
    has("unknown animation WALK");
    has("control id headF is used twice");
    has("control id hair_2_r is used twice");
  });

  it("solves joints from part pixels and builds the bones from them", () => {
    const plan = fixturePlan();
    const rigged = planRig(plan, new PartIndex(fixtureLayout().parts));
    const j = rigged.joints;
    // IR world: x right, y down; the art's Spine y is negated.
    expect(j.neck![0]).toBeCloseTo(0, 0);
    expect(j.neck![1]).toBeGreaterThan(-220);
    expect(j.neck![1]).toBeLessThan(-215);
    // axisEnd is the centroid of the end band of the principal axis, inside the top of the head.
    expect(j.headTop![0]).toBeCloseTo(0, 0);
    expect(j.headTop![1]).toBeGreaterThan(-295);
    expect(j.headTop![1]).toBeLessThan(-275);
    expect(j.shoulderR![1]).toBeLessThan(j.handR![1]!);
    expect(j.handR![1]).toBeGreaterThan(-135);
    expect(j.handR![1]).toBeLessThan(-120);
    expect(j.elbowR).toEqual([
      (j.shoulderR![0]! + j.handR![0]!) / 2,
      (j.shoulderR![1]! + j.handR![1]!) / 2,
    ]);
    // The ankle is the narrowest cross-section in its range, on the leg axis.
    expect(j.ankleL![1]).toBeGreaterThan(j.kneeL![1]!);
    expect(j.ankleL![1]).toBeLessThan(j.footL![1]!);
    expect(rigged.chains.Hair).toEqual(["hair_1", "hair_2", "hair_3"]);
    const hair = rigged.rig.bones
      .filter((b) => b.id.startsWith("hair_"))
      .reduce((s, b) => s + b.length, 0);
    expect(hair).toBeGreaterThan(110);
    expect(hair).toBeLessThan(140);
    // Spine points up the body, the arm and legs point down.
    expect(rigged.world.get("spine")!.a).toBeCloseTo(-90, 0);
    expect(Math.abs(rigged.world.get("arm_r")!.a - 90)).toBeLessThan(3);
    expect(Math.abs(rigged.world.get("thigh_l")!.a - 90)).toBeLessThan(3);
    expect(rigged.dome).toBeDefined();
  });

  it("turns motion blocks into one keypose spec per animation", () => {
    const rigging = rigCharacter(fixturePlan(), fixtureLayout());
    const [spec] = animateCharacter(rigging).specs;
    expect(spec).toMatchObject({ name: "IDLE", fps: 30, frames: 80, loop: true });
    const beat = (frame: number) => spec!.beats.find((b) => b.frame === frame)!.poses;
    // Main cycle: anticipation up, sink at depth, hold at depth + 1, repeated per cycle.
    expect(spec!.beats.map((b) => b.frame)).toEqual([0, 8, 16, 20, 22, 40, 48, 56, 60, 62]);
    expect(beat(8).body).toEqual([0, -2]);
    expect(beat(16).body).toEqual([0, 5]);
    expect(beat(22).body).toEqual([0, 6]);
    // Second cycle's anticipation is scaled by cycleScale (0.8), also for scaleUp beats.
    expect(beat(48).body).toEqual([0, -1.6]);
    expect(beat(48).elbow).toBe(1.6);
    // Face slides y = 2 px at full depth, x = 0.5 of that; 2/3 of the lift above rest.
    expect(beat(16).face).toEqual([1, 2]);
    expect(beat(22).face).toEqual([1.2, 2.4]);
    expect(beat(8).face).toEqual([-0.667, -1.333]);
    // Legs: the thigh shortens by depth / vertical leg span, the foot counter-scales.
    const [th] = beat(16).thL as [number, number];
    const [ft] = beat(16).ftL as [number, number];
    expect(th).toBeLessThan(1);
    expect(th * ft).toBeCloseTo(1, 4);
    expect(beat(20).look).toEqual({ value: [1, 0], ease: "sine" });
    const rule = (control: string) => spec!.rules!.find((r) => r.control === control)!;
    expect(rule("headF")).toMatchObject({ rule: "follow", source: "body", gain: 0.4, lag: 3 });
    expect(rule("armC")).toMatchObject({ rule: "cycle", amplitude: 3, period: 80, phase: 20 });
    expect(rule("hair_1_r")).toMatchObject({ rule: "follow", gain: 0.5, lag: 3 });
    // Waves: amplitude grows by `growth` per bone, phase steps by `step` frames.
    expect(rule("hair_2_r")).toMatchObject({ rule: "cycle", amplitude: 5.2, period: 40, phase: 6 });
    expect(rule("hair_3_r")).toMatchObject({
      rule: "cycle",
      amplitude: 6.4,
      period: 40,
      phase: 10,
    });
    // Parameters override the plan's start values.
    const moved = animateCharacter(rigging, { lag: 5, amp: 2 }).specs[0]!;
    expect(moved.rules!.find((r) => r.control === "headF")).toMatchObject({ lag: 6 });
    expect(moved.rules!.find((r) => r.control === "hair_2_r")).toMatchObject({ amplitude: 2.6 });
  });

  it("rejects motion timing and duplicate controls the keypose engine cannot honour", () => {
    const layout = fixtureLayout();
    const late = clone(fixturePlan());
    late.motion.params.down = 39;
    expect(code(() => animateCharacter(rigCharacter(late, layout)))).toBe("PLAN_MOTION_TIMING");
    const region = clone(fixturePlan());
    delete region.regions;
    expect(code(() => rigCharacter(region, layout))).toBe("PLAN_REGION");
  });

  it("builds a runtime-loadable Spine 4.0 document that keeps every image in place", () => {
    const plan = fixturePlan();
    const built = buildCharacter(plan, fixtureLayout());
    const again = buildCharacter(plan, fixtureLayout());
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(built.document));
    const doc = built.document as unknown as {
      bones: unknown[];
      slots: { name: string }[];
      transform: { name: string }[];
      animations: Record<string, unknown>;
    };
    expect(doc.bones).toHaveLength(19);
    expect(doc.slots.map((s) => s.name)).toEqual([
      "Hair",
      "Leg_L",
      "Leg_R",
      "Body",
      "Arm_R",
      "Head",
      "Eyes",
    ]);
    expect(doc.transform.map((t) => t.name)).toEqual(["face_counter", "Face_eyes"]);
    expect(Object.keys(doc.animations)).toEqual(["IDLE"]);
    expect(built.rigging.faceMix.eyes).toBeGreaterThan(0.5);
    // Official runtime: the setup pose reproduces the images-only placement.
    const delta = placementDelta(loadSkeleton(fixtureImagesOnly()), loadSkeleton(built.document));
    expect(Object.keys(delta)).toHaveLength(7);
    expect(Math.max(...Object.values(delta).map((v) => v ?? Infinity))).toBeLessThanOrEqual(0.01);
    expect(built.seams).toHaveLength(4);
    for (const s of built.seams) {
      expect(s.maxDrift, s.pair).toBeLessThan(11);
      expect(s.inversions, s.pair).toEqual([0, 0]);
    }
  });
});
