import type { AssetPart, MeshSpec } from "@autospine/schemas";
import { rasterDifference, type Point } from "./contour.js";
import { failMesh, MeshError, validateMeshSpec } from "./validation.js";

/** Optional explicit strip intent. No reference XY, edges, names, or image paths are used. */
export function generateStripMesh(
  part: AssetPart,
  alpha: Uint8Array,
  width: number,
  height: number,
  referenceVertices: number,
  referenceHull: number,
  padding: number,
  family: "strip-spine" | "strip-ladder",
): MeshSpec {
  const interior = referenceVertices - referenceHull;
  const vertical = height >= width,
    length = vertical ? height : width,
    across = vertical ? width : height;
  if (interior < 1 || interior > 64 || Math.abs(3 * interior + 6 - referenceVertices) > 5)
    failMesh("STRIP_PROFILE", "Strip station counts cannot meet the reference vertex budget");
  // Bound the quadratic scanline fit before allocating its matrix or scanning the raster.
  if (length > 1024 || (interior + 1) * length * length > 16_000_000)
    failMesh("STRIP_COMPLEXITY", "Strip fit exceeds the bounded scanline work budget");
  const sections: { u: number; left: number; right: number }[] = [];
  for (let u = 0; u < length; u++) {
    let left = across,
      right = 0;
    for (let v = 0; v < across; v++)
      if (alpha[vertical ? u * width + v : v * width + u]! > 0) {
        left = Math.min(left, v);
        right = Math.max(right, v + 1);
      }
    if (right > left) sections.push({ u: u + 0.5, left, right });
  }
  if (sections.length < interior + 2)
    failMesh("STRIP_TOO_SHORT", "Too few occupied scanlines for the requested stations");
  if (sections.some((s, i) => i > 0 && s.u - sections[i - 1]!.u > 1))
    failMesh("STRIP_GAP", "A strip cannot bridge an empty scanline");
  const distance = [0];
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!,
      b = sections[i]!;
    distance.push(
      distance[i - 1]! + Math.hypot(b.u - a.u, (b.left + b.right - a.left - a.right) / 2),
    );
  }
  const n = sections.length,
    segments = interior + 1;
  const meanWidth = sections.reduce((sum, r) => sum + r.right - r.left, 0) / n;
  const prefixes = Array.from({ length: 8 }, () => new Float64Array(n + 1));
  sections.forEach((s, i) => {
    const values = [
      s.u,
      s.left,
      s.right,
      s.u * s.u,
      s.left * s.left,
      s.right * s.right,
      s.u * s.left,
      s.u * s.right,
    ];
    values.forEach((v, k) => {
      prefixes[k]![i + 1] = prefixes[k]![i]! + v;
    });
  });
  // Segment SSE for both silhouette rails, evaluated in O(1) using prefix sums.
  const cost = new Float64Array(n * n);
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const sums = prefixes.map((p) => p[b + 1]! - p[a]!);
      for (const [key, idx, square, product] of [
        ["left", 1, 4, 6],
        ["right", 2, 5, 7],
      ] as const) {
        const m = (sections[b]![key] - sections[a]![key]) / (sections[b]!.u - sections[a]!.u);
        const c = sections[a]![key] - m * sections[a]!.u;
        cost[a * n + b] =
          cost[a * n + b]! +
          Math.max(
            0,
            sums[square]! +
              m * m * sums[3]! +
              (b - a + 1) * c * c +
              2 * m * c * sums[0]! -
              2 * m * sums[product]! -
              2 * c * sums[idx]!,
          );
      }
    }
  let previous = new Float64Array(n).fill(Infinity);
  previous[0] = 0;
  const parents = Array.from({ length: segments + 1 }, () => new Int32Array(n).fill(-1));
  for (let s = 1; s <= segments; s++) {
    const next = new Float64Array(n).fill(Infinity);
    for (let b = s; b < n; b++)
      for (let a = s - 1; a < b; a++) {
        const residual = cost[a * n + b]! / (n * meanWidth * meanWidth);
        const regularity =
          (((distance[b]! - distance[a]!) * segments) / distance[n - 1]! - 1) ** 2 / segments;
        const value = previous[a]! + residual + regularity;
        if (value < next[b]!) {
          next[b] = value;
          parents[s]![b] = a;
        }
      }
    previous = next;
  }
  const chosen = [n - 1];
  let cursor = n - 1;
  for (let s = segments; s > 0; s--) {
    cursor = parents[s]![cursor]!;
    if (cursor < 0) failMesh("STRIP_FIT", "No feasible fixed-count strip fit");
    chosen.push(cursor);
  }
  chosen.reverse();
  // Retain the prototype's interpolation arithmetic at the chosen raster knots.
  const rawRows: Point[][] = chosen.map((index) => {
    const j = Math.max(1, index),
      a = sections[j - 1]!,
      b = sections[j]!;
    const t = (distance[index]! - distance[j - 1]!) / (distance[j]! - distance[j - 1]!);
    const u = a.u + (b.u - a.u) * t,
      left = a.left + (b.left - a.left) * t,
      right = a.right + (b.right - a.right) * t;
    return [left, (left + right) / 2, right].map((v) => (vertical ? [v, u] : [u, v]));
  });
  // Nested widening keeps scanline order and never adjusts an interior spine point.
  const grow = (margin: number): Point[][] =>
    rawRows.map((row, i) =>
      row.map((point, c) => {
        const p: Point = [...point],
          v = vertical ? 0 : 1,
          u = vertical ? 1 : 0;
        if (c !== 1) p[v] = Math.max(0, Math.min(across, p[v] + (c === 0 ? -margin : margin)));
        if (i === 0) p[u] -= 0.5;
        if (i === rawRows.length - 1) p[u] += 0.5;
        return p;
      }),
    );
  const inspect = (rows: Point[][]) =>
    rasterDifference(
      [
        rows[0]![0]!,
        ...rows.map((r) => r[2]!),
        ...rows
          .slice(1)
          .reverse()
          .map((r) => r[0]!),
      ],
      alpha,
      width,
      height,
    );
  const missedFits = (rows: Point[][]) => {
    const c = inspect(rows);
    return c.missed / c.foreground <= 0.02;
  };
  let low = 0,
    high = Math.min(8, Math.hypot(width, height) * 0.05);
  if (missedFits(grow(0))) high = 0;
  else if (!missedFits(grow(high)))
    failMesh("STRIP_MISSED_BUDGET", "Strip cannot meet the missed-foreground budget");
  for (let i = 0; i < 12 && high > 0; i++) {
    const middle = (low + high) / 2;
    if (missedFits(grow(middle))) high = middle;
    else low = middle;
  }
  const rows = grow(high),
    coverage = inspect(rows);
  if (coverage.added / coverage.foreground > padding)
    failMesh("STRIP_PADDING_BUDGET", "Strip exceeds same-attachment transparent padding");
  const cells: number[][] = rows.map(() => []),
    points: Point[] = [],
    hull: number[] = [];
  const put = (r: number, c: number, boundary: boolean) => {
    cells[r]![c] = points.length;
    points.push(rows[r]![c]!);
    if (boundary) hull.push(points.length - 1);
  };
  put(0, 0, true);
  put(0, 1, true);
  put(0, 2, true);
  for (let r = 1; r < rows.length; r++) put(r, 2, true);
  put(rows.length - 1, 1, true);
  put(rows.length - 1, 0, true);
  for (let r = rows.length - 2; r > 0; r--) put(r, 0, true);
  for (let r = 1; r < rows.length - 1; r++) put(r, 1, false);
  if (!vertical) hull.reverse();
  type Triangle = [number, number, number];
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const minimumAngle = (tri: Triangle) =>
    Math.min(
      ...tri.map((v, i) => {
        const p = points[v]!,
          a = points[tri[(i + 1) % 3]!]!,
          b = points[tri[(i + 2) % 3]!]!;
        const x = [a[0] - p[0], a[1] - p[1]],
          y = [b[0] - p[0], b[1] - p[1]];
        return Math.acos(
          Math.max(
            -1,
            Math.min(1, (x[0]! * y[0]! + x[1]! * y[1]!) / (Math.hypot(...x) * Math.hypot(...y))),
          ),
        );
      }),
    );
  const triangles: number[] = [];
  for (let r = 0; r < rows.length - 1; r++)
    for (let c = 0; c < 2; c++) {
      const a = cells[r]![c]!,
        b = cells[r]![c + 1]!,
        d = cells[r + 1]![c]!,
        e = cells[r + 1]![c + 1]!;
      const first: Triangle[] = [
          [a, b, d],
          [b, e, d],
        ],
        second: Triangle[] = [
          [a, b, e],
          [a, e, d],
        ];
      const selected =
        Math.min(...first.map(minimumAngle)) >= Math.min(...second.map(minimumAngle))
          ? first
          : second;
      for (const [x, y, z] of selected) {
        const area = cross(points[x]!, points[y]!, points[z]!);
        if (Math.abs(area) < 1e-9)
          failMesh("STRIP_DEGENERATE", "Strip contains a degenerate triangle");
        triangles.push(...(area > 0 ? [x, y, z] : [x, z, y]));
      }
    }
  const manualEdges: [number, number][] = [];
  for (let r = 0; r < rows.length - 1; r++) manualEdges.push([cells[r]![1]!, cells[r + 1]![1]!]);
  if (family === "strip-ladder")
    for (let r = 1; r < rows.length - 1; r++)
      manualEdges.push([cells[r]![0]!, cells[r]![1]!], [cells[r]![1]!, cells[r]![2]!]);
  const mesh: MeshSpec = {
    schemaVersion: "0.1",
    kind: "mesh",
    id: `${part.id}-mesh`,
    name: `${part.name} Mesh`,
    sourcePartId: part.id,
    vertices: points.map(([x, y]) => [
      part.bounds.x + (x * part.bounds.width) / width,
      part.bounds.y + (y * part.bounds.height) / height,
    ]),
    uvs: points.map(([x, y]) => [x / width, y / height]),
    hull,
    triangles,
    manualEdges,
  };
  const validation = validateMeshSpec(mesh);
  if (validation.status !== "passed") throw new MeshError(validation);
  return mesh;
}
