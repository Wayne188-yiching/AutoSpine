import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bezierPoints,
  bezierValue,
  comparePlayback,
  fitChannel,
  loadSkeleton,
  pose,
  readTimelines,
  reduceSpineKeys,
  timelineValue,
  type KeyReductionOptions,
} from "@autospine/reference";
import { buildCharacterFiles } from "@autospine/cli/character";
import { reduceKeysFiles } from "@autospine/cli/keys";
import { AutoSpineMcpServer } from "@autospine/mcp";
import { fixturePlan, fixtureWorkspace } from "./character-fixture.js";

/**
 * Key reduction (ADR-044) on a synthetic Spine 4.0 skeleton that has what the mummy cat file does
 * not: IK, transform and path timelines, events, draw order, multi-turn and ±180° rotation, a
 * three-bone tail that lags its hip, sub-frame keys and an IK bend switch.
 */
const FPS = 30;
type Raw = Record<string, unknown>;
const r4 = (v: number) => +v.toFixed(4);
const bake = (frames: number, fn: (t: number, f: number) => Raw, from = 0) =>
  Array.from({ length: frames - from + 1 }, (_, i) => {
    const f = from + i;
    return { ...(f ? { time: r4(f / FPS) } : {}), ...fn(f / FPS, f) };
  });
const sin = (t: number, period: number, lag = 0) => Math.sin((2 * Math.PI * (t - lag)) / period);
const box = { width: 30, height: 30 };
const BONES = [
  "root",
  "hip",
  "leg",
  "torso",
  "head",
  "tail1",
  "tail2",
  "tail3",
  "arm",
  "fore",
  "target",
  "ring",
  "pathbone",
];
const bi = (b: string) => BONES.indexOf(b);

function skeleton(animations: Raw): Raw {
  return {
    skeleton: { spine: "4.0.64", height: 400, fps: FPS },
    bones: [
      { name: "root" },
      { name: "hip", parent: "root", y: 100 },
      { name: "leg", parent: "hip", rotation: -90, length: 80 },
      { name: "torso", parent: "hip", rotation: 90, length: 100 },
      { name: "head", parent: "torso", x: 100, length: 40 },
      { name: "tail1", parent: "hip", rotation: 180, length: 40 },
      { name: "tail2", parent: "tail1", x: 40, length: 40 },
      { name: "tail3", parent: "tail2", x: 40, length: 40 },
      { name: "arm", parent: "torso", x: 80, rotation: -90, length: 50 },
      { name: "fore", parent: "arm", x: 50, length: 50 },
      { name: "target", parent: "root", x: 60, y: 140 },
      { name: "ring", parent: "root", x: -150, y: 50, length: 30 },
      { name: "pathbone", parent: "root" },
    ],
    slots: [
      { name: "body", bone: "hip", attachment: "body" },
      { name: "leg", bone: "leg", attachment: "leg" },
      { name: "tail1", bone: "tail1", attachment: "tail1" },
      { name: "tail2", bone: "tail2", attachment: "tail2" },
      { name: "tail3", bone: "tail3", attachment: "tail3" },
      { name: "arm", bone: "arm", attachment: "arm" },
      { name: "fore", bone: "fore", attachment: "fore" },
      { name: "head", bone: "head", attachment: "face" },
      { name: "eye", bone: "head", attachment: "open" },
      { name: "ring", bone: "ring", attachment: "ring" },
      { name: "path", bone: "root", attachment: "path" },
      { name: "pathbox", bone: "pathbone", attachment: "pathbox" },
    ],
    ik: [{ name: "armIK", bones: ["arm", "fore"], target: "target" }],
    transform: [
      {
        name: "tc",
        bones: ["ring"],
        target: "head",
        mixRotate: 0,
        mixX: 0,
        mixScaleX: 0,
        mixShearY: 0,
      },
    ],
    path: [
      {
        name: "pc",
        bones: ["pathbone"],
        target: "path",
        positionMode: "percent",
        spacingMode: "length",
        rotateMode: "tangent",
      },
    ],
    skins: [
      {
        name: "default",
        attachments: {
          body: {
            body: {
              type: "mesh",
              uvs: [0, 1, 1, 1, 1, 0, 0, 0],
              triangles: [0, 1, 2, 2, 3, 0],
              hull: 4,
              // Weighted to hip and torso: [bones, (bone, x, y, weight)…] per vertex.
              vertices: [
                2,
                bi("hip"),
                -40,
                -20,
                0.8,
                bi("torso"),
                -20,
                40,
                0.2,
                2,
                bi("hip"),
                40,
                -20,
                0.8,
                bi("torso"),
                -20,
                -40,
                0.2,
                2,
                bi("hip"),
                40,
                60,
                0.3,
                bi("torso"),
                60,
                -40,
                0.7,
                2,
                bi("hip"),
                -40,
                60,
                0.3,
                bi("torso"),
                60,
                40,
                0.7,
              ],
              width: 80,
              height: 80,
            },
          },
          leg: { leg: box },
          tail1: { tail1: box },
          tail2: { tail2: box },
          tail3: { tail3: box },
          arm: { arm: box },
          fore: { fore: box },
          head: {
            face: {
              type: "mesh",
              uvs: [0, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.5],
              triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
              hull: 4,
              vertices: [-20, -20, 20, -20, 20, 20, -20, 20, 0, 0],
              width: 40,
              height: 40,
            },
          },
          eye: { open: { width: 10, height: 6 }, closed: { width: 10, height: 2 } },
          ring: { ring: box },
          path: {
            path: {
              type: "path",
              lengths: [260],
              vertexCount: 6,
              vertices: [-150, -100, -100, -100, -50, -60, 50, 60, 100, 100, 150, 100],
            },
          },
          pathbox: { pathbox: { width: 12, height: 12 } },
        },
      },
    ],
    events: { hit: {} },
    animations,
  };
}

