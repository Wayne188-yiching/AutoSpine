import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  AssetSpecSchema,
  KeyCurveSchema,
  MeshSpecSchema,
  RigSpecSchema,
  WeightSpecSchema,
} from "@autospine/schemas";
import { evaluateRig, failStage, inverseAffine, multiplyAffine, orderBones } from "@autospine/rig";
import { compileWeightedSpine40 } from "./weighted-compiler.js";
import { spineCurve } from "./curve.js";

const strict = { additionalProperties: false };
const identity = Type.String({ minLength: 1, maxLength: 256 });
const color = Type.String({ pattern: "^[0-9a-fA-F]{8}$" });
const point = Type.Tuple([Type.Number(), Type.Number()]);
const region = Type.Object(
  {
    kind: Type.Literal("region"),
    name: identity,
    path: identity,
    boneId: identity,
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
    world: Type.Tuple([
      Type.Number(),
      Type.Number(),
      Type.Number(),
      Type.Number(),
      Type.Number(),
      Type.Number(),
    ]),
    color: Type.Optional(color),
  },
  strict,
);
const mesh = Type.Object(
  {
    kind: Type.Literal("mesh"),
    name: identity,
    path: identity,
    asset: AssetSpecSchema,
    mesh: MeshSpecSchema,
    weights: WeightSpecSchema,
    color: Type.Optional(color),
  },
  strict,
);
const clipping = Type.Object(
  {
    kind: Type.Literal("clipping"),
    name: identity,
    boneId: identity,
    endSlotName: identity,
    worldVertices: Type.Array(point, { minItems: 3, maxItems: 64 }),
  },
  strict,
);
export const CharacterSpineInputSchema = Type.Object(
  {
    rig: RigSpecSchema,
    imagesPath: Type.String({ minLength: 1, maxLength: 4096 }),
    slots: Type.Array(
      Type.Object(
        {
          name: identity,
          boneId: identity,
          attachment: Type.Optional(identity),
          color: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{8}$" })),
          blend: Type.Optional(
            Type.Union([
              Type.Literal("normal"),
              Type.Literal("additive"),
              Type.Literal("multiply"),
              Type.Literal("screen"),
            ]),
          ),
          attachments: Type.Array(Type.Union([region, mesh, clipping]), {
            minItems: 1,
            maxItems: 64,
          }),
        },
        strict,
      ),
      { minItems: 1, maxItems: 512 },
    ),
    animations: Type.Array(AnimationSpecSchema, { minItems: 1, maxItems: 64 }),
    attachmentTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            animationName: identity,
            slotName: identity,
            keys: Type.Array(
              Type.Object(
                { time: Type.Number({ minimum: 0 }), name: Type.Union([identity, Type.Null()]) },
                strict,
              ),
              { minItems: 2, maxItems: 512 },
            ),
          },
          strict,
        ),
        { maxItems: 512 },
      ),
    ),
    colorTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            animationName: identity,
            slotName: identity,
            keys: Type.Array(
              Type.Object(
                { time: Type.Number({ minimum: 0 }), color, curve: Type.Optional(KeyCurveSchema) },
                strict,
              ),
              { minItems: 2, maxItems: 1024 },
            ),
          },
          strict,
        ),
        { maxItems: 512 },
      ),
    ),
    deformTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            animationName: identity,
            slotName: identity,
            attachmentName: identity,
            keys: Type.Array(
              Type.Object(
                {
                  time: Type.Number({ minimum: 0 }),
                  offsets: Type.Array(point, { minItems: 1, maxItems: 250000 }),
                  curve: Type.Optional(KeyCurveSchema),
                },
                strict,
              ),
              { minItems: 2, maxItems: 1024 },
            ),
          },
          strict,
        ),
        { maxItems: 512 },
      ),
    ),
    ik: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: identity,
            boneIds: Type.Array(identity, { minItems: 1, maxItems: 2 }),
            targetId: identity,
            order: Type.Integer({ minimum: 0 }),
            mix: Type.Number({ minimum: 0, maximum: 1 }),
            bendPositive: Type.Boolean(),
            stretch: Type.Optional(Type.Boolean()),
            compress: Type.Optional(Type.Boolean()),
          },
          strict,
        ),
        { maxItems: 64 },
      ),
    ),
    transform: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: identity,
            boneIds: Type.Array(identity, { minItems: 1, maxItems: 64 }),
            targetId: identity,
            order: Type.Integer({ minimum: 0 }),
            mixRotate: Type.Number({ minimum: -1, maximum: 1 }),
            mixX: Type.Number({ minimum: -1, maximum: 1 }),
            mixY: Type.Number({ minimum: -1, maximum: 1 }),
            mixScaleX: Type.Number({ minimum: -1, maximum: 1 }),
            mixScaleY: Type.Number({ minimum: -1, maximum: 1 }),
            mixShearY: Type.Number({ minimum: -1, maximum: 1 }),
            local: Type.Optional(Type.Boolean()),
            relative: Type.Optional(Type.Boolean()),
            rotation: Type.Optional(Type.Number()),
            x: Type.Optional(Type.Number()),
            y: Type.Optional(Type.Number()),
            scaleX: Type.Optional(Type.Number()),
            scaleY: Type.Optional(Type.Number()),
            shearY: Type.Optional(Type.Number()),
          },
          strict,
        ),
        { maxItems: 64 },
      ),
    ),
  },
  strict,
);
export type CharacterSpineInput = Static<typeof CharacterSpineInputSchema>;

