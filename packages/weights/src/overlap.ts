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
/**
 * Seam check for two attachments that overlap at setup (limb segments at a joint, a glow over its
 * part). Every vertex of one mesh inside the other is pinned to that surface point; the drift is
 * how far the two posed copies of the same point separate. Rigid single-bone segments drift by
 * about distance-from-joint x bend angle; shared positional weights keep the drift second order.
 */
export function measureOverlapDrift(a: PosedMesh, b: PosedMesh): OverlapDrift {
  for (const m of [a, b])
    if (
      m.posed.length !== m.mesh.vertices.length ||
      m.posed.some((p) => p.length !== 2 || !p.every(Number.isFinite))
    )
      failStage("weights", "DEFORMATION_INPUT", "Finite posed vertices for every mesh vertex");
  const drifts: number[] = [];
  for (const [inner, outer] of [
    [a, b],
    [b, a],
  ] as const)
    for (const { vertex, tri, bary } of pins(inner.mesh, outer.mesh)) {
      const q = [0, 1].map((d) => tri.reduce((s, i, k) => s + outer.posed[i]![d]! * bary[k]!, 0));
      drifts.push(Math.hypot(inner.posed[vertex]![0] - q[0]!, inner.posed[vertex]![1] - q[1]!));
    }
  return {
    points: drifts.length,
    maxDrift: drifts.length ? Math.max(...drifts) : 0,
    meanDrift: drifts.length ? drifts.reduce((s, d) => s + d, 0) / drifts.length : 0,
  };
}
