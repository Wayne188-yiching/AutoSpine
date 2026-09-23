import { failMesh } from "./validation.js";

export type Point = [number, number];

export function signedArea2(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

function distanceToSegment2(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fraction =
    dx === 0 && dy === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)),
        );
  const x = a[0] + fraction * dx - point[0];
  const y = a[1] + fraction * dy - point[1];
  return x * x + y * y;
}

function simplifyArc(points: Point[], start: number, end: number, tolerance2: number): number[] {
  let farthest = -1;
  let distance = tolerance2;
  for (let index = start + 1; index < end; index++) {
    const current = distanceToSegment2(points[index]!, points[start]!, points[end]!);
    if (current > distance) {
      distance = current;
      farthest = index;
    }
  }
  if (farthest < 0) return [start, end];
  return [
    ...simplifyArc(points, start, farthest, tolerance2).slice(0, -1),
    ...simplifyArc(points, farthest, end, tolerance2),
  ];
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const onSegment = (p: Point, q: Point, r: Point): boolean =>
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  return (
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b)) ||
    (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0)))
  );
}

function isSimple(points: Point[]): boolean {
  for (let left = 0; left < points.length; left++) {
    const a = points[left]!;
    const b = points[(left + 1) % points.length]!;
    for (let right = left + 2; right < points.length; right++) {
      if (left === 0 && right === points.length - 1) continue;
      if (segmentsCross(a, b, points[right]!, points[(right + 1) % points.length]!)) return false;
    }
  }
  return true;
}

function withinRasterBudget(
  simplified: Point[],
  alpha: Uint8Array,
  width: number,
  height: number,
  maxDifference: number,
): boolean {
  let foreground = 0;
  let missed = 0;
  let added = 0;
  for (let y = 0; y < height; y++) {
    const intersections: number[] = [];
    for (let index = 0; index < simplified.length; index++) {
      const a = simplified[index]!;
      const b = simplified[(index + 1) % simplified.length]!;
      if (a[1] > y + 0.5 !== b[1] > y + 0.5)
        intersections.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    const covered = new Uint8Array(width);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index]! - 0.5));
      const end = Math.min(width, Math.ceil(intersections[index + 1]! - 0.5));
      covered.fill(1, start, end);
    }
    for (let x = 0; x < width; x++) {
      const filled = alpha[y * width + x]! > 0;
      const inside = covered[x]! > 0;
      if (filled) foreground++;
      if (filled && !inside) missed++;
      if (!filled && inside) added++;
    }
  }
  return missed / foreground <= maxDifference && added / foreground <= maxDifference;
}

/** Simplify the closed outline without crossing edges or exceeding the raster-change budget. */
export function simplifyContour(
  outline: Point[],
  alpha: Uint8Array,
  width: number,
  height: number,
  lowPoly: boolean,
  referenceHull?: number,
): Point[] {
  const tolerance = lowPoly
    ? Math.min(6, Math.max(1.5, Math.sqrt(width * height) / 50))
    : Math.min(1.5, Math.sqrt(width * height) / 100);
  if (tolerance < 0.5 || outline.length < 8) return outline;
  let opposite = 1;
  for (let index = 2; index < outline.length; index++) {
    const current = distanceToSegment2(outline[index]!, outline[0]!, outline[0]!);
    const previous = distanceToSegment2(outline[opposite]!, outline[0]!, outline[0]!);
    if (current > previous) opposite = index;
  }
  const ring = [...outline, outline[0]!];
  let closest: Point[] | undefined;
  for (let attempt = tolerance; attempt >= 0.5; attempt *= 0.75) {
    const indices = [
      ...simplifyArc(ring, 0, opposite, attempt * attempt).slice(0, -1),
      ...simplifyArc(ring, opposite, outline.length, attempt * attempt).slice(0, -1),
    ];
    const simplified = indices.map((index) => ring[index]!);
    if (
      simplified.length >= 3 &&
      signedArea2(simplified) > 0 &&
      isSimple(simplified) &&
      withinRasterBudget(simplified, alpha, width, height, lowPoly ? 0.02 : 0.01)
    ) {
      const candidate = lowPoly
        ? reduceContour(simplified, outline, alpha, width, height, tolerance, referenceHull)
        : simplified;
      if (referenceHull === undefined || candidate.length === referenceHull) return candidate;
      if (
        !closest ||
        Math.abs(candidate.length - referenceHull) < Math.abs(closest.length - referenceHull)
      )
        closest = candidate;
    }
  }
  return closest ?? outline;
}

