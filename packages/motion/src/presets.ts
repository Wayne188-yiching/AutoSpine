import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  RigSpecSchema,
  type AnimationSpec,
  type MotionSpec,
  type RigSpec,
} from "@autospine/schemas";
import { failStage, orderBones } from "@autospine/rig";

export const presetNames = [
  "wave",
  "sway",
  "breathe",
  "bounce",
  "float",
  "rotate-loop",
  "blink",
  "follow-through",
  "overshoot",
  "squash-stretch",
] as const satisfies readonly MotionSpec["type"][];
export interface PresetOptions {
  type: (typeof presetNames)[number];
  duration: number;
  fps: number;
  amplitude: number;
  seed?: number;
  /** Ordered part-local controls. Unrelated rig bones must not affect delay or amplitude. */
  boneIds?: string[];
}
export function generatePreset(rig: RigSpec, options: PresetOptions): AnimationSpec {
  const { type, duration, fps, amplitude, seed = 0 } = options;
  if (
    !Value.Check(RigSpecSchema, rig) ||
    !presetNames.includes(type) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 10 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60 ||
    !Number.isFinite(amplitude) ||
    amplitude < 0 ||
    amplitude > 45 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    Object.keys(options).some(
      (k) => !["type", "duration", "fps", "amplitude", "seed", "boneIds"].includes(k),
    )
  )
    failStage(
      "animation",
      "PRESET_INPUT",
      "Valid bounded preset, rig and unsigned 32-bit seed required",
    );
  const ordered = orderBones(rig.bones);
  const selected = options.boneIds;
  if (
    selected &&
    (!selected.length ||
      selected.length > 256 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !ordered.some((b) => b.id === id)))
  )
    failStage("animation", "PRESET_TARGETS", "Unique existing ordered controls required");
  const bones = selected ? selected.map((id) => ordered.find((b) => b.id === id)!) : ordered,
    steps = Math.ceil(duration * fps);
  const times = Array.from({ length: steps + 1 }, (_, i) =>
    i === steps ? duration : (duration * i) / steps,
  );
  const animation: AnimationSpec = {
    schemaVersion: "0.1",
    kind: "animation",
    id: rig.id + "-" + type,
    name: type,
    rigId: rig.id,
    duration,
    loop: type !== "overshoot",
    seed,
    motions: [],
  };
  const blinkCenter =
    0.2 + (0.6 * ((Math.imul(seed ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0)) / 0x100000000;
  const scalar = (t: number, index: number) => {
    const u = t / duration,
      phase = 2 * Math.PI * u;
    switch (type) {
      case "wave":
        return (
          ((amplitude * index) / Math.max(1, bones.length - 1)) *
          Math.sin(phase - (index * Math.PI) / 4)
        );
      case "sway":
        return amplitude * Math.sin(phase);
      case "follow-through":
        return amplitude * Math.exp(-0.3 * index) * Math.sin(phase - index * 0.5);
      case "overshoot":
        return amplitude * 4 * u * (1 - u) * Math.sin(3 * Math.PI * u) * Math.exp(-3 * u);
      case "rotate-loop":
        return 360 * u;
      case "blink":
        return Math.max(
          0.05,
          1 - (amplitude / 45) * Math.max(0, 1 - Math.abs(u - blinkCenter) / 0.075),
        );
      default:
        return amplitude * Math.sin(phase);
    }
  };
  if (["wave", "sway", "follow-through", "overshoot", "rotate-loop"].includes(type)) {
    animation.rotationTimelines = bones.map((b, index) => {
      const keys = times.map((time) => ({ time, degrees: scalar(time, index) }));
      if (type !== "rotate-loop") keys.at(-1)!.degrees = keys[0]!.degrees;
      return { boneId: b.id, keys };
    });
  } else if (type === "bounce" || type === "float") {
    animation.translationTimelines = [
      {
        boneId: bones[0]!.id,
        keys: times.map((time) => ({
          time,
          x: type === "float" ? amplitude * Math.cos((2 * Math.PI * time) / duration) : 0,
          y: scalar(time, 0),
        })),
      },
    ];
    const keys = animation.translationTimelines[0]!.keys;
    keys.at(-1)!.x = keys[0]!.x;
    keys.at(-1)!.y = keys[0]!.y;
  } else {
    animation.scaleTimelines = [
      {
        boneId: bones[0]!.id,
        keys: times.map((time) => {
          const f = scalar(time, 0),
            sy = type === "blink" ? f : 1 + f / 100;
          return {
            time,
            x: type === "blink" ? 1 : type === "squash-stretch" ? 1 / sy : 1 + f / 100,
            y: sy,
          };
        }),
      },
    ];
    const keys = animation.scaleTimelines[0]!.keys;
    keys.at(-1)!.x = keys[0]!.x;
    keys.at(-1)!.y = keys[0]!.y;
  }
  validateAnimation(animation, rig);
  return animation;
}
export function validateAnimation(animation: AnimationSpec, rig: RigSpec): void {
  if (
    !Value.Check(RigSpecSchema, rig) ||
    !Value.Check(AnimationSpecSchema, animation) ||
    animation.rigId !== rig.id ||
    animation.motions.length
  )
    failStage(
      "animation",
      "ANIMATION_SCHEMA",
      "Valid baked AnimationSpec with matching rig required",
    );
  const ids = new Set(orderBones(rig.bones).map((b) => b.id));
  const channels = [
    animation.rotationTimelines ?? [],
    animation.translationTimelines ?? [],
    animation.scaleTimelines ?? [],
  ];
  for (const timelines of channels) {
    const seen = new Set<string>();
    for (const timeline of timelines) {
      if (!ids.has(timeline.boneId) || seen.has(timeline.boneId))
        failStage(
          "animation",
          "ANIMATION_TARGET",
          "Unique existing bone target required per channel",
        );
      seen.add(timeline.boneId);
      checkKeys(timeline.keys, animation.duration);
    }
  }
  const meshes = new Set<string>();
  for (const timeline of animation.deformTimelines ?? []) {
    if (meshes.has(timeline.meshId))
      failStage("animation", "ANIMATION_TARGET", "Duplicate mesh target");
    meshes.add(timeline.meshId);
    checkKeys(timeline.keys, animation.duration);
    if (timeline.keys.some((k) => k.offsets.length !== timeline.keys[0]!.offsets.length))
      failStage("animation", "ANIMATION_DEFORM", "Deform vertex count changed across keys");
  }
}
function checkKeys(keys: { time: number; curve?: unknown }[], duration: number) {
  if (
    keys[0]!.time !== 0 ||
    keys.at(-1)!.time !== duration ||
    keys.some((k, i) => i > 0 && k.time <= keys[i - 1]!.time)
  )
    failStage(
      "animation",
      "ANIMATION_KEYS",
      "Strictly increasing keys must cover the full duration",
    );
  if (keys.at(-1)!.curve !== undefined)
    failStage(
      "animation",
      "ANIMATION_CURVE",
      "A curve shapes the segment to the next key; remove it from the final key",
    );
}
