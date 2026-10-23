import { describe, expect, it } from "vitest";
import { buildCharacter } from "@autospine/character";
import {
  checkAcceptance,
  checkVideoAcceptance,
  compareToReference,
  COLLAPSE,
  deformationQA,
  loadSkeleton,
  prepareReference,
  shapeChange,
  videoPenalty,
} from "@autospine/reference";
import { fixtureImagesOnly, fixtureLayout, fixturePlan } from "./character-fixture.js";

// One 100 x 40 card on a bone, and a second card that never moves.
const card = (scale: object[], extra: Record<string, unknown> = {}) =>
  loadSkeleton({
    skeleton: { spine: "4.0.64" },
    bones: [{ name: "root" }, { name: "turn", parent: "root", x: 50 }],
    slots: [
      { name: "card", bone: "turn", attachment: "card" },
      { name: "still", bone: "root", attachment: "still" },
    ],
    skins: [
      {
        name: "default",
        attachments: {
          card: { card: { width: 100, height: 40 } },
          still: { still: { x: -80, width: 30, height: 30 } },
        },
      },
    ],
    animations: { loop: { bones: { turn: { scale: scale } } }, ...extra },
  });

describe("collapsed and squashed-through parts (ADR-045)", () => {
  it("measures a part's shape against its own: axis ratio and which way it faces", () => {
    const rest = [0, 0, 100, 0, 100, 40, 0, 40];
    const map = (a: number, b: number, c: number, d: number) =>
      rest.flatMap((v, i, r) =>
        i % 2 ? [] : [a * v + b * r[i + 1]! + 7, c * v + d * r[i + 1]! - 3],
      );
    const same = shapeChange(rest, rest)!;
    expect(same.ratio).toBeCloseTo(1, 9);
    expect(same.det).toBeCloseTo(1, 9);
    // Squashed across its width: 1:10 of its own shape, still facing the same way.
    const thin = shapeChange(rest, map(0.1, 0, 0, 1))!;
    expect(thin.ratio).toBeCloseTo(0.1, 6);
    expect(thin.det).toBeCloseTo(0.1, 6);
    // Mirrored whole, rotated and scaled up: not thinner, facing the other way.
    const c = Math.cos(0.7),
      s = Math.sin(0.7);
    const turned = shapeChange(rest, map(-2 * c, -2 * s, -2 * s, 2 * c))!;
    expect(turned.ratio).toBeCloseTo(1, 6);
    expect(turned.det).toBeLessThan(0);
    expect(shapeChange([0, 0, 1, 1, 2, 2], [0, 0, 1, 1, 2, 2])).toBeNull();
  });

  it("finds a card turned over by squashing it through a line", () => {
    // Scale x 1 -> -1 over frames 10-20 and back over 20-30 (linear): a line at frames 15 and 25.
    const sk = card([
      { time: 0, x: 1 },
      { time: 10 / 30, x: 1 },
      { time: 20 / 30, x: -1 },
      { time: 1, x: 1 },
    ]);
    const qa = deformationQA(sk, "loop", 30, undefined, []);
    expect(Object.keys(qa.collapses)).toEqual(["card"]);
    expect(qa.collapses.card!.ratio).toBeLessThan(COLLAPSE.ratio);
    // Narrower than 1:5 within a frame of each turn.
    expect(qa.collapses.card!.frames[0]).toBeGreaterThanOrEqual(14);
    expect(qa.collapses.card!.frames[1]).toBeLessThanOrEqual(26);
    expect(qa.flips.card!.map((f) => Math.round(f))).toEqual([15, 25]);
    // It also faces the other way on whole frames, which the triangle check already counts.
    expect(qa.inversions.card).toBe(2);
  });

  it("does not count a reflection keyed in one step (ADR-035)", () => {
    const sk = card([
      { time: 0, x: 1, curve: "stepped" },
      { time: 10 / 30, x: -1, curve: "stepped" },
      { time: 20 / 30, x: 1, curve: "stepped" },
      { time: 1, x: 1 },
    ]);
    const qa = deformationQA(sk, "loop", 30, undefined, []);
    expect(qa.collapses).toEqual({});
    expect(qa.flips).toEqual({});
    expect(qa.inversions.card).toBe(2);
  });

  it("finds a turn that goes and comes back between two whole frames", () => {
    // Frames 10 and 11 both face forward; the card turns over twice in between.
    const sk = card([
      { time: 0, x: 1 },
      { time: 10 / 30, x: 1 },
      { time: 10.6 / 30, x: -1 },
      { time: 11 / 30, x: 1 },
      { time: 1, x: 1 },
    ]);
    const qa = deformationQA(sk, "loop", 30, undefined, []);
    expect(qa.inversions).toEqual({});
    expect(qa.flips.card).toHaveLength(2);
    expect(qa.flips.card!.every((f) => f > 10 && f < 11)).toBe(true);
  });

  it("leaves out squashes that are hidden, faded or excluded", () => {
    const squash = [
      { time: 0, x: 1 },
      { time: 0.5, x: 0.05 },
      { time: 1, x: 1 },
    ];
    expect(Object.keys(deformationQA(card(squash), "loop", 30, undefined, []).collapses)).toEqual([
      "card",
    ]);
    // Hidden while it is thin (frames 10-20).
    const hidden = card(squash, {
      loop: {
        bones: { turn: { scale: squash } },
        slots: {
          card: {
            attachment: [
              { time: 0, name: "card" },
              { time: 1 / 3, name: null },
              { time: 2 / 3, name: "card" },
            ],
          },
        },
      },
    });
    expect(deformationQA(hidden, "loop", 30, undefined, []).collapses).toEqual({});
    // Faded below a quarter while it is thin.
    const faded = card(squash, {
      loop: {
        bones: { turn: { scale: squash } },
        slots: {
          card: {
            rgba: [
              { time: 0, color: "ffffffff" },
              { time: 1 / 3, color: "ffffff10" },
              { time: 2 / 3, color: "ffffff10" },
              { time: 1, color: "ffffffff" },
            ],
          },
        },
      },
    });
    expect(deformationQA(faded, "loop", 30, undefined, []).collapses).toEqual({});
    // An FX part listed in qa.deformExclude.
    expect(deformationQA(card(squash), "loop", 30, undefined, [/^card$/]).collapses).toEqual({});
  });

  it("fails V5 and adds to the fit penalty when a part collapses", () => {
    const base = {
      iou: [0.95, 0.95],
      parts: [],
      figure: { lag: 0, amplitude: 1, motion: 0 },
      seam: null,
    };
    const clean = checkVideoAcceptance({ ...base, deformation: { collapses: {}, flips: {} } });
    const v5 = clean.find((r) => r.id.startsWith("V5"))!;
    expect(v5).toMatchObject({ ok: true, value: [] });
    const bad = checkVideoAcceptance({
      ...base,
      deformation: {
        collapses: { arm: { ratio: 0.05, frames: [3, 4] } },
        flips: { arm: [3.5], tail: [9] },
      },
    });
    expect(bad.find((r) => r.id.startsWith("V5"))).toMatchObject({
      ok: false,
      value: ["arm", "tail"],
    });
    expect(videoPenalty(bad) - videoPenalty(clean)).toBe(1);
    // A comparison without a build's QA has no V5 row.
    expect(checkVideoAcceptance(base).some((r) => r.id.startsWith("V5"))).toBe(false);
  });

  it("fails B4 only for parts the artist does not squash too", () => {
    const plan = fixturePlan();
    const probes = plan.qa!.probes!;
    const built = buildCharacter(plan, fixtureLayout());
    const reference = prepareReference(built.document, fixtureImagesOnly(), { probes });
    const { result } = compareToReference(reference, built.document, fixtureImagesOnly(), {
      probes,
    });
    const b4 = () =>
      checkAcceptance(result, built.seams).rows.find((r) => r.id.startsWith("B4 collapsed"))!;
    expect(b4()).toMatchObject({ ok: true, value: [] });
    const idle = result.deformation.IDLE!;
    idle.generated.flips = { Tail: [12.5] };
    expect(b4()).toMatchObject({ ok: false, value: ["Tail"] });
    idle.artist.collapses = { Tail: { ratio: 0.1, frames: [12, 13] } };
    expect(b4()).toMatchObject({ ok: true, value: [] });
  });
});
