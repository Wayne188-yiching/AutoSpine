// Developer-only analysis of exported Spine data. Never imported by engine packages.
export function attachmentEntries(document) {
  const skins = Array.isArray(document.skins)
    ? document.skins
    : Object.entries(document.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  return skins.flatMap((skin) =>
    Object.entries(skin.attachments ?? {}).flatMap(([slot, attachments]) =>
      Object.entries(attachments).map(([name, attachment]) => ({
        skin: skin.name,
        slot,
        name,
        attachment,
      })),
    ),
  );
}

const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function triangleEdges(triangles) {
  const edges = new Map();
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.slice(i, i + 3);
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      edges.set(edgeKey(x, y), [x, y]);
  }
  return [...edges.values()];
}

/** Spine 3.8/4.0 nonessential edges index XY values, hence divide by two.
 * Missing edges means UNKNOWN, not zero artist-authored edges.
 */
export function readArtistMesh(attachment, width, height, version) {
  if (!/^(3\.8|4\.0)\./.test(version ?? "")) throw new Error("REFERENCE_VERSION_UNSUPPORTED");
  const { uvs, triangles, hull, edges } = attachment;
  if (
    attachment.type !== "mesh" ||
    !Array.isArray(uvs) ||
    uvs.length % 2 ||
    uvs.length < 6 ||
    !uvs.every(Number.isFinite) ||
    !Number.isInteger(hull) ||
    hull < 3 ||
    hull > uvs.length / 2 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Array.isArray(triangles) ||
    triangles.length < 3 ||
    triangles.length % 3 ||
    !triangles.every((i) => Number.isInteger(i) && i >= 0 && i < uvs.length / 2)
  )
    throw new Error("REFERENCE_GEOMETRY_INVALID");
  const vertices = Array.from({ length: uvs.length / 2 }, (_, i) => [
    uvs[i * 2] * width,
    uvs[i * 2 + 1] * height,
  ]);
  const boundary = Array.from({ length: hull }, (_, i) => [i, (i + 1) % hull]);
  const boundaryKeys = new Set(boundary.map(([a, b]) => edgeKey(a, b)));
  const all = triangleEdges(triangles);
  const allKeys = new Set(all.map(([a, b]) => edgeKey(a, b)));
  let manual = null;
  if (edges !== undefined) {
    if (
      !Array.isArray(edges) ||
      edges.length % 2 ||
      !edges.every((i) => Number.isInteger(i) && i >= 0 && i < uvs.length && i % 2 === 0)
    )
      throw new Error("REFERENCE_EDGES_INVALID");
    const authored = new Map();
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i] / 2,
        b = edges[i + 1] / 2,
        key = edgeKey(a, b);
      if (a === b || !allKeys.has(key)) throw new Error("REFERENCE_EDGE_NOT_IN_TRIANGLES");
      if (!boundaryKeys.has(key)) authored.set(key, [a, b]);
    }
    manual = [...authored.values()];
  }
  const manualKeys = new Set((manual ?? []).map(([a, b]) => edgeKey(a, b)));
  return {
    vertices,
    hull: Array.from({ length: hull }, (_, i) => i),
    triangles,
    boundaryEdges: boundary,
    manualEdges: manual,
    automaticEdges:
      manual === null
        ? null
        : all.filter(
            ([a, b]) => !boundaryKeys.has(edgeKey(a, b)) && !manualKeys.has(edgeKey(a, b)),
          ),
    unclassifiedEdges:
      manual === null ? all.filter(([a, b]) => !boundaryKeys.has(edgeKey(a, b))) : [],
  };
}

