import { describe, it, expect } from "vitest";
import { checkArtistCorpus } from "../tools/artist-corpus-policy.mjs";
import { readArtistMesh } from "../tools/reference-topology.mjs";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";

const sha = "a".repeat(64);
function fixture() {
  const png = new PNG({ width: 100, height: 100 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  const artist = readArtistMesh(
    {
      type: "mesh",
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      hull: 4,
      triangles: [0, 1, 2, 0, 2, 3],
      edges: [0, 4],
    },
    100,
    100,
    "4.0.64",
  );
  const generated = {
    schemaVersion: "0.1",
    kind: "mesh",
    id: "square",
    name: "Square",
    sourcePartId: "part",
    vertices: artist.vertices,
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    hull: artist.hull,
    triangles: artist.triangles,
    manualEdges: [[0, 2]],
  };
  return {
    policyVersion: "artist-region-typed-paths-5-v5",
    projects: ["yuuna", "panda", "pig"].map((id) => ({
      id,
      freshExport: true,
      sourceSha256: sha,
      exportSha256: sha,
      meshes: 1,
      requiredMeshIds: [id + "/square"],
    })),
    cases: ["yuuna", "panda", "pig"].map((project) => ({
      id: project + "/square",
      project,
      sourceType: "mesh",
      sourceSha256: sha,
      exportSha256: sha,
      pngSha256: createHash("sha256").update(bytes).digest("hex"),
      image: `data:image/png;base64,${bytes.toString("base64")}`,
      diagnostics: { referenceTopology: { maxAddedFraction: 0 } },
      referenceRegion: {
        mode: "artist-hull-pixel-centres",
        sourceForeground: 10000,
        targetForeground: 10000,
        excludedForeground: 0,
      },
      freshExport: true,
      dimensionMatch: true,
      width: 100,
      height: 100,
      artist: JSON.parse(JSON.stringify(artist)),
      generated: JSON.parse(JSON.stringify(generated)),
      deterministicRuns: 100,
    })),
    tutorialEvidence: [
      {
        videoSha256: sha,
        frameSha256: sha,
        timeSeconds: 10,
        observation: "Synthetic policy test, not production evidence",
      },
    ],
  };
}
describe("Full artist corpus precheck", () => {
  it("recomputes coverage from original PNG instead of trusting caller metrics", () => {
    const r = fixture();
    r.cases[0].generated.vertices[1][0] = 90;
    r.cases[0].generated.vertices[2][0] = 90;
    r.cases[0].coverage = { status: "PASSED", generated: { missedFraction: 0 } };
    expect(checkArtistCorpus(r).failures.some((x) => x.reason.startsWith("Scoped coverage"))).toBe(
      true,
    );
  });
  it("blocks wrong-image budgets and tampered PNG evidence", () => {
    for (const mutate of [
      (r) => (r.cases[0].diagnostics.referenceTopology.maxAddedFraction = 0.5),
      (r) => (r.cases[0].pngSha256 = sha),
      (r) => (r.cases[0].image = undefined),
      (r) => (r.cases[0].referenceRegion.excludedForeground = 99),
    ]) {
      const r = fixture();
      mutate(r);
      expect(checkArtistCorpus(r).status).toBe("BLOCKED");
    }
  });
  it("recomputes geometry instead of trusting supplied verdicts", () => {
    const report = fixture();
    expect(checkArtistCorpus(report).status).toBe("PASSED");
    report.cases[0].generated.triangles = [0, 1, 3, 1, 2, 3];
    report.cases[0].status = "PASSED";
    expect(checkArtistCorpus(report).status).toBe("REJECTED");
  });
  it("blocks old summaries, omitted cases, duplicated identities and stale exports", () => {
    expect(checkArtistCorpus({ summary: { passed: true } }).status).toBe("BLOCKED");
    expect(checkArtistCorpus({ ...fixture(), policyVersion: "artist-padding-5-v3" }).status).toBe(
      "BLOCKED",
    );
    for (const mutate of [
      (r) => r.cases.pop(),
      (r) => r.cases.push(r.cases[0]),
      (r) => (r.projects[0].freshExport = false),
      (r) => (r.projects[0].requiredMeshIds = []),
    ]) {
      const r = fixture();
      mutate(r);
      expect(checkArtistCorpus(r).status).toBe("BLOCKED");
    }
  });
  it("rejects dashed-for-solid substitution and a changed automatic diagonal in the full corpus", () => {
    const missingSolid = fixture();
    missingSolid.cases[0].generated.manualEdges = [];
    expect(checkArtistCorpus(missingSolid).failures).toContainEqual(
      expect.objectContaining({
        id: "yuuna/square",
        reason: "Typed hull/manual/automatic edge requirements not met",
        status: "REJECTED",
      }),
    );
    const flipped = fixture();
    flipped.cases[0].artist.manualEdges = [];
    flipped.cases[0].generated.manualEdges = [];
    flipped.cases[0].generated.triangles = [0, 1, 3, 1, 2, 3];
    expect(checkArtistCorpus(flipped).failures).toContainEqual(
      expect.objectContaining({
        id: "yuuna/square",
        reason: "Typed hull/manual/automatic edge requirements not met",
        status: "REJECTED",
      }),
    );
  });
  it("blocks missing manual edges, tutorial evidence and short determinism runs", () => {
    for (const mutate of [
      (r) => (r.cases[0].artist.manualEdges = null),
      (r) => (r.tutorialEvidence = []),
      (r) => (r.cases[0].deterministicRuns = 2),
      (r) => (r.cases[0].dimensionMatch = false),
    ]) {
      const r = fixture();
      mutate(r);
      expect(checkArtistCorpus(r).status).toBe("BLOCKED");
    }
  });
});
