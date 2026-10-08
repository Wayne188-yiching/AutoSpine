import { beforeAll, describe, expect, it } from "vitest";
import {
  criticMetrics,
  evidenceFromBuild,
  executePlannerProposal,
  performanceEvidencePassed,
  plannerInputFingerprint,
  rebuildFromCorrection,
  reviewPerformance,
  summarizePerformanceReview,
  validateCorrectionSpec,
  type CorrectionSpec,
  type PerformanceEvidence,
  type PerformanceFinding,
  type PerformanceProfile,
  type PerformanceSample,
  type ReviewEvidence,
  type VisibilityEvidence,
} from "@autospine/planning";
import { strictInversionTolerance } from "@autospine/weights";
import { workflowFixture } from "./workflow-fixture.js";

let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => {
  fixture = await workflowFixture();
});

const good: ReviewEvidence = {
  assetId: "a",
  manifestId: "m",
  inputFingerprint: "0".repeat(64),
  inversionCount: 0,
  minAreaRatio: 1,
  maxEdgeStretch: 1,
  maxSeamGap: 0,
  loopScore: 0,
  validWeights: true,
};
const tolerance = {
  maxVisibleAreaRatio: 0.02,
  maxSingleTriangleRatio: 0.008,
  maxVisibleTriangles: 32,
};
const withinTolerance: VisibilityEvidence = {
  invertedTriangles: 23,
  visibleInvertedTriangles: 3,
  visibleInvertedPixels: 40,
  opaquePixels: 10_000,
  minAbsAreaRatio: 0.9,
  visibleAreaRatio: 0.004,
  maxTriangleAreaRatio: 0.002,
  tolerance,
};
const overTolerance: VisibilityEvidence = {
  ...withinTolerance,
  visibleInvertedTriangles: 90,
  visibleInvertedPixels: 4000,
  visibleAreaRatio: 0.4,
  maxTriangleAreaRatio: 0.2,
};
const summary = (patch: Partial<PerformanceEvidence["findings"]> = {}) => ({
  low: [],
  high: [],
  missing: [],
  worstDeviation: 0,
  passed: true,
  ...patch,
});

