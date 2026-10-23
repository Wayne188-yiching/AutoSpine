/**
 * Comparing an animation with a reference video (ADR-034): pure frame maths, no I/O.
 *
 * The reference is a clip of the motion the animation should match (an editor recording, a
 * storyboard animatic, a generated clip) on a plain background. Frame 0 of the comparison shows the
 * animation's frame 0. The figure is segmented from the background, the build is registered onto
 * it once (scale and offset from frame 0), and both sequences are then compared frame by frame:
 * silhouette overlap, the motion of image patches at every visible part (tracked in both, so
 * occlusion affects both alike), whole-figure timing and amplitude, and the loop seam.
 */

/** 8-bit RGB frame. */
export interface RgbFrame {
  width: number;
  height: number;
  rgb: Uint8Array;
}
export type Rgb = [number, number, number];

/** Median colour of the frame border: the background of a plain-background clip. */
export function borderColor(f: RgbFrame): Rgb {
  const { width: w, height: h, rgb } = f;
  const samples: Rgb[] = [];
  const add = (x: number, y: number) => {
    const o = (y * w + x) * 3;
    samples.push([rgb[o]!, rgb[o + 1]!, rgb[o + 2]!]);
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  for (let x = 0; x < w; x += step) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    add(0, y);
    add(w - 1, y);
  }
  const median = (k: number) => {
    const v = samples.map((s) => s[k]!).sort((a, b) => a - b);
    return v[v.length >> 1]!;
  };
  return [median(0), median(1), median(2)];
}

/**
 * Share of the frame border within `threshold` of `bg`: near 1 for a plain background (a figure
 * cut by the frame edge lowers it a little), low for scenery.
 */
export function plainBorder(f: RgbFrame, bg: Rgb, threshold = 60): number {
  const { width: w, height: h, rgb } = f;
  let near = 0,
    all = 0;
  const at = (x: number, y: number) => {
    const o = (y * w + x) * 3;
    const d =
      Math.abs(rgb[o]! - bg[0]) + Math.abs(rgb[o + 1]! - bg[1]) + Math.abs(rgb[o + 2]! - bg[2]);
    if (d <= threshold) near++;
    all++;
  };
  for (let x = 0; x < w; x++) {
    at(x, 0);
    at(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    at(0, y);
    at(w - 1, y);
  }
  return all ? near / all : 0;
}

/** Pixels whose colour differs from the background by more than `threshold` (sum over RGB). */
export function foregroundMask(f: RgbFrame, bg: Rgb = borderColor(f), threshold = 60): Uint8Array {
  const n = f.width * f.height,
    m = new Uint8Array(n),
    p = f.rgb;
  for (let i = 0; i < n; i++) {
    const d =
      Math.abs(p[i * 3]! - bg[0]) +
      Math.abs(p[i * 3 + 1]! - bg[1]) +
      Math.abs(p[i * 3 + 2]! - bg[2]);
    m[i] = d > threshold ? 1 : 0;
  }
  return m;
}

export interface MaskStats {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export function maskStats(m: Uint8Array, w: number, h: number): MaskStats {
  let area = 0,
    sx = 0,
    sy = 0,
    minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        area++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return area
    ? { area, cx: sx / area, cy: sy / area, minX, maxX, minY, maxY }
    : { area: 0, cx: w / 2, cy: h / 2, minX: 0, maxX: -1, minY: 0, maxY: -1 };
}
export function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0,
    u = 0;
  for (let k = 0; k < a.length; k++) {
    const x = a[k]!,
      y = b[k]!;
    if (x & y) i++;
    if (x | y) u++;
  }
  return u ? i / u : 1;
}

/** IoU of `ref` with `src` scaled by `s` about (cx, cy) and moved by (dx, dy), inside `box`. */
function transformedIou(
  ref: Uint8Array,
  src: Uint8Array,
  w: number,
  h: number,
  s: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  box: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 },
) {
  let i = 0,
    u = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    const sy = Math.round(cy + (y - cy - dy) / s);
    const inY = sy >= 0 && sy < h;
    for (let x = box.x0; x <= box.x1; x++) {
      const sx = Math.round(cx + (x - cx - dx) / s);
      const b = inY && sx >= 0 && sx < w ? src[sy * w + sx]! : 0;
      const a = ref[y * w + x]!;
      if (a & b) i++;
      if (a | b) u++;
    }
  }
  return u ? i / u : 1;
}

