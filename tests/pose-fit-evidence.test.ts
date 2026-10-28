import { describe, expect, it } from "vitest";
import {
  fitRestPose,
  loadSkeleton,
  pose,
  premultiply,
  render,
  type FitImage,
  type PoseFitOptions,
} from "@autospine/reference";

const size = 80;
const rgba = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++)
    rgba.set([50 + x * 2, 40 + y * 2, 70 + ((x * 3 + y * 7) % 100), 255], (y * size + x) * 4);
const image = (): FitImage => ({ width: size, height: size, rgba });
const view = { x: -60, y: 60, width: 120, height: 120 };
const source = (x = 0, width = size) => ({
  skeleton: { spine: "4.0.64" },
  bones: [{ name: "root" }, { name: "body", parent: "root", x }],
  slots: [{ name: "part", bone: "body", attachment: "part" }],
  skins: [{ name: "default", attachments: { part: { part: { width, height: width } } } }],
  animations: { idle: {} },
});
type Document = ReturnType<typeof source>;
const weighted = (doc: Document, influences: [number, number][] = [[1, 1]]) => {
  doc.slots[0]!.bone = "root";
  Object.assign(doc.skins[0]!.attachments.part.part, {
    type: "mesh",
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hull: 4,
    vertices: [-40, 40, 40, 40, 40, -40, -40, -40].flatMap((_, i, v) =>
      i % 2 ? [] : [influences.length, ...influences.flatMap(([b, w]) => [b, v[i]!, v[i + 1]!, w])],
    ),
  });
  return doc;
};
const picture = (doc: unknown) => {
  const sk = loadSkeleton(doc);
  pose(sk, "idle", 0);
  const canvas = render(sk, () => premultiply(size, size, rgba), {
    x0: view.x,
    y0: view.y,
    scale: 1,
    width: 120,
    height: 120,
  });
  return { width: 120, height: 120, rgba: Uint8Array.from(canvas, (v) => Math.round(v * 255)) };
};
const options: PoseFitOptions = {
  view,
  bones: ["body"],
  translate: ["body"],
  window: 15,
  maxRotate: 10,
};

