import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, handoverNotes, lintCharacterPlan } from "@autospine/character";
import { frameTime, loadSkeleton, pose, type LoadedSkeleton } from "@autospine/reference";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

type Mirror = NonNullable<CharacterPlan["motion"]["animations"][number]["mirror"]>;
const withMirror = (mirror: Mirror) => {
  const plan = fixturePlan();
  plan.motion.animations[0]!.mirror = mirror;
  return plan;
};
/** World transform of a bone on a frame of the fixture's 80-frame IDLE (30 fps). */
const at = (sk: LoadedSkeleton, frame: number, bone: string) => {
  const anim = sk.data.findAnimation("IDLE")!;
  pose(sk, "IDLE", frameTime(frame, 80, anim.duration, 30));
  const b = sk.skeleton.findBone(bone)!;
  return { x: b.worldX, y: b.worldY, det: b.a * b.d - b.b * b.c };
};

describe("mirror: a body that turns the other way for part of an animation (ADR-035)", () => {
  it("lints bones, kept bones and frame ranges", () => {
    const errors = (m: Mirror) => lintCharacterPlan(withMirror(m)).errors.join("\n");
    expect(errors({ bone: "hips", keep: ["head"], frames: [[20, 59]] })).toBe("");
    expect(errors({ bone: "ghost", frames: [[1, 2]] })).toMatch(/unknown bone ghost/);
    expect(errors({ bone: "spine", keep: ["thigh_l"], frames: [[1, 2]] })).toMatch(
      /thigh_l is not under spine/,
    );
    expect(errors({ bone: "hips", frames: [[10, 80]] })).toMatch(/past frame 79/);
    expect(errors({ bone: "hips", frames: [[30, 20]] })).toMatch(/ends before it starts/);
    expect(
      errors({
        bone: "hips",
        frames: [
          [10, 20],
          [21, 30],
        ],
      }),
    ).toMatch(/overlap or touch/);
  });

  it("flips the bone's subtree left to right on its frames and keeps the kept bones' drawing", () => {
    const plain = buildCharacter(fixturePlan(), fixtureLayout());
    const built = buildCharacter(
      withMirror({ bone: "hips", keep: ["head"], frames: [[20, 59]] }),
      fixtureLayout(),
    );
    const doc = built.document as unknown as {
      bones: { name: string; transform?: string }[];
      animations: Record<string, { bones: Record<string, { scale?: unknown[] }> }>;
    };
    // The fixture's hips point up, so left to right is the bone's y axis.
    expect(doc.animations.IDLE!.bones.hips!.scale).toEqual([
      { time: 0, x: 1, y: 1, curve: "stepped" },
      { time: 20 / 30, x: 1, y: -1, curve: "stepped" },
      { time: 60 / 30, x: 1, y: 1 },
    ]);
    expect(doc.bones.find((b) => b.name === "head")!.transform).toBe("noScaleOrReflection");
    expect(doc.bones.filter((b) => b.transform).map((b) => b.name)).toEqual(["head"]);

    const a = loadSkeleton(plain.document),
      b = loadSkeleton(built.document);
    for (const frame of [5, 19, 60, 79]) {
      // Outside the ranges nothing changes.
      expect(at(b, frame, "thigh_l").x).toBeCloseTo(at(a, frame, "thigh_l").x, 4);
      expect(at(b, frame, "hips").det).toBeGreaterThan(0);
    }
    for (const frame of [20, 40, 59]) {
      const hips = at(a, frame, "hips").x;
      // Inside, everything under the hips is reflected about their vertical line...
      for (const bone of ["thigh_l", "foot_r", "arm_r", "spine"]) {
        const p = at(a, frame, bone),
          q = at(b, frame, bone);
        expect(q.x).toBeCloseTo(2 * hips - p.x, 3);
        expect(q.y).toBeCloseTo(p.y, 3);
        expect(q.det).toBeLessThan(0);
      }
      // ...but the head is drawn the right way round where the reflected neck puts it.
      expect(at(b, frame, "head").det).toBeGreaterThan(0);
      expect(at(b, frame, "head").x).toBeCloseTo(2 * hips - at(a, frame, "head").x, 3);
      expect(at(b, frame, "hair_1").det).toBeGreaterThan(0);
    }
    expect(handoverNotes(built.rigging, built.animations)).toContain(
      "左右翻轉：第 20–59 幀 `hips`",
    );
  });

  it("refuses a bone that scales already, and a kept bone whose parent scales", () => {
    expect(() =>
      buildCharacter(withMirror({ bone: "thigh_l", frames: [[20, 59]] }), fixtureLayout()),
    ).toThrow(/PLAN_MIRROR_BONE|already scales/);
    // The legs' sink scales the thighs, so a foot cannot ignore its parents' scale.
    expect(() =>
      buildCharacter(
        withMirror({ bone: "hips", keep: ["foot_l"], frames: [[20, 59]] }),
        fixtureLayout(),
      ),
    ).toThrow(/no longer follow the scale of thigh_l/);
  });
});
