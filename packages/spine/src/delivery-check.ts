type Json = Record<string, unknown>;

/**
 * Game-runtime delivery conventions (ADR-053): the editor version, file names and limits a
 * skeleton must meet before it goes into a game. The rules are general Spine practice for game
 * runtimes; `delivery-conventions.md` in the skill gives the reasons. Checks read the JSON only:
 * peak triangles during an animation, triangles inside a clipping mask and real draw calls need
 * the editor's Metrics view.
 */
export const DELIVERY_TARGETS = {
  /** Cocos Creator runtime: Spine 3.8. */
  cocos: {
    editor: "3.8.99",
    skeleton: ".skel",
    atlas: ".atlas",
    names: /^[A-Za-z0-9_]+$/,
    clipping: 1,
    squareAtlas: false,
  },
  /** Unity runtime, Spine 4.0: no clipping masks. */
  unity: {
    editor: "4.0.56",
    skeleton: ".skel.bytes",
    atlas: ".atlas.txt",
    names: /^[A-Za-z0-9_-]+$/,
    clipping: 0,
    squareAtlas: true,
  },
  /** Unity runtime, Spine 4.1. */
  "unity-4.1": {
    editor: "4.1.24",
    skeleton: ".skel.bytes",
    atlas: ".atlas.txt",
    names: /^[A-Za-z0-9_-]+$/,
    clipping: 0,
    squareAtlas: true,
  },
} as const;
export type DeliveryTarget = keyof typeof DELIVERY_TARGETS;

/** Bones, setup triangles, triangles inside a mask, draw calls, longest atlas page (px). */
type Limit = readonly [number, number, number, number, number];
/** Per kind of asset, for a board of up to 25 symbols. */
export const DELIVERY_LIMITS = {
  "symbol-low": [10, 10, 0, 2, 256],
  "symbol-mid": [20, 100, 0, 3, 256],
  "symbol-high": [30, 150, 100, 4, 512],
  wild: [30, 150, 100, 4, 512],
  scatter: [60, 250, 250, 6, 512],
  feature: [60, 250, 150, 6, 512],
  "symbol-fx": [20, 60, 0, 2, 256],
  intro: [350, 1700, 0, 10, 2048],
  nearwin: [60, 100, 0, 2, 512],
  "ui-fx": [80, 300, 200, 10, 512],
  "reel-fx": [80, 300, 0, 2, 512],
  bigwin: [150, 400, 0, 5, 1024],
  popup: [200, 500, 0, 10, 1024],
  character: [250, 1000, 0, 6, 1024],
  "bg-main": [100, 100, 0, 2, 1024],
  "bg-feature": [100, 200, 0, 4, 1024],
  "screen-fx": [100, 200, 0, 2, 512],
} as const satisfies Record<string, Limit>;
/** Symbols on a board of more than 25 symbols draw many times at once: lower limits. */
export const DELIVERY_LIMITS_LARGE_BOARD = {
  "symbol-low": [10, 10, 0, 1, 256],
  "symbol-mid": [20, 30, 0, 1, 256],
  "symbol-high": [30, 80, 0, 2, 512],
  wild: [30, 80, 0, 2, 512],
  scatter: [60, 250, 250, 5, 512],
  feature: [60, 250, 150, 3, 512],
  "symbol-fx": [20, 30, 0, 1, 256],
} as const satisfies Record<string, Limit>;
export type DeliveryKind = keyof typeof DELIVERY_LIMITS | "loading" | "other";
export const DELIVERY_KINDS = [
  ...Object.keys(DELIVERY_LIMITS),
  "loading",
  "other",
] as DeliveryKind[];
/** Win celebration tiers, each an `<tier>_Start` and `<tier>_End` animation. */
export const WIN_TIERS = [
  "YouWin",
  "BigWin",
  "MegaWin",
  "SuperWin",
  "GoldenWin",
  "MarvelousWin",
  "LegendaryWin",
];

