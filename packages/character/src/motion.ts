import type {
  KeyposeBeat,
  KeyposeControl,
  KeyposeEase,
  KeyposeRule,
  KeyposeSpec,
  MotionPlan,
  PlanNumber,
  PlanValue,
  RigSpec,
} from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { num, val, type Params } from "./joints.js";
import type { WorldFrame } from "./rig.js";

/**
 * Face parallax per px of control slide (ADR-022): the first follower's mix minus the mean
 * control factor of the face plate's vertices, and the face image's width (the critic's unit).
 */
export interface FaceParallax {
  follower: string;
  perPx: number;
  unit: number;
}
/** What motion blocks need from the planned rig. */
export interface MotionContext {
  rigId: string;
  bones: RigSpec["bones"];
  world: ReadonlyMap<string, WorldFrame>;
  chains: Readonly<Record<string, string[]>>;
  faceParallax?: FaceParallax;
}
export const motionContext = (
  rig: RigSpec,
  world: ReadonlyMap<string, WorldFrame>,
  chains: Record<string, string[]>,
  faceParallax?: FaceParallax,
): MotionContext => ({
  rigId: rig.id,
  bones: rig.bones,
  world,
  chains,
  ...(faceParallax ? { faceParallax } : {}),
});

const r3 = (v: number) => +v.toFixed(3);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const sgn = (v: number) => (v < 0 ? -1 : 1);
type Value = number | [number, number];
type Pose = Value | { value: Value; ease: KeyposeEase };

/**
 * The motion one animation runs on (ADR-031): the plan's blocks with the animation's own `motion`
 * over them (its `params` merged over the plan's), and only that animation.
 */
export function motionFor(motion: MotionPlan, anim: MotionPlan["animations"][number]): MotionPlan {
  const own = anim.motion ?? {};
  return {
    ...motion,
    ...own,
    params: { ...motion.params, ...(own.params ?? {}) },
    animations: [anim],
  } as MotionPlan;
}

/** The motion plan's parameters, optionally overridden (the optimizer's search point). */
export const motionParams = (motion: MotionPlan, overrides: Params = {}): Params => ({
  ...motion.params,
  ...overrides,
});

/**
 * Compiles the motion blocks into one keypose spec per animation. The main control's vertical
 * offset is the source of every follow; sink-derived values are evaluated at each main beat depth.
 */
