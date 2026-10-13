import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  MotionBriefSchema,
  type AnimationSpec,
  type KeyposeSpec,
  type MotionBrief,
} from "@autospine/schemas";
import {
  beatsFromBrief,
  beatsFromPlan,
  buildKeyposeAnimation,
  planBeats,
  planLagChain,
  planLagChainFromPlan,
  sampleAnimation,
  type BeatPlan,
} from "@autospine/motion";
import {
  animationKeyStats,
  reviewPerformance,
  type PerformanceProfile,
  type PerformanceSample,
} from "@autospine/planning";
import { evaluateRig, rigFromWorldFrames, transformPoint } from "@autospine/rig";

const FPS = 30,
  FRAMES = 60;
/** Synthetic character: three independent parts under a static root, so part tracks stay readable. */
const rig = rigFromWorldFrames("synthetic", "Synthetic", [
  { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "body", name: "body", parentId: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "head", name: "head", parentId: "root", length: 0, world: [1, 0, 0, 1, 0, -120] },
  { id: "ear", name: "ear", parentId: "root", length: 0, world: [1, 0, 0, 1, 40, -180] },
]);
function brief(patch: Partial<MotionBrief> = {}): MotionBrief {
  return {
    schemaVersion: "0.1",
    kind: "motion-brief",
    id: "brief",
    name: "brief",
    fps: FPS,
    frames: FRAMES,
    loop: false,
    phases: [{ kind: "anticipation" }, { kind: "travel" }, { kind: "settle" }, { kind: "hold" }],
    ...patch,
  };
}
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};
const framesOf = (plan: BeatPlan) => plan.beats.map((b) => b.frame);
const lengths = (plan: BeatPlan) => Object.fromEntries(plan.phases.map((p) => [p.kind, p.frames]));

