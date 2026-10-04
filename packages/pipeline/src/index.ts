import { Value } from "@sinclair/typebox/value";
import { AssetSpecSchema, BuildJobSchema, type AssetSpec, type BuildJob } from "@autospine/schemas";
import { decodeAlphaMask } from "@autospine/assets";
import { generateMeshWithDiagnostics, prepareAlphaForMesh } from "@autospine/mesh";
import { evaluateRig, failStage, generateChainRig, transformPoint } from "@autospine/rig";
import {
  skinVertices,
  solveDistanceWeights,
  solveWeightsV1,
  type WeightOptions,
} from "@autospine/weights";
import { generateWave, rotationsAt } from "@autospine/motion";

type Point = [number, number];
const area = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function buildChainWave(
  asset: AssetSpec,
  job: BuildJob,
  options: { weights?: WeightOptions } = {},
) {
  if (
    !Value.Check(BuildJobSchema, job) ||
    !Value.Check(AssetSpecSchema, asset) ||
    asset.parts.length !== 1 ||
    !asset.parts[0]!.alphaMask
  )
    failStage(
      "build",
      "BUILD_INPUT",
      "Valid chain-wave job and one alpha-masked asset part required",
    );
  const part = asset.parts[0]!,
    mask = part.alphaMask!;
  if (mask.width * mask.height > 4_000_000)
    failStage(
      "build",
      "BUILD_PIXEL_BUDGET",
      "Starter chain-wave is limited to four million image pixels",
    );
  const prepared = prepareAlphaForMesh(
    decodeAlphaMask(mask),
    mask.width,
    mask.height,
    job.cleanupFraction,
  );
  const { mesh, diagnostics: meshDiagnostics } = generateMeshWithDiagnostics(part, prepared.alpha, {
    intent: "chain",
  });
  if (mesh.vertices.length * (Math.ceil(job.wave.duration * job.wave.fps) + 1) > 250_000)
    failStage(
      "build",
      "BUILD_FRAME_BUDGET",
      "Starter preview is limited to 250000 sampled vertex positions",
    );
  const rig = generateChainRig({
    id: job.id + "-rig",
    name: job.name,
    start: job.chain.start,
    end: job.chain.end,
    boneCount: job.chain.boneCount,
  });
  const weights = options.weights
      ? solveWeightsV1(mesh, rig, options.weights)
      : solveDistanceWeights(mesh, rig),
    animation = generateWave(rig, job.wave);
  const frames = animation.rotationTimelines![0]!.keys.map((k) => {
    const rotations = rotationsAt(animation, k.time),
      posed = evaluateRig(rig, rotations);
    return {
      time: k.time,
      vertices: skinVertices(mesh, rig, weights, rotations),
      bones: rig.bones.map((b) => ({
        id: b.id,
        head: transformPoint(posed.get(b.id)!, [0, 0]),
        tip: transformPoint(posed.get(b.id)!, [b.length, 0]),
      })),
    };
  });
  let inversionSamples = 0,
    minAreaRatio = Infinity,
    maxEdgeStretch = 0;
  for (const frame of frames)
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const ids = mesh.triangles.slice(i, i + 3),
        [a, b, c] = ids.map((index) => mesh.vertices[index]!) as [Point, Point, Point];
      const [pa, pb, pc] = ids.map((index) => frame.vertices[index]!) as [Point, Point, Point];
      const ratio = area(pa, pb, pc) / area(a, b, c);
      if (ratio <= 0) inversionSamples++;
      minAreaRatio = Math.min(minAreaRatio, ratio);
      for (let edge = 0; edge < 3; edge++) {
        const left = ids[edge]!,
          right = ids[(edge + 1) % 3]!,
          p = frame.vertices[left]!,
          q = frame.vertices[right]!,
          u = mesh.vertices[left]!,
          v = mesh.vertices[right]!;
        maxEdgeStretch = Math.max(
          maxEdgeStretch,
          Math.hypot(p[0] - q[0], p[1] - q[1]) / Math.hypot(u[0] - v[0], u[1] - v[1]),
        );
      }
    }
  const first = frames[0]!.vertices,
    last = frames.at(-1)!.vertices;
  const loopMaxDelta = first.reduce(
    (max, p, i) => Math.max(max, Math.hypot(p[0] - last[i]![0], p[1] - last[i]![1])),
    0,
  );
  return {
    asset,
    mesh,
    rig,
    weights,
    animation,
    frames,
    diagnostics: {
      profile: "chain-wave",
      referenceConditioned: false,
      explicitChainInput: true,
      qualityAccepted: false,
      mesh: meshDiagnostics,
      cleanup: {
        discardedPixels: prepared.discardedPixels,
        pinchFilledPixels: prepared.pinchFilledPixels,
        holeFilledPixels: prepared.holeFilledPixels,
      },
      deformation: {
        sampleCount: frames.length,
        inversionSamples,
        minAreaRatio,
        maxEdgeStretch,
        loopMaxDelta,
      },
    },
  };
}
