import { frameTime, loadSkeleton, pose, type LoadedSkeleton } from "./runtime.js";

/** Straight (not premultiplied) 8-bit RGBA. */
export interface FitImage {
  width: number;
  height: number;
  rgba: ArrayLike<number>;
}
export interface PoseFitOptions {
  /** World rectangle the reference covers (Spine units, y up; `y` is the top edge). */
  view: { x: number; y: number; width: number; height: number };
  /** Slots to match (default: every slot drawn on frame 0 of the animation). */
  slots?: readonly string[];
  /**
   * Slots not to match: parts whose drawing changes, such as an expression's mouth, eyes and
   * tongue (ADR-033). A head with many face parts is placed by its fur and ears instead.
   */
  ignore?: readonly string[];
  /**
   * Bones free to move (default: every bone except the root). Parts of other bones are matched as
   * part of their nearest free ancestor.
   */
  bones?: readonly string[];
  /**
   * Bones whose parts also count toward another bone's fit, e.g. a hair chain's bones toward the
   * chain's parent: the head is placed with all its strands, then each chain refines near it.
   */
  groups?: Readonly<Record<string, string>>;
  /**
   * Bones that may translate (default: any bone not starting on its parent's origin or tip).
   * A logical rest pose turns joints; only the hips and IK targets move (ADR-025).
   */
  translate?: readonly string[];
  /** Search half-width in world units (default 0.3 x the larger view side). */
  window?: number;
  /** Largest part rotation searched, degrees (default 30). */
  maxRotate?: number;
  /** Bone matches scoring below this are not used (default 0.35; a score is the mean colour match). */
  minScore?: number;
  /**
   * Animation time posed under the reference, seconds (default 0: the rest pose). The fitted
   * offsets are added to that pose (ADR-033 key poses).
   */
  time?: number;
  /**
   * Per-bone placements measured on a picture whose pose the build already shows (ADR-033): the
   * matching's own error on these drawings (a part the build bends differently), taken off this
   * fit's targets.
   */
  zero?: Readonly<Record<string, Placement>>;
}
/** A rigid world move: x -> R(r) x + t, degrees counter-clockwise (Spine world, y up). */
export interface Placement {
  r: number;
  t: [number, number];
}
export interface PoseFitPart {
  slot: string;
  samples: number;
  /** Fraction of the part's sampled texels found in the reference at the best placement. */
  score: number;
  /** Best rigid placement: world translation and rotation (degrees, counter-clockwise). */
  dx: number;
  dy: number;
  rotate: number;
  used: boolean;
  /** RMS distance of the fitted pose to the placement, world units (used parts). */
  residual?: number;
}
export interface PoseFitResult {
  /** Rest pose for the plan (ADR-024): IR offsets, y down, clockwise degrees. */
  pose: Record<string, { x?: number; y?: number; rotate?: number }>;
  parts: PoseFitPart[];
  residual: { median: number; max: number };
  iterations: number;
  /** Share of the sampled texels on parts whose match was used: below about 0.6 the reference
   *  shows something a rest pose cannot (a scaled head, another expression); do not use the pose. */
  coverage: number;
  /** Placements of the bones whose own parts matched, for `zero` (ADR-033). */
  placements: Record<string, Placement>;
}

interface Sample {
  tri: number;
  bary: [number, number, number];
  w0: [number, number];
  rgb: [number, number, number];
}
type Item = { slot: string; verts: number[]; tris: number[] };

/** World vertices of the given slots' current attachments (regions and meshes). */
function worldVertices(sk: LoadedSkeleton, slots: readonly string[]): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const name of slots) {
    const slot = sk.skeleton.findSlot(name);
    const att = slot?.getAttachment() as
      | (Record<string, unknown> & {
          worldVerticesLength?: number;
          triangles?: number[];
          computeWorldVertices(...a: unknown[]): void;
        })
      | null
      | undefined;
    if (!slot || !att) continue;
    if (att.triangles && att.worldVerticesLength) {
      const verts = new Array<number>(att.worldVerticesLength).fill(0);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
      out.set(name, { slot: name, verts, tris: att.triangles });
    } else if ("offset" in att) {
      const verts = new Array<number>(8).fill(0);
      att.computeWorldVertices(slot.bone, verts, 0, 2);
      out.set(name, { slot: name, verts, tris: [0, 1, 2, 2, 3, 0] });
    }
  }
  return out;
}
const at = (item: Item, s: Sample): [number, number] => {
  const t = s.tri * 3,
    v = item.verts,
    [a, b, c] = [item.tris[t]!, item.tris[t + 1]!, item.tris[t + 2]!];
  return [
    s.bary[0] * v[2 * a]! + s.bary[1] * v[2 * b]! + s.bary[2] * v[2 * c]!,
    s.bary[0] * v[2 * a + 1]! + s.bary[1] * v[2 * b + 1]! + s.bary[2] * v[2 * c + 1]!,
  ];
};

