import { Value } from "@sinclair/typebox/value";
import {
  MotionBriefSchema,
  type KeyposeBeat,
  type KeyposeEase,
  type MotionBrief,
  type MotionPhaseKind,
} from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/**
 * Deterministic beat planner: turns a declarative MotionBrief into the frame numbers a
 * `KeyposeSpec.beats` table needs. It owns *time only* - every pose value stays with the caller -
 * and it never reads a timecode from anywhere, so a brief that only says what the motion does is
 * enough. No randomness, no clock, no IO: the same brief always yields the same frames.
 *
 * ## Why the shares are what they are
 *
 * Time is allocated from one structural ladder rather than from a lookup table of observed
 * animations. The unit U is "one readable beat", the time it takes a viewer to take in an arrival
 * pose. Every phase kind is priced against U by its job:
 *
 * - `hold` = 1 U, by definition: holding *is* the act of being read.
 * - `look` = 1 U: an attention shift is a hold with a target, so it costs the same reading time.
 * - `travel` = 2 U: the travel is the thing the motion is about, so it must outweigh the sum of
 *   its own preparation and absorption (1/2 + 1/2 U) - i.e. it is the single largest share of any
 *   brief whose phases are not weighted by hand.
 * - `anticipation` = 1/2 U: it has to be felt, but if it reached a readable U it would be read as
 *   a pose of its own and the main action would lose its accent. Half a reading unit is the
 *   largest share that still cannot be read as a pose.
 * - `settle` = 1/2 U: the mirror of anticipation - the overshoot that absorbs the travel is the
 *   same kind of event as the counter-move that launched it, so it is priced the same.
 * - `return` = 1 U: half of `travel`, because a return retraces a path the viewer has already
 *   read and therefore needs no second reading.
 *
 * Shares, not seconds: each phase gets `frames * weight / sum(weights)`, so the same brief reads
 * the same at any fps and any length. `MotionPhase.weight` replaces a kind's share when the caller
 * genuinely knows better.
 *
 * ## Floors, ceilings and the frame grid
 *
 * A phase shorter than `READABLE_FRAMES` cannot be distinguished from its neighbours after
 * sampling - two consecutive sampled frames is the minimum evidence that something happened - so
 * every phase has that floor unless the brief overrides `minFrames` (a caller may deliberately
 * want a sub-readable accent; the hard floor is then one frame, because beats must strictly
 * increase). Floors and ceilings are honoured by water-filling: the most violated bound is pinned,
 * the rest of the budget is re-shared by weight, and the pass repeats. A brief whose floors do not
 * fit its own length fails loudly instead of being silently squeezed.
 *
 * ## Rhythm personality
 *
 * `snappiness` and `holdBias` are unitless in [0, 1] and default to 0.5, which reproduces the bare
 * ladder: a caller never has to tune frames. Both knobs span exactly one octave of the same base-2
 * ladder (factor `2^(k - 1/2)`, i.e. [1/sqrt2, sqrt2]), so the extremes differ by a factor of two -
 * the same step the ladder itself uses between neighbouring jobs.
 * - `snappiness` moves time out of the displacement-carrying phases into the read phases, and also
 *   selects the travel arrival ease (symmetric `sine` below the neutral point, decelerating `out`
 *   at or above it: an even sweep is literally what low snappiness means).
 * - `holdBias` moves time between the read phases and `settle`, i.e. between showing the pose and
 *   showing the physics of arriving at it.
 *
 * ## Loops
 *
 * Phase boundaries are the beats. A one-shot of P phases emits P+1 beats, the last at `frames`.
 * A loop's last boundary *is* frame 0 seen again, so a loop emits P beats in [0, frames) and the
 * opening beat carries the arrival ease of the final phase - the wrap segment. Nothing is emitted
 * twice, and because every phase keeps at least one frame after quantization the beats stay
 * strictly increasing inside the half-open range.
 *
 * ## No borrowed constants
 *
 * Every number in this file is a dimensionless ratio argued above (1/2, 1, 2 on the ladder; one
 * octave for the knobs; two frames for readability; 1/4 of a travel for a lag chain). None of them
 * is a timecode or amplitude copied from a hand-animated reference.
 */
