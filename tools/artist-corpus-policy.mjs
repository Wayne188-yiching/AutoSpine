import {
  compareVertexPositions,
  compareTypedEdges,
  compareArtistCoverage,
} from "./reference-topology.mjs";
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { checkArtistVertexCounts } from "./artist-vertex-policy.mjs";
import { validateMeshSpec } from "@autospine/mesh";

/** Recompute gates from actual geometry, never accept a caller's PASSED string. */
export function checkArtistCorpus(report) {
  const failures = [];
  const fail = (id, reason, status = "BLOCKED") => failures.push({ id, reason, status });
  if (
    report?.policyVersion !== "artist-region-typed-paths-5-v5" ||
    !Array.isArray(report.projects) ||
    !Array.isArray(report.cases)
  )
    return { status: "BLOCKED", failures: [{ reason: "Current artist corpus report required" }] };
  const ids = report.cases.map((c) => c.id);
  if (new Set(ids).size !== ids.length) fail("corpus", "Duplicate attachment identities");
  for (const id of ["yuuna", "panda", "pig"]) {
    const projects = report.projects.filter((p) => p.id === id);
    if (projects.length !== 1) {
      fail(id, "Exactly one primary source project required");
      continue;
    }
    const p = projects[0],
      cases = report.cases.filter((c) => c.project === id && c.sourceType === "mesh");
    if (
      !p.freshExport ||
      !/^[a-f0-9]{64}$/.test(p.sourceSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(p.exportSha256 ?? "")
    )
      fail(id, "Fresh source-matched export and hashes required");
    if (
      !Number.isSafeInteger(p.meshes) ||
      p.meshes < 1 ||
      cases.length !== p.meshes ||
      !Array.isArray(p.requiredMeshIds) ||
      p.requiredMeshIds.length !== p.meshes ||
      new Set(p.requiredMeshIds).size !== p.meshes ||
      p.requiredMeshIds.some((key) => !cases.some((c) => c.id === key))
    )
      fail(id, "A required source attachment is absent or duplicated");
    for (const c of cases) {
      if (
        c.sourceSha256 !== p.sourceSha256 ||
        c.exportSha256 !== p.exportSha256 ||
        !c.freshExport ||
        !c.dimensionMatch ||
        !/^[a-f0-9]{64}$/.test(c.pngSha256 ?? "")
      )
        fail(c.id, "Source/PNG identity or dimensions unverified");
      if (!c.artist || !c.generated) {
        fail(c.id, c.error ?? "Generated/reference mesh absent");
        continue;
      }
      if (validateMeshSpec(c.generated).status !== "passed") {
        fail(c.id, "Generated topology invalid", "REJECTED");
        continue;
      }
      try {
        if (typeof c.image !== "string" || !c.image.startsWith("data:image/png;base64,"))
          throw new Error("Original PNG evidence required");
        const bytes = Buffer.from(c.image.slice("data:image/png;base64,".length), "base64");
        if (createHash("sha256").update(bytes).digest("hex") !== c.pngSha256)
          throw new Error("Original PNG hash mismatch");
        const png = PNG.sync.read(bytes);
        if (png.width !== c.width || png.height !== c.height)
          throw new Error("Original PNG dimensions mismatch");
        const alpha = Uint8Array.from(
          { length: png.width * png.height },
          (_, i) => png.data[i * 4 + 3],
        );
        const coverage = compareArtistCoverage(
          c.artist,
          c.generated,
          alpha,
          png.width,
          png.height,
          true,
        );
        if (
          c.referenceRegion?.mode !== "artist-hull-pixel-centres" ||
          c.referenceRegion.sourceForeground !== coverage.sourceForeground ||
          c.referenceRegion.targetForeground !== coverage.targetForeground ||
          c.referenceRegion.excludedForeground !== coverage.excludedForeground
        )
          fail(c.id, "Reference-conditioned region must be disclosed and match original PNG");
        if (coverage.status !== "PASSED")
          fail(
            c.id,
            "Scoped coverage exceeds artist padding, 2% missed foreground, or includes excluded source content",
            "REJECTED",
          );
        if (c.diagnostics?.referenceTopology?.maxAddedFraction !== coverage.maxAddedFraction)
          fail(c.id, "Generation padding budget not matched to this attachment");
      } catch (error) {
        fail(c.id, error.message);
      }
      const counts = checkArtistVertexCounts([
        {
          id: c.id,
          artistVertices: c.artist.vertices.length,
          generatedVertices: c.generated.vertices.length,
        },
      ]);
      if (counts.status !== "PASSED") fail(c.id, "Vertex difference exceeds five", counts.status);
      try {
        const positions = compareVertexPositions(c.artist, c.generated, c.width, c.height);
        if (!positions.passed) fail(c.id, "Vertex position limits not met", "REJECTED");
        const edges = compareTypedEdges(c.artist, c.generated, positions.pairs);
        if (edges.status !== "PASSED")
          fail(c.id, "Typed hull/manual/automatic edge requirements not met", edges.status);
      } catch (error) {
        fail(c.id, error.message);
      }
      if (!Number.isInteger(c.deterministicRuns) || c.deterministicRuns < 100)
        fail(c.id, "100 deterministic runs required");
    }
  }
  if (
    !Array.isArray(report.tutorialEvidence) ||
    !report.tutorialEvidence.some(
      (x) =>
        /^[a-f0-9]{64}$/.test(x.videoSha256 ?? "") &&
        Number.isFinite(x.timeSeconds) &&
        x.timeSeconds >= 0 &&
        /^[a-f0-9]{64}$/.test(x.frameSha256 ?? "") &&
        typeof x.observation === "string" &&
        x.observation.trim().length > 0,
    )
  )
    fail("tutorial", "Timestamped, hashed tutorial frame observations required");
  return {
    policyVersion: report.policyVersion,
    status: failures.some((f) => f.status === "REJECTED")
      ? "REJECTED"
      : failures.length
        ? "BLOCKED"
        : "PASSED",
    failures,
    checkedMeshes: report.cases.filter((c) => c.sourceType === "mesh").length,
  };
}
