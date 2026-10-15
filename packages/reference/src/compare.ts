import type { AnimationSpec, CharacterPlan } from "@autospine/schemas";
import {
  animationKeyStats,
  measurePerformance,
  reviewPerformance,
  targetBand,
  type PerformanceProfile,
} from "@autospine/planning";
import {
  drawList,
  frameTime,
  loadSkeleton,
  pose,
  type DrawItem,
  type LoadedSkeleton,
} from "./runtime.js";
import { flatten, render, sheet, type Texture } from "./render.js";

type Json = Record<string, unknown>;
type V2 = [number, number];
export type Probes = NonNullable<NonNullable<CharacterPlan["qa"]>["probes"]>;

/** Per-slot samples over one animation at a fixed frame rate (Spine world, y up). */
export interface SlotTrack {
  c: (V2 | null)[];
  a: number[];
  att: (string | null)[];
  verts: (number[] | null)[];
  tris?: number[];
  uvs?: number[];
  path?: string;
}
export interface Tracks {
  duration: number;
  frames: number;
  tr: Record<string, SlotTrack>;
}
/** Samples every slot's vertex centroid, alpha, attachment and vertices at each frame. */
export function sampleTracks(
  sk: LoadedSkeleton,
  animation: string,
  fps: number,
  withVertices = true,
): Tracks {
  const a = sk.data.findAnimation(animation);
  if (!a) throw new Error(`REFERENCE_ANIMATION: no animation ${animation}`);
  const D = a.duration,
    N = Math.round(D * fps),
    tr: Record<string, SlotTrack> = {};
  for (const slot of sk.skeleton.slots) tr[slot.data.name] = { c: [], a: [], att: [], verts: [] };
  for (let f = 0; f <= N; f++) {
    pose(sk, animation, frameTime(f, N, D, fps));
    const seen = new Set<string>();
    for (const d of drawList(sk)) {
      seen.add(d.slot);
      const t = tr[d.slot]!;
      let sx = 0,
        sy = 0;
      const n = d.verts.length / 2;
      for (let i = 0; i < n; i++) {
        sx += d.verts[2 * i]!;
        sy += d.verts[2 * i + 1]!;
      }
      t.c.push([sx / n, sy / n]);
      t.a.push(d.color[3]);
      t.att.push(d.attachment);
      t.verts.push(withVertices ? d.verts.slice() : null);
      t.tris ??= d.tris;
      t.uvs ??= d.uvs;
      t.path ??= d.path;
    }
    for (const [name, t] of Object.entries(tr))
      if (!seen.has(name)) {
        t.c.push(null);
        t.a.push(0);
        t.att.push(null);
        t.verts.push(null);
      }
  }
  return { duration: D, frames: N, tr };
}

