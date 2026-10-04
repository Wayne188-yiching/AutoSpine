import { beforeAll, describe, expect, it } from "vitest";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { SPEC_SCHEMAS } from "@autospine/schemas";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";
import { criticMetrics, evidenceFromBuild, executePlannerProposal } from "@autospine/planning";
import { workflowFixture } from "./workflow-fixture.js";

interface DecisionCase {
  id: string;
  request: string;
  tool: string;
  expected: string;
}
const skillFile = resolve("skills/autospine/SKILL.md");
const catalog = JSON.parse(
  await readFile(resolve(dirname(skillFile), "decision-cases.json"), "utf8"),
) as { cases: DecisionCase[] };
let fixture: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => {
  fixture = await workflowFixture();
});
async function invoke(tool: string, args: unknown, workspace = fixture.directory) {
  const server = new AutoSpineMcpServer(workspace);
  await server.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "skill-walkthrough", version: "1" },
    },
  });
  await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
  const response = (await server.receive({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: tool, arguments: args },
  })) as {
    error?: unknown;
    result: { isError?: boolean; structuredContent: Record<string, unknown> };
  };
  expect(response.error).toBeUndefined();
  return response.result;
}
describe("Gate17 reference skill decisions through real tools", () => {
  it.each(catalog.cases)("$id: $expected", async (entry) => {
    const { asset, job, proposal } = fixture;
    const original = JSON.stringify({ asset, job, proposal });
    const built = executePlannerProposal(asset, job, proposal),
      evidence = evidenceFromBuild(built, job.id, proposal);
    const correction = criticMetrics(evidence, job.wave.amplitudeDegrees);
    const args = { asset, job, proposal, correction, manifestId: job.id };
    expect(mcpTools.some((t) => t.name === entry.tool)).toBe(true);
    switch (entry.id) {
      case "status": {
        const before = await readdir(fixture.directory),
          result = await invoke(entry.tool, {});
        expect(result.structuredContent.capabilities).toMatchObject({
          livePlannerVerified: false,
          liveVisionCriticVerified: false,
          artistQualityAccepted: false,
        });
        expect(await readdir(fixture.directory)).toEqual(before);
        break;
      }
      case "explicit-chain": {
        const f = await workflowFixture(),
          result = await invoke(entry.tool, { jobPath: "job.json" }, f.directory);
        expect(result.isError).not.toBe(true);
        const manifest = JSON.parse(
          await readFile(resolve(f.directory, f.job.output, "manifest.json"), "utf8"),
        );
        expect(manifest.id).toBe(f.job.id);
        expect(result.structuredContent.provenance).toHaveProperty("sourceSha256");
        expect(
          (result.structuredContent.diagnostics as { qualityAccepted: boolean }).qualityAccepted,
        ).toBe(false);
        break;
      }
      case "low-confidence": {
        const low = { ...proposal, confidence: 0.5 };
        const precheck = await invoke("autospine_validate_plan", { asset, proposal: low });
        expect(precheck.structuredContent.reviewRequired).toBe(true);
        const result = await invoke(entry.tool, { asset, job, proposal: low });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("PLAN_REVIEW_REQUIRED");
        break;
      }
      case "stale-asset": {
        const result = await invoke(entry.tool, {
          asset,
          proposal: { ...proposal, assetId: "another" },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("PLAN_SCHEMA");
        break;
      }
      case "geometry-injection": {
        const result = await invoke(entry.tool, {
          ...args,
          correction: { ...correction, vertices: [[0, 0]] },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent.code).toBe("MCP_TOOL_ARGUMENTS");
        break;
      }
      case "stale-correction": {
        const changed = structuredClone(proposal);
        changed.parameters.wave.amplitudeDegrees = 9;
        const result = await invoke(entry.tool, { ...args, proposal: changed });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("CORRECTION_SCHEMA");
        break;
      }
      case "unresolved-seam": {
        const seam = criticMetrics({ ...evidence, maxSeamGap: 1 }, job.wave.amplitudeDegrees);
        const result = await invoke(entry.tool, { ...args, correction: seam });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("CORRECTION_REVIEW_REQUIRED");
        break;
      }
      case "unsupported-profile": {
        const f = await workflowFixture();
        await writeFile(
          resolve(f.directory, "unknown.json"),
          JSON.stringify({ ...f.job, profile: "infer-human-anatomy" }),
        );
        const result = await invoke(entry.tool, { jobPath: "unknown.json" }, f.directory);
        expect(result.isError).toBe(true);
        expect(result.structuredContent.code).toBe("MCP_JOB_SCHEMA");
        await expect(access(resolve(f.directory, f.job.output))).rejects.toThrow();
        break;
      }
      case "existing-output": {
        const f = await workflowFixture();
        await invoke(entry.tool, { jobPath: "job.json" }, f.directory);
        const sourceBefore = await readFile(resolve(f.directory, "fish.png")),
          manifestBefore = await readFile(resolve(f.directory, f.job.output, "manifest.json"));
        expect((await invoke(entry.tool, { jobPath: "job.json" }, f.directory)).isError).toBe(true);
        expect(await readFile(resolve(f.directory, "fish.png"))).toEqual(sourceBefore);
        expect(await readFile(resolve(f.directory, f.job.output, "manifest.json"))).toEqual(
          manifestBefore,
        );
        break;
      }
      case "numeric-rebuild": {
        const stress = structuredClone(proposal);
        stress.parameters.chain.boneCount = 12;
        stress.parameters.wave.amplitudeDegrees = 45;
        stress.parameters.wave.phaseDegrees = 0;
        const measured = evidenceFromBuild(
          executePlannerProposal(asset, job, stress),
          job.id,
          stress,
        );
        expect(measured.inversionCount).toBeGreaterThan(0);
        const suggested = await invoke("autospine_review_metrics", {
          evidence: measured,
          amplitudeDegrees: 45,
        });
        const result = await invoke(entry.tool, {
          ...args,
          proposal: stress,
          correction: suggested.structuredContent.correction,
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent.engineeringPassed).toBe(true);
        expect(result.structuredContent.artistQualityAccepted).toBe(false);
        break;
      }
      default:
        throw new Error("Every decision case requires an observable engine/tool test");
    }
    expect(JSON.stringify({ asset, job, proposal })).toBe(original);
    await expect(access(resolve(fixture.directory, job.output))).rejects.toThrow();
  });
  it("resolves all skill references and leaves Core independent", async () => {
    const skill = await readFile(skillFile, "utf8");
    for (const [, link] of skill.matchAll(/\]\(([^)]+)\)/g))
      await access(resolve(dirname(skillFile), link!));
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
    for (const name of [
      "core",
      "assets",
      "mesh",
      "rig",
      "weights",
      "motion",
      "constraints",
      "pipeline",
    ]) {
      const pkg = JSON.parse(await readFile(resolve("packages", name, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@autospine/mcp");
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@autospine/planning");
    }
  });
  it("keeps the Planner implementation independent of its Critic export barrel", async () => {
    const source = ts.createSourceFile(
      "planner.ts",
      await readFile("packages/planning/src/planner.ts", "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).not.toContain("./index.js");
    expect(imports).not.toContain("./critic.js");
  });
});
