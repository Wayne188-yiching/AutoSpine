import type { RigSpec, ValidationStage } from "@autospine/schemas";

export type Affine = [number, number, number, number, number, number];
export function failStage(stage: ValidationStage, code: string, reason: string): never {
  const error = new Error(reason);
  Object.assign(error, {
    validation: {
      schemaVersion: "0.1",
      kind: "validation-report",
      id: code,
      status: "error",
      issues: [{ stage, code, reason, severity: 3 }],
    },
  });
  throw error;
}
export const transformPoint = (m: Affine, p: [number, number]): [number, number] => [
  m[0] * p[0] + m[2] * p[1] + m[4],
  m[1] * p[0] + m[3] * p[1] + m[5],
];
export function multiplyAffine(p: Affine, m: Affine): Affine {
  return [
    p[0] * m[0] + p[2] * m[1],
    p[1] * m[0] + p[3] * m[1],
    p[0] * m[2] + p[2] * m[3],
    p[1] * m[2] + p[3] * m[3],
    ...transformPoint(p, [m[4], m[5]]),
  ];
}
export function inverseAffine(m: Affine): Affine {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(determinant) || determinant === 0)
    failStage("rig", "RIG_SINGULAR", "An invertible finite bone frame is required");
  const a = m[3] / determinant,
    b = -m[1] / determinant,
    c = -m[2] / determinant,
    d = m[0] / determinant;
  const out: Affine = [a, b, c, d, -a * m[4] - c * m[5], -b * m[4] - d * m[5]];
  if (!out.every(Number.isFinite))
    failStage("rig", "RIG_FRAME_OVERFLOW", "Inverse bone frame overflows");
  return out;
}
export function orderBones(bones: RigSpec["bones"]): RigSpec["bones"] {
  if (
    !bones.length ||
    new Set(bones.map((b) => b.id)).size !== bones.length ||
    new Set(bones.map((b) => b.name)).size !== bones.length
  )
    failStage("rig", "RIG_IDENTITIES", "Nonempty unique bone IDs and names required");
  const byId = new Map(bones.map((b) => [b.id, b])),
    done = new Set<string>(),
    active = new Set<string>(),
    ordered: RigSpec["bones"] = [];
  function visit(b: RigSpec["bones"][number]) {
    if (done.has(b.id)) return;
    if (active.has(b.id)) failStage("rig", "RIG_CYCLE", "Bone hierarchy is cyclic");
    active.add(b.id);
    if (b.parentId) {
      const parent = byId.get(b.parentId);
      if (!parent) failStage("rig", "RIG_PARENT", "Missing parent bone");
      visit(parent);
    }
    active.delete(b.id);
    done.add(b.id);
    ordered.push(b);
  }
  bones.forEach(visit);
  return ordered;
}
export function evaluateRig(
  rig: RigSpec,
  rotations: Readonly<Record<string, number>> = {},
  adjustments: BoneAdjustments = {},
): Map<string, Affine> {
  const frames = new Map<string, Affine>();
  for (const b of orderBones(rig.bones)) {
    const r = b.rotation + (rotations[b.id] ?? 0),
      sx = (b.scaleX ?? 1) * (adjustments.scales?.[b.id]?.[0] ?? 1),
      sy = (b.scaleY ?? 1) * (adjustments.scales?.[b.id]?.[1] ?? 1),
      shx = b.shearX ?? 0,
      shy = b.shearY ?? 0;
    if (![b.x, b.y, b.length, r, sx, sy, shx, shy].every(Number.isFinite) || b.length < 0)
      failStage("rig", "RIG_FRAME", "Nonfinite or negative-length bone");
    const x = ((r + shx) * Math.PI) / 180,
      y = ((r + 90 + shy) * Math.PI) / 180;
    const local: Affine = [
      Math.cos(x) * sx,
      Math.sin(x) * sx,
      Math.cos(y) * sy,
      Math.sin(y) * sy,
      b.x + (adjustments.translations?.[b.id]?.[0] ?? 0),
      b.y + (adjustments.translations?.[b.id]?.[1] ?? 0),
    ];
    const world = b.parentId ? multiplyAffine(frames.get(b.parentId)!, local) : local;
    if (!world.every(Number.isFinite))
      failStage("rig", "RIG_FRAME_OVERFLOW", "World bone frame overflows");
    frames.set(b.id, world);
  }
  return frames;
}
export interface WorldBoneFrame {
  id: string;
  name: string;
  parentId?: string;
  length: number;
  world: Affine;
}
export interface BoneAdjustments {
  translations?: Readonly<Record<string, [number, number]>>;
  scales?: Readonly<Record<string, [number, number]>>;
}
/** Shared IDs occur once; supplied frames are explicit known input, never inferred geometry. */
export function rigFromWorldFrames(id: string, name: string, input: WorldBoneFrame[]): RigSpec {
  const frames = new Map(input.map((b) => [b.id, b.world]));
  const bones = orderBones(input.map((b) => ({ ...b, x: 0, y: 0, rotation: 0 }))).map((b) => {
    const world = frames.get(b.id)!;
    if (world.length !== 6 || !world.every(Number.isFinite))
      failStage("rig", "RIG_FRAME", "Six finite world coefficients required");
    const local = b.parentId
      ? multiplyAffine(inverseAffine(frames.get(b.parentId)!), world)
      : world;
    inverseAffine(local); // Reject singular supplied roots as well as singular parents.
    const rotation = (Math.atan2(local[1], local[0]) * 180) / Math.PI;
    return {
      id: b.id,
      name: b.name,
      ...(b.parentId ? { parentId: b.parentId } : {}),
      x: local[4],
      y: local[5],
      rotation,
      length: b.length,
      scaleX: Math.hypot(local[0], local[1]),
      scaleY: Math.hypot(local[2], local[3]),
      shearX: 0,
      shearY: (Math.atan2(local[3], local[2]) * 180) / Math.PI - rotation - 90,
    };
  });
  const rig: RigSpec = { schemaVersion: "0.1", kind: "rig", id, name, type: "custom", bones };
  evaluateRig(rig);
  return rig;
}
