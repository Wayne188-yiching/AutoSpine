import type {
  AssetSpec,
  CharacterPlan,
  MeshPlan,
  MeshSpec,
  RigSpec,
  WeightSpec,
} from "@autospine/schemas";
import { encodeAlphaMask } from "@autospine/assets";
import {
  generateFeatureMesh,
  generateMesh,
  generateSurfaceMesh,
  prepareAlphaForMesh,
} from "@autospine/mesh";
import { failStage } from "@autospine/rig";
import {
  domeValue,
  solveChainWeights,
  solveDomeWeights,
  solveGradientWeights,
  solveWeightsV1,
  transferWeights,
  type DomePin,
} from "@autospine/weights";
import { apply, type CharacterPart, type Vec } from "./geometry.js";
import type { PartIndex } from "./joints.js";
import type { PlannedRig } from "./rig.js";

export interface MeshAsset {
  asset: AssetSpec;
  mesh: MeshSpec;
  weights: WeightSpec;
  rings?: number[][];
}
type Mesh2D = {
  vertices: [number, number][];
  triangles: number[];
  hull: number[];
  manualEdges?: [number, number][];
};

const safeId = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
/**
 * Artist vertex budget (ADR-024), from 423 artist character meshes (HorseYearFish, mummy cat):
 * s = sqrt(image width x height) px; hull round(sqrt s) in 6..40; interior 0 below s 100, else
 * round(s / 80).
 */
export function artistBudget(width: number, height: number): { hull: number; interior: number } {
  const s = Math.sqrt(width * height);
  return {
    hull: Math.min(40, Math.max(6, Math.round(Math.sqrt(s)))),
    interior: s < 100 ? 0 : Math.round(s / 80),
  };
}
const collapsed = (p: CharacterPart) =>
  Math.abs(p.affine[0] * p.affine[3] - p.affine[1] * p.affine[2]) < 1e-9;
export function assetFor(p: CharacterPart, id: string, alpha: Uint8Array = p.alpha): AssetSpec {
  return {
    schemaVersion: "0.1",
    kind: "asset",
    id: "asset-" + id,
    name: p.slot,
    source: { type: "png-parts", path: p.path + ".png" },
    width: p.width,
    height: p.height,
    parts: [
      {
        id: "part-" + id,
        name: p.slot,
        sourcePath: p.path + ".png",
        bounds: { x: 0, y: 0, width: p.width, height: p.height },
        drawOrder: p.order,
        alphaMask: encodeAlphaMask(p.width, p.height, alpha),
      },
    ],
  } as AssetSpec;
}
/** Image-local mesh to world mesh: vertices through the placement, uvs normalised to the image. */
function toWorldMesh(m: Mesh2D, p: CharacterPart, id: string): MeshSpec {
  // A mirrored placement (negative determinant, e.g. a flipped bough) reverses the winding.
  const mirrored = p.affine[0] * p.affine[3] - p.affine[1] * p.affine[2] < 0;
  return {
    schemaVersion: "0.1",
    kind: "mesh",
    id: "mesh-" + id,
    name: p.slot,
    sourcePartId: "part-" + id,
    vertices: m.vertices.map(
      (v) => apply(p.affine, v).map((x) => +x.toFixed(3)) as [number, number],
    ),
    uvs: m.vertices.map(
      ([x, y]) => [+(x / p.width).toFixed(6), +(y / p.height).toFixed(6)] as [number, number],
    ),
    triangles: mirrored
      ? m.triangles.map((_, i, t) => t[i - (i % 3) + [0, 2, 1][i % 3]!]!)
      : m.triangles,
    hull: mirrored ? [...m.hull].reverse() : m.hull,
    ...(m.manualEdges ? { manualEdges: m.manualEdges } : {}),
  } as MeshSpec;
}
export const rigidWeights = (mesh: MeshSpec, rig: RigSpec, boneId: string): WeightSpec => ({
  schemaVersion: "0.1",
  kind: "weights",
  id: "w-" + mesh.id,
  meshId: mesh.id,
  rigId: rig.id,
  vertices: mesh.vertices.map((_, i) => ({ vertexIndex: i, influences: [{ boneId, weight: 1 }] })),
});

export interface PlannedAttachments {
  meshes: Map<string, MeshAsset>;
  /** Follow mix per face follower bone (dome value at the bone origin). */
  faceMix: Record<string, number>;
  evidence: Record<string, unknown>;
}