export interface Registration {
  /** Scale about (cx, cy) applied to the probe render, and the offset after it, in pixels. */
  scale: number;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  iou: number;
}
/**
 * The scale and offset that best lay a render of the build (`spine`, already placed roughly on the
 * reference) over the reference figure (`ref`): start from the area ratio and the centroids, then a
 * pattern search on the overlap, halving the steps down to a quarter percent and one pixel.
 */
export function registerMasks(
  ref: Uint8Array,
  spine: Uint8Array,
  w: number,
  h: number,
): Registration {
  const st = maskStats(spine, w, h),
    rt = maskStats(ref, w, h);
  const cx = st.cx,
    cy = st.cy;
  if (!st.area || !rt.area) return { scale: 1, cx, cy, dx: 0, dy: 0, iou: 0 };
  const iouAt = (p: { s: number; dx: number; dy: number }) => {
    // Only the reference's box and the moved render's box can hold either mask.
    const m = 2;
    const box = {
      x0: Math.max(0, Math.floor(Math.min(rt.minX, cx + (st.minX - cx) * p.s + p.dx)) - m),
      y0: Math.max(0, Math.floor(Math.min(rt.minY, cy + (st.minY - cy) * p.s + p.dy)) - m),
      x1: Math.min(w - 1, Math.ceil(Math.max(rt.maxX, cx + (st.maxX - cx) * p.s + p.dx)) + m),
      y1: Math.min(h - 1, Math.ceil(Math.max(rt.maxY, cy + (st.maxY - cy) * p.s + p.dy)) + m),
    };
    return transformedIou(ref, spine, w, h, p.s, cx, cy, p.dx, p.dy, box);
  };
  let best = {
    s: Math.min(1.25, Math.max(0.8, Math.sqrt(rt.area / st.area))),
    dx: Math.round(rt.cx - st.cx),
    dy: Math.round(rt.cy - st.cy),
    v: 0,
  };
  best.v = iouAt(best);
  let step = { s: 0.04, d: 8 };
  for (let guard = 0; guard < 400 && (step.s >= 0.0025 || step.d >= 1); guard++) {
    let moved = false;
    for (const c of [
      { ...best, s: best.s + step.s },
      { ...best, s: best.s - step.s },
      { ...best, dx: best.dx + step.d },
      { ...best, dx: best.dx - step.d },
      { ...best, dy: best.dy + step.d },
      { ...best, dy: best.dy - step.d },
    ]) {
      if (c.s < 0.5 || c.s > 2) continue;
      const v = iouAt(c);
      if (v > best.v + 1e-9) {
        best = { ...c, v };
        moved = true;
      }
    }
    if (!moved) {
      if (step.s < 0.0025 && step.d <= 1) break;
      step = { s: step.s / 2, d: Math.max(1, Math.round(step.d / 2)) };
    }
  }
  return { scale: best.s, cx, cy, dx: best.dx, dy: best.dy, iou: best.v };
}

/** Grayscale at half size (box filter): the tracker's working image. */
export function halfGray(f: RgbFrame): { w: number; h: number; g: Float32Array } {
  const w = f.width >> 1,
    h = f.height >> 1,
    g = new Float32Array(w * h),
    p = f.rgb,
    W = f.width;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (const [ax, ay] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const o = ((2 * y + ay) * W + 2 * x + ax) * 3;
        s += 0.299 * p[o]! + 0.587 * p[o + 1]! + 0.114 * p[o + 2]!;
      }
      g[y * w + x] = s / 4;
    }
  return { w, h, g };
}

/**
 * The look of one part in a build frame: its visible pixels (half size, grown by one pixel so a
 * flat-coloured part keeps its outline), zero-mean. Null when there is too little to match.
 */