const fail: (code: string, reason: string) => never = (code, reason) =>
  failStage("animation", code, reason);

/** Base of the structural ladder: neighbouring jobs differ by a factor of two. */
const OCTAVE = 2;
/** Two consecutive sampled frames is the least evidence that a phase happened at all. */
const READABLE_FRAMES = 2;
/** Share of one readable unit U per phase kind; see the file header for the derivation. */
const LADDER: Record<MotionPhaseKind, number> = {
  anticipation: 1 / 2,
  travel: OCTAVE,
  settle: 1 / 2,
  hold: 1,
  look: 1,
  return: 1,
};
/** Phases that carry the displacement; `snappiness` compresses these. */
const MOVING: ReadonlySet<MotionPhaseKind> = new Set<MotionPhaseKind>([
  "anticipation",
  "travel",
  "return",
]);
/** Phases that exist to be read; both knobs lengthen these. */
const READ: ReadonlySet<MotionPhaseKind> = new Set<MotionPhaseKind>(["hold", "look"]);
/** Neutral point of both knobs: 0.5 leaves the ladder untouched. */
const NEUTRAL = 0.5;
/**
 * Arrival ease per kind - `KeyposeBeat.ease` shapes the segment that *ends* at the beat, so the
 * ease belongs to the phase ending there. Decelerate into a pose (`out`), move symmetrically when
 * the phase is a small counter-move or a retrace (`sine`), freeze during a hold (`hold`).
 */
const ARRIVAL: Record<MotionPhaseKind, KeyposeEase> = {
  anticipation: "sine",
  travel: "out",
  settle: "out",
  hold: "hold",
  look: "out",
  return: "sine",
};
/** Id of the closing boundary of a one-shot; it opens no phase. */
export const END_BEAT_ID = "end";

export interface PlannedPhase {
  id: string;
  kind: MotionPhaseKind;
  /** Effective share after the kind ladder, any brief override and the rhythm knobs. */
  weight: number;
  startFrame: number;
  /** Equals `frames` for the last phase of a loop, i.e. frame 0 of the next cycle. */
  endFrame: number;
  frames: number;
}
export interface PlannedBeat {
  /** The phase this beat opens, or `END_BEAT_ID` for the closing boundary of a one-shot. */
  id: string;
  frame: number;
  /** Phase ending at this beat; absent only on the opening beat of a one-shot. */
  endsPhase?: string;
  /** Phase starting at this beat; absent only on the closing beat of a one-shot. */
  startsPhase?: string;
  /** Suggested `KeyposeBeat.ease`, derived from `endsPhase`. */
  ease?: KeyposeEase;
}
export interface BeatPlan {
  fps: number;
  frames: number;
  loop: boolean;
  /** Resolved knobs, so a report can state the rhythm that was actually used. */
  rhythm: { snappiness: number; holdBias: number };
  phases: PlannedPhase[];
  beats: PlannedBeat[];
}

/** One octave of the ladder centred on the neutral knob position. */
const octaveFactor = (knob: number): number => OCTAVE ** (knob - NEUTRAL);
function rhythmFactor(kind: MotionPhaseKind, snappiness: number, holdBias: number): number {
  const snap = octaveFactor(snappiness),
    bias = octaveFactor(holdBias);
  let factor = 1;
  if (MOVING.has(kind)) factor /= snap;
  if (READ.has(kind)) factor *= snap * bias;
  if (kind === "settle") factor /= bias;
  return factor;
}

interface Slot {
  weight: number;
  min: number;
  max: number;
}
/**
 * Water-filling: share the budget by weight, pin the single worst bound violation, repeat. Pinning
 * one slot per pass keeps the result independent of the order the violations appear in, and at
 * most one pass per slot is needed because every pass pins a slot for good.
 */