/** Builds every planned mesh and its weights, in plan order (transfer sources must come first). */
export function planAttachments(
  plan: CharacterPlan,
  index: PartIndex,
  rigged: PlannedRig,
  regionBone: (slot: string) => string | undefined,
): PlannedAttachments {
  const { rig } = rigged;
  const evidence: Record<string, unknown> = {};
  const meshes = new Map<string, MeshAsset>();
  const faceMix: Record<string, number> = {};
  const boneLength = (id: string) => {
    const b = rig.bones.find((x) => x.id === id);
    if (!b) failStage("weights", "PLAN_BONE", `Weights reference unknown bone ${id}`);
    return b.length;
  };
  const shape = (
    spec: MeshPlan["mesh"],
    p: CharacterPart,
  ): { asset: AssetSpec; mesh: MeshSpec; rings?: number[][] } => {
    const id = safeId(p.key === p.slot ? p.slot : p.key);
    switch (spec.type) {
      case "feature": {
        const asset = assetFor(p, id);
        const budget = spec.density === "artist" ? artistBudget(p.width, p.height) : undefined;
        const hullVertices = spec.hullVertices ?? budget?.hull,
          interiorVertices = spec.interiorVertices ?? budget?.interior;
        const options = {
          ...(spec.spacing !== undefined ? { spacing: spec.spacing } : {}),
          ...(spec.edgeLength !== undefined ? { edgeLength: spec.edgeLength } : {}),
          ...(spec.minHoleFraction !== undefined ? { minHoleFraction: spec.minHoleFraction } : {}),
          ...(hullVertices !== undefined ? { hullVertices } : {}),
          ...(interiorVertices !== undefined ? { interiorVertices } : {}),
        };
        const r = generateFeatureMesh(asset.parts[0]!, p.alpha, options);
        return { asset, mesh: toWorldMesh(r.mesh as Mesh2D, p, id), rings: r.rings };
      }
      case "contour": {
        // Engine alpha preparation (primary component, pinch and hole repair) before outline meshing.
        const soft = Uint8Array.from(p.alpha, (v) => (v > 8 ? v : 0));
        const budgets = spec.cleanup ?? [0.03, 0.1, 0.25];
        let alpha: Uint8Array | undefined;
        for (const [i, frac] of budgets.entries()) {
          try {
            const r = prepareAlphaForMesh(soft, p.width, p.height, frac);
            evidence[`${p.key}:alphaPrep`] = {
              maxChangedFraction: frac,
              components: r.componentCount,
              discarded: r.discardedPixels,
              pinchFilled: r.pinchFilledPixels,
              holesFilled: r.holeFilledPixels,
            };
            alpha = r.alpha;
            break;
          } catch (error) {
            if (i === budgets.length - 1) throw error;
          }
        }
        const asset = assetFor(p, id, alpha);
        const mesh = generateMesh(asset.parts[0]!, alpha!, { intent: spec.intent ?? "unknown" });
        return { asset, mesh: toWorldMesh(mesh as unknown as Mesh2D, p, id) };
      }
      case "surface": {
        const asset = assetFor(p, id);
        const mesh = generateSurfaceMesh(asset.parts[0]!, spec.cols, spec.rows);
        return { asset, mesh: toWorldMesh(mesh as unknown as Mesh2D, p, id) };
      }
      case "quad":
        return { asset: assetFor(p, id), mesh: toWorldMesh(quad(p), p, id) };
    }
  };
  for (const m of plan.meshes ?? []) {
    const p = index.part(m.part);
    if (meshes.has(m.part))
      failStage("mesh", "PLAN_MESH_DUPLICATE", `Part ${m.part} has two mesh plans`);
    const built = shape(m.mesh, p);
    let weights: WeightSpec;
    const w = m.weights;
    switch (w.type) {
      case "chain": {
        const ids = w.bones ?? (w.chain ? rigged.chains[w.chain] : undefined);
        if (!ids)
          failStage(
            "weights",
            "PLAN_CHAIN",
            `Chain weights of ${m.part} need bones or a planned chain`,
          );
        const blend = w.blend ?? 0.4;
        const widths = ids
          .slice(1)
          .map((id, i) => +(blend * Math.min(boneLength(ids[i]!), boneLength(id))).toFixed(2));
        weights = solveChainWeights(built.mesh, rig, ids, ids.length > 1 ? widths : 1);
        break;
      }
      case "gradient":
        weights = solveGradientWeights(built.mesh, rig, w.from, w.to);
        break;
      case "rigid":
        weights = rigidWeights(built.mesh, rig, w.bone);
        break;
      case "nearest":
        weights = solveWeightsV1(built.mesh, rig, {
          bones: w.bones,
          maxInfluences: w.maxInfluences ?? 4,
          smoothingPasses: w.smoothing ?? 2,
        });
        break;
      case "transfer": {
        const sources = w.sources.map((name) => {
          const s = meshes.get(name);
          if (!s)
            failStage(
              "weights",
              "PLAN_TRANSFER_SOURCE",
              `Transfer source ${name} must be planned before ${m.part}`,
            );
          return { mesh: s.mesh, weights: s.weights };
        });
        for (const proxy of w.proxies ?? []) {
          // A rigid region stands in through an unexported quad of its image, rigid to its bone.
          const pp = index.part(proxy.part),
            mesh = toWorldMesh(quad(pp), pp, safeId(pp.slot));
          sources.push({ mesh, weights: rigidWeights(mesh, rig, proxy.bone) });
        }
        weights = transferWeights(built.mesh, rig, sources, w.maxInfluences ?? 4);
        break;
      }
      case "dome": {
        const face = plan.face,
          dome = rigged.dome;
        if (!face || !dome)
          failStage("weights", "PLAN_FACE", `Dome weights of ${m.part} need a face section`);
        if (!built.rings)
          failStage("weights", "PLAN_DOME_MESH", `Dome weights of ${m.part} need a feature mesh`);
        const bones = {
          base: face.base,
          control: face.control,
          ...(face.counter ? { counter: face.counter } : {}),
        };
        const rings = built.rings.map((r) => r.map((i) => built.mesh.vertices[i]!));
        const ringCentre = (r: [number, number][]): Vec =>
          r.reduce<Vec>((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
        const xs = index.opaque(face.head).map((q) => q[0]);
        const headWidth = Math.max(...xs) - Math.min(...xs);
        const pins: DomePin[] = rings.map((r) => ({
          polygon: r,
          value: domeValue(dome.field, ringCentre(r), []),
          margin: +((face.pinMargin ?? 0.12) * headWidth).toFixed(2),
        }));
        weights = solveDomeWeights(built.mesh, rig, dome.field, bones, pins);
        for (const id of face.followers) {
          const frame = rigged.world.get(id);
          if (!frame)
            failStage("rig", "PLAN_FACE_FOLLOWER", `Face follower ${id} is not a planned bone`);
          faceMix[id] = +domeValue(dome.field, frame.o, pins).toFixed(4);
        }
        // 2.5D depth layers: the mix scales with depth against the measured dome peak.
        for (const layer of face.layers ?? []) {
          if (!rigged.world.has(layer.bone))
            failStage("rig", "PLAN_FACE_LAYER", `Face layer ${layer.bone} is not a planned bone`);
          if (layer.bone in faceMix)
            failStage("rig", "PLAN_FACE_LAYER", `Face layer ${layer.bone} is also a follower`);
          faceMix[layer.bone] = +Math.max(-1, Math.min(1, layer.depth * dome.field.peak)).toFixed(
            4,
          );
        }
        evidence.faceRings = rings.length;
        evidence.facePins = pins.map((p) => ({
          value: p.value,
          margin: p.margin,
          points: p.polygon.length,
        }));
        break;
      }
    }
    meshes.set(m.part, { ...built, weights });
  }
  // Sheared placements cannot be regions: rigid quads on the region's bone.
  for (const p of index.parts.values()) {
    if (!p.sheared || meshes.has(p.key) || meshes.has(p.slot)) continue;
    // A collapsed placement (a scale-0 bone in the source setup) has no area: it stays a region.
    if (collapsed(p)) continue;
    const bone = regionBone(p.slot);
    if (!bone)
      failStage("rig", "PLAN_REGION", `Sheared image ${p.key} needs a region bone or a mesh plan`);
    const id = safeId(p.key === p.slot ? p.slot : p.key),
      mesh = toWorldMesh(quad(p), p, id);
    meshes.set(p.key, { asset: assetFor(p, id), mesh, weights: rigidWeights(mesh, rig, bone) });
  }
  // ADR-024: every shown region part becomes an artist-density mesh, rigid to its region bone.
  if (plan.meshing?.all) {
    const sets = plan.motion.animations.filter((a) => a.show?.length);
    const shown = (p: CharacterPart) =>
      !sets.length ||
      sets.some((a) =>
        a.show!.some((entry) => {
          const i = entry.indexOf("#");
          if (i >= 0) return entry.slice(0, i) === p.slot && entry.slice(i + 1) === p.attachment;
          return entry === p.slot && index.part(entry) === p;
        }),
      );
    const skipped: string[] = [];
    for (const p of index.parts.values()) {
      if (meshes.has(p.key) || meshes.has(p.slot) || collapsed(p) || !shown(p)) continue;
      const bone = regionBone(p.slot);
      if (!bone || !p.alpha.some((a) => a > 8)) continue;
      const id = safeId(p.key === p.slot ? p.slot : p.key);
      try {
        const built = shape({ type: "feature", density: "artist" }, p);
        meshes.set(p.key, { ...built, weights: rigidWeights(built.mesh, rig, bone) });
      } catch {
        // An outline the mesher rejects keeps its region; the build record lists it.
        skipped.push(id);
      }
    }
    if (skipped.length) evidence.meshingSkipped = skipped;
  }
  return { meshes, faceMix, evidence };
}
function quad(p: CharacterPart): Mesh2D {
  return {
    vertices: [
      [0, 0],
      [p.width, 0],
      [p.width, p.height],
      [0, p.height],
    ],
    triangles: [1, 2, 3, 1, 3, 0],
    hull: [0, 1, 2, 3],
  };
}