export interface PartTemplate {
  xs: Int32Array;
  ys: Int32Array;
  t: Float32Array;
  norm: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}
export function partTemplate(
  img: { w: number; h: number; g: Float32Array },
  /** The part's own pixels (indices into `img`). */
  owned: ArrayLike<number>,
  opts: { minPixels?: number; maxPixels?: number; minStd?: number } = {},
): PartTemplate | null {
  const { w, h } = img,
    minPixels = opts.minPixels ?? 24,
    maxPixels = opts.maxPixels ?? 600,
    minStd = opts.minStd ?? 4;
  if (owned.length < minPixels) return null;
  let bx0 = w,
    by0 = h,
    bx1 = 0,
    by1 = 0;
  for (let i = 0; i < owned.length; i++) {
    const x = owned[i]! % w,
      y = Math.floor(owned[i]! / w);
    bx0 = Math.min(bx0, x);
    bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y);
    by1 = Math.max(by1, y);
  }
  // Grow by one pixel inside the part's box (plus the ring).
  const x0 = Math.max(0, bx0 - 1),
    y0 = Math.max(0, by0 - 1),
    x1 = Math.min(w - 1, bx1 + 1),
    y1 = Math.min(h - 1, by1 + 1),
    bw = x1 - x0 + 1,
    bh = y1 - y0 + 1;
  const mine = new Uint8Array(bw * bh);
  for (let i = 0; i < owned.length; i++)
    mine[(Math.floor(owned[i]! / w) - y0) * bw + (owned[i]! % w) - x0] = 1;
  const grown: number[] = [];
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const xx = x + dx,
            yy = y + dy;
          hit = xx >= 0 && yy >= 0 && xx < bw && yy < bh && mine[yy * bw + xx] === 1;
        }
      if (hit) grown.push((y + y0) * w + x + x0);
    }
  const step = Math.max(1, Math.ceil(grown.length / maxPixels));
  const pick = grown.filter((_, i) => i % step === 0);
  const n = pick.length,
    xs = new Int32Array(n),
    ys = new Int32Array(n),
    t = new Float32Array(n);
  let mean = 0;
  pick.forEach((q, i) => {
    xs[i] = q % w;
    ys[i] = Math.floor(q / w);
    mean += t[i] = img.g[q]!;
  });
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const v = t[i]! - mean;
    t[i] = v;
    ss += v * v;
  }
  if (Math.sqrt(ss / n) < minStd) return null;
  return { xs, ys, t, norm: Math.sqrt(ss), box: { x0, y0, x1, y1 } };
}
/**
 * Where the part shows in `img`: the shift (half-size pixels, within `radius`) and turn about its
 * centre with the best normalised cross-correlation. Shift every other pixel unturned first, then
 * turns of up to 30 degrees around it, then the shift to a fraction of a pixel. Turning matters:
 * a limb matched unturned is placed nearer its root than it is. With `mirror`, the part is also
 * tried flipped left to right (a body drawn facing the other way), and `mirrored` says which won.
 */
