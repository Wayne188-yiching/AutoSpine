import { checkArtistVertexCounts } from "./artist-vertex-policy.mjs";

const key = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function edgeSet(triangles) {
  const result = new Set();
  for (let index = 0; index < triangles.length; index += 3)
    for (let side = 0; side < 3; side++)
      result.add(key(triangles[index + side], triangles[index + ((side + 1) % 3)]));
  return result;
}

function hullEdgeSet(hull) {
  return new Set(hull.map((vertex, index) => key(vertex, hull[(index + 1) % hull.length])));
}

function validMesh(mesh) {
  return (
    mesh &&
    Array.isArray(mesh.vertices) &&
    mesh.vertices.length >= 3 &&
    mesh.vertices.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((value) => typeof value === "number" && Number.isFinite(value)),
    ) &&
    Array.isArray(mesh.hull) &&
    mesh.hull.length >= 3 &&
    new Set(mesh.hull).size === mesh.hull.length &&
    mesh.hull.every(
      (index) => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length,
    ) &&
    Array.isArray(mesh.triangles) &&
    mesh.triangles.length % 3 === 0 &&
    mesh.triangles.every(
      (index) => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length,
    )
  );
}

function validEdges(edges, vertexCount) {
  return (
    Array.isArray(edges) &&
    edges.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount) &&
        pair[0] !== pair[1],
    )
  );
}

/** Find the one-to-one assignment with the smallest worst vertex displacement. */
function assignment(rows, columns, rowPoints, columnPoints) {
  const n = rows.length,
    m = columns.length;
  const distances = rows.map((row) =>
    columns.map((column) => {
      const a = rowPoints[row],
        b = columnPoints[column];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }),
  );
  const limits = [...new Set(distances.flat())].sort((a, b) => a - b);
  const matchAt = (limit) => {
    const owner = Array(m).fill(-1);
    const visit = (row, used) => {
      for (let column = 0; column < m; column++) {
        if (used[column] || distances[row][column] > limit) continue;
        used[column] = true;
        if (owner[column] === -1 || visit(owner[column], used)) {
          owner[column] = row;
          return true;
        }
      }
      return false;
    };
    for (let row = 0; row < n; row++) if (!visit(row, Array(m).fill(false))) return null;
    return owner;
  };
  let low = 0,
    high = limits.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (matchAt(limits[middle])) high = middle;
    else low = middle + 1;
  }
  return matchAt(limits[low])
    .map((row, column) => (row < 0 ? null : [rows[row], columns[column]]))
    .filter(Boolean);
}

function edgeRecall(referenceEdges, candidateEdges, vertexMap) {
  if (referenceEdges.size === 0) return 1;
  let matched = 0;
  for (const edge of referenceEdges) {
    const [a, b] = edge.split(":").map(Number);
    const mappedA = vertexMap.get(a),
      mappedB = vertexMap.get(b);
    if (mappedA !== undefined && mappedB !== undefined && candidateEdges.has(key(mappedA, mappedB)))
      matched++;
  }
  return matched / referenceEdges.size;
}

/** Compare exact-image artist and generated meshes. Explicit/manual edges never
 * count as automatic dashed triangle sides, even when their endpoints coincide.
 */
export function compareArtistTopology({ id, artist, generated, width, height }, options = {}) {
  const positionLimit = options.maxPositionFraction ?? 0.05;
  const automaticLimit = options.minAutomaticEdgeRecall ?? 0.8;
  if (
    !validMesh(artist) ||
    !validMesh(generated) ||
    !validEdges(artist.manualEdges, artist?.vertices?.length ?? 0) ||
    (generated.manualEdges !== undefined &&
      !validEdges(generated.manualEdges, generated?.vertices?.length ?? 0)) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return {
      id,
      status: "BLOCKED",
      reason: "Matched mesh geometry and classified artist edges are required",
    };
  const count = checkArtistVertexCounts([
    { id, artistVertices: artist.vertices.length, generatedVertices: generated.vertices.length },
  ]).cases[0];
  const candidateManual = generated.manualEdges ?? [];
  const vertexMap = new Map();
  const categories = [
    [artist.hull, generated.hull],
    [
      artist.vertices.map((_, index) => index).filter((index) => !artist.hull.includes(index)),
      generated.vertices
        .map((_, index) => index)
        .filter((index) => !generated.hull.includes(index)),
    ],
  ];
  for (const [a, b] of categories) {
    if (!a.length || !b.length) continue;
    if (a.length <= b.length) {
      for (const [artistIndex, generatedIndex] of assignment(
        a,
        b,
        artist.vertices,
        generated.vertices,
      ))
        vertexMap.set(artistIndex, generatedIndex);
    } else {
      for (const [generatedIndex, artistIndex] of assignment(
        b,
        a,
        generated.vertices,
        artist.vertices,
      ))
        vertexMap.set(artistIndex, generatedIndex);
    }
  }
  const nearest = (point, points) =>
    Math.min(...points.map((other) => Math.hypot(point[0] - other[0], point[1] - other[1])));
  const matchedDistances = [...vertexMap].map(([a, b]) =>
    Math.hypot(
      artist.vertices[a][0] - generated.vertices[b][0],
      artist.vertices[a][1] - generated.vertices[b][1],
    ),
  );
  const unmatchedArtist = artist.vertices
    .map((_, index) => index)
    .filter((index) => !vertexMap.has(index))
    .map((index) => nearest(artist.vertices[index], generated.vertices));
  const mappedGenerated = new Set(vertexMap.values());
  const unmatchedGenerated = generated.vertices
    .map((_, index) => index)
    .filter((index) => !mappedGenerated.has(index))
    .map((index) => nearest(generated.vertices[index], artist.vertices));
  const maxDistancePixels = Math.max(
    ...matchedDistances,
    ...unmatchedArtist,
    ...unmatchedGenerated,
  );
  const maxPositionFraction = maxDistancePixels / Math.hypot(width, height);
  const artistHull = hullEdgeSet(artist.hull),
    generatedHull = hullEdgeSet(generated.hull);
  const artistManual = new Set(artist.manualEdges.map(([a, b]) => key(a, b))),
    generatedManual = new Set(candidateManual.map(([a, b]) => key(a, b)));
  const artistAuto = edgeSet(artist.triangles),
    generatedAuto = edgeSet(generated.triangles);
  for (const edge of [...artistHull, ...artistManual]) artistAuto.delete(edge);
  for (const edge of [...generatedHull, ...generatedManual]) generatedAuto.delete(edge);
  const hullEdgeRecall = edgeRecall(artistHull, generatedHull, vertexMap);
  const manualEdgeRecall = edgeRecall(artistManual, generatedManual, vertexMap);
  const automaticEdgeRecall = edgeRecall(artistAuto, generatedAuto, vertexMap);
  return {
    id,
    status:
      count.status === "PASSED" &&
      maxPositionFraction <= positionLimit &&
      hullEdgeRecall === 1 &&
      manualEdgeRecall === 1 &&
      automaticEdgeRecall >= automaticLimit
        ? "PASSED"
        : "REJECTED",
    artistVertices: artist.vertices.length,
    generatedVertices: generated.vertices.length,
    maxDistancePixels,
    maxPositionFraction,
    positionLimit,
    hullEdgeRecall,
    manualEdgeRecall,
    automaticEdgeRecall,
    automaticLimit,
    artistManualEdgeCount: artistManual.size,
    generatedManualEdgeCount: generatedManual.size,
  };
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
