import { BLEND, drawList, type LoadedSkeleton } from "./runtime.js";

/** A decoded image, premultiplied RGBA floats in [0, 1]. */
export interface Texture {
  width: number;
  height: number;
  rgba: Float32Array;
}
export function premultiply(width: number, height: number, rgba8: ArrayLike<number>): Texture {
  const p = new Float32Array(width * height * 4);
  for (let i = 0; i < p.length; i += 4) {
    const a = rgba8[i + 3]! / 255;
    p[i] = (rgba8[i]! / 255) * a;
    p[i + 1] = (rgba8[i + 1]! / 255) * a;
    p[i + 2] = (rgba8[i + 2]! / 255) * a;
    p[i + 3] = a;
  }
  return { width, height, rgba: p };
}
/** Raster crop in Spine world units: (x0, y0) is the top-left (y up), `scale` px per unit. */
export interface View {
  x0: number;
  y0: number;
  scale: number;
  width: number;
  height: number;
}
/**
 * Software rasteriser for review sheets: bilinear premultiplied sampling, slot x attachment tint,
 * normal / additive / multiply / screen blending. Clipping attachments are not drawn.
 */
export function render(
  sk: LoadedSkeleton,
  texture: (path: string) => Texture,
  view: View,
  /** Filled with the index (in `sk.skeleton.slots`) of the slot that covers each pixel, or -1. */
  owner?: Int16Array,
): Float32Array {
  const { width: w, height: h } = view;
  const c = new Float32Array(w * h * 4);
  const slotIndex = new Map<string, number>();
  if (owner) {
    owner.fill(-1);
    sk.skeleton.slots.forEach((slot, i) => slotIndex.set(slot.data.name, i));
  }
  const toPx = (x: number, y: number): [number, number] => [
    (x - view.x0) * view.scale,
    (view.y0 - y) * view.scale,
  ];
  for (const item of drawList(sk)) {
    const tex = texture(item.path);
    // Additive and screen glows do not hide what is under them.
    const id =
      owner && item.blend !== BLEND.additive && item.blend !== BLEND.screen
        ? (slotIndex.get(item.slot) ?? -1)
        : -1;
    const P: [number, number][] = [];
    for (let i = 0; i < item.verts.length; i += 2) P.push(toPx(item.verts[i]!, item.verts[i + 1]!));
    const [cr, cg, cb, ca] = item.color;
    const T = tex.rgba;
    for (let t = 0; t < item.tris.length; t += 3) {
      const i0 = item.tris[t]!,
        i1 = item.tris[t + 1]!,
        i2 = item.tris[t + 2]!;
      const [x0, y0] = P[i0]!,
        [x1, y1] = P[i1]!,
        [x2, y2] = P[i2]!;
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))),
        maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))),
        maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      const u0 = item.uvs[2 * i0]! * tex.width,
        v0 = item.uvs[2 * i0 + 1]! * tex.height;
      const u1 = item.uvs[2 * i1]! * tex.width,
        v1 = item.uvs[2 * i1 + 1]! * tex.height;
      const u2 = item.uvs[2 * i2]! * tex.width,
        v2 = item.uvs[2 * i2 + 1]! * tex.height;
      for (let py = minY; py <= maxY; py++) {
        const sy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const sx = px + 0.5;
          const l0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / den;
          const l1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / den;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const u = l0 * u0 + l1 * u1 + l2 * u2,
            v = l0 * v0 + l1 * v1 + l2 * v2;
          const fx = Math.min(Math.max(u - 0.5, 0), tex.width - 1),
            fy = Math.min(Math.max(v - 0.5, 0), tex.height - 1);
          const ix = Math.floor(fx),
            iy = Math.floor(fy),
            ax = fx - ix,
            ay = fy - iy;
          const ix1 = Math.min(ix + 1, tex.width - 1),
            iy1 = Math.min(iy + 1, tex.height - 1);
          const q00 = (iy * tex.width + ix) * 4,
            q10 = (iy * tex.width + ix1) * 4,
            q01 = (iy1 * tex.width + ix) * 4,
            q11 = (iy1 * tex.width + ix1) * 4;
          const s = (k: number) =>
            (T[q00 + k]! * (1 - ax) + T[q10 + k]! * ax) * (1 - ay) +
            (T[q01 + k]! * (1 - ax) + T[q11 + k]! * ax) * ay;
          const sa = s(3) * ca;
          if (sa <= 0.0005) continue;
          const sr = s(0) * cr * ca,
            sg = s(1) * cg * ca,
            sb = s(2) * cb * ca;
          const o = (py * w + px) * 4;
          if (id >= 0 && sa > 0.5) owner![py * w + px] = id;
          const dr = c[o]!,
            dg = c[o + 1]!,
            db = c[o + 2]!,
            da = c[o + 3]!;
          if (item.blend === BLEND.additive) {
            c[o] = dr + sr;
            c[o + 1] = dg + sg;
            c[o + 2] = db + sb;
          } else if (item.blend === BLEND.multiply) {
            c[o] = sr * dr + dr * (1 - sa);
            c[o + 1] = sg * dg + dg * (1 - sa);
            c[o + 2] = sb * db + db * (1 - sa);
            c[o + 3] = sa + da * (1 - sa);
          } else if (item.blend === BLEND.screen) {
            c[o] = sr + dr * (1 - sr);
            c[o + 1] = sg + dg * (1 - sg);
            c[o + 2] = sb + db * (1 - sb);
            c[o + 3] = sa + da * (1 - sa);
          } else {
            c[o] = sr + dr * (1 - sa);
            c[o + 1] = sg + dg * (1 - sa);
            c[o + 2] = sb + db * (1 - sa);
            c[o + 3] = sa + da * (1 - sa);
          }
        }
      }
    }
  }
  return c;
}
/** Composite over an opaque background; 8-bit RGB. */
export function flatten(
  canvas: Float32Array,
  width: number,
  height: number,
  background: [number, number, number] = [1, 1, 1],
): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = Math.min(1, canvas[i * 4 + 3]!);
    for (let k = 0; k < 3; k++)
      out[i * 3 + k] = Math.round(Math.min(1, canvas[i * 4 + k]! + background[k]! * (1 - a)) * 255);
  }
  return out;
}
/** RGB image tiles in a grid (row-major), as one RGBA buffer. */
export function sheet(
  tiles: Uint8Array[][],
  width: number,
  height: number,
): { width: number; height: number; rgba: Uint8Array } {
  const rows = tiles.length,
    cols = Math.max(...tiles.map((r) => r.length));
  const W = width * cols,
    H = height * rows,
    rgba = new Uint8Array(W * H * 4);
  tiles.forEach((row, r) =>
    row.forEach((rgb, c) => {
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const o = ((r * height + y) * W + c * width + x) * 4,
            q = (y * width + x) * 3;
          rgba[o] = rgb[q]!;
          rgba[o + 1] = rgb[q + 1]!;
          rgba[o + 2] = rgb[q + 2]!;
          rgba[o + 3] = 255;
        }
    }),
  );
  return { width: W, height: H, rgba };
}