/** A walk-like loop baked on every frame: hip sway and bounce, torso late by 2 frames, tail by 3 a bone. */
const swing = () => ({
  bones: {
    hip: {
      rotate: bake(60, (t) => ({ value: r4(10 * sin(t, 2)) })),
      translate: bake(60, (t) => ({ x: 0, y: r4(6 * sin(t, 1)) })),
    },
    torso: { rotate: bake(60, (t) => ({ value: r4(8 * sin(t, 2, 2 / FPS)) })) },
    head: { rotate: bake(60, (t) => ({ value: r4(5 * sin(t, 2, 4 / FPS)) })) },
    tail1: { rotate: bake(60, (t) => ({ value: r4(15 * sin(t, 2, 3 / FPS)) })) },
    tail2: { rotate: bake(60, (t) => ({ value: r4(15 * sin(t, 2, 6 / FPS)) })) },
    tail3: { rotate: bake(60, (t) => ({ value: r4(15 * sin(t, 2, 9 / FPS)) })) },
    leg: { scale: bake(60, () => ({ x: 1, y: 1 })) },
  },
});
/** Two full turns (eased) and a rotation across 180° (170 → 190, never through 0). */
const spin = () => ({
  bones: {
    ring: {
      rotate: bake(40, (t) => ({
        value: r4(720 * (0.5 - 0.5 * Math.cos((Math.PI * t * FPS) / 40))),
      })),
    },
    leg: {
      rotate: bake(40, (t) => ({
        value: r4(170 + 20 * (0.5 - 0.5 * Math.cos((Math.PI * t * FPS) / 40))),
      })),
    },
  },
});
/** Steps, holds, swaps, draw order, an event, IK with a bend switch, transform, path and colour keys. */
const steps = () => ({
  bones: {
    // A hold keyed on every frame, then a stepped jump at frame 10.
    hip: {
      translate: [
        ...bake(9, () => ({ x: 0, y: 0, curve: "stepped" })),
        ...bake(30, (t) => ({ x: r4(30 + 10 * sin(t, 2)), y: 0 }), 10),
      ],
    },
    leg: { shear: bake(30, () => ({ x: 0, y: 0 })) },
    target: { translate: bake(30, (t) => ({ x: r4(-30 * sin(t, 1)), y: r4(10 * sin(t, 1)) })) },
  },
  slots: {
    eye: {
      attachment: [
        { time: r4(8 / FPS), name: "closed" },
        { time: r4(12 / FPS), name: "open" },
      ],
    },
    tail1: {
      rgba: bake(30, (t) => ({
        color: `ffffff${Math.round(255 * (1 - t))
          .toString(16)
          .padStart(2, "0")}`,
      })),
    },
  },
  ik: {
    armIK: bake(30, (t, f) => ({
      mix: r4(1 - 0.7 * t),
      ...(f >= 20 ? { bendPositive: false } : {}),
    })),
  },
  transform: { tc: bake(30, (t) => ({ mixRotate: r4(t), mixX: 0, mixScaleX: 0, mixShearY: 0 })) },
  path: { pc: { position: bake(30, (t) => ({ value: r4(t) })) } },
  drawOrder: [{ time: r4(15 / FPS), offsets: [{ slot: "eye", offset: -8 }] }],
  events: [{ time: r4(12 / FPS), name: "hit" }],
});
/** Mesh deform: weighted body (leading zeros left out) and a face with a fast fold-back at frame 10. */
const deform = () => {
  const face = (t: number) => {
    const f = t * FPS;
    const a = f <= 10 ? f / 10 : f <= 13 ? 1 - (f - 10) / 3 : 0.1 * sin(t, 1);
    return [-6 * a, 4 * a, 6 * a, 4 * a, 0, 0, 0, 0, 0, 8 * a].map(r4);
  };
  return {
    deform: {
      default: {
        body: {
          body: bake(30, (t) => ({
            offset: 8,
            vertices: [3, 5, -3, 5, 4, -2, -4, -2].map((v) => r4(v * sin(t, 1))),
          })),
        },
        head: { face: bake(30, (t) => ({ vertices: face(t) })) },
      },
    },
  };
};

