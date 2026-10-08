import type { MeshSpec, RigSpec, WeightSpec } from "@autospine/schemas";
import { evaluateRig, failStage, transformPoint } from "@autospine/rig";
import { validateWeights } from "./index.js";

/**
 * Explicit connected chain, with a bounded blend band at each joint; no anatomical inference.
 * Weights are a function of position along the chain, so every image of one limb solved with the
 * same chain and widths gets identical weights where the images overlap and stays joined at bends.
 * `blendWidth` is one width for every joint, or one width per joint (each at most half of both
 * adjacent segments), so a long elbow band need not shrink to fit a short wrist segment.
 */
export function solveChainWeights(
  mesh: MeshSpec,
  rig: RigSpec,
  boneIds: string[],
  blendWidth: number | number[],
): WeightSpec {
  const frames = evaluateRig(rig),
    byId = new Map(rig.bones.map((b) => [b.id, b])),
    perJoint = Array.isArray(blendWidth),
    widths = perJoint ? blendWidth : Array(Math.max(0, boneIds.length - 1)).fill(blendWidth);
  if (
    !boneIds.length ||
    boneIds.length > 64 ||
    new Set(boneIds).size !== boneIds.length ||
    (perJoint ? widths.length !== boneIds.length - 1 : !Number.isFinite(blendWidth)) ||
    widths.some((w) => !Number.isFinite(w) || w <= 0) ||
    (!perJoint && (blendWidth as number) <= 0)
  )
    failStage(
      "weights",
      "WEIGHT_CHAIN",
      "Unique explicit chain and positive finite blend width (one per joint) required",
    );
  const segments = boneIds.map((id, index) => {
    const bone = byId.get(id);
    if (!bone || bone.length <= 0 || (index && bone.parentId !== boneIds[index - 1]))
      failStage("weights", "WEIGHT_CHAIN", "Positive-length parent-child chain required");
    const a = transformPoint(frames.get(id)!, [0, 0]),
      b = transformPoint(frames.get(id)!, [bone.length, 0]);
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const touching = perJoint
      ? [widths[index - 1], widths[index]].filter((w) => w !== undefined)
      : [blendWidth as number];
    if (touching.some((w) => w > span / 2))
      failStage("weights", "WEIGHT_CHAIN", "Blend band exceeds half a segment");
    return { id, a, b, span };
  });
  for (let i = 1; i < segments.length; i++)
    if (
      Math.hypot(
        segments[i]!.a[0] - segments[i - 1]!.b[0],
        segments[i]!.a[1] - segments[i - 1]!.b[1],
      ) > 1e-7
    )
      failStage("weights", "WEIGHT_CHAIN", "Chain joints must meet in the setup pose");
  // Joint planes: each joint splits along the bisector of its two bones and a vertex blends by its
  // signed distance to that plane. The field is linear in position, so it stays continuous on the
  // inner side of a bent joint, where nearest-segment projection would jump between bones. For a
  // straight chain this equals blending by distance along the chain.
  const unit = (v: [number, number]): [number, number] => {
    const l = Math.hypot(v[0], v[1]);
    return [v[0] / l, v[1] / l];
  };
  const joints = segments.slice(1).map((s, i) => {
    const before = segments[i]!,
      d1 = unit([before.b[0] - before.a[0], before.b[1] - before.a[1]]),
      d2 = unit([s.b[0] - s.a[0], s.b[1] - s.a[1]]),
      sum: [number, number] = [d1[0] + d2[0], d1[1] + d2[1]];
    if (Math.hypot(...sum) < 1e-6)
      failStage("weights", "WEIGHT_CHAIN", "Chain folds back on itself at a joint");
    return { at: s.a, normal: unit(sum), width: widths[i]! };
  });
  const result: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: mesh.id + "-chain-weights",
    meshId: mesh.id,
    rigId: rig.id,
    vertices: mesh.vertices.map((p, vertexIndex) => {
      let owner = 0;
      for (const [i, j] of joints.entries()) {
        const side = (p[0] - j.at[0]) * j.normal[0] + (p[1] - j.at[1]) * j.normal[1];
        if (side >= j.width) {
          owner = i + 1;
          continue;
        }
        if (side > -j.width) {
          const u = (side + j.width) / (2 * j.width),
            w = u * u * (3 - 2 * u);
          return {
            vertexIndex,
            influences: [
              { boneId: boneIds[i]!, weight: 1 - w },
              { boneId: boneIds[i + 1]!, weight: w },
            ],
          };
        }
        break;
      }
      return { vertexIndex, influences: [{ boneId: boneIds[owner]!, weight: 1 }] };
    }),
  };
  validateWeights(mesh, rig, result);
  return result;
}