function allocate(budget: number, slots: Slot[]): number[] {
  const pinned: (number | undefined)[] = slots.map(() => undefined);
  for (let pass = 0; pass <= slots.length; pass++) {
    const free = slots.map((_, i) => i).filter((i) => pinned[i] === undefined);
    const rest = budget - pinned.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const total = free.reduce((sum, i) => sum + slots[i]!.weight, 0);
    if (free.length === 0) break;
    const share = (i: number) => (rest * slots[i]!.weight) / total;
    let worst = -1,
      worstBy = 0;
    for (const i of free) {
      const d = share(i),
        over = Math.max(slots[i]!.min - d, d - slots[i]!.max);
      if (over > worstBy) {
        worst = i;
        worstBy = over;
      }
    }
    if (worst < 0) return slots.map((s, i) => pinned[i] ?? share(i));
    pinned[worst] = share(worst) < slots[worst]!.min ? slots[worst]!.min : slots[worst]!.max;
  }
  return pinned.map((v, i) => v ?? slots[i]!.min);
}
/**
 * Rounds cumulative offsets, not durations, so quantization error never accumulates, then walks
 * forward enforcing each phase's integer floor. Integer floors are enforced after rounding rather
 * than before, so a floor can never be lost to a half-frame.
 */
function quantize(durations: number[], floors: number[], frames: number): number[] {
  const bounds = [0];
  let acc = 0;
  for (const d of durations) {
    acc += d;
    bounds.push(Math.round(acc));
  }
  bounds[bounds.length - 1] = frames;
  for (let i = 1; i < bounds.length; i++)
    bounds[i] = Math.max(bounds[i]!, bounds[i - 1]! + floors[i - 1]!);
  if (bounds[bounds.length - 1]! > frames)
    fail(
      "BEAT_BUDGET",
      `Phase floors need ${bounds[bounds.length - 1]} frames but the brief allows ${frames}`,
    );
  bounds[bounds.length - 1] = frames;
  return bounds;
}

/** Resolves the brief's length onto its own frame grid; exactly one of seconds/frames is allowed. */
function briefFrames(brief: MotionBrief): number {
  const given = [brief.seconds, brief.frames].filter((v) => v !== undefined);
  if (given.length !== 1) fail("BEAT_DURATION", "A brief states exactly one of seconds or frames");
  const frames = brief.frames ?? Math.round(brief.seconds! * brief.fps);
  if (!Number.isInteger(frames) || frames < 1 || frames > 3600)
    fail("BEAT_DURATION", "Brief length must round to 1..3600 frames on its own fps grid");
  return frames;
}

/**
 * Plans the frame of every phase boundary. Deterministic and total: either a plan that satisfies
 * every stated bound, or a failure naming the bound that does not fit.
 */