/** Remove redundant low-curvature corners, checking the total (not per-step) pixel error.
 * Each original corner must also remain near the new boundary, protecting thin features.
 */
function reduceContour(
  initial: Point[],
  original: Point[],
  alpha: Uint8Array,
  width: number,
  height: number,
  tolerance: number,
  minimumVertices = 3,
): Point[] {
  let points = initial;
  while (points.length > Math.max(3, minimumVertices)) {
    const candidates = points
      .map((point, index) => ({
        index,
        error: distanceToSegment2(
          point,
          points[(index + points.length - 1) % points.length]!,
          points[(index + 1) % points.length]!,
        ),
      }))
      .sort((a, b) => a.error - b.error || a.index - b.index);
    let removed = false;
    for (const { index, error } of candidates) {
      if (error > tolerance * tolerance) break;
      const next = points.filter((_, i) => i !== index);
      if (signedArea2(next) <= 0 || !isSimple(next)) continue;
      if (
        !original.every((point) =>
          next.some(
            (a, i) =>
              distanceToSegment2(point, a, next[(i + 1) % next.length]!) <= tolerance * tolerance,
          ),
        )
      )
        continue;
      if (!withinRasterBudget(next, alpha, width, height, 0.02)) continue;
      points = next;
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return points;
}

/** Explicitly keep one connected region; callers receive exact dropped-pixel counts. */
export function selectPrimaryComponent(
  alpha: Uint8Array,
  width: number,
  height: number,
  maxDiscardFraction: number,
): { alpha: Uint8Array; keptPixels: number; discardedPixels: number; componentCount: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_000_000 ||
    alpha.length !== width * height
  )
    failMesh("ALPHA_DIMENSIONS", "Alpha dimensions are invalid or exceed 2 million pixels");
  if (!Number.isFinite(maxDiscardFraction) || maxDiscardFraction < 0 || maxDiscardFraction > 1)
    failMesh("DISCARD_BUDGET", "Discard fraction must be between zero and one");
  const seen = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  let kept = new Int32Array(0),
    total = 0,
    componentCount = 0;
  for (let start = 0; start < alpha.length; start++) {
    if (!alpha[start] || seen[start]) continue;
    componentCount++;
    let head = 0,
      tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const next of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (next < 0 || !alpha[next] || seen[next]) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    total += tail;
    if (tail > kept.length) kept = queue.slice(0, tail);
  }
  if (!total) failMesh("ALPHA_EMPTY", "Alpha mask contains no visible pixels");
  const discardedPixels = total - kept.length;
  if (discardedPixels / total > maxDiscardFraction)
    failMesh("DISCARD_BUDGET", "Detached alpha exceeds the explicitly allowed discard fraction");
  const selected = new Uint8Array(alpha.length);
  for (const index of kept) selected[index] = alpha[index]!;
  return { alpha: selected, keptPixels: kept.length, discardedPixels, componentCount };
}

/** Explicitly bridge diagonal pixel contacts so the traced boundary cannot pinch. */
export function repairCornerPinches(
  alpha: Uint8Array,
  width: number,
  height: number,
  maxFillFraction: number,
): { alpha: Uint8Array; filledPixels: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_000_000 ||
    alpha.length !== width * height
  )
    failMesh("ALPHA_DIMENSIONS", "Alpha dimensions are invalid or exceed 2 million pixels");
  if (!Number.isFinite(maxFillFraction) || maxFillFraction < 0 || maxFillFraction > 1)
    failMesh("FILL_BUDGET", "Fill fraction must be between zero and one");
  const result = alpha.slice();
  const originalFilled = result.reduce((count, value) => count + Number(value > 0), 0);
  if (!originalFilled) failMesh("ALPHA_EMPTY", "Alpha mask contains no visible pixels");
  const score = (x: number, y: number): number =>
    Number(x > 0 && result[y * width + x - 1]! > 0) +
    Number(x + 1 < width && result[y * width + x + 1]! > 0) +
    Number(y > 0 && result[(y - 1) * width + x]! > 0) +
    Number(y + 1 < height && result[(y + 1) * width + x]! > 0);
  let filledPixels = 0,
    changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y + 1 < height; y++) {
      for (let x = 0; x + 1 < width; x++) {
        const a = y * width + x,
          b = a + 1,
          c = a + width,
          d = c + 1;
        let chosen: number | undefined;
        if (result[a] && result[d] && !result[b] && !result[c])
          chosen = score(x + 1, y) >= score(x, y + 1) ? b : c;
        else if (!result[a] && !result[d] && result[b] && result[c])
          chosen = score(x, y) >= score(x + 1, y + 1) ? a : d;
        if (chosen === undefined) continue;
        if ((filledPixels + 1) / originalFilled > maxFillFraction)
          failMesh("FILL_BUDGET", "Pinch repair exceeds the explicitly allowed fill fraction");
        result[chosen] = 255;
        filledPixels++;
        changed = true;
      }
    }
  }
  return { alpha: result, filledPixels };
}

