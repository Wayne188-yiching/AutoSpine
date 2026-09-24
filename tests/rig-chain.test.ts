import { Value } from "@sinclair/typebox/value";
import { RigSpecSchema, type RigSpec } from "@autospine/schemas";
import { ChainRigError, generateChainRig } from "@autospine/rig";
import { describe, expect, it } from "vitest";

function worldJoints(rig: RigSpec): [number, number][] {
  const joints: [number, number][] = [];
  const transforms = new Map<string, { x: number; y: number; angle: number }>();
  for (const bone of rig.bones) {
    const parent = bone.parentId ? transforms.get(bone.parentId) : undefined;
    if (bone.parentId && !parent) throw new Error("Child appears before parent");
    const parentAngle = parent?.angle ?? 0;
    const radians = (parentAngle * Math.PI) / 180;
    const x = (parent?.x ?? 0) + Math.cos(radians) * bone.x - Math.sin(radians) * bone.y;
    const y = (parent?.y ?? 0) + Math.sin(radians) * bone.x + Math.cos(radians) * bone.y;
    const angle = parentAngle + bone.rotation;
    transforms.set(bone.id, { x, y, angle });
    joints.push([x, y]);
  }
  const last = rig.bones.at(-1)!;
  const pose = transforms.get(last.id)!;
  const radians = (pose.angle * Math.PI) / 180;
  joints.push([pose.x + Math.cos(radians) * last.length, pose.y + Math.sin(radians) * last.length]);
  return joints;
}

describe("Gate 4 deterministic ChainRigTemplate", () => {
  it.each([
    { start: [0, 0], end: [12, 0], count: 1 },
    { start: [4, 7], end: [4, -5], count: 3 },
    { start: [-3, 2], end: [6, 14], count: 4 },
    { start: [30, 8], end: [-10, -22], count: 5 },
  ])("constructs parent-local bones from $start to $end", ({ start, end, count }) => {
    const rig = generateChainRig({ id: "tail", name: "Tail", start, end, boneCount: count });
    expect(Value.Check(RigSpecSchema, rig)).toBe(true);
    expect(rig.type).toBe("chain");
    expect(rig.bones).toHaveLength(count);
    const length = Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!);
    const angle = (Math.atan2(end[1]! - start[1]!, end[0]! - start[0]!) * 180) / Math.PI;
    expect(rig.bones[0]).toMatchObject({ x: start[0], y: start[1], rotation: angle });
    expect(rig.bones[0]).not.toHaveProperty("parentId");
    for (let index = 0; index < count; index++) {
      const bone = rig.bones[index]!;
      expect(bone.id).toBe(`tail-bone-${index + 1}`);
      expect(bone.length).toBeCloseTo(length / count, 12);
      if (index > 0)
        expect(bone).toMatchObject({
          parentId: rig.bones[index - 1]!.id,
          x: length / count,
          y: 0,
          rotation: 0,
        });
    }
    const joints = worldJoints(rig);
    for (let index = 0; index <= count; index++) {
      const fraction = index / count;
      expect(joints[index]![0]).toBeCloseTo(start[0]! + fraction * (end[0]! - start[0]!), 10);
      expect(joints[index]![1]).toBeCloseTo(start[1]! + fraction * (end[1]! - start[1]!), 10);
    }
  });

  it("serializes 100 runs byte-for-byte identically", () => {
    const input = { id: "repeat", name: "Repeat", start: [-17, 35], end: [81, -4], boneCount: 13 };
    const first = JSON.stringify(generateChainRig(input));
    for (let run = 0; run < 100; run++) expect(JSON.stringify(generateChainRig(input))).toBe(first);
  });

  it.each([
    [null, "RIG_INPUT"],
    [{}, "RIG_ID"],
    [{ id: " ", name: "Tail" }, "RIG_ID"],
    [{ id: "t", name: " " }, "RIG_NAME"],
    [{ id: "t", name: "T", start: [0, Infinity] }, "RIG_START"],
    [{ id: "t", name: "T", start: [0, 0], end: [Number.NaN, 1] }, "RIG_END"],
    [{ id: "t", name: "T", start: [0, 0], end: [1, 1], boneCount: 0 }, "RIG_BONE_COUNT"],
    [{ id: "t", name: "T", start: [0, 0], end: [1, 1], boneCount: 1.5 }, "RIG_BONE_COUNT"],
    [{ id: "t", name: "T", start: [0, 0], end: [1, 1], boneCount: 257 }, "RIG_BONE_COUNT"],
    [{ id: "t", name: "T", start: [1, 1], end: [1, 1], boneCount: 2 }, "RIG_ZERO_LENGTH"],
    [
      { id: "t", name: "T", start: [-1e308, 0], end: [1e308, 0], boneCount: 2 },
      "RIG_LENGTH_OVERFLOW",
    ],
  ])("rejects degenerate input with %s", (input, code) => {
    try {
      generateChainRig(input);
      throw new Error("Expected ChainRigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ChainRigError);
      const validation = (error as ChainRigError).validation;
      expect(validation.status).toBe("error");
      expect(validation.issues[0]).toMatchObject({ code, stage: "rig", severity: 3 });
      expect(validation.issues[0]!.reason.length).toBeGreaterThan(0);
    }
  });
});
