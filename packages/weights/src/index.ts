import { Value } from "@sinclair/typebox/value";
import {
  MeshSpecSchema,
  RigSpecSchema,
  WeightSpecSchema,
  type MeshSpec,
  type RigSpec,
  type WeightSpec,
} from "@autospine/schemas";
import { evaluateRig, failStage, inverseAffine, transformPoint } from "@autospine/rig";
export * from "./deformation.js";

function checkInput(mesh: MeshSpec, rig: RigSpec) {
  if (!Value.Check(MeshSpecSchema, mesh) || !Value.Check(RigSpecSchema, rig))
    failStage("weights", "WEIGHT_INPUT", "Valid MeshSpec and RigSpec required");
}
export function validateWeights(mesh: MeshSpec, rig: RigSpec, weights: WeightSpec): void {
  checkInput(mesh, rig);
  if (
    !Value.Check(WeightSpecSchema, weights) ||
    weights.meshId !== mesh.id ||
    weights.rigId !== rig.id
  )
    failStage("weights", "WEIGHT_REFERENCE", "Weight schema or mesh/rig reference mismatch");
  const ids = new Set(rig.bones.map((b) => b.id)),
    seen = new Set<number>();
  for (const v of weights.vertices) {
    if (
      v.vertexIndex >= mesh.vertices.length ||
      v.influences.length > 4 ||
      seen.has(v.vertexIndex) ||
      new Set(v.influences.map((i) => i.boneId)).size !== v.influences.length ||
      v.influences.some((i) => !ids.has(i.boneId) || !Number.isFinite(i.weight)) ||
      Math.abs(v.influences.reduce((s, i) => s + i.weight, 0) - 1) > 1e-9
    )
      failStage(
        "weights",
        "WEIGHT_VERTEX",
        "Unique complete normalized vertex influences required",
      );
    seen.add(v.vertexIndex);
  }
  if (seen.size !== mesh.vertices.length)
    failStage("weights", "WEIGHT_COVERAGE", "Every mesh vertex must be weighted exactly once");
}
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    den = dx * dx + dy * dy,
    t = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** Starter inverse-distance solver, at most two positive-length influences; not anatomical. */
export function solveDistanceWeights(mesh: MeshSpec, rig: RigSpec): WeightSpec {
  checkInput(mesh, rig);
  const frames = evaluateRig(rig),
    bones = rig.bones.filter((b) => b.length > 0);
  if (!bones.length)
    failStage("weights", "WEIGHT_NO_BONES", "At least one positive-length bone required");
  const weights: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: mesh.id + "-weights",
    meshId: mesh.id,
    rigId: rig.id,
    vertices: mesh.vertices.map((p, vertexIndex) => {
      const nearest = bones
        .map((b, index) => ({
          id: b.id,
          index,
          distance: segmentDistance(
            p,
            transformPoint(frames.get(b.id)!, [0, 0]),
            transformPoint(frames.get(b.id)!, [b.length, 0]),
          ),
        }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, 2);
      const raw = nearest.map((b) => 1 / (1 + b.distance) ** 2),
        sum = raw.reduce((s, w) => s + w, 0);
      return {
        vertexIndex,
        influences: nearest.map((b, i) => ({ boneId: b.id, weight: raw[i]! / sum })),
      };
    }),
  };
  validateWeights(mesh, rig, weights);
  return weights;
}