/** Fill enclosed transparent islands only when the caller explicitly allows the pixel loss. */
export function fillEnclosedHoles(
  alpha: Uint8Array,
  width: number,
  height: number,
  maxFillFraction: number,
): { alpha: Uint8Array; filledPixels: number; holeCount: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_000_000 ||
    alpha.length !== width * height
  )
    failMesh("ALPHA_DIMENSIONS", "Alpha dimensions are invalid or exceed 2 million pixels");
  if (!Number.isFinite(maxFillFraction) || maxFillFraction < 0 || maxFillFraction > 1)
    failMesh("FILL_BUDGET", "Fill fraction must be between zero and one");
  const result = alpha.slice();
  const originalFilled = result.reduce((count, value) => count + Number(value > 0), 0);
  if (!originalFilled) failMesh("ALPHA_EMPTY", "Alpha mask contains no visible pixels");
  const seen = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  let filledPixels = 0,
    holeCount = 0;
  for (let start = 0; start < alpha.length; start++) {
    if (result[start] || seen[start]) continue;
    let head = 0,
      tail = 0,
      touchesBorder = false;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const next of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (next < 0 || result[next] || seen[next]) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    if (touchesBorder) continue;
    if ((filledPixels + tail) / originalFilled > maxFillFraction)
      failMesh("FILL_BUDGET", "Enclosed holes exceed the explicitly allowed fill fraction");
    for (let index = 0; index < tail; index++) result[queue[index]!] = 255;
    filledPixels += tail;
    holeCount++;
  }
  return { alpha: result, filledPixels, holeCount };
}

/** Opt-in cleanup with one combined budget; the original alpha remains unchanged. */
export function prepareAlphaForMesh(
  alpha: Uint8Array,
  width: number,
  height: number,
  maxChangedFraction: number,
): {
  alpha: Uint8Array;
  componentCount: number;
  discardedPixels: number;
  pinchFilledPixels: number;
  holeFilledPixels: number;
  holeCount: number;
} {
  const selected = selectPrimaryComponent(alpha, width, height, maxChangedFraction);
  const repaired = repairCornerPinches(selected.alpha, width, height, maxChangedFraction);
  const filled = fillEnclosedHoles(repaired.alpha, width, height, maxChangedFraction);
  const changed = selected.discardedPixels + repaired.filledPixels + filled.filledPixels;
  const original = selected.keptPixels + selected.discardedPixels;
  if (changed / original > maxChangedFraction)
    failMesh("CORRECTION_BUDGET", "Combined alpha corrections exceed the allowed fraction");
  return {
    alpha: filled.alpha,
    componentCount: selected.componentCount,
    discardedPixels: selected.discardedPixels,
    pinchFilledPixels: repaired.filledPixels,
    holeFilledPixels: filled.filledPixels,
    holeCount: filled.holeCount,
  };
}