export interface DeliveryRow {
  /** Rule id, as in delivery-conventions.md. */
  id: string;
  level: "error" | "warning";
  message: string;
}
export interface DeliveryCheck {
  target: DeliveryTarget;
  kind: DeliveryKind;
  /** No errors (warnings need a look but do not fail). */
  pass: boolean;
  errors: number;
  warnings: number;
  counts: {
    bones: number;
    setupTriangles: number;
    allTriangles: number;
    drawCalls: number;
    clipping: number;
    maxWeightBones: number;
  };
  /** The kind's limits (bones, setupTriangles, maskTriangles, drawCalls, atlasPage); none for loading/other. */
  limits: {
    bones: number;
    setupTriangles: number;
    maskTriangles: number;
    drawCalls: number;
    atlasPage: number;
  } | null;
  rows: DeliveryRow[];
}
export interface DeliveryCheckOptions {
  kind?: DeliveryKind;
  /** More than 25 symbols on the board (lower symbol limits). */
  largeBoard?: boolean;
  /**
   * The editor version the project is made in, to compare with the target's; default the
   * document's `skeleton.spine`; false skips (a JSON the check exported itself).
   */
  version?: string | false;
}

const SLOT_STATE_TIMELINES = new Set([
  "attachment",
  "color",
  "twoColor",
  "rgba",
  "rgb",
  "alpha",
  "rgba2",
  "rgb2",
]);
const TRANSFORM_DEFAULTS: Record<string, number> = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
};

/** Language text and changing numbers: a name part such as TEXT, TEXT2, NUM or NUM_1. */
export function isTextOrNumber(name: string): boolean {
  return name.split(/[/_]/).some((part) => /^(TEXT|NUM)\d*$/i.test(part));
}

/** Every attachment as [skin, slot, name, attachment], 3.8 and 4.x layouts alike. */
function attachments(doc: Json): [string, string, string, Json][] {
  let skins = doc.skins as Json[] | Record<string, Json> | undefined;
  if (skins && !Array.isArray(skins))
    skins = Object.entries(skins).map(([name, attachments]) => ({ name, attachments }));
  const out: [string, string, string, Json][] = [];
  for (const skin of skins ?? [])
    for (const [slot, list] of Object.entries((skin.attachments ?? {}) as Record<string, Json>))
      for (const [name, a] of Object.entries(list as Record<string, Json>))
        out.push([String(skin.name), slot, name, a]);
  return out;
}

function triangles(a: Json): number {
  const type = a.type ?? "region";
  if (type === "region") return 2;
  if (type === "mesh") return ((a.triangles as number[] | undefined)?.length ?? 0) / 3;
  return 0;
}

/** Weighted vertices: the most bones one vertex is bound to (0 for unweighted). */
function weightBones(a: Json): number {
  const v = a.vertices as number[] | undefined;
  if (!v) return 0;
  const plain =
    a.type === "mesh" ? (a.uvs as number[]).length : Number(a.vertexCount ?? v.length / 2) * 2;
  if (v.length === plain) return 0;
  let most = 0;
  for (let i = 0; i < v.length; i += 1 + v[i]! * 4) most = Math.max(most, v[i]!);
  return most;
}

