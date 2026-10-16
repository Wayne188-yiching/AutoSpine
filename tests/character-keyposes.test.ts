import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import type { CharacterPlan, KeyCurve } from "@autospine/schemas";
import {
  buildCharacter,
  handoverNotes,
  lintCharacterPlan,
  type Keyposes,
} from "@autospine/character";
import { buildCharacterFiles, fitPoseFiles } from "@autospine/cli/character";
import {
  addTracks,
  easeCurve,
  poseTrack,
  rotationsAt,
  trackValue,
  type TrackKey,
} from "@autospine/motion";
import { drawList, loadSkeleton, pose, premultiply, render } from "@autospine/reference";
import {
  ellipse,
  FIXTURE_ORDER,
  fixtureImagesOnly,
  fixtureLayout,
  fixturePlan,
  fixtureTextures,
  fixtureWorkspace,
  texturedRgba,
  type Image,
} from "./character-fixture.js";

const clone = <T>(v: T): T => structuredClone(v);
const cli = (...args: string[]) =>
  spawnSync(process.execPath, [resolve("packages/cli/dist/index.js"), ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
const VIEW = { x: -60, y: 305, width: 120, height: 310 };

/**
 * Key poses on three frames of the fixture's 80-frame IDLE. Every part stays rigid on its bone: a
 * head turn would bend the body, a mesh between the spine and the head (see ADR-033).
 */
const KNOWN: Keyposes = [
  { frame: 10, pose: { spine: { rotate: 6 }, arm_r: { rotate: -10 } } },
  { frame: 30, ease: "sine", pose: { spine: { rotate: -4 }, thigh_r: { rotate: -6 } } },
  { frame: 50, pose: { arm_r: { rotate: 12 }, thigh_l: { rotate: 5 } } },
];
/** The same with a head turn: the head also follows the body. */
const LAYERED: Keyposes = KNOWN.map((k) =>
  k.frame === 30 ? { ...k, pose: { ...k.pose, head: { rotate: 5 } } } : k,
);

/** A picture of a build's pose on one frame, as straight RGBA covering VIEW. */
function picture(
  document: unknown,
  frame: number,
  textures: ReturnType<typeof fixtureTextures>,
  scale = 3,
) {
  const sk = loadSkeleton(document);
  pose(sk, "IDLE", frame / 30);
  const canvas = render(
    sk,
    (p) => {
      const im = textures.get(p)!;
      return premultiply(im.width, im.height, im.rgba);
    },
    { x0: VIEW.x, y0: VIEW.y, scale, width: VIEW.width * scale, height: VIEW.height * scale },
  );
  const png = new PNG({ width: VIEW.width * scale, height: VIEW.height * scale });
  for (let i = 0; i < canvas.length; i += 4) {
    const a = Math.min(1, canvas[i + 3]!);
    png.data[i + 3] = Math.round(a * 255);
    for (let k = 0; k < 3; k++)
      png.data[i + k] = a > 0 ? Math.round(Math.min(1, canvas[i + k]! / a) * 255) : 0;
  }
  return png;
}
/** World vertices of every drawn part on one frame. */
function vertices(document: unknown, frame: number) {
  const sk = loadSkeleton(document);
  pose(sk, "IDLE", frame / 30);
  return new Map(drawList(sk).map((d) => [d.slot, d.verts]));
}

describe("key poses from reference pictures (ADR-033)", () => {
  it("adds tracks: exact where one holds or both share a curve, else fitted within 0.1", () => {
    const ease = easeCurve("ease")!,
      sine = easeCurve("sine")!;
    const a: TrackKey[] = [
      { frame: 0, value: [0], curve: ease },
      { frame: 10, value: [10] },
    ];
    const b: TrackKey[] = [
      { frame: 0, value: [0] },
      { frame: 5, value: [0], curve: sine },
      { frame: 10, value: [4] },
    ];
    const total = (f: number) => trackValue(a, f)[0]! + trackValue(b, f)[0]!;
    const sum = addTracks(a, b);
    // 0-5: only a moves, on its own curve cut at frame 5 (exact); 5-10: both move, one fitted curve.
    expect(sum.map((k) => k.frame)).toEqual([0, 5, 10]);
    expect(sum[0]!.curve?.type).toBe("bezier");
    for (let f = 0; f <= 10; f += 0.25) {
      const near = Math.abs(trackValue(sum, f)[0]! - total(f));
      expect(near).toBeLessThan(f <= 5 ? 1e-6 : 0.1);
    }
    // One shared curve stays one segment; a line plus a curve is that curve's shape, exactly.
    const same = addTracks(a, [
      { frame: 0, value: [2], curve: ease },
      { frame: 10, value: [-3] },
    ]);
    expect(same).toHaveLength(2);
    expect(same[0]).toMatchObject({ value: [2], curve: ease as KeyCurve });
    expect(same[1]!.value).toEqual([7]);
    const line: TrackKey[] = [
      { frame: 0, value: [0] },
      { frame: 10, value: [-6] },
    ];
    const curved = addTracks(a, line);
    expect(curved).toHaveLength(2);
    for (let f = 0; f <= 10; f += 0.5)
      expect(trackValue(curved, f)[0]).toBeCloseTo(trackValue(a, f)[0]! - 0.6 * f, 4);
    // A step no curve can follow is split down to frames: the jump takes the last frame.
    const step = addTracks(
      [
        { frame: 0, value: [0], curve: { type: "stepped" } },
        { frame: 10, value: [5] },
      ],
      line,
    );
    expect(step.map((k) => k.frame)).toEqual([0, 5, 8, 9, 10]);
    for (let f = 0; f <= 9; f++) expect(trackValue(step, f)[0]).toBeCloseTo(-0.6 * f, 6);
    expect(step.at(-1)!.value[0]).toBeCloseTo(-1, 6);
  });

  it("layers key poses over the plan's motion: follows stay, eases are kept", () => {
    const base = buildCharacter(fixturePlan(), fixtureLayout());
    const plan = clone(fixturePlan());
    plan.motion.animations[0]!.keyposes = LAYERED;
    const posed = buildCharacter(plan, fixtureLayout());
    const [b, p] = [base.animations[0]!, posed.animations[0]!];
    const at = (anim: typeof b, bone: string, f: number) => rotationsAt(anim, f / 30)[bone] ?? 0;
    // Frame 0 has no offset; each key adds its pose to what the plan does there; a loop returns.
    for (const bone of ["spine", "head", "arm_r"]) {
      expect(at(p, bone, 0)).toBeCloseTo(at(b, bone, 0), 3);
      expect(at(p, bone, 80)).toBeCloseTo(at(b, bone, 80), 3);
    }
    for (const k of LAYERED)
      for (const [bone, q] of Object.entries(k.pose))
        if (q.rotate) expect(at(p, bone, k.frame) - at(b, bone, k.frame)).toBeCloseTo(q.rotate, 3);
    // The head keeps its follow: on every frame it is the plan's turn plus the eased layer (the sum
    // is one fitted curve per segment, within 0.1 degree).
    const layer = poseTrack(
      [
        { frame: 0, value: [0] },
        { frame: 10, value: [0] },
        { frame: 30, value: [5], ease: "sine" },
        { frame: 50, value: [0] },
      ],
      80,
      true,
    );
    const follow = Array.from({ length: 81 }, (_, f) => at(b, "head", f));
    expect(Math.max(...follow) - Math.min(...follow)).toBeGreaterThan(0.5);
    for (let f = 0; f <= 80; f++)
      expect(Math.abs(at(p, "head", f) - follow[f]! - trackValue(layer, f)[0]!)).toBeLessThan(0.1);
    // Sparse: about one key per key pose or plan key, not one per frame.
    const head = p.rotationTimelines!.find((t) => t.boneId === "head")!;
    expect(head.keys.length).toBeLessThan(
      b.rotationTimelines!.find((t) => t.boneId === "head")!.keys.length + 8,
    );
    // The spine has no motion of its own: its keys are the key poses, with their eases.
    const spine = p.rotationTimelines!.find((t) => t.boneId === "spine")!;
    expect(spine.keys.map((k) => Math.round(k.time * 30))).toEqual([0, 10, 30, 50, 80]);
    expect(spine.keys[1]!.curve).toEqual(easeCurve("sine"));
    // A one-shot holds its last key pose.
    plan.motion.animations[0]!.loop = false;
    const shot = buildCharacter(plan, fixtureLayout()).animations[0]!;
    expect(at(shot, "arm_r", 80) - at(b, "arm_r", 80)).toBeCloseTo(12, 1);
    expect(posed.seams.every((s) => s.maxDrift < 11)).toBe(true);
    expect(handoverNotes(posed.rigging, posed.animations)).toContain(
      "關鍵姿勢：依參考圖在第 10、30、50 幀擺的姿勢",
    );
  });

  it("lints key poses: planned bones, frames inside the animation and increasing", () => {
    const plan: CharacterPlan = clone(fixturePlan());
    plan.motion.animations[0]!.keyposes = [
      { frame: 40, pose: { ghost: { rotate: 1 } } },
      { frame: 20, pose: { spine: { rotate: 1 } } },
      { frame: 80, pose: {} },
    ];
    const errors = lintCharacterPlan(plan).errors.join("\n");
    expect(errors).toMatch(/key pose 40: unknown bone ghost/);
    expect(errors).toMatch(/frames must increase \(20\)/);
    expect(errors).toMatch(/key pose at 80 is past frame 79/);
  });

  it("fits key poses back from pictures of a posed build on three frames", async () => {
    const ws = await fixtureWorkspace();
    const textures = fixtureTextures();
    for (const name of FIXTURE_ORDER) {
      const im = textures.get(name)!,
        png = new PNG({ width: im.width, height: im.height });
      png.data.set(im.rgba);
      await writeFile(join(ws, "images", `${name}.png`), PNG.sync.write(png));
    }
    const plan: CharacterPlan = { ...fixturePlan(), qa: { ...fixturePlan().qa!, view: VIEW } };
    const target = clone(plan);
    target.motion.animations[0]!.keyposes = KNOWN;
    await writeFile(join(ws, "plan.json"), JSON.stringify(plan));
    await writeFile(join(ws, "target.json"), JSON.stringify(target));
    await buildCharacterFiles(join(ws, "plan.json"), join(ws, "base"));
    await buildCharacterFiles(join(ws, "target.json"), join(ws, "target"));
    const targetDoc = JSON.parse(
      await readFile(join(ws, "target", "fixture_character.json"), "utf8"),
    ) as unknown;
    const args: string[] = [];
    for (const k of KNOWN) {
      await writeFile(
        join(ws, `f${k.frame}.png`),
        PNG.sync.write(picture(targetDoc, k.frame, textures)),
      );
      args.push(`${k.frame}=${join(ws, `f${k.frame}.png`)}`);
    }
    const out = join(ws, "keyposes.json");
    const run = cli(
      "fit-pose",
      join(ws, "plan.json"),
      join(ws, "base"),
      ...args,
      out,
      "--window=40",
      "--ease=sine",
    );
    expect(run.stderr).toBe("");
    const summary = JSON.parse(run.stdout) as {
      keyposes: number;
      frames: { frame: number; accepted: boolean; coverage: number }[];
    };
    expect(summary.keyposes).toBe(3);
    // The hair hangs mostly behind the head: it may match too little to count, as on frame 30.
    for (const f of summary.frames) {
      expect(f.accepted).toBe(true);
      expect(f.coverage).toBeGreaterThan(0.7);
    }
    const written = JSON.parse(await readFile(out, "utf8")) as { keyposes: Keyposes };
    expect(written.keyposes.map((k) => k.frame)).toEqual([10, 30, 50]);
    expect(written.keyposes.every((k) => k.ease === "sine")).toBe(true);
    // Each picture's pose comes back within half a degree on the bones that moved...
    for (const [i, k] of KNOWN.entries())
      for (const [bone, q] of Object.entries(k.pose))
        expect(Math.abs((written.keyposes[i]!.pose[bone]?.rotate ?? 0) - q.rotate!)).toBeLessThan(
          0.5,
        );
    // ...and the others stay within half a degree too.
    for (const [i, k] of written.keyposes.entries())
      for (const [bone, q] of Object.entries(k.pose))
        if (!KNOWN[i]!.pose[bone]) expect(Math.abs(q.rotate ?? 0)).toBeLessThan(0.5);

    // Rebuilt with the fitted key poses, every part lands where the pictures show it.
    const refit = clone(plan);
    refit.motion.animations[0]!.keyposes = written.keyposes;
    const refitDoc = buildCharacter(refit, fixtureLayout()).document;
    for (const k of KNOWN) {
      const want = vertices(targetDoc, k.frame),
        got = vertices(refitDoc, k.frame),
        d: number[] = [];
      for (const [slot, v] of want) {
        const w = got.get(slot)!;
        for (let j = 0; j < v.length; j += 2)
          d.push(Math.hypot(v[j]! - w[j]!, v[j + 1]! - w[j + 1]!));
      }
      d.sort((x, y) => x - y);
      expect(d[Math.floor(d.length / 2)]).toBeLessThan(0.5);
      expect(d.at(-1)).toBeLessThan(2);
    }

    // Fitting again over the refit build keeps its key poses and adds what is left (near none).
    await writeFile(join(ws, "refit.json"), JSON.stringify(refit));
    await buildCharacterFiles(join(ws, "refit.json"), join(ws, "refit"));
    const again = cli(
      "fit-pose",
      join(ws, "refit.json"),
      join(ws, "refit"),
      args[1]!,
      join(ws, "again.json"),
      "--window=40",
    );
    expect(again.stderr).toBe("");
    const merged = JSON.parse(await readFile(join(ws, "again.json"), "utf8")) as {
      keyposes: Keyposes;
    };
    expect(merged.keyposes.map((k) => k.frame)).toEqual([10, 30, 50]);
    expect(merged.keyposes[0]).toEqual(written.keyposes[0]);
    expect(Math.abs(merged.keyposes[1]!.pose.thigh_r!.rotate! + 6)).toBeLessThan(0.5);
    // A picture past the end, or two for one frame, is refused.
    expect(
      cli(
        "fit-pose",
        join(ws, "plan.json"),
        join(ws, "base"),
        `80=${join(ws, "f10.png")}`,
        join(ws, "x.json"),
      ).stderr,
    ).toMatch(/CLI_FIT_FRAMES/);
    expect(
      cli(
        "fit-pose",
        join(ws, "plan.json"),
        join(ws, "base"),
        args[0]!,
        args[0]!,
        join(ws, "x.json"),
      ).stderr,
    ).toMatch(/two pictures for frame 10/);
  }, 240_000);

  it("places a turned head whose picture shows another expression (ADR-034)", async () => {
    // A face of five parts on the head (eyes, brows, nose, mouth, cheeks). The picture turns the
    // head 12 degrees and redraws every face part: they hold more of the head's say than its dome,
    // body and hair, which keep their drawing.
    const FACE: Record<string, Image> = {
      Brows: { width: 44, height: 8, x: 0, y: 271, color: [70, 50, 40], inside: ellipse },
      Nose: { width: 12, height: 12, x: 0, y: 248, color: [200, 120, 120], inside: ellipse },
      Mouth: { width: 36, height: 12, x: 0, y: 234, color: [170, 60, 70], inside: ellipse },
      Cheeks: {
        width: 64,
        height: 14,
        x: 0,
        y: 244,
        color: [240, 150, 150],
        inside: (u, v) =>
          ((u - 0.12) * 64) ** 2 + ((v - 0.5) * 14) ** 2 <= 49 ||
          ((u - 0.88) * 64) ** 2 + ((v - 0.5) * 14) ** 2 <= 49,
      },
    };
    const ws = await fixtureWorkspace();
    const textures = fixtureTextures();
    Object.entries(FACE).forEach(([name, im], i) =>
      textures.set(name, texturedRgba(im, FIXTURE_ORDER.length + i)),
    );
    for (const [name, im] of textures) {
      const png = new PNG({ width: im.width, height: im.height });
      png.data.set(im.rgba);
      await writeFile(join(ws, "images", `${name}.png`), PNG.sync.write(png));
    }
    const imagesOnly = fixtureImagesOnly();
    for (const [name, im] of Object.entries(FACE)) {
      imagesOnly.slots.push({ name, bone: "root", attachment: name });
      imagesOnly.skins[0]!.attachments[name] = {
        [name]: { x: im.x, y: im.y, width: im.width, height: im.height },
      };
    }
    await writeFile(join(ws, "imagesOnly.json"), JSON.stringify(imagesOnly));
    const plan: CharacterPlan = { ...fixturePlan(), qa: { ...fixturePlan().qa!, view: VIEW } };
    plan.regions = { ...plan.regions, Brows: "eyes", Nose: "eyes", Mouth: "eyes", Cheeks: "eyes" };
    const target = clone(plan);
    target.motion.animations[0]!.keyposes = [{ frame: 30, pose: { head: { rotate: 12 } } }];
    await writeFile(join(ws, "plan.json"), JSON.stringify(plan));
    await writeFile(join(ws, "target.json"), JSON.stringify(target));
    await buildCharacterFiles(join(ws, "plan.json"), join(ws, "base"));
    await buildCharacterFiles(join(ws, "target.json"), join(ws, "target"));
    const targetDoc = JSON.parse(
      await readFile(join(ws, "target", "fixture_character.json"), "utf8"),
    ) as unknown;
    const expression = new Map(textures);
    for (const name of ["Eyes", ...Object.keys(FACE)]) {
      const im = textures.get(name)!,
        rgba = im.rgba.slice();
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) rgba.set([250, 245, 235], i);
      expression.set(name, { ...im, rgba });
    }
    await writeFile(join(ws, "f30.png"), PNG.sync.write(picture(targetDoc, 30, expression)));
    await fitPoseFiles(
      join(ws, "plan.json"),
      join(ws, "base"),
      [{ frame: 30, path: join(ws, "f30.png") }],
      join(ws, "face.json"),
      { window: 40 },
    );
    const written = JSON.parse(await readFile(join(ws, "face.json"), "utf8")) as {
      keyposes: Keyposes;
      frames: { accepted: boolean; parts: { slot: string; used: boolean }[] }[];
    };
    // The better-matching half of the head's say (dome, body, hair) places it; the redrawn face
    // parts are left out of the solve.
    expect(written.frames[0]!.accepted).toBe(true);
    expect(
      written.frames[0]!.parts.filter((p) => !p.used)
        .map((p) => p.slot)
        .sort(),
    ).toEqual(["Brows", "Cheeks", "Eyes", "Mouth", "Nose"]);
    expect(Math.abs(written.keyposes[0]!.pose.head!.rotate! - 12)).toBeLessThan(1.5);
  }, 120_000);
});
