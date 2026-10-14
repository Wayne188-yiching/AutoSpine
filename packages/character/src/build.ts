import type { AnimationSpec, CharacterPlan, KeyposeSpec, RigSpec } from "@autospine/schemas";
import { buildKeyposeAnimation } from "@autospine/motion";
import { failStage } from "@autospine/rig";
import { compileCharacterSpine40, type CharacterSpineInput } from "@autospine/spine";
import { measureDeformation, measureOverlapDrift, skinVertices } from "@autospine/weights";
import { apply, type CharacterPart } from "./geometry.js";
import { PartIndex, type Params } from "./joints.js";
import { planRig, type PlannedRig } from "./rig.js";
import { planAttachments, type MeshAsset } from "./attachments.js";
import {
  buildMotionSpecs,
  motionContext,
  motionParams,
  type FaceParallax,
  type MotionContext,
} from "./motion.js";
import { buildColorTimelines, type ColorTimeline } from "./colors.js";
import { buildAttachmentTimelines } from "./visibility.js";

type Slot = CharacterSpineInput["slots"][number];
type Ik = NonNullable<CharacterSpineInput["ik"]>[number];
type Transform = NonNullable<CharacterSpineInput["transform"]>[number];

/** A source slot in draw order; `attachments` lists its attachment names. */
export interface LayoutSlot {
  name: string;
  index: number;
  attachment?: string;
  color?: string;
  dark?: string;
  blend?: "normal" | "additive" | "multiply" | "screen";
  attachments: string[];
}
/** Images-only layout: slots and the placed images (keyed by slot, or `slot#attachment`). */
export interface CharacterLayout {
  slots: LayoutSlot[];
  parts: ReadonlyMap<string, CharacterPart>;
  skeleton: { x?: number; y?: number; width?: number; height?: number };
}

/** Everything except animations: the reusable result of rigging a plan. */
export interface CharacterRigging {
  plan: CharacterPlan;
  rigged: PlannedRig;
  meshes: Map<string, MeshAsset>;
  faceMix: Record<string, number>;
  slots: Slot[];
  emptySlots: { index: number; name: string; color?: string }[];
  ik: Ik[];
  transform: Transform[];
  motion: MotionContext;
  skeleton: CharacterLayout["skeleton"];
  imagesPath: string;
  evidence: Record<string, unknown>;
}

