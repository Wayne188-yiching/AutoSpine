import { describe, expect, it } from "vitest";
import { buildCharacter, handoverNotes, lintCharacterPlan } from "@autospine/character";
import { drawList, loadSkeleton, pose } from "@autospine/reference";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

describe("attachment swaps inside an animation (ADR-027)", () => {
  it("hides and shows a slot at keyed frames, held to the end", () => {
    const plan = fixturePlan();
    // A blink: the eyes go away on frame 30 and come back on frame 34.
    plan.motion.swaps = [
      {
        slot: "Eyes",
        keys: {
          IDLE: [
            { frame: 30, attachment: null },
            { frame: 34, attachment: "Eyes" },
          ],
        },
      },
    ];
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const built = buildCharacter(plan, fixtureLayout());
    const sk = loadSkeleton(built.document);
    const shown = (frame: number) => {
      pose(sk, "IDLE", frame / 30);
      return drawList(sk).some((d) => d.slot === "Eyes");
    };
    expect([shown(0), shown(29), shown(31), shown(33), shown(35), shown(80)]).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(handoverNotes(built.rigging, built.animations)).toContain("換圖：`Eyes`");
    plan.motion.swaps[0]!.keys.IDLE!.push({ frame: 999, attachment: null });
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/past the end/);
    plan.motion.swaps = [{ slot: "Eyes", keys: { IDLE: [{ frame: 5, attachment: "Ghost" }] } }];
    expect(() => buildCharacter(plan, fixtureLayout())).toThrow(/no attachment Ghost/);
  });
});
