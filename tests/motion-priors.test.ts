import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, lintCharacterPlan } from "@autospine/character";
import {
  MOTION_PRIORS,
  loopRecipe,
  oneShotKind,
  oneShotTemplate,
  type OneShotKind,
} from "@autospine/motion";
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
type Bone = { worldX: number; worldY: number };
const sampler = (document: unknown, animation: string) => {
  const sk = loadSkeleton(document);
  return (frame: number | null, name: string): [number, number] => {
    pose(sk, frame === null ? null : animation, frame === null ? 0 : frame / 30);
    const b = sk.skeleton.findBone(name)! as unknown as Bone;
    return [b.worldX, b.worldY];
  };
};

describe("measured motion priors (ADR-032)", () => {
  it("keeps every median inside its range and counts its evidence", () => {
    for (const [kind, prior] of Object.entries(MOTION_PRIORS)) {
      expect(prior.animations, kind).toBeGreaterThan(0);
      expect(prior.arts, kind).toBeGreaterThan(0);
      expect(prior.arts, kind).toBeLessThanOrEqual(prior.animations);
      for (const [name, stat] of Object.entries(prior)) {
        if (typeof stat !== "object") continue;
        expect(stat.min, `${kind}.${name}`).toBeLessThanOrEqual(stat.median);
        expect(stat.median, `${kind}.${name}`).toBeLessThanOrEqual(stat.max);
      }
    }
    // The idle hips move less than the ADR-019 torso median (0.14 hw); the head trails them.
    expect(MOTION_PRIORS.idle.pelvisHw.median).toBeLessThan(0.14);
    expect(MOTION_PRIORS.idle.headLagFrames.median).toBeGreaterThan(0);
  });

  it("chooses the pre-registered template from the animation name", () => {
    const names: [string, OneShotKind][] = [
      ["01_In", "entry"],
      ["In", "entry"],
      ["into", "entry"],
      ["Buddha03_LuckyBagAppear", "entry"],
      ["07 Out", "exit"],
      ["out", "exit"],
      ["Win", "jump"],
      ["Win_2", "jump"],
      ["@_JumpDraw", "jump"],
      ["WC_Goal", "jump"],
      ["PoolEnergy", "charge"],
      ["Press", "press"],
      ["Walk_LV1-LV2", "levelup"],
      ["History/_Look", "look"],
      // Whole words only: a coin, a dragon and a dig-out are transitions.
      ["Buddha11_Coin", "transition"],
      ["Buddha09_GoldenDragon", "transition"],
      ["Buddha07_DigOut_01", "transition"],
      ["05_Blow_End", "transition"],
      ["Collapse", "transition"],
    ];
    for (const [name, kind] of names) expect(oneShotKind(name), name).toBe(kind);
  });

  it("makes a character jump dip, hop and land in the first third", () => {
    const t = oneShotTemplate("Win", { frames: 60, unit: 100, subject: "character" });
    const j = MOTION_PRIORS.jump;
    // IR px, y down: the dip is down, the hop up, landed at 0.32 of the frames.
    expect(t.translate.slice(0, 4)).toEqual([
      { frame: 0, value: [0, 0] },
      { frame: 8, value: [0, 15.6], ease: "sine" },
      { frame: 15, value: [11, -35.7], ease: "out" },
      { frame: 19, value: [0, 0], ease: "in" },
    ]);
    expect(t.scale).toEqual([]);
    expect(t.swing.limbDeg).toBe(j.limbDeg.median);
    expect(t.swing.strandDeg).toBe(j.strandDeg.median);
    expect(t.keyEvery).toBe(j.keyGapFrames.median);
  });

  it("brings characters in from below, keeps their alpha on exits, and only fades props", () => {
    const opts = { frames: 40, unit: 100, subject: "character" as const };
    const entry = oneShotTemplate("01_In", opts);
    expect(entry.scale[0]!.value).toEqual([0.48, 0.48]);
    expect(entry.scale.at(-1)!.value).toEqual([1, 1]);
    expect(entry.translate[0]!.value).toEqual([0, 62]);
    expect(entry.translate.at(-1)!.value).toEqual([0, 0]);
    expect(entry.alpha.map((k) => k.alpha)).toEqual([0.51, 1]);

    const exit = oneShotTemplate("07 Out", opts);
    expect(exit.alpha).toEqual([]);
    expect(exit.translate.at(-1)).toEqual({ frame: 40, value: [0, 70], ease: "in" });
    expect(exit.scale.at(-1)!.value).toEqual([0.51, 0.51]);
    expect(exit.translate[1]!.frame).toBeLessThanOrEqual(Math.round(0.3 * 40));

    const charge = oneShotTemplate("PoolEnergy", opts);
    expect(charge.scale).toEqual([]);
    expect(Math.max(...charge.rotate.map((k) => k.value))).toBeCloseTo(
      MOTION_PRIORS.charge.tiltDeg.median / 2,
      1,
    );

    const prop = { ...opts, subject: "prop" as const };
    const fadeIn = oneShotTemplate("In", prop);
    expect([fadeIn.translate, fadeIn.scale, fadeIn.rotate]).toEqual([[], [], []]);
    expect(fadeIn.alpha.map((k) => k.alpha)).toEqual([0, 1]);
    for (const name of ["Jump", "PoolEnergy", "Press", "Collapse"]) {
      const still = oneShotTemplate(name, prop);
      expect([still.translate, still.scale, still.rotate, still.alpha], name).toEqual([
        [],
        [],
        [],
        [],
      ]);
    }
  });

  it("keeps key frames strictly increasing inside short animations", () => {
    const names = ["In", "Out", "Win", "PoolEnergy", "Press", "LV1-LV2", "Look", "Pray"];
    for (const frames of [2, 5, 9, 14, 60])
      for (const name of names)
        for (const subject of ["character", "prop"] as const) {
          const t = oneShotTemplate(name, { frames, unit: 80, subject });
          for (const keys of [t.translate, t.scale, t.rotate, t.head, t.alpha]) {
            const f = keys.map((k) => k.frame);
            expect(f.every((x, i) => x >= 0 && x <= frames && (i === 0 || x > f[i - 1]!))).toBe(
              true,
            );
          }
        }
    expect(code(() => oneShotTemplate("Win", { frames: 1, unit: 80, subject: "prop" }))).toBe(
      "PRIOR_FRAMES",
    );
    expect(code(() => oneShotTemplate("Win", { frames: 30, unit: 0, subject: "prop" }))).toBe(
      "PRIOR_UNIT",
    );
  });

  it("states loop recipes in plan terms", () => {
    expect(loopRecipe("idle", 100)).toMatchObject({
      depth: 6,
      head: { gain: 0.7, lag: 8 },
      strandAmplitude: 8.15,
      strandStep: 2,
      cycleSeconds: 2,
    });
    expect(loopRecipe("walk", 100)).toMatchObject({ depth: 33.6, bobsPerCycle: 2 });
    expect(loopRecipe("prop", 100).depth).toBe(0);
    expect(code(() => loopRecipe("idle", Number.NaN))).toBe("PRIOR_UNIT");
  });

  it("carries a jump template through a one-shot plan into the build", () => {
    const plan = clone(fixturePlan());
    const N = 60;
    const t = oneShotTemplate("Win", { frames: N, unit: 40, subject: "character" });
    plan.motion.cycle = N;
    plan.motion.animations = [{ name: "Win", frames: N, loop: false }];
    plan.motion.main = {
      id: "body",
      bone: "hips",
      channel: "translate",
      shape: "breath",
      down: 30,
      depth: 1,
    };
    plan.motion.beats = [];
    plan.motion.keyed = [
      {
        id: "jumpT",
        bone: "spine",
        channel: "translate",
        rest: [0, 0],
        keys: { Win: t.translate },
      },
      { id: "jumpR", bone: "spine", channel: "rotate", rest: 0, keys: { Win: t.rotate } },
    ];
    expect(lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors).toEqual([]);
    const at = sampler(buildCharacter(plan, fixtureLayout()).document, "Win");
    const rel = (f: number | null) => at(f, "spine")[1] - at(f, "hips")[1];
    // Spine world is y up: the template's IR dip (down) and hop (up) flip sign.
    expect(rel(8) - rel(null)).toBeCloseTo(-t.translate[1]!.value[1], 1);
    expect(rel(15) - rel(null)).toBeCloseTo(-t.translate[2]!.value[1], 1);
    expect(rel(19) - rel(null)).toBeCloseTo(0, 1);
  });
});