const time = (k: Json) => Number(k.time ?? 0);
function sameValues(a: Json, b: Json): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (["time", "curve", "c2", "c3", "c4"].includes(key)) continue;
    const x = a[key],
      y = b[key];
    if (typeof x === "number" || typeof y === "number") {
      if (Math.abs(Number(x ?? 0) - Number(y ?? 0)) > 1e-3) return false;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

/** Checks a Spine JSON (3.8 or 4.x) against a target runtime's delivery conventions. */
export function checkDelivery(
  doc: Json,
  target: DeliveryTarget,
  options: DeliveryCheckOptions = {},
): DeliveryCheck {
  const spec = DELIVERY_TARGETS[target];
  const kind = options.kind ?? "other";
  const rows: DeliveryRow[] = [];
  // Once each: an attachment shared by several skins is one finding.
  const seen = new Set<string>();
  const add = (row: DeliveryRow) => {
    const key = `${row.id} ${row.level} ${row.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  const error = (id: string, message: string) => add({ id, level: "error", message });
  const warn = (id: string, message: string) => add({ id, level: "warning", message });

  // V1: the editor version the runtime reads.
  const version =
    options.version === false
      ? undefined
      : (options.version ?? String((doc.skeleton as Json | undefined)?.spine ?? ""));
  if (version !== undefined && version !== spec.editor) {
    const [a, b] = version.split("."),
      [c, d] = spec.editor.split(".");
    if (a !== c || b !== d)
      error("V1", `made in Spine ${version || "?"}; the ${target} runtime reads ${spec.editor}`);
    else
      warn("V1", `made in Spine ${version}; the ${target} runtime is checked with ${spec.editor}`);
  }

  const bones = (doc.bones ?? []) as Json[];
  const slots = (doc.slots ?? []) as Json[];
  const anims = (doc.animations ?? {}) as Record<string, Json>;
  const all = attachments(doc);

  // N1: names the runtime and the file system read alike.
  const bad = new Set<string>();
  // Image paths may name folders; bone, slot, animation and skin names may not.
  const ok = (name: string, folders = false) =>
    (folders ? name.split("/") : [name]).every((part) => spec.names.test(part));
  for (const b of bones) if (!ok(String(b.name))) bad.add(`bone ${String(b.name)}`);
  for (const s of slots) if (!ok(String(s.name))) bad.add(`slot ${String(s.name)}`);
  for (const a of Object.keys(anims)) if (!ok(a)) bad.add(`animation ${a}`);
  for (const [skin, , name, a] of all) {
    if (!ok(skin, true)) bad.add(`skin ${skin}`);
    const path = String(a.path ?? name);
    if (!ok(path, true)) bad.add(`attachment ${path}`);
  }
  for (const b of [...bad].sort())
    error("N1", `${b}: only letters, digits and _${target === "cocos" ? "" : " or -"}`);

  // R1-R3: an untouched root with one Actor bone under it that carries the whole asset.
  const root = bones[0] ?? {};
  const rootName = String(root.name ?? "root");
  const moved = Object.entries(TRANSFORM_DEFAULTS).filter(
    ([k, v]) => root[k] !== undefined && Number(root[k]) !== v,
  );
  if (moved.length)
    error(
      "R1",
      `${rootName} is transformed (${moved.map(([k]) => k).join(", ")}); move it to Actor`,
    );
  for (const [name, a] of Object.entries(anims))
    if (((a.bones ?? {}) as Json)[rootName]) error("R2", `${name} keys ${rootName}; key Actor`);
  const top = bones
    .filter((b) => b.parent === rootName && !String(b.name).startsWith("_"))
    .map((b) => String(b.name));
  if (kind === "loading") {
    const pages = top.filter((b) => /^Page_\d\d$/.test(b));
    if (!pages.length) error("R3", `no Page_01, Page_02 ... bones under ${rootName}`);
  } else if (top.length !== 1 || top[0] !== "Actor")
    error(
      "R3",
      `${rootName} should hold only the Actor bone (reference bones start with _); it holds ${top.join(", ") || "nothing"}`,
    );

  // S1-S2: blend modes.
  for (const s of slots) {
    const blend = String(s.blend ?? "normal"),
      name = String(s.name);
    if (blend !== "normal" && blend !== "additive")
      error("S1", `slot ${name} blends ${blend}; use normal or additive`);
    if (blend === "additive" && !name.includes("_Add"))
      error("S2", `additive slot ${name} needs _Add in its name`);
    if (blend !== "additive" && name.includes("_Add"))
      warn("S2", `slot ${name} has _Add but blends ${blend}`);
  }

  // S3-S5, W1, T1: attachments.
  const setup = new Map(slots.map((s) => [String(s.name), s.attachment as string | undefined]));
  const slotBone = new Map(slots.map((s) => [String(s.name), String(s.bone)]));
  const used = new Set<string>();
  const clips: [string, string, number][] = [];
  let setupTriangles = 0,
    allTriangles = 0,
    maxWeightBones = 0;
  for (const [skin, slot, name, a] of all) {
    used.add(slot);
    const type = String(a.type ?? "region");
    if (type === "point") error("S3", `point attachment ${slot}/${name}; points are not used`);
    if (type === "clipping")
      clips.push([slot, name, Number(a.vertexCount ?? (a.vertices as unknown[]).length / 2)]);
    const t = triangles(a);
    allTriangles += t;
    if (skin === "default" && setup.get(slot) === name) setupTriangles += t;
    const w = weightBones(a);
    maxWeightBones = Math.max(maxWeightBones, w);
    if (w > 5) error("W1", `${slot}/${name} binds a vertex to ${w} bones (5 at most; Prune)`);
    if (isTextOrNumber(name) || isTextOrNumber(String(a.path ?? ""))) {
      const file = String(a.path ?? name)
        .split("/")
        .at(-1)!;
      if (!file.startsWith("_")) error("T1", `text or number ${slot}/${name} should start with _`);
      const tf = Object.entries(TRANSFORM_DEFAULTS).filter(
        ([k, v]) => a[k] !== undefined && Number(a[k]) !== v,
      );
      if (tf.length)
        error(
          "T1",
          `text or number ${slot}/${name} is moved (${tf.map(([k]) => k).join(", ")}); move its bone`,
        );
    } else if (slotBone.get(slot)?.startsWith("HP_") && type !== "clipping")
      error(
        "T1",
        `${slotBone.get(slot)} holds ${slot}/${name}; HP_ bones hold only text and numbers`,
      );
  }
  for (const s of slots)
    if (!used.has(String(s.name))) warn("S5", `slot ${String(s.name)} is empty; delete it`);
  if (clips.length > spec.clipping)
    error(
      "S4",
      spec.clipping
        ? `${clips.length} clipping masks; one skeleton uses ${spec.clipping} at most`
        : `${clips.length} clipping masks; the ${target} runtime takes none`,
    );
  for (const [slot, name, n] of clips)
    if (n > 8) error("S4", `clipping ${slot}/${name} has ${n} points (4, at most 8)`);
    else if (n > 4) warn("S4", `clipping ${slot}/${name} has ${n} points (4 is best)`);

  // U1: what the setup pose shows.
  const shown = slots.filter((s) => s.attachment);
  if (target !== "cocos") {
    if (!shown.length) error("U1", "the setup pose shows no image");
    else if (shown.every((s) => s.blend === "additive"))
      error("U1", "the setup pose shows only additive images");
  }

  // L1-L3: limits. Draw calls: one batch per run of the same blend mode in draw order.
  const blends = shown.map((s) => String(s.blend ?? "normal"));
  const drawCalls = blends.length
    ? 1 + blends.slice(1).filter((b, i) => b !== blends[i]).length
    : 0;
  const table: Record<string, Limit> =
    options.largeBoard && kind in DELIVERY_LIMITS_LARGE_BOARD
      ? DELIVERY_LIMITS_LARGE_BOARD
      : DELIVERY_LIMITS;
  const limit = table[kind] as Limit | undefined;
  if (limit) {
    if (bones.length > limit[0]) error("L1", `${bones.length} bones (${kind} limit ${limit[0]})`);
    if (setupTriangles > limit[1])
      error("L2", `${setupTriangles} triangles in the setup pose (${kind} limit ${limit[1]})`);
    if (drawCalls > limit[3])
      error("L3", `about ${drawCalls} draw calls by blend changes (${kind} limit ${limit[3]})`);
  }

  // A1-A3: animations.
  for (const [name, a] of Object.entries(anims)) {
    for (const [slot, timelines] of Object.entries((a.slots ?? {}) as Record<string, Json>))
      for (const [type, keys] of Object.entries(timelines as Record<string, Json[]>)) {
        if (!SLOT_STATE_TIMELINES.has(type) || !keys.length) continue;
        if (time(keys[0]!) > 0) warn("A1", `${name}: ${slot} ${type} has no key on frame 0`);
        if (type === "attachment") {
          const names = [setup.get(slot), ...keys.map((k) => k.name as string | undefined)];
          if (names.some((n) => n && isTextOrNumber(n)))
            error(
              "T1",
              `${name}: text or number slot ${slot} is shown by alpha, not by attachment keys`,
            );
        }
      }
    if (/loop|idle/i.test(name)) {
      const timelines = [
        ...Object.entries((a.bones ?? {}) as Record<string, Record<string, Json[]>>).flatMap(
          ([bone, t]) =>
            Object.entries(t).map(([type, keys]) => [`${bone} ${type}`, keys] as const),
        ),
        ...Object.entries((a.slots ?? {}) as Record<string, Record<string, Json[]>>).flatMap(
          ([slot, t]) =>
            Object.entries(t).map(([type, keys]) => [`${slot} ${type}`, keys] as const),
        ),
      ];
      const end = Math.max(0, ...timelines.flatMap(([, keys]) => keys.map(time)));
      for (const [label, keys] of timelines)
        if (keys.length > 1 && time(keys.at(-1)!) === end && !sameValues(keys[0]!, keys.at(-1)!))
          warn("A2", `${name}: ${label} ends unlike it starts; the loop jumps`);
    }
  }
  const groups = new Map<string, [string, Set<string>][]>();
  for (const [name, a] of Object.entries(anims)) {
    const group = name.replace(/_?(In|Loop|Out|Start|End|Idle)$/i, "");
    if (group === name) continue;
    const keyed = new Set<string>();
    for (const [part, t] of [
      ...Object.entries((a.bones ?? {}) as Record<string, Json>),
      ...Object.entries((a.slots ?? {}) as Record<string, Json>),
    ])
      for (const type of Object.keys(t)) keyed.add(`${part} ${type}`);
    groups.set(group, [...(groups.get(group) ?? []), [name, keyed]]);
  }
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const every = new Set(parts.flatMap(([, k]) => [...k]));
    for (const [name, keyed] of parts) {
      const missing = [...every].filter((k) => !keyed.has(k)).sort();
      if (missing.length)
        warn(
          "A3",
          `${name} does not key ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}, which the animations it plays after key`,
        );
    }
  }

  // K1: kinds with named animations.
  if (kind === "bigwin") {
    const names = new Set(Object.keys(anims));
    const tiers = WIN_TIERS.filter((t) => names.has(`${t}_Start`) || names.has(`${t}_End`));
    if (!tiers.length) error("K1", "no <tier>_Start / <tier>_End animations (BigWin_Start ...)");
    for (const t of tiers)
      for (const phase of ["Start", "End"])
        if (!names.has(`${t}_${phase}`)) error("K1", `${t}_${phase} is missing`);
    const known = new Set(WIN_TIERS.flatMap((t) => [`${t}_Start`, `${t}_End`]));
    const other = [...names].filter((n) => !known.has(n));
    if (other.length) warn("K1", `animations outside the tier names: ${other.join(", ")}`);
  }
  if (kind === "loading") {
    for (const name of Object.keys(anims))
      if (!/^Page_\d\d$/.test(name))
        warn("K1", `loading animation ${name}: name pages Page_01, Page_02 ...`);
    const byName = new Map(bones.map((b) => [String(b.name), b]));
    for (const need of ["WIN_UP_TO", "Text", "Num"])
      if (!byName.has(need)) warn("K1", `no ${need} bone (the max-win page template)`);
    for (const need of ["Text", "Num"]) {
      const b = byName.get(need);
      if (b && Number(b.rotation ?? 0) !== 5)
        error(
          "K1",
          `${need} keeps the template's 5 degree rotation (it is ${Number(b.rotation ?? 0)})`,
        );
    }
  }

  const errors = rows.filter((r) => r.level === "error").length;
  return {
    target,
    kind,
    pass: errors === 0,
    errors,
    warnings: rows.length - errors,
    counts: {
      bones: bones.length,
      setupTriangles,
      allTriangles,
      drawCalls,
      clipping: clips.length,
      maxWeightBones,
    },
    limits: limit
      ? {
          bones: limit[0],
          setupTriangles: limit[1],
          maskTriangles: limit[2],
          drawCalls: limit[3],
          atlasPage: limit[4],
        }
      : null,
    rows,
  };
}