/** Explicit multi-part adapter. Geometry, weights and motion remain engine IR inputs. */
export function compileCharacterSpine40(input: CharacterSpineInput) {
  const fail = (reason: string): never => failStage("spine", "SPINE_CHARACTER", reason);
  if (!Value.Check(CharacterSpineInputSchema, input)) fail("Strict character input required");
  const { rig, slots, animations } = input;
  const bones = orderBones(rig.bones),
    byId = new Map(bones.map((b) => [b.id, b]));
  if (bones.length > 256 || !input.imagesPath.endsWith("/"))
    fail("Bounded rig and trailing image slash required");
  const frames = evaluateRig(rig);
  const unique = (names: string[]) => new Set(names).size === names.length;
  if (!unique(slots.map((s) => s.name)) || !unique(animations.map((a) => a.name)))
    fail("Unique slots and animations required");
  const name = (id: string) => byId.get(id)?.name ?? fail("Missing bone reference");
  const ik = (input.ik ?? []).map((c) => {
    if (!unique(c.boneIds) || c.boneIds.some((id) => !byId.has(id) || byId.get(id)!.length <= 0))
      fail("IK deform bones must be unique and positive-length");
    name(c.targetId);
    if (c.boneIds.length === 2 && byId.get(c.boneIds[1]!)!.parentId !== c.boneIds[0])
      fail("Two-bone IK must be a parent-child chain");
    let ancestor: string | undefined = c.targetId;
    while (ancestor) {
      if (c.boneIds.includes(ancestor)) fail("IK target cannot descend from its constrained chain");
      ancestor = byId.get(ancestor)!.parentId;
    }
    return {
      name: c.name,
      order: c.order,
      bones: c.boneIds.map(name),
      target: name(c.targetId),
      mix: c.mix,
      bendPositive: c.bendPositive,
      ...(c.stretch === undefined ? {} : { stretch: c.stretch }),
      ...(c.compress === undefined ? {} : { compress: c.compress }),
    };
  });
  if (!unique(ik.map((c) => c.name)) || !unique(ik.map((c) => String(c.order))))
    fail("Unique IK names and update orders required");
  const transform = (input.transform ?? []).map((c) => {
    if (!unique(c.boneIds)) fail("Unique transform bones required");
    c.boneIds.forEach(name);
    name(c.targetId);
    let ancestor: string | undefined = c.targetId;
    while (ancestor) {
      if (c.boneIds.includes(ancestor))
        fail("Transform target cannot descend from constrained bones");
      ancestor = byId.get(ancestor)!.parentId;
    }
    return {
      name: c.name,
      bones: c.boneIds.map(name),
      target: name(c.targetId),
      order: c.order,
      local: c.local ?? false,
      relative: c.relative ?? false,
      mixRotate: c.mixRotate,
      mixX: c.mixX,
      mixY: c.mixY,
      mixScaleX: c.mixScaleX,
      mixScaleY: c.mixScaleY,
      mixShearY: c.mixShearY,
      ...(c.rotation === undefined ? {} : { rotation: -c.rotation }),
      ...(c.x === undefined ? {} : { x: c.x }),
      ...(c.y === undefined ? {} : { y: -c.y }),
      ...(c.scaleX === undefined ? {} : { scaleX: c.scaleX }),
      ...(c.scaleY === undefined ? {} : { scaleY: c.scaleY }),
      ...(c.shearY === undefined ? {} : { shearY: -c.shearY }),
    };
  });
  const constraints = [...(input.ik ?? []), ...(input.transform ?? [])];
  if (!unique(constraints.map((c) => c.name)) || !unique(constraints.map((c) => String(c.order))))
    fail("Unique constraint names and update orders required");
  for (const c of constraints)
    for (const id of [
      c.targetId,
      ...c.boneIds.map((id) => byId.get(id)!.parentId).filter((id): id is string => !!id),
    ]) {
      let ancestor: string | undefined = id;
      while (ancestor) {
        for (const dependency of constraints)
          if (
            dependency !== c &&
            dependency.boneIds.includes(ancestor) &&
            dependency.order >= c.order
          )
            fail("Constraint dependencies must be acyclic and precede consumers");
        ancestor = byId.get(ancestor)!.parentId;
      }
    }
  // Compile all animation channels through the existing adapter, even a region-only character.
  const stub = {
    schemaVersion: "0.1" as const,
    kind: "mesh" as const,
    id: "adapter-stub",
    name: "adapter-stub",
    sourcePartId: "adapter-stub",
    vertices: [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as [number, number][],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as [number, number][],
    triangles: [0, 1, 2],
    hull: [0, 1, 2],
  };
  const asset = {
    schemaVersion: "0.1" as const,
    kind: "asset" as const,
    id: "adapter-stub",
    name: "adapter-stub",
    source: { type: "png-parts" as const, path: "adapter-stub" },
    width: 1,
    height: 1,
    parts: [
      {
        id: "adapter-stub",
        name: "adapter-stub",
        sourcePath: "adapter-stub",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        drawOrder: 0,
      },
    ],
  };
  const weights = {
    schemaVersion: "0.1" as const,
    kind: "weights" as const,
    id: "adapter-stub",
    rigId: rig.id,
    meshId: stub.id,
    vertices: stub.vertices.map((_, vertexIndex) => ({
      vertexIndex,
      influences: [{ boneId: bones[0]!.id, weight: 1 }],
    })),
  };
  const compiled = animations.map((animation) =>
    compileWeightedSpine40({
      asset,
      mesh: stub,
      weights,
      rig,
      animation,
      imagesPath: input.imagesPath,
    }),
  );
  const attachments: Record<string, Record<string, unknown>> = {};
  for (const slot of slots) {
    name(slot.boneId);
    if (
      !unique(slot.attachments.map((a) => a.name)) ||
      (slot.attachment !== undefined && !slot.attachments.some((a) => a.name === slot.attachment))
    )
      fail("Unique attachments and valid setup selection required");
    attachments[slot.name] = {};
    for (const a of slot.attachments) {
      if (a.kind === "clipping") {
        if (a.boneId !== slot.boneId || !slots.some((s) => s.name === a.endSlotName))
          fail("Clipping requires its slot bone and an existing end slot");
        if (slots.findIndex((s) => s.name === a.endSlotName) < slots.indexOf(slot))
          fail("Clipping end slot must follow the mask in draw order");
        const inv = inverseAffine(frames.get(a.boneId)!);
        const points = a.worldVertices.map((p) => {
          const q = multiplyAffine(inv, [1, 0, 0, 1, ...p]);
          return [q[4]!, -q[5]!] as [number, number];
        });
        // Only simple convex masks are accepted by this bounded profile.
        const crosses = points.map((p, i) => {
          const q = points[(i + 1) % points.length]!,
            r = points[(i + 2) % points.length]!;
          return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
        });
        if (
          crosses.some((v) => Math.abs(v) < 1e-8) ||
          !(crosses.every((v) => v > 0) || crosses.every((v) => v < 0))
        )
          fail("Clipping mask must be strictly convex and nondegenerate");
        const side = (a: [number, number], b: [number, number], c: [number, number]) =>
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        for (let i = 0; i < points.length; i++)
          for (let j = i + 2; j < points.length; j++) {
            if (i === 0 && j === points.length - 1) continue;
            const p = points[i]!,
              q = points[(i + 1) % points.length]!,
              r = points[j]!,
              s = points[(j + 1) % points.length]!;
            if (side(p, q, r) * side(p, q, s) <= 0 && side(r, s, p) * side(r, s, q) <= 0)
              fail("Clipping mask must be simple, without crossing edges");
          }
        attachments[slot.name]![a.name] = {
          type: "clipping",
          end: a.endSlotName,
          vertexCount: points.length,
          vertices: points.flat(),
        };
      } else if (a.kind === "mesh") {
        const doc = compileWeightedSpine40({
          asset: a.asset,
          mesh: a.mesh,
          weights: a.weights,
          rig,
          animation: animations[0]!,
          imagesPath: input.imagesPath,
        });
        attachments[slot.name]![a.name] = {
          ...doc.skins[0]!.attachments.image.image,
          path: a.path,
          ...(a.color === undefined ? {} : { color: a.color }),
        };
      } else {
        if (a.boneId !== slot.boneId) fail("Region bone must match slot bone");
        const local = multiplyAffine(
          inverseAffine(frames.get(a.boneId) ?? fail("Region bone missing")),
          a.world,
        );
        // A collapsed region (a scale-0 bone in the source setup) is emitted at scale 0.
        if (Math.abs(local[0] * local[3] - local[1] * local[2]) < 1e-12) {
          if (![local[4], local[5]].every(Number.isFinite)) fail("Region position must be finite");
          attachments[slot.name]![a.name] = {
            path: a.path,
            x: local[4],
            y: -local[5],
            scaleX: 0,
            scaleY: 0,
            width: a.width,
            height: a.height,
            ...(a.color === undefined ? {} : { color: a.color }),
          };
          continue;
        }
        inverseAffine(local);
        const r = Math.atan2(local[1], local[0]);
        const sx = Math.hypot(local[0], local[1]);
        const sy = (local[0] * local[3] - local[1] * local[2]) / sx;
        if (
          Math.abs(local[0] * local[2] + local[1] * local[3]) >
          1e-7 * sx * Math.hypot(local[2], local[3])
        )
          fail("A sheared region requires a mesh or explicit attachment bone");
        attachments[slot.name]![a.name] = {
          path: a.path,
          x: local[4],
          y: -local[5],
          rotation: (-r * 180) / Math.PI,
          scaleX: sx,
          scaleY: sy,
          width: a.width,
          height: a.height,
          ...(a.color === undefined ? {} : { color: a.color }),
        };
      }
    }
  }
  type CompiledAnimation = (typeof compiled)[number]["animations"][string] & {
    slots?: Record<
      string,
      {
        attachment?: { time: number; name: string | null }[];
        rgba?: { time: number; color: string; curve?: "stepped" | number[] }[];
      }
    >;
    deform?: Record<
      string,
      Record<
        string,
        Record<string, { time: number; vertices: number[]; curve?: "stepped" | number[] }[]>
      >
    >;
  };
  const animationDocuments: Record<string, CompiledAnimation> = Object.assign(
    {},
    ...compiled.map((c) => c.animations),
  );
  const seenChannels = new Set<string>();
  for (const t of input.attachmentTimelines ?? []) {
    const animation = animations.find((a) => a.name === t.animationName),
      slot = slots.find((s) => s.name === t.slotName),
      key = t.animationName + "\u0000" + t.slotName;
    if (
      !animation ||
      !slot ||
      seenChannels.has(key) ||
      t.keys[0]!.time !== 0 ||
      t.keys.at(-1)!.time !== animation.duration ||
      t.keys.some(
        (k, i) =>
          (i > 0 && k.time <= t.keys[i - 1]!.time) ||
          (k.name !== null && !slot.attachments.some((a) => a.name === k.name)),
      )
    )
      fail(
        "Attachment channels require unique valid references and strictly increasing keys spanning duration",
      );
    seenChannels.add(key);
    const doc = animationDocuments[t.animationName]!;
    doc.slots ??= {};
    doc.slots[t.slotName] ??= {};
    doc.slots[t.slotName]!.attachment = t.keys.map((k) => ({ ...k }));
  }
  function checkChannel(
    animationName: string,
    slotName: string,
    channel: string,
    keys: { time: number; curve?: unknown }[],
  ) {
    const animation = animations.find((a) => a.name === animationName),
      slot = slots.find((s) => s.name === slotName);
    const key = animationName + "\u0000" + slotName + "\u0000" + channel;
    if (
      !animation ||
      !slot ||
      seenChannels.has(key) ||
      keys[0]!.time !== 0 ||
      keys.at(-1)!.time !== animation.duration ||
      keys.some((k, i) => i > 0 && k.time <= keys[i - 1]!.time) ||
      keys.at(-1)!.curve !== undefined
    )
      fail(
        "Animation channels require unique references, strictly increasing keys spanning duration and no final-key curve",
      );
    seenChannels.add(key);
    return { slot: slot!, doc: animationDocuments[animationName]! };
  }
  for (const t of input.colorTimelines ?? []) {
    const { doc } = checkChannel(t.animationName, t.slotName, "rgba", t.keys);
    doc.slots ??= {};
    doc.slots[t.slotName] ??= {};
    // Spine evaluates rgba curves per channel in 0..1 component space.
    const unit = (hex: string) => [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    doc.slots[t.slotName]!.rgba = t.keys.map((k, i, keys) => {
      const n = keys[i + 1] ?? k,
        a = unit(k.color),
        b = unit(n.color);
      return {
        time: k.time,
        color: k.color,
        ...spineCurve(
          k.curve,
          k.time,
          n.time,
          a.map((v, j) => [v, b[j]!]),
        ),
      };
    });
  }
  for (const t of input.deformTimelines ?? []) {
    const { slot, doc } = checkChannel(
      t.animationName,
      t.slotName,
      "deform:" + t.attachmentName,
      t.keys,
    );
    const a = slot.attachments.find((a) => a.name === t.attachmentName);
    if (!a || a.kind !== "mesh") fail("Deform target must be an existing weighted mesh");
    if (a!.kind !== "mesh") fail("Mesh required");
    const part = a as Static<typeof mesh>;
    if (t.keys.some((k) => k.offsets.length !== part.mesh.vertices.length))
      fail("Deform offset count must match mesh vertices");
    const order = [
      ...part.mesh.hull,
      ...part.mesh.vertices.map((_, i) => i).filter((i) => !part.mesh.hull.includes(i)),
    ];
    const inverse = new Map([...frames].map(([id, m]) => [id, inverseAffine(m)]));
    const weights = new Map(part.weights.vertices.map((v) => [v.vertexIndex, v.influences]));
    doc.deform ??= {};
    doc.deform.default ??= {};
    doc.deform.default[t.slotName] ??= {};
    doc.deform.default[t.slotName]![t.attachmentName] = t.keys.map((k, i, keys) => ({
      time: k.time,
      // Spine deform curves interpolate a 0..1 blend between whole vertex arrays.
      ...spineCurve(k.curve, k.time, (keys[i + 1] ?? k).time, [[0, 1]]),
      vertices: order.flatMap((i) =>
        weights.get(i)!.flatMap((influence) => {
          const m = inverse.get(influence.boneId)!,
            p = k.offsets[i]!;
          // World setup-space delta -> each influence's local vector; never include translation.
          return [m[0] * p[0] + m[2] * p[1], -(m[1] * p[0] + m[3] * p[1])];
        }),
      ),
    }));
  }
  return {
    skeleton: compiled[0]!.skeleton,
    bones: compiled[0]!.bones,
    slots: slots.map((s) => ({
      name: s.name,
      bone: name(s.boneId),
      ...(s.attachment === undefined ? {} : { attachment: s.attachment }),
      ...(s.color === undefined ? {} : { color: s.color }),
      ...(s.blend === undefined ? {} : { blend: s.blend }),
    })),
    ...(ik.length ? { ik } : {}),
    ...(transform.length ? { transform } : {}),
    skins: [{ name: "default", attachments }],
    animations: animationDocuments,
  };
}
