import type { AssetPart } from "@autospine/schemas";

export type AlphaMask = NonNullable<AssetPart["alphaMask"]>;

export function encodeAlphaMask(width: number, height: number, alpha: Uint8Array): AlphaMask {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    alpha.length !== width * height
  )
    throw new Error("Alpha dimensions do not match pixel count");
  const runs: number[] = [];
  for (const value of alpha) {
    if (runs.length && runs[runs.length - 1] === value) runs[runs.length - 2]!++;
    else runs.push(1, value);
  }
  return { width, height, encoding: "rle8", runs };
}

export function decodeAlphaMask(mask: AlphaMask): Uint8Array {
  const expected = mask.width * mask.height;
  if (
    mask.encoding !== "rle8" ||
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    mask.runs.length % 2 !== 0
  )
    throw new Error("Invalid alpha mask header");
  const alpha = new Uint8Array(expected);
  let offset = 0;
  for (let index = 0; index < mask.runs.length; index += 2) {
    const count = mask.runs[index]!;
    const value = mask.runs[index + 1]!;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 255 ||
      offset + count > expected
    )
      throw new Error("Invalid alpha mask run");
    alpha.fill(value, offset, offset + count);
    offset += count;
  }
  if (offset !== expected) throw new Error("Alpha mask pixel count mismatch");
  return alpha;
}

/** Center of the nontransparent pixel bounds, in document/display coordinates. */
export function alphaPivot(
  alpha: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  bounds: { x: number; y: number; width: number; height: number },
): [number, number] | undefined {
  let left = pixelWidth,
    top = pixelHeight,
    right = -1,
    bottom = -1;
  for (let index = 0; index < alpha.length; index++) {
    if (!alpha[index]) continue;
    const x = index % pixelWidth;
    const y = Math.floor(index / pixelWidth);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < 0) return undefined;
  return [
    bounds.x + (((left + right + 1) / 2) * bounds.width) / pixelWidth,
    bounds.y + (((top + bottom + 1) / 2) * bounds.height) / pixelHeight,
  ];
}