export interface StructureStats {
  bones: number;
  slots: number;
  attachments: Record<string, number>;
  meshVertices: number;
  meshTriangles: number;
  weightedMeshes: number;
  meanInfluences: number;
  ik: number;
  transform: number;
  path: number;
  animations: Record<
    string,
    {
      duration: number;
      boneTimelines: number;
      boneKeys: number;
      movingBoneTimelines: number;
      slotTimelines: number;
      deformTimelines: number;
      drawOrder: boolean;
      events: boolean;
      keyDensity: number;
      movingKeys: number;
    }
  >;
}
/** Counts from a Spine JSON document (moving = a timeline whose keys are not all equal). */
export function structureOf(sk: LoadedSkeleton): StructureStats {
  const j = sk.raw as Json;
  const types: Record<string, number> = {};
  let meshVerts = 0,
    tris = 0,
    weighted = 0,
    infl = 0,
    infN = 0;
  for (const s of j.skins as Json[])
    for (const atts of Object.values(s.attachments as Record<string, Record<string, Json>>))
      for (const a of Object.values(atts)) {
        const t = (a.type as string | undefined) ?? "region";
        types[t] = (types[t] ?? 0) + 1;
        if (t === "mesh") {
          const uvs = a.uvs as number[],
            v = a.vertices as number[],
            n = uvs.length / 2;
          meshVerts += n;
          tris += (a.triangles as number[]).length / 3;
          if (v.length > n * 2) {
            weighted++;
            let i = 0;
            while (i < v.length) {
              const k = v[i]!;
              infl += k;
              infN++;
              i += 1 + k * 4;
            }
          }
        }
      }
  const key = (k: Json) => JSON.stringify({ ...k, time: 0, curve: 0, c2: 0, c3: 0, c4: 0 });
  const animations: StructureStats["animations"] = {};
  for (const [name, a] of Object.entries((j.animations ?? {}) as Record<string, Json>)) {
    const boneTl = Object.values((a.bones ?? {}) as Record<string, Record<string, Json[]>>).flatMap(
      (b) => Object.values(b),
    );
    const moving = boneTl.filter((tl) => new Set(tl.map(key)).size > 1);
    const D = sk.data.findAnimation(name)!.duration;
    const movingKeys = moving.reduce((n, t) => n + t.length, 0);
    animations[name] = {
      duration: +D.toFixed(4),
      boneTimelines: boneTl.length,
      boneKeys: boneTl.reduce((n, t) => n + t.length, 0),
      movingBoneTimelines: moving.length,
      slotTimelines: Object.values((a.slots ?? {}) as Record<string, Json>).reduce(
        (n, s) => n + Object.keys(s).length,
        0,
      ),
      deformTimelines: Object.values(
        (a.deform ?? {}) as Record<string, Record<string, Json>>,
      ).reduce((n, s) => n + Object.values(s).reduce((m, x) => m + Object.keys(x).length, 0), 0),
      drawOrder: !!(a.drawOrder ?? a.draworder),
      events: !!a.events,
      keyDensity: moving.length ? +(movingKeys / (moving.length * D)).toFixed(3) : 0,
      movingKeys,
    };
  }
  return {
    bones: (j.bones as Json[]).length,
    slots: (j.slots as Json[]).length,
    attachments: types,
    meshVertices: meshVerts,
    meshTriangles: tris,
    weightedMeshes: weighted,
    meanInfluences: infN ? +(infl / infN).toFixed(2) : 0,
    ik: ((j.ik ?? []) as Json[]).length,
    transform: ((j.transform ?? []) as Json[]).length,
    path: ((j.path ?? []) as Json[]).length,
    animations,
  };
}

/** Worst distance of `b`'s vertices from where `a` places the same UV (setup pose). */
export function placementDelta(
  a: LoadedSkeleton,
  b: LoadedSkeleton,
): Record<string, number | null> {
  pose(a, null, 0);
  pose(b, null, 0);
  const la = new Map(drawList(a).map((d) => [d.slot, d]));
  const out: Record<string, number | null> = {};
  for (const d of drawList(b)) {
    const r = la.get(d.slot);
    if (!r) {
      out[d.slot] = null;
      continue;
    }
    let worst = 0;
    for (let i = 0; i < d.verts.length / 2; i++) {
      const u = d.uvs[2 * i]!,
        v = d.uvs[2 * i + 1]!;
      let p: V2 | null = null;
      for (let k = 0; k < r.tris.length && !p; k += 3) {
        const [i0, i1, i2] = [r.tris[k]!, r.tris[k + 1]!, r.tris[k + 2]!];
        const x0 = r.uvs[2 * i0]!,
          y0 = r.uvs[2 * i0 + 1]!,
          x1 = r.uvs[2 * i1]!,
          y1 = r.uvs[2 * i1 + 1]!,
          x2 = r.uvs[2 * i2]!,
          y2 = r.uvs[2 * i2 + 1]!;
        const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(den) < 1e-12) continue;
        const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / den,
          l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / den,
          l2 = 1 - l0 - l1;
        if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
        p = [
          l0 * r.verts[2 * i0]! + l1 * r.verts[2 * i1]! + l2 * r.verts[2 * i2]!,
          l0 * r.verts[2 * i0 + 1]! + l1 * r.verts[2 * i1 + 1]! + l2 * r.verts[2 * i2 + 1]!,
        ];
      }
      if (p)
        worst = Math.max(worst, Math.hypot(p[0] - d.verts[2 * i]!, p[1] - d.verts[2 * i + 1]!));
    }
    out[d.slot] = +worst.toFixed(3);
  }
  return out;
}

