import { describe, expect, it } from "vitest";
import type { KeyposeEase } from "@autospine/schemas";
import {
  buildCharacter,
  handoverNotes,
  lintCharacterPlan,
  type Keyposes,
} from "@autospine/character";
import { easeCurve, keyFraction, lagKeys, reduceKeys, rotationsAt } from "@autospine/motion";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

/** A key reduction's value on frame g, as the key pose layer plays it. */
const played = (
  target: readonly number[],
  keys: { frames: number[]; eases: KeyposeEase[] },
  g: number,
  loop: boolean,
) => {
  const f = keys.frames,
    ends = loop ? [...f, target.length - 1] : f;
  if (!loop && g >= ends.at(-1)!) return target[ends.at(-1)!]!;
  const i = ends.findIndex((k, j) => k <= g && g <= (ends[j + 1] ?? k));
  const a = ends[i]!,
    b = ends[i + 1] ?? a;
  if (b === a) return target[a]!;
  const ease = keys.eases[(i + 1) % keys.frames.length]!;
  return target[a]! + (target[b]! - target[a]!) * keyFraction(easeCurve(ease), (g - a) / (b - a));
};
/** Largest gap between what a reduction plays (each channel `lag` frames late) and the targets. */
function worst(
  targets: readonly (readonly number[])[],
  keys: { frames: number[]; eases: KeyposeEase[] },
  stood: readonly (readonly number[])[],
  lags: readonly number[],
  loop: boolean,
) {
  const N = targets[0]!.length - 1;
  let e = 0;
  targets.forEach((t, c) => {
    for (let g = 0; g <= N; g++) {
      const at = loop ? (((g - lags[c]!) % N) + N) % N : Math.min(N, Math.max(0, g - lags[c]!));
      e = Math.max(e, Math.abs(played(stood[c]!, keys, at, loop) - t[g]!));
    }
  });
  return e;
}

