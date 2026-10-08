export interface ImageRegionInput {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface ImageRegionEvidence {
  id: number;
  pixels: number;
  bounds: { x: number; y: number; width: number; height: number };
  centroid: [number, number];
  meanRgb: [number, number, number];
  anisotropy: number;
  axisEnds: [[number, number], [number, number]] | null;
}

/** Pixel evidence only: connected regions and axes do not determine anatomical roles or pivots. */
export function analyzeImageRegions(input: ImageRegionInput) {
  if (
    !input ||
    Reflect.ownKeys(input).length !== 3 ||
    !Object.hasOwn(input, "width") ||
    !Object.hasOwn(input, "height") ||
    !Object.hasOwn(input, "rgba") ||
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width * input.height > 4_000_000 ||
    !(input.rgba instanceof Uint8Array) ||
    input.rgba.length !== input.width * input.height * 4
  )
    throw new Error("IMAGE_REGION_INPUT: exact bounded width, height and RGBA required");
  const { width, height, rgba } = input;
  const size = width * height;
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  const regions: ImageRegionEvidence[] = [];
  let foregroundPixels = 0;
  for (let seed = 0; seed < size; seed++) {
    if (visited[seed] || rgba[seed * 4 + 3] === 0) continue;
    if (regions.length === 4096)
      throw new Error("IMAGE_REGION_BUDGET: more than 4096 regions; none silently discarded");
    let head = 0,
      tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0,
      sumX = 0,
      sumY = 0,
      alpha = 0,
      red = 0,
      green = 0,
      blue = 0;
    const enqueue = (index: number) => {
      if (!visited[index] && rgba[index * 4 + 3]! > 0) {
        visited[index] = 1;
        queue[tail++] = index;
      }
    };
    while (head < tail) {
      const pixel = queue[head++]!;
      const x = pixel % width,
        y = Math.floor(pixel / width),
        a = rgba[pixel * 4 + 3]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x + 0.5;
      sumY += y + 0.5;
      alpha += a;
      red += rgba[pixel * 4]! * a;
      green += rgba[pixel * 4 + 1]! * a;
      blue += rgba[pixel * 4 + 2]! * a;
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
    const cx = sumX / tail,
      cy = sumY / tail;
    let xx = 0,
      xy = 0,
      yy = 0;
    for (let i = 0; i < tail; i++) {
      const pixel = queue[i]!,
        x = (pixel % width) + 0.5 - cx,
        y = Math.floor(pixel / width) + 0.5 - cy;
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
    const total = xx + yy,
      difference = Math.hypot(xx - yy, 2 * xy),
      anisotropy = total === 0 ? 0 : Math.min(1, difference / total);
    let axisEnds: ImageRegionEvidence["axisEnds"] = null;
    if (anisotropy > 1e-12) {
      const angle = Math.atan2(2 * xy, xx - yy) / 2,
        ux = Math.cos(angle),
        uy = Math.sin(angle);
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < tail; i++) {
        const pixel = queue[i]!,
          projection =
            ((pixel % width) + 0.5 - cx) * ux + (Math.floor(pixel / width) + 0.5 - cy) * uy;
        min = Math.min(min, projection);
        max = Math.max(max, projection);
      }
      const ends = [
        [0, 0],
        [0, 0],
      ] as [[number, number], [number, number]];
      const counts = [0, 0];
      for (let i = 0; i < tail; i++) {
        const pixel = queue[i]!,
          x = (pixel % width) + 0.5,
          y = Math.floor(pixel / width) + 0.5,
          projection = (x - cx) * ux + (y - cy) * uy;
        for (const side of [0, 1] as const)
          if (Math.abs(projection - (side === 0 ? min : max)) <= 1e-9) {
            ends[side][0] += x;
            ends[side][1] += y;
            counts[side]!++;
          }
      }
      axisEnds = ends.map((p, i) => [p[0] / counts[i]!, p[1] / counts[i]!]) as typeof ends;
    }
    foregroundPixels += tail;
    regions.push({
      id: regions.length,
      pixels: tail,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      centroid: [cx, cy],
      meanRgb: [red / alpha, green / alpha, blue / alpha],
      anisotropy,
      axisEnds,
    });
  }
  return {
    schemaVersion: "0.1",
    kind: "image-region-evidence",
    width,
    height,
    connectivity: 4,
    alphaRule: "alpha > 0",
    foregroundPixels,
    regions,
    status: foregroundPixels ? "REVIEW_REQUIRED" : "EMPTY",
    role: "unknown",
    pivot: null,
    boneCount: null,
    qualityAccepted: false,
    reviewReasons: [
      ...(regions.length === 0 ? ["EMPTY_FOREGROUND"] : []),
      ...(regions.length > 1 ? ["REGION_SELECTION_UNDETERMINED"] : []),
      "ROLE_UNDETERMINED",
      "PIVOT_UNDETERMINED",
      "BONE_COUNT_UNDETERMINED",
    ],
  } as const;
}
