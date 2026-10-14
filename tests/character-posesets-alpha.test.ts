import { describe, expect, it } from "vitest";
import { buildCharacter, lintCharacterPlan, type CharacterLayout } from "@autospine/character";
import { drawList, headUnit, loadSkeleton, pose } from "@autospine/reference";
import { fixtureImagesOnly, fixtureLayout, fixturePlan } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("pose sets faded out in setup, odd cycles (2026-10 batch)", () => {
  it("shows a slot that setup keeps transparent, opaque for the animation", () => {
    // BuddhaEX: the dance arms and face sit at alpha 0 in setup; the animation fades them in.
    const layout = fixtureLayout() as CharacterLayout & {
      slots: { name: string; color?: string }[];
    };
    const slots = layout.slots.map((s) => (s.name === "Eyes" ? { ...s, color: "ffffff00" } : s));
    const faded = { ...layout, slots } as CharacterLayout;
    const plan = clone(fixturePlan());
    const visible = (p: typeof plan) => {
      const sk = loadSkeleton(buildCharacter(p, faded).document);
      pose(sk, "IDLE", 0.5);
      return drawList(sk).some((d) => d.slot === "Eyes");
    };
    expect(visible(plan)).toBe(false);
    plan.motion.animations[0]!.show = ["Eyes"];
    expect(visible(plan)).toBe(true);
  });

  it("measures the head unit on a head that setup keeps transparent", () => {
    const doc = fixtureImagesOnly() as unknown as { slots: { name: string; color?: string }[] };
    doc.slots.find((s) => s.name === "Head")!.color = "ffffff00";
    expect(headUnit(loadSkeleton(doc), "Head")).toBeCloseTo(80, 3);
  });

  it("builds an odd main cycle and odd cycle periods as a seamless loop", () => {
    // BuddhaEX pray and dig loops are 29 frames: one cycle, no even split.
    const plan = clone(fixturePlan());
    plan.motion.cycle = 41;
    plan.motion.animations[0]!.frames = 82;
    plan.motion.params.down = 20;
    plan.motion.params.hold = 5;
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const built = buildCharacter(plan, fixtureLayout());
    const sk = loadSkeleton(built.document);
    const at = (t: number) => {
      pose(sk, "IDLE", t);
      return drawList(sk).flatMap((d) => d.verts);
    };
    const a = at(0),
      b = at(82 / 30);
    expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))).toBeLessThan(0.01);
  });
});
