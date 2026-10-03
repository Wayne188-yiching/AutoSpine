/** Hard acceptance check, independent of Jev's probabilistic judgment.
 * Current policy: an absolute difference of at most five vertices per attachment.
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
    const passed = Math.abs(generatedVertices - artistVertices) <= 5;
    return {
      id,
      artistVertices,
      generatedVertices,
      minimum: Math.max(3, artistVertices - 5),
      maximum: artistVertices + 5,
      signedVertexDifference: generatedVertices - artistVertices,
      signedDeviation: (generatedVertices - artistVertices) / artistVertices,
      status: passed ? "PASSED" : "REJECTED",
    };
  });
  return {
    maxAbsoluteDeviation: 5,
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
