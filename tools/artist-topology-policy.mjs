import { checkArtistVertexCounts } from "./artist-vertex-policy.mjs";
import { compareVertexPositions, compareTypedEdges } from "./reference-topology.mjs";

/** Shared Jev-selected geometry and typed-path checks, not a complete mesh/coverage validator. */
export function compareArtistTopology({ id, artist, generated, width, height }) {
  try {
    const positions = compareVertexPositions(artist, generated, width, height);
    const edges = compareTypedEdges(artist, generated, positions.pairs);
    if (edges.status === "BLOCKED") return { id, ...edges };
    const count = checkArtistVertexCounts([
      { id, artistVertices: artist.vertices.length, generatedVertices: generated.vertices.length },
    ]).cases[0];
    return {
      id,
      status:
        count.status === "PASSED" && positions.passed && edges.status === "PASSED"
          ? "PASSED"
          : "REJECTED",
      artistVertices: artist.vertices.length,
      generatedVertices: generated.vertices.length,
      maxDistancePixels: positions.maxPositionFraction * Math.hypot(width, height),
      maxPositionFraction: positions.maxPositionFraction,
      positionLimit: 0.05,
      hullEdgeRecall: edges.hull.recall,
      manualEdgeRecall: edges.manual.recall,
      automaticEdgeRecall: edges.automatic.recall,
      automaticLimit: 0.8,
      artistManualEdgeCount: artist.manualEdges.length,
      generatedManualEdgeCount: generated.manualEdges?.length ?? 0,
      positions,
      edges,
    };
  } catch (error) {
    return { id, status: "BLOCKED", reason: error.message };
  }
}

/** Refuse a Jev submission when the private geometry comparison is absent or fails. */
export function checkGate32TopologySummary(review) {
  const cases = ["beard", "house"].map((id) => {
    const topology = review.metrics?.[id]?.topology;
    if (
      !topology ||
      !Number.isFinite(topology.maxPositionFraction) ||
      !Number.isFinite(topology.hullEdgeRecall) ||
      !Number.isFinite(topology.manualEdgeRecall) ||
      !Number.isFinite(topology.automaticEdgeRecall) ||
      !Number.isSafeInteger(topology.artistManualEdgeCount) ||
      topology.artistManualEdgeCount < 0 ||
      !Number.isSafeInteger(topology.generatedManualEdgeCount) ||
      topology.generatedManualEdgeCount < 0
    )
      return { id, status: "BLOCKED", reason: "Matched private topology metrics are required" };
    const passed =
      topology.maxPositionFraction <= 0.05 &&
      topology.hullEdgeRecall === 1 &&
      topology.manualEdgeRecall === 1 &&
      topology.automaticEdgeRecall >= 0.8;
    return { ...topology, id, status: passed ? "PASSED" : "REJECTED" };
  });
  return {
    positionLimitFraction: 0.05,
    requiredHullAndManualRecall: 1,
    minimumAutomaticRecall: 0.8,
    status: cases.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : cases.some((item) => item.status === "REJECTED")
        ? "REJECTED"
        : "PASSED",
    cases,
  };
}