export function matchPart(
  img: { w: number; h: number; g: Float32Array },
  tpl: PartTemplate,
  radius: number,
  /** Last frame's answer: searched around first; the full search runs only if that is poor. */
  guess?: { dx: number; dy: number; angle: number; mirrored?: boolean },
  mirror = false,
): { dx: number; dy: number; angle: number; mirrored: boolean; score: number } {
  const { xs, ys, t, norm } = tpl,
    n = t.length,
    w = img.w,
    h = img.h;
  let cx = 0,
    cy = 0;
  for (let i = 0; i < n; i++) {
    cx += xs[i]!;
    cy += ys[i]!;
  }
  cx /= n;
  cy /= n;
  const turned = new Map<string, { ox: Int32Array; oy: Int32Array }>();
  const offsets = (deg: number, flip: boolean) => {
    const key = `${deg}${flip ? "m" : ""}`;
    let o = turned.get(key);
    if (!o) {
      const c = Math.cos((deg * Math.PI) / 180),
        s = Math.sin((deg * Math.PI) / 180);
      const ox = new Int32Array(n),
        oy = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (flip ? -1 : 1) * (xs[i]! - cx),
          y = ys[i]! - cy;
        ox[i] = Math.round(cx + c * x - s * y);
        oy[i] = Math.round(cy + s * x + c * y);
      }
      turned.set(key, (o = { ox, oy }));
    }
    return o;
  };
  const ncc = (dx: number, dy: number, deg: number, flip: boolean) => {
    const { ox, oy } = offsets(deg, flip);
    let sum = 0,
      sq = 0,
      dot = 0;
    for (let i = 0; i < n; i++) {
      const x = ox[i]! + dx,
        y = oy[i]! + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      const v = img.g[y * w + x]!;
      sum += v;
      sq += v * v;
      dot += v * t[i]!;
    }
    const varSum = sq - (sum * sum) / n;
    return varSum <= 1e-6 ? -1 : dot / (Math.sqrt(varSum) * norm);
  };
  interface Hit {
    dx: number;
    dy: number;
    angle: number;
    mirrored: boolean;
    score: number;
  }
  const at = (dx: number, dy: number, angle: number, mirrored: boolean): Hit => ({
    dx,
    dy,
    angle,
    mirrored,
    score: ncc(dx, dy, angle, mirrored),
  });
  let best = at(0, 0, 0, false);
  const near = (dxs: number[], dys: number[], angles: number[]) => {
    const c = { ...best };
    for (const a of angles)
      for (const ddy of dys)
        for (const ddx of dxs) {
          const v = ncc(c.dx + ddx, c.dy + ddy, c.angle + a, c.mirrored);
          if (v > best.score)
            best = {
              dx: c.dx + ddx,
              dy: c.dy + ddy,
              angle: c.angle + a,
              mirrored: c.mirrored,
              score: v,
            };
        }
  };
  const two = [-2, -1, 0, 1, 2],
    one = [-1, 0, 1],
    three = [-3, -2, -1, 0, 1, 2, 3];
  const refine = () => {
    near(two, two, [-30, -20, -10, 0, 10, 20, 30]);
    near(one, one, [-5, 0, 5]);
    near(one, one, [-2, 0, 2]);
  };
  const full = (flip: boolean) => {
    best = at(0, 0, 0, flip);
    for (let dy = -radius; dy <= radius; dy += 2)
      for (let dx = -radius; dx <= radius; dx += 2) {
        const v = ncc(dx, dy, 0, flip);
        if (v > best.score) best = { dx, dy, angle: 0, mirrored: flip, score: v };
      }
    refine();
    return best;
  };
  let local: Hit | undefined;
  if (guess) {
    best = at(Math.round(guess.dx), Math.round(guess.dy), guess.angle, mirror && !!guess.mirrored);
    near(three, three, [0]);
    refine();
    local = best;
  }
  if (!local || local.score < 0.75) {
    const candidates = [full(false), ...(mirror ? [full(true)] : []), ...(local ? [local] : [])];
    best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  }
  if (best.score < 0) return { dx: 0, dy: 0, angle: 0, mirrored: false, score: -1 };
  const offset = (a: number, b: number) => {
    const d = a - 2 * best.score + b;
    return a >= 0 && b >= 0 && d < -1e-9 ? Math.max(-0.5, Math.min(0.5, (a - b) / (2 * d))) : 0;
  };
  const { dx, dy, angle, mirrored } = best;
  return {
    dx: dx + offset(ncc(dx - 1, dy, angle, mirrored), ncc(dx + 1, dy, angle, mirrored)),
    dy: dy + offset(ncc(dx, dy - 1, angle, mirrored), ncc(dx, dy + 1, angle, mirrored)),
    angle,
    mirrored,
    score: best.score,
  };
}

/**
 * How much the part looks like its own mirror image where it is drawn (1 = left-right symmetric):
 * a part this symmetric cannot show whether the reference flipped it.
 */
