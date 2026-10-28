import { loadSkeleton } from "./runtime.js";

type Json = Record<string, unknown>;
const rigFields = ["bones", "slots", "ik", "transform", "path", "skins"] as const;

/** Explicit reuse of static binding only; no animation or event data crosses this boundary. */
export function prepareRig(source: unknown): Json {
  const input = source as Json;
  const skeleton = input.skeleton as Json | undefined;
  if (typeof skeleton?.spine !== "string" || !skeleton.spine.startsWith("4.0."))
    throw new Error("RIG_VERSION: only Spine 4.0 rig data is supported");
  const output: Json = {
    skeleton: {
      spine: skeleton.spine,
      ...Object.fromEntries(
        ["x", "y", "width", "height"]
          .filter((k) => skeleton[k] !== undefined)
          .map((k) => [k, skeleton[k]]),
      ),
      images: "./images/",
    },
    animations: {},
  };
  for (const key of rigFields)
    if (input[key] !== undefined) output[key] = structuredClone(input[key]);
  loadSkeleton(output);
  return output;
}

/** Add newly authored Spine timelines without modifying bones, meshes, weights or constraints. */
export function applyRigMotion(rig: unknown, animations: Record<string, unknown>): Json {
  const input = rig as Json;
  if (Object.keys((input.animations ?? {}) as Json).length)
    throw new Error("RIG_ANIMATIONS: prepare the rig with no existing animations first");
  if (
    !animations ||
    Array.isArray(animations) ||
    typeof animations !== "object" ||
    !Object.keys(animations).length
  )
    throw new Error("RIG_MOTION: provide at least one newly authored animation");
  const output = prepareRig(input);
  const boneNames = new Set((output.bones as Json[]).map((b) => b.name));
  const slotNames = new Set((output.slots as Json[]).map((s) => s.name));
  const named = (key: string) => new Set(((output[key] ?? []) as Json[]).map((c) => c.name));
  const owners = {
    bones: boneNames,
    slots: slotNames,
    ik: named("ik"),
    transform: named("transform"),
    paths: named("path"),
  };
  for (const [name, raw] of Object.entries(animations)) {
    if (!name || !raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("RIG_MOTION: invalid animation");
    const animation = raw as Json;
    for (const key of Object.keys(animation))
      if (![...Object.keys(owners), "deform", "drawOrder"].includes(key))
        throw new Error(`RIG_MOTION: unsupported timeline ${key}`);
    for (const [kind, known] of Object.entries(owners))
      for (const owner of Object.keys((animation[kind] ?? {}) as Json))
        if (!known.has(owner)) throw new Error(`RIG_MOTION: unknown ${kind} owner ${owner}`);
    const skins = (output.skins ?? []) as { name: string; attachments?: Record<string, Json> }[];
    for (const [slot, rawTracks] of Object.entries((animation.slots ?? {}) as Json)) {
      const tracks = rawTracks as Json;
      for (const key of (tracks.attachment ?? []) as Json[]) {
        if (
          key.name != null &&
          !skins.some((skin) => Object.hasOwn(skin.attachments?.[slot] ?? {}, key.name as string))
        )
          throw new Error(`RIG_MOTION: unknown attachment ${slot}/${key.name}`);
      }
    }
    for (const [skinName, rawSlots] of Object.entries((animation.deform ?? {}) as Json)) {
      const skin = skins.find((s) => s.name === skinName);
      if (!skin) throw new Error(`RIG_MOTION: unknown deform skin ${skinName}`);
      for (const [slot, atts] of Object.entries(rawSlots as Json))
        for (const attachment of Object.keys(atts as Json))
          if (!Object.hasOwn(skin.attachments?.[slot] ?? {}, attachment))
            throw new Error(`RIG_MOTION: unknown deform ${slot}/${attachment}`);
    }
  }
  output.animations = structuredClone(animations);
  loadSkeleton(output);
  return output;
}
