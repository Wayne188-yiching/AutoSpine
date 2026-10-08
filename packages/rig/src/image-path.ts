import { analyzeImageRegions, type ImageRegionInput } from "./image-regions.js";

/** Experimental longitudinal slice path. This is neither a medial axis nor an anatomical skeleton. */
export function analyzeImagePath(input: ImageRegionInput) {
  const evidence = analyzeImageRegions(input);
  const { width, height, rgba } = input;
  const policy = {
    minimumPixels: 32,
    minimumAnisotropy: 0.6,
    maximumBins: 24,
    targetSliceSpan: 8,
    segmentSampleStep: 0.25,
    maximumSegmentSamples: 250_000,
    minimumRelativeSliceClearance: 0.8,
    maximumRouteExpansions: 250_000,
    maximumPathPoints: 8192,
    calibrated: false,
  } as const;
  const base = {
    schemaVersion: "0.1",
    kind: "image-path-evidence",
    width,
    height,
    foregroundPixels: evidence.foregroundPixels,
    regionCount: evidence.regions.length,
    policy,
    root: null,
    joint: null,
    parent: null,
    boneCount: null,
    qualityAccepted: false,
  } as const;
  const reject = (reason: string) =>
    ({
      ...base,
      status: "REVIEW_REQUIRED",
      path: null,
      reasons: [reason, "ROOT_AND_JOINT_UNDETERMINED"],
    }) as const;
  if (!evidence.foregroundPixels) return reject("EMPTY_FOREGROUND");
  if (evidence.regions.length !== 1) return reject("REGION_SELECTION_UNDETERMINED");
  const region = evidence.regions[0]!;
  if (region.pixels < policy.minimumPixels || region.anisotropy < policy.minimumAnisotropy)
    return reject("NO_ELONGATED_REGION_CUE");
  // City-block distance to transparent pixels or the image boundary; source alpha is unchanged.
  const clearance = new Uint32Array(width * height);
  for (let p = 0; p < clearance.length; p++) {
    if (!rgba[p * 4 + 3]) continue;
    const x = p % width,
      y = Math.floor(p / width);
    clearance[p] = Math.min(
      x + 1,
      width - x,
      y + 1,
      height - y,
      x ? clearance[p - 1]! + 1 : 1,
      y ? clearance[p - width]! + 1 : 1,
    );
  }
  for (let p = clearance.length - 1; p >= 0; p--) {
    if (!clearance[p]) continue;
    const x = p % width,
      y = Math.floor(p / width);
    clearance[p] = Math.min(
      clearance[p]!,
      x < width - 1 ? clearance[p + 1]! + 1 : 1,
      y < height - 1 ? clearance[p + width]! + 1 : 1,
    );
  }
  const [cx, cy] = region.centroid;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (let p = 0; p < width * height; p++)
    if (rgba[p * 4 + 3]) {
      const x = (p % width) + 0.5 - cx,
        y = Math.floor(p / width) + 0.5 - cy;
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
  const angle = Math.atan2(2 * xy, xx - yy) / 2,
    ux = Math.cos(angle),
    uy = Math.sin(angle);
  let min = Infinity,
    max = -Infinity;
  for (let p = 0; p < width * height; p++)
    if (rgba[p * 4 + 3]) {
      const projection = ((p % width) + 0.5 - cx) * ux + (Math.floor(p / width) + 0.5 - cy) * uy;
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
  const count = Math.min(
    policy.maximumBins,
    Math.max(3, Math.floor((max - min) / policy.targetSliceSpan)),
  );
  const bins = Array.from({ length: count }, () => ({
    pixels: 0,
    x: 0,
    y: 0,
    chosen: -1,
    distance: Infinity,
    maximumClearance: 0,
  }));
  const binOf = (x: number, y: number) =>
    Math.min(
      count - 1,
      Math.max(0, Math.floor((((x - cx) * ux + (y - cy) * uy - min) / (max - min)) * count)),
    );
  for (let p = 0; p < width * height; p++)
    if (rgba[p * 4 + 3]) {
      const x = (p % width) + 0.5,
        y = Math.floor(p / width) + 0.5,
        b = bins[binOf(x, y)]!;
      b.pixels++;
      b.x += x;
      b.y += y;
      b.maximumClearance = Math.max(b.maximumClearance, clearance[p]!);
    }
  for (const b of bins) {
    if (!b.pixels) return reject("EMPTY_LONGITUDINAL_SLICE");
    b.x /= b.pixels;
    b.y /= b.pixels;
    // Do not pick one branch if the averaged cross-section lands in a hole or a split.
    if (!rgba[(Math.floor(b.y) * width + Math.floor(b.x)) * 4 + 3])
      return reject("CROSS_SECTION_CENTER_OUTSIDE_FOREGROUND");
  }
  for (let p = 0; p < width * height; p++)
    if (rgba[p * 4 + 3]) {
      const x = (p % width) + 0.5,
        y = Math.floor(p / width) + 0.5,
        b = bins[binOf(x, y)]!;
      const distance = (x - b.x) ** 2 + (y - b.y) ** 2;
      if (
        clearance[p]! >= b.maximumClearance * policy.minimumRelativeSliceClearance &&
        distance < b.distance
      ) {
        b.distance = distance;
        b.chosen = p;
      }
    }
  const anchors: [number, number][] = bins.map((b) => [
    (b.chosen % width) + 0.5,
    Math.floor(b.chosen / width) + 0.5,
  ]);
  const segmentInside = (a: [number, number], b: [number, number]) => {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / policy.segmentSampleStep),
    );
    for (let j = 0; j <= steps; j++) {
      const x = Math.floor(a[0] + ((b[0] - a[0]) * j) / steps),
        y = Math.floor(a[1] + ((b[1] - a[1]) * j) / steps);
      if (x < 0 || x >= width || y < 0 || y >= height || !rgba[(y * width + x) * 4 + 3])
        return false;
    }
    return true;
  };
  let routeExpansions = 0,
    repairedSegments = 0;
  // Repair only a rejected connection, keeping the original slice anchors. A hole
  // or split at a slice center is still rejected above; this does not select a branch.
  const route = (a: [number, number], b: [number, number]): [number, number][] | null => {
    const start = Math.floor(a[1]) * width + Math.floor(a[0]),
      end = Math.floor(b[1]) * width + Math.floor(b[0]);
    const distance = new Float64Array(width * height).fill(Infinity),
      parent = new Int32Array(width * height).fill(-1);
    type Entry = { pixel: number; cost: number; score: number };
    const heap: Entry[] = [];
    const before = (a: Entry, b: Entry) =>
      a.score < b.score || (a.score === b.score && a.pixel < b.pixel);
    const push = (entry: Entry) => {
      let i = heap.length;
      heap.push(entry);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!before(entry, heap[p]!)) break;
        heap[i] = heap[p]!;
        i = p;
      }
      heap[i] = entry;
    };
    const pop = () => {
      const first = heap[0]!,
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
          if (!before(heap[child]!, last)) break;
          heap[i] = heap[child]!;
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    const heuristic = (p: number) =>
      Math.abs((p % width) - (end % width)) +
      Math.abs(Math.floor(p / width) - Math.floor(end / width));
    distance[start] = 0;
    push({ pixel: start, cost: 0, score: heuristic(start) });
    while (heap.length) {
      const current = pop(),
        p = current.pixel;
      if (current.cost !== distance[p]) continue;
      if (++routeExpansions > policy.maximumRouteExpansions) return null;
      if (p === end) {
        const points: [number, number][] = [];
        for (let q = end; q !== -1; q = parent[q]!) {
          points.push([(q % width) + 0.5, Math.floor(q / width) + 0.5]);
          if (points.length > policy.maximumPathPoints) return null;
        }
        return points.reverse();
      }
      const x = p % width,
        y = Math.floor(p / width);
      const neighbors = [
        x > 0 ? p - 1 : -1,
        x + 1 < width ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y + 1 < height ? p + width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || !rgba[next * 4 + 3]) continue;
        const cost = current.cost + 1 + 2 / clearance[next]!;
        if (cost >= distance[next]!) continue;
        distance[next] = cost;
        parent[next] = p;
        push({ pixel: next, cost, score: cost + heuristic(next) });
      }
    }
    return null;
  };
  const path: [number, number][] = [anchors[0]!];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!,
      b = anchors[i]!;
    if (
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / policy.segmentSampleStep) + 1 >
      policy.maximumSegmentSamples
    )
      return reject("PATH_SAMPLE_BUDGET");
    if (segmentInside(a, b)) path.push(b);
    else {
      const repaired = route(a, b);
      if (!repaired) return reject("FOREGROUND_ROUTE_BUDGET_OR_UNREACHABLE");
      path.push(...repaired.slice(1));
      repairedSegments++;
    }
    if (path.length > policy.maximumPathPoints) return reject("PATH_POINT_BUDGET");
  }
  let sampled = 0,
    arcLength = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!,
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    arcLength += length;
    const steps = Math.max(1, Math.ceil(length / policy.segmentSampleStep));
    if (sampled + steps + 1 > policy.maximumSegmentSamples) return reject("PATH_SAMPLE_BUDGET");
    for (let j = 0; j <= steps; j++) {
      const x = Math.floor(a[0] + ((b[0] - a[0]) * j) / steps),
        y = Math.floor(a[1] + ((b[1] - a[1]) * j) / steps);
      sampled++;
      if (x < 0 || x >= width || y < 0 || y >= height || !rgba[(y * width + x) * 4 + 3])
        return reject("INTERPOLATED_PATH_LEAVES_FOREGROUND");
    }
  }
  const first = path[0]!,
    last = path.at(-1)!,
    dx = last[0] - first[0],
    dy = last[1] - first[1],
    chord = Math.hypot(dx, dy);
  const chordDeviation =
    chord === 0
      ? 0
      : Math.max(
          ...path.map((p) => Math.abs(dx * (p[1] - first[1]) - dy * (p[0] - first[0])) / chord),
        );
  return {
    ...base,
    status: "PATH_CANDIDATE",
    path,
    arcLength,
    chordDeviation,
    connectionRepair: {
      method: "Bounded four-neighbor A* within original foreground; cost 1 + 2 / clearance",
      repairedSegments,
      expandedPixels: routeExpansions,
      interpretation:
        "Connectivity repair only; does not resolve branch choice or anatomical center",
    },
    support: { sampledPoints: sampled, foregroundFraction: 1, spacing: policy.segmentSampleStep },
    clearance: {
      metric: "city-block pixels to transparency or image boundary",
      measuredNodes: "Original slice anchors; repaired intermediate route nodes excluded",
      minimum: Math.min(...bins.map((b) => clearance[b.chosen]!)),
      mean: bins.reduce((sum, b) => sum + clearance[b.chosen]!, 0) / bins.length,
      minimumRelativeToSliceMaximum: Math.min(
        ...bins.map((b) => clearance[b.chosen]! / b.maximumClearance),
      ),
      interpretation:
        "Contour clearance cue only; does not verify anatomical center, root or joint",
    },
    endpointOrder: "UNDIRECTED",
    reasons: [
      "LONGITUDINAL_SLICE_HEURISTIC_UNCALIBRATED",
      "PATH_IS_NOT_BONES",
      "ROOT_AND_JOINT_UNDETERMINED",
    ],
  } as const;
}