export function planBeats(brief: MotionBrief): BeatPlan {
  if (!Value.Check(MotionBriefSchema, brief)) fail("BEAT_BRIEF", "Valid MotionBrief required");
  const frames = briefFrames(brief),
    snappiness = brief.rhythm?.snappiness ?? NEUTRAL,
    holdBias = brief.rhythm?.holdBias ?? NEUTRAL;
  const ids = new Set<string>();
  const phases = brief.phases.map((phase, index) => {
    const id = phase.id ?? `${phase.kind}-${index}`;
    if (id === END_BEAT_ID)
      fail("BEAT_PHASE", `Phase id "${END_BEAT_ID}" is reserved for the closing beat`);
    if (ids.has(id)) fail("BEAT_PHASE", `Duplicate phase id ${id}`);
    ids.add(id);
    // An explicit minFrames may go below the readability floor; one frame stays mandatory so the
    // beats can keep increasing strictly.
    const min = phase.minFrames ?? READABLE_FRAMES,
      max = phase.maxFrames ?? frames;
    if (max < min) fail("BEAT_PHASE", `Phase ${id} has maxFrames below its minimum`);
    return {
      id,
      kind: phase.kind,
      ease: phase.ease,
      weight: (phase.weight ?? LADDER[phase.kind]) * rhythmFactor(phase.kind, snappiness, holdBias),
      min,
      max,
    };
  });
  const floorSum = phases.reduce((sum, p) => sum + p.min, 0);
  if (floorSum > frames)
    fail("BEAT_BUDGET", `Phase minimums need ${floorSum} frames but the brief allows ${frames}`);
  const ceilingSum = phases.reduce((sum, p) => sum + p.max, 0);
  if (ceilingSum < frames)
    fail("BEAT_BUDGET", `Phase maximums cover ${ceilingSum} of ${frames} frames`);
  const bounds = quantize(
    allocate(frames, phases),
    phases.map((p) => p.min),
    frames,
  );
  const planned: PlannedPhase[] = phases.map((p, i) => ({
    id: p.id,
    kind: p.kind,
    weight: p.weight,
    startFrame: bounds[i]!,
    endFrame: bounds[i + 1]!,
    frames: bounds[i + 1]! - bounds[i]!,
  }));
  const easeOf = (i: number): KeyposeEase => {
    const phase = phases[i]!;
    if (phase.ease !== undefined) return phase.ease;
    // Low snappiness means an even sweep, so the travel loses its deceleration accent.
    if ((phase.kind === "travel" || phase.kind === "return") && snappiness < NEUTRAL) return "sine";
    return ARRIVAL[phase.kind];
  };
  const count = phases.length;
  const beats: PlannedBeat[] = [];
  for (let i = 0; i < (brief.loop ? count : count + 1); i++) {
    const ends = brief.loop ? (i + count - 1) % count : i - 1,
      starts = i < count ? i : -1;
    beats.push({
      id: starts >= 0 ? phases[starts]!.id : END_BEAT_ID,
      frame: bounds[i]!,
      ...(ends >= 0 ? { endsPhase: phases[ends]!.id, ease: easeOf(ends) } : {}),
      ...(starts >= 0 ? { startsPhase: phases[starts]!.id } : {}),
    });
  }
  // The compiler's own contract, re-checked here so a plan can never produce an invalid table.
  for (let i = 0; i < beats.length; i++) {
    const f = beats[i]!.frame;
    if (i > 0 && f <= beats[i - 1]!.frame)
      fail("BEAT_RANGE", "Planned beats must increase strictly");
    if (f < 0 || (brief.loop ? f >= frames : f > frames))
      fail("BEAT_RANGE", "Planned beats must lie in the legal frame range");
  }
  return {
    fps: brief.fps,
    frames,
    loop: brief.loop,
    rhythm: { snappiness, holdBias },
    phases: planned,
    beats,
  };
}

export type BeatPoses = KeyposeBeat["poses"];
/** Poses per beat, keyed by `PlannedBeat.id`, or computed from the planned beat. */
export type PoseSource =
  Record<string, BeatPoses> | ((beat: PlannedBeat, index: number) => BeatPoses);
/**
 * Fills a plan with caller-supplied poses to produce a ready `KeyposeSpec.beats` table. The split
 * is deliberate and total: this module decides *when* (frame, ease), the caller decides *what*
 * (which control reaches which value). A `hold` phase therefore only holds if the caller repeats
 * the same pose at both of its beats - the stepped arrival ease freezes the value, it does not
 * invent one.
 */
export function beatsFromPlan(plan: BeatPlan, poses: PoseSource): KeyposeBeat[] {
  if (typeof poses !== "function" && (poses === null || typeof poses !== "object"))
    fail("BEAT_POSES", "A pose map or pose function is required");
  return plan.beats.map((beat, index) => {
    const value = typeof poses === "function" ? poses(beat, index) : poses[beat.id];
    if (value === undefined || typeof value !== "object")
      fail("BEAT_POSES", `No poses supplied for beat ${beat.id}`);
    return {
      frame: beat.frame,
      ...(beat.ease !== undefined ? { ease: beat.ease } : {}),
      poses: value,
    };
  });
}
/** Convenience: plan and fill in one call. */
export function beatsFromBrief(brief: MotionBrief, poses: PoseSource): KeyposeBeat[] {
  return beatsFromPlan(planBeats(brief), poses);
}
/** Frames spent carrying displacement; the time a follow-through has to happen in. */
export function travelFrames(plan: BeatPlan): number {
  return plan.phases.reduce((sum, p) => sum + (MOVING.has(p.kind) ? p.frames : 0), 0);
}

