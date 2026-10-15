import type { CharacterPlan, MotionPlan } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { motionFor } from "./motion.js";

type BoneEntry = CharacterPlan["bones"][number];
type Animation = MotionPlan["animations"][number];
type Keyed = NonNullable<MotionPlan["keyed"]>[number];
type Colors = NonNullable<MotionPlan["colors"]>[number];
type Swap = NonNullable<MotionPlan["swaps"]>[number];

/** Motion blocks an animation can carry for itself (ADR-031). */
const BLOCKS = [
  "cycle",
  "params",
  "main",
  "beats",
  "sink",
  "follow",
  "waves",
  "cycles",
  "pulses",
] as const;

/** JSON with sorted keys: equal plans compare equal whatever their key order. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const boneKey = (b: BoneEntry) => ("chain" in b ? `chain:${b.chain.part}` : b.id);
const parentOf = (b: BoneEntry) => ("chain" in b ? b.chain.parent : b.parent);
const withParent = (b: BoneEntry, parent: string | undefined): BoneEntry =>
  "chain" in b ? { chain: { ...b.chain, parent: parent ?? b.chain.parent } } : { ...b, parent };

export interface MergedPlan {
  plan: CharacterPlan;
  /** What the merge decided: inserted parents, renamed blocks, animations with their own motion. */
  notes: string[];
}

/**
 * One character plan from several plans of the same character (ADR-031), so one Spine project
 * holds every animation: the rigs are united, and each animation keeps the motion it was planned
 * with as its own `motion` blocks where they differ from the first plan's.
 *
 * - Joints, meshes, regions and constraints must agree where they overlap.
 * - A bone may differ only by an inserted parent (a one-shot's `move` bone over the root's
 *   children); the deeper parent is kept. Translate keys are authored in world space, so a parent
 *   without keys leaves the other animations unchanged.
 * - Keyed tracks, swaps and colour blocks are joined per animation; a clashing id is renamed.
 *
 * Fails with PLAN_MERGE listing every conflict.
 */
