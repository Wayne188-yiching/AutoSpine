import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createHash } from "node:crypto";
import { BuildJobSchema, type AssetSpec, type BuildJob } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { buildChainWave } from "@autospine/pipeline";
import {
  deformationPassesWithVisibility,
  visibleInversionsPass,
  type VisibleInversionMetrics,
} from "@autospine/weights";
import { validatePlannerProposal, type PlannerProposal } from "./planner.js";
import type { PerformanceFinding, reviewPerformance } from "./performance.js";

const DefectSchema = Type.Union([
  Type.Literal("inversion"),
  Type.Literal("collapse"),
  Type.Literal("stretch"),
  Type.Literal("seam"),
  Type.Literal("loop"),
  Type.Literal("weights"),
  Type.Literal("amplitude"),
  Type.Literal("timing"),
  Type.Literal("density"),
]);
const RatioSchema = Type.Number({ minimum: 0, maximum: 1 });
/** Transported form of `InversionTolerance`; structurally the weights contract, bounded here. */
const InversionToleranceSchema = Type.Object(
  {
    maxVisibleAreaRatio: RatioSchema,
    maxSingleTriangleRatio: RatioSchema,
    maxVisibleTriangles: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  },
  { additionalProperties: false },
);
/**
 * Aggregates of a `measureVisibleInversions` scan plus the tolerance that was applied. The
 * per-triangle detail stays at the measuring site: the gate only reads these aggregates.
 */