export interface LagChainPart {
  id: string;
  /** Hierarchy form: omit for a root. All parts must use the same form. */
  parentId?: string;
  /** Depth form: 0 for the driven root, increasing outward. */
  depth?: number;
}
export interface PlannedLag {
  id: string;
  depth: number;
  /** Frames to put in a `follow` rule's `lag`. */
  lag: number;
}
export interface LagChainOptions {
  /** The move the chain is dragging behind; use `travelFrames(plan)`. */
  travelFrames: number;
  snappiness?: number;
}
/**
 * Lag frames for a `follow` chain, derived from the same ladder as the phase shares.
 *
 * - Lag is a fraction of the *travel*, not of the whole animation: follow-through reads relative to
 *   the move that caused it, so the same chain works in a 1 s and a 4 s version of the brief.
 * - The whole chain's drag is capped at `anticipation / travel` = 1/4 of the travel. Beyond that
 *   the tip arrives after the main action has been read, and the drag reads as a second action
 *   rather than as overlap. Taking the cap from the ladder keeps one source of truth.
 * - Levels are spaced evenly: the chain is a uniform propagation, not a per-part style choice.
 * - The frame grid wins over the cap: one frame per level is the least lag that is still visible,
 *   so a very short travel gives `lag = depth` even though that exceeds the 1/4 cap. A zero lag
 *   would mean no overlap at all, which is the failure this helper exists to prevent.
 * - `snappiness` shortens the drag by the same octave factor it uses on the phase shares.
 */
export function planLagChain(parts: LagChainPart[], options: LagChainOptions): PlannedLag[] {
  if (!Array.isArray(parts) || parts.length === 0)
    fail("BEAT_CHAIN", "At least one chain part required");
  if (!Number.isFinite(options?.travelFrames) || options.travelFrames < 0)
    fail("BEAT_CHAIN", "Non-negative finite travelFrames required");
  const snappiness = options.snappiness ?? NEUTRAL;
  if (!Number.isFinite(snappiness) || snappiness < 0 || snappiness > 1)
    fail("BEAT_CHAIN", "snappiness must lie in [0, 1]");
  const byId = new Map<string, LagChainPart>();
  for (const part of parts) {
    if (!part || typeof part.id !== "string" || part.id.length === 0)
      fail("BEAT_CHAIN", "Every chain part needs an id");
    if (byId.has(part.id)) fail("BEAT_CHAIN", `Duplicate chain part ${part.id}`);
    byId.set(part.id, part);
  }
  const explicit = parts.filter((p) => p.depth !== undefined);
  if (explicit.length !== 0 && explicit.length !== parts.length)
    fail("BEAT_CHAIN", "Give every part a depth or none of them");
  const depthOf = (part: LagChainPart): number => {
    if (part.depth !== undefined) {
      if (!Number.isInteger(part.depth) || part.depth < 0 || part.depth > 256)
        fail("BEAT_CHAIN", `Part ${part.id} needs an integer depth in 0..256`);
      return part.depth;
    }
    let depth = 0,
      walk = part;
    while (walk.parentId !== undefined) {
      const parent = byId.get(walk.parentId);
      if (!parent) fail("BEAT_CHAIN", `Part ${walk.id} references missing parent ${walk.parentId}`);
      if (++depth > parts.length) fail("BEAT_CHAIN", "Chain parents are cyclic");
      walk = parent!;
    }
    return depth;
  };
  const depths = parts.map(depthOf),
    base = Math.min(...depths),
    span = Math.max(...depths) - base;
  const drag =
    (options.travelFrames * (LADDER.anticipation / LADDER.travel)) / octaveFactor(snappiness);
  return parts.map((part, i) => {
    const depth = depths[i]! - base;
    return {
      id: part.id,
      depth,
      lag: depth === 0 ? 0 : Math.max(depth, Math.round((depth * drag) / span)),
    };
  });
}
/** Convenience: read the travel length and rhythm straight off a plan. */
export function planLagChainFromPlan(plan: BeatPlan, parts: LagChainPart[]): PlannedLag[] {
  return planLagChain(parts, {
    travelFrames: travelFrames(plan),
    snappiness: plan.rhythm.snappiness,
  });
}
