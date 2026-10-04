import type { AnimationSpec, RigSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { validateAnimation } from "./presets.js";

export interface AnimationPose {
  rotations: Record<string, number>;
  translations: Record<string, [number, number]>;
  scales: Record<string, [number, number]>;
  deforms: Record<string, [number, number][]>;
}
function segment<T extends { time: number }>(keys: T[], time: number): [T, T, number] {
  let i = 1;
  while (i < keys.length - 1 && keys[i]!.time < time) i++;
  const a = keys[i - 1] ?? keys[0]!,
    b = keys[i] ?? a;
  return [a, b, b.time === a.time ? 0 : (time - a.time) / (b.time - a.time)];
}
export function sampleAnimation(
  animation: AnimationSpec,
  rig: RigSpec,
  time: number,
): AnimationPose {
  validateAnimation(animation, rig);
  if (!Number.isFinite(time) || time < 0 || time > animation.duration)
    failStage("animation", "ANIMATION_TIME", "Sample time must be within the duration");
  const rotations: Record<string, number> = Object.create(null),
    translations: AnimationPose["translations"] = Object.create(null),
    scales: AnimationPose["scales"] = Object.create(null),
    deforms: AnimationPose["deforms"] = Object.create(null);
  const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  for (const timeline of animation.rotationTimelines ?? []) {
    const [a, b, t] = segment(timeline.keys, time);
    rotations[timeline.boneId] = lerp(a.degrees, b.degrees, t);
  }
  for (const [timelines, target] of [
    [animation.translationTimelines ?? [], translations],
    [animation.scaleTimelines ?? [], scales],
  ] as const)
    for (const timeline of timelines) {
      const [a, b, t] = segment(timeline.keys, time);
      target[timeline.boneId] = [lerp(a.x, b.x, t), lerp(a.y, b.y, t)];
    }
  for (const timeline of animation.deformTimelines ?? []) {
    const [a, b, t] = segment(timeline.keys, time);
    deforms[timeline.meshId] = a.offsets.map((p, i) => [
      lerp(p[0], b.offsets[i]![0], t),
      lerp(p[1], b.offsets[i]![1], t),
    ]);
  }
  if (
    !Object.values(rotations).every(Number.isFinite) ||
    [
      ...Object.values(translations),
      ...Object.values(scales),
      ...Object.values(deforms).flat(),
    ].some((p) => !p.every(Number.isFinite))
  )
    failStage("animation", "ANIMATION_NUMERIC", "Sampled channels must remain finite");
  return { rotations, translations, scales, deforms };
}
export interface LoopIssue {
  stage: "animation";
  targetId: string;
  channel: "rotation" | "translation" | "scale" | "deform";
  delta: number;
  limit: number;
}
export function validateLoop(
  animation: AnimationSpec,
  rig: RigSpec,
  tolerance = 1e-6,
): { status: "passed" | "failed" | "not-applicable"; score: number; issues: LoopIssue[] } {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    failStage("animation", "LOOP_TOLERANCE", "Positive finite tolerance required");
  const start = sampleAnimation(animation, rig, 0),
    end = sampleAnimation(animation, rig, animation.duration);
  if (!animation.loop) return { status: "not-applicable", score: 0, issues: [] };
  let score = 0;
  const issues: LoopIssue[] = [];
  const add = (targetId: string, channel: LoopIssue["channel"], delta: number) => {
    if (!Number.isFinite(delta) || !Number.isFinite(delta / tolerance))
      failStage("animation", "LOOP_NUMERIC", "Loop comparison overflow");
    score = Math.max(score, delta / tolerance);
    if (delta > tolerance)
      issues.push({ stage: "animation", targetId, channel, delta, limit: tolerance });
  };
  for (const [id, angle] of Object.entries(start.rotations)) {
    const d = Math.abs(angle - end.rotations[id]!) % 360;
    add(id, "rotation", Math.min(d, 360 - d));
  }
  for (const [a, b, channel] of [
    [start.translations, end.translations, "translation"],
    [start.scales, end.scales, "scale"],
  ] as const)
    for (const [id, p] of Object.entries(a))
      add(id, channel, Math.max(Math.abs(p[0] - b[id]![0]), Math.abs(p[1] - b[id]![1])));
  for (const [id, points] of Object.entries(start.deforms))
    add(
      id,
      "deform",
      points.reduce(
        (max, p, i) =>
          Math.max(
            max,
            Math.abs(p[0] - end.deforms[id]![i]![0]),
            Math.abs(p[1] - end.deforms[id]![i]![1]),
          ),
        0,
      ),
    );
  return { status: issues.length ? "failed" : "passed", score, issues };
}
