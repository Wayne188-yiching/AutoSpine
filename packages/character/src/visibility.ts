import type { MotionPlan } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import type { CharacterSpineInput } from "@autospine/spine";

type Slot = CharacterSpineInput["slots"][number];
export type AttachmentTimeline = NonNullable<CharacterSpineInput["attachmentTimelines"]>[number];

/** `slot` or `slot#attachment` -> [slot, attachment?]. */
export const splitPart = (part: string): [string, string | undefined] => {
  const i = part.indexOf("#");
  return i < 0 ? [part, undefined] : [part.slice(0, i), part.slice(i + 1)];
};

/**
 * Part sets per animation (ADR-021): an animation can show a pose set that is hidden in setup and
 * hide the setup set. `show` names a slot (its setup attachment, else its only attachment) or
 * `slot#attachment`; `hide` names slots. Each becomes an attachment key held for the whole
 * animation; animations without lists keep the setup pose's attachments.
 */
export function buildAttachmentTimelines(
  motion: MotionPlan,
  slots: readonly Slot[],
  durations: ReadonlyMap<string, number>,
): AttachmentTimeline[] {
  const out: AttachmentTimeline[] = [];
  for (const anim of motion.animations) {
    if (!anim.show?.length && !anim.hide?.length) continue;
    const duration = durations.get(anim.name)!;
    const seen = new Set<string>();
    const slot = (name: string) => {
      const s = slots.find((x) => x.name === name);
      if (!s) failStage("animation", "PLAN_PART_SET", `${anim.name}: unknown slot ${name}`);
      if (seen.has(name))
        failStage("animation", "PLAN_PART_SET", `${anim.name}: slot ${name} is listed twice`);
      seen.add(name);
      return s;
    };
    const hold = (slotName: string, name: string | null) =>
      out.push({
        animationName: anim.name,
        slotName,
        keys: [
          { time: 0, name },
          { time: duration, name },
        ],
      });
    for (const entry of anim.show ?? []) {
      const [slotName, attachment] = splitPart(entry);
      const s = slot(slotName);
      const name =
        attachment ??
        s.attachment ??
        (s.attachments.length === 1 ? s.attachments[0]!.name : undefined);
      if (!name || !s.attachments.some((a) => a.name === name))
        failStage(
          "animation",
          "PLAN_PART_SET",
          `${anim.name}: show ${entry} needs one attachment; name it as slot#attachment`,
        );
      hold(slotName, name);
    }
    for (const slotName of anim.hide ?? []) {
      slot(slotName);
      hold(slotName, null);
    }
  }
  // Swaps inside an animation (ADR-027) replace that slot's hold: keyed frames, each held until the
  // next; a loop closes on the frame-0 attachment, a one-shot (ADR-030) keeps its last.
  const fps = motion.fps ?? 30;
  for (const sw of motion.swaps ?? [])
    for (const [animName, raw] of Object.entries(sw.keys)) {
      const anim = motion.animations.find((a) => a.name === animName);
      if (!anim)
        failStage(
          "animation",
          "PLAN_SWAP",
          `Swap of ${sw.slot} names unknown animation ${animName}`,
        );
      const s = slots.find((x) => x.name === sw.slot);
      if (!s) failStage("animation", "PLAN_SWAP", `Swap names unknown slot ${sw.slot}`);
      const duration = durations.get(animName)!;
      const held = out.findIndex((t) => t.animationName === animName && t.slotName === sw.slot);
      const start = held >= 0 ? out[held]!.keys[0]!.name : (s.attachment ?? null);
      if (held >= 0) out.splice(held, 1);
      const keys = [...raw].sort((a, b) => a.frame - b.frame);
      for (const k of keys) {
        if (k.frame > anim.frames)
          failStage(
            "animation",
            "PLAN_SWAP",
            `${animName}: swap of ${sw.slot} at ${k.frame} is past the end`,
          );
        if (k.attachment !== null && !s.attachments.some((a) => a.name === k.attachment))
          failStage(
            "animation",
            "PLAN_SWAP",
            `${animName}: ${sw.slot} has no attachment ${k.attachment}`,
          );
      }
      const timeline: AttachmentTimeline["keys"] = [];
      if (keys[0]!.frame > 0) timeline.push({ time: 0, name: start });
      for (const k of keys) {
        const time = Math.min(duration, k.frame / fps);
        const last = timeline.at(-1);
        if (last && Math.abs(last.time - time) < 1e-9) last.name = k.attachment;
        else timeline.push({ time, name: k.attachment });
      }
      // A loop closes on its frame-0 attachment (a sequence wraps to its first image) unless a
      // key sits on the last frame; a one-shot holds its last attachment.
      if (timeline.at(-1)!.time < duration - 1e-9)
        timeline.push({
          time: duration,
          name: anim.loop === false ? timeline.at(-1)!.name : timeline[0]!.name,
        });
      out.push({ animationName: animName, slotName: sw.slot, keys: timeline });
    }
  return out;
}