describe("pose fit evidence and bounded search", () => {
  it("finds a weighted mesh's actual control without trusting its root slot", () => {
    const doc = weighted(source());
    const before = structuredClone(doc);
    const result = fitRestPose(doc, "idle", picture(source(8)), image, options);
    expect(result.pose.body?.x).toBeCloseTo(8, 0);
    expect(result.coverage).toBe(1);
    expect(result.parts[0]).toMatchObject({ bone: "body", ownership: "weights", used: true });
    expect(doc).toEqual(before);
  });

  it("fits two root-parented weighted parts moving in opposite directions independently", () => {
    const make = (shift = 0) => {
      const mesh = (bone: number) => ({
        type: "mesh",
        path: "part",
        width: size,
        height: size,
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        triangles: [0, 1, 2, 0, 2, 3],
        hull: 4,
        vertices: [-10, 10, 10, 10, 10, -10, -10, -10].flatMap((_, i, v) =>
          i % 2 ? [] : [1, bone, v[i]!, v[i + 1]!, 1],
        ),
      });
      return {
        skeleton: { spine: "4.0.64" },
        bones: [
          { name: "root" },
          { name: "left", parent: "root", x: -25 + shift },
          { name: "right", parent: "root", x: 25 - shift },
        ],
        slots: [
          { name: "left", bone: "root", attachment: "left" },
          { name: "right", bone: "root", attachment: "right" },
        ],
        skins: [
          { name: "default", attachments: { left: { left: mesh(1) }, right: { right: mesh(2) } } },
        ],
        animations: { idle: {} },
      };
    };
    const result = fitRestPose(make(), "idle", picture(make(5)), image, {
      ...options,
      bones: ["left", "right"],
      translate: ["left", "right"],
      window: 10,
      maxRotate: 10,
    });
    expect(result.pose.left?.x).toBeCloseTo(5, 0);
    expect(result.pose.right?.x).toBeCloseTo(-5, 0);
    expect(result.coverage).toBe(1);
    expect(result.residual.max).toBeLessThan(0.5);
  });

  it("resolves different mesh bones to their one shared free ancestor", () => {
    const doc = source();
    doc.bones.push({ name: "a", parent: "body", x: 0 }, { name: "b", parent: "body", x: 0 });
    weighted(doc, [
      [2, 0.4],
      [3, 0.6],
    ]);
    const result = fitRestPose(doc, "idle", picture(source(8)), image, options);
    expect(result.pose.body?.x).toBeCloseTo(8, 0);
    expect(result.parts[0]).toMatchObject({ bone: "body", ownership: "weights" });
  });

  it("reports ambiguous controls instead of claiming that the part was fitted", () => {
    const doc = source();
    doc.bones.push({ name: "other", parent: "root", x: 0 });
    weighted(doc, [
      [1, 0.5],
      [2, 0.5],
    ]);
    const result = fitRestPose(doc, "idle", picture(source()), image, {
      ...options,
      bones: ["body", "other"],
    });
    expect(result.coverage).toBe(0);
    expect(result.parts[0]).toMatchObject({ used: false, reason: "ambiguous-weighted-owner" });
    const explicit = fitRestPose(doc, "idle", picture(source()), image, {
      ...options,
      bones: ["body", "other"],
      owners: { part: "body" },
    });
    expect(explicit.parts[0]).toMatchObject({ bone: "body", ownership: "explicit", used: true });
  });

  it("ignores zero-weight influences when deciding a mesh's control", () => {
    const doc = source();
    doc.bones.push({ name: "other", parent: "root", x: 0 });
    weighted(doc, [
      [1, 1],
      [2, 0],
    ]);
    const result = fitRestPose(doc, "idle", picture(source(8)), image, {
      ...options,
      bones: ["body", "other"],
    });
    expect(result.parts[0]).toMatchObject({ bone: "body", ownership: "weights", used: true });
    expect(result.pose.body?.x).toBeCloseTo(8, 0);
  });

  it("does not count many texture samples landing on the same tiny screen patch as independent evidence", () => {
    const doc = source(0, 5);
    const result = fitRestPose(doc, "idle", picture(doc), image, options);
    expect(result.coverage).toBe(0);
    expect(result.parts).toEqual([]);
    expect(result.unobserved[0]).toMatchObject({ slot: "part", reason: "too-few-visible-samples" });
    expect(result.unobserved[0]!.visible).toBeLessThanOrEqual(36);
  });

  it("does not claim a visible part with no movable owner was fitted", () => {
    const doc = source();
    doc.slots[0]!.bone = "root";
    const result = fitRestPose(doc, "idle", picture(source()), image, options);
    expect(result.coverage).toBe(0);
    expect(result.parts[0]).toMatchObject({ used: false, reason: "no-free-owner" });
  });

  it("can translate with rotation fixed at zero", () => {
    const result = fitRestPose(source(), "idle", picture(source(8)), image, {
      ...options,
      maxRotate: 0,
    });
    expect(result.pose.body?.x).toBeCloseTo(8, 0);
    expect(result.placements.body!.r).toBe(0);
  });

  it("keeps every refinement inside a zero or narrow search window", () => {
    for (const window of [0, 2]) {
      const result = fitRestPose(source(), "idle", picture(source(8)), image, {
        ...options,
        window,
        maxRotate: 0,
      });
      expect(Math.abs(result.placements.body!.t[0])).toBeLessThanOrEqual(window);
      expect(Math.abs(result.placements.body!.t[1])).toBeLessThanOrEqual(window);
    }
  });

  it("evaluates a locked neighbouring-frame prediction once and stays deterministic", () => {
    const fit = () =>
      fitRestPose(source(), "idle", picture(source(8)), image, {
        ...options,
        maxRotate: 0,
        predict: { body: { r: 0, t: [8, 0] } },
        track: { move: 0, turn: 0 },
      });
    const result = fit();
    expect(result.placements.body).toEqual({ r: 0, t: [8, 0] });
    expect(result.lost).toEqual([]);
    expect(fit()).toEqual(result);
  });

  it.each([{ window: -1 }, { maxRotate: Number.NaN }, { track: { move: -1 } }])(
    "refuses invalid search spans %j",
    (invalid) => {
      expect(() =>
        fitRestPose(source(), "idle", picture(source()), image, { ...options, ...invalid }),
      ).toThrow("POSE_OPTIONS");
    },
  );
});
