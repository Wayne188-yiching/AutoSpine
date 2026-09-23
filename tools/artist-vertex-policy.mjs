/** Hard acceptance check, independent of Jev's probabilistic judgment.
 * The user confirmed a symmetric 20% limit on matched artist attachments.
 */
export function checkArtistVertexCounts(cases) {
  if (!Array.isArray(cases) || cases.length === 0)
    return { status: "BLOCKED", reason: "Matched artist evidence is required", cases: [] };
  const checked = cases.map(({ id, artistVertices, generatedVertices }) => {
    if (
      !id ||
      !Number.isSafeInteger(artistVertices) ||
      artistVertices < 3 ||
      !Number.isSafeInteger(generatedVertices) ||
      generatedVertices < 3
    )
      return { id, status: "BLOCKED", reason: "Missing or invalid vertex counts" };
    // Integer comparison avoids floating-point rejection exactly at +/-20%.
    const passed = Math.abs(generatedVertices - artistVertices) * 5 <= artistVertices;
    return {
      id,
      artistVertices,
      generatedVertices,
      minimum: Math.ceil((artistVertices * 4) / 5),
      maximum: Math.floor((artistVertices * 6) / 5),
      signedDeviation: (generatedVertices - artistVertices) / artistVertices,
      status: passed ? "PASSED" : "REJECTED",
    };
  });
  return {
    maxRelativeDeviation: 0.2,
    status: checked.some((item) => item.status === "BLOCKED")
      ? "BLOCKED"
      : checked.some((item) => item.status === "REJECTED")
        ? "REJECTED"
        : "PASSED",
    cases: checked,
  };
}

export function checkGate32ArtistCounts(review) {
  // Fixed required cases prevent accidentally dropping the failing house from a submission.
  return checkArtistVertexCounts(
    ["beard", "house"].map((id) => ({
      id,
      artistVertices: review.metrics?.[id]?.artist?.vertices,
      generatedVertices: review.metrics?.[id]?.generated?.vertices,
    })),
  );
}
