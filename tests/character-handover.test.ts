import { describe, expect, it } from "vitest";
import { boneRoles, buildCharacter, handoverNotes, ROLE_COLORS } from "@autospine/character";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

describe("handover notes and bone colours (ADR-026)", () => {
  it("colours bones by role and writes notes a Spine user can act on", () => {
    const plan = fixturePlan();
    plan.bones.push({ id: "foot_target", parent: "root", at: "footL", angle: 0, length: 10 });
    plan.constraints = {
      ik: [
        {
          name: "leg_l",
          bones: ["thigh_l", "calf_l"],
          target: "foot_target",
          bendPositive: "auto",
        },
      ],
    };
    const built = buildCharacter(plan, fixtureLayout());
    const roles = boneRoles(built.rigging);
    expect(roles.get("hips")).toBe("main");
    expect(roles.get("face_ctl")).toBe("control");
    expect(roles.get("foot_target")).toBe("control");
    expect(roles.get("eyes")).toBe("follower");
    expect(roles.get("hair_1")).toBe("chain");
    expect(roles.get("spine")).toBe("joint");
    // A planted foot that carries the leg image stays a joint even as an IK target.
    expect(roles.get("foot_l")).toBe("joint");
    const bones = (built.document as unknown as { bones: { name: string; color?: string }[] })
      .bones;
    const color = (n: string) => bones.find((b) => b.name === n)!.color;
    expect(color("hips")).toBe(ROLE_COLORS.main);
    expect(color("face_ctl")).toBe(ROLE_COLORS.control);
    expect(color("spine")).toBeUndefined();
    const notes = handoverNotes(built.rigging, built.animations);
    expect(notes).toContain("# 接手說明");
    expect(notes).toContain("`face_ctl`");
    expect(notes).toContain("IK `leg_l`");
    expect(notes).toMatch(/### IDLE/);
    expect(notes).toContain("稀疏關鍵幀");
  });
});
