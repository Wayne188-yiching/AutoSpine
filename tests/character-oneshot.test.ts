import { describe, expect, it } from "vitest";
import { buildCharacter, handoverNotes, lintCharacterPlan } from "@autospine/character";
import { checkAcceptance, compareToReference, prepareReference } from "@autospine/reference";
import { fixtureImagesOnly, fixtureLayout, fixturePlan } from "./character-fixture.js";

type Doc = {
  animations: Record<
    string,
    {
      bones?: Record<string, Record<string, { time?: number; x?: number; y?: number }[]>>;
      slots?: Record<
        string,
        { attachment?: { name: string | null }[]; rgba?: { color: string }[] }
      >;
    }
  >;
};

/** An entry: the spine grows in, the body fades in, the eyes appear on frame 10 and stay. */
function entryPlan(loop: boolean) {
  const plan = fixturePlan();
  plan.motion.animations = [{ name: "IN", frames: 40, loop }];
  plan.motion.keyed = [
    {
      id: "grow",
      bone: "spine",
      channel: "scale",
      rest: [1, 1],
      keys: {
        IN: [
          { frame: 0, value: [0.2, 0.2] },
          { frame: 20, value: [1.1, 1.1], ease: "out" },
          { frame: 30, value: [1, 1] },
        ],
      },
    },
  ];
  plan.motion.swaps = [
    {
      slot: "Eyes",
      keys: {
        IN: [
          { frame: 0, attachment: null },
          { frame: 10, attachment: "Eyes" },
        ],
      },
    },
  ];
  plan.motion.colors = [
    {
      id: "fade",
      slots: ["Body"],
      keys: {
        IN: [
          { frame: 0, alpha: 0 },
          { frame: 15, alpha: 1 },
        ],
      },
    },
  ];
  // A flicker period that does not divide the 40 frames: allowed in a one-shot only.
  plan.motion.pulses = [{ id: "flick", slots: ["Arm_R"], low: 0.5, high: 1, period: 15 }];
  return plan;
}

describe("one-shot animations (ADR-030)", () => {
  it("ends on its last values instead of closing back to frame 0", () => {
    const plan = entryPlan(false);
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const built = buildCharacter(plan, fixtureLayout());
    const a = (built.document as unknown as Doc).animations.IN!;
    expect(a.slots!.Eyes!.attachment!.map((k) => k.name)).toEqual([null, "Eyes", "Eyes"]);
    expect(a.slots!.Body!.rgba!.at(-1)!.color.slice(6)).toBe("ff");
    const scale = a.bones!.spine!.scale!;
    expect(scale[0]!.x).toBeCloseTo(0.2, 3);
    expect(scale.at(-1)!.x).toBeCloseTo(1, 3);
    // The main motion has no next cycle to return through: it ends at rest.
    const hips = a.bones!.hips!.translate!;
    expect(hips.at(-1)!.y ?? 0).toBeCloseTo(hips[0]!.y ?? 0, 3);
    expect(handoverNotes(built.rigging, built.animations)).toContain("單次動畫");
  });

  it("keeps the loop rules for loops", () => {
    const plan = entryPlan(true);
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/period 15 does not divide IN/);
    plan.motion.pulses = [];
    const a = (buildCharacter(plan, fixtureLayout()).document as unknown as Doc).animations.IN!;
    expect(a.slots!.Eyes!.attachment!.at(-1)!.name).toBeNull();
    expect(a.slots!.Body!.rgba!.at(-1)!.color.slice(6)).toBe("00");
  });

  it("skips the loop seam of a one-shot in the comparison", () => {
    const plan = entryPlan(false);
    const built = buildCharacter(plan, fixtureLayout());
    const probes = plan.qa!.probes!;
    const options = { probes, loop: [] as string[] };
    const reference = prepareReference(built.document, fixtureImagesOnly(), options);
    const { result } = compareToReference(reference, built.document, fixtureImagesOnly(), options);
    expect(result.engineering.oneShots).toEqual(["IN"]);
    const check = checkAcceptance(result, built.seams);
    expect(check.rows.some((r) => r.id.startsWith("A4"))).toBe(false);
    expect(check.rows.filter((r) => !r.ok)).toEqual([]);
  });
});