const VisibilityEvidenceSchema = Type.Object(
  {
    invertedTriangles: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    visibleInvertedTriangles: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    visibleInvertedPixels: Type.Integer({ minimum: 0, maximum: 16_777_216 }),
    opaquePixels: Type.Integer({ minimum: 0, maximum: 16_777_216 }),
    /** Unsigned collapse ratio; the signed `minAreaRatio` cannot judge collapse once a fold exists. */
    minAbsAreaRatio: Type.Number({ minimum: 0, maximum: 1_000_000 }),
    visibleAreaRatio: RatioSchema,
    maxTriangleAreaRatio: RatioSchema,
    tolerance: InversionToleranceSchema,
  },
  { additionalProperties: false },
);
export type VisibilityEvidence = Static<typeof VisibilityEvidenceSchema>;
const MetricNameSchema = Type.String({ minLength: 1, maxLength: 120 });
/** `reviewPerformance` findings reduced to what the gate acts on; see `summarizePerformanceReview`. */
const PerformanceSummarySchema = Type.Object(
  {
    /** Metrics the review judged below their target interval, i.e. "not enough". */
    low: Type.Array(MetricNameSchema, { maxItems: 64 }),
    /** Metrics judged above their target interval. */
    high: Type.Array(MetricNameSchema, { maxItems: 64 }),
    /** Targeted metrics the sample never produced; never counted as passes. */
    missing: Type.Array(MetricNameSchema, { maxItems: 64 }),
    /** Worst rejected metric, as the distance outside its interval over |reference|. */
    worstDeviation: Type.Number({ minimum: 0, maximum: 1e9 }),
    passed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PerformanceSummary = Static<typeof PerformanceSummarySchema>;
const PerformanceEvidenceSchema = Type.Object(
  {
    /** Profile id the sample was reviewed against, kept so the gate can be audited. */
    profile: Type.String({ minLength: 1, maxLength: 64 }),
    /** `measurePerformance` output: one scalar per metric, chain entries keyed `overshoot:head`. */
    metrics: Type.Record(MetricNameSchema, Type.Number({ minimum: -1e9, maximum: 1e9 })),
    findings: PerformanceSummarySchema,
  },
  { additionalProperties: false },
);
export type PerformanceEvidence = Static<typeof PerformanceEvidenceSchema>;
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
    // Optional: callers that cannot render or sample keep the historical conservative gates.
    visibility: Type.Optional(VisibilityEvidenceSchema),
    performance: Type.Optional(PerformanceEvidenceSchema),
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
    defects: Type.Array(DefectSchema, { maxItems: 9 }),
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
        // Performance actions. Each one writes a single bounded BuildJob wave knob, so a critic
        // can only move the rebuild inside the host-declared schema range, never past it.
        Type.Object(
          {
            type: Type.Literal("increase-wave"),
            amplitudeDegrees: Type.Number({ minimum: 0, maximum: 45 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("stagger-wave"),
            phaseDegrees: Type.Number({ minimum: -180, maximum: 180 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          { type: Type.Literal("sparsify-keys"), fps: Type.Integer({ minimum: 1, maximum: 60 }) },
          { additionalProperties: false },
        ),
      ]),
      { maxItems: 6 },
    ),
  },
  { additionalProperties: false },
);
export type CorrectionSpec = Static<typeof CorrectionSpecSchema>;

/** Growth ceilings: a critic may escalate, but only by a bounded step per round. */
const AMPLITUDE_GROWTH = 1.5,
  AMPLITUDE_STEP_DEGREES = 2,
  PHASE_GROWTH = 1.5,
  PHASE_STEP_DEGREES = 15;
const amplitudeCeiling = (observed: number) =>
  Math.min(45, observed * AMPLITUDE_GROWTH + AMPLITUDE_STEP_DEGREES);
const phaseCeiling = (observed: number) =>
  Math.min(180, Math.abs(observed) * PHASE_GROWTH + PHASE_STEP_DEGREES);

/** Which performance defect a rejected metric points at, so the action can be chosen. */
const PERFORMANCE_DEFECT_BY_METRIC: Readonly<Record<string, "amplitude" | "timing" | "density">> =
  Object.freeze({
    parallaxRangeX: "amplitude",
    parallaxRangeY: "amplitude",
    pupilRange: "amplitude",
    handVsBodyRange: "amplitude",
    overshoot: "amplitude",
    range: "amplitude",
    parallaxHoldFraction: "timing",
    pupilHoldFraction: "timing",
    pupilPeakToMeanSpeed: "timing",
    peakTime: "timing",
    peakDelay: "timing",
    lag: "timing",
    keyDensity: "density",
  });
/** `measurePerformance` keys per-probe metrics as `overshoot:head`; classify on the base name. */
const defectForMetric = (metric: string) => PERFORMANCE_DEFECT_BY_METRIC[metric.split(":")[0]!];

/** The weights gate reads aggregates only, so the per-triangle list stays empty by design. */
function toVisibleInversionMetrics(evidence: VisibilityEvidence): VisibleInversionMetrics {
  return {
    invertedTriangles: evidence.invertedTriangles,
    visibleInvertedTriangles: evidence.visibleInvertedTriangles,
    visibleInvertedPixels: evidence.visibleInvertedPixels,
    opaquePixels: evidence.opaquePixels,
    minAbsAreaRatio: evidence.minAbsAreaRatio,
    visibleAreaRatio: evidence.visibleAreaRatio,
    maxTriangleAreaRatio: evidence.maxTriangleAreaRatio,
    triangles: [],
  };
}
/**
 * Reduces a `reviewPerformance` result to the transportable summary the evidence schema carries.
 * Deviation is measured from the rejected side of the target interval and divided by the
 * reference magnitude, so one scalar compares metrics of different units; a missing metric has
 * no value and therefore no deviation, only the failure it already causes.
 */
export function summarizePerformanceReview(
  review: Pick<ReturnType<typeof reviewPerformance>, "findings">,
): PerformanceSummary {
  const findings: PerformanceFinding[] | undefined = review?.findings;
  if (!Array.isArray(findings) || findings.some((f) => !f || typeof f.metric !== "string"))
    failStage("build", "CRITIC_PERFORMANCE", "A performance review with findings required");
  const low: string[] = [],
    high: string[] = [],
    missing: string[] = [];
  let worstDeviation = 0;
  for (const finding of findings) {
    if (finding.status === "within") continue;
    if (finding.status === "missing") {
      missing.push(finding.metric);
      continue;
    }
    (finding.status === "low" ? low : high).push(finding.metric);
    const value = finding.value as number,
      edge = finding.status === "low" ? finding.min : finding.max,
      scale = Math.max(Math.abs(finding.reference), 1e-6);
    worstDeviation = Math.max(worstDeviation, Math.abs(value - edge) / scale);
  }
  return {
    low,
    high,
    missing,
    worstDeviation: Math.min(1e9, Math.round(worstDeviation * 1e6) / 1e6),
    passed: !low.length && !high.length && !missing.length,
  };
}
/** Missing metrics are a failure, not a pass: an unmeasured metric was never shown to be good. */
export function performanceEvidencePassed(evidence: PerformanceEvidence): boolean {
  const { findings } = evidence;
  return (
    findings.passed && !findings.missing.length && !findings.low.length && !findings.high.length
  );
}
/** Numeric critic baseline. Host vision models can instead propose through this same strict contract. */
export function criticMetrics(
  evidence: ReviewEvidence,
  amplitudeDegrees: number,
  /** Observed wave knobs the performance actions escalate from; defaults match a mid BuildJob. */
  wave: { phaseDegrees?: number; fps?: number } = {},
): CorrectionSpec {
  const phaseDegrees = wave.phaseDegrees ?? 0,
    fps = wave.fps ?? 30;
  if (
    !Value.Check(ReviewEvidenceSchema, evidence) ||
    !Number.isFinite(amplitudeDegrees) ||
    amplitudeDegrees < 0 ||
    amplitudeDegrees > 45 ||
    !Number.isFinite(phaseDegrees) ||
    Math.abs(phaseDegrees) > 180 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60
  )
    failStage("build", "CRITIC_EVIDENCE", "Finite measured evidence and wave amplitude required");
  const defects: CorrectionSpec["defects"] = [],
    actions: CorrectionSpec["actions"] = [];
  const visibility = evidence.visibility;
  // With a visibility scan a fold is judged by what it paints; without one the historical
  // "any inversion is a defect" rule stands, so existing callers do not silently loosen.
  if (
    visibility
      ? !visibleInversionsPass(toVisibleInversionMetrics(visibility), visibility.tolerance)
      : evidence.inversionCount > 0
  )
    defects.push("inversion");
  // `minAreaRatio` is signed and turns negative for any fold, which would reinstate the global
  // ban through the collapse rule; the visibility scan carries the unsigned ratio for this.
  if ((visibility ? visibility.minAbsAreaRatio : evidence.minAreaRatio) < 0.2)
    defects.push("collapse");
  if (evidence.maxEdgeStretch > 2) defects.push("stretch");
  if (evidence.maxSeamGap > 1e-8) defects.push("seam");
  if (evidence.loopScore > 1) defects.push("loop");
  if (!evidence.validWeights) defects.push("weights");
  let unexplainedPerformance = false;
  const performance = evidence.performance;
  if (performance) {
    for (const metric of performance.findings.low) {
      const defect = defectForMetric(metric);
      // Below a band only reads as "not enough" for amplitude and timing; anything else has no
      // conservative automatic fix.
      if (defect === "amplitude" || defect === "timing") {
        if (!defects.includes(defect)) defects.push(defect);
      } else unexplainedPerformance = true;
    }
    for (const metric of performance.findings.high) {
      // Too many keys per second is the baked-animation signal; other over-range metrics are
      // real rejections we deliberately do not try to fix automatically.
      if (defectForMetric(metric) === "density") {
        if (!defects.includes("density")) defects.push("density");
      } else unexplainedPerformance = true;
    }
    // A banded metric that was never measured cannot be corrected blindly.
    if (performance.findings.missing.length) unexplainedPerformance = true;
  }
  if (defects.some((d) => ["inversion", "collapse", "stretch"].includes(d)))
    actions.push({ type: "reduce-wave", amplitudeDegrees: Math.min(8, amplitudeDegrees / 2) });
  if (defects.includes("weights")) actions.push({ type: "regenerate-weights" });
  if (defects.includes("loop")) actions.push({ type: "regenerate-wave" });
  // Engineering safety wins: never ask for more amplitude in the same breath as less.
  if (defects.includes("amplitude") && !actions.some((a) => a.type === "reduce-wave"))
    actions.push({
      type: "increase-wave",
      amplitudeDegrees: amplitudeCeiling(amplitudeDegrees),
    });
  if (defects.includes("timing"))
    actions.push({
      type: "stagger-wave",
      phaseDegrees: (phaseDegrees < 0 ? -1 : 1) * phaseCeiling(phaseDegrees),
    });
  if (defects.includes("density"))
    actions.push({ type: "sparsify-keys", fps: Math.max(1, Math.floor(fps / 2)) });
  return {
    schemaVersion: "0.1",
    kind: "correction",
    assetId: evidence.assetId,
    manifestId: evidence.manifestId,
    inputFingerprint: evidence.inputFingerprint,
    defects,
    actions,
    requiresHumanReview: defects.includes("seam") || unexplainedPerformance,
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
    // Raising and lowering the same knob in one correction is not executable.
    (value.actions.some((a) => a.type === "reduce-wave") &&
      value.actions.some((a) => a.type === "increase-wave")) ||
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
  /** Visibility scan of the rebuilt pose; absent means the historical strict gate applies. */
  visibility?: VisibilityEvidence,
) {
  if (!Value.Check(BuildJobSchema, hostJob))
    failStage("build", "CORRECTION_HOST_JOB", "Valid host-controlled job required");
  if (visibility !== undefined && !Value.Check(VisibilityEvidenceSchema, visibility))
    failStage(
      "build",
      "CORRECTION_VISIBILITY",
      "Strict bounded visible inversion evidence required",
    );
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
    const observed = proposal.parameters.wave;
    if (action.type === "reduce-wave") {
      if (action.amplitudeDegrees > observed.amplitudeDegrees)
        failStage(
          "build",
          "CORRECTION_AMPLITUDE",
          "Correction cannot increase the observed wave amplitude",
        );
      observed.amplitudeDegrees = action.amplitudeDegrees;
    }
    if (action.type === "increase-wave") {
      if (
        action.amplitudeDegrees < observed.amplitudeDegrees ||
        action.amplitudeDegrees > amplitudeCeiling(observed.amplitudeDegrees)
      )
        failStage(
          "build",
          "CORRECTION_AMPLITUDE",
          "Amplitude may only grow by one bounded step per correction",
        );
      observed.amplitudeDegrees = action.amplitudeDegrees;
    }
    if (action.type === "stagger-wave") {
      if (
        Math.abs(action.phaseDegrees) < Math.abs(observed.phaseDegrees) ||
        Math.abs(action.phaseDegrees) > phaseCeiling(observed.phaseDegrees) ||
        (observed.phaseDegrees !== 0 &&
          Math.sign(action.phaseDegrees) !== Math.sign(observed.phaseDegrees))
      )
        failStage(
          "build",
          "CORRECTION_PHASE",
          "Stagger may only grow the observed phase offset by one bounded step, same direction",
        );
      observed.phaseDegrees = action.phaseDegrees;
    }
    if (action.type === "sparsify-keys") {
      if (action.fps > observed.fps)
        failStage("build", "CORRECTION_FPS", "Sparsifying keys cannot raise the sampling rate");
      observed.fps = action.fps;
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
  const engineeringPassed = visibility
    ? deformationPassesWithVisibility(
        {
          // `inversionSamples` counts posed samples while the scan counts triangles; pair on the
          // triangle count the scan itself reported, which is the measurement being judged.
          inversionCount: visibility.invertedTriangles,
          minAreaRatio: m.minAreaRatio,
          maxEdgeStretch: m.maxEdgeStretch,
          maxSeamGap: 0,
        },
        toVisibleInversionMetrics(visibility),
        visibility.tolerance,
      ) && m.loopMaxDelta <= 1e-6
    : m.inversionSamples === 0 &&
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
  /** Measured outside the Core (rendering, sampling); omitted leaves the evidence unchanged. */
  observed: { visibility?: VisibilityEvidence; performance?: PerformanceEvidence } = {},
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
    ...(observed.visibility ? { visibility: observed.visibility } : {}),
    ...(observed.performance ? { performance: observed.performance } : {}),
  };
}
export function plannerInputFingerprint(asset: AssetSpec, proposal: PlannerProposal): string {
  return createHash("sha256")
    .update(JSON.stringify([asset, proposal.parameters]))
    .digest("hex");
}
