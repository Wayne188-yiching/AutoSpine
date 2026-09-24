/** Spine's exported `edges` use doubled vertex indices. Hull edges are implicit;
 * other exported edges are editor-authored constraints (solid orange). The
 * remaining triangle sides are automatic triangulation (dashed gray).
 */
export function classifySpineMeshEdges(attachment) {
  const vertexCount = attachment?.uvs?.length / 2;
  const hull = attachment?.hull;
  const triangles = attachment?.triangles;
  const edges = attachment?.edges;
  if (
    !Number.isInteger(vertexCount) ||
    vertexCount < 3 ||
    !Number.isInteger(hull) ||
    hull < 3 ||
    hull > vertexCount ||
    !Array.isArray(triangles) ||
    triangles.length % 3 !== 0 ||
    !Array.isArray(edges)
  )
    throw new Error("Spine mesh needs valid UVs, hull, triangles and nonessential edges export");
  if (edges.length % 2 !== 0) throw new Error("Spine edges must be vertex pairs");
  const key = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const triangleEdges = new Set();
  for (let index = 0; index < triangles.length; index += 3) {
    const triplet = triangles.slice(index, index + 3);
    if (triplet.some((value) => !Number.isInteger(value) || value < 0 || value >= vertexCount))
      throw new Error("Spine triangles contain invalid vertex indices");
    for (let side = 0; side < 3; side++)
      triangleEdges.add(key(triplet[side], triplet[(side + 1) % 3]));
  }
  const hullEdges = new Set(
    Array.from({ length: hull }, (_, index) => key(index, (index + 1) % hull)),
  );
  const exportedEdges = new Set();
  for (let index = 0; index < edges.length; index += 2) {
    const a = edges[index],
      b = edges[index + 1];
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a % 2 !== 0 ||
      b % 2 !== 0 ||
      a < 0 ||
      b < 0 ||
      a >= vertexCount * 2 ||
      b >= vertexCount * 2 ||
      a === b
    )
      throw new Error("Spine edges contain invalid doubled vertex indices");
    exportedEdges.add(key(a / 2, b / 2));
  }
  if ([...hullEdges].some((edge) => !exportedEdges.has(edge)))
    throw new Error("Spine edge export is missing a hull edge");
  if ([...exportedEdges].some((edge) => !triangleEdges.has(edge)))
    throw new Error("Spine edge export disagrees with triangle connectivity");
  const pair = (edge) => edge.split(":").map(Number);
  return {
    hullEdges: [...hullEdges].map(pair),
    manualEdges: [...exportedEdges].filter((edge) => !hullEdges.has(edge)).map(pair),
    automaticTriangleEdges: [...triangleEdges].filter((edge) => !exportedEdges.has(edge)).map(pair),
  };
}
