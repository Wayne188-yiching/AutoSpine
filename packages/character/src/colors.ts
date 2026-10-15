import type { CharacterSpineInput } from "@autospine/spine";
import type { KeyposeEase, MotionPlan } from "@autospine/schemas";
import { easeCurve } from "@autospine/motion";
import { failStage } from "@autospine/rig";
import { num, type Params } from "./joints.js";

export type ColorTimeline = NonNullable<CharacterSpineInput["colorTimelines"]>[number];
type ColorKey = ColorTimeline["keys"][number];

const fail = (code: string, reason: string): never => failStage("animation", code, reason);
const hex2 = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, "0");
/** Setup colour with its alpha multiplied by `alpha` (0..1) and, if given, its RGB replaced. */
function tint(setup: string, alpha: number | undefined, rgb: string | undefined): string {
  const base = (rgb ?? setup.slice(0, 6)).toLowerCase(),
    a = parseInt(setup.slice(6, 8), 16);
  return base + hex2(alpha === undefined ? a : a * alpha);
}

/**
 * Slot colour motion: `pulses` (alpha oscillating between two multipliers of the setup alpha, a
 * sine keyed at its extremes) and `colors` (explicit RGB / alpha keys). In a loop a pulse period
 * must divide the animation and keyed colours close on their first value; a one-shot (ADR-030)
 * ends wherever its pulse is and holds its last colour key.
 */
export function buildColorTimelines(
  motion: MotionPlan,
  rawSetupColors: ReadonlyMap<string, string>,
  params: Params,
): ColorTimeline[] {
  // A slot an animation shows but setup keeps transparent (another pose set faded out, ADR-021)
  // is shown opaque: pulses and colours scale from full alpha, and a hold makes it visible.
  // Swapped-in slots (ADR-027) count as shown: a sequence faded out in setup must still show.
  const swapped = (anim: string) =>
    (motion.swaps ?? [])
      .filter((w) => (w.keys[anim] ?? []).some((k) => k.attachment !== null))
      .map((w) => w.slot);
  const shownSlots = new Set(
    motion.animations.flatMap((a) => [
      ...(a.show ?? []).map((e) => e.split("#")[0]!),
      ...swapped(a.name),
    ]),
  );
  const transparent = (c: string) => parseInt(c.slice(6, 8), 16) <= 5;
  const setupColors = new Map(
    [...rawSetupColors].map(([slot, c]) => [
      slot,
      shownSlots.has(slot) && transparent(c) ? c.slice(0, 6) + "ff" : c,
    ]),
  );
  const fps = motion.fps ?? 30,
    n = (v: Parameters<typeof num>[0], where: string) => num(v, params, where);
  const owner = new Map<string, string>();
  const claim = (slot: string, id: string) => {
    if (!setupColors.has(slot)) fail("PLAN_MOTION_SLOT", `${id}: unknown slot ${slot}`);
    const prev = owner.get(slot);
    if (prev && prev !== id)
      fail("PLAN_MOTION_CONTROL", `Slot ${slot} is coloured by ${prev} and ${id}`);
    owner.set(slot, id);
  };
  for (const p of motion.pulses ?? []) p.slots.forEach((s) => claim(s, p.id));
  for (const c of motion.colors ?? []) c.slots.forEach((s) => claim(s, c.id));
  const out: ColorTimeline[] = [];
  for (const anim of motion.animations) {
    const frames = anim.frames,
      loop = anim.loop !== false;
    for (const p of motion.pulses ?? []) {
      const period =
        p.period === "animation"
          ? frames
          : p.period === "cycle"
            ? motion.cycle
            : Math.round(n(p.period, `${p.id}.period`));
      if (!(period >= 2) || (loop && frames % period !== 0))
        fail(
          "PLAN_MOTION_CYCLE",
          `${p.id}: period ${period} must divide ${anim.name} (${frames} frames)`,
        );
      const low = n(p.low, `${p.id}.low`),
        high = n(p.high, `${p.id}.high`);
      if (!(low >= 0 && high <= 1 && low <= high))
        fail("PLAN_MOTION_VALUE", `${p.id}: need 0 <= low <= high <= 1`);
      p.slots.forEach((slot, i) => {
        const peak = n(p.peak ?? 0, `${p.id}.peak`) + i * n(p.stagger ?? 0, `${p.id}.stagger`);
        const at = (t: number) =>
          low + (high - low) * (0.5 + 0.5 * Math.cos((2 * Math.PI * (t - peak)) / period));
        // Extremes every half period; the loop ends on the value it starts with.
        const frameSet = new Set<number>([0, frames]);
        const first = ((peak % (period / 2)) + period / 2) % (period / 2);
        for (let t = first; t < frames; t += period / 2) frameSet.add(Math.round(t));
        const times = [...frameSet].filter((t) => t >= 0 && t <= frames).sort((a, b) => a - b);
        const setup = setupColors.get(slot)!;
        const keys: ColorKey[] = times.map((t, k) => {
          const next = times[k + 1];
          // Sine between two extremes; a partial edge segment stays linear.
          const extreme = (x: number) =>
            Math.abs(Math.sin((2 * Math.PI * (x - peak)) / period)) < 1e-6;
          const curve =
            next !== undefined && extreme(t) && extreme(next) ? easeCurve("sine") : undefined;
          return {
            time: t / fps,
            color: tint(setup, at(t), undefined),
            ...(curve ? { curve } : {}),
          };
        });
        out.push({ animationName: anim.name, slotName: slot, keys });
      });
    }
    for (const c of motion.colors ?? []) {
      const list = c.keys[anim.name];
      if (!list) continue;
      for (const slot of c.slots) {
        const setup = setupColors.get(slot)!;
        const keyed = [...list]
          .map((k) => ({
            frame: k.frame,
            ease: k.ease as KeyposeEase | undefined,
            color: tint(
              setup,
              k.alpha === undefined ? undefined : n(k.alpha, `${c.id}.alpha`),
              k.color,
            ),
          }))
          .sort((a, b) => a.frame - b.frame);
        if (keyed.some((k) => k.frame > frames))
          fail("PLAN_MOTION_TIMING", `${c.id}: a key lies after ${anim.name} ends`);
        if (keyed[0]!.frame !== 0)
          keyed.unshift({ frame: 0, ease: undefined, color: setup.toLowerCase() });
        if (keyed.at(-1)!.frame !== frames)
          keyed.push({
            frame: frames,
            ease: undefined,
            color: loop ? keyed[0]!.color : keyed.at(-1)!.color,
          });
        // A key's ease shapes the segment arriving at it (KeyposeBeat convention).
        const keys: ColorKey[] = keyed.map((k, i) => {
          const curve = keyed[i + 1] ? easeCurve(keyed[i + 1]!.ease ?? "ease") : undefined;
          return { time: k.frame / fps, color: k.color, ...(curve ? { curve } : {}) };
        });
        out.push({ animationName: anim.name, slotName: slot, keys });
      }
    }
    // Shown slots that setup keeps transparent, with no colour motion of their own: held opaque.
    for (const entry of [...(anim.show ?? []), ...swapped(anim.name)]) {
      const slot = entry.split("#")[0]!,
        raw = rawSetupColors.get(slot);
      if (!raw || !transparent(raw)) continue;
      if (out.some((t) => t.animationName === anim.name && t.slotName === slot)) continue;
      const color = setupColors.get(slot)!.toLowerCase();
      out.push({
        animationName: anim.name,
        slotName: slot,
        keys: [
          { time: 0, color },
          { time: frames / fps, color },
        ],
      });
    }
  }
  return out;
}
