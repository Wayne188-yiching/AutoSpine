import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, lintCharacterPlan } from "@autospine/character";
import {
  MOTION_PRIORS,
  clapPose,
  clapRecipe,
  isWeakPrior,
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

describe("weak single-art priors from the mummy cat (ADR-045)", () => {
  it("marks one-art priors weak and leaves the batch priors as they were", () => {
    for (const kind of ["clap", "entryRise", "idleHands", "walk", "look"] as const)
      expect(isWeakPrior(kind), kind).toBe(true);
    for (const kind of ["idle", "entry", "jump"] as const)
      expect(isWeakPrior(kind), kind).toBe(false);
    const pop = oneShotTemplate("01_In", { frames: 40, unit: 100, subject: "character" });
    expect(pop.weak).toBe(false);
    expect([pop.body, pop.arms]).toEqual([undefined, undefined]);
  });

  it("claps four times per sway, the hands meeting between the shoulders", () => {
    const r = clapRecipe(100);
    expect(r).toMatchObject({
      weak: true,
      beatFrames: 15,
      beatsPerSway: 4,
      contactFrame: 8,
      dip: 4.7,
      open: { reach: 0.98, aboveShoulderDeg: 7.2 },
      contact: { gap: 20.9, belowShoulder: 2.8 },
    });
    const arms = {
      l: { shoulder: [-50, -200] as [number, number], reach: 40 },
      r: { shoulder: [50, -200] as [number, number], reach: 40 },
    };
    const at = (f: number) => clapPose(r, f, arms);
    for (const f of [8, 23, 38, 53]) {
      const p = at(f);
      expect(p.contact, `frame ${f}`).toBeCloseTo(1, 2);
      expect(p.wrist.r[0] - p.wrist.l[0]).toBeCloseTo(20.9, 1);
      expect(p.wrist.l[1]).toBeCloseTo(-197.2, 1);
      expect(p.dip).toBeCloseTo(4.7, 1);
    }
    // Open half a frame in: nearly the full arm, just above the shoulder line, inside the reach.
    const open = at(0.5);
    expect(open.contact).toBe(0);
    expect(open.wrist.l[0]).toBeCloseTo(-50 - 39.2 * Math.cos((7.2 * Math.PI) / 180), 1);
    expect(open.wrist.l[1]).toBeLessThan(-200);
    expect(Math.hypot(open.wrist.r[0] - 50, open.wrist.r[1] + 200)).toBeLessThanOrEqual(
      39.2 + 0.01,
    );
    // Counter-clockwise for the first two claps, clockwise for the last two; the loop closes.
    expect(at(8).leanDeg).toBeLessThan(-15);
    expect(at(38).leanDeg).toBeGreaterThan(15);
    expect(Math.abs(at(8).leanDeg)).toBeGreaterThan(Math.abs(at(15).leanDeg));
    for (const k of ["sway", "contact", "leanDeg", "dip"] as const)
      expect(at(60)[k], k).toBeCloseTo(at(0)[k], 6);
    expect(code(() => clapRecipe(0))).toBe("PRIOR_UNIT");
  });

  it("enters by rising and squashing, without scale or fade, when asked for", () => {
    const t = oneShotTemplate("01_In", {
      frames: 30,
      unit: 100,
      subject: "character",
      entry: "rise",
    });
    expect(t.weak).toBe(true);
    expect([t.scale, t.alpha, t.rotate]).toEqual([[], [], []]);
    expect(t.translate).toEqual([
      { frame: 0, value: [0, 133] },
      { frame: 10, value: [0, -1.9], ease: "out" },
      { frame: 18, value: [0, 1.1], ease: "sine" },
      { frame: 30, value: [0, 0], ease: "sine" },
    ]);
    const b = t.body!;
    // IR px, y down: the chest squashes at 0.67, the head 2 frames later and further.
    expect(b.chest.find((k) => k.frame === 20)!.value).toBe(8.7);
    expect(b.head.find((k) => k.frame === 22)!.value).toBe(14.7);
    expect(b.face.map((k) => [k.frame, k.value])).toEqual([
      [0, 28.3],
      [4, 28.3],
      [14, -13.1],
      [22, 15.4],
      [30, 0],
    ]);
    expect(b.tilt[0]!.value).toBe(-18);
    // Arms: flung above the shoulders by 0.3, dropped below them on the landing, inside the arm.
    const [start, peak, low] = t.arms!;
    expect(peak!.frame).toBe(9);
    expect(peak!.value[1]).toBeLessThan(0);
    expect(low!.value[1]).toBeGreaterThan(0);
    for (const k of [start!, peak!, low!]) expect(Math.hypot(...k.value)).toBeLessThanOrEqual(0.98);
    expect(t.swing.limbDeg).toBe(0);
  });

  it("keeps rise-entry key frames strictly increasing inside short animations", () => {
    for (const frames of [2, 5, 9, 14, 60]) {
      const t = oneShotTemplate("In", { frames, unit: 80, subject: "character", entry: "rise" });
      for (const keys of [
        t.translate,
        t.body!.tilt,
        t.body!.chest,
        t.body!.head,
        t.body!.face,
        t.arms!,
      ]) {
        const f = keys.map((k) => k.frame);
        expect(
          f.every((x, i) => x >= 0 && x <= frames && (i === 0 || x > f[i - 1]!)),
          `${frames}`,
        ).toBe(true);
      }
    }
  });

  it("lets free idle hands follow at travel 1 unless the bob is asked for", () => {
    expect(loopRecipe("idle", 100).hand).toEqual({
      travel: 1,
      lag: 2,
      twicePerBreath: 0,
      palmDeg: 0,
      weak: false,
    });
    expect(loopRecipe("idle", 100, { handBob: true }).hand).toEqual({
      travel: 2.6,
      lag: 5,
      twicePerBreath: 5.4,
      palmDeg: 33.2,
      weak: true,
    });
    expect(loopRecipe("walk", 100).hand).toBeUndefined();
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