const doc = () => skeleton({ swing: swing(), spin: spin(), steps: steps(), deform: deform() });
const run = (d: Raw, o: Partial<KeyReductionOptions> = {}) =>
  reduceSpineKeys(d, { mode: "fidelity", ...o });

describe("key reduction (ADR-044)", () => {
  it("evaluates curves as the Spine 4.0 runtime plays them", () => {
    const d = skeleton({
      a: {
        bones: {
          hip: {
            rotate: [
              { value: 0, curve: [0.1, 40, 0.15, -10] },
              { time: 0.5, value: 20, curve: "stepped" },
              { time: 0.8, value: -5 },
              { time: 1 },
            ],
          },
        },
      },
    });
    const sk = loadSkeleton(d);
    const tl = readTimelines(d, "a").curves[0]!;
    for (let t = 0; t <= 1; t += 0.01) {
      // spine-core keeps key times as float32: right at a key it may read either side (ADR-010).
      if (tl.times.some((k) => Math.abs(k - t) < 1e-3)) continue;
      pose(sk, "a", t);
      const runtime = (sk.skeleton.findBone("hip") as unknown as { rotation: number }).rotation;
      expect(timelineValue(tl.times, tl.values, tl.curves, false, t)[0]!).toBeCloseTo(runtime, 3);
    }
    // The flattened curve differs from the exact Bezier; the fit is judged on the flattened one.
    const p = bezierPoints(0, 0, 0.3, 1, 0.7, 0, 1, 1);
    expect(bezierValue(p, 0, 0, 1, 1, 0.5)).toBeCloseTo(0.5, 6);
    const fit = fitChannel([0.25, 0.5, 0.75], [0.1, 0.5, 0.9], 0, 0, 1, 1, 0.001);
    expect(fit.error).toBeLessThan(0.01);
    if (fit.curve !== "linear") expect(fit.curve[0]).toBeLessThanOrEqual(fit.curve[2]);
  });

  it("fidelity: a per-frame loop becomes few original keys with refitted Beziers, within the limit", () => {
    const d = doc();
    const { document, report } = run(d, { animations: ["swing"] });
    const a = report.animations[0]!;
    expect(a.pass).toBe(true);
    expect(a.keys.after).toBeLessThan(a.keys.before * 0.3);
    expect(a.world.max).toBeLessThanOrEqual(report.limits.maxError);
    expect(a.world.rms).toBeLessThanOrEqual(report.limits.rmsError);
    // The constant scale keeps one key (mixing still holds it); the loop still closes.
    expect(a.timelines.find((t) => t.id === "bone:leg/scale")).toMatchObject({
      status: "constant",
      after: 1,
    });
    expect(a.duration.after).toBe(a.duration.before);
    // Independent replay on the runtime.
    expect(comparePlayback(d, document, { animations: ["swing"] })[0]!.max).toBeLessThanOrEqual(
      report.limits.maxError,
    );
    // Keys are a subset of the original times; Bezier time handles stay inside and in order.
    const before = readTimelines(d, "swing").curves.find((c) => c.id === "bone:hip/rotate")!;
    const after = readTimelines(document, "swing").curves.find((c) => c.id === "bone:hip/rotate")!;
    for (const t of after.times) expect(before.times).toContain(t);
    after.curves.forEach((seg, i) =>
      seg.forEach((c) => {
        if (c === "linear" || c === "stepped") return;
        expect(c[0]).toBeGreaterThanOrEqual(after.times[i]! - 1e-4);
        expect(c[2]).toBeLessThanOrEqual(after.times[i + 1]! + 1e-4);
        expect(c[0]).toBeLessThanOrEqual(c[2] + 1e-9);
      }),
    );
    // Peaks keep their keys (the sway's extremes at frames 15 and 45).
    expect(after.times.map((t) => Math.round(t * FPS))).toEqual(expect.arrayContaining([15, 45]));
    // The seam pose and speed stay as they were.
    expect(a.loop).toBe(true);
    expect(a.seam!.poseReduced).toBeLessThanOrEqual(report.limits.maxError);
    expect(Math.abs(a.seam!.velocityJumpReduced - a.seam!.velocityJumpOriginal)).toBeLessThan(
      report.limits.maxError,
    );
  });

  it("keeps multi-turn rotation and rotation across 180° on their original path", () => {
    const d = doc();
    const { document, report } = run(d, { animations: ["spin"] });
    const a = report.animations[0]!;
    expect(a.pass).toBe(true);
    expect(a.keys.after).toBeLessThan(a.keys.before / 3);
    const ring = readTimelines(document, "spin").curves.find((c) => c.id === "bone:ring/rotate")!;
    const v = ring.values.map((x) => x[0]!);
    expect(v[0]).toBe(0);
    expect(v.at(-1)).toBe(720);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]!);
    const leg = readTimelines(document, "spin").curves.find((c) => c.id === "bone:leg/rotate")!;
    for (const [x] of leg.values) expect(x!).toBeGreaterThanOrEqual(170 - 1e-6);
    // Played between keys: never off by more than the limit (no reverse turn, no overshoot past it).
    expect(comparePlayback(d, document, { animations: ["spin"] })[0]!.max).toBeLessThanOrEqual(
      report.limits.maxError,
    );
  });

  it("posable: follow parts keep their lag; new keys sit on whole frames; sub-frame turns keep their time", () => {
    const d = doc();
    // A sparse timeline with a sub-frame turn at frame 15.5.
    (d.animations as Raw).swing = {
      ...swing(),
      bones: {
        ...swing().bones,
        arm: {
          rotate: [
            { value: 0, curve: [0.2, 0, 0.4, 30] },
            { time: 0.5167, value: 30, curve: [0.7, 30, 0.9, 0] },
            { time: 1.2, value: 0 },
            { time: 2, value: 0 },
          ],
        },
      },
    };
    const { document, report } = run(d, { mode: "posable", animations: ["swing"] });
    const a = report.animations[0]!;
    expect(a.pass).toBe(true);
    const follow = a.follow.filter((f) => f.bone.startsWith("tail"));
    expect(follow.length).toBeGreaterThan(0);
    for (const f of follow) {
      expect(f.lagOriginal).toBeGreaterThan(1);
      expect(Math.abs(f.lagReduced - f.lagOriginal)).toBeLessThanOrEqual(0.25);
      expect(f.maxShift).not.toBeNull();
      expect(f.maxShift!).toBeLessThanOrEqual(0.5);
    }
    // The tail is not pulled onto the hip's frames.
    const frames = (id: string) =>
      readTimelines(document, "swing")
        .curves.find((c) => c.id === id)!
        .times.map((t) => Math.round(t * FPS));
    expect(frames("bone:tail3/rotate")).not.toEqual(frames("bone:hip/rotate"));
    // New keys on whole frames; the original sub-frame turn kept at 0.5167.
    const orig = new Set(readTimelines(d, "swing").curves.flatMap((c) => c.times));
    for (const c of readTimelines(document, "swing").curves)
      for (const t of c.times)
        if (!orig.has(t)) expect(Math.abs(t * FPS - Math.round(t * FPS))).toBeLessThan(0.01);
    expect(
      readTimelines(document, "swing").curves.find((c) => c.id === "bone:arm/rotate")!.times,
    ).toContain(0.5167);
    expect(report.mode).toBe("posable");
    expect(report.limits.maxError).toBeGreaterThan(
      run(d, { animations: ["swing"] }).report.limits.maxError,
    );
  });

  it("deform: sparse shapes first, keys added only where an interval is off; offsets and weights handled", () => {
    const d = doc();
    const { document, report } = run(d, { animations: ["deform"] });
    const a = report.animations[0]!;
    expect(a.pass).toBe(true);
    expect(a.keys.byKind.deform!.after).toBeLessThan(a.keys.byKind.deform!.before / 2);
    const anim = (document.animations as Raw).deform as {
      deform: { default: Record<string, Record<string, Raw[]>> };
    };
    // Leading zeros of the weighted body stay out (offset), a setup shape has no vertices.
    for (const k of anim.deform.default.body!.body!)
      if (k.vertices) expect(k.offset).toBeGreaterThanOrEqual(8);
    // The fast fold-back at frame 10 keeps a key within a frame of it.
    const face = readTimelines(document, "deform").curves.find((c) => c.prop === "face")!;
    expect(face.times.some((t) => Math.abs(t * FPS - 10) <= 1)).toBe(true);
    expect(comparePlayback(d, document, { animations: ["deform"] })[0]!.max).toBeLessThanOrEqual(
      report.limits.maxError,
    );
  });

  it("protects steps, swaps, draw order, events, an IK bend switch and constant channels", () => {
    const d = doc();
    const { document, report } = run(d, { animations: ["steps"] });
    const a = report.animations[0]!;
    expect(a.pass).toBe(true);
    expect(a.discrete).toMatchObject({ stateMismatches: 0, orderMismatches: 0 });
    const before = (d.animations as Raw).steps as Raw,
      after = (document.animations as Raw).steps as Raw;
    expect(after.drawOrder).toEqual(before.drawOrder);
    expect(after.events).toEqual(before.events);
    expect((after.slots as Raw).eye).toEqual((before.slots as Raw).eye);
    // The hold collapses to its ends; the jump stays stepped on both of its keys.
    const hip = (after.bones as Record<string, Record<string, Raw[]>>).hip!.translate!;
    const jump = hip.findIndex((k) => k.time === r4(10 / FPS));
    expect(jump).toBeGreaterThan(0);
    expect(hip[jump - 1]!.curve).toBe("stepped");
    expect(hip[jump - 1]!.time).toBe(r4(9 / FPS));
    expect(hip.length).toBeLessThan(10);
    // The IK bend switch keeps its key and its value.
    const ik = (after.ik as Record<string, Raw[]>).armIK!;
    const sw = ik.find((k) => k.time === r4(20 / FPS));
    expect(sw?.bendPositive).toBe(false);
    expect(ik.filter((k) => k.bendPositive === false)[0]).toBe(sw);
    // Constant shear: one key. Constraint, path and colour keys reduced.
    expect(a.timelines.find((t) => t.id === "bone:leg/shear")).toMatchObject({
      status: "constant",
      after: 1,
    });
    for (const id of ["ik:armIK", "transform:tc", "path:pc/position", "slot:tail1/rgba"]) {
      const t = a.timelines.find((x) => x.id === id)!;
      expect(t.after, id).toBeLessThan(t.before);
    }
    expect(a.duration.after).toBe(a.duration.before);
    expect(comparePlayback(d, document, { animations: ["steps"] })[0]!.max).toBeLessThanOrEqual(
      report.limits.maxError,
    );
  });

  it("falls back to the original keys past the budget, never widening the limit; locks hold", () => {
    const d = doc();
    const strict = run(d, {
      animations: ["swing"],
      maxError: 0.01,
      rmsError: 0.005,
      localShare: 1,
      maxInsertions: 0,
    });
    const a = strict.report.animations[0]!;
    expect(strict.report.limits).toMatchObject({ maxError: 0.01, rmsError: 0.005 });
    expect(a.fallbacks.length).toBeGreaterThan(0);
    expect(a.pass).toBe(true);
    expect(a.world.max).toBeLessThanOrEqual(0.01);
    const restored = a.timelines.filter((t) => t.status === "restored");
    expect(restored.length).toBeGreaterThan(0);
    for (const t of restored) expect(t.after).toBe(t.before);
    // A locked timeline is left exactly as it was.
    const locked = run(d, { animations: ["swing"], lock: [{ timeline: "bone:tail2/rotate" }] });
    expect(
      locked.report.animations[0]!.timelines.find((t) => t.id === "bone:tail2/rotate"),
    ).toMatchObject({ status: "locked" });
    const bones = (x: Raw) => ((x.animations as Raw).swing as { bones: Record<string, Raw> }).bones;
    expect(bones(locked.document).tail2).toEqual(bones(d).tail2);
    // A locked key time is kept.
    const one = run(d, {
      animations: ["swing"],
      lock: [{ timeline: "bone:hip/rotate", time: r4(7 / FPS) }],
    });
    expect(
      readTimelines(one.document, "swing").curves.find((c) => c.id === "bone:hip/rotate")!.times,
    ).toContain(r4(7 / FPS));
  });

  it("is deterministic, and re-running with the baseline gives the same result (no compounding)", () => {
    const d = doc();
    const first = run(d);
    expect(JSON.stringify(run(d).document)).toBe(JSON.stringify(first.document));
    const again = run(first.document, { baseline: d });
    expect(again.report.sources.every((s) => s.from === "baseline")).toBe(true);
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(first.document));
    // An animation edited past the limit after the reduction is reduced as it is now.
    const edited = structuredClone(first.document);
    const hip = (
      ((edited.animations as Raw).swing as Raw).bones as Record<string, Record<string, Raw[]>>
    ).hip!.translate!;
    for (const k of hip) k.x = ((k.x as number) ?? 0) + 20;
    const third = run(edited, { baseline: d, animations: ["swing"] });
    expect(third.report.sources[0]).toMatchObject({ animation: "swing", from: "input" });
  });

  it("CLI and MCP share one file step; the source is not written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autospine-keys-"));
    const input = join(dir, "synthetic.json");
    await writeFile(input, JSON.stringify(doc()));
    const sha = createHash("sha256")
      .update(await readFile(input))
      .digest("hex");
    const summary = await reduceKeysFiles(input, join(dir, "cli"), { spine: false, video: false });
    expect(summary.sha256).toBe(sha);
    expect(summary.runs.map((r) => [r.mode, r.pass])).toEqual([
      ["fidelity", true],
      ["posable", true],
    ]);
    expect((await readdir(join(dir, "cli"))).sort()).toEqual(
      [
        "fidelity",
        "key-reduction-report.html",
        "key-reduction-report.md",
        "posable",
        "source",
        "summary.json",
      ].sort(),
    );
    expect(await readFile(join(dir, "cli", "key-reduction-report.html"), "utf8")).toContain(
      "保真精簡",
    );
    expect(summary.notes.join()).toContain("未做正式匯入");
    expect(
      createHash("sha256")
        .update(await readFile(input))
        .digest("hex"),
    ).toBe(sha);
    await expect(
      reduceKeysFiles(input, join(dir, "cli"), { spine: false, video: false }),
    ).rejects.toThrow("CLI_OUTPUT_EXISTS");

    const server = new AutoSpineMcpServer(dir);
    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    const call = (args: unknown) =>
      server.receive({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "autospine_reduce_keys", arguments: args },
      }) as Promise<{
        result: { isError?: boolean; structuredContent: Raw };
      }>;
    const ok = await call({
      inputPath: "synthetic.json",
      outputDir: "mcp",
      modes: ["fidelity"],
      limits: { fidelity: { maxError: 0.3 } },
    });
    expect(ok.result.isError).toBeUndefined();
    const runs = ok.result.structuredContent.runs as {
      mode: string;
      pass: boolean;
      limits: { maxError: number };
    }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ mode: "fidelity", pass: true, limits: { maxError: 0.3 } });
    // Same engine, same numbers as the CLI step with the same options.
    const cli = await reduceKeysFiles(input, join(dir, "cli2"), {
      spine: false,
      video: false,
      modes: ["fidelity"],
      limits: { fidelity: { maxError: 0.3 } },
    });
    expect(runs[0]).toMatchObject({ keys: cli.runs[0]!.keys });
    const outside = await call({ inputPath: "../x.json", outputDir: "mcp2" });
    expect(outside.result.isError).toBe(true);
  }, 120_000);

  it("plans with motion.keyReduction build reduced files against the exact compiled motion", async () => {
    const ws = await fixtureWorkspace();
    const plan = fixturePlan();
    plan.motion.keyReduction = { mode: "fidelity" };
    await writeFile(join(ws, "plan-keys.json"), JSON.stringify(plan));
    const built = await buildCharacterFiles(join(ws, "plan-keys.json"), join(ws, "build-keys"));
    expect(built.keyReduction).toMatchObject({ mode: "fidelity", pass: true });
    expect(built.keyReduction!.keys.after).toBeLessThan(built.keyReduction!.keys.before);
    const report = JSON.parse(
      await readFile(join(ws, "build-keys", "key-reduction.json"), "utf8"),
    ) as { pass: boolean };
    expect(report.pass).toBe(true);
  }, 120_000);
});