/** Where an attachment puts a UV (barycentric in its UV triangles), or null outside them. */
function atUv(uvs: number[], tris: number[], verts: number[], u: number, v: number): V2 | null {
  for (let k = 0; k < tris.length; k += 3) {
    const [i0, i1, i2] = [tris[k]!, tris[k + 1]!, tris[k + 2]!];
    const x0 = uvs[2 * i0]!,
      y0 = uvs[2 * i0 + 1]!,
      x1 = uvs[2 * i1]!,
      y1 = uvs[2 * i1 + 1]!,
      x2 = uvs[2 * i2]!,
      y2 = uvs[2 * i2 + 1]!;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    const l0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / den,
      l1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / den,
      l2 = 1 - l0 - l1;
    if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
    return [
      l0 * verts[2 * i0]! + l1 * verts[2 * i1]! + l2 * verts[2 * i2]!,
      l0 * verts[2 * i0 + 1]! + l1 * verts[2 * i1 + 1]! + l2 * verts[2 * i2 + 1]!,
    ];
  }
  return null;
}
/**
 * Rest pose (ADR-024): on frame 0, the mean distance between where the artist's and the generated
 * attachment put the same UV, over both sides' vertices, for slots both sides show.
 */
export function restPoseDelta(art: Tracks, gen: Tracks): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slot, g] of Object.entries(gen.tr)) {
    const r = art.tr[slot];
    const gv = g.verts[0],
      rv = r?.verts[0];
    if (!r || !gv || !rv || !g.uvs || !r.uvs || !g.tris || !r.tris) continue;
    if (g.a[0]! <= 0.02 || r.a[0]! <= 0.02) continue;
    let sum = 0,
      n = 0;
    for (const [from, to] of [
      [g, r],
      [r, g],
    ] as const) {
      const fv = from.verts[0]!,
        tv = to.verts[0]!;
      for (let i = 0; i < fv.length / 2; i++) {
        const q = atUv(to.uvs!, to.tris!, tv, from.uvs![2 * i]!, from.uvs![2 * i + 1]!);
        if (!q) continue;
        sum += Math.hypot(q[0] - fv[2 * i]!, q[1] - fv[2 * i + 1]!);
        n++;
      }
    }
    if (n) out[slot] = +(sum / n).toFixed(2);
  }
  return out;
}

export interface SlotMotion {
  visible: boolean;
  peakPx?: number;
  peakFrame?: number;
  deformPx?: number;
  alphaRange?: number;
  attachmentSwitch?: boolean;
  moves?: boolean;
}
export function slotMotion(s: SlotTrack): SlotMotion {
  const cs = s.c.filter((c): c is V2 => !!c);
  if (!cs.length) return { visible: false };
  const c0 = cs[0]!;
  let peak = 0,
    peakF = 0;
  s.c.forEach((c, f) => {
    if (!c) return;
    const d = Math.hypot(c[0] - c0[0], c[1] - c0[1]);
    if (d > peak) {
      peak = d;
      peakF = f;
    }
  });
  // In-mesh deformation: largest vertex displacement after removing the centroid motion.
  let deform = 0;
  const v0 = s.verts.find((v): v is number[] => !!v),
    i0 = v0 ? s.verts.indexOf(v0) : -1;
  if (v0)
    s.verts.forEach((v, f) => {
      if (!v || v.length !== v0.length) return;
      const dc = [s.c[f]![0] - s.c[i0]![0], s.c[f]![1] - s.c[i0]![1]];
      for (let i = 0; i < v.length; i += 2)
        deform = Math.max(
          deform,
          Math.hypot(v[i]! - v0[i]! - dc[0]!, v[i + 1]! - v0[i + 1]! - dc[1]!),
        );
    });
  const aRange = Math.max(...s.a) - Math.min(...s.a);
  const attSwitch = new Set(s.att).size > 1;
  return {
    visible: true,
    peakPx: +peak.toFixed(2),
    peakFrame: peakF,
    deformPx: +deform.toFixed(2),
    alphaRange: +aRange.toFixed(3),
    attachmentSwitch: attSwitch,
    moves: peak > 0.5 || deform > 0.5 || aRange > 0.05 || attSwitch,
  };
}
const pearson = (x: number[], y: number[]) => {
  const n = x.length,
    mx = x.reduce((s, v) => s + v, 0) / n,
    my = y.reduce((s, v) => s + v, 0) / n;
  let a = 0,
    b = 0,
    c = 0;
  for (let i = 0; i < n; i++) {
    a += (x[i]! - mx) * (y[i]! - my);
    b += (x[i]! - mx) ** 2;
    c += (y[i]! - my) ** 2;
  }
  return b > 1e-9 && c > 1e-9 ? a / Math.sqrt(b * c) : null;
};

export interface DeformationSummary {
  inversions: Record<string, number>;
  visibleInversions: Record<string, number>;
  maxCharacterStretch: { slot: string; value: number } | null;
  topStretch: [string, number][];
}
/**
 * Triangle inversions (and those over 25% alpha) and edge stretch against the setup pose. An
 * attachment the animation swaps in (a sequence image, an eyelid) is measured against its own
 * geometry on the setup bones, not against the slot's setup attachment.
 */
