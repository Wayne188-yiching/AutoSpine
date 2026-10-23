export * from "./geometry.js";
export { JointSolver, PartIndex, num, val, type Params } from "./joints.js";
export { planRig, type PlannedRig, type WorldFrame } from "./rig.js";
export {
  planAttachments,
  assetFor,
  rigidWeights,
  type MeshAsset,
  type PlannedAttachments,
} from "./attachments.js";
export {
  buildMotionSpecs,
  motionContext,
  motionFor,
  motionParams,
  type MotionContext,
} from "./motion.js";
export { buildColorTimelines, shownOpaque, type ColorTimeline } from "./colors.js";
export { buildDeformTimelines, mlsAffine, type DeformTimeline } from "./deforms.js";
export { buildAttachmentTimelines, type AttachmentTimeline } from "./visibility.js";
export { addKeyposes, applyKeyposes, applyRestPose, type Keyposes, type RestPose } from "./pose.js";
export { boneRoles, colorBones, handoverNotes, ROLE_COLORS, type BoneRole } from "./handover.js";
export { mergePlans, type MergedPlan } from "./merge.js";
export {
  DRAFT_KINDS,
  draftMotion,
  type DraftFigure,
  type DraftKind,
  type DraftOptions,
  type MotionDraft,
} from "./draft.js";
export * from "./build.js";
export * from "./lint.js";
