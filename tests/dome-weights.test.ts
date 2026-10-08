import { describe, expect, it } from "vitest";
import type { AssetPart } from "@autospine/schemas";
import { rigFromWorldFrames } from "@autospine/rig";
import { generateSurfaceMesh } from "@autospine/mesh";
import {
  domeFoldLimit,
  domeValue,
  measureDeformation,
  measureDomeField,
  skinVertices,
  solveDomeWeights,
  type DomeField,
} from "@autospine/weights";

const rig = rigFromWorldFrames("dome", "Dome", [
  { id: "head", name: "head", length: 50, world: [1, 0, 0, 1, 0, 0] },
  { id: "ctrl", name: "ctrl", parentId: "head", length: 0, world: [1, 0, 0, 1, 10, -20] },
  { id: "back", name: "back", parentId: "head", length: 0, world: [1, 0, 0, 1, 10, -20] },
]);
const field: DomeField = { center: [10, -20], radii: [100, 60], peak: 0.7, counter: 0.1 };
const bones = { base: "head", control: "ctrl", counter: "back" };
const grid = (id: string, x: number, y: number, width: number, height: number) =>
  generateSurfaceMesh(
    {
      id,
      name: id,
      sourcePath: id + ".png",
      bounds: { x, y, width, height },
      drawOrder: 0,
    } as AssetPart,
    width / 10,
    height / 10,
  );
