import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  AssetSpecSchema,
  RigSpecSchema,
  type AnimationSpec,
  type AssetSpec,
  type RigSpec,
  type ValidationIssue,
  type ValidationReport,
} from "@autospine/schemas";

export interface MinimalSpineInput {
  asset: AssetSpec;
  rig: RigSpec;
  animation: AnimationSpec;
  imagesPath: string;
  binding: {
    partId: string;
    boneId: string;
    slotName: string;
    attachmentName: string;
    x: number;
    y: number;
  };
}

export interface Spine40Document {
  skeleton: { spine: "4.0.64"; images: string };
  bones: Array<{
    name: string;
    parent?: string;
    length?: number;
    x?: number;
    y?: number;
    rotation?: number;
  }>;
  slots: Array<{ name: string; bone: string; attachment: string }>;
  skins: Array<{
    name: "default";
    attachments: Record<
      string,
      Record<string, { width: number; height: number; x?: number; y?: number }>
    >;
  }>;
  animations: Record<
    string,
    { bones: Record<string, { rotate: Array<{ time?: number; value?: number }> }> }
  >;
}

function report(issues: ValidationIssue[]): ValidationReport {
  return {
    schemaVersion: "0.1",
    kind: "validation-report",
    id: "spine-4.0.64-minimal",
    status: issues.length ? "error" : "passed",
    issues,
  };
}

function issue(code: string, reason: string, target?: string): ValidationIssue {
  return { code, stage: "spine", target, severity: 3, reason };
}

export class SpineCompileError extends Error {
  constructor(readonly validation: ValidationReport) {
    super(validation.issues.map((item) => item.reason).join("; "));
    this.name = "SpineCompileError";
  }
}

export function validateMinimalSpineInput(input: MinimalSpineInput): ValidationReport {
  if (!input || typeof input !== "object")
    return report([issue("INPUT", "Build input must be an object")]);
  const issues: ValidationIssue[] = [];
  if (!Value.Check(AssetSpecSchema, input.asset))
    issues.push(issue("ASSET_SCHEMA", "Invalid AssetSpec"));
  if (!Value.Check(RigSpecSchema, input.rig)) issues.push(issue("RIG_SCHEMA", "Invalid RigSpec"));
  if (!Value.Check(AnimationSpecSchema, input.animation))
    issues.push(issue("ANIMATION_SCHEMA", "Invalid AnimationSpec"));
  if (!input.binding || typeof input.binding !== "object")
    issues.push(issue("BINDING", "A part-to-bone binding is required"));
  if (issues.length) return report(issues);

  const { asset, rig, animation, binding } = input;
  if (asset.parts.length !== 1)
    issues.push(issue("PART_COUNT", "Gate 1 supports exactly one part"));
  if (rig.bones.length !== 2) issues.push(issue("BONE_COUNT", "Gate 1 supports exactly two bones"));
  if (animation.rigId !== rig.id)
    issues.push(issue("RIG_REFERENCE", "Animation rigId does not match RigSpec", animation.rigId));
  if (animation.motions.length)
    issues.push(issue("MOTION_UNSUPPORTED", "Procedural motions are outside Gate 1"));
  if (animation.rotationTimelines?.length !== 1)
    issues.push(issue("TIMELINE_COUNT", "Gate 1 requires exactly one rotation timeline"));
  if (typeof input.imagesPath !== "string" || !input.imagesPath.endsWith("/"))
    issues.push(issue("IMAGES_PATH", "imagesPath must be a nonempty slash-terminated path"));
  if (asset.parts[0]?.id !== binding.partId)
    issues.push(issue("PART_REFERENCE", "Binding partId does not exist", binding.partId));
  if (!rig.bones.some((bone) => bone.id === binding.boneId))
    issues.push(issue("BONE_REFERENCE", "Binding boneId does not exist", binding.boneId));
  if (
    typeof binding.slotName !== "string" ||
    !binding.slotName ||
    typeof binding.attachmentName !== "string" ||
    !binding.attachmentName
  )
    issues.push(issue("BINDING_NAME", "Slot and attachment names must be nonempty"));
  if (!Number.isFinite(binding.x) || !Number.isFinite(binding.y))
    issues.push(issue("BINDING_POSITION", "Attachment offsets must be finite"));
  if (
    new Set(rig.bones.map((bone) => bone.id)).size !== rig.bones.length ||
    new Set(rig.bones.map((bone) => bone.name)).size !== rig.bones.length
  )
    issues.push(issue("BONE_DUPLICATE", "Bone IDs and names must be unique"));
  const root = rig.bones.filter((bone) => !bone.parentId);
  const child = rig.bones.filter((bone) => bone.parentId);
  if (root.length !== 1 || child.length !== 1 || child[0]?.parentId !== root[0]?.id)
    issues.push(issue("BONE_HIERARCHY", "Gate 1 requires one root and its direct child"));
  const timeline = animation.rotationTimelines?.[0];
  if (timeline && !rig.bones.some((bone) => bone.id === timeline.boneId))
    issues.push(
      issue("TIMELINE_BONE_REFERENCE", "Timeline boneId does not exist", timeline.boneId),
    );
  if (
    timeline &&
    (timeline.keys[0]?.time !== 0 ||
      timeline.keys.at(-1)?.time !== animation.duration ||
      timeline.keys.some(
        (key, index) =>
          !Number.isFinite(key.degrees) ||
          (index > 0 && key.time <= timeline.keys[index - 1]!.time),
      ))
  )
    issues.push(
      issue("TIMELINE_KEYS", "Keys must start at 0, end at duration, and increase strictly"),
    );
  const part = asset.parts[0];
  if (part && (part.bounds.width <= 0 || part.bounds.height <= 0))
    issues.push(issue("REGION_SIZE", "Region width and height must be positive", part.id));
  return report(issues);
}

