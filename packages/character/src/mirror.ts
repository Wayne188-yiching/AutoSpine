import type { CharacterPlan } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

type SpineDoc = Record<string, unknown> & {
  bones: { name: string; parent?: string; rotation?: number; transform?: string }[];
  animations?: Record<string, { bones?: Record<string, Record<string, unknown[]>> }>;
};

/**
 * Mirror layers (ADR-035), on the compiled Spine document: each animation's `mirror.bone` gets a
 * stepped scale of -1 over its frame ranges (switching on a range's first frame, back after its
 * last) on the bone axis that lies across the screen (x for a level bone, y for an upright one), so
 * the flip is left to right; and every `keep` bone is set to ignore its parents' scale and
 * reflection, so its drawing stays the right way round while it rides along. The bone ids are the
 * document's bone names.
 */
export function applyMirrors(doc: SpineDoc, plan: CharacterPlan): void {
  const fps = plan.motion.fps ?? 30;
  const parent = new Map(doc.bones.map((b) => [b.name, b.parent]));
  const rotation = new Map(doc.bones.map((b) => [b.name, b.rotation ?? 0]));
  // Setup world angle (the rig has no setup reflection): the sum of local rotations to the root.
  const worldAngle = (id: string) => {
    let a = rotation.get(id) ?? 0;
    for (let p = parent.get(id); p; p = parent.get(p)) a += rotation.get(p) ?? 0;
    return a;
  };
  const ancestors = (id: string) => {
    const out: string[] = [];
    for (let p = parent.get(id); p; p = parent.get(p)) out.push(p);
    return out;
  };
  const kept = new Map<string, string>();
  const mirrorBone = new Map<string, string>();
  for (const a of plan.motion.animations) {
    const m = a.mirror;
    if (!m) continue;
    if (!parent.has(m.bone))
      failStage("build", "PLAN_MIRROR_BONE", `${a.name}: mirror bone ${m.bone} is not in the rig`);
    const anim = ((doc.animations ??= {})[a.name] ??= {});
    const timelines = ((anim.bones ??= {})[m.bone] ??= {});
    if (timelines.scale)
      failStage(
        "build",
        "PLAN_MIRROR_BONE",
        `${a.name}: ${m.bone} already scales in this animation; mirror a bone without its own scale keys (the base)`,
      );
    // Left to right on screen: the bone axis within 5 degrees of horizontal is the one flipped.
    const angle = ((worldAngle(m.bone) % 180) + 180) % 180;
    const level = Math.min(angle, 180 - angle) <= 5,
      upright = Math.abs(angle - 90) <= 5;
    if (!level && !upright)
      failStage(
        "build",
        "PLAN_MIRROR_BONE",
        `${a.name}: ${m.bone} lies at ${angle.toFixed(1)}°; mirror a bone that is level or upright (the base)`,
      );
    const ranges = [...m.frames].sort((x, y) => x[0] - y[0]);
    const keys: Record<string, unknown>[] = [];
    const key = (frame: number, flip: number, stepped: boolean) =>
      keys.push({
        time: frame / fps,
        x: level ? flip : 1,
        y: level ? 1 : flip,
        ...(stepped ? { curve: "stepped" } : {}),
      });
    if (ranges[0]![0] > 0) key(0, 1, true);
    ranges.forEach(([from, to], i) => {
      key(from, -1, true);
      // A loop ends the way it started; a one-shot may end mirrored.
      if (to + 1 <= a.frames) key(to + 1, 1, i < ranges.length - 1);
    });
    timelines.scale = keys;
    mirrorBone.set(a.name, m.bone);
    for (const k of m.keep ?? []) {
      if (!ancestors(k).includes(m.bone))
        failStage("build", "PLAN_MIRROR_KEEP", `${a.name}: kept bone ${k} is not under ${m.bone}`);
      kept.set(k, a.name);
    }
  }
  if (!kept.size) return;
  // A kept bone stops following its parents' scale in every animation: refuse when one has any.
  for (const [name, anim] of Object.entries(doc.animations ?? {}))
    for (const [b, timelines] of Object.entries(anim.bones ?? {})) {
      if (!timelines.scale || mirrorBone.get(name) === b) continue;
      for (const [k] of kept)
        if (ancestors(k).includes(b))
          failStage(
            "build",
            "PLAN_MIRROR_KEEP",
            `${k} is kept the right way round, so it would no longer follow the scale of ${b} in ${name}`,
          );
    }
  for (const b of doc.bones) if (kept.has(b.name)) b.transform = "noScaleOrReflection";
}
