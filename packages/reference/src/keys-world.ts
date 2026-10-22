import { pose, spineRuntime, type LoadedSkeleton } from "./runtime.js";

/**
 * The played result of an animation, for key reduction (ADR-044): what the official runtime draws
 * at a time, after the bone hierarchy, weights, IK, transform and path constraints and deform keys,
 * in skeleton units (Spine's px at scale 1, y up).
 */
export interface Pose {
  /** Attachment shown per slot index (null: none). */
  atts: (string | null)[];
  /** World vertices per slot index (regions: 4 corners; meshes: every vertex). */
  verts: (Float32Array | null)[];
  /** Slot alpha × attachment alpha per slot index. */
  alpha: Float32Array;
  /** Draw order, slot indices joined. */
  order: string;
  /** Per bone: world x, world y, world rotation (degrees), world scale. */
  bones: Float32Array;
}
interface RuntimeBone {
  worldX: number;
  worldY: number;
  a: number;
  b: number;
  c: number;
  d: number;
  getWorldRotationX(): number;
}
interface RuntimeSlot {
  data: { index: number };
  color: { a: number };
  bone: unknown;
  getAttachment(): {
    name: string;
    color: { a: number };
    worldVerticesLength?: number;
    computeWorldVertices(...args: unknown[]): void;
  } | null;
}
/** Poses an animation at `time` (over the setup pose; null: the setup pose) and reads what it draws. */
export function samplePose(sk: LoadedSkeleton, animation: string | null, time: number): Pose {
  const spine = spineRuntime() as unknown as {
    RegionAttachment: abstract new (...a: never[]) => unknown;
    MeshAttachment: abstract new (...a: never[]) => unknown;
  };
  pose(sk, animation, time);
  const slots = sk.skeleton.slots as unknown as RuntimeSlot[];
  const atts: (string | null)[] = new Array(slots.length).fill(null);
  const verts: (Float32Array | null)[] = new Array(slots.length).fill(null);
  const alpha = new Float32Array(slots.length);
  slots.forEach((slot, i) => {
    const att = slot.getAttachment();
    if (!att) return;
    atts[i] = att.name;
    alpha[i] = slot.color.a * att.color.a;
    if (att instanceof spine.RegionAttachment) {
      const v = new Array<number>(8).fill(0);
      att.computeWorldVertices(slot.bone, v, 0, 2);
      verts[i] = Float32Array.from(v);
    } else if (att instanceof spine.MeshAttachment) {
      const n = att.worldVerticesLength!;
      const v = new Array<number>(n).fill(0);
      att.computeWorldVertices(slot, 0, n, v, 0, 2);
      verts[i] = Float32Array.from(v);
    }
  });
  const order = (sk.skeleton.drawOrder as unknown as RuntimeSlot[])
    .map((s) => s.data.index)
    .join(",");
  const bs = sk.skeleton.bones as unknown as RuntimeBone[];
  const bones = new Float32Array(bs.length * 4);
  bs.forEach((b, i) => {
    bones[i * 4] = b.worldX;
    bones[i * 4 + 1] = b.worldY;
    bones[i * 4 + 2] = b.getWorldRotationX();
    bones[i * 4 + 3] = Math.sqrt(Math.abs(b.a * b.d - b.b * b.c));
  });
  return { atts, verts, alpha, order, bones };
}

/** A slot counts as drawn when it shows something not fully transparent. */
const VISIBLE = 0.002;
export interface PoseDifference {
  /** Largest vertex distance, px. */
  max: number;
  /** Slot index of the largest distance (-1: none). */
  slot: number;
  /** Sum of squared vertex distances and vertex count (for RMS). */
  sumSq: number;
  count: number;
  /** Slots that show a different attachment, or are visible in only one. */
  stateMismatches: number[];
  /** Draw order differs. */
  orderMismatch: boolean;
  /** Per-slot largest distance (only slots compared). */
  perSlot: Map<number, number>;
}
/** Vertex distances between two poses of the same skeleton, over the slots visible in either. */
export function poseDifference(a: Pose, b: Pose): PoseDifference {
  let max = 0,
    slot = -1,
    sumSq = 0,
    count = 0;
  const stateMismatches: number[] = [],
    perSlot = new Map<number, number>();
  for (let i = 0; i < a.atts.length; i++) {
    const va = a.alpha[i]! > VISIBLE && a.atts[i] !== null,
      vb = b.alpha[i]! > VISIBLE && b.atts[i] !== null;
    if (!va && !vb) continue;
    if (va !== vb || a.atts[i] !== b.atts[i]) {
      stateMismatches.push(i);
      continue;
    }
    const pa = a.verts[i],
      pb = b.verts[i];
    if (!pa || !pb || pa.length !== pb.length) continue;
    let slotMax = 0;
    for (let k = 0; k + 1 < pa.length; k += 2) {
      const d2 = (pa[k]! - pb[k]!) ** 2 + (pa[k + 1]! - pb[k + 1]!) ** 2;
      sumSq += d2;
      count++;
      if (d2 > slotMax) slotMax = d2;
    }
    slotMax = Math.sqrt(slotMax);
    perSlot.set(i, slotMax);
    if (slotMax > max) [max, slot] = [slotMax, i];
  }
  return { max, slot, sumSq, count, stateMismatches, orderMismatch: a.order !== b.order, perSlot };
}