describe("key pose lags (ADR-040)", () => {
  it("keeps a part that trails its parent by 4 frames on its own timing under a key cap", () => {
    // A 40-frame idle: the body sways, the head hanging from it swings 4 frames later.
    const N = 40,
      wave = (lag: number, amp: number) =>
        Array.from({ length: N + 1 }, (_, g) => amp * Math.sin((2 * Math.PI * (g - lag)) / N));
    const targets = [wave(0, 5), wave(0, 3), wave(4, 6)],
      tolerance = [0.5, 0.5, 0.5];
    for (const maxKeys of [3, 4, 5]) {
      const opts = { loop: true, minGap: 2, maxKeys };
      const plain = reduceKeys(targets, tolerance, opts);
      const lagged = lagKeys(targets, tolerance, [[0, 1], [2]], {
        ...opts,
        maxLag: 10,
        parents: [undefined, 0],
      });
      // The head 4 frames behind the body; the keys may start off frame 0's timing as a whole.
      const [body, head] = lagged.lags as [number, number];
      expect(head - body).toBe(4);
      expect(lagged.reduced.frames.length).toBeLessThanOrEqual(plain.frames.length);
      const before = worst(targets, plain, targets, [0, 0, 0], true),
        after = worst(targets, lagged.reduced, lagged.targets, [body, body, head], true);
      expect(after).toBeLessThan(0.5 * before);
    }
  });

  it("adds lags down a chain and leaves a part that moves its own way on the keys", () => {
    // Body; arm 3 frames behind the body; hand 2 behind the arm; a leg that steps twice a cycle.
    const N = 48,
      wave = (lag: number, amp: number, k = 1) =>
        Array.from({ length: N + 1 }, (_, g) => amp * Math.sin((2 * Math.PI * k * (g - lag)) / N));
    const targets = [wave(0, 6), wave(3, 8), wave(5, 10), wave(0, 4, 2)],
      tolerance = [0.5, 0.5, 0.5, 0.5];
    for (const maxKeys of [4, 6, 8]) {
      const opts = { loop: true, minGap: 2, maxKeys };
      const lagged = lagKeys(targets, tolerance, [[0], [1], [2], [3]], {
        ...opts,
        maxLag: 10,
        parents: [undefined, 0, 1, 0],
      });
      const [body, arm, hand, leg] = lagged.lags as [number, number, number, number];
      expect([arm - body, hand - arm, leg - body]).toEqual([3, 2, 0]);
      const plain = reduceKeys(targets, tolerance, opts);
      expect(worst(targets, lagged.reduced, lagged.targets, lagged.lags, true)).toBeLessThan(
        worst(targets, plain, targets, [0, 0, 0, 0], true),
      );
    }
  });

  it("leaves parts in step, and still ones, on the shared keys", () => {
    const N = 40,
      sway = Array.from({ length: N + 1 }, (_, g) => 5 * Math.sin((2 * Math.PI * g) / N)),
      noise = Array.from(
        { length: N + 1 },
        (_, g) => 0.05 * Math.sin(g * 12.9898) * (g % N ? 1 : 0),
      );
    const targets = [sway, sway.map((v) => -0.6 * v), noise],
      tolerance = [0.5, 0.5, 0.5],
      opts = { loop: true, minGap: 2, maxKeys: 4, maxLag: 10 };
    const lagged = lagKeys(targets, tolerance, [[0], [1], [2]], {
      ...opts,
      parents: [undefined, 0, 0],
    });
    expect(lagged.lags).toEqual([0, 0, 0]);
    expect(lagged.reduced).toEqual(reduceKeys(targets, tolerance, opts));
  });

  it("moves a one-shot's late part and counts what the move loses at the ends", () => {
    // Rise from frame 10 to 20 and hold; the arm does the same 3 frames later.
    const N = 60,
      rise = (lag: number) =>
        Array.from({ length: N + 1 }, (_, g) => {
          const u = Math.min(1, Math.max(0, (g - 10 - lag) / 10));
          return 20 * (0.5 - 0.5 * Math.cos(Math.PI * u));
        });
    const targets = [rise(0), rise(3)],
      tolerance = [0.5, 0.5],
      opts = { loop: false, minGap: 2, maxKeys: 4 };
    const plain = reduceKeys(targets, tolerance, opts);
    const lagged = lagKeys(targets, tolerance, [[0], [1]], {
      ...opts,
      maxLag: 7,
      parents: [undefined, 0],
    });
    expect(lagged.lags).toEqual([0, 3]);
    const before = worst(targets, plain, targets, [0, 0], false),
      after = worst(targets, lagged.reduced, lagged.targets, lagged.lags, false);
    expect(after).toBeLessThan(0.5 * before);
    // Mid-rise on frame 0: played late, the arm would hold its frame-3 value over frames 0-2. That
    // loss counts, and the lag is kept only where it still fits better.
    const early = [rise(-15), rise(-12)];
    const kept = lagKeys(early, tolerance, [[0], [1]], {
      ...opts,
      maxLag: 7,
      parents: [undefined, 0],
    });
    const plainEarly = reduceKeys(early, tolerance, opts);
    expect(worst(early, kept.reduced, kept.targets, kept.lags, false)).toBeLessThanOrEqual(
      1.05 * worst(early, plainEarly, early, [0, 0], false) + 1e-9,
    );
  });

  it("plays a bone's key poses its lag later: a loop wraps, a one-shot holds its ends", () => {
    const exact = structuredClone(fixturePlan());
    exact.motion.keyTolerance = 0;
    const keyposes: Keyposes = [
      { frame: 10, pose: { spine: { rotate: 6 }, arm_r: { rotate: -10 } } },
      { frame: 50, ease: "sine", pose: { spine: { rotate: -4 }, arm_r: { rotate: 8 } } },
    ];
    const plan = structuredClone(exact);
    plan.motion.animations[0]!.keyposes = keyposes;
    const lagged = structuredClone(plan);
    lagged.motion.animations[0]!.keyposeLag = { arm_r: 6, spine: -75 };
    const anim = (q: typeof plan) => buildCharacter(q, fixtureLayout()).animations[0]!;
    const b = anim(exact),
      p = anim(plan),
      l = anim(lagged);
    const layer = (anim: typeof b, bone: string, f: number) =>
      (rotationsAt(anim, f / 30)[bone] ?? 0) - (rotationsAt(b, f / 30)[bone] ?? 0);
    // The arm 6 frames late; the spine 75 early on an 80-frame loop, i.e. 5 late.
    // Within 0.1 degree: the layer and the plan's own arm motion are summed as fitted curves.
    for (const f of [10, 30, 50, 70])
      expect(Math.abs(layer(l, "arm_r", f + 6) - layer(p, "arm_r", f))).toBeLessThan(0.1);
    expect(Math.abs(layer(l, "spine", 15) - 6)).toBeLessThan(0.1);
    expect(Math.abs(layer(l, "spine", 0) - layer(p, "spine", 75))).toBeLessThan(0.1);
    // A one-shot: the arm reaches its last pose 6 frames later and holds it.
    for (const q of [plan, lagged]) q.motion.animations[0]!.loop = false;
    lagged.motion.animations[0]!.keyposeLag = { arm_r: 6 };
    const ps = anim(plan),
      ls = anim(lagged);
    expect(layer(ls, "arm_r", 56)).toBeCloseTo(8, 2);
    expect(layer(ls, "arm_r", 80)).toBeCloseTo(8, 2);
    expect(layer(ls, "arm_r", 3)).toBeCloseTo(layer(ps, "arm_r", 0), 2);
    const built = buildCharacter(lagged, fixtureLayout());
    expect(handoverNotes(built.rigging, built.animations)).toContain("`arm_r` 比 `spine` 晚 6 幀");
  });

  it("lints key pose lags: planned bones with key poses, whole frames under the length", () => {
    const plan = structuredClone(fixturePlan());
    plan.motion.animations[0]!.keyposes = [{ frame: 10, pose: { spine: { rotate: 2 } } }];
    plan.motion.animations[0]!.keyposeLag = { ghost: 2, head: 3, spine: 80 };
    const lint = lintCharacterPlan(plan);
    const errors = lint.errors.join("\n");
    expect(errors).toMatch(/keyposeLag: unknown bone ghost/);
    expect(errors).toMatch(/keyposeLag spine must be whole frames under 80/);
    expect(lint.warnings.join("\n")).toMatch(/keyposeLag head has no key poses to move/);
  });
});
