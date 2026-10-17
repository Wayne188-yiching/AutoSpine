import { describe, expect, it } from "vitest";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, handoverNotes, lintCharacterPlan, mlsAffine } from "@autospine/character";
import { drawList, loadSkeleton, pose } from "@autospine/reference";
import { fixtureLayout, fixturePlan } from "./character-fixture.js";

type V = [number, number];

describe("moving least squares (ADR-037)", () => {
  it("reproduces an affine map exactly and translates with one point", () => {
    const p: V[] = [
      [0, 0],
      [10, 0],
      [0, 10],
      [12, 9],
    ];
    const f = ([x, y]: V): V => [1.2 * x - 0.3 * y + 5, 0.1 * x + 0.5 * y - 2];
    for (const v of [
      [3, 4],
      [-20, 7],
      [11, 9],
    ] as V[]) {
      const got = mlsAffine(p, p.map(f), v),
        want = f(v);
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
    }
    expect(mlsAffine([[0, 0]], [[3, -2]], [50, 50])).toEqual([53, 48]);
    // Points in a line cannot shape an affine map: their weighted mean move.
    const line = mlsAffine(
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 2],
        [10, 2],
      ],
      [5, 30],
    );
    expect(line[0]).toBeCloseTo(5, 9);
    expect(line[1]).toBeCloseTo(32, 9);
  });
});

/** The fixture's eyes (40 x 12 at Spine 0, 258) squashed to a third of their height on frame 20. */
function squintPlan(): CharacterPlan {
  const plan = fixturePlan();
  plan.meshing = { parts: { Eyes: { hullVertices: 12, interiorVertices: 4 } } };
  plan.motion.deforms = [
    {
      id: "squint",
      parts: ["Eyes"],
      // IR world: y down, Spine y negated.
      points: { tl: [-20, -264], tr: [20, -264], bl: [-20, -252], br: [20, -252] },
      keys: {
        IDLE: [
          { frame: 20, move: { tl: [0, 4], tr: [0, 4], bl: [0, -4], br: [0, -4] } },
          { frame: 40, move: {} },
        ],
      },
    },
  ];
  return plan;
}

describe("mesh deform keys (ADR-037)", () => {
  it("meshes a chosen region part and deforms it by control points", () => {
    const plan = squintPlan();
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const built = buildCharacter(plan, fixtureLayout());
    const doc = built.document as unknown as {
      skins: { attachments: Record<string, Record<string, { type?: string; hull?: number }>> }[];
      animations: Record<
        string,
        { deform?: Record<string, Record<string, Record<string, unknown[]>>> }
      >;
    };
    expect(doc.skins[0]!.attachments.Eyes!.Eyes!.type).toBe("mesh");
    const keys = doc.animations.IDLE!.deform!.default!.Eyes!.Eyes!;
    expect(keys.length).toBe(4); // 0, 20, 40 and the loop close on 80

    // Against the same build without the deform: a squash to a third about the eyes' centre moves
    // their outline (opaque to 5 px above and below it) by 5 x 2/3 on frame 20; frame 0 is setup.
    const plain = fixturePlan();
    plain.meshing = plan.meshing;
    const a = loadSkeleton(built.document),
      b = loadSkeleton(buildCharacter(plain, fixtureLayout()).document);
    const eyes = (sk: typeof a, frame: number) => {
      pose(sk, "IDLE", frame / 30);
      return drawList(sk).find((d) => d.slot === "Eyes")!.verts;
    };
    const diff = (frame: number) => {
      const x = eyes(a, frame),
        y = eyes(b, frame);
      return Math.max(...x.map((v, i) => Math.abs(v - y[i]!)));
    };
    expect(diff(0)).toBeLessThan(1e-3);
    expect(diff(20)).toBeCloseTo(10 / 3, 1);
    expect(diff(40)).toBeLessThan(1e-3);
    expect(handoverNotes(built.rigging, built.animations)).toContain("網格變形 `squint`");
  });

  it("lints parts that are not meshes, unknown points and late keys", () => {
    const plan = squintPlan();
    delete plan.meshing;
    plan.motion.deforms![0]!.keys.IDLE!.push({ frame: 999, move: { nose: [1, 1] } });
    const errors = lintCharacterPlan(plan).errors.join("\n");
    expect(errors).toMatch(/Eyes is not a mesh/);
    expect(errors).toMatch(/unknown point nose/);
    expect(errors).toMatch(/past the end/);
    plan.motion.deforms![0]!.keys.IDLE!.pop();
    expect(() => buildCharacter(plan, fixtureLayout())).toThrow(/is a region; mesh it/);
  });
});
