import { describe, expect, it } from "vitest";
import { buildCharacter } from "@autospine/character";
import {
  agreePoses,
  fitRestPose,
  trackTurnJump,
  loadSkeleton,
  pose,
  premultiply,
  render,
  type FitImage,
} from "@autospine/reference";
import { fixtureLayout, fixturePlan, fixtureTextures } from "./character-fixture.js";

const VIEW = { x: -60, y: 305, width: 120, height: 310 },
  SCALE = 3;
const images = fixtureTextures();
const texture = (p: string) => {
  const im = images.get(p)!;
  return premultiply(im.width, im.height, im.rgba);
};
const frame = {
  x0: VIEW.x,
  y0: VIEW.y,
  scale: SCALE,
  width: VIEW.width * SCALE,
  height: VIEW.height * SCALE,
};

/** The fixture with the arm turned, as a picture; `only` draws just those slots. */
function picture(arm: number, only?: readonly string[]): Float32Array {
  const plan = fixturePlan();
  plan.motion.animations[0]!.pose = { arm_r: { rotate: arm } };
  const sk = loadSkeleton(buildCharacter(plan, fixtureLayout()).document);
  pose(sk, "IDLE", 0);
  if (only)
    for (const slot of sk.skeleton.slots)
      if (!only.includes(slot.data.name)) slot.setAttachment(null);
  return render(sk, texture, frame);
}
/** Straight RGBA of premultiplied layers, the first on top. */
function straight(...layers: Float32Array[]): FitImage {
  const rgba = new Uint8Array(layers[0]!.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const top = layers.find((l) => l[i + 3]! > 0.5);
    if (!top) continue;
    const a = Math.min(1, top[i + 3]!);
    rgba[i + 3] = Math.round(a * 255);
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(Math.min(1, top[i + k]! / a) * 255);
  }
  return { width: frame.width, height: frame.height, rgba };
}

describe("fit-video tracking (ADR-039)", () => {
  it("rejects a sudden angular identity switch and allows smooth turns in either direction", () => {
    const p = (r: number) => ({ r, t: [0, 0] as [number, number] });
    const forward = [
      { frame: 0, placement: p(0) },
      { frame: 4, placement: p(2) },
    ];
    expect(trackTurnJump(forward, 8, p(4), { turn: 8, maximum: 40 })).toBe(false);
    expect(trackTurnJump(forward, 8, p(28), { turn: 8, maximum: 40 })).toBe(true);
    const backward = [
      { frame: 12, placement: p(6) },
      { frame: 8, placement: p(4) },
    ];
    expect(trackTurnJump(backward, 4, p(2), { turn: 8, maximum: 40 })).toBe(false);
    expect(trackTurnJump(backward, 4, p(28), { turn: 8, maximum: 40 })).toBe(true);
  });
  const unposed = buildCharacter(fixturePlan(), fixtureLayout());
  const bones = unposed.rigging.rigged.rig.bones
    .map((b) => b.id)
    .filter((id) => !["root", "face_base", "face_ctl", "face_counter", "eyes"].includes(id));
  const fit = (image: FitImage, predict?: Record<string, { r: number; t: [number, number] }>) =>
    fitRestPose(unposed.document, "IDLE", image, (p) => images.get(p)!, {
      view: VIEW,
      bones,
      window: 40,
      ...(predict ? { predict, track: { move: 8, turn: 12 } } : {}),
    });

  it("keeps a part on its track when a look-alike lies nearer the plan's pose", () => {
    // The arm swung out 30 degrees; a copy of the arm still hangs where the plan holds it (a
    // second arm, a shadow, a similar colour patch) and a frame fitted alone takes the copy.
    const decoy = picture(0, ["Arm_R"]);
    const swung = straight(decoy, picture(-30));
    const alone = fit(swung);
    expect(Math.abs(alone.pose.arm_r?.rotate ?? 0)).toBeLessThan(5);
    // The frame before, the arm at 24 degrees without the copy, places it; tracked from there the
    // arm is found at 30 (within a degree: the copy covers its shoulder end).
    const before = fit(straight(picture(-24)));
    expect(before.pose.arm_r?.rotate).toBeCloseTo(-24, 0);
    const tracked = fit(swung, before.placements);
    expect(Math.abs(tracked.pose.arm_r!.rotate! + 30)).toBeLessThan(1.5);
    expect(tracked.lost).toEqual([]);
    // A placement nothing matches near: the bone is searched as without it, and named.
    const far = fit(straight(picture(-30)), {
      ...before.placements,
      arm_r: { r: 0, t: [400, 400] },
    });
    expect(far.lost).toContain("arm_r");
    const plain = fit(straight(picture(-30)));
    expect(Math.abs(far.pose.arm_r!.rotate! - plain.pose.arm_r!.rotate!)).toBeLessThan(0.5);
  }, 60_000);

  it("averages two fits that agree and leaves out a bone they disagree on", () => {
    const r = agreePoses(
      { spine: { rotate: 4 }, arm_r: { rotate: -30 }, hips: { x: 1, y: 2 } },
      { spine: { rotate: 5 }, arm_r: { rotate: -2 }, hips: { x: 1.4, y: 2 } },
      ["spine", "arm_r", "hips", "head"],
      { turn: 8, move: 2 },
    );
    expect(r.pose).toEqual({ spine: { rotate: 4.5 }, hips: { x: 1.2, y: 2 } });
    expect(r.disagree).toEqual(["arm_r"]);
  });

  it("keeps every refinement within the tracked turn limit, or marks the track lost", () => {
    const before = fit(straight(picture(-24)));
    const next = fitRestPose(
      unposed.document,
      "IDLE",
      straight(picture(-30)),
      (p) => images.get(p)!,
      {
        view: VIEW,
        bones,
        window: 40,
        predict: before.placements,
        track: { move: 8, turn: 2 },
      },
    );
    for (const [bone, placement] of Object.entries(next.placements)) {
      const previous = before.placements[bone];
      if (previous && !next.lost.includes(bone))
        expect(Math.abs(placement.r - previous.r)).toBeLessThanOrEqual(2.001);
    }
  });
});
