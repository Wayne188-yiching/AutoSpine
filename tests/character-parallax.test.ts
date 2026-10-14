import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, lintCharacterPlan } from "@autospine/character";
import { drawList, loadSkeleton, pose } from "@autospine/reference";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { validation?: { id: string } }).validation?.id ?? (e as Error).message;
  }
  return "no error";
};
type Face = Extract<NonNullable<CharacterPlan["motion"]["sink"]>[number], { kind: "face" }>;

/** The fixture breathing (rest, 5 px down at 20 of 40), head still, eyes moved by the face only. */
const parallaxPlan = (face: Partial<Face>) => {
  const plan = clone(fixturePlan());
  const m = plan.motion;
  m.main = { id: "body", bone: "hips", channel: "translate", shape: "breath", down: 20, depth: 5 };
  for (const b of m.beats!) {
    delete b.up;
    delete b.hold;
  }
  m.params.gHead = 0;
  m.keyed = [];
  m.sink = m.sink!.map((s) =>
    s.kind === "face"
      ? ({
          kind: "face",
          id: "face",
          bone: "face_ctl",
          channel: "translate",
          x: 0,
          ...face,
        } as Face)
      : s,
  );
  return plan;
};
const centre = (v: number[]) => {
  let x = 0,
    y = 0;
  for (let i = 0; i < v.length; i += 2) {
    x += v[i]!;
    y += v[i + 1]!;
  }
  return [(2 * x) / v.length, (2 * y) / v.length] as const;
};
/** Eyes against the face plate (the critic's probes), in head widths of the 80 px head image. */
const relative = (document: unknown, frame: number) => {
  const sk = loadSkeleton(document);
  pose(sk, "IDLE", frame / 30);
  const d = drawList(sk),
    eyes = centre(d.find((x) => x.slot === "Eyes")!.verts),
    head = centre(d.find((x) => x.slot === "Head")!.verts);
  return [(eyes[0] - head[0]) / 80, (eyes[1] - head[1]) / 80] as const;
};

describe("face parallax targets and holds (ADR-022)", () => {
  it("slides the face so the first follower travels the target parallax against the plate", () => {
    for (const target of [0.015, 0.03]) {
      const built = buildCharacter(parallaxPlan({ parallax: target }), fixtureLayout());
      const fp = built.rigging.motion.faceParallax!;
      expect(fp.follower).toBe("eyes");
      expect(fp.unit).toBeCloseTo(80, 3);
      expect(fp.perPx).toBeGreaterThan(0.05);
      const a = relative(built.document, 0),
        b = relative(built.document, 20);
      expect(Math.abs(b[1] - a[1])).toBeCloseTo(target, 3);
      expect(Math.abs(b[0] - a[0])).toBeLessThan(1e-3);
    }
  });

  it("holds the face between main beats and moves it within `move` frames", () => {
    const built = buildCharacter(parallaxPlan({ parallax: 0.03, move: 4 }), fixtureLayout());
    const doc = built.document as unknown as {
      animations: { IDLE: { bones: { face_ctl: { translate: { time?: number; y?: number }[] } } } };
    };
    const keys = doc.animations.IDLE.bones.face_ctl.translate;
    expect(keys.map((k) => Math.round((k.time ?? 0) * 30))).toEqual([
      0, 4, 20, 24, 40, 44, 60, 64, 80,
    ]);
    const y = keys.map((k) => +(k.y ?? 0).toFixed(4) + 0);
    // Held pairs: 4..20 at rest, 24..40 at cycle 1's extreme, 44..60 at rest; frame 0 holds the
    // last extreme (cycle 2, scaled 0.8) so the loop closes.
    expect([y[1], y[2], y[4], y[5], y[6]]).toEqual([0, 0, y[3], 0, 0]);
    expect(y[0]).toBeCloseTo(y[7]!, 6);
    expect(y[8]).toBeCloseTo(y[0]!, 6);
    expect(y[7]! / y[3]!).toBeCloseTo(0.8, 3);
    // On the runtime the eyes only move inside the move windows.
    const still = [8, 12, 16, 28, 32, 36].map((f) => relative(built.document, f)[1]);
    expect(Math.max(...still.slice(0, 3)) - Math.min(...still.slice(0, 3))).toBeLessThan(1e-6);
    expect(Math.max(...still.slice(3)) - Math.min(...still.slice(3))).toBeLessThan(1e-6);
  });

  it("needs exactly one of y and parallax, a dome face for parallax, and moves that fit", () => {
    const both = parallaxPlan({ parallax: 0.03, y: 2 });
    expect(lintCharacterPlan(both).errors.join("\n")).toMatch(/give exactly one of y and parallax/);
    expect(code(() => buildCharacter(both, fixtureLayout()))).toBe("PLAN_MOTION_FACE");
    const long = parallaxPlan({ parallax: 0.03, move: 20 });
    expect(code(() => buildCharacter(long, fixtureLayout()))).toBe("PLAN_MOTION_TIMING");
    const noDome = parallaxPlan({ parallax: 0.03 });
    noDome.meshes = noDome.meshes!.filter((m) => m.part !== "Head");
    noDome.regions = { ...noDome.regions, Head: "head" };
    delete noDome.face;
    expect(code(() => buildCharacter(noDome, fixtureLayout()))).toBe("PLAN_MOTION_FACE");
  });
});
