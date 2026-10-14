import type { AnimationSpec, CharacterPlan } from "@autospine/schemas";

export type RestPose = NonNullable<CharacterPlan["motion"]["animations"][number]["pose"]>;

/**
 * Adds a rest pose (ADR-024) to an animation: every key of the bone's rotate and translate
 * timelines is offset, and a bone without one gets a constant timeline. Values are IR offsets
 * from setup (y down, clockwise degrees), like every other bone timeline.
 */
export function applyRestPose(animation: AnimationSpec, pose: RestPose | undefined): AnimationSpec {
  if (!pose || !Object.keys(pose).length) return animation;
  const out = structuredClone(animation);
  const r = (v: number) => +v.toFixed(4);
  for (const [boneId, p] of Object.entries(pose)) {
    if (p.rotate) {
      const tl = (out.rotationTimelines ??= []).find((t) => t.boneId === boneId);
      if (tl) for (const k of tl.keys) k.degrees = r(k.degrees + p.rotate);
      else
        out.rotationTimelines.push({
          boneId,
          keys: [
            { time: 0, degrees: r(p.rotate) },
            { time: out.duration, degrees: r(p.rotate) },
          ],
        });
    }
    if (p.x || p.y) {
      const dx = p.x ?? 0,
        dy = p.y ?? 0;
      const tl = (out.translationTimelines ??= []).find((t) => t.boneId === boneId);
      if (tl)
        for (const k of tl.keys) {
          k.x = r(k.x + dx);
          k.y = r(k.y + dy);
        }
      else
        out.translationTimelines.push({
          boneId,
          keys: [
            { time: 0, x: r(dx), y: r(dy) },
            { time: out.duration, x: r(dx), y: r(dy) },
          ],
        });
    }
  }
  return out;
}