/** Rig, meshes, weights, slots and constraints from the plan; deterministic and in memory. */
export function rigCharacter(plan: CharacterPlan, layout: CharacterLayout): CharacterRigging {
  const index = new PartIndex(layout.parts);
  const rigged = planRig(plan, index);
  const { rig } = rigged;
  const regionBone = (slot: string) => plan.regions?.[slot];
  const built = planAttachments(plan, index, rigged, regionBone);
  const slots: Slot[] = [];
  const emptySlots: CharacterRigging["emptySlots"] = [];
  for (const s of layout.slots) {
    if (!s.attachments.length) {
      emptySlots.push({ index: s.index, name: s.name, ...(s.color ? { color: s.color } : {}) });
      continue;
    }
    const list: Slot["attachments"] = [];
    for (const name of s.attachments) {
      const key = name === s.attachment ? s.name : `${s.name}#${name}`;
      const p = layout.parts.get(key) ?? layout.parts.get(s.name);
      if (!p) failStage("asset", "PLAN_LAYOUT", `Attachment ${key} has no placed image`);
      const m = built.meshes.get(key) ?? built.meshes.get(s.name);
      if (m) {
        // The compiler needs no alpha; the part keeps its identity and bounds.
        const asset = {
          ...m.asset,
          parts: m.asset.parts.map((part) => {
            const rest = { ...part };
            delete rest.alphaMask;
            return rest;
          }),
        };
        list.push({
          kind: "mesh",
          name,
          path: p.path,
          asset,
          mesh: m.mesh,
          weights: m.weights,
          ...(p.color ? { color: p.color } : {}),
        });
      } else {
        const boneId = regionBone(s.name);
        if (!boneId)
          failStage(
            "rig",
            "PLAN_REGION",
            `Region ${s.name} has no planned bone; add it to regions or meshes`,
          );
        if (!rig.bones.some((b) => b.id === boneId))
          failStage("rig", "PLAN_REGION", `Region ${s.name} uses unknown bone ${boneId}`);
        const M = p.affine,
          c = apply(M, [p.width / 2, p.height / 2]);
        list.push({
          kind: "region",
          name,
          path: p.path,
          boneId,
          width: p.width,
          height: p.height,
          world: [M[0], M[1], M[2], M[3], c[0], c[1]],
          ...(p.color ? { color: p.color } : {}),
        });
      }
    }
    const first = list[0]!;
    const boneId =
      first.kind === "mesh"
        ? first.weights.vertices[0]!.influences[0]!.boneId
        : first.kind === "region"
          ? first.boneId
          : first.boneId;
    slots.push({
      name: s.name,
      boneId,
      ...(s.attachment ? { attachment: s.attachment } : {}),
      ...(s.color ? { color: s.color } : {}),
      ...(s.blend ? { blend: s.blend } : {}),
      attachments: list,
    });
  }
  // Constraints: plan IK, plan transforms, then the face followers (local, relative).
  let order = 0;
  const ik: Ik[] = (plan.constraints?.ik ?? []).map((c) => ({
    name: c.name,
    boneIds: c.bones,
    targetId: c.target,
    order: order++,
    mix: c.mix ?? 1,
    bendPositive:
      c.bendPositive === undefined || c.bendPositive === "auto"
        ? setupBend(rig, c.bones)
        : c.bendPositive,
  }));
  const transform: Transform[] = (plan.constraints?.transform ?? []).map((t) => ({
    name: t.name,
    boneIds: t.bones,
    targetId: t.target,
    order: order++,
    mixRotate: t.mixRotate ?? 0,
    mixX: t.mixX ?? 0,
    mixY: t.mixY ?? 0,
    mixScaleX: t.mixScaleX ?? 0,
    mixScaleY: t.mixScaleY ?? 0,
    mixShearY: t.mixShearY ?? 0,
    ...(t.local !== undefined ? { local: t.local } : {}),
    ...(t.relative !== undefined ? { relative: t.relative } : {}),
  }));
  const face = plan.face;
  if (face) {
    const follow = (name: string, bone: string, m: number) =>
      transform.push({
        name,
        boneIds: [bone],
        targetId: face.control,
        order: order++,
        local: true,
        relative: true,
        mixRotate: 0,
        mixX: m,
        mixY: m,
        mixScaleX: 0,
        mixScaleY: 0,
        mixShearY: 0,
      });
    if (face.counter) follow(face.counter, face.counter, face.counterMix ?? -0.3);
    for (const id of face.followers) {
      const m = built.faceMix[id];
      if (m === undefined)
        failStage(
          "weights",
          "PLAN_FACE",
          `Face follower ${id} has no dome value; plan a dome-weighted head mesh`,
        );
      follow("Face_" + id, id, m);
    }
    for (const layer of face.layers ?? []) {
      const m = built.faceMix[layer.bone];
      if (m === undefined)
        failStage(
          "weights",
          "PLAN_FACE",
          `Face layer ${layer.bone} needs a dome-weighted head mesh`,
        );
      follow("Layer_" + layer.bone, layer.bone, m);
    }
  }
  // Face parallax per px of slide (ADR-022): the first follower against the face plate's mean.
  let faceParallax: FaceParallax | undefined;
  const plate = face && built.meshes.get(face.head),
    mix = face && built.faceMix[face.followers[0]!];
  if (face && plate && mix !== undefined) {
    const counterMix = face.counterMix ?? -0.3;
    const factor =
      plate.weights.vertices.reduce(
        (sum, v) =>
          sum +
          v.influences.reduce(
            (t, i) =>
              t +
              (i.boneId === face.control
                ? i.weight
                : i.boneId === face.counter
                  ? counterMix * i.weight
                  : 0),
            0,
          ),
        0,
      ) / plate.weights.vertices.length;
    const p = index.part(face.head),
      xs = [0, p.width].flatMap((x) => [0, p.height].map((y) => apply(p.affine, [x, y])[0]));
    faceParallax = {
      follower: face.followers[0]!,
      perPx: +(mix - factor).toFixed(5),
      unit: +(Math.max(...xs) - Math.min(...xs)).toFixed(3),
    };
  }
  return {
    plan,
    rigged,
    meshes: built.meshes,
    faceMix: built.faceMix,
    slots,
    emptySlots,
    ik,
    transform,
    motion: motionContext(rig, rigged.world, rigged.chains, faceParallax),
    skeleton: layout.skeleton,
    imagesPath: plan.output?.imagesPath ?? "./images/",
    evidence: { ...rigged.evidence, ...built.evidence },
  };
}
/**
 * Keeps the setup elbow side of a two-bone IK: Spine bends the child positive (counter-clockwise,
 * y up) when its local rotation is positive, i.e. negative in the y-down IR.
 */
export function setupBend(rig: RigSpec, boneIds: string[]): boolean {
  if (boneIds.length < 2) return true;
  const child = rig.bones.find((b) => b.id === boneIds[1]);
  if (!child) failStage("constraints", "PLAN_IK", `IK bone ${boneIds[1]} is not planned`);
  return (child.rotation ?? 0) < 0;
}

export interface CharacterAnimations {
  specs: KeyposeSpec[];
  animations: AnimationSpec[];
  /** Slot colour and transparency keys from the plan's `pulses` and `colors`. */
  colorTimelines: ColorTimeline[];
}
/** Motion only, for a parameter point: the optimizer's inner step. */
export function animateCharacter(
  rigging: CharacterRigging,
  params: Params = {},
): CharacterAnimations {
  const resolved = motionParams(rigging.plan.motion, params);
  const specs = buildMotionSpecs(rigging.plan.motion, rigging.motion, resolved);
  const setupColors = new Map(rigging.slots.map((s) => [s.name, s.color ?? "ffffffff"]));
  return {
    specs,
    animations: specs.map((s) => buildKeyposeAnimation(rigging.rigged.rig, s)),
    colorTimelines: buildColorTimelines(rigging.plan.motion, setupColors, resolved),
  };
}

