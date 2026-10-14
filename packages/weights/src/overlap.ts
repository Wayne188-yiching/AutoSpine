import type { MeshSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

export interface PosedMesh {
  mesh: MeshSpec;
  posed: [number, number][];
}
export interface OverlapDrift {
  /** Vertices of either mesh lying inside the other at setup. */
  points: number;
  maxDrift: number;
  meanDrift: number;
}
type P = [number, number];

function pins(inner: MeshSpec, outer: MeshSpec) {
  const found: { vertex: number; tri: [number, number, number]; bary: [number, number, number] }[] =
    [];
  inner.vertices.forEach((p, vertex) => {
    for (let t = 0; t < outer.triangles.length; t += 3) {
      const tri: [number, number, number] = [
          outer.triangles[t]!,
          outer.triangles[t + 1]!,
          outer.triangles[t + 2]!,
        ],
        [a, b, c] = tri.map((i) => outer.vertices[i]!) as [P, P, P],
        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det,
        l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det,
        l3 = 1 - l1 - l2;
      if (Math.min(l1, l2, l3) >= -1e-9) {
        found.push({ vertex, tri, bary: [l1, l2, l3] });
        break;
      }
    }
  });
  return found;
}
/** Distance from p to the closed polygon through `ring`. */
function toRing(p: P, ring: P[]): number {
  let best = Infinity;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy,
      t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  });
  return best;
}
export interface OverlapOptions {
  /**
   * The mesh drawn on top (ADR-025). Only the visible seam counts: the top mesh's outline over
   * the other one, i.e. the top's hull vertices and the lower mesh's vertices within `band` of
   * that outline. Overlap deep under the top layer cannot show.
   */
  top?: "a" | "b";
  band?: number;
}
/**
 * Seam check for two attachments that overlap at setup (limb segments at a joint, a glow over its
 * part). Every vertex of one mesh inside the other is pinned to that surface point; the drift is
 * how far the two posed copies of the same point separate. Rigid single-bone segments drift by
 * about distance-from-joint x bend angle; shared positional weights keep the drift second order.
 */
export function measureOverlapDrift(
  a: PosedMesh,
  b: PosedMesh,
  options: OverlapOptions = {},
): OverlapDrift {
  for (const m of [a, b])
    if (
      m.posed.length !== m.mesh.vertices.length ||
      m.posed.some((p) => p.length !== 2 || !p.every(Number.isFinite))
    )
      failStage("weights", "DEFORMATION_INPUT", "Finite posed vertices for every mesh vertex");
  const top = options.top === undefined ? undefined : options.top === "a" ? a : b;
  const outline = top?.mesh.hull.map((i) => top.mesh.vertices[i]!) ?? [],
    hullSet = new Set(top?.mesh.hull ?? []),
    band = options.band ?? 0;
  const drifts: number[] = [];
  for (const [inner, outer] of [
    [a, b],
    [b, a],
  ] as const)
    for (const { vertex, tri, bary } of pins(inner.mesh, outer.mesh)) {
      if (top) {
        const p = inner.mesh.vertices[vertex]!;
        if (inner === top ? !hullSet.has(vertex) : toRing(p, outline) > band) continue;
      }
      const q = [0, 1].map((d) => tri.reduce((s, i, k) => s + outer.posed[i]![d]! * bary[k]!, 0));
      drifts.push(Math.hypot(inner.posed[vertex]![0] - q[0]!, inner.posed[vertex]![1] - q[1]!));
    }
  return {
    points: drifts.length,
    maxDrift: drifts.length ? Math.max(...drifts) : 0,
    meanDrift: drifts.length ? drifts.reduce((s, d) => s + d, 0) / drifts.length : 0,
  };
}
