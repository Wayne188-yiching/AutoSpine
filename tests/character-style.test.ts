import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, lintCharacterPlan } from "@autospine/character";
import { loadSkeleton, pose } from "@autospine/reference";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { validation?: { id: string } }).validation?.id ?? (e as Error).message;
  }
  return "no error";
};
interface TranslateKey {
  time?: number;
  x?: number;
  y?: number;
}
interface Doc {
  animations: Record<string, { bones?: Record<string, { translate?: TranslateKey[] }> }>;
}
const frameOf = (k: { time?: number }) => Math.round((k.time ?? 0) * 30);
type Bone = { worldX: number; worldY: number };
const sampler = (document: unknown) => {
  const sk = loadSkeleton(document);
  return (frame: number, name: string): [number, number] => {
    pose(sk, "IDLE", frame / 30);
    const b = sk.skeleton.findBone(name)! as unknown as Bone;
    return [b.worldX, b.worldY];
  };
};

/** The fixture with a symmetric breath main cycle: rest, 5 px down at frame 20, rest at 40. */
const breathPlan = (depth = 5) => {
  const plan = clone(fixturePlan());
  const m = plan.motion;
  m.main = { id: "body", bone: "hips", channel: "translate", shape: "breath", down: 20, depth };
  for (const b of m.beats!) {
    delete b.up;
    delete b.hold;
  }
  return plan;
};

describe("symmetric breath main cycle", () => {
  it("keys rest and one extreme per cycle, sine both ways, scaled per cycle", () => {
    const plan = breathPlan();
    expect(lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors).toEqual([]);
    const built = buildCharacter(plan, fixtureLayout());
    const hips = (built.document as unknown as Doc).animations.IDLE!.bones!.hips!.translate!;
    expect(hips.map(frameOf)).toEqual([0, 20, 40, 60, 80]);
    // IR y-down 5 px is Spine -5; cycle 2 is scaled by cycleScale 0.8.
    expect(hips.map((k) => (k.y ?? 0) + 0)).toEqual([0, -5, 0, -4, 0]);
    const at = sampler(built.document);
    const y = (f: number) => at(f, "hips")[1];
    // Symmetric: the way down mirrors the way back.
    for (const d of [3, 7, 12, 17]) expect(y(20 - d)).toBeCloseTo(y(20 + d), 4);
    expect(y(20) - y(0)).toBeCloseTo(-5, 4);
  });

  it("slides the face with the body in both directions", () => {
    const down = buildCharacter(breathPlan(5), fixtureLayout()).document as unknown as Doc;
    const up = buildCharacter(breathPlan(-5), fixtureLayout()).document as unknown as Doc;
    const faceY = (doc: Doc) => doc.animations.IDLE!.bones!.face_ctl!.translate![1]!;
    // The fixture face sink is y: 2, x: 0.5 at full depth.
    expect(frameOf(faceY(down))).toBe(20);
    expect(Math.sign(faceY(down).y!)).toBe(-Math.sign(faceY(up).y!));
    expect(Math.abs(faceY(down).y!)).toBeCloseTo(Math.abs(faceY(up).y!), 4);
  });

  it("lints a settle cycle without its beats and warns on what a breath ignores", () => {
    const plan = breathPlan();
    plan.motion.main.up = 4;
    plan.motion.beats![0]!.hold = 2;
    const lint = lintCharacterPlan(plan);
    expect(lint.warnings.join("\n")).toMatch(/a breath ignores up/);
    expect(lint.warnings.join("\n")).toMatch(/a breath keys only rest and down/);
    const settle = breathPlan();
    delete settle.motion.main.shape;
    expect(lintCharacterPlan(settle).errors.join("\n")).toMatch(/a settle cycle needs up/);
    expect(code(() => buildCharacter(settle, fixtureLayout()))).toBe("PLAN_MOTION_TIMING");
  });
});

