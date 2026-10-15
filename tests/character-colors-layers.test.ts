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
interface RgbaKey {
  time?: number;
  color: string;
  curve?: unknown;
}
interface Doc {
  animations: Record<string, { slots?: Record<string, { rgba?: RgbaKey[] }> }>;
  transform: { name: string; bones: string[]; mixX?: number; mixY?: number }[];
}
const frameOf = (k: RgbaKey) => Math.round((k.time ?? 0) * 30);
const alphaOf = (k: RgbaKey) => parseInt(k.color.slice(6), 16) / 255;
const slotAlpha = (doc: unknown, slot: string, frame: number) => {
  const sk = loadSkeleton(doc);
  pose(sk, "IDLE", frame / 30);
  return drawList(sk).find((d) => d.slot === slot)!.color[3];
};

describe("slot colour motion: pulses and keyed colours", () => {
  it("pulses alpha between low and high, staggers each slot and closes the loop", () => {
    const plan = clone(fixturePlan());
    plan.motion.pulses = [
      { id: "glow", slots: ["Eyes", "Hair"], low: 0.4, high: 1, period: 40, peak: 10, stagger: 5 },
    ];
    const built = buildCharacter(plan, fixtureLayout());
    const doc = built.document as unknown as Doc;
    const eyes = doc.animations.IDLE!.slots!.Eyes!.rgba!;
    expect(eyes.map(frameOf)).toEqual([0, 10, 30, 50, 70, 80]);
    expect(alphaOf(eyes[1]!)).toBeCloseTo(1, 2);
    expect(alphaOf(eyes[2]!)).toBeCloseTo(0.4, 2);
    expect(eyes[0]!.color).toBe(eyes.at(-1)!.color);
    // Between two extremes the segment is a sine; the partial first segment stays linear.
    expect(eyes[1]!.curve).toBeDefined();
    expect(eyes[0]!.curve).toBeUndefined();
    const hair = doc.animations.IDLE!.slots!.Hair!.rgba!;
    expect(hair.map(frameOf)).toEqual([0, 15, 35, 55, 75, 80]);
    // The official runtime reads the same alphas.
    expect(slotAlpha(built.document, "Eyes", 10)).toBeCloseTo(1, 2);
    expect(slotAlpha(built.document, "Eyes", 30)).toBeCloseTo(0.4, 2);
    expect(slotAlpha(built.document, "Hair", 35)).toBeCloseTo(0.4, 2);
  });

  it("keys explicit colours, starting from the setup colour and closing on it", () => {
    const plan = clone(fixturePlan());
    plan.motion.colors = [
      {
        id: "flash",
        slots: ["Body"],
        keys: {
          IDLE: [
            { frame: 20, alpha: 0.5, ease: "out" },
            { frame: 40, color: "ff0000" },
          ],
        },
      },
    ];
    const doc = buildCharacter(plan, fixtureLayout()).document as unknown as Doc;
    const body = doc.animations.IDLE!.slots!.Body!.rgba!;
    expect(body.map(frameOf)).toEqual([0, 20, 40, 80]);
    expect(body.map((k) => k.color)).toEqual(["ffffffff", "ffffff80", "ff0000ff", "ffffffff"]);
    expect(body.slice(0, 3).every((k) => k.curve !== undefined)).toBe(true);
    expect(slotAlpha(doc, "Body", 20)).toBeCloseTo(128 / 255, 3);
  });

  it("lints unknown slots, periods that break the loop, double owners and unknown animations", () => {
    const plan = clone(fixturePlan());
    plan.motion.pulses = [
      { id: "p1", slots: ["Nope"], low: 0, high: 1, period: 30 },
      { id: "p2", slots: ["Eyes"], low: 0, high: 1, period: 40 },
    ];
    // Two blocks on one slot in the same animation clash (ADR-031: ownership is per animation).
    plan.motion.colors = [
      {
        id: "c1",
        slots: ["Eyes"],
        keys: { IDLE: [{ frame: 1, alpha: 0.5 }], WALK: [{ frame: 1, alpha: 0.5 }] },
      },
    ];
    const errors = lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors.join("\n");
    expect(errors).toMatch(/unknown slot Nope/);
    expect(errors).toMatch(/period 30 does not divide IDLE/);
    expect(errors).toMatch(/already coloured by p2/);
    expect(errors).toMatch(/unknown animation WALK/);
    const bad = clone(fixturePlan());
    bad.motion.pulses = [{ id: "p", slots: ["Eyes"], low: 0.2, high: 1, period: 30 }];
    expect(code(() => buildCharacter(bad, fixtureLayout()))).toBe("PLAN_MOTION_CYCLE");
    bad.motion.pulses = [{ id: "p", slots: ["Eyes"], low: 0.8, high: 0.2, period: 40 }];
    expect(code(() => buildCharacter(bad, fixtureLayout()))).toBe("PLAN_MOTION_VALUE");
  });
});

