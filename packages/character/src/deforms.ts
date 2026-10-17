import type { CharacterPlan, KeyposeEase } from "@autospine/schemas";
import type { CharacterSpineInput } from "@autospine/spine";
import { easeCurve } from "@autospine/motion";
import { failStage } from "@autospine/rig";
import type { Vec } from "./geometry.js";

export type DeformTimeline = NonNullable<CharacterSpineInput["deformTimelines"]>[number];
type Slot = CharacterSpineInput["slots"][number];

const fail = (code: string, reason: string): never => failStage("animation", code, reason);

/**
 * Moving least squares, affine (Schaefer, McPhail & Warren 2006): where point `v` goes when the
 * control points `p` move to `q`, with weights 1 / distance². Fewer than three points, or points in
 * a line, cannot shape an affine map: they translate by their weighted mean move.
 */
export function mlsAffine(p: readonly Vec[], q: readonly Vec[], v: Vec): Vec {
  let sw = 0,
    ps: Vec = [0, 0],
    qs: Vec = [0, 0];
  const w = p.map(([x, y]) => 1 / ((x - v[0]) ** 2 + (y - v[1]) ** 2));
  const on = w.findIndex((x) => !Number.isFinite(x));
  if (on >= 0) return [v[0] + q[on]![0] - p[on]![0], v[1] + q[on]![1] - p[on]![1]];
  w.forEach((wi, i) => {
    sw += wi;
    ps = [ps[0] + wi * p[i]![0], ps[1] + wi * p[i]![1]];
    qs = [qs[0] + wi * q[i]![0], qs[1] + wi * q[i]![1]];
  });
  ps = [ps[0] / sw, ps[1] / sw];
  qs = [qs[0] / sw, qs[1] / sw];
  // A = sum w p^T p, B = sum w p^T q over the centred points (row vectors); M = A^-1 B.
  let a11 = 0,
    a12 = 0,
    a22 = 0,
    b11 = 0,
    b12 = 0,
    b21 = 0,
    b22 = 0;
  w.forEach((wi, i) => {
    const px = p[i]![0] - ps[0],
      py = p[i]![1] - ps[1],
      qx = q[i]![0] - qs[0],
      qy = q[i]![1] - qs[1];
    a11 += wi * px * px;
    a12 += wi * px * py;
    a22 += wi * py * py;
    b11 += wi * px * qx;
    b12 += wi * px * qy;
    b21 += wi * py * qx;
    b22 += wi * py * qy;
  });
  const det = a11 * a22 - a12 * a12;
  if (!(det > 1e-6 * (a11 + a22) ** 2)) return [v[0] + qs[0] - ps[0], v[1] + qs[1] - ps[1]];
  const m11 = (a22 * b11 - a12 * b21) / det,
    m12 = (a22 * b12 - a12 * b22) / det,
    m21 = (a11 * b21 - a12 * b11) / det,
    m22 = (a11 * b22 - a12 * b12) / det;
  const dx = v[0] - ps[0],
    dy = v[1] - ps[1];
  return [dx * m11 + dy * m21 + qs[0], dx * m12 + dy * m22 + qs[1]];
}

/** The mesh attachment a deform part names: `slot` (its setup attachment) or `slot#attachment`. */
function meshOf(slots: readonly Slot[], part: string, id: string) {
  const i = part.indexOf("#"),
    name = i >= 0 ? part.slice(0, i) : part;
  const slot = slots.find((s) => s.name === name);
  if (!slot) return fail("PLAN_MOTION_SLOT", `${id}: unknown part ${part}`);
  const attachment = i >= 0 ? part.slice(i + 1) : (slot.attachment ?? slot.attachments[0]!.name);
  const a = slot.attachments.find((x) => x.name === attachment);
  if (!a) return fail("PLAN_MOTION_SLOT", `${id}: slot ${name} has no attachment ${attachment}`);
  if (a.kind !== "mesh")
    return fail(
      "PLAN_DEFORM_MESH",
      `${id}: ${part} is a region; mesh it (meshes, or meshing.parts) to deform it`,
    );
  return { slotName: name, attachmentName: attachment, vertices: a.mesh.vertices as Vec[] };
}

/**
 * Deform timelines from the plan's `deforms` (ADR-037): per animation and part, one key per keyed
 * frame with every vertex's setup-world offset. Frame 0 is the setup shape unless keyed; a loop
 * closes on frame 0, a one-shot holds its last key.
 */
export function buildDeformTimelines(
  plan: CharacterPlan,
  slots: readonly Slot[],
  durations: ReadonlyMap<string, number>,
): DeformTimeline[] {
  const fps = plan.motion.fps ?? 30;
  const out: DeformTimeline[] = [];
  const owner = new Map<string, string>();
  for (const d of plan.motion.deforms ?? []) {
    const names = Object.keys(d.points),
      at = names.map((n) => d.points[n] as Vec);
    const parts = d.parts.map((part) => meshOf(slots, part, d.id));
    for (const anim of plan.motion.animations) {
      const list = d.keys[anim.name];
      if (!list) continue;
      for (const part of d.parts) {
        const prev = owner.get(anim.name + "\u0000" + part);
        if (prev)
          fail("PLAN_MOTION_CONTROL", `${part} is deformed by ${prev} and ${d.id} in ${anim.name}`);
        owner.set(anim.name + "\u0000" + part, d.id);
      }
      const duration = durations.get(anim.name)!,
        frames = anim.frames,
        loop = anim.loop !== false;
      const keyed: { frame: number; ease?: KeyposeEase; to: Vec[] }[] = [...list]
        .sort((a, b) => a.frame - b.frame)
        .map((k) => {
          for (const n of Object.keys(k.move))
            if (!(n in d.points)) fail("PLAN_MOTION_VALUE", `${d.id}: unknown point ${n}`);
          return {
            frame: k.frame,
            ...(k.ease !== undefined ? { ease: k.ease } : {}),
            to: names.map((n, i) => {
              const m = k.move[n] ?? [0, 0];
              return [at[i]![0] + m[0], at[i]![1] + m[1]] as Vec;
            }),
          };
        });
      if (keyed.some((k, i) => i > 0 && k.frame === keyed[i - 1]!.frame))
        fail("PLAN_MOTION_TIMING", `${d.id}: two keys on one frame of ${anim.name}`);
      if (keyed.at(-1)!.frame > frames)
        fail("PLAN_MOTION_TIMING", `${d.id}: a key lies after ${anim.name} ends`);
      if (keyed[0]!.frame !== 0) keyed.unshift({ frame: 0, to: at });
      if (keyed.at(-1)!.frame !== frames)
        keyed.push({ frame: frames, to: loop ? keyed[0]!.to : keyed.at(-1)!.to });
      for (const part of parts)
        out.push({
          animationName: anim.name,
          slotName: part.slotName,
          attachmentName: part.attachmentName,
          keys: keyed.map((k, i) => {
            const next = keyed[i + 1];
            // A key's ease shapes the segment arriving at it (KeyposeBeat convention).
            const curve = next ? easeCurve(next.ease ?? "ease") : undefined;
            return {
              // The last key sits exactly on the compiled duration (the compiler checks it).
              time: next ? k.frame / fps : duration,
              offsets: part.vertices.map((v) => {
                const f = mlsAffine(at, k.to, v);
                return [+(f[0] - v[0]).toFixed(3), +(f[1] - v[1]).toFixed(3)] as [number, number];
              }),
              ...(curve ? { curve } : {}),
            };
          }),
        });
    }
  }
  return out;
}