type Raw = Record<string, unknown>;
/** Bone hierarchy and what each slot's drawing depends on, from the document. */
export interface Influence {
  bones: string[];
  parent: number[];
  slots: string[];
  /** Bone indices that move each slot's vertices (its bone or weighted bones, their ancestors, constraint targets). */
  slotBones: Set<number>[];
  /** Constraint name -> constrained bone indices and target bone index. */
  constraints: Map<string, { kind: "ik" | "transform" | "path"; bones: number[]; target: number }>;
}
export function influence(doc: Raw): Influence {
  const bones = (doc.bones as Raw[]).map((b) => String(b.name));
  const index = new Map(bones.map((b, i) => [b, i]));
  const parent = (doc.bones as Raw[]).map((b) =>
    b.parent === undefined ? -1 : (index.get(String(b.parent)) ?? -1),
  );
  const slots = (doc.slots as Raw[]).map((s) => String(s.name));
  const slotBone = (doc.slots as Raw[]).map((s) => index.get(String(s.bone)) ?? 0);
  const constraints = new Map<
    string,
    { kind: "ik" | "transform" | "path"; bones: number[]; target: number }
  >();
  for (const kind of ["ik", "transform", "path"] as const)
    for (const c of (doc[kind] ?? []) as Raw[]) {
      const target =
        kind === "path"
          ? (slotBone[slots.indexOf(String(c.target))] ?? 0)
          : (index.get(String(c.target)) ?? 0);
      constraints.set(String(c.name), {
        kind,
        bones: (c.bones as string[]).map((b) => index.get(b) ?? 0),
        target,
      });
    }
  const ancestors = (b: number, into: Set<number>) => {
    for (let x = b; x >= 0 && !into.has(x); x = parent[x]!) into.add(x);
  };
  // Every bone a slot's attachments are weighted to, over every skin.
  const weighted = slots.map(() => new Set<number>());
  for (const skin of (doc.skins ?? []) as { attachments?: Record<string, Record<string, Raw>> }[])
    for (const [slot, atts] of Object.entries(skin.attachments ?? {})) {
      const si = slots.indexOf(slot);
      if (si < 0) continue;
      for (const att of Object.values(atts)) {
        const v = att.vertices as number[] | undefined,
          uv = att.uvs as number[] | undefined;
        if (!v || !uv || v.length === uv.length) continue;
        for (let i = 0; i < v.length;) {
          const n = v[i]!;
          for (let j = 0; j < n; j++) weighted[si]!.add(v[i + 1 + j * 4]!);
          i += 1 + n * 4;
        }
      }
    }
  const slotBones = slots.map((_, si) => {
    const set = new Set<number>();
    ancestors(slotBone[si]!, set);
    for (const b of weighted[si]!) ancestors(b, set);
    // Constraints move their bones towards targets: the targets' chains matter too.
    for (let grew = true; grew;) {
      grew = false;
      for (const c of constraints.values())
        if (c.bones.some((b) => set.has(b)) && !set.has(c.target)) {
          ancestors(c.target, set);
          grew = true;
        }
    }
    return set;
  });
  return { bones, parent, slots, slotBones, constraints };
}

/**
 * How far each bone's motion reaches on screen: the largest distance from the bone to a vertex it
 * moves, over the given poses. A degree of rotation moves a vertex that far by reach × π/180 px.
 */
export function boneReach(inf: Influence, poses: Pose[]): Float64Array {
  const reach = new Float64Array(inf.bones.length);
  for (const p of poses)
    p.verts.forEach((v, si) => {
      if (!v || p.alpha[si]! <= VISIBLE) return;
      for (const b of inf.slotBones[si]!) {
        const bx = p.bones[b * 4]!,
          by = p.bones[b * 4 + 1]!;
        let r = reach[b]!;
        for (let k = 0; k + 1 < v.length; k += 2) {
          const d = Math.hypot(v[k]! - bx, v[k + 1]! - by);
          if (d > r) r = d;
        }
        reach[b] = r;
      }
    });
  return reach;
}

/** Largest world scale of each bone's parent over the poses (a local px moves this many world px). */
export function parentScale(inf: Influence, poses: Pose[]): Float64Array {
  const out = new Float64Array(inf.bones.length).fill(1);
  inf.parent.forEach((p, b) => {
    if (p < 0) return;
    let s = 0;
    for (const q of poses) s = Math.max(s, q.bones[p * 4 + 3]!);
    out[b] = s || 1;
  });
  return out;
}