export function deformationQA(
  sk: LoadedSkeleton,
  animation: string,
  fps: number,
  alpha: ((path: string) => { width: number; height: number; alpha: Uint8Array }) | undefined,
  exclude: RegExp[],
): DeformationSummary {
  pose(sk, null, 0);
  const setup = new Map(drawList(sk).map((d) => [d.slot, d]));
  const area = (v: number[], a: number, b: number, c: number) =>
    (v[2 * b]! - v[2 * a]!) * (v[2 * c + 1]! - v[2 * a + 1]!) -
    (v[2 * b + 1]! - v[2 * a + 1]!) * (v[2 * c]! - v[2 * a]!);
  const D = sk.data.findAnimation(animation)!.duration,
    N = Math.round(D * fps);
  const rest = new Map<string, DrawItem | null>();
  const restOf = (d: DrawItem): DrawItem | null => {
    const key = d.slot + "\u0000" + d.attachment;
    if (!rest.has(key)) {
      const s0 = setup.get(d.slot);
      if (s0 && s0.attachment === d.attachment) rest.set(key, s0);
      else {
        // The frame's draw list is already built; the next frame poses the skeleton again.
        pose(sk, null, 0);
        sk.skeleton.setAttachment(d.slot, d.attachment);
        sk.skeleton.findSlot(d.slot)!.color.a = 1;
        rest.set(key, drawList(sk).find((x) => x.slot === d.slot) ?? null);
      }
    }
    return rest.get(key)!;
  };
  const inv: Record<string, number> = {},
    visible: Record<string, number> = {},
    stretch: Record<string, number> = {};
  for (let f = 0; f <= N; f++) {
    pose(sk, animation, frameTime(f, N, D, fps));
    for (const d of drawList(sk)) {
      const s0 = restOf(d);
      if (!s0 || d.tris.length < 6 || s0.verts.length !== d.verts.length) continue;
      const tex = alpha?.(d.path);
      let n = 0,
        nv = 0,
        st = 0;
      for (let k = 0; k < d.tris.length; k += 3) {
        const [a, b, c] = [d.tris[k]!, d.tris[k + 1]!, d.tris[k + 2]!];
        const A0 = area(s0.verts, a, b, c),
          A1 = area(d.verts, a, b, c);
        if (Math.abs(A0) > 1e-6 && A1 / A0 < 0) {
          n++;
          let amax = tex ? 0 : 1;
          if (tex)
            for (const [u, v] of [
              [
                (d.uvs[2 * a]! + d.uvs[2 * b]! + d.uvs[2 * c]!) / 3,
                (d.uvs[2 * a + 1]! + d.uvs[2 * b + 1]! + d.uvs[2 * c + 1]!) / 3,
              ],
              [d.uvs[2 * a]!, d.uvs[2 * a + 1]!],
              [d.uvs[2 * b]!, d.uvs[2 * b + 1]!],
              [d.uvs[2 * c]!, d.uvs[2 * c + 1]!],
            ] as V2[]) {
              const x = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width))),
                y = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height)));
              amax = Math.max(amax, (tex.alpha[y * tex.width + x]! / 255) * d.color[3]);
            }
          if (amax > 0.25) nv++;
        }
        for (const [p, q] of [
          [a, b],
          [b, c],
          [c, a],
        ] as V2[]) {
          const l0 = Math.hypot(
            s0.verts[2 * q]! - s0.verts[2 * p]!,
            s0.verts[2 * q + 1]! - s0.verts[2 * p + 1]!,
          );
          const l1 = Math.hypot(
            d.verts[2 * q]! - d.verts[2 * p]!,
            d.verts[2 * q + 1]! - d.verts[2 * p + 1]!,
          );
          if (l0 > 2) st = Math.max(st, Math.abs(l1 / l0 - 1));
        }
      }
      if (n) inv[d.slot] = Math.max(inv[d.slot] ?? 0, n);
      if (nv) visible[d.slot] = Math.max(visible[d.slot] ?? 0, nv);
      stretch[d.slot] = Math.max(stretch[d.slot] ?? 0, st);
    }
  }
  const character = Object.entries(stretch)
    .filter(([s]) => !exclude.some((re) => re.test(s)))
    .sort((x, y) => y[1] - x[1]);
  return {
    inversions: inv,
    visibleInversions: visible,
    maxCharacterStretch: character[0]
      ? { slot: character[0][0], value: +character[0][1].toFixed(3) }
      : null,
    topStretch: character.slice(0, 6).map(([s, v]) => [s, +v.toFixed(3)]),
  };
}

