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
import { compareTypedEdges, compareVertexPositions } from "../tools/reference-topology.mjs";

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
  it("accepts an extra hull point on the same straight boundary without a 100% penalty", () => {
    const generated = {
      ...square,
      vertices: [...square.vertices, [50, 0]],
      hull: [0, 4, 1, 2, 3],
      triangles: [0, 4, 2, 4, 1, 2, 0, 2, 3],
    };
    const result = compare(square, generated);
    expect(result.status).toBe("PASSED");
    expect(result.positions.groups.hull).toMatchObject({ unmatched: 1, max: 0 });
  });

  it("checks unmatched interiors against interiors, never nearby hull vertices", () => {
    const artist = { ...square, vertices: [...square.vertices, [50, 50]] };
    const generated = { ...artist, vertices: [...artist.vertices, [0.1, 0.1]] };
    expect(compareVertexPositions(artist, generated, 100, 100).passed).toBe(false);
  });

  it("accepts only same-type bounded subdivisions and never deletes a mapped feature", () => {
    const artist = { ...square, manualEdges: [[0, 2]] };
    const generated = {
      ...square,
      vertices: [...square.vertices, [50, 50]],
      triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
      manualEdges: [
        [0, 4],
        [4, 2],
      ],
    };
    const pairs = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(compareTypedEdges(artist, generated, pairs).manual.status).toBe("PASSED");
    expect(
      compareTypedEdges(artist, { ...generated, manualEdges: [[0, 4]] }, pairs).manual.status,
    ).toBe("REJECTED");
    const bent = { ...generated, vertices: [...square.vertices, [50, 52]] };
    expect(compareTypedEdges(artist, bent, pairs).manual.status).toBe("REJECTED");
    expect(compareTypedEdges(artist, generated, [...pairs, [4, 4]]).manual.status).toBe("REJECTED");
  });

  it("blocks a fake manual-edge label not present in the candidate triangles", () => {
    expect(compare(square, { ...square, manualEdges: [[1, 3]] }).status).toBe("BLOCKED");
  });
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

  it("blocks legacy two-attachment evidence before loading Jev", () => {
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
      expect(result.status, result.stderr).toBe(3);
      expect(JSON.parse(result.stdout)).toMatchObject({ jevCalled: false, status: "BLOCKED" });
      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved.artistVertexPrecheck.status).toBe("BLOCKED");
      expect(saved.artistTopologyPrecheck).toBeUndefined();
      expect(saved.jevReview).toBeUndefined();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
