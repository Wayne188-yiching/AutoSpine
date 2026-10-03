import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  checkArtistVertexCounts,
  checkGate32ArtistCounts,
} from "../tools/artist-vertex-policy.mjs";

describe("Artist reference hard acceptance rule", () => {
  it("blocks legacy passing counts without loading Jev", () => {
    const folder = mkdtempSync(join(tmpdir(), "autospine-corpus-required-"));
    try {
      const path = join(folder, "review.json");
      writeFileSync(
        path,
        JSON.stringify({
          gate: 3.2,
          metrics: {
            beard: { artist: { vertices: 24 }, generated: { vertices: 24 } },
            house: { artist: { vertices: 25 }, generated: { vertices: 25 } },
          },
        }),
      );
      const result = spawnSync(process.execPath, [resolve("tools/jev-gate-review.mjs"), path], {
        encoding: "utf8",
        env: { ...process.env, JEV_TEST_ROOT: join(folder, "missing") },
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(3);
      expect(JSON.parse(result.stdout)).toMatchObject({ jevCalled: false, status: "BLOCKED" });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("stops the actual review runner before loading an SDK or calling Jev", () => {
    const folder = mkdtempSync(join(tmpdir(), "autospine-artist-policy-"));
    try {
      const path = join(folder, "review.json");
      writeFileSync(
        path,
        JSON.stringify({
          gate: 3.2,
          metrics: {
            beard: { artist: { vertices: 24 }, generated: { vertices: 25 } },
            house: { artist: { vertices: 25 }, generated: { vertices: 11 } },
          },
        }),
      );
      const result = spawnSync(process.execPath, [resolve("tools/jev-gate-review.mjs"), path], {
        encoding: "utf8",
        env: { ...process.env, JEV_TEST_ROOT: join(folder, "no-sdk-installed") },
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ jevCalled: false, status: "REJECTED" });
      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved.artistVertexPrecheck.status).toBe("REJECTED");
      expect(saved.jevReview).toBeUndefined();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  const evaluate = (artistVertices, generatedVertices) =>
    checkArtistVertexCounts([{ id: "matched", artistVertices, generatedVertices }]);
  it("enforces absolute +/-5 even when percentage rules would accept a larger error", () => {
    for (const base of [25, 80, 200]) {
      for (const delta of [-5, 0, 5]) expect(evaluate(base, base + delta).status).toBe("PASSED");
      for (const delta of [-6, 6]) expect(evaluate(base, base + delta).status).toBe("REJECTED");
    }
  });
  it("uses whole vertices without rounding away excess error", () => {
    expect(evaluate(24, 25).cases[0]).toMatchObject({ minimum: 19, maximum: 29 });
    expect(evaluate(24, 18).status).toBe("REJECTED");
    expect(evaluate(24, 30).status).toBe("REJECTED");
    expect(evaluate(24, 19).status).toBe("PASSED");
    expect(evaluate(24, 29).status).toBe("PASSED");
    expect(evaluate(4, 3).cases[0].minimum).toBe(3);
  });
  it("rejects the current house despite the beard passing", () => {
    const result = checkGate32ArtistCounts({
      metrics: {
        beard: { artist: { vertices: 24 }, generated: { vertices: 25 } },
        house: { artist: { vertices: 25 }, generated: { vertices: 11 } },
      },
    });
    expect(result.status).toBe("REJECTED");
    expect(result.cases[1].signedDeviation).toBe(-0.56);
  });
  it("blocks absent references and invalid counts without inventing a baseline", () => {
    expect(checkArtistVertexCounts([]).status).toBe("BLOCKED");
    expect(checkGate32ArtistCounts({}).status).toBe("BLOCKED");
    for (const bad of [undefined, NaN, Infinity, -1, 2, 24.5, "24"])
      expect(evaluate(bad, 25).status).toBe("BLOCKED");
    expect(evaluate(25, undefined).status).toBe("BLOCKED");
  });
});
