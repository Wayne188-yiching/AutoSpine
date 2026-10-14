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
  return out;
}
