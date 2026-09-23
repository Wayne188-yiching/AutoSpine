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
