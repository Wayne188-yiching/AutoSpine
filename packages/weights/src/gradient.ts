import type { MeshSpec, RigSpec, WeightSpec } from "@autospine/schemas";
import { evaluateRig, failStage, transformPoint } from "@autospine/rig";
import { validateWeights } from "./index.js";

/**
 * Linear two-bone gradient between two bone origins (eyelid top and bottom edge, jaw, flap): the
 * `to` weight is the clamped projection onto the from -> to axis. Linear is the fold-safe profile:
 * pulling `to` back toward `from` by a fraction k of the span squashes the band uniformly to 1 - k
 * and cannot fold before a full collapse, whereas a smoothstep profile (slope 1.5) folds once k
 * passes 2/3.
 */
export function solveGradientWeights(
  mesh: MeshSpec,
  rig: RigSpec,
  from: string,
  to: string,
): WeightSpec {
  const frames = evaluateRig(rig);
  if (from === to || !frames.has(from) || !frames.has(to))
    failStage("weights", "GRADIENT_BONES", "Two distinct existing bones required");
  const a = transformPoint(frames.get(from)!, [0, 0]),
    b = transformPoint(frames.get(to)!, [0, 0]),
    axis: [number, number] = [b[0] - a[0], b[1] - a[1]],
    length2 = axis[0] * axis[0] + axis[1] * axis[1];
  if (!(length2 > 1e-12))
    failStage("weights", "GRADIENT_BONES", "Gradient bones need distinct setup origins");
  const result: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: mesh.id + "-gradient-weights",
    meshId: mesh.id,
    rigId: rig.id,
    vertices: mesh.vertices.map((p, vertexIndex) => {
      const t = Math.min(
        1,
        Math.max(0, ((p[0] - a[0]) * axis[0] + (p[1] - a[1]) * axis[1]) / length2),
      );
      return {
        vertexIndex,
        influences: [
          { boneId: from, weight: 1 - t },
          { boneId: to, weight: t },
        ].filter((i) => i.weight > 0),
      };
    }),
  };
  validateWeights(mesh, rig, result);
  return result;
}