/**
 * A copy with an `Actor` bone between the root and everything else (R1-R3): Actor takes the
 * root's transform and keys, the root's children (but `_` reference bones), its slots and the
 * constraints that name it. World transforms are unchanged; weighted vertices name bones by index,
 * so every index moves up one. A document that already has it is returned unchanged.
 */
export function withActorBone<T extends object>(document: T): T {
  const bones = ((document as Json).bones ?? []) as Json[];
  const root = bones[0];
  if (!root) return document;
  const name = String(root.name);
  const top = bones.filter((b) => b.parent === name && !String(b.name).startsWith("_"));
  const anims = ((document as Json).animations ?? {}) as Record<string, Json>;
  const rootTransformed = Object.entries(TRANSFORM_DEFAULTS).some(
    ([k, v]) => root[k] !== undefined && Number(root[k]) !== v,
  );
  const rootKeyed = Object.values(anims).some((a) => ((a.bones ?? {}) as Json)[name]);
  if (top.length === 1 && top[0]!.name === "Actor" && !rootTransformed && !rootKeyed)
    return document;
  if (bones.some((b) => b.name === "Actor"))
    throw new Error("DELIVERY_ACTOR: an Actor bone exists but is not the root's only child");
  const doc = structuredClone(document) as Json;
  const list = doc.bones as Json[];
  const r = list[0]!;
  const actor: Json = { name: "Actor", parent: name };
  for (const k of Object.keys(TRANSFORM_DEFAULTS))
    if (r[k] !== undefined) {
      actor[k] = r[k];
      delete r[k];
    }
  if (r.transform !== undefined) actor.transform = r.transform;
  if (r.inherit !== undefined) actor.inherit = r.inherit;
  for (const b of list.slice(1))
    if (b.parent === name && !String(b.name).startsWith("_")) b.parent = "Actor";
  list.splice(1, 0, actor);
  for (const s of (doc.slots ?? []) as Json[])
    if (s.bone === name && !String(s.name).startsWith("_")) s.bone = "Actor";
  for (const kind of ["ik", "transform", "path"])
    for (const c of (doc[kind] ?? []) as Json[]) {
      if (c.target === name) c.target = "Actor";
      if (Array.isArray(c.bones)) c.bones = c.bones.map((b) => (b === name ? "Actor" : b));
    }
  for (const a of Object.values((doc.animations ?? {}) as Record<string, Json>)) {
    const keyed = a.bones as Json | undefined;
    if (keyed?.[name]) {
      keyed.Actor = keyed[name];
      delete keyed[name];
    }
  }
  // Weighted vertices: [count, bone, x, y, weight, ...]; the root's own weights go to Actor too.
  for (const [, , , a] of attachments(doc)) {
    const v = a.vertices as number[] | undefined;
    if (!v || weightBones(a) === 0) continue;
    for (let i = 0; i < v.length; i += 1 + v[i]! * 4)
      for (let j = 0; j < v[i]!; j++) v[i + 1 + j * 4] = v[i + 1 + j * 4]! + 1;
  }
  return doc as T;
}