/** Rectangular bottleneck matching: minimize worst displacement, without reusing a vertex. */
function assignment(cost) {
  const n = cost.length;
  if (!n) return [];
  const m = cost[0].length;
  // Among feasible bottleneck assignments, try the nearest counterpart first.
  // Otherwise a later exact corner can lose to an earlier surplus point merely
  // because of its array index, falsely making a straight subdivision look bent.
  const preferred = cost.map((row) =>
    row.map((_, i) => i).sort((a, b) => row[a] - row[b] || a - b),
  );
  const limits = [...new Set(cost.flat())].sort((a, b) => a - b);
  const matchAt = (limit) => {
    const owner = Array(m).fill(-1);
    const visit = (row, used) => {
      for (const column of preferred[row]) {
        if (used[column] || cost[row][column] > limit) continue;
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
  return matchAt(limits[low]).flatMap((row, column) => (row < 0 ? [] : [[row, column]]));
}

function segmentDistance(point, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
    : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function validatePoints(mesh) {
  if (
    !Array.isArray(mesh?.vertices) ||
    mesh.vertices.length < 3 ||
    !mesh.vertices.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
    !Array.isArray(mesh.hull) ||
    mesh.hull.length < 3 ||
    new Set(mesh.hull).size !== mesh.hull.length ||
    !mesh.hull.every((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length)
  )
    throw new Error("COMPARISON_GEOMETRY_INVALID");
}

export function compareVertexPositions(artist, generated, width, height) {
  validatePoints(artist);
  validatePoints(generated);
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0))
    throw new Error("COMPARISON_DIMENSIONS_INVALID");
  const scale = Math.hypot(width, height),
    pairs = [],
    groups = {};
  for (const label of ["hull", "interior"]) {
    const indices = (mesh) =>
      label === "hull"
        ? mesh.hull
        : mesh.vertices.map((_, i) => i).filter((i) => !mesh.hull.includes(i));
    const a = indices(artist),
      b = indices(generated),
      swap = a.length > b.length;
    const rows = swap ? b : a,
      columns = swap ? a : b;
    const cost = rows.map((r) =>
      columns.map((c) => {
        const x = artist.vertices[swap ? c : r],
          y = generated.vertices[swap ? r : c];
        return Math.hypot(x[0] - y[0], x[1] - y[1]) / scale;
      }),
    );
    const matches = assignment(cost);
    const distances = matches.map(([r, c]) => cost[r][c]);
    const unmatched = Math.abs(a.length - b.length);
    const used = new Set(matches.map(([, c]) => columns[c]));
    const other = swap ? generated : artist;
    const extra = swap ? artist : generated;
    const unmatchedDistances = columns
      .filter((c) => !used.has(c))
      .map((c) => {
        const point = extra.vertices[c];
        if (!rows.length) return Infinity; // A missing interior category is never a hull match.
        return (
          (label === "hull"
            ? Math.min(
                ...other.hull.map((v, i) =>
                  segmentDistance(
                    point,
                    other.vertices[v],
                    other.vertices[other.hull[(i + 1) % other.hull.length]],
                  ),
                ),
              )
            : Math.min(
                ...rows.map((r) =>
                  Math.hypot(point[0] - other.vertices[r][0], point[1] - other.vertices[r][1]),
                ),
              )) / scale
        );
      });
    const errors = [...distances, ...unmatchedDistances].sort((x, y) => x - y);
    const mean = errors.length ? errors.reduce((s, x) => s + x, 0) / errors.length : 0;
    const p95 = errors.length ? errors[Math.ceil(errors.length * 0.95) - 1] : 0;
    const max = errors.at(-1) ?? 0;
    groups[label] = {
      artist: a.length,
      generated: b.length,
      unmatched,
      mean,
      p95,
      max,
      passed: max <= 0.05,
    };
    for (const [r, c] of matches)
      pairs.push([swap ? columns[c] : rows[r], swap ? rows[r] : columns[c]]);
  }
  return {
    normalization: "PNG diagonal",
    matching: "bottleneck within hull/interior; unmatched hull-to-segment or interior-to-interior",
    maxPositionFraction: Math.max(...Object.values(groups).map((g) => g.max)),
    positionLimit: 0.05,
    groups,
    pairs,
    passed: Object.values(groups).every((x) => x.passed),
  };
}

export function compareManualEdges(artist, generated, pairs) {
  const result = compareTypedEdges(artist, generated, pairs);
  if (!result.manual) return result;
  return result.manual;
}

/** Same-type paths may subdivide a line, never erase mapped features or bend >1px. */
export function compareTypedEdges(artist, generated, pairs) {
  const classify = (mesh, required) => {
    validatePoints(mesh);
    if (
      !Array.isArray(mesh.triangles) ||
      mesh.triangles.length < 3 ||
      mesh.triangles.length % 3 ||
      mesh.triangles.some((i) => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length)
    )
      return null;
    const manual = mesh.manualEdges ?? (required ? null : []);
    if (!Array.isArray(manual)) return null;
    const all = new Set(triangleEdges(mesh.triangles).map(([a, b]) => edgeKey(a, b)));
    const hull = new Set(
      mesh.hull.map((a, i) => edgeKey(a, mesh.hull[(i + 1) % mesh.hull.length])),
    );
    if (
      [...hull].some((k) => !all.has(k)) ||
      manual.some(
        (e) =>
          !Array.isArray(e) ||
          e.length !== 2 ||
          e.some((i) => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length) ||
          e[0] === e[1] ||
          !all.has(edgeKey(...e)) ||
          hull.has(edgeKey(...e)),
      )
    )
      return null;
    const solid = new Set(manual.map(([a, b]) => edgeKey(a, b)));
    if (solid.size !== manual.length) return null;
    return {
      hull,
      manual: solid,
      automatic: new Set([...all].filter((k) => !hull.has(k) && !solid.has(k))),
    };
  };
  const a = classify(artist, true),
    b = classify(generated, false);
  if (!a || !b)
    return { status: "BLOCKED", reason: "Classified edges must exist in actual triangles" };
  const mapping = new Map(pairs),
    mapped = new Set(mapping.values());
  const groups = {};
  for (const label of ["hull", "manual", "automatic"]) {
    const adjacency = new Map();
    for (const k of b[label]) {
      const [x, y] = k.split(":").map(Number);
      adjacency.set(x, [...(adjacency.get(x) ?? []), y]);
      adjacency.set(y, [...(adjacency.get(y) ?? []), x]);
    }
    const retained = [...a[label]].filter((k) => {
      const [x, y] = k.split(":").map(Number);
      const start = mapping.get(x),
        end = mapping.get(y);
      if (start === undefined || end === undefined) return false;
      if (b[label].has(edgeKey(start, end))) return true;
      const p = generated.vertices[start],
        q = generated.vertices[end];
      const dx = q[0] - p[0],
        dy = q[1] - p[1],
        length2 = dx * dx + dy * dy;
      if (!length2) return false;
      const projection = (i) =>
        ((generated.vertices[i][0] - p[0]) * dx + (generated.vertices[i][1] - p[1]) * dy) / length2;
      const queue = [start],
        visited = new Set(queue);
      for (let j = 0; j < queue.length; j++) {
        const current = queue[j];
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next) || (next !== end && mapped.has(next))) continue;
          const t = projection(next);
          if (
            t <= projection(current) ||
            t > 1 ||
            segmentDistance(generated.vertices[next], p, q) > 1
          )
            continue;
          if (next === end) return true;
          visited.add(next);
          queue.push(next);
        }
      }
      return false;
    }).length;
    const recall = a[label].size ? retained / a[label].size : 1;
    groups[label] = {
      required: a[label].size,
      retained,
      recall,
      status: recall >= (label === "automatic" ? 0.8 : 1) ? "PASSED" : "REJECTED",
    };
  }
  return {
    ...groups,
    status: Object.values(groups).every((g) => g.status === "PASSED") ? "PASSED" : "REJECTED",
  };
}

