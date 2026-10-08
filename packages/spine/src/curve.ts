import type { KeyCurve } from "@autospine/schemas";

/**
 * Spine 4.0 JSON curve for the segment that starts at a key: omitted (linear), "stepped", or
 * absolute Bezier handles `[cx1, cy1, cx2, cy2]` per channel. Spine stores handle time in seconds
 * and handle value in the exported value space, so `channels` must hold each channel's
 * `[start, end]` after this adapter's sign or unit conversion.
 */
export function spineCurve(
  curve: KeyCurve | undefined,
  start: number,
  end: number,
  channels: [number, number][],
): { curve?: "stepped" | number[] } {
  if (!curve || curve.type === "linear") return {};
  if (curve.type === "stepped") return { curve: "stepped" };
  const span = end - start;
  return {
    curve: channels.flatMap(([a, b]) => [
      start + curve.x1 * span,
      a + curve.y1 * (b - a),
      start + curve.x2 * span,
      a + curve.y2 * (b - a),
    ]),
  };
}
