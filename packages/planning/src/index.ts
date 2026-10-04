import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AssetSpecSchema, BuildJobSchema, type AssetSpec, type BuildJob } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { buildChainWave } from "@autospine/pipeline";
export * from "./critic.js";

export const PlannerProposalSchema = Type.Object(
  {
    schemaVersion: Type.Literal("0.1"),
    kind: Type.Literal("planner-proposal"),
    assetId: Type.String({ minLength: 1 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    parameters: Type.Pick(BuildJobSchema, ["chain", "wave", "cleanupFraction"]),
    warnings: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type PlannerProposal = Static<typeof PlannerProposalSchema>;
export function validatePlannerProposal(value: unknown, asset: AssetSpec): PlannerProposal {
  if (
    !Value.Check(AssetSpecSchema, asset) ||
    !Value.Check(PlannerProposalSchema, value) ||
    value.assetId !== asset.id
  )
    failStage("build", "PLAN_SCHEMA", "Strict matching PlannerProposal and asset required");
  const points = [value.parameters.chain.start, value.parameters.chain.end];
  if (
    points.some((p) => p[0] < 0 || p[0] > asset.width || p[1] < 0 || p[1] > asset.height) ||
    Math.hypot(points[0]![0] - points[1]![0], points[0]![1] - points[1]![1]) === 0
  )
    failStage(
      "build",
      "PLAN_GEOMETRY",
      "Distinct chain endpoints inside the known asset canvas required",
    );
  return structuredClone(value);
}
export function executePlannerProposal(
  asset: AssetSpec,
  hostJob: BuildJob,
  value: unknown,
  core: typeof buildChainWave = buildChainWave,
) {
  const proposal = validatePlannerProposal(value, asset);
  if (proposal.confidence < 0.8)
    failStage(
      "build",
      "PLAN_REVIEW_REQUIRED",
      "Low-confidence proposals require explicit review before Core",
    );
  if (!Value.Check(BuildJobSchema, hostJob))
    failStage("build", "PLAN_HOST_JOB", "Valid host-controlled job required");
  return core(asset, { ...hostJob, ...proposal.parameters });
}
export interface PlannerContext {
  assetId: string;
  width: number;
  height: number;
  parts: { id: string; name: string; drawOrder: number }[];
}
export type PlannerProvider = (context: PlannerContext) => Promise<unknown>;
export async function requestPlannerProposal(
  asset: AssetSpec,
  provider: PlannerProvider,
): Promise<PlannerProposal> {
  if (!Value.Check(AssetSpecSchema, asset))
    failStage("build", "PLAN_ASSET", "Valid asset required before provider invocation");
  const context: PlannerContext = {
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    parts: asset.parts.map(({ id, name, drawOrder }) => ({ id, name, drawOrder })),
  };
  return validatePlannerProposal(await provider(context), asset);
}