/** Independent pixel-centre audit inside the original PNG; never use a cleaned mask here. */
export function measureRasterCoverage(mesh, alpha, width, height) {
  validatePoints(mesh);
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    alpha.length !== width * height
  )
    throw new Error("COVERAGE_DIMENSIONS_INVALID");
  const polygon = mesh.hull.map((i) => mesh.vertices[i]);
  let foreground = 0,
    missed = 0,
    added = 0;
  for (let y = 0; y < height; y++) {
    const cuts = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (a[1] > y + 0.5 !== b[1] > y + 0.5)
        cuts.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    cuts.sort((a, b) => a - b);
    let crossings = 0;
    for (let x = 0; x < width; x++) {
      while (crossings < cuts.length && cuts[crossings] <= x + 0.5) crossings++;
      const covered = crossings % 2 === 1,
        filled = alpha[y * width + x] > 0;
      foreground += Number(filled);
      missed += Number(filled && !covered);
      added += Number(!filled && covered);
    }
  }
  if (!foreground) throw new Error("COVERAGE_EMPTY_FOREGROUND");
  return {
    foreground,
    missed,
    added,
    missedFraction: missed / foreground,
    addedFraction: added / foreground,
  };
}

/** Reference-conditioned selection only; this is not independent semantic segmentation. */
export function selectArtistForeground(artist, alpha, width, height) {
  validatePoints(artist);
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    alpha.length !== width * height
  )
    throw new Error("COVERAGE_DIMENSIONS_INVALID");
  const selected = new Uint8Array(alpha.length);
  const polygon = artist.hull.map((i) => artist.vertices[i]);
  for (let y = 0; y < height; y++) {
    const cuts = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (a[1] > y + 0.5 !== b[1] > y + 0.5)
        cuts.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const start = Math.max(0, Math.min(width, Math.ceil(cuts[i] - 0.5))),
        end = Math.max(0, Math.min(width, Math.ceil(cuts[i + 1] - 0.5)));
      selected.set(alpha.subarray(y * width + start, y * width + end), y * width + start);
    }
  }
  const sourceForeground = alpha.reduce((n, a) => n + Number(a > 0), 0);
  const targetForeground = selected.reduce((n, a) => n + Number(a > 0), 0);
  if (!targetForeground) throw new Error("REFERENCE_REGION_HAS_NO_FOREGROUND");
  return {
    alpha: selected,
    sourceForeground,
    targetForeground,
    excludedForeground: sourceForeground - targetForeground,
  };
}