export function mergePlans(
  plans: readonly CharacterPlan[],
  options: { id?: string; name?: string } = {},
): MergedPlan {
  if (plans.length < 2) failStage("build", "PLAN_MERGE", "Merging needs at least two plans");
  const first = plans[0]!;
  const notes: string[] = [];
  const conflicts: string[] = [];

  for (const p of plans.slice(1)) {
    if (!same(p.source, first.source)) conflicts.push(`${p.id}: source differs from ${first.id}`);
    if ((p.artAngle ?? 0) !== (first.artAngle ?? 0))
      conflicts.push(`${p.id}: artAngle differs from ${first.id}`);
    if ((p.motion.fps ?? 30) !== (first.motion.fps ?? 30))
      conflicts.push(`${p.id}: fps differs from ${first.id}`);
  }

  // Joints: one rule per id.
  const joints: CharacterPlan["joints"] = {};
  const jointFrom = new Map<string, string>();
  for (const p of plans)
    for (const [id, rule] of Object.entries(p.joints)) {
      if (id in joints) {
        if (!same(joints[id], rule))
          conflicts.push(`joint ${id}: ${p.id} differs from ${jointFrom.get(id)}`);
      } else {
        joints[id] = rule;
        jointFrom.set(id, p.id);
      }
    }

  // Bones: an ordered union; a parent inserted above a bone (one-shot `move`) is accepted.
  const all = new Map<string, BoneEntry>();
  for (const p of plans) for (const b of p.bones) if (!all.has(boneKey(b))) all.set(boneKey(b), b);
  const bones: BoneEntry[] = [];
  const boneFrom = new Map<string, string>();
  for (const p of plans) {
    let last = -1;
    for (const b of p.bones) {
      const k = boneKey(b);
      const i = bones.findIndex((x) => boneKey(x) === k);
      if (i < 0) {
        bones.splice(last + 1, 0, b);
        boneFrom.set(k, p.id);
        last += 1;
        continue;
      }
      last = Math.max(last, i);
      const have = bones[i]!;
      if (same(have, b)) continue;
      const [pa, pb] = [parentOf(have), parentOf(b)];
      if (same(withParent(have, pb), b)) {
        const over = (deep: string | undefined, shallow: string | undefined) => {
          const d = deep ? all.get(deep) : undefined;
          return !!d && parentOf(d) === shallow;
        };
        if (over(pb, pa)) {
          bones[i] = b;
          notes.push(`bone ${k}: parent ${pb} (inserted by ${p.id}) over ${pa}`);
          continue;
        }
        if (over(pa, pb)) continue;
      }
      conflicts.push(`bone ${k}: ${p.id} differs from ${boneFrom.get(k)}`);
    }
  }

  // Meshes win over regions; a part on two different bones or meshes is a conflict.
  const meshes = new Map<string, NonNullable<CharacterPlan["meshes"]>[number]>();
  for (const p of plans)
    for (const m of p.meshes ?? []) {
      const have = meshes.get(m.part);
      if (have && !same(have, m)) conflicts.push(`mesh ${m.part}: ${p.id} meshes it differently`);
      else meshes.set(m.part, m);
    }
  // A part on an inserted parent (`move`) in one plan and on that bone's parent in another plan,
  // which lacks the inserted bone, is the same part: the deeper bone is kept, as for bones.
  const regions: Record<string, string> = {};
  const regionFrom = new Map<string, CharacterPlan>();
  const parentId = (id: string) => {
    const b = all.get(id);
    return b ? parentOf(b) : undefined;
  };
  const has = (p: CharacterPlan, id: string) => p.bones.some((b) => boneKey(b) === id);
  for (const p of plans)
    for (const [part, bone] of Object.entries(p.regions ?? {})) {
      if (meshes.has(part)) continue;
      const have = regions[part],
        q = regionFrom.get(part);
      if (have === undefined || have === bone) {
        regions[part] = bone;
        regionFrom.set(part, p);
      } else if (parentId(bone) === have && q && !has(q, bone)) {
        regions[part] = bone;
        regionFrom.set(part, p);
      } else if (!(parentId(have) === bone && !has(p, have)))
        conflicts.push(`region ${part}: ${p.id} puts it on ${bone}, another plan on ${have}`);
    }
  for (const p of plans)
    for (const part of Object.keys(p.regions ?? {}))
      if (meshes.has(part)) notes.push(`part ${part}: meshed (a region in ${p.id})`);

  // Other rig blocks must agree where given.
  const agree = <K extends "face" | "constraints">(key: K): CharacterPlan[K] => {
    const given = plans.filter((p) => p[key] !== undefined);
    for (const p of given.slice(1))
      if (!same(p[key], given[0]![key]))
        conflicts.push(`${key}: ${p.id} differs from ${given[0]!.id}`);
    return given[0]?.[key];
  };
  const face = agree("face");
  const constraints = agree("constraints");

  // Motion: the first plan's blocks are shared; each animation keeps what differs as its own.
  const base = first.motion;
  const animations: Animation[] = [];
  const names = new Set<string>();
  const keyed: Keyed[] = [];
  const swaps: Swap[] = [];
  const colors: Colors[] = [];
  for (const p of plans) {
    for (const a of p.motion.animations) {
      if (names.has(a.name)) conflicts.push(`animation ${a.name}: in more than one plan`);
      names.add(a.name);
      const effective = motionFor(p.motion, a) as Record<string, unknown>;
      const shared: Record<string, unknown> = { ...base };
      const own: Record<string, unknown> = {};
      for (const k of BLOCKS) {
        if (same(effective[k], shared[k])) continue;
        own[k] = effective[k] ?? (k === "params" ? {} : []);
      }
      const { motion: _drop, ...rest } = a;
      void _drop;
      animations.push(Object.keys(own).length ? ({ ...rest, motion: own } as Animation) : rest);
      if (Object.keys(own).length)
        notes.push(`animation ${a.name}: its own ${Object.keys(own).join(", ")} (from ${p.id})`);
    }
    for (const k of p.motion.keyed ?? []) {
      const have = keyed.find((x) => x.id === k.id);
      const shape = (x: Keyed) => ({ ...x, keys: undefined });
      if (!have) keyed.push({ ...k, keys: { ...k.keys } });
      else if (same(shape(have), shape(k))) Object.assign(have.keys, k.keys);
      else {
        const id = `${k.id}_${p.id}`.slice(0, 64);
        keyed.push({ ...k, id, keys: { ...k.keys } });
        notes.push(`keyed ${k.id} of ${p.id}: renamed ${id}`);
      }
    }
    for (const s of p.motion.swaps ?? []) {
      const have = swaps.find((x) => x.slot === s.slot);
      if (have) Object.assign(have.keys, s.keys);
      else swaps.push({ ...s, keys: { ...s.keys } });
    }
    for (const c of p.motion.colors ?? []) {
      const have = colors.find((x) => x.id === c.id);
      if (!have) colors.push({ ...c, keys: { ...c.keys } });
      else if (same(have.slots, c.slots)) Object.assign(have.keys, c.keys);
      else {
        const id = `${c.id}_${p.id}`.slice(0, 64);
        colors.push({ ...c, id, keys: { ...c.keys } });
        notes.push(`colors ${c.id} of ${p.id}: renamed ${id}`);
      }
    }
  }

  if (conflicts.length)
    failStage("build", "PLAN_MERGE", `Plans do not merge:\n  ${conflicts.join("\n  ")}`);

  // Review area: the union of the plans' views.
  const views = plans.map((p) => p.qa?.view).filter((v) => v !== undefined);
  const view = views.length
    ? (() => {
        const x0 = Math.min(...views.map((v) => v.x)),
          y1 = Math.max(...views.map((v) => v.y)),
          x1 = Math.max(...views.map((v) => v.x + v.width)),
          y0 = Math.min(...views.map((v) => v.y - v.height));
        return { x: x0, y: y1, width: x1 - x0, height: y1 - y0 };
      })()
    : undefined;
  const { search: _search, ...baseRest } = base;
  void _search;
  if (plans.some((p) => p.motion.search))
    notes.push("motion.search dropped: search one animation's plan");
  const motion = {
    ...baseRest,
    animations,
    ...(keyed.length ? { keyed } : { keyed: undefined }),
    ...(swaps.length ? { swaps } : { swaps: undefined }),
    ...(colors.length ? { colors } : { colors: undefined }),
  } as MotionPlan;
  for (const k of ["keyed", "swaps", "colors"] as const)
    if (motion[k] === undefined) delete motion[k];

  const meshing = plans.some((p) => p.meshing?.all) ? { meshing: { all: true } } : {};
  const plan: CharacterPlan = {
    ...first,
    id: options.id ?? `${first.id}_all`.slice(0, 64),
    name: options.name ?? first.name,
    joints,
    bones,
    ...(meshes.size ? { meshes: [...meshes.values()] } : {}),
    regions,
    ...meshing,
    ...(face ? { face } : {}),
    ...(constraints ? { constraints } : {}),
    motion,
    ...(first.qa ? { qa: { ...first.qa, ...(view ? { view } : {}) } } : {}),
  };
  return { plan, notes };
}
