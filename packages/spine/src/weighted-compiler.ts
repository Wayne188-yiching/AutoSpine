import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  AssetSpecSchema,
  type AnimationSpec,
  type AssetSpec,
  type MeshSpec,
  type RigSpec,
  type WeightSpec,
} from "@autospine/schemas";
import { evaluateRig, failStage, inverseAffine, orderBones, transformPoint } from "@autospine/rig";
import { validateWeights } from "@autospine/weights";
import { validateMeshSpec } from "@autospine/mesh";
import { spineCurve } from "./curve.js";

export interface WeightedSpineInput {
  asset: AssetSpec;
  mesh: MeshSpec;
  rig: RigSpec;
  weights: WeightSpec;
  animation: AnimationSpec;
  imagesPath: string;
}
/** Image-space IR is x-right/y-down. Convert once at this adapter boundary. */
export function compileWeightedSpine40(input: WeightedSpineInput) {
  const { asset, mesh, rig, weights, animation, imagesPath } = input;
  if (
    !Value.Check(AssetSpecSchema, asset) ||
    asset.parts.length !== 1 ||
    !Value.Check(AnimationSpecSchema, animation)
  )
    failStage("spine", "SPINE_INPUT", "One valid asset part and explicit animation required");
  if (validateMeshSpec(mesh).status !== "passed")
    failStage("spine", "SPINE_MESH", "Valid mesh required");
  validateWeights(mesh, rig, weights);
  if (
    mesh.sourcePartId !== asset.parts[0]!.id ||
    animation.rigId !== rig.id ||
    !imagesPath ||
    !imagesPath.endsWith("/")
  )
    failStage("spine", "SPINE_REFERENCE", "Input references or image path mismatch");
  if (
    animation.motions.length ||
    !(
      animation.rotationTimelines?.length ||
      animation.translationTimelines?.length ||
      animation.scaleTimelines?.length
    )
  )
    failStage("spine", "SPINE_ANIMATION", "Baked bone timelines required");
  if (animation.deformTimelines?.length)
    failStage(
      "spine",
      "SPINE_ANIMATION_CHANNEL",
      "Mesh deform export is not supported by this adapter",
    );
  const bones = orderBones(rig.bones),
    byId = new Map(bones.map((b, i) => [b.id, i]));
  for (const timelines of [
    animation.rotationTimelines ?? [],
    animation.translationTimelines ?? [],
    animation.scaleTimelines ?? [],
  ]) {
    const seen = new Set<string>();
    for (const timeline of timelines) {
      if (
        !byId.has(timeline.boneId) ||
        seen.has(timeline.boneId) ||
        timeline.keys[0]!.time !== 0 ||
        timeline.keys.at(-1)!.time !== animation.duration ||
        timeline.keys.some(
          (k, i) =>
            Object.entries(k).some(([field, v]) => field !== "curve" && !Number.isFinite(v)) ||
            (i > 0 && k.time <= timeline.keys[i - 1]!.time),
        ) ||
        timeline.keys.at(-1)!.curve !== undefined
      )
        failStage(
          "spine",
          "SPINE_TIMELINE",
          "Unique referenced timelines must span duration with strictly increasing finite keys and no final-key curve",
        );
      seen.add(timeline.boneId);
    }
  }
  const frames = evaluateRig(rig),
    inverse = new Map([...frames].map(([id, m]) => [id, inverseAffine(m)]));
  const hull = new Set(mesh.hull),
    order = [...mesh.hull, ...mesh.vertices.map((_, i) => i).filter((i) => !hull.has(i))];
  const remap = new Map(order.map((old, i) => [old, i]));
  const vertexWeights = new Map(weights.vertices.map((v) => [v.vertexIndex, v.influences]));
  const vertices: number[] = [];
  for (const index of order) {
    const influences = vertexWeights.get(index)!;
    vertices.push(influences.length);
    for (const influence of influences) {
      const p = transformPoint(inverse.get(influence.boneId)!, mesh.vertices[index]!);
      vertices.push(byId.get(influence.boneId)!, p[0], -p[1], influence.weight);
    }
  }
  const edges = [
    ...mesh.hull.map((a, i) => [a, mesh.hull[(i + 1) % mesh.hull.length]!] as [number, number]),
    ...(mesh.manualEdges ?? []),
  ].flatMap(([a, b]) => [remap.get(a)! * 2, remap.get(b)! * 2]);
  const document = {
    skeleton: { spine: "4.0.64" as const, images: imagesPath },
    bones: bones.map((b) => ({
      name: b.name,
      ...(b.parentId ? { parent: bones[byId.get(b.parentId)!]!.name } : {}),
      x: b.x,
      y: -b.y,
      rotation: -b.rotation,
      length: b.length,
      ...(b.scaleX === undefined ? {} : { scaleX: b.scaleX }),
      ...(b.scaleY === undefined ? {} : { scaleY: b.scaleY }),
      ...(b.shearX === undefined ? {} : { shearX: -b.shearX }),
      ...(b.shearY === undefined ? {} : { shearY: -b.shearY }),
    })),
    slots: [{ name: "image", bone: bones[0]!.name, attachment: "image" }],
    skins: [
      {
        name: "default",
        attachments: {
          image: {
            image: {
              type: "mesh",
              path: "image",
              uvs: order.flatMap((i) => mesh.uvs[i]!),
              triangles: mesh.triangles.map((i) => remap.get(i)!),
              vertices,
              hull: mesh.hull.length,
              edges,
              width: asset.parts[0]!.bounds.width,
              height: asset.parts[0]!.bounds.height,
            },
          },
        },
      },
    ],
    animations: {
      [animation.name]: {
        bones: Object.fromEntries(
          [
            ...new Set(
              [
                ...(animation.rotationTimelines ?? []),
                ...(animation.translationTimelines ?? []),
                ...(animation.scaleTimelines ?? []),
              ].map((t) => t.boneId),
            ),
          ].map((id) => {
            const rotate = animation.rotationTimelines?.find((t) => t.boneId === id),
              translate = animation.translationTimelines?.find((t) => t.boneId === id),
              scale = animation.scaleTimelines?.find((t) => t.boneId === id);
            return [
              bones[byId.get(id)!]!.name,
              {
                ...(rotate
                  ? {
                      rotate: rotate.keys.map((k, i, keys) => {
                        const n = keys[i + 1] ?? k;
                        return {
                          time: k.time,
                          value: -k.degrees,
                          ...spineCurve(k.curve, k.time, n.time, [[-k.degrees, -n.degrees]]),
                        };
                      }),
                    }
                  : {}),
                ...(translate
                  ? {
                      translate: translate.keys.map((k, i, keys) => {
                        const n = keys[i + 1] ?? k;
                        return {
                          time: k.time,
                          x: k.x,
                          y: -k.y,
                          ...spineCurve(k.curve, k.time, n.time, [
                            [k.x, n.x],
                            [-k.y, -n.y],
                          ]),
                        };
                      }),
                    }
                  : {}),
                ...(scale
                  ? {
                      scale: scale.keys.map((k, i, keys) => {
                        const n = keys[i + 1] ?? k;
                        return {
                          time: k.time,
                          x: k.x,
                          y: k.y,
                          ...spineCurve(k.curve, k.time, n.time, [
                            [k.x, n.x],
                            [k.y, n.y],
                          ]),
                        };
                      }),
                    }
                  : {}),
              },
            ];
          }),
        ),
      },
    },
  };
  if (!vertices.every(Number.isFinite))
    failStage("spine", "SPINE_NUMERIC", "Packed weighted vertices must be finite");
  return document;
}
