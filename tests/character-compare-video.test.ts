import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { buildCharacterFiles, compareVideoFiles, deliverFiles } from "@autospine/cli/character";
import {
  checkVideoAcceptance,
  drawList,
  flatten,
  frameTime,
  dropJumps,
  lagAndAmplitude,
  loadSkeleton,
  matchPart,
  partTemplate,
  plainBorder,
  pose,
  premultiply,
  registerMasks,
  render,
  scoreParts,
  type Texture,
} from "@autospine/reference";
import { fixtureTextures, fixtureWorkspace } from "./character-fixture.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/**
 * A stand-in reference video: the fixture build itself, rendered at its own framing on a plain
 * background and shifted by `shift` frames (positive: the reference is ahead, so the build is late).
 */
async function referenceVideo(
  ws: string,
  out: string,
  opts: { shift?: number; scale?: number; background?: [number, number, number] } = {},
) {
  const textured = true;
  const sk = loadSkeleton(
    JSON.parse(await readFile(join(ws, "build", "fixture_character.json"), "utf8")),
  );
  const cache = new Map<string, Texture>();
  const texture = (path: string): Texture => {
    let t = cache.get(path);
    if (!t) {
      const im = textured ? fixtureTextures().get(path) : undefined;
      if (im) t = premultiply(im.width, im.height, im.rgba);
      else {
        const png = PNG.sync.read(readFileSync(join(ws, "images", `${path}.png`)));
        t = premultiply(png.width, png.height, png.data);
      }
      cache.set(path, t);
    }
    return t;
  };
  const anim = sk.data.findAnimation("IDLE")!;
  const fps = 30,
    D = anim.duration,
    N = Math.round(D * fps);
  const W = 360,
    H = 400,
    scale = opts.scale ?? 1.1;
  pose(sk, "IDLE", 0);
  let minX = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const d of drawList(sk))
    for (let i = 0; i < d.verts.length; i += 2) {
      minX = Math.min(minX, d.verts[i]!);
      maxX = Math.max(maxX, d.verts[i]!);
      maxY = Math.max(maxY, d.verts[i + 1]!);
    }
  // Off-centre on purpose, so the comparison has to find the figure.
  const view = {
    x0: (minX + maxX) / 2 - (W * 0.42) / scale,
    y0: maxY + 30 / scale,
    scale,
    width: W,
    height: H,
  };
  const bg = opts.background ?? [0.93, 0.95, 0.97];
  const p = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${W}x${H}`,
      "-r",
      String(fps),
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      out,
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  const done = new Promise<number>((ok) => p.on("close", (c) => ok(c ?? 1)));
  for (let f = 0; f < N; f++) {
    const g = (((f + (opts.shift ?? 0)) % N) + N) % N;
    pose(sk, "IDLE", frameTime(g, N, D, fps));
    const rgb = flatten(render(sk, texture, view), W, H, bg);
    if (!p.stdin.write(rgb)) await new Promise((ok) => p.stdin.once("drain", ok));
  }
  p.stdin.end();
  expect(await done).toBe(0);
  return out;
}

/** The fixture with value-noise art, as real drawings have texture to follow. */
async function texturedWorkspace() {
  const ws = await fixtureWorkspace();
  for (const [name, im] of fixtureTextures()) {
    const png = new PNG({ width: im.width, height: im.height });
    png.data.set(im.rgba);
    await writeFile(join(ws, "images", `${name}.png`), PNG.sync.write(png));
  }
  return ws;
}

describe("video acceptance measures (ADR-034)", () => {
  it("finds the shift and the size of a motion", () => {
    const n = 60;
    const r = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / n));
    const late = r.map((_, i) => 0.5 * r[(i - 3 + n) % n]!);
    const m = lagAndAmplitude(r, late, true);
    expect(m.lag).toBe(3);
    expect(m.amplitude).toBeCloseTo(0.5, 2);
    expect(m.correlation).toBeGreaterThan(0.99);
  });

  it("finds a part moved and turned in the next frame", () => {
    const w = 96,
      h = 96;
    const texture = (x: number, y: number) =>
      128 + 60 * Math.sin(x * 0.9) * Math.cos(y * 0.7) + 40 * Math.sin((x + 2 * y) * 0.31);
    // A bar of texture about (40, 48); in the second image it is moved (+5, -3) and turned 20°.
    const image = (dx: number, dy: number, deg: number) => {
      const g = new Float32Array(w * h).fill(30);
      const c = Math.cos((deg * Math.PI) / 180),
        s = Math.sin((deg * Math.PI) / 180);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = x - 40 - dx,
            v = y - 48 - dy;
          const bu = c * u + s * v,
            bv = -s * u + c * v;
          if (Math.abs(bu) <= 18 && Math.abs(bv) <= 6) g[y * w + x] = texture(bu + 40, bv + 48);
        }
      return { w, h, g };
    };
    const first = image(0, 0, 0);
    const owned: number[] = [];
    for (let y = 42; y <= 54; y++) for (let x = 22; x <= 58; x++) owned.push(y * w + x);
    const tpl = partTemplate(first, owned)!;
    const hit = matchPart(image(5, -3, 20), tpl, 10);
    expect(hit.score).toBeGreaterThan(0.8);
    expect(Math.abs(hit.dx - 5)).toBeLessThan(1);
    expect(Math.abs(hit.dy + 3)).toBeLessThan(1);
    expect(Math.abs(hit.angle - 20)).toBeLessThanOrEqual(5);
    // A flat patch has nothing to match.
    expect(partTemplate({ w, h, g: new Float32Array(w * h).fill(90) }, owned)).toBeNull();
  });

  it("drops a lone mismatch and tells a plain background from scenery", () => {
    const track = {
      part: "arm",
      build: Array.from({ length: 10 }, (_, i): [number, number] => [i, 0]),
      ref: Array.from({ length: 10 }, (_, i): [number, number] => [i + (i === 5 ? 30 : 0.5), 0]),
    };
    const kept = dropJumps(track, 4, true);
    expect(kept.ref.filter((p) => p === null)).toHaveLength(1);
    expect(kept.ref[5]).toBeNull();
    const plain = { width: 40, height: 30, rgb: new Uint8Array(40 * 30 * 3).fill(40) };
    expect(plainBorder(plain, [40, 40, 40])).toBe(1);
    const scenery = { ...plain, rgb: plain.rgb.map((_, i) => (i * 37) % 256) };
    expect(plainBorder(scenery, [40, 40, 40])).toBeLessThan(0.75);
  });

  it("registers a shifted, scaled silhouette", () => {
    const w = 120,
      h = 120;
    const disc = (cx: number, cy: number, r: number) => {
      const m = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((x - cx) ** 2 + ((y - cy) * 0.6) ** 2 <= r * r) m[y * w + x] = 1;
      return m;
    };
    const reg = registerMasks(disc(64, 58, 30), disc(56, 62, 28.5), w, h);
    expect(reg.iou).toBeGreaterThan(0.95);
    expect(reg.scale).toBeGreaterThan(1.02);
  });

  it("passes identical motion and fails a late one", () => {
    const track = (shift: number) =>
      Array.from({ length: 40 }, (_, i): [number, number] => [
        0,
        30 * Math.sin((2 * Math.PI * (i - shift)) / 40) -
          30 * Math.sin((-2 * Math.PI * shift) / 40),
      ]);
    const same = scoreParts([{ part: "arm", ref: track(0), build: track(0) }], 400, true);
    const late = scoreParts([{ part: "arm", ref: track(0), build: track(5) }], 400, true);
    expect(same[0]!.median).toBe(0);
    expect(late[0]!.lag).toBe(5);
    const rows = (parts: typeof same) =>
      checkVideoAcceptance({
        iou: Array(40).fill(0.95),
        parts,
        figure: { lag: 0, amplitude: 1, motion: 0.01 },
        seam: 0,
      });
    expect(rows(same).every((r) => r.ok)).toBe(true);
    expect(rows(late).find((r) => r.id.startsWith("V2"))!.ok).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)("compare-video: the build against a reference video", () => {
  it("matches a video of its own motion and reports a late one", async () => {
    const ws = await texturedWorkspace();
    const plan = join(ws, "plan.json");
    await buildCharacterFiles(plan, join(ws, "build"));

    const same = await compareVideoFiles(plan, join(ws, "build"), join(ws, "check-same"), {
      video: await referenceVideo(ws, join(ws, "same.mp4")),
    });
    const a = same.animations[0]!;
    console.log(JSON.stringify(a.rows), a.hints);
    expect(a.animation).toBe("IDLE");
    expect(a.pass).toBe(true);
    expect(a.hints).toEqual([]);
    expect(await readdir(join(ws, "check-same"))).toEqual(
      expect.arrayContaining(["IDLE", "summary.json"]),
    );
    expect((await readdir(join(ws, "check-same", "IDLE"))).sort()).toEqual([
      "compare.mp4",
      "report.json",
    ]);

    const late = await compareVideoFiles(plan, join(ws, "build"), join(ws, "check-late"), {
      video: await referenceVideo(ws, join(ws, "late.mp4"), { shift: 6, scale: 1.3 }),
    });
    const b = late.animations[0]!;
    console.log(JSON.stringify(b.rows), b.hints);
    expect(b.pass).toBe(false);
    expect(b.hints.join(" ")).toMatch(/late/);
  }, 120_000);

  it("deliver adds <name>-vs-reference.mp4 when the plan names a reference video", async () => {
    const ws = await texturedWorkspace();
    const plan = join(ws, "plan.json");
    await buildCharacterFiles(plan, join(ws, "build"));
    await referenceVideo(ws, join(ws, "ref.mp4"));
    const doc = JSON.parse(await readFile(plan, "utf8"));
    doc.motion.animations[0].reference = { video: "ref.mp4" };
    await writeFile(plan, JSON.stringify(doc));
    const delivery = join(ws, "Character");
    const result = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
      name: "Fixture_Idle",
      spine: join(ws, "no-spine-here"),
    }).catch((e: Error) => e);
    // An explicit Spine path that does not exist is an error; without one, the JSON fallback.
    expect(result).toBeInstanceOf(Error);
    const delivered = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
      name: "Fixture_Idle",
    });
    expect(delivered.reference?.pass).toBe(true);
    expect((await readdir(delivery)).sort()).toEqual(
      [
        delivered.spine ? "Fixture_Idle.spine" : "Fixture_Idle.json",
        "Fixture_Idle.mp4",
        "Fixture_Idle-vs-reference.mp4",
        "images",
      ].sort(),
    );
  }, 180_000);
});
