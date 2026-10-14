import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import {
  buildCharacter,
  lintCharacterPlan,
  type CharacterLayout,
  type CharacterPart,
} from "@autospine/character";
import { readImagesOnlyLayout } from "@autospine/spine";
import { drawList, headUnit, loadSkeleton, pose } from "@autospine/reference";
import { fixtureImagesOnly, fixturePlan, fixtureRgba } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { validation?: { id: string } }).validation?.id ?? (e as Error).message;
  }
  return "no error";
};

/**
 * The fixture plus a "Cane" slot hidden in setup (another pose set): one attachment drawn with the
 * arm's pixels, beside the body. `extra` adds a second hidden attachment to make `show` ambiguous.
 */
function hiddenSetLayout(extra = false) {
  const doc = fixtureImagesOnly() as ReturnType<typeof fixtureImagesOnly> & {
    slots: { name: string; bone: string; attachment?: string }[];
  };
  doc.slots.push({ name: "Cane", bone: "root" });
  const skin = doc.skins[0]!.attachments as Record<string, Record<string, object>>;
  skin.Cane = {
    cane: { path: "Arm_R", x: -70, y: 120, width: 16, height: 90 },
    ...(extra ? { cane2: { path: "Arm_R", x: -90, y: 120, width: 16, height: 90 } } : {}),
  };
  const read = readImagesOnlyLayout(doc);
  const parts = new Map<string, CharacterPart>();
  for (const a of read.attachments) {
    const { width, height, rgba } = fixtureRgba(a.path);
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    parts.set(a.key, { ...a, alpha });
  }
  const layout: CharacterLayout = { slots: read.slots, parts, skeleton: read.skeleton };
  return { doc, layout };
}
/** A cane bone rigged on the hidden part (by slot name), shown in IDLE in place of the arm. */
function canePlan(): CharacterPlan {
  const plan = clone(fixturePlan());
  plan.joints.caneTop = { rule: "axisEnd", part: "Cane", pick: "top" };
  plan.joints.caneEnd = { rule: "axisEnd", part: "Cane", pick: "far", ref: "caneTop" };
  plan.bones.push({ id: "cane", parent: "spine", at: "caneTop", to: "caneEnd" });
  plan.regions = { ...plan.regions, Cane: "cane" };
  plan.motion.animations[0]!.show = ["Cane"];
  plan.motion.animations[0]!.hide = ["Arm_R"];
  plan.motion.keyed!.push({
    id: "caneSwing",
    bone: "cane",
    channel: "rotate",
    rest: 0,
    keys: { IDLE: [{ frame: 40, value: 6, ease: "sine" }] },
  });
  return plan;
}
interface Doc {
  animations: Record<
    string,
    { slots?: Record<string, { attachment?: { time?: number; name: string | null }[] }> }
  >;
}

describe("part sets per animation (ADR-021)", () => {
  it("rigs a part hidden in setup by its slot name and shows it only in its animation", () => {
    const { layout } = hiddenSetLayout();
    expect(layout.parts.has("Cane")).toBe(false);
    expect(layout.parts.has("Cane#cane")).toBe(true);
    const plan = canePlan();
    expect(lintCharacterPlan(plan, layout.parts.keys()).errors).toEqual([]);
    const built = buildCharacter(plan, layout);
    const doc = built.document as unknown as Doc;
    const slots = doc.animations.IDLE!.slots!;
    expect(slots.Cane!.attachment!.map((k) => k.name)).toEqual(["cane", "cane"]);
    expect(slots.Arm_R!.attachment!.map((k) => k.name)).toEqual([null, null]);
    const sk = loadSkeleton(built.document);
    pose(sk, null, 0);
    const setup = drawList(sk).map((d) => d.slot);
    expect(setup).toContain("Arm_R");
    expect(setup).not.toContain("Cane");
    pose(sk, "IDLE", 40 / 30);
    const idle = drawList(sk);
    expect(idle.map((d) => d.slot)).not.toContain("Arm_R");
    // The hidden part sits where the images-only layout placed it and swings on its own bone.
    const cane = idle.find((d) => d.slot === "Cane")!;
    const xs = cane.verts.filter((_, i) => i % 2 === 0);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThan(-50);
    pose(sk, "IDLE", 0);
    const rest = drawList(sk).find((d) => d.slot === "Cane")!.verts;
    expect(rest.some((v, i) => Math.abs(v - cane.verts[i]!) > 1)).toBe(true);
  });

  it("measures a head hidden in setup on its own attachment", () => {
    const { doc } = hiddenSetLayout();
    expect(headUnit(loadSkeleton(doc), "Cane")).toBeCloseTo(16, 3);
    expect(headUnit(loadSkeleton(doc), "Head")).toBeCloseTo(80, 3);
  });

  it("rejects ambiguous, unknown and repeated part-set entries", () => {
    const { layout } = hiddenSetLayout(true);
    const plan = canePlan();
    plan.joints.caneTop = { rule: "axisEnd", part: "Cane#cane", pick: "top" };
    plan.joints.caneEnd = { rule: "axisEnd", part: "Cane#cane", pick: "far", ref: "caneTop" };
    plan.motion.animations[0]!.hide = ["Arm_R", "Ghost", "Cane"];
    const errors = lintCharacterPlan(plan, layout.parts.keys()).errors.join("\n");
    expect(errors).toMatch(/show Cane needs one attachment/);
    expect(errors).toMatch(/hide names unknown slot Ghost/);
    expect(errors).toMatch(/slot Cane is listed twice/);
    plan.motion.animations[0]!.hide = ["Arm_R"];
    expect(code(() => buildCharacter(plan, layout))).toBe("PLAN_PART_SET");
    plan.motion.animations[0]!.show = ["Cane#cane2"];
    expect(lintCharacterPlan(plan, layout.parts.keys()).errors).toEqual([]);
    const doc = buildCharacter(plan, layout).document as unknown as Doc;
    expect(doc.animations.IDLE!.slots!.Cane!.attachment!.map((k) => k.name)).toEqual([
      "cane2",
      "cane2",
    ]);
  });
});