/**
 * Fits a rest pose to a reference image (ADR-024). Each drawn part is matched rigidly (translation
 * and rotation about its centroid) by the fraction of its opaque texels whose colour the reference
 * shows there, so overlapping parts still match on their visible share. The free bones' setup
 * offsets are then solved by damped least squares on the official runtime pose, so IK and
 * transform constraints carry their effect, and returned as plan offsets.
 */
export function fitRestPose(
  document: unknown,
  animation: string,
  reference: FitImage,
  image: (path: string) => FitImage,
  options: PoseFitOptions,
): PoseFitResult {
  const sk = loadSkeleton(document);
  const view = options.view,
    scale = reference.width / view.width,
    maxRotate = options.maxRotate ?? 30,
    window = options.window ?? 0.3 * Math.max(view.width, view.height),
    minScore = options.minScore ?? 0.35,
    time = options.time ?? 0;
  pose(sk, animation, time);
  // Parts drawn on frame 0, with their texture paths.
  const drawn: { slot: string; path: string; uvs: number[] }[] = [];
  for (const slot of sk.skeleton.drawOrder) {
    const att = slot.getAttachment() as
      | (Record<string, unknown> & { path?: string; name: string; regionUVs?: ArrayLike<number> })
      | null;
    if (!att || slot.color.a * (att.color as { a: number }).a <= 0.02) continue;
    if (options.slots && !options.slots.includes(slot.data.name)) continue;
    if (options.ignore?.includes(slot.data.name)) continue;
    const uvs = att.regionUVs
      ? Array.from(att.regionUVs)
      : "offset" in att
        ? [0, 1, 0, 0, 1, 0, 1, 1]
        : undefined;
    if (!uvs) continue;
    drawn.push({ slot: slot.data.name, path: att.path ?? att.name, uvs });
  }
  const base = worldVertices(
    sk,
    drawn.map((d) => d.slot),
  );
  const refAt = (x: number, y: number) => {
    const px = Math.round((x - view.x) * scale),
      py = Math.round((view.y - y) * scale);
    if (px < 0 || py < 0 || px >= reference.width || py >= reference.height) return -1;
    return (py * reference.width + px) * 4;
  };
  // 1 for the same colour, falling linearly to 0 at a channel difference of 64; 0 off the figure.
  const hit = (s: Sample, x: number, y: number) => {
    const i = refAt(x, y);
    if (i < 0 || reference.rgba[i + 3]! < 128) return 0;
    const d = Math.max(
      Math.abs(reference.rgba[i]! - s.rgb[0]),
      Math.abs(reference.rgba[i + 1]! - s.rgb[1]),
      Math.abs(reference.rgba[i + 2]! - s.rgb[2]),
    );
    return Math.max(0, 1 - d / 64);
  };

  // ---- samples: opaque texels with their triangle, barycentrics and setup world position
  const samples = new Map<string, Sample[]>();
  for (const d of drawn) {
    const item = base.get(d.slot);
    if (!item) continue;
    const tex = image(d.path);
    let opaque = 0;
    for (let i = 3; i < tex.rgba.length; i += 4) if (tex.rgba[i]! >= 200) opaque++;
    if (opaque < 50) continue;
    const step = Math.max(1, Math.floor(Math.sqrt(opaque / 1200)));
    // A reference pixel can cover several texels (a large figure in a small picture): compare the
    // texels' mean colour over that footprint, as the picture shows it.
    const xs = item.verts.filter((_, i) => i % 2 === 0),
      ys = item.verts.filter((_, i) => i % 2 === 1),
      worldPerTexel = Math.max(
        (Math.max(...xs) - Math.min(...xs)) / tex.width,
        (Math.max(...ys) - Math.min(...ys)) / tex.height,
      ),
      foot = Math.max(1, Math.round(1 / (scale * worldPerTexel)));
    const mean = (x: number, y: number): [number, number, number] => {
      if (foot === 1) {
        const k = (y * tex.width + x) * 4;
        return [tex.rgba[k]!, tex.rgba[k + 1]!, tex.rgba[k + 2]!];
      }
      const h = foot >> 1,
        sum: [number, number, number] = [0, 0, 0];
      let wsum = 0;
      for (let yy = Math.max(0, y - h); yy <= Math.min(tex.height - 1, y + h); yy++)
        for (let xx = Math.max(0, x - h); xx <= Math.min(tex.width - 1, x + h); xx++) {
          const k = (yy * tex.width + xx) * 4,
            a = tex.rgba[k + 3]! / 255;
          sum[0] += tex.rgba[k]! * a;
          sum[1] += tex.rgba[k + 1]! * a;
          sum[2] += tex.rgba[k + 2]! * a;
          wsum += a;
        }
      return [sum[0] / wsum, sum[1] / wsum, sum[2] / wsum];
    };
    const list: Sample[] = [];
    for (let y = step >> 1; y < tex.height; y += step)
      for (let x = step >> 1; x < tex.width; x += step) {
        const k = (y * tex.width + x) * 4;
        if (tex.rgba[k + 3]! < 200) continue;
        const u = (x + 0.5) / tex.width,
          v = (y + 0.5) / tex.height;
        for (let t = 0; t < item.tris.length; t += 3) {
          const [a, b, c] = [item.tris[t]!, item.tris[t + 1]!, item.tris[t + 2]!];
          const [ax, ay, bx, by, cx, cy] = [
            d.uvs[2 * a]!,
            d.uvs[2 * a + 1]!,
            d.uvs[2 * b]!,
            d.uvs[2 * b + 1]!,
            d.uvs[2 * c]!,
            d.uvs[2 * c + 1]!,
          ];
          const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
          if (Math.abs(det) < 1e-12) continue;
          const l1 = ((u - ax) * (cy - ay) - (cx - ax) * (v - ay)) / det,
            l2 = ((bx - ax) * (v - ay) - (u - ax) * (by - ay)) / det,
            l0 = 1 - l1 - l2;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const s: Sample = {
            tri: t / 3,
            bary: [l0, l1, l2],
            w0: [0, 0],
            rgb: mean(x, y),
          };
          s.w0 = at(item, s);
          list.push(s);
          break;
        }
      }
    if (list.length >= 50) samples.set(d.slot, list);
  }

  // ---- rigid placement per bone, parents first: a bone's parts are matched together, around
  //      where its parent's fit puts them (a lone small part matches too many places alone)
  type Rigid = Placement;
  const move = (T: Rigid, x: [number, number]): [number, number] => {
    const a = (T.r * Math.PI) / 180,
      cos = Math.cos(a),
      sin = Math.sin(a);
    return [cos * x[0] - sin * x[1] + T.t[0], sin * x[0] + cos * x[1] + T.t[1]];
  };
  type Bone = { data: { name: string }; parent: Bone | null };
  // A part counts toward the nearest bone free to move (a face plate and its eyes fit as the head).
  const freeNames = options.bones ? new Set(options.bones) : undefined;
  const byName = new Map(
    (sk.skeleton.bones as unknown as Bone[]).map((b) => [b.data.name, b] as const),
  );
  const freeOwner = (start: Bone) => {
    let b: Bone | null = start;
    while (b && freeNames && !freeNames.has(b.data.name) && b.parent) b = b.parent;
    return b!.data.name;
  };
  const slotBone = new Map<string, string>(),
    slotGroup = new Map<string, string>();
  for (const slot of samples.keys()) {
    const owner = freeOwner(sk.skeleton.findSlot(slot)!.bone as unknown as Bone);
    slotBone.set(slot, owner);
    const g = options.groups?.[owner],
      gb = g === undefined ? undefined : byName.get(g);
    if (gb) slotGroup.set(slot, freeOwner(gb));
  }
  // A zero placement's inverse: where the matching would put a part the build already shows.
  const unmove = (T: Rigid, x: [number, number]): [number, number] => {
    const a = (-T.r * Math.PI) / 180,
      u = x[0] - T.t[0],
      v = x[1] - T.t[1];
    return [Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v];
  };
  const fitted = new Map<string, Rigid>(),
    anchored = new Set<string>(),
    placements: Record<string, Rigid> = {},
    parts: PoseFitPart[] = [],
    targets = new Map<string, { sample: Sample; to: [number, number] }[]>();
  const childWindow = 0.5 * window;
  for (const b of sk.skeleton.bones as unknown as Bone[]) {
    const name = b.data.name,
      parent = b.parent?.data.name;
    const D0: Rigid = (parent && fitted.get(parent)) || { r: 0, t: [0, 0] };
    // Only a reliable parent narrows the search: a stretched neck that matched nothing must not
    // hold the head near where the spine alone would put it.
    const near = parent !== undefined && anchored.has(parent);
    // A chain refines only near a reliable parent: a matched ear must not leave an unmatched head.
    const groupParent = options.groups?.[name],
      gb = groupParent === undefined ? undefined : byName.get(groupParent),
      chainOf = gb ? freeOwner(gb) : undefined;
    const skipOwn = chainOf !== undefined && !anchored.has(chainOf);
    const slots = [...slotBone].filter(([, bone]) => bone === name).map(([slot]) => slot),
      grouped = [...slotGroup].filter(([, bone]) => bone === name).map(([slot]) => slot);
    if (skipOwn) {
      fitted.set(name, D0);
      for (const slot of slots)
        parts.push({
          slot,
          samples: samples.get(slot)!.length,
          score: 0,
          dx: 0,
          dy: 0,
          rotate: 0,
          used: false,
        });
      continue;
    }
    if (!slots.length && !grouped.length) {
      // A bone without parts carries its parent's fit, reliable when the parent's is.
      fitted.set(name, D0);
      if (near) anchored.add(name);
      continue;
    }
    // Each part has an equal say (at most 400 texels), at the place the parent's fit predicts.
    const set: { s: Sample; p: [number, number]; slot: string }[] = [];
    for (const slot of [...slots, ...grouped]) {
      const list = samples.get(slot)!,
        k = Math.max(1, Math.floor(list.length / 400));
      list.forEach((s, i) => {
        if (i % k === 0) set.push({ s, p: move(D0, s.w0), slot });
      });
    }
    const c = set.reduce<[number, number]>(
      (m, x) => [m[0] + x.p[0] / set.length, m[1] + x.p[1] / set.length],
      [0, 0],
    );
    const place = (rot: number, dx: number, dy: number, x: [number, number]): [number, number] => {
      const a = (rot * Math.PI) / 180,
        u = x[0] - c[0],
        v = x[1] - c[1];
      return [
        Math.cos(a) * u - Math.sin(a) * v + c[0] + dx,
        Math.sin(a) * u + Math.cos(a) * v + c[1] + dy,
      ];
    };
    const score = (sub: typeof set, rot: number, dx: number, dy: number) => {
      let n = 0;
      for (const x of sub) {
        const q = place(rot, dx, dy, x.p);
        n += hit(x.s, q[0], q[1]);
      }
      return n / sub.length;
    };
    const subset = (n: number) => {
      const k = Math.max(1, Math.floor(set.length / n));
      return set.filter((_, i) => i % k === 0);
    };
    const coarse = Math.max(4, 6 / scale);
    // A child moves relative to its parent's fit: within half its parts' extent and 25 degrees.
    const xs = set.map((x) => x.p[0]),
      ys = set.map((x) => x.p[1]),
      extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const moveSpan = near ? Math.min(childWindow, Math.max(4 * coarse, 0.5 * extent)) : window,
      turnSpan = near ? Math.min(maxRotate, 25) : maxRotate;
    type Cand = [number, number, number, number];
    // A slight preference for the smaller move settles identical images (two legs) and plain areas.
    const rank = (c: Cand) =>
      c[0] - 0.05 * (Math.hypot(c[2], c[3]) / moveSpan + Math.abs(c[1]) / turnSpan);
    const search = (
      sub: typeof set,
      seeds: Cand[],
      rotSpan: number,
      rotStep: number,
      span: number,
      step: number,
      keep: number,
    ) => {
      const out: Cand[] = [];
      for (const [, r0, x0, y0] of seeds)
        for (let r = r0 - rotSpan; r <= r0 + rotSpan + 1e-9; r += rotStep) {
          if (Math.abs(r) > maxRotate + 1e-9) continue;
          for (let dx = x0 - span; dx <= x0 + span + 1e-9; dx += step)
            for (let dy = y0 - span; dy <= y0 + span + 1e-9; dy += step)
              out.push([score(sub, r, dx, dy), r, dx, dy]);
        }
      out.sort((a, b) => rank(b) - rank(a));
      return out.slice(0, keep);
    };
    let best = search(subset(200), [[0, 0, 0, 0]], turnSpan, 5, moveSpan, coarse, 8);
    best = search(subset(600), best, 5, 1, coarse, coarse / 4, 3);
    best = search(set, best, 1, 0.25, coarse / 4, Math.max(0.5, coarse / 16), 1);
    const [boneScore, rot, dx, dy] = best[0]!;
    // Composite: x -> place(D0 x).
    const a = (rot * Math.PI) / 180,
      Rc: [number, number] = [
        Math.cos(a) * c[0] - Math.sin(a) * c[1],
        Math.sin(a) * c[0] + Math.cos(a) * c[1],
      ];
    const Rt0: [number, number] = [
      Math.cos(a) * D0.t[0] - Math.sin(a) * D0.t[1],
      Math.sin(a) * D0.t[0] + Math.cos(a) * D0.t[1],
    ];
    const D: Rigid =
      boneScore >= minScore
        ? { r: D0.r + rot, t: [Rt0[0] + c[0] + dx - Rc[0], Rt0[1] + c[1] + dy - Rc[1]] }
        : D0;
    fitted.set(name, D);
    if (boneScore >= minScore) {
      anchored.add(name);
      placements[name] = { r: +D.r.toFixed(4), t: [+D.t[0].toFixed(3), +D.t[1].toFixed(3)] };
    }
    const Z = options.zero?.[name];
    for (const slot of slots) {
      const list = samples.get(slot)!;
      const mine = set.filter((x) => x.slot === slot);
      const partScore =
        mine.reduce((n, x) => {
          const q = move(D, x.s.w0);
          return n + hit(x.s, q[0], q[1]);
        }, 0) / mine.length;
      const centre = list.reduce<[number, number]>(
        (m, s) => [m[0] + s.w0[0] / list.length, m[1] + s.w0[1] / list.length],
        [0, 0],
      );
      const moved = move(D, centre);
      // Partly covered parts still count; a part the bone's fit does not explain is left out.
      const used = boneScore >= minScore && partScore >= 0.6 * minScore;
      parts.push({
        slot,
        samples: list.length,
        score: +partScore.toFixed(3),
        dx: +(moved[0] - centre[0]).toFixed(2),
        dy: +(moved[1] - centre[1]).toFixed(2),
        rotate: +D.r.toFixed(2),
        used,
      });
      if (!used) continue;
      const k = Math.max(1, Math.floor(list.length / 16));
      targets.set(
        slot,
        list
          .filter((_, i) => i % k === 0)
          .map((sample) => ({ sample, to: move(D, Z ? unmove(Z, sample.w0) : sample.w0) })),
      );
    }
  }

  // ---- damped least squares over the free bones' setup offsets (x, y, rotation)
  const free = sk.skeleton.bones.filter((b) =>
    options.bones ? options.bones.includes(b.data.name) : b.data.name !== "root",
  ) as unknown as { data: { name: string; x: number; y: number; rotation: number } }[];
  const setup = free.map((b) => [b.data.x, b.data.y, b.data.rotation]);
  // A bone that starts on its parent's origin or tip only turns: moving it would open the joint.
  type Linked = { data: { x: number; y: number }; parent: { data: { length: number } } | null };
  const turnsOnly = free.map((b) => {
    const l = b as unknown as Linked;
    if (options.translate) return !options.translate.includes(b.data.name);
    if (!l.parent) return false;
    const { x, y } = l.data;
    return Math.hypot(x, y) < 1 || Math.hypot(x - l.parent.data.length, y) < 1;
  });
  // Parameter j moves channel ch (0 x, 1 y, 2 rotation) of free bone i.
  const params: { i: number; ch: number }[] = [];
  free.forEach((_, i) => {
    if (!turnsOnly[i]) params.push({ i, ch: 0 }, { i, ch: 1 });
    params.push({ i, ch: 2 });
  });
  const n = params.length;
  const used = [...targets.keys()];
  const weight = new Map(parts.map((p) => [p.slot, Math.sqrt(p.score)]));
  // A pull toward no offset, close to L1 so redundant bones stay still (one turned spine, not a
  // turned hips with counter-turned legs), also settles bones the parts cannot see.
  const reg = 0.2,
    degree = 10;
  const offsets = (p: number[]) => {
    const o = free.map(() => [0, 0, 0]);
    params.forEach((q, j) => (o[q.i]![q.ch] = p[j]!));
    return o;
  };
  const residuals = (p: number[]) => {
    const o = offsets(p);
    free.forEach((b, i) => {
      b.data.x = setup[i]![0]! + o[i]![0]!;
      b.data.y = setup[i]![1]! + o[i]![1]!;
      b.data.rotation = setup[i]![2]! + o[i]![2]!;
    });
    pose(sk, animation, time);
    const now = worldVertices(sk, used);
    const r: number[] = [];
    for (const slot of used) {
      const item = now.get(slot)!,
        w = weight.get(slot)!;
      for (const t of targets.get(slot)!) {
        const q = at(item, t.sample);
        r.push(w * (q[0] - t.to[0]), w * (q[1] - t.to[1]));
      }
    }
    params.forEach((q, j) => {
      const v = (q.ch === 2 ? degree : 1) * p[j]!;
      r.push((reg * v) / Math.sqrt(Math.abs(v) + 0.5));
      // No bone turns further than a part may (ADR-033): a hand the drawing moved off its arm
      // must not spin the forearm round to reach it.
      if (q.ch === 2) r.push(10 * Math.max(0, Math.abs(p[j]!) - maxRotate));
    });
    return r;
  };
  const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  let p = new Array<number>(n).fill(0),
    r = residuals(p),
    mu = 1e-3,
    iterations = 0;
  if (used.length)
    for (; iterations < 40; iterations++) {
      const J: number[][] = [];
      for (let j = 0; j < n; j++) {
        const h = params[j]!.ch === 2 ? 0.05 : 0.25,
          q = [...p];
        q[j]! += h;
        const rq = residuals(q);
        J.push(rq.map((v, i) => (v - r[i]!) / h));
      }
      const A = Array.from({ length: n }, (_, a) =>
          Array.from({ length: n }, (_, b) => J[a]!.reduce((s, v, i) => s + v * J[b]![i]!, 0)),
        ),
        g = J.map((col) => col.reduce((s, v, i) => s + v * r[i]!, 0));
      let improved = false;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + mu) + 1e-9 : v)));
        const step = solve(
          M,
          g.map((v) => -v),
        );
        const q = p.map((v, i) => v + step[i]!),
          rq = residuals(q);
        if (cost(rq) < cost(r)) {
          const gain = cost(r) - cost(rq);
          [p, r] = [q, rq];
          mu = Math.max(1e-7, mu / 3);
          improved = true;
          if (gain < 1e-6 * cost(r)) iterations = 40;
        } else mu *= 4;
      }
      if (!improved) break;
    }
  r = residuals(p);
  // ---- report
  const now = worldVertices(sk, used),
    perPart: number[] = [];
  for (const part of parts) {
    if (!part.used) continue;
    const item = now.get(part.slot)!,
      t = targets.get(part.slot)!;
    const e = Math.sqrt(
      t.reduce((s, x) => {
        const q = at(item, x.sample);
        return s + (q[0] - x.to[0]) ** 2 + (q[1] - x.to[1]) ** 2;
      }, 0) / t.length,
    );
    part.residual = +e.toFixed(2);
    perPart.push(e);
  }
  perPart.sort((a, b) => a - b);
  const out: PoseFitResult["pose"] = {};
  const fittedOffsets = offsets(p);
  free.forEach((b, i) => {
    const [x, y, rot] = fittedOffsets[i] as [number, number, number];
    if (Math.hypot(x, y) < 0.05 && Math.abs(rot) < 0.01) return;
    // Spine setup offsets (y up, counter-clockwise) -> IR plan offsets (y down, clockwise).
    out[b.data.name] = {
      ...(Math.abs(x) >= 0.05 ? { x: +x.toFixed(2) } : {}),
      ...(Math.abs(y) >= 0.05 ? { y: +(-y).toFixed(2) } : {}),
      ...(Math.abs(rot) >= 0.01 ? { rotate: +(-rot).toFixed(3) } : {}),
    };
  });
  free.forEach((b, i) => {
    [b.data.x, b.data.y, b.data.rotation] = setup[i] as [number, number, number];
  });
  const sampled = parts.reduce((n, x) => n + x.samples, 0),
    usedSamples = parts.filter((x) => x.used).reduce((n, x) => n + x.samples, 0);
  return {
    pose: out,
    parts,
    placements,
    coverage: +(sampled ? usedSamples / sampled : 0).toFixed(3),
    residual: {
      median: +(perPart[Math.floor((perPart.length - 1) / 2)] ?? 0).toFixed(2),
      max: +(perPart.at(-1) ?? 0).toFixed(2),
    },
    iterations,
  };
}

