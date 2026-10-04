import { beforeAll, it, expect, vi } from "vitest";
import {
  criticMetrics,
  evidenceFromBuild,
  executePlannerProposal,
  rebuildFromCorrection,
  requestCorrectionSpec,
  type ReviewEvidence,
} from "@autospine/planning";
import { buildChainWave } from "@autospine/pipeline";
import { workflowFixture } from "./workflow-fixture.js";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => {
  fixture = await workflowFixture();
});
it("Gate 15 known numerical defect set has precision and recall 1, with clean controls", () => {
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
  const cases = [
    { patch: { inversionCount: 1 }, label: "inversion" },
    { patch: { minAreaRatio: 0.1 }, label: "collapse" },
    { patch: { maxEdgeStretch: 3 }, label: "stretch" },
    { patch: { maxSeamGap: 1 }, label: "seam" },
    { patch: { loopScore: 2 }, label: "loop" },
    { patch: { validWeights: false }, label: "weights" },
  ];
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const c of cases) {
    const output = criticMetrics({ ...good, ...c.patch }, 20).defects;
    tp += output.includes(c.label as (typeof output)[number]) ? 1 : 0;
    fn += output.includes(c.label as (typeof output)[number]) ? 0 : 1;
    fp += output.filter((d) => d !== c.label).length;
  }
  expect(tp / (tp + fp)).toBe(1);
  expect(tp / (tp + fn)).toBe(1);
  expect(criticMetrics(good, 20).defects).toEqual([]);
});
it("Gate 15 immutable correction triggers deterministic Core rebuild and re-evaluation, not direct geometry edits", () => {
  const { asset, job, proposal } = fixture,
    high = structuredClone(proposal);
  high.parameters.wave.amplitudeDegrees = 45;
  high.parameters.wave.phaseDegrees = 0;
  high.parameters.chain.boneCount = 12; // Deliberate bounded stress fixture, not a normal-art baseline.
  const source = executePlannerProposal(asset, job, high),
    before = JSON.stringify(source);
  const evidence = evidenceFromBuild(source, "high-wave", high),
    correction = criticMetrics(evidence, 45);
  expect(correction.defects.length).toBeGreaterThan(0);
  const rebuilt = rebuildFromCorrection(asset, job, high, correction, "high-wave");
  expect(rebuilt.engineeringPassed).toBe(true);
  expect(rebuilt.artistQualityAccepted).toBe(false);
  expect(rebuilt.result.mesh).toEqual(source.mesh);
  expect(rebuilt.result.rig).toEqual(source.rig);
  expect(JSON.stringify(source)).toBe(before);
  expect(rebuilt.result.diagnostics.deformation.minAreaRatio).toBeGreaterThan(
    source.diagnostics.deformation.minAreaRatio,
  );
});
it("Gate 15 rejects direct geometry edits, stale manifests and unresolved seams before Core", async () => {
  const { asset, job, proposal } = fixture,
    core = vi.fn(buildChainWave),
    result = executePlannerProposal(asset, job, proposal),
    evidence = evidenceFromBuild(result, "m", proposal),
    clean = criticMetrics(evidence, 8);
  for (const correction of [
    { ...clean, vertices: [] },
    { ...clean, manifestId: "stale" },
    { ...clean, requiresHumanReview: true },
  ])
    expect(() => rebuildFromCorrection(asset, job, proposal, correction, "m", core)).toThrow();
  expect(core).not.toHaveBeenCalled();
  const changed = structuredClone(proposal);
  changed.parameters.chain.boneCount = 3;
  expect(() => rebuildFromCorrection(asset, job, changed, clean, "m", core)).toThrow();
  expect(core).not.toHaveBeenCalled();
  const accepted = await requestCorrectionSpec(evidence, async () => clean);
  expect(accepted).toEqual(clean);
});
