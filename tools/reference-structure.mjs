// Developer-only reference conditioning: return a coarse family, never XY or edge indices.
// Caller must first parse/validate the artist mesh using readArtistMesh.
export function referenceStructureFamily(mesh, width, height) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    Math.max(width / height, height / width) <= 2.2 ||
    !Array.isArray(mesh.manualEdges)
  )
    return undefined;
  const boundary = new Set(mesh.hull);
  const interior = mesh.vertices.map((_, i) => i).filter((i) => !boundary.has(i));
  if (
    !interior.length ||
    interior.length > 64 ||
    Math.abs(3 * interior.length + 6 - mesh.vertices.length) > 5
  )
    return undefined;
  const neighbors = new Map();
  for (const [a, b] of mesh.manualEdges) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (!neighbors.has(from)) neighbors.set(from, new Set());
      neighbors.get(from).add(to);
    }
  }
  const activeBoundary = [...neighbors.keys()].filter((i) => boundary.has(i));
  const seen = new Set(),
    stack = [interior[0]];
  while (stack.length) {
    const vertex = stack.pop();
    if (seen.has(vertex)) continue;
    seen.add(vertex);
    stack.push(...(neighbors.get(vertex) ?? []));
  }
  if (
    seen.size !== neighbors.size ||
    interior.some((i) => !seen.has(i)) ||
    activeBoundary.some((i) => neighbors.get(i).size !== 1)
  )
    return undefined;
  if (interior.every((i) => neighbors.get(i)?.size === 2) && activeBoundary.length === 2)
    return "strip-spine";
  if (
    interior.every((i) => neighbors.get(i)?.size === 4) &&
    activeBoundary.length === 2 * interior.length + 2
  )
    return "strip-ladder";
  return undefined;
}