describe("critic performance and visibility integration", () => {
  it("keeps every pre-existing judgement field-for-field when no new evidence is supplied", () => {
    const base = {
      schemaVersion: "0.1" as const,
      kind: "correction" as const,
      assetId: "a",
      manifestId: "m",
      inputFingerprint: "0".repeat(64),
    };
    expect(criticMetrics(good, 20)).toEqual({
      ...base,
      defects: [],
      actions: [],
      requiresHumanReview: false,
    });
    const expected: [
      Partial<ReviewEvidence>,
      CorrectionSpec["defects"],
      CorrectionSpec["actions"],
    ][] = [
      [{ inversionCount: 1 }, ["inversion"], [{ type: "reduce-wave", amplitudeDegrees: 8 }]],
      [{ minAreaRatio: 0.1 }, ["collapse"], [{ type: "reduce-wave", amplitudeDegrees: 8 }]],
      [{ maxEdgeStretch: 3 }, ["stretch"], [{ type: "reduce-wave", amplitudeDegrees: 8 }]],
      [{ maxSeamGap: 1 }, ["seam"], []],
      [{ loopScore: 2 }, ["loop"], [{ type: "regenerate-wave" }]],
      [{ validWeights: false }, ["weights"], [{ type: "regenerate-weights" }]],
    ];
    for (const [patch, defects, actions] of expected)
      expect(criticMetrics({ ...good, ...patch }, 20)).toEqual({
        ...base,
        defects,
        actions,
        requiresHumanReview: defects.includes("seam"),
      });
  });

  it("emits the historical evidence shape when evidenceFromBuild gets no measurements", () => {
    const { asset, job, proposal } = fixture;
    const result = executePlannerProposal(asset, job, proposal);
    const plain = evidenceFromBuild(result, "m", proposal);
    expect(Object.keys(plain).sort()).toEqual([
      "assetId",
      "inputFingerprint",
      "inversionCount",
      "loopScore",
      "manifestId",
      "maxEdgeStretch",
      "maxSeamGap",
      "minAreaRatio",
      "validWeights",
    ]);
    expect(evidenceFromBuild(result, "m", proposal, {})).toEqual(plain);
    const carried = evidenceFromBuild(result, "m", proposal, { visibility: withinTolerance });
    expect(carried).toEqual({ ...plain, visibility: withinTolerance });
  });

  it("accepts tolerated visible inversions and still rejects the strict budget", () => {
    expect(
      criticMetrics({ ...good, inversionCount: 23, visibility: withinTolerance }, 20).defects,
    ).toEqual([]);
    expect(
      criticMetrics({ ...good, inversionCount: 23, visibility: overTolerance }, 20).defects,
    ).toContain("inversion");
    // A fold makes the signed minAreaRatio negative; collapse must read the unsigned ratio.
    expect(
      criticMetrics({ ...good, minAreaRatio: -0.9, visibility: withinTolerance }, 20).defects,
    ).toEqual([]);
    expect(
      criticMetrics(
        {
          ...good,
          inversionCount: 23,
          visibility: { ...withinTolerance, tolerance: strictInversionTolerance },
        },
        20,
      ).defects,
    ).toContain("inversion");
  });

  it("gates the rebuild on the tolerance when a visibility scan is attached", () => {
    const { asset, job, proposal } = fixture,
      high = structuredClone(proposal);
    high.parameters.wave.amplitudeDegrees = 45;
    high.parameters.wave.phaseDegrees = 0;
    high.parameters.chain.boneCount = 12;
    const clean: CorrectionSpec = {
      schemaVersion: "0.1",
      kind: "correction",
      assetId: asset.id,
      manifestId: "high-wave",
      inputFingerprint: plannerInputFingerprint(asset, high),
      defects: [],
      actions: [],
      requiresHumanReview: false,
    };
    const args = [asset, job, high, clean, "high-wave", undefined] as const;
    // Without evidence the historical "any inverted sample fails" rule still applies.
    expect(rebuildFromCorrection(...args).engineeringPassed).toBe(false);
    expect(rebuildFromCorrection(...args, withinTolerance).engineeringPassed).toBe(true);
    expect(rebuildFromCorrection(...args, overTolerance).engineeringPassed).toBe(false);
    expect(() =>
      rebuildFromCorrection(...args, { ...withinTolerance, visibleAreaRatio: 7 }),
    ).toThrow();
  });

  it("names the performance defect precisely and pairs it with a bounded action", () => {
    const performance = (findings: PerformanceEvidence["findings"]): PerformanceEvidence => ({
      profile: "look-around",
      metrics: { pupilRange: 0.01, parallaxHoldFraction: 0.1, keyDensity: 240 },
      findings,
    });
    const amplitude = criticMetrics(
      { ...good, performance: performance(summary({ low: ["pupilRange"], passed: false })) },
      8,
      { phaseDegrees: 45, fps: 24 },
    );
    expect(amplitude.defects).toEqual(["amplitude"]);
    expect(amplitude.actions).toEqual([{ type: "increase-wave", amplitudeDegrees: 14 }]);
    const timing = criticMetrics(
      {
        ...good,
        performance: performance(
          summary({ low: ["parallaxHoldFraction", "peakDelay:head"], passed: false }),
        ),
      },
      8,
      { phaseDegrees: 45, fps: 24 },
    );
    expect(timing.defects).toEqual(["timing"]);
    expect(timing.actions).toEqual([{ type: "stagger-wave", phaseDegrees: 82.5 }]);
    const density = criticMetrics(
      { ...good, performance: performance(summary({ high: ["keyDensity"], passed: false })) },
      8,
      { phaseDegrees: 45, fps: 24 },
    );
    expect(density.defects).toEqual(["density"]);
    expect(density.actions).toEqual([{ type: "sparsify-keys", fps: 12 }]);
    // An overshoot metric is keyed per chain probe; the colon-suffixed name still classifies.
    const perProbe = criticMetrics(
      { ...good, performance: performance(summary({ low: ["overshoot:head"], passed: false })) },
      8,
    );
    expect(perProbe.defects).toEqual(["amplitude"]);
    // Engineering repair wins: the critic never asks for more amplitude while reducing it.
    const conflict = criticMetrics(
      {
        ...good,
        maxEdgeStretch: 3,
        performance: performance(summary({ low: ["pupilRange"], passed: false })),
      },
      8,
    );
    expect(conflict.defects).toEqual(["stretch", "amplitude"]);
    expect(conflict.actions.map((a) => a.type)).toEqual(["reduce-wave"]);
  });

  it("never counts a metric the sample could not produce as a pass", () => {
    // Only a face/eyes pair is sampled, so the profile's pupil target can never be measured.
    const sample: PerformanceSample = {
      fps: 30,
      unit: 1,
      yDown: true,
      probes: {
        face: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        eyes: [
          [0, 0],
          [0, 0],
          [1, 0],
          [1, 0],
        ],
      },
    };
    const profile: PerformanceProfile = {
      id: "probe-gap",
      fps: 30,
      source: "synthetic four-frame sample used only by this test, n=1",
      targets: {
        parallaxHoldFraction: { reference: 0.6, min: 0.45, max: 0.75 },
        pupilRange: { reference: 0.2, min: 0.15, max: 0.25 },
      },
    };
    const review = reviewPerformance(sample, profile);
    const findings = summarizePerformanceReview(review);
    expect(findings).toEqual({
      low: [],
      high: [],
      missing: ["pupilRange"],
      worstDeviation: 0,
      passed: false,
    });
    const evidence: ReviewEvidence = {
      ...good,
      performance: { profile: review.profile, metrics: review.metrics, findings },
    };
    expect(performanceEvidencePassed(evidence.performance!)).toBe(false);
    const correction = criticMetrics(evidence, 8);
    expect(correction.defects).toEqual([]);
    // Unmeasured metrics have no conservative automatic fix, so the rebuild stays blocked.
    expect(correction.requiresHumanReview).toBe(true);
    const { asset, job, proposal } = fixture;
    expect(() => rebuildFromCorrection(asset, job, proposal, correction, "m")).toThrow();
    expect(
      performanceEvidencePassed({ profile: "probe-gap", metrics: {}, findings: summary() }),
    ).toBe(true);
  });

  it("reports the worst rejected metric relative to its reference", () => {
    const review: { findings: PerformanceFinding[] } = {
      findings: [
        { metric: "pupilRange", value: 0.05, reference: 0.2, min: 0.15, max: 0.25, status: "low" },
        { metric: "keyDensity", value: 9, reference: 3, min: 2, max: 4, status: "high" },
        {
          metric: "parallaxRangeX",
          value: 0.06,
          reference: 0.06,
          min: 0.04,
          max: 0.09,
          status: "within",
        },
      ],
    };
    expect(summarizePerformanceReview(review)).toEqual({
      low: ["pupilRange"],
      high: ["keyDensity"],
      // (9 - 4) / 3 beats (0.15 - 0.05) / 0.2 once both are scaled by their own reference.
      worstDeviation: Math.round((5 / 3) * 1e6) / 1e6,
      missing: [],
      passed: false,
    });
    expect(() => summarizePerformanceReview({ findings: undefined } as never)).toThrow();
  });

  it("holds new defects to the same uniqueness, fingerprint and executability rules", () => {
    const spec = criticMetrics(
      {
        ...good,
        performance: {
          profile: "look-around",
          metrics: {},
          findings: summary({ low: ["pupilRange"], passed: false }),
        },
      },
      8,
    );
    expect(validateCorrectionSpec(spec, "a", "m", "0".repeat(64))).toEqual(spec);
    for (const broken of [
      { ...spec, inputFingerprint: "1".repeat(64) },
      { ...spec, manifestId: "stale" },
      { ...spec, defects: ["amplitude", "amplitude"] },
      { ...spec, actions: [...spec.actions, { type: "increase-wave", amplitudeDegrees: 20 }] },
      {
        ...spec,
        actions: [...spec.actions, { type: "reduce-wave", amplitudeDegrees: 4 }],
      },
      { ...spec, defects: [], actions: spec.actions },
    ])
      expect(() => validateCorrectionSpec(broken, "a", "m", "0".repeat(64))).toThrow();
  });

  it("bounds every performance action when the rebuild executes it", () => {
    const { asset, job, proposal } = fixture;
    const fingerprint = plannerInputFingerprint(asset, proposal);
    const spec = (actions: CorrectionSpec["actions"], defects: CorrectionSpec["defects"]) => ({
      schemaVersion: "0.1" as const,
      kind: "correction" as const,
      assetId: asset.id,
      manifestId: "m",
      inputFingerprint: fingerprint,
      defects,
      actions,
      requiresHumanReview: false,
    });
    const ok = rebuildFromCorrection(
      asset,
      job,
      proposal,
      spec(
        [
          { type: "increase-wave", amplitudeDegrees: 14 },
          { type: "stagger-wave", phaseDegrees: 82.5 },
          { type: "sparsify-keys", fps: 12 },
        ],
        ["amplitude", "timing", "density"],
      ),
      "m",
    );
    expect(ok.proposal.parameters.wave).toEqual({
      duration: proposal.parameters.wave.duration,
      fps: 12,
      amplitudeDegrees: 14,
      phaseDegrees: 82.5,
    });
    for (const action of [
      { type: "increase-wave" as const, amplitudeDegrees: 45 },
      { type: "increase-wave" as const, amplitudeDegrees: 1 },
      { type: "stagger-wave" as const, phaseDegrees: 180 },
      { type: "stagger-wave" as const, phaseDegrees: -82.5 },
      { type: "sparsify-keys" as const, fps: 60 },
    ])
      expect(() =>
        rebuildFromCorrection(asset, job, proposal, spec([action], ["amplitude"]), "m"),
      ).toThrow();
  });
});
