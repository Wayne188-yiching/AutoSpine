import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createHash } from "node:crypto";
import { BuildJobSchema, type AssetSpec, type BuildJob } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { buildChainWave } from "@autospine/pipeline";
import { validatePlannerProposal, type PlannerProposal } from "./planner.js";

const DefectSchema = Type.Union([
  Type.Literal("inversion"),
  Type.Literal("collapse"),
  Type.Literal("stretch"),
  Type.Literal("seam"),
  Type.Literal("loop"),
  Type.Literal("weights"),
]);
export const ReviewEvidenceSchema = Type.Object(
  {
    assetId: Type.String({ minLength: 1 }),
    manifestId: Type.String({ minLength: 1 }),
    inputFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    inversionCount: Type.Integer({ minimum: 0 }),
    minAreaRatio: Type.Number(),
    maxEdgeStretch: Type.Number({ minimum: 0 }),
    maxSeamGap: Type.Number({ minimum: 0 }),
    loopScore: Type.Number({ minimum: 0 }),
    validWeights: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ReviewEvidence = Static<typeof ReviewEvidenceSchema>;
export const CorrectionSpecSchema = Type.Object(
  {
    schemaVersion: Type.Literal("0.1"),
    kind: Type.Literal("correction"),
    assetId: Type.String({ minLength: 1 }),
    manifestId: Type.String({ minLength: 1 }),
    inputFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    defects: Type.Array(DefectSchema, { maxItems: 6 }),
    requiresHumanReview: Type.Boolean(),
    actions: Type.Array(
      Type.Union([
        Type.Object(
          {
            type: Type.Literal("reduce-wave"),
            amplitudeDegrees: Type.Number({ minimum: 0, maximum: 45 }),
          },
          { additionalProperties: false },
        ),
        Type.Object({ type: Type.Literal("regenerate-weights") }, { additionalProperties: false }),
        Type.Object({ type: Type.Literal("regenerate-wave") }, { additionalProperties: false }),
      ]),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);
export type CorrectionSpec = Static<typeof CorrectionSpecSchema>;
/** Numeric critic baseline. Host vision models can instead propose through this same strict contract. */
export function criticMetrics(evidence: ReviewEvidence, amplitudeDegrees: number): CorrectionSpec {
  if (
    !Value.Check(ReviewEvidenceSchema, evidence) ||
    !Number.isFinite(amplitudeDegrees) ||
    amplitudeDegrees < 0 ||
    amplitudeDegrees > 45
  )
    failStage("build", "CRITIC_EVIDENCE", "Finite measured evidence and wave amplitude required");
  const defects: CorrectionSpec["defects"] = [],
    actions: CorrectionSpec["actions"] = [];
  if (evidence.inversionCount > 0) defects.push("inversion");
  if (evidence.minAreaRatio < 0.2) defects.push("collapse");
  if (evidence.maxEdgeStretch > 2) defects.push("stretch");
  if (evidence.maxSeamGap > 1e-8) defects.push("seam");
  if (evidence.loopScore > 1) defects.push("loop");
  if (!evidence.validWeights) defects.push("weights");
  if (defects.some((d) => ["inversion", "collapse", "stretch"].includes(d)))
    actions.push({ type: "reduce-wave", amplitudeDegrees: Math.min(8, amplitudeDegrees / 2) });
  if (defects.includes("weights")) actions.push({ type: "regenerate-weights" });
  if (defects.includes("loop")) actions.push({ type: "regenerate-wave" });
  return {
    schemaVersion: "0.1",
    kind: "correction",
    assetId: evidence.assetId,
    manifestId: evidence.manifestId,
    inputFingerprint: evidence.inputFingerprint,
    defects,
    actions,
    requiresHumanReview: defects.includes("seam"),
  };
}
export function validateCorrectionSpec(
  value: unknown,
  assetId: string,
  manifestId: string,
  inputFingerprint: string,
): CorrectionSpec {
  if (
    !Value.Check(CorrectionSpecSchema, value) ||
    value.assetId !== assetId ||
    value.manifestId !== manifestId ||
    value.inputFingerprint !== inputFingerprint ||
    new Set(value.defects).size !== value.defects.length ||
    new Set(value.actions.map((a) => a.type)).size !== value.actions.length ||
    (!value.defects.length && value.actions.length) ||
    (value.defects.includes("seam") && !value.requiresHumanReview)
  )
    failStage(
      "build",
      "CORRECTION_SCHEMA",
      "Strict unique correction tied to the current asset and manifest required",
    );
  return structuredClone(value);
}
export function rebuildFromCorrection(
  asset: AssetSpec,
  hostJob: BuildJob,
  proposalInput: unknown,
  correctionInput: unknown,
  manifestId: string,
  core: typeof buildChainWave = buildChainWave,
) {
  if (!Value.Check(BuildJobSchema, hostJob))
    failStage("build", "CORRECTION_HOST_JOB", "Valid host-controlled job required");
  const proposal = validatePlannerProposal(proposalInput, asset),
    correction = validateCorrectionSpec(
      correctionInput,
      asset.id,
      manifestId,
      plannerInputFingerprint(asset, proposal),
    );
  if (correction.requiresHumanReview || proposal.confidence < 0.8)
    failStage(
      "build",
      "CORRECTION_REVIEW_REQUIRED",
      "Unresolved human-review requirement blocks automatic rebuild",
    );
  for (const action of correction.actions) {
    if (action.type === "reduce-wave") {
      if (action.amplitudeDegrees > proposal.parameters.wave.amplitudeDegrees)
        failStage(
          "build",
          "CORRECTION_AMPLITUDE",
          "Correction cannot increase the observed wave amplitude",
        );
      proposal.parameters.wave.amplitudeDegrees = action.amplitudeDegrees;
    }
  }
  const result = core(
    asset,
    { ...hostJob, ...proposal.parameters },
    correction.actions.some((a) => a.type === "regenerate-weights")
      ? { weights: { maxInfluences: 2, smoothingPasses: 2 } }
      : {},
  );
  const m = result.diagnostics.deformation;
  const engineeringPassed =
    m.inversionSamples === 0 &&
    m.minAreaRatio >= 0.2 &&
    m.maxEdgeStretch <= 2 &&
    m.loopMaxDelta <= 1e-6;
  return { result, proposal, correction, engineeringPassed, artistQualityAccepted: false as const };
}
export type CriticProvider = (evidence: ReviewEvidence) => Promise<unknown>;
export async function requestCorrectionSpec(
  evidence: ReviewEvidence,
  provider: CriticProvider,
): Promise<CorrectionSpec> {
  if (!Value.Check(ReviewEvidenceSchema, evidence))
    failStage("build", "CRITIC_EVIDENCE", "Valid evidence required before provider invocation");
  return validateCorrectionSpec(
    await provider(structuredClone(evidence)),
    evidence.assetId,
    evidence.manifestId,
    evidence.inputFingerprint,
  );
}
export function evidenceFromBuild(
  result: ReturnType<typeof buildChainWave>,
  manifestId: string,
  proposal: PlannerProposal,
): ReviewEvidence {
  const m = result.diagnostics.deformation;
  return {
    assetId: result.asset.id,
    manifestId,
    inputFingerprint: plannerInputFingerprint(result.asset, proposal),
    inversionCount: m.inversionSamples,
    minAreaRatio: m.minAreaRatio,
    maxEdgeStretch: m.maxEdgeStretch,
    maxSeamGap: 0,
    loopScore: m.loopMaxDelta / 1e-6,
    validWeights: true,
  };
}
export function plannerInputFingerprint(asset: AssetSpec, proposal: PlannerProposal): string {
  return createHash("sha256")
    .update(JSON.stringify([asset, proposal.parameters]))
    .digest("hex");
}
