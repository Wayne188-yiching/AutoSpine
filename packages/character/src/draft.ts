import type { CharacterPlan, KeyposeEase, MotionPlan } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import {
  loopRecipe,
  MOTION_PRIORS,
  oneShotKind,
  oneShotTemplate,
  type OneShotKind,
} from "@autospine/motion";

/**
 * The kinds a motion draft knows (ADR-048): three loops, the one-shot templates (ADR-032), a wave,
 * and blinks added to an animation that exists (ADR-049).
 */
export const DRAFT_KINDS = [
  "idle",
  "walk",
  "prop",
  "entry",
  "exit",
  "jump",
  "charge",
  "press",
  "levelup",
  "look",
  "transition",
  "wave",
  "blink",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
const LOOPS = new Set<DraftKind>(["idle", "walk", "prop"]);
/**
 * ADR-049: conventional animation timing, not measured on artist files. A blink closes the eyes for
 * 4 frames at 30 fps, about every 3 s; a wave raises the arm in a fifth of the animation, swings
 * the forearm ±20° three times and lowers it over the last fifth.
 */
export const BLINK = Object.freeze({ closedSeconds: 4 / 30, everySeconds: 3, squash: 0.1 });
export const WAVE = Object.freeze({
  raise: 0.2,
  lower: 0.8,
  swings: 3,
  forearmDeg: 20,
  handDeg: 10,
});
const CLOSED = /clos|blink|shut|閉|眨/i;
const LID = /lid|blink|clos|shut|閉|眨/i;
const EYE = /eye|pupil|iris|white|highlight|眼|瞳/i;

export interface DraftOptions {
  animation: string;
  /** Default: from the name (idle, walk, then the one-shot keywords); a prop's loop is `prop`. */
  kind?: DraftKind;
  frames?: number;
  /** Default: a character when the plan has a face probe (`qa.probes.face`), else a prop. */
  subject?: "character" | "prop";
}
/** What the draft needs from the art, measured by the caller on the images-only setup. */
export interface DraftFigure {
  /** Head width (character) or figure width (prop), px. */
  unit: number;
  /** Parts shown in the setup pose and their boxes, IR world (y down): [x0, y0, x1, y1]. */
  parts: { slot: string; box: [number, number, number, number] }[];
  /** Bones of each strand chain, root first (the rig's `chain` bones). */
  chains: Record<string, string[]>;
  /** The head bone (follows the breath in an idle, turns in a look); none: left out. */
  head?: string;
  /** Every slot of the layout: its setup attachment and all its attachments (blinks). */
  slots?: { name: string; attachment?: string; attachments: string[] }[];
  /**
   * The eyes probe's slot, the bone it rides, that bone's world angle and the slots it carries
   * (a squash blink squashes them all).
   */
  eyes?: { slot: string; bone: string; angle: number; carries: string[] };
  /** World origin (IR, y down) and angle (IR degrees, clockwise) of the rig's bones (a wave). */
  bones?: Record<string, { origin: [number, number]; angle: number }>;
}
export interface MotionDraft {
  plan: CharacterPlan;
  animation: string;
  kind: DraftKind;
  subject: "character" | "prop";
  frames: number;
  loop: boolean;
  /** Ids of the controls the draft wrote (keyed, colors, follow, cycles) and chains it waved. */
  controls: string[];
  notes: string[];
}

type Bone = CharacterPlan["bones"][number];
type Blocks = NonNullable<MotionPlan["animations"][number]["motion"]>;
const UPPER_LIMB = /^(upper_?)?arm|^shoulder|^wing|^thigh/i;
const side = (id: string) =>
  /(_|^)(l|left)$|_l_|L$/.test(id) ? -1 : /(_|^)(r|right)$|_r_|R$/.test(id) ? 1 : 0;
const r2 = (v: number) => +v.toFixed(2);
type Put = (
  bone: string,
  channel: "translate" | "scale" | "rotate",
  rest: number | [number, number],
  keys: { frame: number; value: number | [number, number]; ease?: KeyposeEase }[],
) => void;
/** Keys collide on short animations: the last key per frame wins, in frame order. */
const dedupeKeys = <K extends { frame: number }>(keys: K[]) =>
  [...new Map(keys.map((k) => [k.frame, k])).values()].sort((a, b) => a.frame - b.frame);

/**
 * A motion draft for one animation from the measured priors (ADR-032, ADR-048): the animation's
 * own motion (a breath main, head follow, strand waves, limb swings) and, for a one-shot, keys on a
 * `move` bone above the figure, a head look and alpha on the shown parts. Only that animation
 * changes: its own `motion` is replaced and its keys are taken out of keyed and colour controls
 * the draft rewrites. A plan without a `move` bone gets one at the pivot, under the root, with the
 * root's other children moved under it. A starting point to watch and adjust, not a target.
 */
export function draftMotion(
  plan: CharacterPlan,
  figure: DraftFigure,
  options: DraftOptions,
): MotionDraft {
  const fail = (reason: string): never => failStage("animation", "PLAN_DRAFT", reason);
  const { animation } = options;
  if (!/^[A-Za-z0-9_@/ .-]{1,64}$/.test(animation))
    fail(`animation name ${animation} is not usable`);
  if (!(figure.unit > 0)) fail("the draft needs a positive unit (head or figure width)");
  const out = structuredClone(plan);
  const motion = out.motion;
  const fps = motion.fps ?? 30;
  const subject = options.subject ?? (plan.qa?.probes?.face ? "character" : "prop");
  const named: DraftKind =
    subject === "prop"
      ? /idle|loop|breath/i.test(animation)
        ? "prop"
        : oneShotKind(animation)
      : /blink|眨眼/i.test(animation)
        ? "blink"
        : /wave|hello|greet|揮手|打招呼/i.test(animation)
          ? "wave"
          : /idle|breath/i.test(animation)
            ? "idle"
            : /walk/i.test(animation)
              ? "walk"
              : oneShotKind(animation);
  const kind = options.kind ?? named;
  if (!DRAFT_KINDS.includes(kind)) fail(`unknown kind ${kind}; use ${DRAFT_KINDS.join(", ")}`);
  const loop = LOOPS.has(kind);
  const notes: string[] = [];
  const controls: string[] = [];
  const existing = motion.animations.find((a) => a.name === animation);
  type Sets = { show?: string[]; hide?: string[] };
  let pending: Sets = {};
  const frames =
    options.frames ??
    existing?.frames ??
    Math.round(fps * (kind === "walk" ? 4 / 3 : loop ? 2 : 1.5));
  if (!Number.isInteger(frames) || frames < 4 || frames > 3600) fail("frames must be 4..3600");
  if (!options.frames && !existing && !loop)
    notes.push(`${frames} frames (1.5 s) by default for a new one-shot; pass frames to change it`);

  // Ids already taken anywhere in the plan's motion.
  const taken = new Set<string>();
  const collect = (m: Record<string, unknown> | undefined) => {
    for (const v of Object.values(m ?? {})) {
      // A list of controls (follow, keyed, colors…) or one control (main).
      const items: unknown[] = Array.isArray(v) ? v : [v];
      for (const c of items)
        if (c && typeof c === "object" && "id" in c) taken.add(String((c as { id: unknown }).id));
    }
  };
  collect(motion as unknown as Record<string, unknown>);
  for (const a of motion.animations) collect(a.motion as Record<string, unknown> | undefined);
  const slug = animation.replace(/[^A-Za-z0-9_]/g, "_");
  const id = (what: string) => {
    let k = `${slug}_${what}`;
    for (let n = 2; taken.has(k); n++) k = `${slug}_${what}${n}`;
    taken.add(k);
    controls.push(k);
    return k;
  };

  const bones = out.bones;
  const boneIds = new Set(bones.flatMap((b) => ("id" in b ? [b.id] : [])));

  // Blinks go into an animation that exists, over its motion (ADR-049).
  if (kind === "blink") {
    if (!existing)
      fail(
        `blinks go into an animation the plan has, and it has no ${animation}; add them to the idle (kind blink)`,
      );
    // The animation's own length: blinks do not change it.
    const length = existing!.frames;
    if (options.frames !== undefined && options.frames !== length)
      notes.push(
        `blinks follow ${animation}'s ${length} frames; frames ${options.frames} was not used`,
      );
    const closed = Math.max(2, Math.round(BLINK.closedSeconds * fps));
    const count = Math.max(1, Math.round(length / (BLINK.everySeconds * fps)));
    const at = Array.from({ length: count }, (_, k) =>
      Math.round((length * (0.4 + k)) / count),
    ).filter((f) => f + closed < length);
    if (!at.length) fail(`${animation} is too short to blink in (${length} frames)`);
    const hidden = new Set(existing!.hide ?? []);
    const slots = (figure.slots ?? []).filter((s) => !hidden.has(s.name));
    // A closed-eye image of a shown slot, else eyelid slots hidden in setup, as artists do.
    let swaps = slots.flatMap((s) => {
      const on = s.attachment && s.attachments.find((a) => a !== s.attachment && CLOSED.test(a));
      return on ? [{ slot: s.name, on, off: s.attachment! as string | null }] : [];
    });
    if (!swaps.length)
      swaps = slots.flatMap((s) => {
        const on =
          s.attachments.find((a) => LID.test(a)) ??
          (LID.test(s.name) ? s.attachments[0] : undefined);
        return !s.attachment && on ? [{ slot: s.name, on, off: null }] : [];
      });
    if (swaps.length) {
      const list = (motion.swaps ??= []);
      for (const s of swaps) {
        const keys = at.flatMap((f) => [
          { frame: f, attachment: s.on },
          { frame: f + closed, attachment: s.off },
        ]);
        const entry = list.find((e) => e.slot === s.slot);
        if (entry?.keys[animation]) notes.push(`replaced ${animation}'s swaps of ${s.slot}`);
        if (entry) entry.keys[animation] = keys;
        else list.push({ slot: s.slot, keys: { [animation]: keys } });
        controls.push(`swaps:${s.slot}`);
      }
      notes.push(`blinks swap ${swaps.map((s) => `${s.slot} to ${s.on}`).join(", ")}`);
    } else {
      // No closed image or lid: squash the eyes' own bone across the screen's vertical.
      const eyes = figure.eyes;
      const face = plan.face;
      // Only a bone that carries eye images alone: a head, a face plate or lashes would squash too.
      const structural = [
        figure.head,
        motion.main.bone,
        face?.base,
        face?.control,
        face?.counter,
        "root",
        "move",
      ];
      const others = eyes?.carries.filter((s) => !EYE.test(s)) ?? [];
      const why = !eyes
        ? "no eyes probe (qa.probes.eyes)"
        : structural.includes(eyes.bone)
          ? `the eyes ride ${eyes.bone}, which carries more than the eyes`
          : others.length
            ? `squashing ${eyes.bone} would squash ${others.join(", ")} too`
            : "";
      if (why)
        fail(
          `nothing to blink with in ${animation}: no closed-eye image, no eyelid slot hidden in setup, and ${why}`,
        );
      const a = (eyes!.angle * Math.PI) / 180;
      const shut: [number, number] =
        Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a)) ? [1, BLINK.squash] : [BLINK.squash, 1];
      const keyed = (motion.keyed ??= []);
      dropKeys(keyed, animation, (c) => c.bone === eyes!.bone && c.channel === "scale", notes);
      keyed.push({
        id: id("blink"),
        bone: eyes!.bone,
        channel: "scale",
        rest: [1, 1],
        keys: {
          [animation]: at.flatMap((f) => [
            { frame: f, value: [1, 1] as [number, number] },
            { frame: f + 1, value: shut, ease: "in" as const },
            { frame: f + closed - 1, value: shut },
            { frame: f + closed, value: [1, 1] as [number, number], ease: "out" as const },
          ]),
        },
      });
      notes.push(`blinks squash ${eyes!.bone} to ${BLINK.squash} across the eyes`);
    }
    notes.push(
      `blinks at frames ${at.join(", ")}, ${closed} frames shut: conventional timing (about every ${BLINK.everySeconds} s), not measured`,
    );
    return {
      plan: out,
      animation,
      kind,
      subject,
      frames: length,
      loop: existing!.loop !== false,
      controls,
      notes,
    };
  }

  const head = figure.head && boneIds.has(figure.head) ? figure.head : undefined;
  if (!head && subject === "character")
    notes.push("no head bone found: no head follow or look turns");

  // A new animation shows the parts another one shows (pose sets, ADR-021), the idle first.
  if (!existing) {
    const like =
      motion.animations.find((a) => /idle/i.test(a.name) && (a.show || a.hide)) ??
      motion.animations.find((a) => a.show || a.hide);
    if (like)
      notes.push(`${animation} shows the parts ${like.name} shows (its show and hide lists)`);
    pending = like ? { show: like.show, hide: like.hide } : {};
  }
  const sets = existing ?? pending;
  const hidden = new Set(sets.hide ?? []);
  const shownSlots = new Set([
    ...figure.parts.filter((p) => !hidden.has(p.slot)).map((p) => p.slot),
    ...(sets.show ?? []).map((s) => s.split("#")[0]!),
  ]);
  const shown = figure.parts.filter((p) => shownSlots.has(p.slot));
  const box = (shown.length ? shown : figure.parts).reduce<[number, number, number, number]>(
    ([a, b, c, d], p) => [
      Math.min(a, p.box[0]),
      Math.min(b, p.box[1]),
      Math.max(c, p.box[2]),
      Math.max(d, p.box[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  // A character turns on its feet, a prop on its centre.
  const pivot: [number, number] = [
    (box[0] + box[2]) / 2,
    subject === "character" ? box[3] : (box[1] + box[3]) / 2,
  ];
  const limbs = [...boneIds].filter((b) => UPPER_LIMB.test(b));
  const arms = limbs.filter((b) => !/thigh/i.test(b));
  const thighs = limbs.filter((b) => /thigh/i.test(b));

  // The animation's own motion: a breath main on the plan's main bone.
  const mainPlan = motion.main;
  // A loop's cycle divides its frames, so the loop closes on a whole cycle.
  const cycleOf = (c: number) => {
    const n = Math.max(1, Math.round(frames / c));
    if (frames % n) notes.push(`${frames} frames do not split into ${n} equal cycles`);
    return Math.max(4, Math.round(frames / n));
  };
  // One cycle over the whole animation unless a loop recipe sets its own below.
  let cycle = frames;
  const own: Blocks = { beats: [], follow: [], waves: [], cycles: [] };
  const main = (depth: number) => ({
    id: mainPlan.id,
    bone: mainPlan.bone,
    channel: mainPlan.channel,
    ...(mainPlan.space ? { space: mainPlan.space } : {}),
    shape: "breath" as const,
    down: Math.round(cycle / 2),
    depth: r2(depth),
  });
  const chainWaves = (rootDeg: number, depth: number, step: number) => {
    for (const [part, ids] of Object.entries(figure.chains)) {
      if (!ids.length) continue;
      own.waves!.push({
        chain: part,
        amp: 3,
        rootGain: depth > 0 ? r2(rootDeg / depth) : 0,
        peak: Math.round(cycle / 2) + step,
        growth: 0.3,
        step,
      });
      controls.push(`waves:${part}`);
    }
  };
  const swing = (bone: string, amplitude: number, period: number, peak: number) =>
    own.cycles!.push({
      id: id(`swing_${bone}`),
      bone,
      channel: "rotate",
      amplitude: r2(amplitude),
      period,
      peak: ((Math.round(peak) % period) + period) % period,
    });

  // A one-shot keys a `move` bone above everything; a prop loop tilts it.
  let template: ReturnType<typeof oneShotTemplate> | undefined;
  if (!loop && kind !== "wave")
    template = oneShotTemplate(animation, {
      frames,
      unit: figure.unit,
      subject,
      kind: kind as OneShotKind,
    });
  const needsMove =
    kind === "prop" ||
    (!!template && template.translate.length + template.scale.length + template.rotate.length > 0);
  if (needsMove && !boneIds.has("move")) addMove(bones, pivot, notes, fail);

  if (kind === "idle") {
    const r = loopRecipe("idle", figure.unit);
    cycle = cycleOf(fps * r.cycleSeconds);
    own.main = main(r.depth);
    if (head && head !== mainPlan.bone)
      own.follow!.push({
        id: id("head"),
        bone: head,
        channel: "translate",
        gain: r.head.gain,
        lag: r.head.lag,
      });
    chainWaves(r.strandAmplitude, r.depth, r.strandStep);
    for (const b of arms) swing(b, r.limbAmplitude, cycle, cycle / 2);
  } else if (kind === "walk") {
    const r = loopRecipe("walk", figure.unit);
    const stride = frames;
    cycle = cycleOf(stride / r.bobsPerCycle);
    own.main = main(r.depth);
    chainWaves(r.strandAmplitude, r.depth, r.strandStep);
    // Legs opposite each other, each arm opposite its own leg.
    for (const b of thighs) swing(b, r.limbAmplitude, stride, side(b) < 0 ? 0 : stride / 2);
    for (const b of arms) swing(b, r.limbAmplitude / 2, stride, side(b) < 0 ? stride / 2 : 0);
    notes.push(
      "the walk prior comes from one art (6 animations); expect to tune the swings and the bob",
    );
  } else if (kind === "prop") {
    cycle = frames;
    own.main = main(0);
    swing("move", MOTION_PRIORS.propLoop.tiltDeg.median / 2, frames, frames / 4);
  } else {
    cycle = frames;
    own.main = main(0);
    const keyed = (motion.keyed ??= []);
    const put = (
      bone: string,
      channel: "translate" | "scale" | "rotate",
      rest: number | [number, number],
      keys: { frame: number; value: number | [number, number]; ease?: KeyposeEase }[],
    ) => {
      if (!keys.length) return;
      dropKeys(keyed, animation, (c) => c.bone === bone && c.channel === channel, notes);
      keyed.push({
        id: id(`${bone}_${channel}`),
        bone,
        channel,
        rest,
        keys: { [animation]: dedupeKeys(keys) },
      });
    };
    if (kind === "wave") wave(put);
    else fromTemplate(put);
    if (!keyed.length) delete motion.keyed;
  }
  function wave(put: Put) {
    // ADR-049: the right arm (else the left), raised up and out of the body, the forearm upright.
    const world = figure.bones ?? {};
    const order = (b: string) => (side(b) > 0 ? 0 : side(b) < 0 ? 1 : 2);
    const upper = [...arms].sort((a, b) => order(a) - order(b)).find((b) => world[b]);
    if (!upper) return fail("no arm bone (arm*, shoulder*, wing*) to wave with");
    const childOf = (p: string) =>
      bones.find((b): b is Extract<Bone, { id: string }> => "id" in b && b.parent === p)?.id;
    const fore = childOf(upper),
      hand = fore ? childOf(fore) : undefined;
    const turn = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    const out = Math.sign(world[upper]!.origin[0] - pivot[0]) || 1;
    const lift = turn((out > 0 ? -45 : -135) - world[upper]!.angle);
    const R = Math.round(WAVE.raise * frames),
      L = Math.round(WAVE.lower * frames),
      n = 2 * WAVE.swings;
    const swings = (base: number, deg: number, lag: number) =>
      Array.from({ length: n + 1 }, (_, k) => ({
        frame: Math.min(frames, R + lag + Math.round((k * (L - R)) / n)),
        value: r2(base + (k === 0 || k === n ? 0 : (k % 2 ? 1 : -1) * deg * out)),
        ...(k === 0 ? { ease: "out" as const } : {}),
      }));
    put(upper, "rotate", 0, [
      { frame: 0, value: 0 },
      { frame: R, value: r2(lift), ease: "out" },
      { frame: L, value: r2(lift) },
      { frame: frames, value: 0, ease: "sine" },
    ]);
    if (fore && world[fore]) {
      const bend = turn(-90 - (world[fore]!.angle + lift));
      put(fore, "rotate", 0, [
        { frame: 0, value: 0 },
        ...swings(bend, WAVE.forearmDeg, 0),
        { frame: frames, value: 0, ease: "sine" },
      ]);
      if (hand)
        put(hand, "rotate", 0, [
          { frame: 0, value: 0 },
          ...swings(0, WAVE.handDeg, 2),
          { frame: frames, value: 0, ease: "sine" },
        ]);
    } else notes.push(`no forearm under ${upper}: only the arm raises`);
    notes.push(
      `waves ${upper}${fore ? `, ${fore}` : ""}${hand ? `, ${hand}` : ""}: conventional timing (raise by ${R}, ${WAVE.swings} swings of ±${WAVE.forearmDeg}°, lower from ${L}), not measured`,
    );
  }
  function fromTemplate(put: Put) {
    const t = template!;
    const s = t.swing;
    if (s.limbDeg > 0)
      for (const b of arms)
        swing(b, s.limbDeg / 2, s.period, side(b) < 0 ? s.period / 4 : (3 * s.period) / 4);
    if (s.strandDeg > 0)
      for (const ids of Object.values(figure.chains)) {
        const step = ids.length > 1 ? Math.round(s.tipLagFrames / (ids.length - 1)) : 0;
        ids.forEach((b, k) =>
          swing(b, s.strandDeg / 2 / ids.length, s.period, s.period / 4 + k * step),
        );
      }
    put("move", "translate", [0, 0], t.translate);
    put("move", "scale", [1, 1], t.scale);
    put("move", "rotate", 0, t.rotate);
    if (head) put(head, "rotate", 0, t.head);
    else if (t.head.length) notes.push("no `head` bone: the look's head turns were left out");
    if (t.alpha.length) {
      const colors = (motion.colors ??= []);
      dropKeys(colors, animation, (c) => c.slots.some((x) => shownSlots.has(x)), notes);
      colors.push({ id: id("alpha"), slots: [...shownSlots], keys: { [animation]: t.alpha } });
    }
  }
  if (subject === "character") {
    if (!Object.keys(figure.chains).length) notes.push("no strand chains to wave");
    if (!arms.length) notes.push("no arm bones (arm*, shoulder*, wing*) to swing");
  }
  own.cycle = cycle;

  if (!existing)
    motion.animations.push({
      name: animation,
      frames,
      ...(pending.show ? { show: pending.show } : {}),
      ...(pending.hide ? { hide: pending.hide } : {}),
    });
  const target = motion.animations.find((a) => a.name === animation)!;
  target.frames = frames;
  if (loop) delete target.loop;
  else target.loop = false;
  if (target.motion) notes.push(`replaced ${animation}'s own motion`);
  target.motion = own;
  // Poses fitted to pictures or a video stay: they are the requester's, and play over the draft.
  const kept = [
    ...(target.keyposes?.length ? [`${target.keyposes.length} key poses`] : []),
    ...(target.pose ? ["its rest pose"] : []),
    ...(target.mirror ? ["its mirror"] : []),
  ];
  if (kept.length)
    notes.push(
      `kept ${animation}'s ${kept.join(", ")}: they play over the draft; remove them to see the draft alone`,
    );
  // Per-cycle depth scales belong to the plan's old cycles.
  if (target.cycleScale) {
    delete target.cycleScale;
    notes.push(`dropped ${animation}'s cycleScale`);
  }
  return { plan: out, animation, kind, subject, frames, loop, controls, notes };
}

/** Takes one animation's keys out of the controls matching `which`; drops controls left empty. */
function dropKeys<C extends { id: string; keys: Record<string, unknown> }>(
  list: C[],
  animation: string,
  which: (c: C) => boolean,
  notes: string[],
) {
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    if (!which(c) || !(animation in c.keys)) continue;
    delete c.keys[animation];
    notes.push(`took ${animation}'s keys out of ${c.id}`);
    if (!Object.keys(c.keys).length) list.splice(i, 1);
  }
}

/** A `move` bone at the pivot under the root; the root's other children move under it. */
function addMove(
  bones: Bone[],
  pivot: [number, number],
  notes: string[],
  fail: (r: string) => never,
) {
  const root = bones.find((b): b is Extract<Bone, { id: string }> => "id" in b && !b.parent);
  if (!root) return fail("the plan has no root bone");
  for (const b of bones)
    if ("id" in b && b.parent === root.id) b.parent = "move";
    else if ("chain" in b && b.chain.parent === root.id) b.chain.parent = "move";
  bones.splice(bones.indexOf(root) + 1, 0, {
    id: "move",
    parent: root.id,
    at: { rule: "point", at: [r2(pivot[0]), r2(pivot[1])] },
    angle: 0,
  });
  notes.push(
    `added a move bone at (${r2(pivot[0])}, ${r2(pivot[1])}) under ${root.id}; other plans of this character need the same bone before merge-plans`,
  );
}
