import { beforeAll, it, expect, vi } from "vitest";
import {
  executePlannerProposal,
  requestPlannerProposal,
  validatePlannerProposal,
} from "@autospine/planning";
import { buildChainWave } from "@autospine/pipeline";
import { workflowFixture } from "./workflow-fixture.js";
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => {
  fixture = await workflowFixture();
});
it("Gate 14 validated provider proposal executes actual Core with host-controlled paths", async () => {
  const { asset, job, proposal } = fixture;
  const provider = vi.fn(async (context) => {
    expect(JSON.stringify(context)).not.toMatch(/sourcePath|alphaMask|vertices|password/);
    return proposal;
  });
  const accepted = await requestPlannerProposal(asset, provider),
    result = executePlannerProposal(asset, job, accepted);
  expect(result.rig.bones).toHaveLength(job.chain.boneCount);
  expect(result.frames.length).toBeGreaterThan(1);
  expect(provider).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) expect(executePlannerProposal(asset, job, accepted)).toEqual(result);
});
it("Gate 14 invalid schema, stale assets, unknown fields, impossible geometry and low confidence call Core zero times", () => {
  const { asset, job, proposal } = fixture,
    core = vi.fn(buildChainWave);
  const bad = [
    null,
    { ...proposal, assetId: "stale" },
    { ...proposal, vertices: [] },
    { ...proposal, parameters: { ...proposal.parameters, output: "secret" } },
    {
      ...proposal,
      parameters: {
        ...proposal.parameters,
        chain: { ...proposal.parameters.chain, end: proposal.parameters.chain.start },
      },
    },
    { ...proposal, confidence: 0.2 },
  ];
  for (const p of bad) expect(() => executePlannerProposal(asset, job, p, core)).toThrow();
  expect(core).not.toHaveBeenCalled();
});
it("Gate 14 proposal validation preserves original data and rejects out-of-canvas endpoints", () => {
  const { asset, proposal } = fixture,
    before = JSON.stringify(proposal);
  const accepted = validatePlannerProposal(proposal, asset);
  accepted.parameters.chain.boneCount = 3;
  expect(JSON.stringify(proposal)).toBe(before);
  expect(() =>
    validatePlannerProposal(
      {
        ...proposal,
        parameters: {
          ...proposal.parameters,
          chain: { ...proposal.parameters.chain, start: [-1, 10] },
        },
      },
      asset,
    ),
  ).toThrow();
});