export interface WeightOptions {
  maxInfluences?: number;
  smoothingPasses?: number;
  smoothingStrength?: number;
  candidateRadius?: number;
}
/** General v1 solver. Radius misses fall back to the nearest deform bone, never an orphan. */
export function solveWeightsV1(
  mesh: MeshSpec,
  rig: RigSpec,
  options: WeightOptions = {},
): WeightSpec {
  checkInput(mesh, rig);
  const {
    maxInfluences = 4,
    smoothingPasses = 1,
    smoothingStrength = 0.25,
    candidateRadius = Number.MAX_VALUE,
  } = options;
  if (
    !Number.isInteger(maxInfluences) ||
    maxInfluences < 1 ||
    maxInfluences > 4 ||
    !Number.isInteger(smoothingPasses) ||
    smoothingPasses < 0 ||
    smoothingPasses > 8 ||
    !Number.isFinite(smoothingStrength) ||
    smoothingStrength < 0 ||
    smoothingStrength > 1 ||
    !Number.isFinite(candidateRadius) ||
    candidateRadius < 0 ||
    mesh.vertices.length > 250_000 ||
    rig.bones.length > 256
  )
    failStage(
      "weights",
      "WEIGHT_OPTIONS",
      "Finite bounded weight options and input sizes required",
    );
  const frames = evaluateRig(rig);
  const bones = rig.bones.filter((b) => b.length > 0);
  if (!bones.length) failStage("weights", "WEIGHT_NO_BONES", "At least one deform bone required");
  const adjacency = mesh.vertices.map(() => new Set<number>());
  if (mesh.triangles.length % 3)
    failStage("weights", "WEIGHT_TOPOLOGY", "Complete triangles required");
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const triangle = mesh.triangles.slice(i, i + 3);
    if (triangle.some((v) => v >= mesh.vertices.length) || new Set(triangle).size !== 3)
      failStage("weights", "WEIGHT_TOPOLOGY", "Valid unique triangle indices required");
    for (const a of triangle) for (const b of triangle) if (a !== b) adjacency[a]!.add(b);
  }
  function prune(values: Map<string, number>): Map<string, number> {
    const ranked = [...values]
      .filter(([, w]) => w > 0)
      .sort(
        (a, b) =>
          b[1] - a[1] ||
          bones.findIndex((v) => v.id === a[0]) - bones.findIndex((v) => v.id === b[0]),
      )
      .slice(0, maxInfluences);
    const sum = ranked.reduce((s, [, w]) => s + w, 0);
    if (!Number.isFinite(sum) || sum <= 0)
      failStage("weights", "WEIGHT_NUMERIC", "Positive finite influences required");
    return new Map(ranked.map(([id, w]) => [id, w / sum]));
  }
  let values = mesh.vertices.map((p) => {
    const ranked = bones
      .map((b, index) => ({
        id: b.id,
        index,
        distance: segmentDistance(
          p,
          transformPoint(frames.get(b.id)!, [0, 0]),
          transformPoint(frames.get(b.id)!, [b.length, 0]),
        ),
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    if (ranked.some((b) => !Number.isFinite(b.distance)))
      failStage("weights", "WEIGHT_NUMERIC", "Distance calculation overflow");
    const candidates = ranked.filter((b) => b.distance <= candidateRadius).slice(0, maxInfluences);
    if (!candidates.length) candidates.push(ranked[0]!);
    const nearest = candidates[0]!.distance;
    return prune(new Map(candidates.map((b) => [b.id, ((1 + nearest) / (1 + b.distance)) ** 2])));
  });
  for (let pass = 0; pass < smoothingPasses; pass++) {
    const previous = values;
    values = previous.map((own, i) => {
      const neighbors = [...adjacency[i]!];
      if (!neighbors.length) return own;
      const average = new Map<string, number>();
      for (const [id, w] of own) average.set(id, w * (1 - smoothingStrength));
      for (const j of neighbors)
        for (const [id, w] of previous[j]!)
          average.set(id, (average.get(id) ?? 0) + (w * smoothingStrength) / neighbors.length);
      return prune(average);
    });
  }
  const result: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: mesh.id + "-weights",
    meshId: mesh.id,
    rigId: rig.id,
    vertices: values.map((v, vertexIndex) => ({
      vertexIndex,
      influences: [...v].map(([boneId, weight]) => ({ boneId, weight })),
    })),
  };
  validateWeights(mesh, rig, result);
  return result;
}
export function skinVertices(
  mesh: MeshSpec,
  rig: RigSpec,
  weights: WeightSpec,
  rotations: Readonly<Record<string, number>> = {},
): [number, number][] {
  validateWeights(mesh, rig, weights);
  const bind = evaluateRig(rig),
    posed = evaluateRig(rig, rotations),
    local = new Map([...bind].map(([id, m]) => [id, inverseAffine(m)]));
  const output = mesh.vertices.map((): [number, number] => [0, 0]);
  for (const v of weights.vertices)
    for (const influence of v.influences) {
      const p = transformPoint(
        posed.get(influence.boneId)!,
        transformPoint(local.get(influence.boneId)!, mesh.vertices[v.vertexIndex]!),
      );
      output[v.vertexIndex]![0] += p[0] * influence.weight;
      output[v.vertexIndex]![1] += p[1] * influence.weight;
    }
  if (output.some((p) => !p.every(Number.isFinite)))
    failStage("weights", "WEIGHT_NUMERIC", "Skinned vertex is nonfinite");
  return output;
}