export function mirrorSimilarity(
  img: { w: number; h: number; g: Float32Array },
  tpl: PartTemplate,
): number {
  let cx = 0;
  for (let i = 0; i < tpl.xs.length; i++) cx += tpl.xs[i]!;
  cx /= tpl.xs.length;
  const xs = tpl.xs.map((x) => Math.round(2 * cx - x));
  let x0 = Infinity,
    x1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    x0 = Math.min(x0, xs[i]!);
    x1 = Math.max(x1, xs[i]!);
  }
  const flipped: PartTemplate = { ...tpl, xs, box: { ...tpl.box, x0, x1 } };
  return Math.max(0, matchPart(img, flipped, 3).score);
}

/**
 * Whether a part found mirrored shows flipped rather than redrawn: the mirror image must match
 * better than the part the right way round (`flipped`, `unflipped`: their best scores in the frame)
 * by at least half of what a flip gives a part this asymmetric (1 - `symmetry`, its
 * `mirrorSimilarity`). A part whose drawing changes, such as an expression or a mesh deform,
 * matches poorly either way round, and either may win by a little.
 */
export function clearlyMirrored(flipped: number, unflipped: number, symmetry: number): boolean {
  return flipped - unflipped >= 0.5 * (1 - symmetry);
}

/**
 * The longest run of frames in which a part showed mirrored, as [first, last], when it covers at
 * least `minRun` frames; null otherwise. Frames where it was not found neither break nor extend it.
 */
export function mirroredRun(flags: (boolean | null)[], minRun: number): [number, number] | null {
  let best: [number, number] | null = null,
    start = -1,
    last = -1;
  const close = () => {
    if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
    start = -1;
  };
  flags.forEach((m, i) => {
    if (m === null) return;
    if (m) {
      if (start < 0) start = i;
      last = i;
    } else close();
  });
  close();
  const run = best as [number, number] | null;
  return run && run[1] - run[0] + 1 >= minRun ? run : null;
}

/**
 * Timing and size of `s` against `r` (one value per frame): the shift, in frames, that best aligns
 * them (positive: `s` is late) and the ratio of their spreads. `loop` wraps the shift.
 */
export function lagAndAmplitude(
  r: number[],
  s: number[],
  loop: boolean,
  maxLag = 12,
): { lag: number; amplitude: number; correlation: number } {
  const n = Math.min(r.length, s.length);
  const center = (v: number[]) => {
    const m = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
    return v.slice(0, n).map((x) => x - m);
  };
  const R = center(r),
    S = center(s);
  const sd = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / n);
  const sr = sd(R),
    ss = sd(S);
  const L = Math.min(maxLag, Math.floor(n / 4));
  let best = { lag: 0, c: -Infinity };
  for (let lag = -L; lag <= L; lag++) {
    let c = 0,
      m = 0;
    for (let i = 0; i < n; i++) {
      let j = i + lag;
      if (loop) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      c += R[i]! * S[j]!;
      m++;
    }
    c = m ? c / m : -Infinity;
    if (c > best.c) best = { lag, c };
  }
  return {
    lag: best.lag,
    amplitude: sr > 1e-9 ? ss / sr : ss > 1e-9 ? Infinity : 1,
    correlation: sr > 1e-9 && ss > 1e-9 ? best.c / (sr * ss) : 1,
  };
}

const quantile = (v: number[], q: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** One part's position per frame (pixels): where the build draws it, and where the reference shows it. */
export interface PartTrack {
  part: string;
  ref: ([number, number] | null)[];
  build: ([number, number] | null)[];
}
export interface PartScore {
  part: string;
  frames: number;
  /** Errors as a fraction of the figure height. */
  median: number;
  p90: number;
  /** Positive: the build moves later than the reference. */
  lag: number | null;
  amplitude: number | null;
  /** How well the two motions agree once shifted (1 = same shape); low means lag is unreliable. */
  correlation: number | null;
}
/**
 * Drops the frames where the part was matched away from where its neighbours put it: a lone jump
 * of more than `tolerance` pixels from the median of the two frames either side is a mismatch.
 */
export function dropJumps(t: PartTrack, tolerance: number, loop: boolean): PartTrack {
  const n = t.ref.length;
  const d = t.ref.map((r, i) => {
    const b = t.build[i];
    return r && b ? ([r[0] - b[0], r[1] - b[1]] as [number, number]) : null;
  });
  const keep = d.map((p, i) => {
    if (!p) return false;
    const near: [number, number][] = [];
    for (let k = -2; k <= 2; k++) {
      if (!k) continue;
      let j = i + k;
      if (loop) j = (j + n) % n;
      const q = j >= 0 && j < n ? d[j] : null;
      if (q) near.push(q);
    }
    if (near.length < 2) return true;
    const med = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    };
    return (
      Math.hypot(p[0] - med(near.map((q) => q[0])), p[1] - med(near.map((q) => q[1]))) <= tolerance
    );
  });
  return {
    part: t.part,
    ref: t.ref.map((r, i) => (keep[i] ? r : null)),
    build: t.build.map((b, i) => (keep[i] ? b : null)),
  };
}
/**
 * Per-part position error, timing and size; `height` is the figure height in the same pixels.
 * Lone mismatches (jumps of more than 1.5% of the height) are dropped first.
 */