/** A reference picture of the pose on one frame (a storyboard frame or a frame of a video). */
export interface KeyPicture {
  frame: number;
  image: FitImage;
}
export interface KeyPoseFitOptions extends Omit<PoseFitOptions, "time" | "zero"> {
  /** Frames per second of the animation (default 30). */
  fps?: number;
  /** Pictures with less coverage are not used (default 0.6, the rest pose's limit). */
  minCoverage?: number;
  /**
   * The frame of a picture whose pose the build already shows, usually frame 0 after its rest pose
   * was fitted from that picture: it gives no key pose; its matching error is taken off the others.
   */
  zeroFrame?: number;
}
export interface KeyPoseFitResult {
  /** Offsets per accepted picture, over the animation's pose on that frame (ADR-033). */
  keyposes: { frame: number; pose: PoseFitResult["pose"] }[];
  /** Every key picture's fit; `accepted` is false below the coverage limit. */
  frames: (PoseFitResult & { frame: number; accepted: boolean })[];
  /** The zero picture's fit: what the matching reports for a pose the build already shows. */
  zero?: PoseFitResult & { frame: number };
}

/**
 * Fits key poses (ADR-033): each picture is fitted like a rest pose (ADR-024), on the animation's
 * pose at its frame, so the offsets add to the motion already there. A picture that shows what the
 * bones cannot (a scaled part, another expression) covers too little and gives no key pose.
 */