describe("beat planner structure", () => {
  it("accepts the brief as a schema contract", () => {
    expect(Value.Check(MotionBriefSchema, brief())).toBe(true);
    expect(Value.Check(MotionBriefSchema, { ...brief(), unexpected: true })).toBe(false);
    expect(MotionBriefSchema.$id).toBe("MotionBrief-0.1");
  });

  it("gives travel the largest share without any timing input", () => {
    const plan = planBeats(brief());
    const share = lengths(plan);
    expect(plan.rhythm).toEqual({ snappiness: 0.5, holdBias: 0.5 });
    expect(share.travel).toBeGreaterThan(share.hold! + share.anticipation!);
    expect(share.travel! / FRAMES).toBeGreaterThan(0.4);
    expect(share.anticipation).toBeLessThan(share.hold!);
    expect(share.settle).toBeLessThan(share.hold!);
    expect(framesOf(plan).at(-1)).toBe(FRAMES);
  });

  it("allocates shares, not seconds: doubling the budget doubles every phase", () => {
    const short = planBeats(brief()),
      long = planBeats(brief({ frames: 2 * FRAMES }));
    for (let i = 0; i < short.phases.length; i++)
      expect(long.phases[i]!.frames).toBeCloseTo(2 * short.phases[i]!.frames, -0.4);
    // seconds and frames are the same budget on the brief's own grid
    expect(framesOf(planBeats(brief({ frames: undefined, seconds: 2 })))).toEqual(framesOf(short));
  });

  it("is deterministic and free of clocks, randomness and IO", () => {
    expect(planBeats(brief())).toEqual(planBeats(brief()));
    const source = readFileSync(resolve("packages/motion/src/beats.ts"), "utf8");
    expect(source).not.toMatch(/Math\.random|Date\.|performance\.now|node:|require\(/);
  });

  it("moves time between moving and read phases with snappiness", () => {
    const snappy = lengths(planBeats(brief({ rhythm: { snappiness: 1 } }))),
      even = lengths(planBeats(brief({ rhythm: { snappiness: 0 } })));
    expect(snappy.travel).toBeLessThan(even.travel!);
    expect(snappy.hold).toBeGreaterThan(even.hold!);
    // One octave end to end: the extremes differ by a factor of two in share terms.
    expect(even.travel! / even.hold!).toBeCloseTo(4 * (snappy.travel! / snappy.hold!), 0);
  });

  it("moves time between read phases and settle with holdBias", () => {
    const held = lengths(planBeats(brief({ rhythm: { holdBias: 1 } }))),
      physical = lengths(planBeats(brief({ rhythm: { holdBias: 0 } })));
    expect(held.hold).toBeGreaterThan(physical.hold!);
    expect(held.settle).toBeLessThan(physical.settle!);
  });

  it("derives the arrival ease from the phase that ends at each beat", () => {
    const plan = planBeats(brief());
    expect(plan.beats.map((b) => b.ease)).toEqual([undefined, "sine", "out", "out", "hold"]);
    expect(plan.beats.map((b) => b.endsPhase)).toEqual([
      undefined,
      "anticipation-0",
      "travel-1",
      "settle-2",
      "hold-3",
    ]);
    // An even sweep is what low snappiness means, so travel loses its deceleration accent.
    expect(planBeats(brief({ rhythm: { snappiness: 0 } })).beats[2]!.ease).toBe("sine");
    expect(planBeats(brief({ phases: [{ kind: "travel", ease: "drift" }] })).beats[1]!.ease).toBe(
      "drift",
    );
  });

  it("closes a loop on the wrap instead of repeating frame 0", () => {
    const plan = planBeats(
      brief({
        loop: true,
        phases: [{ kind: "look" }, { kind: "travel" }, { kind: "look" }, { kind: "return" }],
      }),
    );
    expect(plan.beats).toHaveLength(4);
    expect(framesOf(plan).at(-1)).toBeLessThan(FRAMES);
    expect(new Set(framesOf(plan)).size).toBe(4);
    // The opening beat is reached by the final phase: it carries the wrap segment's ease.
    expect(plan.beats[0]!.endsPhase).toBe("return-3");
    expect(plan.phases.at(-1)!.endFrame).toBe(FRAMES);
  });

  it("mirrors a loop: return costs what travel costs and both arrive with sine", () => {
    const plan = planBeats(
      brief({ frames: 72, loop: true, phases: [{ kind: "travel" }, { kind: "return" }] }),
    );
    expect(framesOf(plan)).toEqual([0, 36]);
    expect(plan.beats.map((b) => b.ease)).toEqual(["sine", "sine"]);
    // A one-shot keeps the retrace discount and the decelerating travel accent.
    const once = planBeats(brief({ frames: 72, phases: [{ kind: "travel" }, { kind: "return" }] }));
    expect(framesOf(once)).toEqual([0, 48, 72]);
    expect(once.beats[1]!.ease).toBe("out");
  });

  it("keeps beats strictly increasing and quantized even at the frame grid limit", () => {
    const plan = planBeats(
      brief({ frames: 5, phases: brief().phases.map((p) => ({ ...p, minFrames: 1 })) }),
    );
    expect(framesOf(plan)).toEqual([0, 1, 3, 4, 5]);
    expect(
      framesOf(
        planBeats(
          brief({
            frames: 4,
            loop: true,
            phases: brief().phases.map((p) => ({ ...p, minFrames: 1 })),
          }),
        ),
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it("honours explicit bounds and refuses briefs that cannot fit them", () => {
    const plan = planBeats(
      brief({
        phases: [
          { kind: "travel", maxFrames: 10 },
          { kind: "hold", minFrames: 50 },
        ],
      }),
    );
    expect(lengths(plan)).toEqual({ travel: 10, hold: 50 });
    expect(code(() => planBeats(brief({ frames: 4 })))).toBe("BEAT_BUDGET");
    expect(
      code(() =>
        planBeats(
          brief({
            phases: [
              { kind: "travel", maxFrames: 5 },
              { kind: "hold", maxFrames: 5 },
            ],
          }),
        ),
      ),
    ).toBe("BEAT_BUDGET");
  });

  it("rejects malformed briefs with stage codes", () => {
    expect(code(() => planBeats({ ...brief(), fps: 0 } as MotionBrief))).toBe("BEAT_BRIEF");
    expect(code(() => planBeats(brief({ seconds: 2 })))).toBe("BEAT_DURATION");
    expect(code(() => planBeats(brief({ frames: undefined })))).toBe("BEAT_DURATION");
    expect(
      code(() =>
        planBeats(
          brief({
            phases: [
              { kind: "hold", id: "x" },
              { kind: "hold", id: "x" },
            ],
          }),
        ),
      ),
    ).toBe("BEAT_PHASE");
    expect(code(() => planBeats(brief({ phases: [{ kind: "hold", id: "end" }] })))).toBe(
      "BEAT_PHASE",
    );
    expect(
      code(() => planBeats(brief({ phases: [{ kind: "hold", minFrames: 10, maxFrames: 4 }] }))),
    ).toBe("BEAT_PHASE");
    expect(code(() => beatsFromBrief(brief(), {}))).toBe("BEAT_POSES");
  });
});

describe("delay chain planning", () => {
  const chain = [{ id: "body" }, { id: "head", parentId: "body" }, { id: "ear", parentId: "head" }];
  it("drags each level by a fixed time, two frames at 30 fps, cumulative from the root", () => {
    const plan = planBeats(brief());
    const lags = planLagChainFromPlan(plan, chain);
    expect(lags.map((l) => l.depth)).toEqual([0, 1, 2]);
    expect(lags.map((l) => l.lag)).toEqual([0, 2, 4]);
    expect(planLagChain(chain, { fps: plan.fps })).toEqual(lags);
    expect(planLagChain(chain).map((l) => l.lag)).toEqual([0, 2, 4]);
  });
  it("does not grow with the length of the action, only with fps and snappiness", () => {
    const short = planLagChainFromPlan(planBeats(brief({ frames: 30 })), chain).map((l) => l.lag);
    const long = planLagChainFromPlan(planBeats(brief({ frames: 300 })), chain).map((l) => l.lag);
    expect(long).toEqual(short);
    expect(planLagChain(chain, { fps: 60 }).map((l) => l.lag)).toEqual([0, 4, 8]);
    const snappy = planLagChain(chain, { snappiness: 1 }).map((l) => l.lag);
    const lazy = planLagChain(chain, { snappiness: 0 }).map((l) => l.lag);
    expect(snappy[2]).toBeLessThan(4);
    expect(lazy[2]).toBeGreaterThan(4);
  });
  it("keeps one frame per level on a coarse grid or a snappy rhythm", () => {
    expect(planLagChain(chain, { fps: 6 }).map((l) => l.lag)).toEqual([0, 1, 2]);
    expect(planLagChain([{ id: "a", depth: 0 }])).toEqual([{ id: "a", depth: 0, lag: 0 }]);
  });
  it("rejects malformed chains", () => {
    expect(code(() => planLagChain([]))).toBe("BEAT_CHAIN");
    expect(code(() => planLagChain([{ id: "a" }, { id: "a" }]))).toBe("BEAT_CHAIN");
    expect(code(() => planLagChain([{ id: "a", parentId: "b" }]))).toBe("BEAT_CHAIN");
    expect(code(() => planLagChain([{ id: "a", depth: 0 }, { id: "b" }]))).toBe("BEAT_CHAIN");
    expect(code(() => planLagChain(chain, { fps: 0 }))).toBe("BEAT_CHAIN");
    expect(code(() => planLagChain(chain, { snappiness: 2 }))).toBe("BEAT_CHAIN");
  });
});

// ---- integration and honest self-check ------------------------------------------------------
const controls: KeyposeSpec["controls"] = [
  { id: "bodyT", boneId: "body", channel: "translate", unit: 100 },
  { id: "headT", boneId: "head", channel: "translate", unit: 100 },
  { id: "earT", boneId: "ear", channel: "translate", unit: 100 },
];
/** Pose values are the caller's: the planner supplied none of these numbers, only the frames. */
const poses = {
  "anticipation-0": { bodyT: [0, 0] as [number, number] },
  "travel-1": { bodyT: [0, -0.15] as [number, number] },
  "settle-2": { bodyT: [0, 1] as [number, number] },
  "hold-3": { bodyT: [0, 0.85] as [number, number] },
  end: { bodyT: [0, 0.85] as [number, number] },
};
function animate(beats: KeyposeSpec["beats"], lags: number[]): AnimationSpec {
  const spec: KeyposeSpec = {
    schemaVersion: "0.1",
    kind: "keypose-spec",
    id: "planned",
    name: "planned",
    rigId: rig.id,
    fps: FPS,
    frames: FRAMES,
    loop: false,
    controls,
    beats,
    rules: [
      { rule: "follow", control: "headT", source: "bodyT", lag: lags[1]!, gain: 1 },
      { rule: "follow", control: "earT", source: "headT", lag: lags[2]! - lags[1]!, gain: 1 },
    ],
  };
  return buildKeyposeAnimation(rig, spec);
}
/**
 * Samples the compiled animation into the kept performance contract: named probe tracks on a
 * fixed frame grid, with `unit` the head hull width (a fixed 100 px box on this synthetic rig).
 * The measurer keys its relative-motion metrics on the probe names `face`/`eyes`/`pupils`, so
 * this scene binds them to its own parts - `face` = the static root, `eyes` = the driven body,
 * `pupils` = the dragged head - and repeats the same tracks under their real names for the
 * delay chain. The aliases are a naming convention of the measurer, not a claim about faces.
 */
function sampledProbes(animation: AnimationSpec): PerformanceSample {
  const track = (id: string) =>
    Array.from({ length: FRAMES + 1 }, (_, f) => {
      const pose = sampleAnimation(animation, rig, f / FPS);
      const posed = evaluateRig(rig, pose.rotations, { translations: pose.translations });
      return transformPoint(posed.get(id)!, [0, 0]) as [number, number];
    });
  const body = track("body"),
    head = track("head");
  return {
    fps: FPS,
    unit: 100,
    // Pose values move +y, so height reads straight off y: the settle is the peak, not the dip.
    yDown: false,
    probes: { face: track("root"), eyes: body, pupils: head, body, head, ear: track("ear") },
  };
}
const CHAIN = ["body", "head", "ear"] as const;
function measure(rhythm?: MotionBrief["rhythm"]) {
  const plan = planBeats(brief(rhythm ? { rhythm } : {}));
  const lags = planLagChainFromPlan(plan, [
    { id: "body" },
    { id: "head", parentId: "body" },
    { id: "ear", parentId: "head" },
  ]).map((l) => l.lag);
  const animation = animate(beatsFromPlan(plan, poses), lags);
  return { plan, animation, sample: sampledProbes(animation) };
}

describe("planned beats drive the keypose compiler", () => {
  it("produces a KeyposeSpec the compiler accepts, keyed exactly on the planned beats", () => {
    const { plan, animation } = measure();
    expect(animation.duration).toBeCloseTo(FRAMES / FPS, 12);
    const times = animation
      .translationTimelines!.find((t) => t.boneId === "body")!
      .keys.map((k) => k.time);
    expect(times).toEqual(framesOf(plan).map((f) => f / FPS));
    // Sparse by construction: one key per beat per control, not one key per frame.
    expect(times.length).toBeLessThan(FRAMES / 4);
    expect(animation.translationTimelines).toHaveLength(3);
  });
  it("accepts a pose function as well as a pose map", () => {
    const fromMap = beatsFromBrief(brief(), poses);
    const fromFunction = beatsFromBrief(brief(), (beat) => poses[beat.id as keyof typeof poses]);
    expect(fromFunction).toEqual(fromMap);
  });
});

/**
 * Self-check only. The baseline below is a *synthetic* reference take with invented round timings;
 * it is not a human animation and no number in the planner was derived from it. Landing inside
 * these bands therefore shows that the planner's structural timing is in the same regime as a
 * plausible hand-timed take on this one synthetic scene - it does NOT show human-level planning.
 * That claim needs unseen characters measured against real hand-animated baselines.
 */
describe("self-check against a synthetic performance profile", () => {
  const referenceBeats: KeyposeSpec["beats"] = [
    { frame: 0, poses: poses["anticipation-0"] },
    { frame: 6, ease: "sine", poses: poses["travel-1"] },
    { frame: 30, ease: "out", poses: poses["settle-2"] },
    { frame: 40, ease: "out", poses: poses["hold-3"] },
    { frame: 60, ease: "hold", poses: poses.end },
  ];
  // Follow lags of 2 frames per level: the invented 5/10 of the first version matched the retired
  // 1/4-of-travel rule, which measured hand-made characters contradict (median 1 and 3.3 per level).
  const referenceAnimation = animate(referenceBeats, [0, 2, 4]);
  const reference = reviewPerformance(
    sampledProbes(referenceAnimation),
    {
      id: "synthetic-reference",
      fps: FPS,
      source: "invented reference take in this test file, n=1",
      chain: [...CHAIN],
      targets: {},
    },
    animationKeyStats(referenceAnimation),
  ).metrics;
  // Tolerances are deliberately loose and relative: the question is "same regime", not "same
  // take". They replace the bands of the removed duplicate with the kept profile contract.
  const TOLERANCE: Readonly<Record<string, number>> = {
    parallaxHoldFraction: 0.2,
    pupilHoldFraction: 0.2,
    pupilPeakToMeanSpeed: 0.35,
    "peakTime:body": 0.35,
    "overshoot:body": 0.5,
    "peakDelay:head": 0.5,
    "peakDelay:ear": 0.35,
    keyDensity: 0.25,
  };
  const profile: PerformanceProfile = {
    id: "synthetic-reference",
    fps: FPS,
    source: "invented reference take in this test file, n=1",
    chain: [...CHAIN],
    targets: Object.fromEntries(
      Object.entries(TOLERANCE).map(([metric, relative]) => {
        const value = reference[metric];
        if (value === undefined) throw new Error("reference take never measured " + metric);
        const width = Math.abs(value) * relative;
        return [metric, { reference: value, min: value - width, max: value + width }];
      }),
    ),
  };
  const review = (rhythm?: MotionBrief["rhythm"]) => {
    const { sample, animation } = measure(rhythm);
    return reviewPerformance(sample, profile, animationKeyStats(animation));
  };
  const rejected = (r: ReturnType<typeof review>) =>
    r.findings.filter((f) => f.status !== "within").map((f) => f.metric);
  const statusOf = (r: ReturnType<typeof review>, metric: string) =>
    r.findings.find((f) => f.metric === metric)!.status;

  it("lands the default rhythm inside every target", () => {
    const report = review();
    expect(rejected(report)).toEqual([]);
    expect(report.within).toBe(report.total);
    expect(report.total).toBe(Object.keys(TOLERANCE).length);
  });

  it("falls outside the targets when the rhythm is pushed to an even machine sweep", () => {
    const report = review({ snappiness: 0, holdBias: 0 });
    expect(report.within).toBeLessThan(report.total);
    // Less holding than the reference is exactly the defect side of the rhythm metric.
    expect(rejected(report)).toContain("parallaxHoldFraction");
    expect(statusOf(report, "parallaxHoldFraction")).toBe("low");
  });

  it("falls outside the targets when snappiness compresses the rhythm", () => {
    const report = review({ snappiness: 1 });
    expect(report.within).toBeLessThan(report.total);
    // The chain itself shortens by one frame on a four-frame drag (-25%), which the loose +-35%
    // band cannot see: with a per-level lag the ear delay no longer separates snappiness.
    expect(
      planLagChain(
        CHAIN.map((id, depth) => ({ id, depth })),
        { snappiness: 1 },
      )[2]!.lag,
    ).toBe(3);
    expect(statusOf(report, "peakDelay:ear")).toBe("within");
  });

  it("records what this check does NOT separate", () => {
    // Honest negative result: holdBias trades hold time against settle time, and on this scene
    // both read as slow motion, so neither extreme leaves the targets. The metrics separate
    // snappiness and chain drag here; they do not separate holdBias.
    for (const holdBias of [0, 1]) expect(rejected(review({ holdBias }))).toEqual([]);
  });

  it("never claims artist approval from a synthetic profile", () => {
    expect(review().artistQualityAccepted).toBe(false);
  });
});