/** Probe parts as a performance sample (missing frames repeat the first visible centroid). */
export function performanceSample(t: Tracks, probes: Probes, fps: number, unit: number) {
  const parts: Record<string, string> = {};
  if (probes.face) parts.face = probes.face;
  if (probes.eyes) parts.eyes = probes.eyes;
  if (probes.pupils) parts.pupils = probes.pupils;
  for (const [name, part] of probes.chain ?? []) parts[name] = part;
  if (probes.hand) parts[probes.hand[0]] = probes.hand[1];
  const sample: Record<string, V2[]> = {};
  for (const [k, part] of Object.entries(parts)) {
    // Tracks are per slot: a `slot#image` part (a slot with no setup image) is its slot.
    const slot = part.split("#")[0]!;
    const tr = t.tr[slot];
    if (!tr) throw new Error(`REFERENCE_PROBE: probe ${k} uses unknown part ${part}`);
    // A part never shown in this animation is no probe: its metrics are missing, not invented.
    const first = tr.c.find(Boolean);
    if (first) sample[k] = tr.c.map((c) => c ?? first);
  }
  return { fps, unit, yDown: false, probes: sample };
}
/** Chain and hand options for the probes a sample actually has (all chain probes, or none). */
export const probeOptions = (probes: Probes, present?: Record<string, unknown>) => {
  const has = (n: string) => !present || n in present;
  const chain = probes.chain?.map(([n]) => n);
  const full = chain !== undefined && chain.every(has);
  return {
    ...(full ? { chain } : {}),
    ...(full && probes.hand && has(probes.hand[0]) ? { hand: probes.hand[0] } : {}),
  };
};

/** The artist side, measured once: tracks, structure, per-slot motion and performance profiles. */
export interface PreparedReference {
  skeleton: LoadedSkeleton;
  structure: StructureStats;
  fps: number;
  unit: number;
  animations: string[];
  tracks: Record<string, Tracks>;
  motion: Record<string, Record<string, SlotMotion>>;
  profiles: Record<string, PerformanceProfile>;
  metrics: Record<string, Record<string, number>>;
  maxCharacterStretch: Record<string, number>;
  deformation: Record<string, DeformationSummary>;
}
export interface ReferenceOptions {
  probes: Probes;
  fps?: number;
  deformExclude?: string[];
  alpha?: (path: string) => { width: number; height: number; alpha: Uint8Array };
  /** Character name for profile ids and sources (default "reference"). */
  name?: string;
  /**
   * Looping animations: phase-invariant chain metrics (ADR-020) and the loop seam. true for all,
   * or the names of the loops; a one-shot (ADR-030) gets neither.
   */
  loop?: boolean | readonly string[];
}
/** Whether `animation` loops under `options.loop`. */
export function loops(options: Pick<ReferenceOptions, "loop">, animation: string): boolean {
  return Array.isArray(options.loop) ? options.loop.includes(animation) : options.loop === true;
}
/** Head width of the images-only setup: the unit of every performance metric. */
export function headUnit(imagesOnly: LoadedSkeleton, part: string): number {
  pose(imagesOnly, null, 0);
  // A head hidden in setup (another pose set, ADR-021) is measured on its own attachment; a part
  // named `slot#image` (a slot with no setup image) on that image.
  const [slotName, image] = part.split("#") as [string, string | undefined];
  const slot = imagesOnly.skeleton.findSlot(slotName);
  if (slot && (image !== undefined || !slot.getAttachment())) {
    const skin =
      imagesOnly.data.defaultSkin ??
      (imagesOnly.data.skins.length === 1 ? imagesOnly.data.skins[0]! : undefined);
    const entry = skin
      ?.getAttachments()
      .find((e) => e.slotIndex === slot.data.index && (image === undefined || e.name === image));
    if (entry) slot.setAttachment(entry.attachment);
  }
  // A head that setup keeps transparent (another pose set) is measured all the same.
  if (slot) slot.color.a = 1;
  const d = drawList(imagesOnly).find((x) => x.slot === slotName);
  pose(imagesOnly, null, 0);
  if (!d) throw new Error(`REFERENCE_UNIT: no ${part} in the images-only setup`);
  const xs = d.verts.filter((_, i) => i % 2 === 0);
  return Math.max(...xs) - Math.min(...xs);
}
export function prepareReference(
  artist: unknown,
  imagesOnly: unknown,
  options: ReferenceOptions,
): PreparedReference {
  const fps = options.fps ?? 30;
  const skeleton = loadSkeleton(artist),
    img = loadSkeleton(imagesOnly);
  const unitPart = options.probes.face ?? options.probes.chain?.[0]?.[1];
  if (!unitPart)
    throw new Error("REFERENCE_PROBE: probes need a face part (or a chain) for the unit");
  const unit = headUnit(img, unitPart);
  const structure = structureOf(skeleton);
  const animations = skeleton.data.animations.map((a) => a.name);
  const exclude = (options.deformExclude ?? []).map((p) => new RegExp(p));
  const ref: PreparedReference = {
    skeleton,
    structure,
    fps,
    unit,
    animations,
    tracks: {},
    motion: {},
    profiles: {},
    metrics: {},
    maxCharacterStretch: {},
    deformation: {},
  };
  for (const a of animations) {
    const t = sampleTracks(skeleton, a, fps);
    ref.tracks[a] = t;
    ref.motion[a] = Object.fromEntries(Object.entries(t.tr).map(([s, tr]) => [s, slotMotion(tr)]));
    const ks = structure.animations[a]!;
    const sample = performanceSample(t, options.probes, fps, unit);
    const metrics = measurePerformance(
      sample,
      {
        ...probeOptions(options.probes, sample.probes),
        ...(loops(options, a) ? { loop: true } : {}),
      },
      {
        keys: Math.max(1, ks.movingKeys),
        timelines: Math.max(1, ks.movingBoneTimelines),
        duration: ks.duration,
      },
    );
    ref.metrics[a] = metrics;
    ref.profiles[a] = {
      id: `${(options.name ?? "reference").replace(/[^A-Za-z0-9_-]/g, "_")}-${a}-artist`.slice(
        0,
        64,
      ),
      fps,
      source: `${options.name ? `${options.name} ` : ""}artist ${a} (official 4.0 runtime, ${fps} fps, head widths), n=1`,
      ...probeOptions(options.probes, sample.probes),
      ...(loops(options, a) ? { loop: true } : {}),
      targets: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, targetBand(k, v, fps)]),
      ),
    } as PerformanceProfile;
    const def = deformationQA(skeleton, a, fps, options.alpha, exclude);
    ref.deformation[a] = def;
    ref.maxCharacterStretch[a] = def.maxCharacterStretch?.value ?? 0;
  }
  return ref;
}