export function compareArtistCoverage(
  artist,
  generated,
  alpha,
  width,
  height,
  referenceScoped = false,
) {
  const region = referenceScoped ? selectArtistForeground(artist, alpha, width, height) : null;
  const targetAlpha = region?.alpha ?? alpha;
  const reference = measureRasterCoverage(artist, targetAlpha, width, height);
  const candidate = measureRasterCoverage(generated, targetAlpha, width, height);
  let outsideReferenceForeground = 0;
  if (region) {
    const full = measureRasterCoverage(generated, alpha, width, height);
    outsideReferenceForeground =
      full.foreground - full.missed - (candidate.foreground - candidate.missed);
    candidate.added = full.added;
    candidate.addedFraction = full.added / candidate.foreground;
  }
  // Integer counts share one raw foreground denominator: no tolerance inflation or rounding.
  return {
    policy: referenceScoped
      ? "artist-used-foreground; source alpha>0 intersect artist hull; PNG pixel centres"
      : "same-attachment-artist-padding; raw-alpha>0; PNG pixel centres",
    sourceForeground: region?.sourceForeground ?? reference.foreground,
    targetForeground: reference.foreground,
    excludedForeground: region?.excludedForeground ?? 0,
    outsideReferenceForeground,
    maxMissedFraction: 0.02,
    maxAddedFraction: reference.addedFraction,
    artist: reference,
    generated: candidate,
    status:
      candidate.missed / candidate.foreground <= 0.02 &&
      candidate.added <= reference.added &&
      outsideReferenceForeground === 0
        ? "PASSED"
        : "REJECTED",
  };
}
