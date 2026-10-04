import { Value } from "@sinclair/typebox/value";
import {
  ConstraintSpecSchema,
  RigSpecSchema,
  type ConstraintSpec,
  type RigSpec,
} from "@autospine/schemas";
import {
  evaluateRig,
  failStage,
  inverseAffine,
  multiplyAffine,
  transformPoint,
  type Affine,
} from "@autospine/rig";

type Point = [number, number];
const rad = Math.PI / 180,
  deg = 180 / Math.PI;
const angle = (m: Affine) => Math.atan2(m[1], m[0]) * deg;
const mixAngle = (a: number, b: number, mix: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * mix;
/** Sequential, baked neutral constraint evaluation, not Spine constraint serialization. */
export function solveConstraints(
  input: RigSpec,
  spec: ConstraintSpec,
  paths: Readonly<Record<string, Point[]>> = {},
): {
  rig: RigSpec;
  diagnostics: { constraintId: string; residual?: number; reachable?: boolean }[];
} {
  if (
    !Value.Check(RigSpecSchema, input) ||
    !Value.Check(ConstraintSpecSchema, spec) ||
    spec.rigId !== input.id ||
    new Set(spec.constraints.map((c) => c.id)).size !== spec.constraints.length
  )
    failStage(
      "constraints",
      "CONSTRAINT_INPUT",
      "Valid matching rig and unique constraints required",
    );
  const rig = structuredClone(input);
  const diagnostics: { constraintId: string; residual?: number; reachable?: boolean }[] = [];
  const driven = new Set<string>(),
    byId = () => new Map(rig.bones.map((b) => [b.id, b]));
  const ancestor = (a: string, b: string) => {
    let bone = byId().get(b);
    while (bone) {
      if (bone.id === a) return true;
      bone = bone.parentId ? byId().get(bone.parentId) : undefined;
    }
    return false;
  };
  evaluateRig(rig); // Reject cycles before walking ancestors.
  const worldSet = (id: string, world: Affine) => {
    const bone = byId().get(id)!,
      frames = evaluateRig(rig),
      local = bone.parentId
        ? multiplyAffine(inverseAffine(frames.get(bone.parentId)!), world)
        : world;
    inverseAffine(local);
    const rotation = angle(local);
    Object.assign(bone, {
      x: local[4],
      y: local[5],
      rotation,
      scaleX: Math.hypot(local[0], local[1]),
      scaleY: Math.hypot(local[2], local[3]),
      shearX: 0,
      shearY: Math.atan2(local[3], local[2]) * deg - rotation - 90,
    });
  };
  const moveWorld = (
    id: string,
    p: Point,
    direction: number,
    translateMix: number,
    rotateMix: number,
  ) => {
    const m = evaluateRig(rig).get(id)!,
      r = mixAngle(angle(m), direction, rotateMix) - angle(m),
      c = Math.cos(r * rad),
      s = Math.sin(r * rad);
    worldSet(id, [
      c * m[0] - s * m[1],
      s * m[0] + c * m[1],
      c * m[2] - s * m[3],
      s * m[2] + c * m[3],
      m[4] + (p[0] - m[4]) * translateMix,
      m[5] + (p[1] - m[5]) * translateMix,
    ]);
  };
  for (const constraint of spec.constraints) {
    const ids = byId();
    if (
      new Set(constraint.boneIds).size !== constraint.boneIds.length ||
      constraint.boneIds.some((id) => !ids.has(id) || driven.has(id))
    )
      failStage(
        "constraints",
        "CONSTRAINT_BONES",
        "Unique existing bones with no competing constraints required",
      );
    constraint.boneIds.forEach((id) => driven.add(id));
    if (
      constraint.type !== "path" &&
      (!ids.has(constraint.targetBoneId) ||
        constraint.boneIds.some((id) => ancestor(id, constraint.targetBoneId)))
    )
      failStage(
        "constraints",
        "CONSTRAINT_TARGET",
        "Target must exist outside constrained descendants",
      );
    if (constraint.type === "ik") {
      if (
        constraint.boneIds.length > 2 ||
        rig.bones.some(
          (b) =>
            (b.scaleX ?? 1) !== 1 ||
            (b.scaleY ?? 1) !== 1 ||
            (b.shearX ?? 0) !== 0 ||
            (b.shearY ?? 0) !== 0 ||
            Math.max(Math.abs(b.x), Math.abs(b.y), b.length) > 1e9,
        )
      )
        failStage(
          "constraints",
          "IK_UNSUPPORTED",
          "One/two-bone IK requires unit-scale unsheared bounded frames",
        );
      const first = ids.get(constraint.boneIds[0]!)!,
        second = constraint.boneIds[1] ? ids.get(constraint.boneIds[1])! : undefined;
      if (
        first.length <= 0 ||
        (second &&
          (second.length <= 0 ||
            second.parentId !== first.id ||
            Math.abs(second.x - first.length) > 1e-9 * Math.max(1, first.length) ||
            Math.abs(second.y) > 1e-9))
      )
        failStage("constraints", "IK_CHAIN", "Positive contiguous deform chain required");
      const frames = evaluateRig(rig),
        p = transformPoint(frames.get(first.id)!, [0, 0]),
        target = transformPoint(frames.get(constraint.targetBoneId)!, [0, 0]);
      const dx = target[0] - p[0],
        dy = target[1] - p[1],
        distance = Math.hypot(dx, dy),
        parent = first.parentId ? angle(frames.get(first.parentId)!) : 0;
      let a = Math.atan2(dy, dx) * deg,
        b = 0;
      if (second) {
        const cosine = Math.max(
          -1,
          Math.min(
            1,
            (distance * distance - first.length ** 2 - second.length ** 2) /
              (2 * first.length * second.length),
          ),
        );
        b = Math.acos(cosine) * (constraint.bendDirection === "positive" ? 1 : -1);
        a -=
          Math.atan2(second.length * Math.sin(b), first.length + second.length * Math.cos(b)) * deg;
      }
      first.rotation = mixAngle(first.rotation, a - parent, constraint.mix);
      if (second) second.rotation = mixAngle(second.rotation, b * deg, constraint.mix);
      const end = second ?? first,
        tip = transformPoint(evaluateRig(rig).get(end.id)!, [end.length, 0]);
      const residual = Math.hypot(tip[0] - target[0], tip[1] - target[1]);
      if (!Number.isFinite(residual)) failStage("constraints", "IK_NUMERIC", "IK overflow");
      diagnostics.push({
        constraintId: constraint.id,
        residual,
        reachable: residual <= 1e-6 * Math.max(1, first.length + (second?.length ?? 0)),
      });
    } else if (constraint.type === "transform") {
      if (!constraint.local || constraint.relative)
        failStage(
          "constraints",
          "TRANSFORM_UNSUPPORTED",
          "v1 transform supports explicit local absolute copying only",
        );
      const target = ids.get(constraint.targetBoneId)!;
      for (const id of constraint.boneIds) {
        const bone = ids.get(id)!;
        bone.rotation = mixAngle(bone.rotation, target.rotation, constraint.rotateMix);
        bone.x += (target.x - bone.x) * constraint.translateMix;
        bone.y += (target.y - bone.y) * constraint.translateMix;
        bone.scaleX =
          (bone.scaleX ?? 1) + ((target.scaleX ?? 1) - (bone.scaleX ?? 1)) * constraint.scaleMix;
        bone.scaleY =
          (bone.scaleY ?? 1) + ((target.scaleY ?? 1) - (bone.scaleY ?? 1)) * constraint.scaleMix;
        bone.shearX = mixAngle(bone.shearX ?? 0, target.shearX ?? 0, constraint.shearMix);
        bone.shearY = mixAngle(bone.shearY ?? 0, target.shearY ?? 0, constraint.shearMix);
      }
      diagnostics.push({ constraintId: constraint.id });
    } else {
      const points = paths[constraint.targetPathId];
      if (
        !Array.isArray(points) ||
        points.length < 2 ||
        points.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
        constraint.position < 0 ||
        constraint.spacing < 0
      )
        failStage(
          "constraints",
          "PATH_INPUT",
          "Finite polyline and nonnegative arc-length positions required",
        );
      const lengths = points
        .slice(1)
        .map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
      if (lengths.some((v) => v <= 0 || !Number.isFinite(v)))
        failStage("constraints", "PATH_SEGMENT", "Nonzero finite path segments required");
      const total = lengths.reduce((a, b) => a + b, 0);
      for (let i = 0; i < constraint.boneIds.length; i++) {
        let distance = constraint.position + i * constraint.spacing;
        if (distance > total)
          failStage("constraints", "PATH_RANGE", "Position exceeds the supplied path");
        let j = 0;
        while (j < lengths.length - 1 && distance > lengths[j]!) {
          distance -= lengths[j]!;
          j++;
        }
        const a = points[j]!,
          b = points[j + 1]!,
          u = distance / lengths[j]!;
        moveWorld(
          constraint.boneIds[i]!,
          [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
          Math.atan2(b[1] - a[1], b[0] - a[0]) * deg,
          constraint.translateMix,
          constraint.rotateMix,
        );
      }
      diagnostics.push({ constraintId: constraint.id });
    }
    for (const m of evaluateRig(rig).values()) inverseAffine(m);
  }
  return { rig, diagnostics };
}
