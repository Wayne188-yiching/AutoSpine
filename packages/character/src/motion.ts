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

/** What motion blocks need from the planned rig. */
export interface MotionContext {
  rigId: string;
  bones: RigSpec["bones"];
  world: ReadonlyMap<string, WorldFrame>;
  chains: Readonly<Record<string, string[]>>;
}
export const motionContext = (
  rig: RigSpec,
  world: ReadonlyMap<string, WorldFrame>,
  chains: Record<string, string[]>,
): MotionContext => ({
  rigId: rig.id,
  bones: rig.bones,
  world,
  chains,
});

const r3 = (v: number) => +v.toFixed(3);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const sgn = (v: number) => (v < 0 ? -1 : 1);
type Value = number | [number, number];
type Pose = Value | { value: Value; ease: KeyposeEase };

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
  const depth = n(main.depth, "main.depth"),
    rise = n(main.rise, "main.rise"),
    tUp = Math.round(n(main.up, "main.up")),
    tDown = Math.round(n(main.down, "main.down")),
    hold = Math.round(n(main.hold, "main.hold")),
    holdDepth = main.holdDepth === undefined ? 1 : n(main.holdDepth, "main.holdDepth");
  if (!(0 < tUp && tUp < tDown && tDown + Math.max(0, hold) < C))
    failStage(
      "animation",
      "PLAN_MOTION_TIMING",
      `Main beats need 0 < up < down and down + hold < ${C}`,
    );
  const eases = { up: "out", down: "sine", hold: "drift", rest: "ease", ...main.eases } as Record<
    "up" | "down" | "hold" | "rest",
    KeyposeEase
  >;

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
        const fy = y >= 0 ? (n(s.y, "face.y") * y) / depth : (s.upRatio ?? 2 / 3) * y;
        out[s.id] = [r3(n(s.x, "face.x") * fy), r3(fy)];
      } else out[s.id] = [+(1 - (n(s.amount, `${s.id}.amount`) * y) / depth).toFixed(4), 1];
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

  const specs: KeyposeSpec[] = [];
  for (const anim of motion.animations) {
    const frames = anim.frames;
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
          if (key === "up" && b.scaleUp) {
            const v = val(raw, params, `${b.id}.up`);
            poses[b.id] = Array.isArray(v) ? [r3(v[0] * s), r3(v[1] * s)] : r3(v * s);
          } else poses[b.id] = v2(raw, `${b.id}.${key}`);
        }
        return poses;
      };
      beats.push({ frame: o, ease: eases.rest, poses: { ...rest } });
      beats.push({ frame: o + tUp, ease: eases.up, poses: at("up", -rise * s) });
      beats.push({ frame: o + tDown, ease: eases.down, poses: at("down", depth) });
      if (hold >= 1)
        beats.push({
          frame: o + tDown + hold,
          ease: eases.hold,
          poses: at("hold", depth + holdDepth),
        });
    }
    // ---- explicit keys merged by frame; the rest value goes on frame 0
    for (const k of motion.keyed ?? []) {
      const keys = k.keys[anim.name];
      if (!keys) continue;
      controls.push(control(k));
      for (const key of keys) {
        const entry = { value: v2(key.value, `${k.id}.key`), ease: key.ease };
        const beat = beats.find((b) => b.frame === key.frame);
        if (beat) beat.poses[k.id] = entry;
        else beats.push({ frame: key.frame, poses: { [k.id]: entry } });
      }
      beats.sort((a, b) => a.frame - b.frame);
      if (beats[0]!.poses[k.id] === undefined) beats[0]!.poses[k.id] = v2(k.rest, `${k.id}.rest`);
    }
    beats.sort((a, b) => a.frame - b.frame);
    // ---- overlap: follow the main control's vertical offset
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
      follow(f.id, n(f.gain, `${f.id}.gain`), n(f.lag, `${f.id}.lag`));
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
      loop: true,
      controls,
      beats,
      rules,
    });
  }
  return specs;
}