const face = grid("face", -100, -90, 220, 140); // 10 px lattice through the dome centre
const at = (mesh: typeof face, x: number, y: number) =>
  mesh.vertices.findIndex((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9);
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("dome (parallax) weights", () => {
  it("measures centre and radii from alpha moments, with an optional feature anchor", () => {
    const width = 200,
      height = 120,
      alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (((x + 0.5 - 100) / 80) ** 2 + ((y + 0.5 - 60) / 40) ** 2 <= 1)
          alpha[y * width + x] = 255;
    const upright = measureDomeField(alpha, width, height, [1, 0, 0, 1, -95, -53]);
    expect(upright.center[0]).toBeCloseTo(5, 6);
    expect(upright.center[1]).toBeCloseTo(7, 6);
    expect(upright.radii[0]).toBeCloseTo(80, 0);
    expect(upright.radii[1]).toBeCloseTo(40, 0);
    expect([upright.peak, upright.counter]).toEqual([0.7, 0.1]);
    const turned = measureDomeField(alpha, width, height, [0, 1, -1, 0, 0, 0], {
      anchor: [3, 4],
      peak: 0.6,
    });
    expect(turned.center).toEqual([3, 4]);
    expect(turned.radii[0]).toBeCloseTo(40, 0); // placement rotated 90 degrees swaps the axes
    expect(turned.radii[1]).toBeCloseTo(80, 0);
  });

  it("puts the peak on the control bone, fades it by (1 - r^2) and hands the rim to the counter", () => {
    const weights = solveDomeWeights(face, rig, field, bones);
    const of = (x: number, y: number) =>
      Object.fromEntries(
        weights.vertices[at(face, x, y)]!.influences.map((i) => [i.boneId, i.weight]),
      );
    expect(of(10, -20)).toEqual({ ctrl: expect.closeTo(0.7, 12), head: expect.closeTo(0.3, 12) });
    expect(of(60, -20)).toEqual({
      ctrl: expect.closeTo(0.525, 12),
      head: expect.closeTo(0.475, 12),
    });
    expect(of(120, 50)).toEqual({ back: expect.closeTo(0.1, 12), head: expect.closeTo(0.9, 12) });
    expect(weights.vertices.every((v) => v.influences.length <= 3)).toBe(true);
  });

  it("skins each vertex by exactly its dome value, so stacked layers stay aligned", () => {
    const eyes = grid("eyes", -40, -50, 100, 60);
    const fw = solveDomeWeights(face, rig, field, bones),
      ew = solveDomeWeights(eyes, rig, field, bones);
    const d = 30,
      move = {
        translations: { ctrl: [d, 0] as [number, number], back: [-0.3 * d, 0] as [number, number] },
      };
    const posedFace = skinVertices(face, rig, fw, {}, move),
      posedEyes = skinVertices(eyes, rig, ew, {}, move);
    face.vertices.forEach((p, i) => {
      const r = Math.hypot((p[0] - 10) / 100, (p[1] + 20) / 60),
        t = Math.min(1, Math.max(0, (r - 0.55) / 0.55)),
        counter = 0.1 * t * t * (3 - 2 * t);
      expect(posedFace[i]![0] - p[0]).toBeCloseTo(d * domeValue(field, p) - 0.3 * d * counter, 9);
      expect(posedFace[i]![1]).toBeCloseTo(p[1], 9);
    });
    let shared = 0;
    eyes.vertices.forEach((p, i) => {
      const j = at(face, p[0], p[1]);
      if (j < 0) return;
      shared++;
      expect(posedEyes[i]![0]).toBeCloseTo(posedFace[j]![0], 12);
    });
    expect(shared).toBeGreaterThan(40);
    // A rigid feature following the control with its dome value lands on the surface.
    const eye: [number, number] = [-30, -10];
    expect(posedFace[at(face, -30, -10)]![0] - eye[0]).toBeCloseTo(d * domeValue(field, eye), 9);
  });

  it("stays fold-free inside the analytic fold limit and folds beyond it", () => {
    const weights = solveDomeWeights(
      face,
      rig,
      { ...field, counter: 0 },
      { base: "head", control: "ctrl" },
    );
    const [limit] = domeFoldLimit(field);
    expect(limit).toBeCloseTo(100 / 1.4, 12);
    const fold = (scale: number) =>
      measureDeformation(
        face,
        skinVertices(face, rig, weights, {}, { translations: { ctrl: [limit * scale, 0] } }),
      ).inversionCount;
    expect(fold(0.9)).toBe(0);
    expect(fold(1.3)).toBeGreaterThan(0);
  });

  it("pins a socket region to the follow mix of the feature behind it", () => {
    const socket: [number, number][] = [
      [-40, -20],
      [-20, -20],
      [-20, 0],
      [-40, 0],
    ];
    const pins = [{ polygon: socket, value: 0.4, margin: 10 }];
    const pinned = solveDomeWeights(face, rig, field, bones, pins),
      plain = solveDomeWeights(face, rig, field, bones);
    const control = (w: typeof plain, x: number, y: number) =>
      w.vertices[at(face, x, y)]!.influences.find((i) => i.boneId === "ctrl")?.weight ?? 0;
    expect(control(pinned, -30, -10)).toBeCloseTo(0.4, 12); // inside: exactly the feature's mix
    expect(control(pinned, 60, -20)).toBeCloseTo(control(plain, 60, -20), 12); // beyond the margin
    const between = control(pinned, -10, -10); // 10 px outside: at the end of the margin
    expect(between).toBeCloseTo(control(plain, -10, -10), 12);
    const near = control(pinned, -20, 0); // on the rim
    expect(near).toBeCloseTo(0.4, 12);
    expect(domeValue(field, [-30, -10], pins)).toBeCloseTo(0.4, 12);
    // A rigid feature following the control at 0.4 stays glued to the pinned surface.
    const d = 25,
      posed = skinVertices(
        face,
        rig,
        pinned,
        {},
        { translations: { ctrl: [d, 0], back: [-0.3 * d, 0] } },
      );
    for (const [x, y] of [
      [-30, -10],
      [-40, -20],
      [-20, 0],
    ] as const)
      expect(posed[at(face, x, y)]![0] - x).toBeCloseTo(0.4 * d, 9);
    for (const bad of [
      { polygon: socket, value: 1.5, margin: 10 },
      { polygon: socket, value: 0.4, margin: 0 },
      { polygon: socket.slice(0, 2), value: 0.4, margin: 10 },
    ])
      expect(code(() => solveDomeWeights(face, rig, field, bones, [bad]))).toBe("DOME_PIN");
  });

  it("rejects invalid fields, bones and images with stage codes", () => {
    const alpha = new Uint8Array(4);
    const cases: [() => unknown, string][] = [
      [() => solveDomeWeights(face, rig, { ...field, counter: 0.4 }, bones), "DOME_FIELD"],
      [() => solveDomeWeights(face, rig, { ...field, radii: [0, 60] }, bones), "DOME_FIELD"],
      [() => solveDomeWeights(face, rig, field, { base: "head", control: "ctrl" }), "DOME_BONES"],
      [() => solveDomeWeights(face, rig, field, { ...bones, control: "head" }), "DOME_BONES"],
      [() => solveDomeWeights(face, rig, field, { ...bones, counter: "nope" }), "DOME_BONES"],
      [() => measureDomeField(alpha, 3, 2, [1, 0, 0, 1, 0, 0]), "DOME_INPUT"],
      [() => measureDomeField(alpha, 2, 2, [1, 0, 0, 1, 0, 0]), "DOME_INPUT"],
      [() => domeValue({ ...field, peak: 1.2 }, [0, 0]), "DOME_FIELD"],
    ];
    for (const [run, expected] of cases) expect(code(run)).toBe(expected);
  });
});
