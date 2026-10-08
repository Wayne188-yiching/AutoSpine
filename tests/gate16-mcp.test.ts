import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AutoSpineMcpServer, guardJob, mcpTools } from "@autospine/mcp";
import { criticMetrics, evidenceFromBuild, executePlannerProposal } from "@autospine/planning";
import { workflowFixture } from "./workflow-fixture.js";

interface Reply {
  jsonrpc: string;
  id: unknown;
  error?: { code: number; message: string };
  result?: {
    protocolVersion?: string;
    tools?: typeof mcpTools;
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
  };
}
const init = (version = "2025-11-25") => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: "test-host", version: "1" },
  },
});
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };
const call = (id: number, name: string, args: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});
const body = (reply: Reply) => reply.result!.structuredContent!;
async function ready(workspace: string) {
  const server = new AutoSpineMcpServer(workspace);
  await server.receive(init());
  await server.receive(initialized);
  return server;
}
async function request(server: AutoSpineMcpServer, name: string, args: unknown = {}) {
  return (await server.receive(call(2, name, args))) as Reply;
}
function subprocess(workspace: string, input: string | Buffer, messageLimit = "1") {
  const child = spawnSync(process.execPath, [resolve("packages/mcp/dist/stdio.js")], {
    env: {
      ...process.env,
      AUTOSPINE_WORKSPACE: workspace,
      AUTOSPINE_MCP_MAX_MESSAGE_MIB: messageLimit,
    },
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stderr).toBe("");
  return child.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Reply);
}
describe("Gate16 actual legacy stdio MCP", () => {
  it("handshakes, lists strict tools, executes and builds in a real child process", async () => {
    const f = await workflowFixture();
    const input =
      [
        init(),
        initialized,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        call(3, "autospine_execute_plan", { asset: f.asset, job: f.job, proposal: f.proposal }),
        call(4, "autospine_build", { jobPath: "job.json" }),
        call(5, "autospine_build", { jobPath: "job.json" }),
      ]
        .map((v) => JSON.stringify(v))
        .join("\n") + "\n";
    const replies = subprocess(f.directory, input);
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(replies[0]!.result!.protocolVersion).toBe("2025-11-25");
    expect(replies[1]!.result!.tools!.map((t) => t.name)).toEqual(mcpTools.map((t) => t.name));
    expect(replies[2]!.result!.isError).not.toBe(true);
    expect(body(replies[3]!).output).toBe(await realpath(resolve(f.directory, f.job.output)));
    expect(body(replies[3]!).provenance).toHaveProperty("sourceSha256");
    expect(replies[4]!.result!.isError).toBe(true);
    expect(JSON.stringify(body(replies[4]!))).toContain("BUILD_OUTPUT_EXISTS");
    expect(
      JSON.parse(await readFile(resolve(f.directory, f.job.output, "manifest.json"), "utf8")).id,
    ).toBe(f.job.id);
  });
  it.each(["2025-06-18", "2026-07-28"])("explicit legacy negotiation with %s", async (version) => {
    const server = new AutoSpineMcpServer(process.cwd());
    const reply = (await server.receive(init(version))) as Reply;
    expect(reply.result!.protocolVersion).toBe(version === "2025-06-18" ? version : "2025-11-25");
  });
  it("modern discovery clearly requests legacy fallback, not false modern support", async () => {
    const server = new AutoSpineMcpServer(process.cwd());
    expect(
      ((await server.receive({ jsonrpc: "2.0", id: 1, method: "server/discover" })) as Reply).error
        ?.code,
    ).toBe(-32601);
  });
  it("requires both initialize and initialized notification before tools", async () => {
    const server = new AutoSpineMcpServer(process.cwd());
    expect(((await server.receive(call(2, "autospine_get_status"))) as Reply).error?.code).toBe(
      -32002,
    );
    await server.receive(init());
    expect(((await server.receive(call(2, "autospine_get_status"))) as Reply).error?.code).toBe(
      -32002,
    );
    await server.receive(initialized);
    expect((await request(server, "autospine_get_status")).error).toBeUndefined();
    expect(((await server.receive(init())) as Reply).error?.code).toBe(-32602);
  });
  it.each([
    null,
    [],
    {},
    { jsonrpc: "1.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: null, method: "ping" },
  ])("rejects invalid request %#", async (input) => {
    expect(
      ((await new AutoSpineMcpServer(process.cwd()).receive(input)) as Reply).error?.code,
    ).toBe(-32600);
  });
  it("maps protocol errors separately from tool errors", async () => {
    const server = await ready(process.cwd());
    expect((await request(server, "not-a-tool")).error?.code).toBe(-32602);
    expect(
      ((await server.receive({ jsonrpc: "2.0", id: 3, method: "unknown" })) as Reply).error?.code,
    ).toBe(-32601);
    const bad = await request(server, "autospine_build", { jobPath: 42 });
    expect(bad.error).toBeUndefined();
    expect(bad.result!.isError).toBe(true);
    expect(body(bad).code).toBe("MCP_TOOL_ARGUMENTS");
    expect(
      (
        (await server.receive({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: { cursor: "invented" },
        })) as Reply
      ).error?.code,
    ).toBe(-32602);
  });
  it("rejects malformed initialize capability metadata", async () => {
    const request = init();
    request.params.capabilities = [];
    expect(
      ((await new AutoSpineMcpServer(process.cwd()).receive(request)) as Reply).error?.code,
    ).toBe(-32602);
  });
  it("rejects invalid UTF-8 rather than silently replacing private request bytes", () => {
    const bytes = Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":1,"method":"'),
      Buffer.from([0xc0]),
      Buffer.from('"}\n'),
    ]);
    expect(subprocess(process.cwd(), bytes)[0]!.error?.code).toBe(-32700);
  });
  it("recovers after malformed and oversized input without stdout logging", () => {
    const input = "bad json\n" + "x".repeat(1024 * 1024 + 5) + "\n" + JSON.stringify(init()) + "\n";
    const replies = subprocess(process.cwd(), input);
    expect(replies.map((r) => r.error?.code ?? r.id)).toEqual([-32700, -32600, 1]);
    expect(subprocess(process.cwd(), JSON.stringify(init()))[0]!.error?.code).toBe(-32700);
  });
  it("accepts a host-selected bounded message limit and falls back for invalid limits", () => {
    const large = JSON.stringify({ ...init(), padding: "x".repeat(1024 * 1024 + 8) }) + "\n";
    expect(subprocess(process.cwd(), large, "2")[0]!.result?.protocolVersion).toBe("2025-11-25");
    expect(subprocess(process.cwd(), large, "17")[0]!.error?.message).toMatch(/1 MiB/);
    expect(subprocess(process.cwd(), large, "NaN")[0]!.error?.message).toMatch(/1 MiB/);
  });
  it("notifications never invoke filesystem mutation", async () => {
    const f = await workflowFixture(),
      server = await ready(f.directory);
    const notification = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "autospine_build", arguments: { jobPath: "job.json" } },
    };
    expect(await server.receive(notification)).toBeUndefined();
    await expect(access(resolve(f.directory, f.job.output))).rejects.toThrow();
  });
  it("read-only status discloses unverified AI and causes no writes", async () => {
    const f = await workflowFixture(),
      before = await readdir(f.directory),
      server = await ready(f.directory);
    const r = await request(server, "autospine_get_status");
    expect(body(r).capabilities).toMatchObject({
      livePlannerVerified: false,
      liveVisionCriticVerified: false,
      artistQualityAccepted: false,
    });
    expect(await readdir(f.directory)).toEqual(before);
    expect(mcpTools.find((t) => t.name === "autospine_build")!.annotations.readOnlyHint).toBe(
      false,
    );
    expect(mcpTools.every((t) => t.inputSchema.additionalProperties === false)).toBe(true);
  });
  it("low confidence is visibly review-required and cannot execute", async () => {
    const f = await workflowFixture(),
      server = await ready(f.directory),
      proposal = { ...f.proposal, confidence: 0.5 };
    expect(
      body(await request(server, "autospine_validate_plan", { asset: f.asset, proposal }))
        .reviewRequired,
    ).toBe(true);
    const r = await request(server, "autospine_execute_plan", {
      asset: f.asset,
      job: f.job,
      proposal,
    });
    expect(r.result!.isError).toBe(true);
    expect(JSON.stringify(body(r))).toContain("PLAN_REVIEW_REQUIRED");
  });
  it("measures a defect and corrects immutably through real tools", async () => {
    const f = await workflowFixture(),
      server = await ready(f.directory);
    f.proposal.parameters = structuredClone(f.proposal.parameters);
    f.proposal.parameters.chain.boneCount = 12;
    f.proposal.parameters.wave.amplitudeDegrees = 45;
    f.proposal.parameters.wave.phaseDegrees = 0;
    const first = await request(server, "autospine_execute_plan", {
      asset: f.asset,
      job: f.job,
      proposal: f.proposal,
    });
    const evidence = body(first).evidence;
    const correction = body(
      await request(server, "autospine_review_metrics", { evidence, amplitudeDegrees: 45 }),
    ).correction;
    const r = await request(server, "autospine_apply_correction", {
      asset: f.asset,
      job: f.job,
      proposal: f.proposal,
      correction,
      manifestId: f.job.id,
    });
    expect(r.result!.isError).not.toBe(true);
    expect(body(r).engineeringPassed).toBe(true);
    expect(body(r).artistQualityAccepted).toBe(false);
    expect(f.proposal.parameters.wave.amplitudeDegrees).toBe(45);
    await expect(access(resolve(f.directory, f.job.output))).rejects.toThrow();
  });
  it("rejects stale corrections and direct geometry injection", async () => {
    const f = await workflowFixture(),
      server = await ready(f.directory);
    const evidence = evidenceFromBuild(
      executePlannerProposal(f.asset, f.job, f.proposal),
      f.job.id,
      f.proposal,
    );
    const correction = criticMetrics(evidence, 8);
    correction.inputFingerprint = "f".repeat(64);
    const args = {
      asset: f.asset,
      job: f.job,
      proposal: f.proposal,
      correction,
      manifestId: f.job.id,
    };
    expect(
      JSON.stringify(body(await request(server, "autospine_apply_correction", args))),
    ).toContain("CORRECTION_SCHEMA");
    expect(
      (await request(server, "autospine_apply_correction", { ...args, vertices: [[0, 0]] })).result!
        .isError,
    ).toBe(true);
  });
  it("blocks seams rather than automatically relabelling a repair as approved", async () => {
    const f = await workflowFixture(),
      server = await ready(f.directory);
    const evidence = evidenceFromBuild(
      executePlannerProposal(f.asset, f.job, f.proposal),
      f.job.id,
      f.proposal,
    );
    evidence.maxSeamGap = 1;
    const correction = criticMetrics(evidence, 8);
    const r = await request(server, "autospine_apply_correction", {
      asset: f.asset,
      job: f.job,
      proposal: f.proposal,
      correction,
      manifestId: f.job.id,
    });
    expect(r.result!.isError).toBe(true);
    expect(JSON.stringify(body(r))).toContain("CORRECTION_REVIEW_REQUIRED");
  });
  it("rejects out-of-workspace jobs, source and output before build", async () => {
    const f = await workflowFixture();
    await expect(guardJob(f.directory, "../job.json")).rejects.toThrow("MCP_WORKSPACE_POLICY");
    for (const property of ["source", "output"] as const) {
      const path = resolve(f.directory, property + "-escape.json");
      await writeFile(path, JSON.stringify({ ...f.job, [property]: "../../escape" }));
      await expect(guardJob(f.directory, path)).rejects.toThrow("MCP_WORKSPACE_POLICY");
    }
    await expect(access(resolve(f.directory, f.job.output))).rejects.toThrow();
  });
  it("rejects parent junctions escaping the configured workspace", async () => {
    const f = await workflowFixture(),
      outside = await mkdtemp(resolve(tmpdir(), "autospine-outside-"));
    await symlink(outside, resolve(f.directory, "escape"), "junction");
    await writeFile(
      resolve(f.directory, "escape-job.json"),
      JSON.stringify({ ...f.job, output: "escape/build" }),
    );
    await expect(guardJob(f.directory, "escape-job.json")).rejects.toThrow("MCP_WORKSPACE_POLICY");
    expect(await readdir(outside)).toEqual([]);
  });
  it("limits job file size before parsing", async () => {
    const f = await workflowFixture();
    await writeFile(resolve(f.directory, "oversized.json"), " ".repeat(64 * 1024 + 1));
    await expect(guardJob(f.directory, "oversized.json")).rejects.toThrow("MCP_WORKSPACE_POLICY");
  });
});