export interface CompareOptions extends ReferenceOptions {
  texture?: (path: string) => Texture;
  view?: { x: number; y: number; width: number; height: number; scale?: number };
}
export interface CompareResult {
  structure: { artist: StructureStats; generated: StructureStats };
  engineering: {
    A2_setupPlacement: { maxPx: number; perSlot: Record<string, number | null> };
    /** Over slots the artist's compared animations show (ADR-024); hidden slots reported apart. */
    A1_imagesOnlyVsArtistSetup: {
      maxPx: number;
      worst: [string, number | null][];
      hiddenMaxPx: number;
    };
    A4_loopSeam: Record<string, number>;
    /** One-shot animations (ADR-030, named outside a `loop` list): no loop seam. */
    oneShots?: string[];
    /** Frame-0 pose per animation (ADR-024): per-slot mean offset from the artist, head widths. */
    A6_restPose: Record<
      string,
      { medianHw: number; p90Hw: number; slots: number; worst: [string, number][] }
    >;
  };
  deformation: Record<string, { artist: DeformationSummary; generated: DeformationSummary }>;
  motion: Record<string, Json | number>;
  performance: Record<
    string,
    {
      profile: PerformanceProfile;
      artistMetrics: Record<string, number>;
      review: ReturnType<typeof reviewPerformance>;
    }
  >;
  visual: Record<
    string,
    {
      times: number[];
      perFrame: { time: number; meanAbsDiff: number; fractionOver16: number }[];
      rows: string[];
    }
  >;
}
/**
 * Automatic acceptance against an artist file (pre-registered criteria in ADR-017): structure,
 * setup placement, loop seams, deformation, per-slot motion, performance critic and visual diff.
 * Returns review sheets (artist row over generated row) as RGBA when textures are supplied.
 */
