import type { MeshSpec, RigSpec, WeightSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { validateWeights } from "./index.js";

export interface WeightSource {
  mesh: MeshSpec;
  weights: WeightSpec;
}
type P = [number, number];

/** Closest point of triangle abc to p as barycentric weights (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: P, a: P, b: P, c: P): [number, number, number] {
  const dot = (u: P, v: P) => u[0] * v[0] + u[1] * v[1],
    sub = (u: P, v: P): P => [u[0] - v[0], u[1] - v[1]];
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a),
    d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc),
    v = vb * denom,
    w = vc * denom;
  return [1 - v - w, v, w];
}

/**
 * Closest-point weight transfer for attachments that ride another surface (glows, outlines,
 * shadows). Each target vertex takes the barycentric blend of the nearest point on any source
 * triangle; vertices outside every source take the nearest edge point. All meshes share the rig's
 * world space. Under bone translation the target follows the source surface exactly; under
 * rotation the mismatch is second order in source triangle size.
 */
export function transferWeights(
  target: MeshSpec,
  rig: RigSpec,
  sources: WeightSource[],
  maxInfluences = 4,
): WeightSpec {
  if (!sources.length || !Number.isInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4)
    failStage("weights", "TRANSFER_INPUT", "At least one source and 1..4 influences required");
  const work =
    target.vertices.length * sources.reduce((n, s) => n + s.mesh.triangles.length / 3, 0);
  if (work > 20_000_000)
    failStage("weights", "TRANSFER_SIZE", "Target vertices x source triangles exceeds 20M");
  const lookups = sources.map((s) => {
    validateWeights(s.mesh, rig, s.weights);
    const byVertex = new Map(s.weights.vertices.map((v) => [v.vertexIndex, v.influences] as const));
    return { mesh: s.mesh, byVertex };
  });
  const result: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: target.id + "-transferred-weights",
    meshId: target.id,
    rigId: rig.id,
    vertices: target.vertices.map((p, vertexIndex) => {
      let best = Infinity,
        blend = new Map<string, number>();
      for (const { mesh, byVertex } of lookups)
        for (let t = 0; t < mesh.triangles.length; t += 3) {
          const ids = [mesh.triangles[t]!, mesh.triangles[t + 1]!, mesh.triangles[t + 2]!],
            corners = ids.map((i) => mesh.vertices[i]!) as [P, P, P],
            bary = closestOnTriangle(p, ...corners);
          if (!bary.every(Number.isFinite)) continue; // degenerate triangle
          const q = corners.reduce<P>(
              (s, c, k) => [s[0] + c[0] * bary[k]!, s[1] + c[1] * bary[k]!],
              [0, 0],
            ),
            distance = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (distance >= best) continue;
          best = distance;
          blend = new Map();
          ids.forEach((i, k) => {
            for (const influence of byVertex.get(i)!)
              blend.set(
                influence.boneId,
                (blend.get(influence.boneId) ?? 0) + influence.weight * bary[k]!,
              );
          });
        }
      const kept = [...blend]
          .filter(([, w]) => w > 1e-9)
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .slice(0, maxInfluences),
        sum = kept.reduce((s, [, w]) => s + w, 0);
      if (!kept.length || !Number.isFinite(sum))
        failStage("weights", "TRANSFER_NUMERIC", "No usable source triangle for a target vertex");
      return {
        vertexIndex,
        influences: kept.map(([boneId, weight]) => ({ boneId, weight: weight / sum })),
      };
    }),
  };
  validateWeights(target, rig, result);
  return result;
}
