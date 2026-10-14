import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildCharacterFiles,
  compareReferenceFiles,
  lintPlanFile,
  optimizeMotionFiles,
  stripImages,
} from "@autospine/cli/character";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";
import { fixturePlan, fixtureWorkspace } from "./character-fixture.js";

const cli = (...args: string[]) =>
  spawnSync(process.execPath, [resolve("packages/cli/dist/index.js"), ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });

describe("character plan files: CLI (ADR-017)", () => {
  it("lints, builds into a new directory, compares and optimises", async () => {
    const ws = await fixtureWorkspace();
    const plan = join(ws, "plan.json");
    expect((await lintPlanFile(plan)).errors).toEqual([]);

    const out = join(ws, "build");
    const built = await buildCharacterFiles(plan, out);
    expect(built).toMatchObject({ bones: 20, slots: 7, seams: 4, bend: {} });
    expect(built.setupDeviationPx).toBeLessThanOrEqual(0.01);
    expect((await readdir(out)).sort()).toEqual(
      [
        "build-record.json",
        "fixture_character.json",
        "images",
        "ir.json",
        "keypose-IDLE.json",
      ].sort(),
    );
    expect((await readdir(join(out, "images"))).length).toBe(7);
    const record = JSON.parse(await readFile(join(out, "build-record.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      plan: { id: "fixture_character" },
      artistQualityAccepted: false,
    });
    expect(record.params).toEqual(fixturePlan().motion.params);
    await expect(buildCharacterFiles(plan, out)).rejects.toThrow("CLI_OUTPUT_EXISTS");

    // The build compared with itself as the artist baseline passes every automatable criterion.
    const artist = join(out, "fixture_character.json");
    const check = await compareReferenceFiles(plan, out, artist, join(ws, "compare"));
    expect(check.pass).toBe(true);
    expect((await readdir(join(ws, "compare"))).sort()).toEqual(
      ["acceptance-check.json", "acceptance-results.json", "compare-IDLE.png"].sort(),
    );

    const run = await optimizeMotionFiles(plan, artist, join(ws, "opt"), { budgetSeconds: 20 });
    expect(run).toMatchObject({ status: "passed", evaluations: 1 });
    expect(JSON.parse(await readFile(join(ws, "opt", "best-params.json"), "utf8"))).toEqual(
      fixturePlan().motion.params,
    );

    // Optimised parameters feed straight back into a build.
    const tuned = join(ws, "tuned.json");
    await writeFile(tuned, JSON.stringify({ amp: 6 }));
    await buildCharacterFiles(plan, join(ws, "build-tuned"), tuned);
    const tunedRecord = JSON.parse(
      await readFile(join(ws, "build-tuned", "build-record.json"), "utf8"),
    ) as { params: Record<string, number> };
    expect(tunedRecord.params.amp).toBe(6);

    // A rigged document strips back to an images-only layout.
    const summary = await stripImages(artist, join(ws, "images"), join(ws, "stripped.json"));
    expect(summary).toMatchObject({ slots: 7, attachments: 7, over2px: [] });
    await expect(
      stripImages(artist, join(ws, "images"), join(ws, "stripped.json")),
    ).rejects.toThrow("CLI_OUTPUT_EXISTS");
  }, 120_000);

  it("refuses to build a plan that does not lint, and reports why", async () => {
    const ws = await fixtureWorkspace();
    const bad = fixturePlan();
    bad.motion.follow![0]!.gain = "$missing";
    await writeFile(join(ws, "bad.json"), JSON.stringify(bad));
    const r = cli("build-character", join(ws, "bad.json"), join(ws, "never"));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("CLI_PLAN_LINT");
    expect(r.stderr).toContain("unknown parameter missing");
    expect(await readdir(ws)).not.toContain("never");
    const lint = cli("lint-plan", join(ws, "bad.json"));
    expect(lint.status).toBe(2);
    expect(JSON.parse(lint.stdout).errors).toHaveLength(1);
  });
});

async function ready(workspace: string) {
  const server = new AutoSpineMcpServer(workspace);
  await server.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
  return async (name: string, args: unknown) => {
    const r = (await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    })) as {
      result: { isError?: boolean; structuredContent: Record<string, unknown> };
    };
    return { error: r.result.isError === true, body: r.result.structuredContent };
  };
}

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("character plan files: MCP tools (ADR-017)", () => {
  it("annotates the file tools as writing and the lint as read-only", () => {
    const hint = (n: string) => mcpTools.find((t) => t.name === n)!.annotations.readOnlyHint;
    expect(hint("autospine_lint_character_plan")).toBe(true);
    for (const n of [
      "autospine_build_character",
      "autospine_compare_reference",
      "autospine_optimize_motion",
      "autospine_review_video",
    ])
      expect(hint(n)).toBe(false);
  });

  it("lints a plan object and returns schema errors for a malformed one", async () => {
    const call = await ready(await mkdtemp(resolve(tmpdir(), "autospine-mcp-")));
    const ok = await call("autospine_lint_character_plan", { plan: fixturePlan() });
    expect(ok).toMatchObject({ error: false, body: { valid: true, errors: [] } });
    const bad = await call("autospine_lint_character_plan", {
      plan: { ...fixturePlan(), kind: "rig" },
    });
    expect(bad.error).toBe(true);
    expect(JSON.stringify(bad.body.schemaErrors)).toContain("/kind");
    const parts = await call("autospine_lint_character_plan", {
      plan: fixturePlan(),
      partNames: ["Body"],
    });
    expect(parts.error).toBe(true);
    expect(JSON.stringify(parts.body.errors)).toContain("no part Head");
  });

  it("builds and compares inside the workspace only, into new directories", async () => {
    const ws = await fixtureWorkspace();
    const call = await ready(ws);
    const built = await call("autospine_build_character", {
      planPath: "plan.json",
      outputDir: "out/build",
    });
    expect(built.error).toBe(false);
    expect(built.body).toMatchObject({
      output: join("out", "build", "fixture_character.json"),
      bones: 20,
      artistQualityAccepted: false,
    });
    expect(
      (await call("autospine_build_character", { planPath: "plan.json", outputDir: "out/build" }))
        .body.code,
    ).toBe("MCP_OUTPUT_EXISTS");
    for (const args of [
      { planPath: "../plan.json", outputDir: "x" },
      { planPath: "plan.json", outputDir: "../escape" },
      { planPath: "plan.json", outputDir: "." },
    ])
      expect((await call("autospine_build_character", args)).body.code).toBe(
        "MCP_WORKSPACE_POLICY",
      );
    // A plan whose sources point outside the workspace is refused before anything is read.
    const escape = {
      ...fixturePlan(),
      source: { imagesOnly: "../imagesOnly.json", images: "images" },
    };
    await writeFile(join(ws, "escape.json"), JSON.stringify(escape));
    expect(
      (await call("autospine_build_character", { planPath: "escape.json", outputDir: "y" })).body
        .code,
    ).toBe("MCP_WORKSPACE_POLICY");

    const compared = await call("autospine_compare_reference", {
      planPath: "plan.json",
      buildDir: "out/build",
      artistPath: "out/build/fixture_character.json",
      outputDir: "out/compare",
    });
    expect(compared.error).toBe(false);
    expect(compared.body).toMatchObject({
      pass: true,
      output: join("out", "compare"),
      artistQualityAccepted: false,
    });
    const optimised = await call("autospine_optimize_motion", {
      planPath: "plan.json",
      artistPath: "out/build/fixture_character.json",
      stateDir: "out/opt",
      budgetSeconds: 10,
    });
    expect(optimised.body).toMatchObject({ status: "passed", stateDir: join("out", "opt") });
    if (hasFfmpeg) {
      const video = await call("autospine_review_video", {
        planPath: "plan.json",
        buildDir: "out/build",
        artistPath: "out/build/fixture_character.json",
        outputPath: "out/review.mp4",
        loops: 1,
      });
      expect(video.error).toBe(false);
      // IDLE is 80 frames: wireframe, bones and motion once each.
      expect(video.body).toMatchObject({ output: join("out", "review.mp4"), frames: 240 });
      expect((await stat(join(ws, "out", "review.mp4"))).size).toBeGreaterThan(1000);
      // Without an artist file the video shows the build alone: one tile wide.
      const alone = await call("autospine_review_video", {
        planPath: "plan.json",
        buildDir: "out/build",
        outputPath: "out/alone.mp4",
        loops: 1,
      });
      expect(alone.error).toBe(false);
      expect((alone.body.width as number) * 2).toBeLessThan(video.body.width as number);
    }
    expect((await readdir(ws)).sort()).toEqual([
      "escape.json",
      "images",
      "imagesOnly.json",
      "out",
      "plan.json",
    ]);
  }, 120_000);
});
