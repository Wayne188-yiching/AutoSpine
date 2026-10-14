import { describe, expect, it } from "vitest";
import { buildCharacter, handoverNotes, lintCharacterPlan } from "@autospine/character";
import { deformationQA, drawList, loadSkeleton, pose } from "@autospine/reference";
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
  it("closes a loop on its frame-0 attachment", () => {
    const plan = fixturePlan();
    // Hidden from frame 0, shown from frame 40: the last frame wraps back to hidden.
    plan.motion.swaps = [
      {
        slot: "Eyes",
        keys: {
          IDLE: [
            { frame: 0, attachment: null },
            { frame: 40, attachment: "Eyes" },
          ],
        },
      },
    ];
    const sk = loadSkeleton(buildCharacter(plan, fixtureLayout()).document);
    const end = sk.data.findAnimation("IDLE")!.duration;
    const shown = (time: number) => {
      pose(sk, "IDLE", time);
      return drawList(sk).some((d) => d.slot === "Eyes");
    };
    expect([shown(0), shown(41 / 30), shown(end - 1 / 30), shown(end)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("measures a swapped-in image against its own geometry", () => {
    // One slot, two images of different shapes; the animation swaps to the second at 0.5 s.
    const region = (width: number, height: number) => ({ width, height });
    const sk = loadSkeleton({
      skeleton: { spine: "4.0.64" },
      bones: [{ name: "root" }],
      slots: [{ name: "ball", bone: "root", attachment: "a" }],
      skins: [
        { name: "default", attachments: { ball: { a: region(100, 100), b: region(20, 200) } } },
      ],
      animations: {
        loop: {
          slots: {
            ball: {
              attachment: [
                { time: 0, name: "a" },
                { time: 0.5, name: "b" },
                { time: 1, name: "a" },
              ],
            },
          },
        },
      },
    });
    const qa = deformationQA(sk, "loop", 30, undefined, []);
    expect(qa.inversions).toEqual({});
    expect(qa.maxCharacterStretch?.value ?? 0).toBeLessThan(1e-6);
  });
});