export function fitKeyPoses(
  document: unknown,
  animation: string,
  pictures: readonly KeyPicture[],
  image: (path: string) => FitImage,
  options: KeyPoseFitOptions,
): KeyPoseFitResult {
  const fps = options.fps ?? 30,
    minCoverage = options.minCoverage ?? 0.6;
  const found = loadSkeleton(document).data.findAnimation(animation);
  if (!found) throw new Error(`REFERENCE_ANIMATION: no animation ${animation}`);
  const frames = Math.round(found.duration * fps);
  const out: KeyPoseFitResult = { keyposes: [], frames: [] };
  const fit = (picture: KeyPicture, zero?: Record<string, Placement>) => {
    if (!Number.isInteger(picture.frame) || picture.frame < 0 || picture.frame > frames)
      throw new Error(`REFERENCE_FRAME: ${animation} has frames 0-${frames}, not ${picture.frame}`);
    return fitRestPose(document, animation, picture.image, image, {
      ...options,
      time: frameTime(picture.frame, frames, found.duration, fps),
      ...(zero ? { zero } : {}),
    });
  };
  const zeroPicture =
    options.zeroFrame === undefined
      ? undefined
      : pictures.find((p) => p.frame === options.zeroFrame);
  if (options.zeroFrame !== undefined && !zeroPicture)
    throw new Error(`REFERENCE_FRAME: no picture on the zero frame ${options.zeroFrame}`);
  if (zeroPicture) out.zero = { frame: zeroPicture.frame, ...fit(zeroPicture) };
  for (const picture of [...pictures].sort((a, b) => a.frame - b.frame)) {
    if (picture === zeroPicture) continue;
    const fitted = fit(picture, out.zero?.placements);
    const accepted = fitted.coverage >= minCoverage;
    out.frames.push({ frame: picture.frame, ...fitted, accepted });
    if (accepted) out.keyposes.push({ frame: picture.frame, pose: fitted.pose });
  }
  return out;
}

/** Gaussian elimination with partial pivoting (small dense systems). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length,
    M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-14) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f) for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-14 ? 0 : row[n]! / row[i]!));
}
