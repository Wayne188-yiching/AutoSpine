import type { RigSpec } from "@autospine/schemas";
import { evaluateRig, failStage } from "./transforms.js";

export interface HumanoidInput {
  id: string;
  name: string;
  origin: [number, number];
  height: number;
  shoulderWidth: number;
}
/** Explicit T-pose template proportions, not inferred anatomy. Image-space y is down. */
export function generateHumanoidRig(input: HumanoidInput): RigSpec {
  if (!input || typeof input !== "object" || Array.isArray(input))
    failStage("rig", "HUMANOID_INPUT", "Humanoid input object required");
  const { id, name, origin, height: h, shoulderWidth: w } = input;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof name !== "string" ||
    !name.trim() ||
    !Array.isArray(origin) ||
    origin.length !== 2 ||
    !origin.every(Number.isFinite) ||
    !Number.isFinite(h) ||
    h <= 0 ||
    h > 10000 ||
    !Number.isFinite(w) ||
    w <= 0 ||
    w > h ||
    Object.keys(input).some((k) => !["id", "name", "origin", "height", "shoulderWidth"].includes(k))
  )
    failStage(
      "rig",
      "HUMANOID_INPUT",
      "Explicit finite origin and bounded positive proportions required",
    );
  const bones: RigSpec["bones"] = [];
  const add = (
    key: string,
    parent: string | undefined,
    x: number,
    y: number,
    rotation: number,
    length: number,
  ) =>
    bones.push({
      id: id + "-" + key,
      name: key,
      ...(parent ? { parentId: id + "-" + parent } : {}),
      x,
      y,
      rotation,
      length,
    });
  add("root", undefined, origin[0], origin[1], 0, 0);
  add("pelvis", "root", 0, 0, -90, 0.15 * h);
  add("spine", "pelvis", 0.15 * h, 0, 0, 0.15 * h);
  add("chest", "spine", 0.15 * h, 0, 0, 0.1 * h);
  add("neck", "chest", 0.1 * h, 0, 0, 0.06 * h);
  add("head", "neck", 0.06 * h, 0, 0, 0.12 * h);
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ] as const) {
    add("upper_arm_" + side, "chest", 0.08 * h, (sign * w) / 2, side === "L" ? 270 : 90, 0.17 * h);
    add("forearm_" + side, "upper_arm_" + side, 0.17 * h, 0, 0, 0.15 * h);
    add("hand_" + side, "forearm_" + side, 0.15 * h, 0, 0, 0.05 * h);
    add("thigh_" + side, "pelvis", 0, sign * w * 0.15, 180, 0.22 * h);
    add("shin_" + side, "thigh_" + side, 0.22 * h, 0, 0, 0.2 * h);
    add("foot_" + side, "shin_" + side, 0.2 * h, 0, side === "L" ? 90 : -90, 0.08 * h);
  }
  const rig: RigSpec = { schemaVersion: "0.1", kind: "rig", id, name, type: "humanoid", bones };
  evaluateRig(rig);
  return rig;
}