export function scoreParts(
  tracks: PartTrack[],
  height: number,
  loop: boolean,
  minMotion = 0.003,
): PartScore[] {
  return tracks.map((raw) => {
    const t = dropJumps(raw, Math.max(2, 0.015 * height), loop);
    const err: number[] = [],
      rs: [number, number][] = [],
      bs: [number, number][] = [];
    t.ref.forEach((r, i) => {
      const b = t.build[i];
      if (!r || !b) return;
      err.push(Math.hypot(r[0] - b[0], r[1] - b[1]) / height);
      rs.push(r);
      bs.push(b);
    });
    let lag: number | null = null,
      amplitude: number | null = null,
      correlation: number | null = null;
    if (rs.length >= 8) {
      // Along the reference's main direction of motion.
      const mx = rs.reduce((a, p) => a + p[0], 0) / rs.length,
        my = rs.reduce((a, p) => a + p[1], 0) / rs.length;
      let sxx = 0,
        syy = 0,
        sxy = 0;
      for (const [x, y] of rs) {
        sxx += (x - mx) ** 2;
        syy += (y - my) ** 2;
        sxy += (x - mx) * (y - my);
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy),
        ux = Math.cos(angle),
        uy = Math.sin(angle);
      const project = (p: [number, number]) => p[0] * ux + p[1] * uy;
      if (Math.sqrt((sxx + syy) / rs.length) / height >= minMotion) {
        const la = lagAndAmplitude(
          rs.map(project),
          bs.map(project),
          loop && rs.length === t.ref.length,
        );
        lag = la.lag;
        amplitude = la.amplitude;
        correlation = la.correlation;
      }
    }
    return {
      part: t.part,
      frames: err.length,
      median: quantile(err, 0.5),
      p90: quantile(err, 0.9),
      lag,
      amplitude,
      correlation,
    };
  });
}
/** The parts followed through enough of the comparison to be judged (half the frames, at least 4). */
export function judgedParts(parts: PartScore[], frames: number): PartScore[] {
  return parts.filter((p) => p.frames >= Math.max(4, frames / 2));
}

/** Proposed thresholds (ADR-034); tune with the art lead. Errors are fractions of figure height. */
export const VIDEO_ACCEPTANCE = Object.freeze({
  silhouetteMean: 0.9,
  silhouetteMin: 0.8,
  partMedian: 0.006,
  partP90: 0.015,
  maxLagFrames: 2,
  amplitudeLow: 0.75,
  amplitudeHigh: 1.33,
  /** Mean absolute difference of the last and first frame, 0..1. */
  seam: 0.002,
  /** Figure motion (spread / height) below which timing and size are not judged. */
  minMotion: 0.003,
});