describe("saccade looks on keyed controls", () => {
  const lookPlan = (keys: { frame: number; value: [number, number] }[], move = 3) => {
    const plan = breathPlan();
    plan.motion.keyed = [
      {
        id: "look",
        bone: "eyes",
        channel: "translate",
        rest: [0, 0],
        move,
        keys: { IDLE: keys.map((k) => ({ ...k, ease: "out" as const })) },
      },
    ];
    return plan;
  };

  it("holds each look, moves in `move` frames and closes the loop with one more move", () => {
    const plan = lookPlan([
      { frame: 10, value: [1, 0] },
      { frame: 30, value: [-1, 0] },
    ]);
    expect(lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors).toEqual([]);
    const doc = buildCharacter(plan, fixtureLayout()).document as unknown as Doc;
    const eyes = doc.animations.IDLE!.bones!.eyes!.translate!;
    expect(eyes.map(frameOf)).toEqual([0, 10, 13, 30, 33, 77, 80]);
    expect(eyes.map((k) => +(k.x ?? 0).toFixed(3))).toEqual([0, 0, 1, 1, -1, -1, 0]);
  });

  it("needs no closing move when the last look returns to rest", () => {
    const doc = buildCharacter(
      lookPlan([
        { frame: 10, value: [1, 0] },
        { frame: 50, value: [0, 0] },
      ]),
      fixtureLayout(),
    ).document as unknown as Doc;
    const eyes = doc.animations.IDLE!.bones!.eyes!.translate!;
    expect(eyes.map(frameOf)).toEqual([0, 10, 13, 50, 53, 80]);
  });

  it("rejects overlapping looks and looks without room to close", () => {
    const overlap = lookPlan([
      { frame: 10, value: [1, 0] },
      { frame: 11, value: [-1, 0] },
    ]);
    expect(lintCharacterPlan(overlap).errors.join("\n")).toMatch(/starts before the previous/);
    expect(code(() => buildCharacter(overlap, fixtureLayout()))).toBe("PLAN_MOTION_TIMING");
    const late = lookPlan([{ frame: 76, value: [1, 0] }]);
    expect(lintCharacterPlan(late).errors.join("\n")).toMatch(/after the last look/);
    expect(code(() => buildCharacter(late, fixtureLayout()))).toBe("PLAN_MOTION_TIMING");
  });
});

describe("follow travel", () => {
  const travelPlan = (follow: NonNullable<CharacterPlan["motion"]["follow"]>[number]) => {
    const plan = breathPlan();
    plan.motion.cycles = [];
    plan.motion.params.armAmp = 0;
    plan.motion.follow = [...plan.motion.follow!, follow];
    return plan;
  };

  it("moves the `to` bone by travel x the main's vertical travel", () => {
    const plan = travelPlan({
      id: "armF",
      bone: "arm_r",
      channel: "rotate",
      travel: 0.8,
      to: "forearm_r",
      lag: 0,
    });
    const built = buildCharacter(plan, fixtureLayout());
    const at = sampler(built.document);
    const rel = (f: number) => {
      const s = at(f, "arm_r"),
        e = at(f, "forearm_r");
      return [e[0] - s[0], e[1] - s[1]];
    };
    const r0 = rel(0),
      r1 = rel(20),
      main = Math.abs(at(20, "hips")[1] - at(0, "hips")[1]);
    expect(main).toBeCloseTo(5, 3);
    // A small rotation: the chord matches the arc to well under a percent.
    expect(Math.hypot(r1[0]! - r0[0]!, r1[1]! - r0[1]!) / main).toBeCloseTo(0.8, 2);
  });

  it("moves a `to` beside the pivot with the body for a positive travel", () => {
    const drop = (travel: number) => {
      const at = sampler(
        buildCharacter(
          travelPlan({
            id: "spineF",
            bone: "spine",
            channel: "rotate",
            travel,
            to: "arm_r",
            lag: 0,
          }),
          fixtureLayout(),
        ).document,
      );
      const rel = (f: number) => [
        at(f, "arm_r")[0] - at(f, "spine")[0],
        at(f, "arm_r")[1] - at(f, "spine")[1],
      ];
      expect(Math.abs(rel(0)[0]!)).toBeGreaterThan(5); // the shoulder sits beside the pivot
      return rel(20)[1]! - rel(0)[1]!; // Spine y up: negative is down
    };
    expect(drop(0.5)).toBeLessThan(-0.3);
    expect(drop(-0.5)).toBeGreaterThan(0.3);
  });

  it("needs exactly one of gain and travel, and travel needs to on a rotate control", () => {
    const both = travelPlan({
      id: "armF",
      bone: "arm_r",
      channel: "rotate",
      gain: 1,
      travel: 1,
      to: "forearm_r",
      lag: 0,
    });
    expect(lintCharacterPlan(both).errors.join("\n")).toMatch(/exactly one of gain and travel/);
    expect(code(() => buildCharacter(both, fixtureLayout()))).toBe("PLAN_MOTION_FOLLOW");
    const noTo = travelPlan({ id: "armF", bone: "arm_r", channel: "rotate", travel: 1, lag: 0 });
    expect(lintCharacterPlan(noTo).errors.join("\n")).toMatch(/travel needs a rotate control/);
    expect(code(() => buildCharacter(noTo, fixtureLayout()))).toBe("PLAN_MOTION_FOLLOW");
  });
});
