import type { RigSpec, ValidationIssue, ValidationReport } from "@autospine/schemas";
export * from "./transforms.js";

export interface ChainRigInput {
  id: string;
  name: string;
  start: [number, number];
  end: [number, number];
  boneCount: number;
}

function report(code: string, reason: string): ValidationReport {
  const issue: ValidationIssue = { code, stage: "rig", severity: 3, reason };
  return {
    schemaVersion: "0.1",
    kind: "validation-report",
    id: "chain-rig-gate-4",
    status: "error",
    issues: [issue],
  };
}

export class ChainRigError extends Error {
  constructor(readonly validation: ValidationReport) {
    super(validation.issues.map((issue) => issue.reason).join("; "));
    this.name = "ChainRigError";
  }
}

function fail(code: string, reason: string): never {
  throw new ChainRigError(report(code, reason));
}

function point(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

/**
 * A straight, parent-local chain rooted at `start`.
 * World joints and the final tip must be within 1e-10 of the total chain length.
 */
export function generateChainRig(input: unknown): RigSpec {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    fail("RIG_INPUT", "Chain rig input must be an object");
  const candidate = input as Partial<ChainRigInput>;
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0)
    fail("RIG_ID", "Rig id must be a non-empty string");
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0)
    fail("RIG_NAME", "Rig name must be a non-empty string");
  if (!point(candidate.start)) fail("RIG_START", "Start must be two finite coordinates");
  if (!point(candidate.end)) fail("RIG_END", "End must be two finite coordinates");
  if (
    !Number.isInteger(candidate.boneCount) ||
    candidate.boneCount! < 1 ||
    candidate.boneCount! > 256
  )
    fail("RIG_BONE_COUNT", "boneCount must be an integer from 1 through 256");

  const id = candidate.id!;
  const name = candidate.name!;
  const start = candidate.start!;
  const end = candidate.end!;
  const boneCount = candidate.boneCount!;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) fail("RIG_ZERO_LENGTH", "Start and end must differ");
  if (!Number.isFinite(length)) fail("RIG_LENGTH_OVERFLOW", "Chain length must be finite");
  const segmentLength = length / boneCount;
  if (segmentLength === 0) fail("RIG_SEGMENT_UNDERFLOW", "Bone length is too small to represent");
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  const bones: RigSpec["bones"] = [];
  for (let index = 0; index < boneCount; index++) {
    bones.push({
      id: `${id}-bone-${index + 1}`,
      name: `${name} ${index + 1}`,
      ...(index > 0 ? { parentId: bones[index - 1]!.id } : {}),
      x: index === 0 ? start[0] : segmentLength,
      y: index === 0 ? start[1] : 0,
      rotation: index === 0 ? rotation : 0,
      length: segmentLength,
    });
  }

  const radians = (rotation * Math.PI) / 180;
  const stepX = Math.cos(radians) * segmentLength;
  const stepY = Math.sin(radians) * segmentLength;
  let worldX = start[0];
  let worldY = start[1];
  for (let joint = 0; joint <= boneCount; joint++) {
    const fraction = joint / boneCount;
    // Normalize before comparing: world-scale tolerance hides collapse, while
    // multiplying a tiny length by the tolerance can underflow to zero.
    const relativeError = Math.hypot(
      (worldX - start[0]) / length - (dx / length) * fraction,
      (worldY - start[1]) / length - (dy / length) * fraction,
    );
    if (
      !Number.isFinite(worldX) ||
      !Number.isFinite(worldY) ||
      !Number.isFinite(relativeError) ||
      relativeError > 1e-10
    )
      fail(
        "RIG_NUMERIC_PRECISION",
        `Joint ${joint} exceeds 1e-10 of chain length in world-coordinate transforms; reduce coordinate magnitudes or relocate endpoints nearer the origin`,
      );
    if (joint < boneCount) {
      worldX += stepX;
      worldY += stepY;
    }
  }
  return { schemaVersion: "0.1", kind: "rig", id, name, type: "chain", bones };
}
