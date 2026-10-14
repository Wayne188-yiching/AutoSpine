import { drawList, pose, type LoadedSkeleton } from "./runtime.js";
import { flatten, render, type Texture, type View } from "./render.js";

type RGB = readonly [number, number, number];
/** One 8-bit RGB raster. */
export interface Raster {
  width: number;
  height: number;
  rgb: Uint8Array;
}

const toPx = (view: View, x: number, y: number): [number, number] => [
  (x - view.x0) * view.scale,
  (view.y0 - y) * view.scale,
];
function plot(r: Raster, x: number, y: number, c: RGB, alpha: number) {
  const px = Math.round(x),
    py = Math.round(y);
  if (px < 0 || py < 0 || px >= r.width || py >= r.height) return;
  const i = (py * r.width + px) * 3;
  for (let k = 0; k < 3; k++)
    r.rgb[i + k] = Math.round(r.rgb[i + k]! * (1 - alpha) + c[k]! * alpha);
}
/** A straight line with a square brush of `width` px. */
export function drawLine(
  r: Raster,
  a: readonly [number, number],
  b: readonly [number, number],
  c: RGB,
  alpha = 1,
  width = 1,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))),
    h = (width - 1) / 2;
  for (let s = 0; s <= steps; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / steps,
      y = a[1] + ((b[1] - a[1]) * s) / steps;
    for (let dx = -h; dx <= h; dx++)
      for (let dy = -h; dy <= h; dy++) plot(r, x + dx, y + dy, c, alpha);
  }
}
/** A filled square dot of radius `size`. */
export function drawDot(r: Raster, p: readonly [number, number], c: RGB, size = 2) {
  for (let dx = -size; dx <= size; dx++)
    for (let dy = -size; dy <= size; dy++) plot(r, p[0] + dx, p[1] + dy, c, 1);
}
/** Multiplies the image by `keep` so overlays read clearly. */
export function dim(r: Raster, keep: number) {
  for (let i = 0; i < r.rgb.length; i++) r.rgb[i] = Math.round(r.rgb[i]! * keep);
}
/** Every drawn attachment's triangle edges in the current pose (regions are two triangles). */
export function drawWireframe(sk: LoadedSkeleton, view: View, r: Raster, c: RGB = [90, 220, 255]) {
  for (const item of drawList(sk)) {
    if (item.color[3] <= 0.02) continue;
    const p = (i: number) => toPx(view, item.verts[2 * i]!, item.verts[2 * i + 1]!);
    const seen = new Set<string>();
    for (let t = 0; t < item.tris.length; t += 3)
      for (const [u, v] of [
        [item.tris[t]!, item.tris[t + 1]!],
        [item.tris[t + 1]!, item.tris[t + 2]!],
        [item.tris[t + 2]!, item.tris[t]!],
      ] as const) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (seen.has(key)) continue;
        seen.add(key);
        drawLine(r, p(u), p(v), c, 0.8);
      }
  }
}
/** Bones from origin to tip (their world x axis times length) with a dot on every origin. */
export function drawBones(sk: LoadedSkeleton, view: View, r: Raster, c: RGB = [255, 196, 60]) {
  for (const b of sk.skeleton.bones) {
    const o = toPx(view, b.worldX, b.worldY),
      L = b.data.length;
    if (L > 0) drawLine(r, o, toPx(view, b.worldX + b.a * L, b.worldY + b.c * L), c, 0.95, 2);
  }
  for (const b of sk.skeleton.bones) drawDot(r, toPx(view, b.worldX, b.worldY), [255, 255, 255], 2);
}

export type ReviewSegment = "wireframe" | "bones" | "motion";
export const REVIEW_SEGMENTS: readonly ReviewSegment[] = ["wireframe", "bones", "motion"];
/**
 * Side-by-side review frames for one animation (artist | build): the loop with its mesh
 * wireframe, then with its bones, then the plain motion, each `loops` times. Renders are cached
 * per frame; overlays are drawn on a dimmed copy in the same pose.
 */
export function reviewFrames(
  sides: readonly LoadedSkeleton[],
  texture: (path: string) => Texture,
  view: View,
  animation: string,
  options: { fps?: number; loops?: number; background?: [number, number, number] } = {},
) {
  const fps = options.fps ?? 30,
    bg = options.background ?? [0.13, 0.15, 0.18];
  const duration = Math.max(
    ...sides.map((s) => {
      const a = s.data.findAnimation(animation);
      if (!a) throw new Error(`REFERENCE_ANIMATION: no animation ${animation}`);
      return a.duration;
    }),
  );
  const frames = Math.max(1, Math.round(duration * fps)),
    loops = options.loops ?? Math.max(2, Math.ceil((3 * fps) / frames)),
    gap = 4,
    width = sides.length * view.width + (sides.length - 1) * gap,
    height = view.height;
  const cache = new Map<string, Uint8Array>();
  const base = (side: number, f: number) => {
    const key = `${side}:${f}`;
    let rgb = cache.get(key);
    if (!rgb) {
      pose(sides[side]!, animation, Math.min(duration, f / fps));
      rgb = flatten(render(sides[side]!, texture, view), view.width, view.height, bg);
      cache.set(key, rgb);
    }
    return rgb;
  };
  const frame = (segment: ReviewSegment, f: number): Raster => {
    const out: Raster = { width, height, rgb: new Uint8Array(width * height * 3) };
    sides.forEach((sk, side) => {
      const tile: Raster = { width: view.width, height: view.height, rgb: base(side, f).slice() };
      if (segment !== "motion") {
        dim(tile, 0.45);
        pose(sk, animation, Math.min(duration, f / fps));
        if (segment === "wireframe") drawWireframe(sk, view, tile);
        else drawBones(sk, view, tile);
      }
      const x0 = side * (view.width + gap);
      for (let y = 0; y < view.height; y++)
        out.rgb.set(
          tile.rgb.subarray(y * view.width * 3, (y + 1) * view.width * 3),
          (y * width + x0) * 3,
        );
    });
    return out;
  };
  return {
    width,
    height,
    fps,
    frames,
    loops,
    /** Frames in playing order: every segment, each loop of it, every frame of the loop. */
    *play(): Generator<{ segment: ReviewSegment; raster: Raster }> {
      for (const segment of REVIEW_SEGMENTS)
        for (let l = 0; l < loops; l++)
          for (let f = 0; f < frames; f++) yield { segment, raster: frame(segment, f) };
    },
    /** Seconds each segment starts at, for captions. */
    segmentStart: (segment: ReviewSegment) =>
      (REVIEW_SEGMENTS.indexOf(segment) * loops * frames) / fps,
  };
}
