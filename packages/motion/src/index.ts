import type { AnimationSpec, BuildJob, RigSpec } from "@autospine/schemas";
import { failStage, orderBones } from "@autospine/rig";
export * from "./presets.js";
export function generateWave(rig: RigSpec, wave: BuildJob["wave"]): AnimationSpec {
  const { duration, fps, amplitudeDegrees, phaseDegrees } = wave;
  if (
    ![duration, fps, amplitudeDegrees, phaseDegrees].every(Number.isFinite) ||
    duration <= 0 ||
    duration > 10 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60 ||
    amplitudeDegrees < 0 ||
    amplitudeDegrees > 45 ||
    Math.abs(phaseDegrees) > 180
  )
    failStage("animation", "WAVE_PARAMETERS", "Bounded finite wave parameters required");
  const bones = orderBones(rig.bones),
    steps = Math.ceil(duration * fps);
  return {
    schemaVersion: "0.1",
    kind: "animation",
    id: rig.id + "-wave",
    name: "wave",
    rigId: rig.id,
    duration,
    loop: true,
    motions: [],
    rotationTimelines: bones.map((bone, index) => {
      const amplitude = (amplitudeDegrees * index) / Math.max(1, bones.length - 1),
        phase = (index * phaseDegrees * Math.PI) / 180;
      const keys = Array.from({ length: steps + 1 }, (_, k) => ({
        time: (duration * k) / steps,
        degrees: amplitude * Math.sin((2 * Math.PI * k) / steps - phase),
      }));
      keys[keys.length - 1]!.degrees = keys[0]!.degrees;
      return { boneId: bone.id, keys };
    }),
  };
}
export function rotationsAt(animation: AnimationSpec, time: number): Record<string, number> {
  const result: Record<string, number> = {};
  const t = Math.max(0, Math.min(animation.duration, time));
  for (const timeline of animation.rotationTimelines ?? []) {
    const keys = timeline.keys;
    let i = 1;
    while (i < keys.length - 1 && keys[i]!.time < t) i++;
    const a = keys[i - 1] ?? keys[0]!,
      b = keys[i] ?? a;
    const fraction = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
    result[timeline.boneId] = a.degrees + (b.degrees - a.degrees) * fraction;
  }
  return result;
}
