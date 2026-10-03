import type { RigSpec, ValidationReport } from "@autospine/schemas";
import { ChainRigError, generateChainRig, type ChainRigInput } from "@autospine/rig";
import { describe, expect, it } from "vitest";

function worldJoints(rig: RigSpec): [number, number][] {
  const poses = new Map<
    string,
    { a: number; b: number; c: number; d: number; x: number; y: number }
  >();
  const joints: [number, number][] = [];
  for (const bone of rig.bones) {
    const parent = bone.parentId
      ? poses.get(bone.parentId)!
      : { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
    const radians = (bone.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const pose = {
      a: parent.a * cos + parent.c * sin,
      b: parent.b * cos + parent.d * sin,
      c: -parent.a * sin + parent.c * cos,
      d: -parent.b * sin + parent.d * cos,
      x: parent.x + parent.a * bone.x + parent.c * bone.y,
      y: parent.y + parent.b * bone.x + parent.d * bone.y,
    };
    poses.set(bone.id, pose);
    joints.push([pose.x, pose.y]);
  }
  const last = rig.bones.at(-1)!;
  const pose = poses.get(last.id)!;
  joints.push([pose.x + pose.a * last.length, pose.y + pose.b * last.length]);
  return joints;
}

function precisionRejection(input: ChainRigInput): ValidationReport {
  try {
    generateChainRig(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ChainRigError);
    return (error as ChainRigError).validation;
  }
  throw new Error("Expected RIG_NUMERIC_PRECISION rejection");
}

const collapsed: ChainRigInput = {
  id: "precision",
  name: "Precision",
  start: [1e16, 0],
  end: [1e16 + 4, 0],
  boneCount: 256,
};

describe("Gate 4 numeric precision", () => {
  it.each<{ label: string; start: [number, number]; end: [number, number]; boneCount: number }>([
    { label: "complete collapse", start: [1e16, 0], end: [1e16 + 4, 0], boneCount: 256 },
    { label: "partial quantization", start: [1e16, 0], end: [1e16 + 10, 0], boneCount: 4 },
    { label: "negative direction", start: [-1e16, 0], end: [-1e16 - 4, 0], boneCount: 256 },
    {
      label: "diagonal collapse",
      start: [1e16, -1e16],
      end: [1e16 + 4, -1e16 + 4],
      boneCount: 256,
    },
    {
      label: "subnormal segment quantization",
      start: [0, 0],
      end: [Number.MIN_VALUE * 3, 0],
      boneCount: 2,
    },
    {
      label: "subnormal diagonal quantization",
      start: [0, 0],
      end: [Number.MIN_VALUE * 4, Number.MIN_VALUE * 3],
      boneCount: 2,
    },
  ])("rejects $label with a useful structured error", ({ start, end, boneCount }) => {
    const validation = precisionRejection({ ...collapsed, start, end, boneCount });
    expect(validation.status).toBe("error");
    expect(validation.issues).toHaveLength(1);
    expect(validation.issues[0]).toMatchObject({
      code: "RIG_NUMERIC_PRECISION",
      stage: "rig",
      severity: 3,
    });
    expect(validation.issues[0]!.reason).toMatch(/joint/i);
    expect(validation.issues[0]!.reason).toMatch(/1e-10/);
    expect(validation.issues[0]!.reason).toMatch(/reduce|smaller|nearer|relocat/i);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 1e-320) expect(length * 1e-10).toBe(0);
  });

  it("rejects intermediate distortion even when the final tip rounds to the requested endpoint", () => {
    const start: [number, number] = [2 ** 53 - 2, 0];
    const end: [number, number] = [2 ** 53 + 2, 0];
    const step = 4 / 3;
    const firstJoint = start[0] + step;
    const lastTip = firstJoint + step + step;
    expect(lastTip).toBe(end[0]);
    expect((firstJoint - start[0]) / 4).toBe(0.25);
    expect(Math.abs(0.25 - 1 / 3)).toBeGreaterThan(1e-10);
    expect(precisionRejection({ ...collapsed, start, end, boneCount: 3 }).issues[0]).toMatchObject({
      code: "RIG_NUMERIC_PRECISION",
    });
  });

  it.each<{ label: string; start: [number, number]; end: [number, number]; boneCount: number }>([
    { label: "exact large origin", start: [1e16, 0], end: [1e16 + 512, 0], boneCount: 256 },
    {
      label: "short chain near a tiny origin",
      start: [2 ** -1000, 0],
      end: [2 ** -1000 + 2 ** -1005, 0],
      boneCount: 8,
    },
    {
      label: "exact subnormal chain with an underflowing absolute tolerance",
      start: [2 ** -1070, 0],
      end: [2 ** -1068, 0],
      boneCount: 3,
    },
    {
      label: "tiny diagonal",
      start: [0, 0],
      end: [3 * 2 ** -1000, 4 * 2 ** -1000],
      boneCount: 5,
    },
    { label: "finite near-maximum chain", start: [-8e307, 0], end: [8e307, 0], boneCount: 4 },
  ])("preserves $label without changing the RigSpec contract", ({ start, end, boneCount }) => {
    const input = { ...collapsed, start, end, boneCount };
    const savedInput = structuredClone(input);
    const rig = generateChainRig(input);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    const segment = length / boneCount;
    const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
    expect(input).toEqual(savedInput);
    expect(rig).toEqual({
      schemaVersion: "0.1",
      kind: "rig",
      id: input.id,
      name: input.name,
      type: "chain",
      bones: Array.from({ length: boneCount }, (_, index) => ({
        id: `precision-bone-${index + 1}`,
        name: `Precision ${index + 1}`,
        ...(index > 0 ? { parentId: `precision-bone-${index}` } : {}),
        x: index === 0 ? start[0] : segment,
        y: index === 0 ? start[1] : 0,
        rotation: index === 0 ? rotation : 0,
        length: segment,
      })),
    });
    const joints = worldJoints(rig);
    for (let index = 0; index <= boneCount; index++) {
      const [x, y] = joints[index]!;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      const fraction = index / boneCount;
      // Normalize first: the absolute tolerance may underflow to zero.
      const error = Math.hypot(
        (x - start[0]) / length - fraction * (dx / length),
        (y - start[1]) / length - fraction * (dy / length),
      );
      expect(error).toBeLessThanOrEqual(1e-10);
    }
  });

  it("keeps the new success output and precision diagnosis identical across 100 runs each", () => {
    const success = { ...collapsed, end: [1e16 + 512, 0] as [number, number] };
    const firstRig = JSON.stringify(generateChainRig(success));
    const firstError = JSON.stringify(precisionRejection(collapsed));
    for (let run = 0; run < 100; run++) {
      expect(JSON.stringify(generateChainRig(success))).toBe(firstRig);
      expect(JSON.stringify(precisionRejection(collapsed))).toBe(firstError);
    }
  });
});