export function buildMotionSpecs(
  motion: MotionPlan,
  ctx: MotionContext,
  params: Params,
): KeyposeSpec[] {
  const n = (v: PlanNumber, where: string) => num(v, params, where);
  const v2 = (v: PlanValue, where: string): Value => {
    const x = val(v, params, where);
    return Array.isArray(x) ? [r3(x[0]), r3(x[1])] : r3(x);
  };
  const C = motion.cycle;
  const bone = (id: string) => {
    if (!ctx.world.has(id))
      failStage("animation", "PLAN_MOTION_BONE", `Motion references unknown bone ${id}`);
    return id;
  };
  const chain = (part: string) => {
    const ids = ctx.chains[part];
    if (!ids)
      failStage(
        "animation",
        "PLAN_MOTION_CHAIN",
        `Motion references part ${part}, which has no chain`,
      );
    return ids;
  };
  const length = (id: string) => ctx.bones.find((b) => b.id === id)!.length;
  const vertical = (id: string) =>
    Math.abs(Math.sin((ctx.world.get(bone(id))!.a * Math.PI) / 180)) * length(id);
  const control = (c: {
    id: string;
    bone: string;
    channel: KeyposeControl["channel"];
    space?: "world" | "parent" | undefined;
  }): KeyposeControl => ({
    id: c.id,
    boneId: bone(c.bone),
    channel: c.channel,
    ...(c.space ? { space: c.space } : {}),
  });

  const main = motion.main;
  const breath = main.shape === "breath";
  const depth = n(main.depth, "main.depth"),
    tDown = Math.round(n(main.down, "main.down"));
  let rise = 0,
    tUp = 0,
    hold = 0,
    holdDepth = 1;
  if (breath) {
    if (!(0 < tDown && tDown < C))
      failStage("animation", "PLAN_MOTION_TIMING", `A breath needs 0 < down < ${C}`);
  } else {
    if (main.up === undefined || main.hold === undefined || main.rise === undefined)
      failStage("animation", "PLAN_MOTION_TIMING", "A settle main cycle needs up, hold and rise");
    rise = n(main.rise, "main.rise");
    tUp = Math.round(n(main.up, "main.up"));
    hold = Math.round(n(main.hold, "main.hold"));
    holdDepth = main.holdDepth === undefined ? 1 : n(main.holdDepth, "main.holdDepth");
    if (!(0 < tUp && tUp < tDown && tDown + Math.max(0, hold) < C))
      failStage(
        "animation",
        "PLAN_MOTION_TIMING",
        `Main beats need 0 < up < down and down + hold < ${C}`,
      );
  }
  const eases = {
    up: "out",
    down: "sine",
    hold: "drift",
    rest: breath ? "sine" : "ease",
    ...main.eases,
  } as Record<"up" | "down" | "hold" | "rest", KeyposeEase>;

  // Face slide at full depth: px, or a target parallax converted with the dome weights.
  const faceSlide = new Map<string, number>();
  for (const s of motion.sink ?? []) {
    if (s.kind !== "face") continue;
    if ((s.y === undefined) === (s.parallax === undefined))
      failStage("animation", "PLAN_MOTION_FACE", `${s.id}: give exactly one of y and parallax`);
    if (s.y !== undefined) faceSlide.set(s.id, n(s.y, "face.y"));
    else {
      const fp = ctx.faceParallax;
      if (!fp || !(Math.abs(fp.perPx) > 1e-6))
        failStage(
          "animation",
          "PLAN_MOTION_FACE",
          `${s.id}: parallax needs a dome-weighted face plate whose first follower moves against it`,
        );
      faceSlide.set(s.id, (n(s.parallax!, "face.parallax") * fp.unit) / fp.perPx);
    }
  }
  // Values derived from the main depth y at each beat.
  const sinkValues = (y: number): Record<string, Value> => {
    const out: Record<string, Value> = { [main.id]: [0, r3(y)] };
    for (const s of motion.sink ?? []) {
      if (s.kind === "legs")
        for (const leg of s.legs) {
          const span = vertical(leg.thigh) + vertical(leg.calf);
          const sc = 1 - y / span;
          bone(leg.foot);
          out[`th${leg.side}`] = [+sc.toFixed(5), 1];
          out[`ft${leg.side}`] = [+(1 / sc).toFixed(5), 1];
        }
      else if (s.kind === "face") {
        // A breath slides the face with the body either way; a settle lifts it by upRatio.
        const slide = faceSlide.get(s.id)!;
        // A main without depth (ADR-036: a fit takes the motion from a video) slides nothing.
        const fy = !depth
          ? 0
          : breath
            ? (slide * y) / Math.abs(depth)
            : y >= 0
              ? (slide * y) / depth
              : (s.upRatio ?? 2 / 3) * y;
        out[s.id] = [r3(n(s.x, "face.x") * fy), r3(fy)];
      } else if (s.track) {
        if (s.amount !== undefined)
          failStage("animation", "PLAN_MOTION_SQUASH", `${s.id}: give amount or track, not both`);
        const extent = vertical(s.bone);
        if (!(extent > 1e-6))
          failStage("animation", "PLAN_MOTION_SQUASH", `${s.id}: ${s.bone} has no vertical extent`);
        out[s.id] = [+(1 - y / extent).toFixed(5), 1];
      } else {
        if (s.amount === undefined)
          failStage("animation", "PLAN_MOTION_SQUASH", `${s.id}: give amount or track`);
        const amount = n(s.amount, `${s.id}.amount`);
        out[s.id] = [depth ? +(1 - (amount * y) / depth).toFixed(4) : 1, 1];
      }
    }
    return out;
  };
  const sinkControls: KeyposeControl[] = [control(main)];
  for (const s of motion.sink ?? []) {
    if (s.kind === "legs")
      for (const leg of s.legs)
        sinkControls.push(
          control({ id: `th${leg.side}`, bone: leg.thigh, channel: "scale" }),
          control({ id: `ft${leg.side}`, bone: leg.foot, channel: "scale" }),
        );
    else if (s.kind === "face") sinkControls.push(control(s));
    else sinkControls.push(control({ id: s.id, bone: s.bone, channel: "scale" }));
  }

  /**
   * Degrees per px of the main's vertical offset. `travel` is the `to` bone's arc per px of the
   * main, signed so that a positive travel moves it with the main (down as the body sinks) when it
   * sits beside the pivot; a `to` straight below or above the pivot swings clockwise.
   */
  const followGain = (f: NonNullable<MotionPlan["follow"]>[number]) => {
    if ((f.gain === undefined) === (f.travel === undefined))
      failStage("animation", "PLAN_MOTION_FOLLOW", `${f.id}: give exactly one of gain and travel`);
    if (f.gain !== undefined) return n(f.gain, `${f.id}.gain`);
    if (f.to === undefined || f.channel !== "rotate")
      failStage("animation", "PLAN_MOTION_FOLLOW", `${f.id}: travel needs a rotate control and to`);
    const a = ctx.world.get(bone(f.bone))!.o,
      b = ctx.world.get(bone(f.to))!.o,
      reach = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(reach > 1e-6))
      failStage(
        "animation",
        "PLAN_MOTION_FOLLOW",
        `${f.id}: ${f.to} sits on the origin of ${f.bone}`,
      );
    // A clockwise turn (IR, y down) moves `to` by (-dy, dx): downwards when it is right of the pivot.
    const side = b[0] - a[0] < -1e-6 ? -1 : 1;
    return (side * n(f.travel!, `${f.id}.travel`) * 180) / Math.PI / reach;
  };
  /**
   * Saccade keys: hold the previous value until each key's frame, arrive `move` frames later with
   * the key's ease; a loop that ends away from rest closes with one more move back to it.
   */
  const looks = (
    k: NonNullable<MotionPlan["keyed"]>[number],
    raw: NonNullable<MotionPlan["keyed"]>[number]["keys"][string],
    frames: number,
    loop: boolean,
  ) => {
    const move = Math.round(n(k.move!, `${k.id}.move`)),
      restValue = v2(k.rest, `${k.id}.rest`),
      same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b),
      out: { frame: number; value: Value; ease: KeyposeEase }[] = [];
    if (move < 1) failStage("animation", "PLAN_MOTION_TIMING", `${k.id}: move must be >= 1 frame`);
    let prev = restValue,
      free = 0;
    for (const key of [...raw].sort((a, b) => a.frame - b.frame)) {
      if (key.frame < free)
        failStage(
          "animation",
          "PLAN_MOTION_TIMING",
          `${k.id}: the look at ${key.frame} starts before the previous one arrives (${free})`,
        );
      if (!out.length || key.frame > free)
        out.push({ frame: key.frame, value: prev, ease: "linear" });
      prev = v2(key.value, `${k.id}.key`);
      free = key.frame + move;
      out.push({ frame: free, value: prev, ease: key.ease ?? "out" });
    }
    // A one-shot (ADR-030) ends on its last look; a loop closes back to rest.
    const end = !loop || same(prev, restValue) ? free : frames - move;
    if (end < free || free > frames || (loop && free >= frames))
      failStage(
        "animation",
        "PLAN_MOTION_TIMING",
        `${k.id}: looks need ${move} free frames before the loop ends at ${frames}`,
      );
    if (end > free) out.push({ frame: end, value: prev, ease: "linear" });
    // The key on frame 0 shapes the segment that closes the loop: make the way back a saccade too.
    if (out[0]!.frame === 0) out[0]!.ease = "out";
    else out.unshift({ frame: 0, value: restValue, ease: "out" });
    return out;
  };

  const specs: KeyposeSpec[] = [];
  for (const anim of motion.animations) {
    const frames = anim.frames,
      loop = anim.loop !== false;
    if (frames % C !== 0)
      failStage(
        "animation",
        "PLAN_MOTION_CYCLE",
        `${anim.name}: ${frames} frames is not a whole number of ${C}-frame cycles`,
      );
    const controls: KeyposeControl[] = [...sinkControls];
    const rules: KeyposeRule[] = [];
    const extra = motion.beats ?? [];
    for (const b of extra) controls.push(control(b));
    // ---- main beats, one set per cycle
    const rest: Record<string, Pose> = { ...sinkValues(0) };
    for (const b of extra) rest[b.id] = v2(b.rest, `${b.id}.rest`);
    const beats: KeyposeBeat[] = [];
    for (let c = 0; c < frames / C; c++) {
      const o = c * C,
        s =
          anim.cycleScale?.[c] === undefined
            ? 1
            : n(anim.cycleScale[c]!, `${anim.name}.cycleScale`);
      const at = (key: "up" | "down" | "hold", y: number): Record<string, Pose> => {
        const poses: Record<string, Pose> = { ...sinkValues(y) };
        for (const b of extra) {
          const raw = b[key];
          if (raw === undefined) continue;
          if (b.scaleUp && key === (breath ? "down" : "up")) {
            const v = val(raw, params, `${b.id}.up`);
            poses[b.id] = Array.isArray(v) ? [r3(v[0] * s), r3(v[1] * s)] : r3(v * s);
          } else poses[b.id] = v2(raw, `${b.id}.${key}`);
        }
        return poses;
      };
      beats.push({ frame: o, ease: eases.rest, poses: { ...rest } });
      if (breath) {
        // Symmetric breath: rest, the extreme at `down`, back to rest at the next cycle.
        beats.push({ frame: o + tDown, ease: eases.down, poses: at("down", depth * s) });
        continue;
      }
      beats.push({ frame: o + tUp, ease: eases.up, poses: at("up", -rise * s) });
      beats.push({ frame: o + tDown, ease: eases.down, poses: at("down", depth) });
      if (hold >= 1)
        beats.push({
          frame: o + tDown + hold,
          ease: eases.hold,
          poses: at("hold", depth + holdDepth),
        });
    }
    // A one-shot (ADR-030) has no next cycle to return through: the main ends at rest.
    if (!loop) beats.push({ frame: frames, ease: eases.rest, poses: { ...rest } });
    // ---- face holds (ADR-022): hold between main beats, arrive `move` frames after each beat
    for (const s of motion.sink ?? []) {
      if (s.kind !== "face" || s.move === undefined) continue;
      const move = Math.round(n(s.move, `${s.id}.move`));
      const posed = beats
        .filter((b) => b.poses[s.id] !== undefined)
        .map((b) => ({ frame: b.frame, value: b.poses[s.id] as Value }));
      for (const b of beats) delete b.poses[s.id];
      if (move < 1 || posed.some((p, i) => p.frame + move >= (posed[i + 1]?.frame ?? frames)))
        failStage(
          "animation",
          "PLAN_MOTION_TIMING",
          `${s.id}: a face move of ${move} frames must end before the next main beat`,
        );
      const put = (frame: number, value: Value, ease: KeyposeEase) => {
        const beat = beats.find((b) => b.frame === frame);
        if (beat) beat.poses[s.id] = { value, ease };
        else beats.push({ frame, poses: { [s.id]: { value, ease } } });
      };
      posed.forEach((p, i) => {
        put(p.frame, (posed[i - 1] ?? posed.at(-1)!).value, "linear");
        put(p.frame + move, p.value, "out");
      });
      beats.sort((a, b) => a.frame - b.frame);
    }
    // ---- explicit keys merged by frame; the rest value goes on frame 0
    for (const k of motion.keyed ?? []) {
      const raw = k.keys[anim.name];
      if (!raw) continue;
      controls.push(control(k));
      const keys =
        k.move === undefined
          ? raw.map((key) => ({
              frame: key.frame,
              value: v2(key.value, `${k.id}.key`),
              ease: key.ease,
            }))
          : looks(k, raw, frames, loop);
      for (const key of keys) {
        // A key without an ease takes the beat's (the keypose object form needs one).
        const entry = key.ease === undefined ? key.value : { value: key.value, ease: key.ease };
        const beat = beats.find((b) => b.frame === key.frame);
        if (beat) beat.poses[k.id] = entry;
        else beats.push({ frame: key.frame, poses: { [k.id]: entry } });
      }
      beats.sort((a, b) => a.frame - b.frame);
      if (beats[0]!.poses[k.id] === undefined) beats[0]!.poses[k.id] = v2(k.rest, `${k.id}.rest`);
    }
    beats.sort((a, b) => a.frame - b.frame);
    // ---- overlap: follow the main control's vertical offset (gain, or travel of the `to` bone)
    const follow = (id: string, gain: number, lag: number) =>
      rules.push({
        rule: "follow",
        control: id,
        source: main.id,
        component: "y",
        gain: +gain.toFixed(4),
        lag: Math.round(lag),
      });
    for (const f of motion.follow ?? []) {
      controls.push(control(f));
      if (f.channel !== "translate") {
        follow(f.id, followGain(f), n(f.lag, `${f.id}.lag`));
        continue;
      }
      // ADR-032: a translate follow moves its bone `gain` times the main's offset, `lag` frames
      // later (a head that travels further than the hips and trails them).
      if (f.gain === undefined || f.travel !== undefined || main.channel !== "translate")
        failStage(
          "animation",
          "PLAN_MOTION_FOLLOW",
          `${f.id}: a translate follow needs gain (no travel) and a translate main`,
        );
      rules.push({
        rule: "follow",
        control: f.id,
        source: main.id,
        gain: +n(f.gain!, `${f.id}.gain`).toFixed(4),
        lag: Math.round(n(f.lag, `${f.id}.lag`)),
      });
    }
    // ---- secondary cycles
    for (const cy of motion.cycles ?? []) {
      controls.push(control(cy));
      const period =
        cy.period === "animation" ? frames : Math.round(n(cy.period, `${cy.id}.period`));
      const phase =
        cy.peak !== undefined
          ? mod(Math.round(n(cy.peak, `${cy.id}.peak`)) - Math.round(period / 4), period)
          : cy.phase !== undefined
            ? Math.round(n(cy.phase, `${cy.id}.phase`))
            : cy.phaseFraction !== undefined
              ? Math.round(frames * cy.phaseFraction)
              : undefined;
      rules.push({
        rule: "cycle",
        control: cy.id,
        amplitude: v2(cy.amplitude, `${cy.id}.amplitude`),
        period,
        ...(phase !== undefined ? { phase } : {}),
      });
    }
    // ---- follow-through waves: root follows, outer bones oscillate one period per cycle
    for (const w of motion.waves ?? []) {
      const ids = chain(w.chain),
        g0 = n(w.rootGain, `${w.chain}.rootGain`),
        sign = sgn(g0),
        amp = n(w.amp, `${w.chain}.amp`),
        peak = n(w.peak, `${w.chain}.peak`),
        growth = n(w.growth, `${w.chain}.growth`),
        step = Math.round(n(w.step, `${w.chain}.step`)),
        lag = w.rootLag === undefined ? 3 : n(w.rootLag, `${w.chain}.rootLag`);
      ids.forEach((b, k) => {
        const id = `${b}_r`;
        controls.push(control({ id, bone: b, channel: "rotate" }));
        if (k === 0) return follow(id, sign * Math.abs(g0 * (w.rootGainScale ?? 1)), lag);
        rules.push({
          rule: "cycle",
          control: id,
          amplitude: r3(sign * amp * (1 + growth * k)),
          period: C,
          phase: mod(Math.round(peak) + k * step - Math.round(C / 4), C),
        });
      });
    }
    const ids = new Set<string>();
    for (const c of controls) {
      if (ids.has(c.id))
        failStage("animation", "PLAN_MOTION_CONTROL", `Control id ${c.id} is defined twice`);
      ids.add(c.id);
    }
    specs.push({
      schemaVersion: "0.1",
      kind: "keypose-spec",
      id: "kp-" + anim.name,
      name: anim.name,
      rigId: ctx.rigId,
      fps: motion.fps ?? 30,
      frames,
      loop,
      controls,
      beats,
      rules,
    });
  }
  return specs;
}
