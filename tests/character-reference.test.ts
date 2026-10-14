import { describe, expect, it } from "vitest";
import { buildCharacter, rigCharacter } from "@autospine/character";
import { readImagesOnlyLayout } from "@autospine/spine";
import {
  checkAcceptance,
  compareToReference,
  drawList,
  initialSearchState,
  loadSkeleton,
  makeObjective,
  patternSearch,
  placementDelta,
  pose,
  prepareReference,
  stripToImagesOnly,
  type SearchState,
} from "@autospine/reference";
import {
  FIXTURE_IMAGES,
  fixtureImagesOnly,
  fixtureLayout,
  fixturePlan,
} from "./character-fixture.js";

const size = (path: string): [number, number] => [
  FIXTURE_IMAGES[path]!.width,
  FIXTURE_IMAGES[path]!.height,
];

describe("reference comparison on the official Spine 4.0 runtime (ADR-017)", () => {
  const plan = fixturePlan();
  const probes = plan.qa!.probes!;
  const built = buildCharacter(plan, fixtureLayout());

  it("strips a rigged document back to images-only placements", () => {
    const strip = stripToImagesOnly(built.document, size);
    expect(strip.report.summary).toMatchObject({
      slots: 7,
      attachments: 7,
      fromMesh: 6,
      fromRegion: 1,
      over2px: [],
      quadMeshForShear: [],
    });
    expect(strip.report.summary.maxResidualPx).toBeLessThanOrEqual(0.01);
    const original = readImagesOnlyLayout(fixtureImagesOnly()).attachments;
    const stripped = readImagesOnlyLayout(strip.document).attachments;
    expect(stripped.map((a) => a.key)).toEqual(original.map((a) => a.key));
    stripped.forEach((a, i) =>
      a.affine.forEach((v, k) => expect(v).toBeCloseTo(original[i]!.affine[k]!, 2)),
    );
  });

  it("keeps sheared placements as quads whose corners the layout reader recovers", () => {
    const artist = {
      skeleton: { spine: "4.0.64" },
      bones: [
        { name: "root" },
        { name: "b", parent: "root", x: 10, y: 20, rotation: 30, scaleX: 2 },
      ],
      slots: [{ name: "S", bone: "b", attachment: "S" }],
      skins: [
        {
          name: "default",
          attachments: { S: { S: { x: 5, y: 3, rotation: 45, width: 20, height: 10 } } },
        },
      ],
    };
    const strip = stripToImagesOnly(artist, () => [20, 10]);
    expect(strip.report.summary.quadMeshForShear).toEqual(["S"]);
    expect(strip.report.summary.maxResidualPx).toBeLessThan(1e-6);
    const before = loadSkeleton(artist),
      after = loadSkeleton(strip.document);
    expect(placementDelta(before, after).S).toBeLessThanOrEqual(0.01);
    const [a] = readImagesOnlyLayout(strip.document).attachments;
    expect(a!.sheared).toBe(true);
    // Every image corner maps through the layout affine onto a runtime corner (y up -> IR y down).
    pose(before, null, 0);
    const v = drawList(before)[0]!.verts;
    const corners = [0, 1, 2, 3].map((i) => [v[2 * i]!, -v[2 * i + 1]!] as const);
    const M = a!.affine;
    for (const [u, w] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ] as const) {
      const p = [M[0] * u + M[2] * w + M[4], M[1] * u + M[3] * w + M[5]];
      expect(Math.min(...corners.map((c) => Math.hypot(c[0] - p[0]!, c[1] - p[1]!)))).toBeLessThan(
        0.01,
      );
    }
  });

  it("keeps every skin, drops non-image attachments and places missing images by stored size", () => {
    const artist = {
      skeleton: { spine: "4.0.64" },
      bones: [{ name: "root" }, { name: "b", parent: "root", x: 10, y: 20 }],
      slots: [
        { name: "S", bone: "b", attachment: "S" },
        { name: "C", bone: "b", attachment: "clip" },
      ],
      skins: [
        {
          name: "default",
          attachments: {
            S: { S: { x: 5, width: 20, height: 10 } },
            C: {
              clip: { type: "clipping", end: "S", vertexCount: 3, vertices: [0, 0, 9, 0, 0, 9] },
            },
          },
        },
        { name: "alt", attachments: { S: { gone: { x: -5, width: 8, height: 4 } } } },
      ],
    };
    const strip = stripToImagesOnly(artist, (path) => (path === "gone" ? undefined : [20, 10]));
    expect(strip.report.summary).toMatchObject({
      skins: 2,
      attachments: 2,
      droppedNonImage: ["default/C/clip:clipping"],
      missingImages: ["alt/S/gone:gone"],
    });
    const skins = (strip.document as { skins: { name: string; attachments: object }[] }).skins;
    expect(skins.map((s) => s.name)).toEqual(["default", "alt"]);
    expect(skins[1]!.attachments).toEqual({ S: { gone: { x: 5, y: 20, width: 8, height: 4 } } });
    expect(stripToImagesOnly(artist, () => undefined).report.summary.droppedNonImage).toEqual([
      "default/C/clip:clipping",
    ]);
  });

  it("passes every automatable criterion when a build is compared with itself", () => {
    const reference = prepareReference(built.document, fixtureImagesOnly(), {
      probes,
      name: plan.name,
    });
    expect(reference.profiles.IDLE!.id).toBe("Fixture_character-IDLE-artist");
    const { result } = compareToReference(reference, built.document, fixtureImagesOnly(), {
      probes,
    });
    const check = checkAcceptance(result, built.seams);
    expect(check.rows.filter((r) => !r.ok)).toEqual([]);
    expect(check.pass).toBe(true);
    expect(result.performance.IDLE!.review.within).toBe(result.performance.IDLE!.review.total);
  });

  it("correlates a slot that is hidden on frame 0 from its first visible frame", () => {
    // YoLu_03 (2026-10-14): an artist slot without an attachment on frame 0 crashed the compare.
    const artist = JSON.parse(JSON.stringify(built.document)) as {
      slots: { name: string; attachment?: string }[];
      animations: Record<string, { slots?: Record<string, object> }>;
    };
    const hair = artist.slots.find((s) => s.name === "Hair")!;
    const idle = artist.animations.IDLE!;
    idle.slots = {
      ...idle.slots,
      Hair: { attachment: [{ name: null }, { time: 0.2, name: hair.attachment }] },
    };
    const reference = prepareReference(artist, fixtureImagesOnly(), { probes });
    const { result } = compareToReference(reference, built.document, fixtureImagesOnly(), {
      probes,
    });
    const rows = (
      result.motion.IDLE as { rows: { slot: string; displacementCorrelation: number | null }[] }
    ).rows;
    expect(rows.find((r) => r.slot === "Hair")!.displacementCorrelation).toEqual(
      expect.any(Number),
    );
  });

  it("scores motion that departs from the baseline worse, and searches back towards it", () => {
    const reference = prepareReference(built.document, fixtureImagesOnly(), { probes });
    const rigging = rigCharacter(plan, fixtureLayout());
    // margin 20 cannot be met, so the search runs to its evaluation budget.
    const evaluate = makeObjective(rigging, reference, { probes, margin: 20 });
    const base = evaluate(plan.motion.params);
    expect(Math.max(...Object.values(base.trajectory))).toBeLessThan(1e-6);
    const off = { ...plan.motion.params, amp: 9, gHead: -1.5, lag: 6 };
    const worse = evaluate(off);
    expect(worse.penalty).toBeGreaterThan(base.penalty);
    expect(Math.max(...Object.values(worse.trajectory))).toBeGreaterThan(0);

    const space = plan.motion.search!;
    const a = initialSearchState(off, space, plan.motion.cycle, 7),
      b = initialSearchState(off, space, plan.motion.cycle, 7);
    expect(a.x).toEqual(b.x);
    for (const [k, r] of Object.entries(space)) {
      expect(a.x[k]).toBeGreaterThanOrEqual(r.min);
      expect(a.x[k]).toBeLessThanOrEqual(r.max);
      if (r.integer) expect(Number.isInteger(a.x[k])).toBe(true);
    }
    const state = initialSearchState(off, space, plan.motion.cycle);
    const log: number[] = [];
    patternSearch(state, space, plan.motion.cycle, evaluate, {
      deadline: Date.now() + 60_000,
      maxEvaluations: 12,
      log: (e) => log.push(e.penalty!),
    });
    expect(state.evaluations).toBe(12);
    expect(state.best!.penalty).toBeLessThan(worse.penalty);
    expect(state.best!.penalty).toBeLessThanOrEqual(Math.min(...log) + 1e-9);
    // The state is plain JSON and resumes where it stopped.
    const resumed = JSON.parse(JSON.stringify(state)) as SearchState;
    patternSearch(resumed, space, plan.motion.cycle, evaluate, {
      deadline: Date.now() + 60_000,
      maxEvaluations: 18,
    });
    expect(resumed.evaluations).toBe(18);
    expect(resumed.best!.penalty).toBeLessThanOrEqual(state.best!.penalty);
  }, 120_000);
});