/** Trace exposed pixel-cell edges. The returned y-down outline has positive area. */
export function traceContour(alpha: Uint8Array, width: number, height: number): Point[] {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_000_000 ||
    alpha.length !== width * height
  )
    failMesh("ALPHA_DIMENSIONS", "Alpha dimensions are invalid or exceed 2 million pixels");
  const filled = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && alpha[y * width + x]! > 0;
  const first = alpha.findIndex((value) => value > 0);
  if (first < 0) failMesh("ALPHA_EMPTY", "Alpha mask contains no visible pixels");

  // A vertex-only diagonal contact is not a deformable connected region.
  const visited = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  let head = 0,
    tail = 0,
    foreground = 0;
  queue[tail++] = first;
  visited[first] = 1;
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (!filled(nx!, ny!)) continue;
      const next = ny! * width + nx!;
      if (visited[next]) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }
  for (const value of alpha) if (value > 0) foreground++;
  if (tail !== foreground)
    failMesh("ALPHA_DISCONNECTED", "Alpha mask contains multiple 4-connected regions");

  const key = (x: number, y: number): number => y * (width + 1) + x;
  const outgoing = new Map<number, number>();
  const incoming = new Map<number, number>();
  let edgeCount = 0;
  const edge = (ax: number, ay: number, bx: number, by: number): void => {
    const a = key(ax, ay),
      b = key(bx, by);
    if (outgoing.has(a) || incoming.has(b))
      failMesh("CONTOUR_PINCH", "Contour touches itself at a corner");
    outgoing.set(a, b);
    incoming.set(b, a);
    if (++edgeCount > 8192)
      failMesh("CONTOUR_COMPLEXITY", "Contour exceeds the 8192-edge Gate 3 limit");
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) edge(x, y, x + 1, y);
      if (!filled(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) edge(x, y + 1, x, y);
    }
  }
  if (incoming.size !== outgoing.size)
    failMesh("CONTOUR_INVALID", "Contour edge endpoints do not form closed loops");
  const start = Math.min(...outgoing.keys());
  const raw: Point[] = [];
  const seen = new Set<number>();
  let current = start;
  while (!seen.has(current)) {
    seen.add(current);
    raw.push([current % (width + 1), Math.floor(current / (width + 1))]);
    const next = outgoing.get(current);
    if (next === undefined) failMesh("CONTOUR_INVALID", "Contour has an open edge");
    current = next;
  }
  if (current !== start || seen.size !== edgeCount)
    failMesh("ALPHA_HOLE", "Alpha mask contains a hole or multiple boundary loops");

  // Exact collinear removal is lossless; no silhouette corner is approximated.
  const points = raw.filter((point, index) => {
    const previous = raw[(index - 1 + raw.length) % raw.length]!;
    const next = raw[(index + 1) % raw.length]!;
    return (
      (point[0] - previous[0]) * (next[1] - point[1]) !==
      (point[1] - previous[1]) * (next[0] - point[0])
    );
  });
  if (points.length < 3 || points.length > 2048 || signedArea2(points) <= 0)
    failMesh("CONTOUR_INVALID", "Simplified contour is invalid or exceeds 2048 vertices");
  const startIndex = points.reduce(
    (best, point, index) =>
      point[1] < points[best]![1] || (point[1] === points[best]![1] && point[0] < points[best]![0])
        ? index
        : best,
    0,
  );
  return [...points.slice(startIndex), ...points.slice(0, startIndex)];
}