export interface VideoCheckRow {
  id: string;
  ok: boolean;
  value: unknown;
}
export interface VideoMeasurements {
  iou: number[];
  parts: PartScore[];
  figure: { lag: number; amplitude: number; motion: number };
  seam: number | null;
  /** The build's deformation QA (ADR-045): parts squashed to a line, or turned over through one. */
  deformation?: { collapses: Record<string, unknown>; flips: Record<string, unknown> };
}
export function checkVideoAcceptance(m: VideoMeasurements): VideoCheckRow[] {
  const A = VIDEO_ACCEPTANCE;
  const mean = m.iou.reduce((a, b) => a + b, 0) / Math.max(1, m.iou.length),
    min = Math.min(...m.iou);
  const tracked = judgedParts(m.parts, m.iou.length);
  const med = quantile(
    tracked.map((p) => p.median),
    0.5,
  );
  const p90 = quantile(
    tracked.map((p) => p.p90),
    0.9,
  );
  const timed = m.figure.motion >= A.minMotion;
  const rows: VideoCheckRow[] = [
    {
      id: `V1 silhouette IoU mean >= ${A.silhouetteMean}, min >= ${A.silhouetteMin}`,
      ok: mean >= A.silhouetteMean && min >= A.silhouetteMin,
      value: [+mean.toFixed(3), +min.toFixed(3)],
    },
    {
      id: `V2 part motion error median <= ${A.partMedian * 100}% / p90 <= ${A.partP90 * 100}% of height`,
      ok: tracked.length > 0 && med <= A.partMedian && p90 <= A.partP90,
      value: tracked.length
        ? [+(med * 100).toFixed(2), +(p90 * 100).toFixed(2), `${tracked.length} parts`]
        : "no part could be tracked",
    },
    {
      id: `V3 figure timing |lag| <= ${A.maxLagFrames} frames, size ${A.amplitudeLow}-${A.amplitudeHigh}`,
      ok:
        !timed ||
        (Math.abs(m.figure.lag) <= A.maxLagFrames &&
          m.figure.amplitude >= A.amplitudeLow &&
          m.figure.amplitude <= A.amplitudeHigh),
      value: timed
        ? [m.figure.lag, +m.figure.amplitude.toFixed(2)]
        : "reference figure barely moves; not judged",
    },
  ];
  if (m.seam !== null)
    rows.push({
      id: `V4 loop seam mean difference <= ${A.seam}`,
      ok: m.seam <= A.seam,
      value: +m.seam.toFixed(4),
    });
  if (m.deformation) {
    // A reference drawing hides a part behind another; the build must hide it, not flatten it.
    const parts = [
      ...new Set([...Object.keys(m.deformation.collapses), ...Object.keys(m.deformation.flips)]),
    ];
    rows.push({
      id: "V5 collapsed or squashed-through parts = 0",
      ok: !parts.length,
      value: parts,
    });
  }
  return rows;
}

/**
 * How far a comparison is from passing (ADR-036): over the rows, how far each value is past its
 * threshold, as a fraction of the threshold. 0 when every row passes; rounds of a fit are ranked by
 * it. A V2 row that tracked no part counts 1, and so does a failed V5 (ADR-045).
 */
export function videoPenalty(rows: readonly VideoCheckRow[]): number {
  const A = VIDEO_ACCEPTANCE;
  const over = (v: number, limit: number) => Math.max(0, v - limit) / limit,
    under = (v: number, limit: number) => Math.max(0, limit - v) / limit;
  let penalty = 0;
  for (const { id, value } of rows) {
    const v = Array.isArray(value) ? (value as unknown[]) : [value];
    const n = (i: number) => (typeof v[i] === "number" ? (v[i] as number) : NaN);
    if (id.startsWith("V1") && Number.isFinite(n(0)))
      penalty += under(n(0), A.silhouetteMean) + under(n(1), A.silhouetteMin);
    else if (id.startsWith("V2"))
      penalty += Number.isFinite(n(0))
        ? over(n(0) / 100, A.partMedian) + over(n(1) / 100, A.partP90)
        : 1;
    else if (id.startsWith("V3") && Number.isFinite(n(0)))
      penalty +=
        over(Math.abs(n(0)), A.maxLagFrames) +
        under(n(1), A.amplitudeLow) +
        over(n(1), A.amplitudeHigh);
    else if (id.startsWith("V4") && Number.isFinite(n(0))) penalty += over(n(0), A.seam);
    else if (id.startsWith("V5") && v.length) penalty += 1;
  }
  return +penalty.toFixed(4);
}