describe("translate follow (ADR-032)", () => {
  /** The fixture with a breath on the hips and the head trailing them. */
  /** `patch` overrides fields of the head follow, including ones the schema would refuse. */
  const trailingHead = (patch: Record<string, unknown> = {}) => {
    const plan = clone(fixturePlan());
    const m = plan.motion;
    m.main = {
      id: "body",
      bone: "hips",
      channel: "translate",
      shape: "breath",
      down: 20,
      depth: 5,
    };
    for (const b of m.beats!) {
      delete b.up;
      delete b.hold;
    }
    m.follow = [
      { id: "headT", bone: "head", channel: "translate", gain: 0.7, lag: 8, ...patch },
    ] as CharacterPlan["motion"]["follow"];
    return plan;
  };
  it("moves the head gain times the main, lag frames later", () => {
    const plan = trailingHead();
    expect(lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors).toEqual([]);
    const at = sampler(buildCharacter(plan, fixtureLayout()).document, "IDLE");
    const dy = (f: number | null, bone: string) => at(f, bone)[1] - at(null, bone)[1];
    for (const f of [0, 8, 14, 20, 28, 33, 47, 60, 72]) {
      const extra = dy(f, "head") - dy(f, "hips");
      expect(extra, `frame ${f}`).toBeCloseTo(0.7 * dy((f - 8 + 80) % 80, "hips"), 2);
    }
    // The head travels further than the hips and peaks later.
    const ys = Array.from({ length: 40 }, (_, f) => [dy(f, "hips"), dy(f, "head")] as const);
    const low = (k: 0 | 1) => ys.reduce((b, y, f) => (y[k] < ys[b]![k] ? f : b), 0);
    expect(Math.abs(ys[low(1)]![1])).toBeGreaterThan(1.5 * Math.abs(ys[low(0)]![0]));
    expect(low(1)).toBeGreaterThan(low(0));
  });
  it("lints and refuses follows a translate or scale control cannot take", () => {
    const travel = trailingHead({ gain: undefined, travel: 0.5, to: "eyes" });
    expect(lintCharacterPlan(travel).errors.join("\n")).toMatch(/travel needs a rotate control/);
    expect(code(() => buildCharacter(travel, fixtureLayout()))).toBe("PLAN_MOTION_FOLLOW");
    const scale = trailingHead({ channel: "scale" });
    expect(lintCharacterPlan(scale).errors.join("\n")).toMatch(/rotate or translate control/);
    const rotateMain = trailingHead();
    rotateMain.motion.main = { ...rotateMain.motion.main, channel: "rotate", bone: "spine" };
    expect(lintCharacterPlan(rotateMain).errors.join("\n")).toMatch(/needs a translate main/);
  });
});