export type SpineDocument = Record<string, unknown> & {
  skeleton: Record<string, unknown>;
  slots: Record<string, unknown>[];
};
/** Compile to Spine 4.0 JSON with the planned scene header and the source's empty slots restored. */
export function compileCharacter(
  rigging: CharacterRigging,
  animations: AnimationSpec[],
  bend: Record<string, boolean> = {},
  colorTimelines: ColorTimeline[] = [],
): SpineDocument {
  const doc = compileCharacterSpine40({
    rig: rigging.rigged.rig,
    imagesPath: rigging.imagesPath,
    slots: rigging.slots,
    animations,
    colorTimelines,
    attachmentTimelines: buildAttachmentTimelines(
      rigging.plan.motion,
      rigging.slots,
      new Map(animations.map((a) => [a.name, a.duration])),
    ),
    ik: rigging.ik.map((c) => (c.name in bend ? { ...c, bendPositive: bend[c.name]! } : c)),
    transform: rigging.transform,
  }) as unknown as SpineDocument;
  const sk = rigging.skeleton;
  doc.skeleton = {
    ...doc.skeleton,
    ...(sk.x !== undefined ? { x: sk.x } : {}),
    ...(sk.y !== undefined ? { y: sk.y } : {}),
    ...(sk.width !== undefined ? { width: sk.width } : {}),
    ...(sk.height !== undefined ? { height: sk.height } : {}),
    images: rigging.imagesPath,
    audio: "",
  };
  for (const e of rigging.emptySlots)
    doc.slots.splice(e.index, 0, {
      name: e.name,
      bone: "root",
      ...(e.color ? { color: e.color } : {}),
    });
  return doc;
}

export interface SeamCheck {
  animation: string;
  time: number;
  pair: string;
  maxDrift: number;
  inversions: number[];
}
/** Engine seam QA: posed overlap drift between planned mesh pairs at one time per animation. */
export function measureSeams(rigging: CharacterRigging, animations: AnimationSpec[]): SeamCheck[] {
  const qa = rigging.plan.qa;
  if (!qa?.seams?.length) return [];
  const out: SeamCheck[] = [];
  for (const anim of animations) {
    const t = qa.at?.[anim.name] ?? anim.duration / 2;
    // Bone channels stepped to the last key at or before t (no constraints or interpolation).
    const at = <K extends { time: number }, R>(keys: K[], f: (k: K) => R) => {
      let k = keys[0]!;
      for (const x of keys) if (x.time <= t + 1e-9) k = x;
      return f(k);
    };
    const rotations: Record<string, number> = {},
      translations: Record<string, [number, number]> = {},
      scales: Record<string, [number, number]> = {};
    for (const tl of anim.rotationTimelines ?? [])
      rotations[tl.boneId] = at(tl.keys, (k) => k.degrees);
    for (const tl of anim.translationTimelines ?? [])
      translations[tl.boneId] = at(tl.keys, (k) => [k.x, k.y]);
    for (const tl of anim.scaleTimelines ?? []) scales[tl.boneId] = at(tl.keys, (k) => [k.x, k.y]);
    for (const [a, b] of qa.seams) {
      const A = rigging.meshes.get(a),
        B = rigging.meshes.get(b);
      if (!A || !B) failStage("build", "PLAN_QA", `Seam ${a}/${b} needs two planned meshes`);
      const rig = rigging.rigged.rig;
      const posed = [A, B].map((m) =>
        skinVertices(m.mesh, rig, m.weights, rotations, { translations, scales }),
      );
      const drift = measureOverlapDrift(
        { mesh: A.mesh, posed: posed[0]! },
        { mesh: B.mesh, posed: posed[1]! },
      );
      out.push({
        animation: anim.name,
        time: t,
        pair: `${a}/${b}`,
        maxDrift: drift.maxDrift,
        inversions: [A, B].map((m, i) => measureDeformation(m.mesh, posed[i]!).inversionCount),
      });
    }
  }
  return out;
}

export interface CharacterBuild {
  rigging: CharacterRigging;
  specs: KeyposeSpec[];
  animations: AnimationSpec[];
  colorTimelines: ColorTimeline[];
  document: SpineDocument;
  seams: SeamCheck[];
}
/** Plan + layout -> Spine document, IR and QA, with optional parameter overrides. */
export function buildCharacter(
  plan: CharacterPlan,
  layout: CharacterLayout,
  options: { params?: Params; bend?: Record<string, boolean> } = {},
): CharacterBuild {
  const rigging = rigCharacter(plan, layout);
  const { specs, animations, colorTimelines } = animateCharacter(rigging, options.params);
  return {
    rigging,
    specs,
    animations,
    colorTimelines,
    document: compileCharacter(rigging, animations, options.bend, colorTimelines),
    seams: measureSeams(rigging, animations),
  };
}
