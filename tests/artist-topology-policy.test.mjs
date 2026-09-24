import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  checkGate32TopologySummary,
  compareArtistTopology,
} from "../tools/artist-topology-policy.mjs";

const square = {
  vertices: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  hull: [0, 1, 2, 3],
  triangles: [0, 1, 2, 0, 2, 3],
  manualEdges: [],
};
const compare = (artist, generated) =>
  compareArtistTopology({ id: "fixture", artist, generated, width: 100, height: 100 });

describe("Matched Spine topology hard gate", () => {
  it("accepts identical points and both automatically triangulated and manual connections", () => {
    expect(compare(square, { ...square, manualEdges: undefined })).toMatchObject({
      status: "PASSED",
      maxPositionFraction: 0,
      hullEdgeRecall: 1,
      manualEdgeRecall: 1,
      automaticEdgeRecall: 1,
    });
    const manual = { ...square, manualEdges: [[0, 2]] };
    expect(compare(manual, manual).status).toBe("PASSED");
  });

  it("fails a vertex beyond 5% of the image diagonal even with the correct count", () => {
    const shifted = {
      ...square,
      vertices: square.vertices.map((point, index) => (index === 1 ? [92, 0] : point)),
    };
    const result = compare(square, shifted);
    expect(result.status).toBe("REJECTED");
    expect(result.maxPositionFraction).toBeGreaterThan(0.05);
  });

  it("does not pass a missing orange manual line using a dashed triangle side", () => {
    const artist = { ...square, manualEdges: [[0, 2]] };
    const result = compare(artist, { ...square, manualEdges: undefined });
    expect(result.status).toBe("REJECTED");
    expect(result.manualEdgeRecall).toBe(0);
    expect(result.artistManualEdgeCount).toBe(1);
  });

  it("fails a changed dashed diagonal despite identical vertices and hull", () => {
    const generated = { ...square, triangles: [0, 1, 3, 1, 2, 3] };
    const result = compare(square, generated);
    expect(result.status).toBe("REJECTED");
    expect(result.automaticEdgeRecall).toBe(0);
  });

  it("blocks comparison when the artist's nonessential edges were not classified", () => {
    expect(compare({ ...square, manualEdges: undefined }, square).status).toBe("BLOCKED");
  });

  it("enforces topology metrics before loading Jev even when vertex counts pass", () => {
    const folder = mkdtempSync(join(tmpdir(), "autospine-topology-policy-"));
    try {
      const path = join(folder, "review.json");
      const failed = {
        maxPositionFraction: 0.06,
        hullEdgeRecall: 1,
        manualEdgeRecall: 1,
        automaticEdgeRecall: 0.9,
        artistManualEdgeCount: 0,
        generatedManualEdgeCount: 0,
      };
      const review = {
        gate: 3.2,
        metrics: {
          beard: { artist: { vertices: 24 }, generated: { vertices: 24 }, topology: failed },
          house: { artist: { vertices: 25 }, generated: { vertices: 25 }, topology: failed },
        },
      };
      expect(checkGate32TopologySummary(review).status).toBe("REJECTED");
      writeFileSync(path, JSON.stringify(review));
      const result = spawnSync(process.execPath, [resolve("tools/jev-gate-review.mjs"), path], {
        encoding: "utf8",
        env: { ...process.env, JEV_TEST_ROOT: join(folder, "no-sdk-installed") },
      });
      if (result.error) throw result.error;
      expect(result.status, result.stderr).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ jevCalled: false, status: "REJECTED" });
      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved.artistVertexPrecheck.status).toBe("PASSED");
      expect(saved.artistTopologyPrecheck.status).toBe("REJECTED");
      expect(saved.jevReview).toBeUndefined();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