/** Gate 1's deliberately narrow, deterministic IR to Spine 4.0.64 adapter. */
export function compileSpine40(input: MinimalSpineInput): Spine40Document {
  const validation = validateMinimalSpineInput(input);
  if (validation.status === "error") throw new SpineCompileError(validation);
  const root = input.rig.bones.find((bone) => !bone.parentId)!;
  const child = input.rig.bones.find((bone) => bone.parentId)!;
  const part = input.asset.parts[0]!;
  const timeline = input.animation.rotationTimelines![0]!;
  const targetBone = input.rig.bones.find((bone) => bone.id === timeline.boneId)!;
  const boneFields = (bone: typeof root) => ({
    name: bone.name,
    ...(bone.parentId ? { parent: root.name } : {}),
    ...(bone.length ? { length: bone.length } : {}),
    ...(bone.x ? { x: bone.x } : {}),
    ...(bone.y ? { y: bone.y } : {}),
    ...(bone.rotation ? { rotation: bone.rotation } : {}),
  });
  const attachment = {
    ...(input.binding.x ? { x: input.binding.x } : {}),
    ...(input.binding.y ? { y: input.binding.y } : {}),
    width: part.bounds.width,
    height: part.bounds.height,
  };
  return {
    skeleton: { spine: "4.0.64", images: input.imagesPath },
    bones: [boneFields(root), boneFields(child)],
    slots: [
      {
        name: input.binding.slotName,
        bone: input.rig.bones.find((bone) => bone.id === input.binding.boneId)!.name,
        attachment: input.binding.attachmentName,
      },
    ],
    skins: [
      {
        name: "default",
        attachments: { [input.binding.slotName]: { [input.binding.attachmentName]: attachment } },
      },
    ],
    animations: {
      [input.animation.name]: {
        bones: {
          [targetBone.name]: {
            rotate: timeline.keys.map((key) => ({
              ...(key.time ? { time: key.time } : {}),
              ...(key.degrees ? { value: key.degrees } : {}),
            })),
          },
        },
      },
    },
  };
}

export function validateSpine40(document: unknown): ValidationReport {
  if (!document || typeof document !== "object")
    return report([issue("DOCUMENT", "Spine JSON must be an object")]);
  const data = document as Partial<Spine40Document>;
  const issues: ValidationIssue[] = [];
  if (data.skeleton?.spine !== "4.0.64") issues.push(issue("VERSION", "Expected Spine 4.0.64"));
  const bones = Array.isArray(data.bones) ? data.bones : [];
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const skins = Array.isArray(data.skins) ? data.skins : [];
  if (bones.length !== 2 || bones[1]?.parent !== bones[0]?.name)
    issues.push(issue("BONES", "Expected a parent-first root and child"));
  if (slots.length !== 1 || !bones.some((bone) => bone.name === slots[0]?.bone))
    issues.push(issue("SLOT_REFERENCE", "Slot must reference a bone"));
  const slot = slots[0];
  const attachment = slot ? skins[0]?.attachments?.[slot.name]?.[slot.attachment] : undefined;
  if (skins.length !== 1 || skins[0]?.name !== "default" || !attachment)
    issues.push(issue("ATTACHMENT_REFERENCE", "Default skin must contain the slot attachment"));
  else if (
    !Number.isFinite(attachment.width) ||
    attachment.width <= 0 ||
    !Number.isFinite(attachment.height) ||
    attachment.height <= 0
  )
    issues.push(issue("REGION_SIZE", "Region dimensions must be positive finite numbers"));
  if (
    !data.animations ||
    typeof data.animations !== "object" ||
    Object.keys(data.animations).length !== 1
  )
    issues.push(issue("ANIMATION", "Expected one animation"));
  else {
    const animation = Object.values(data.animations)[0];
    const timelineBone = animation?.bones && Object.keys(animation.bones)[0];
    const keys = timelineBone ? animation.bones[timelineBone]?.rotate : undefined;
    if (
      !timelineBone ||
      !bones.some((bone) => bone.name === timelineBone) ||
      !Array.isArray(keys) ||
      !keys.length ||
      keys.some(
        (key, index) =>
          typeof key !== "object" ||
          key === null ||
          (key.value !== undefined && !Number.isFinite(key.value)) ||
          (index === 0 && (key.time ?? 0) !== 0) ||
          (index > 0 && !(key.time! > (keys[index - 1]?.time ?? 0))),
      )
    )
      issues.push(
        issue("ANIMATION_REFERENCE", "Animation must contain ordered rotation keys for a bone"),
      );
  }
  return report(issues);
}