describe("2.5D face depth layers", () => {
  const turnPlan = (layers: NonNullable<CharacterPlan["face"]>["layers"]) => {
    const plan = clone(fixturePlan());
    plan.face!.layers = layers;
    // Hold the body still so only the face control moves.
    plan.motion.params.depth = 0;
    plan.motion.params.rise = 0;
    plan.motion.main.holdDepth = 0;
    // Drive the face control with a head turn instead of the breathing slide.
    plan.motion.sink = plan.motion.sink!.filter((s) => s.kind !== "face");
    // Drop the fixture's eye look so the eyes move by their follow mix only.
    plan.motion.keyed = plan.motion.keyed!.filter((k) => k.id !== "look");
    plan.motion.keyed!.push({
      id: "turn",
      bone: "face_ctl",
      channel: "translate",
      rest: [0, 0],
      keys: {
        IDLE: [
          { frame: 20, value: [12, 0], ease: "sine" },
          { frame: 40, value: [0, 0], ease: "sine" },
        ],
      },
    });
    return plan;
  };

  it("follows the face control with mix = depth x dome peak, clamped to -1..1", () => {
    const built = buildCharacter(
      turnPlan([
        { bone: "hair_1", depth: -0.4 },
        { bone: "arm_r", depth: 1.6 },
      ]),
      fixtureLayout(),
    );
    const doc = built.document as unknown as Doc;
    expect(built.rigging.faceMix.hair_1).toBeCloseTo(-0.28, 4);
    expect(built.rigging.faceMix.arm_r).toBe(1);
    const layer = doc.transform.find((t) => t.name === "Layer_hair_1")!;
    expect(layer.bones).toEqual(["hair_1"]);
    expect(layer.mixX).toBeCloseTo(-0.28, 4);
    expect(layer.mixY).toBeCloseTo(-0.28, 4);
  });

  it("moves a front follower with the turn and a back layer against it on the official runtime", () => {
    const built = buildCharacter(turnPlan([{ bone: "hair_1", depth: -0.4 }]), fixtureLayout());
    const sk = loadSkeleton(built.document);
    const at = (frame: number) => {
      pose(sk, "IDLE", frame / 30);
      return Object.fromEntries(
        ["face_ctl", "eyes", "hair_1"].map((b) => {
          const bone = sk.skeleton.findBone(b)! as unknown as { worldX: number; worldY: number };
          return [b, [bone.worldX, bone.worldY] as [number, number]];
        }),
      );
    };
    const rest = at(0),
      turned = at(20);
    const d = (b: string) => [turned[b]![0] - rest[b]![0], turned[b]![1] - rest[b]![1]] as const;
    const dot = (u: readonly number[], v: readonly number[]) => u[0]! * v[0]! + u[1]! * v[1]!;
    expect(Math.hypot(...d("face_ctl"))).toBeGreaterThan(5);
    expect(dot(d("eyes"), d("face_ctl"))).toBeGreaterThan(0);
    // A follower hung on the upright head translates in the control's frame (aligned carrier),
    // parallel to the control and scaled by its dome mix, not 90 degrees off.
    const cos =
      dot(d("eyes"), d("face_ctl")) / (Math.hypot(...d("eyes")) * Math.hypot(...d("face_ctl")));
    expect(cos).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
    expect(Math.hypot(...d("eyes")) / Math.hypot(...d("face_ctl"))).toBeCloseTo(
      built.rigging.faceMix.eyes!,
      2,
    );
    expect(dot(d("hair_1"), d("face_ctl"))).toBeLessThan(0);
    expect(Math.hypot(...d("hair_1")) / Math.hypot(...d("face_ctl"))).toBeCloseTo(0.28, 1);
  });

  it("lints layers that repeat a face bone or name an unknown bone", () => {
    const plan = clone(fixturePlan());
    plan.face!.layers = [
      { bone: "eyes", depth: 1 },
      { bone: "nope", depth: 0.5 },
    ];
    const errors = lintCharacterPlan(plan).errors.join("\n");
    expect(errors).toMatch(/face\.layers: eyes is already a face bone or follower/);
    expect(errors).toMatch(/nope/);
  });
});
