import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { parsePngParts } from "@autospine/assets";
import type { BuildJob } from "@autospine/schemas";
import type { PlannerProposal } from "@autospine/planning";

export async function workflowFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "autospine-workflow-")),
    directory = resolve(root, "demo");
  execFileSync(process.execPath, [resolve("fixtures/chain-wave/create-demo.mjs"), directory]);
  const job = JSON.parse(await readFile(resolve(directory, "job.json"), "utf8")) as BuildJob;
  const asset = await parsePngParts(directory, {
    id: job.id + "-asset",
    name: job.name,
    sourcePath: "fish.png",
    manifest: {
      width: 160,
      height: 80,
      parts: [{ id: job.id + "-part", name: job.name, file: "fish.png", x: 0, y: 0, drawOrder: 0 }],
    },
  });
  const proposal: PlannerProposal = {
    schemaVersion: "0.1",
    kind: "planner-proposal",
    assetId: asset.id,
    confidence: 0.9,
    parameters: { chain: job.chain, wave: job.wave, cleanupFraction: job.cleanupFraction },
    warnings: ["Explicit chain; no anatomical inference"],
  };
  return { directory, job, asset, proposal };
}