export function compareToReference(
  reference: PreparedReference,
  generated: unknown,
  imagesOnly: unknown,
  options: CompareOptions & { animations?: AnimationSpec[] },
): {
  result: CompareResult;
  sheets: Record<string, { width: number; height: number; rgba: Uint8Array }>;
} {
  const fps = reference.fps;
  const gen = loadSkeleton(generated),
    img = loadSkeleton(imagesOnly),
    art = reference.skeleton;
  const exclude = (options.deformExclude ?? []).map((p) => new RegExp(p));
  const genStructure = structureOf(gen);
  const genVsImg = placementDelta(img, gen),
    imgVsArt = placementDelta(art, img);
  const numbers = (o: Record<string, number | null>) =>
    Object.values(o).filter((v): v is number => v !== null);
  // Slots the artist's compared animations show at some frame (alpha above 0.02).
  const shown = new Set(
    Object.values(reference.tracks).flatMap((t) =>
      Object.entries(t.tr)
        .filter(([, s]) => s.a.some((x) => x > 0.02))
        .map(([slot]) => slot),
    ),
  );
  const shownOnly = (o: Record<string, number | null>, keep: boolean) =>
    Object.fromEntries(Object.entries(o).filter(([slot]) => shown.has(slot) === keep));
  const result: CompareResult = {
    structure: { artist: reference.structure, generated: genStructure },
    engineering: {
      A2_setupPlacement: { maxPx: Math.max(0, ...numbers(genVsImg)), perSlot: genVsImg },
      A1_imagesOnlyVsArtistSetup: {
        maxPx: Math.max(0, ...numbers(shownOnly(imgVsArt, true))),
        worst: Object.entries(shownOnly(imgVsArt, true))
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, 6),
        hiddenMaxPx: Math.max(0, ...numbers(shownOnly(imgVsArt, false))),
      },
      A4_loopSeam: {},
      A6_restPose: {},
    },
    deformation: {},
    motion: { unitHeadWidthPx: +reference.unit.toFixed(1) },
    performance: {},
    visual: {},
  };
  const sheets: Record<string, { width: number; height: number; rgba: Uint8Array }> = {};
  for (const a of reference.animations) {
    if (!gen.data.findAnimation(a))
      throw new Error(`REFERENCE_ANIMATION: generated file has no ${a}`);
    const T = { art: reference.tracks[a]!, gen: sampleTracks(gen, a, fps) };
    // A one-shot (ADR-030) need not end where it starts: no loop seam.
    const oneShot = Array.isArray(options.loop) && !options.loop.includes(a);
    if (oneShot) (result.engineering.oneShots ??= []).push(a);
    for (const [who, t] of oneShot
      ? []
      : ([
          ["artist", T.art],
          ["generated", T.gen],
        ] as const)) {
      let worst = 0;
      for (const s of Object.values(t.tr)) {
        const v0 = s.verts[0],
          v1 = s.verts[t.frames];
        // A slot showing another image at the end (a sequence step) has no geometric seam: two
        // meshed images do not share vertex positions.
        if (v0 && v1 && s.att[0] === s.att[t.frames])
          for (let i = 0; i < v0.length; i += 2)
            worst = Math.max(worst, Math.hypot(v0[i]! - v1[i]!, v0[i + 1]! - v1[i + 1]!));
      }
      result.engineering.A4_loopSeam[`${a}:${who}`] = +worst.toFixed(3);
    }
    // rest pose on frame 0
    const rest = restPoseDelta(T.art, T.gen),
      hw = Object.entries(rest)
        .map(([slot, px]): [string, number] => [slot, +(px / reference.unit).toFixed(4)])
        .sort((x, y) => y[1] - x[1]);
    const q = (f: number) => (hw.length ? hw[Math.floor((1 - f) * (hw.length - 1))]![1] : 0);
    result.engineering.A6_restPose[a] = {
      medianHw: q(0.5),
      p90Hw: q(0.9),
      slots: hw.length,
      worst: hw.slice(0, 6),
    };
    // per-slot motion
    const rows: Json[] = [];
    for (const slot of Object.keys(T.art.tr)) {
      const ma = reference.motion[a]![slot]!,
        mg = T.gen.tr[slot] ? slotMotion(T.gen.tr[slot]!) : { visible: false };
      let corr: number | null = null;
      if (ma.visible && mg.visible && ma.moves && mg.moves) {
        // Displacement from the first visible frame: a slot may be hidden on frame 0.
        const disp = (s: SlotTrack) => {
          const ref = s.c.find((c) => c);
          return s.c.map((c) => (c && ref ? Math.hypot(c[0] - ref[0], c[1] - ref[1]) : 0));
        };
        corr = pearson(disp(T.art.tr[slot]!), disp(T.gen.tr[slot]!));
      }
      rows.push({
        slot,
        artist: ma,
        generated: mg,
        ratio:
          ma.moves && mg.moves && (ma.peakPx ?? 0) > 0.5
            ? +((mg.peakPx ?? 0) / ma.peakPx!).toFixed(2)
            : null,
        displacementCorrelation: corr === null ? null : +corr.toFixed(3),
      });
    }
    const artMoving = rows.filter((r) => (r.artist as SlotMotion).moves),
      genMoving = rows.filter((r) => (r.generated as SlotMotion).moves),
      both = rows.filter(
        (r) => (r.artist as SlotMotion).moves && (r.generated as SlotMotion).moves,
      );
    const ampRows = both.filter((r) => r.ratio !== null);
    const ratios = ampRows.map((r) => r.ratio as number);
    result.motion[a] = {
      artistMoving: artMoving.length,
      generatedMoving: genMoving.length,
      bothMoving: both.length,
      recall: +(both.length / Math.max(1, artMoving.length)).toFixed(3),
      precision: +(both.length / Math.max(1, genMoving.length)).toFixed(3),
      amplitudeWithinX2: ampRows.length
        ? +(ratios.filter((r) => r >= 0.5 && r <= 2).length / ampRows.length).toFixed(3)
        : null,
      amplitudeRows: ampRows.length,
      medianRatio: ampRows.length
        ? ratios.sort((x, y) => x - y)[Math.floor(ampRows.length / 2)]
        : null,
      artistOnly: artMoving.filter((r) => !(r.generated as SlotMotion).moves).map((r) => r.slot),
      generatedOnly: genMoving.filter((r) => !(r.artist as SlotMotion).moves).map((r) => r.slot),
      rows,
    };
    result.deformation[a] = {
      artist: reference.deformation[a]!,
      generated: deformationQA(gen, a, fps, options.alpha, exclude),
    };
    // performance critic
    const ir = options.animations?.find((x) => x.name === a);
    const gs = genStructure.animations[a]!;
    const keyStats = ir
      ? animationKeyStats(ir)
      : {
          keys: Math.max(1, gs.movingKeys),
          timelines: Math.max(1, gs.movingBoneTimelines),
          duration: gs.duration,
        };
    result.performance[a] = {
      profile: reference.profiles[a]!,
      artistMetrics: reference.metrics[a]!,
      review: reviewPerformance(
        performanceSample(T.gen, options.probes, fps, reference.unit),
        reference.profiles[a]!,
        keyStats,
      ),
    };
    // visual side by side
    if (options.texture) {
      const sk = art.raw.skeleton as Json;
      const v = options.view ?? {
        x: sk.x as number,
        y: (sk.y as number) + (sk.height as number),
        width: sk.width as number,
        height: sk.height as number,
      };
      const scale = v.scale ?? Math.min(1, 360 / v.width);
      const view = {
        x0: v.x,
        y0: v.y,
        scale,
        width: Math.ceil(v.width * scale),
        height: Math.ceil(v.height * scale),
      };
      const D = art.data.findAnimation(a)!.duration,
        times = [0, 0.25, 0.5, 0.75].map((f) => +(f * D).toFixed(3));
      const tiles: Uint8Array[][] = [[], []];
      const perFrame = times.map((t) => {
        const imgs = [art, gen].map((s) => {
          pose(s, a, t);
          return flatten(
            render(s, options.texture!, view),
            view.width,
            view.height,
            [0.82, 0.82, 0.82],
          );
        });
        tiles[0]!.push(imgs[0]!);
        tiles[1]!.push(imgs[1]!);
        let sum = 0,
          over = 0;
        const [A, B] = imgs as [Uint8Array, Uint8Array];
        for (let q = 0; q < A.length; q += 3) {
          const d =
            (Math.abs(A[q]! - B[q]!) +
              Math.abs(A[q + 1]! - B[q + 1]!) +
              Math.abs(A[q + 2]! - B[q + 2]!)) /
            3;
          sum += d;
          if (d > 16) over++;
        }
        return {
          time: t,
          meanAbsDiff: +(sum / (A.length / 3)).toFixed(2),
          fractionOver16: +(over / (A.length / 3)).toFixed(4),
        };
      });
      sheets[a] = sheet(tiles, view.width, view.height);
      result.visual[a] = { times, perFrame, rows: ["artist", "generated"] };
    }
  }
  return { result, sheets };
}
