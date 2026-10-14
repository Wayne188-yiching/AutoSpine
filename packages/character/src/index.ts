export * from "./geometry.js";
export { JointSolver, PartIndex, num, val, type Params } from "./joints.js";
export { planRig, type PlannedRig, type WorldFrame } from "./rig.js";
export {
  planAttachments,
  artistBudget,
  assetFor,
  rigidWeights,
  type MeshAsset,
  type PlannedAttachments,
} from "./attachments.js";
export { buildMotionSpecs, motionContext, motionParams, type MotionContext } from "./motion.js";
export { buildColorTimelines, type ColorTimeline } from "./colors.js";
export { buildAttachmentTimelines, type AttachmentTimeline } from "./visibility.js";
export { applyRestPose, type RestPose } from "./pose.js";
export { boneRoles, colorBones, handoverNotes, ROLE_COLORS, type BoneRole } from "./handover.js";
export * from "./build.js";
export * from "./lint.js";
