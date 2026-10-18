import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { PNG } from "pngjs";
import type { CharacterPlan } from "@autospine/schemas";
import { animateCharacter, rigCharacter, type Keyposes } from "@autospine/character";
import { buildCharacterFiles, deliverFiles, fitVideoFiles } from "@autospine/cli/character";
import { AutoSpineMcpServer } from "@autospine/mcp";
import { sampleAnimation } from "@autospine/motion";
import {
  flatten,
  frameTime,
  loadSkeleton,
  pose,
  premultiply,
  render,
  videoPenalty,
  type Texture,
} from "@autospine/reference";
import {
  FIXTURE_ORDER,
  fixtureLayout,
  fixturePlan,
  fixtureTextures,
  fixtureWorkspace,
} from "./character-fixture.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const cli = (...args: string[]) =>
  spawnSync(process.execPath, [resolve("packages/cli/dist/index.js"), ...args], {
    encoding: "utf8",
    timeout: 300_000,
  });
const VIEW = { x: -60, y: 305, width: 120, height: 310 };

/**
 * The motion in the video: a 40-frame idle whose hips bob twice as the spine sways and the arm
 * swings, eased like an artist's keys. The fixture's plan guesses another main beat (depth 5).
 */
const MOTION: Keyposes = [
  {
    frame: 10,
    ease: "sine",
    pose: { hips: { y: 3 }, spine: { rotate: 5 }, arm_r: { rotate: -8 } },
  },
  { frame: 20, ease: "sine", pose: { thigh_r: { rotate: -5 } } },
  {
    frame: 30,
    ease: "sine",
    pose: { hips: { y: 3 }, spine: { rotate: -4 }, arm_r: { rotate: 6 } },
  },
];

/** The fixture with value-noise art, 40-frame idle, and the world area the pictures cover. */
async function workspace(art = fixtureTextures()) {
  const ws = await fixtureWorkspace();
  for (const name of FIXTURE_ORDER) {
    const im = art.get(name)!,
      png = new PNG({ width: im.width, height: im.height });
    png.data.set(im.rgba);
    await writeFile(join(ws, "images", `${name}.png`), PNG.sync.write(png));
  }
  const plan = fixturePlan();
  plan.qa = { ...plan.qa!, view: VIEW };
  plan.motion.animations = [{ name: "IDLE", frames: 40 }];
  // The fixture's eye look, keyed inside the shorter loop.
  plan.motion.keyed![0]!.keys.IDLE = [
    { frame: 10, value: [1, 0], ease: "sine" },
    { frame: 30, value: [-1, 0], ease: "sine" },
  ];
  await writeFile(join(ws, "plan.json"), JSON.stringify(plan));
  return { ws, plan };
}
/** The plan as the video moves: no guessed main depth, the motion as key poses. */
function moving(plan: CharacterPlan): CharacterPlan {
  const target = structuredClone(plan),
    a = target.motion.animations[0]!;
  a.motion = { main: { ...plan.motion.main, depth: 0, rise: 0, holdDepth: 0 } };
  a.keyposes = MOTION;
  return target;
}
/**
 * Two loops of a build rendered on a plain background, off-centre, as an H.264 clip. `decoy` draws
 * another build's arm over the figure on some frames: a look-alike of the arm (ADR-039).
 */
async function video(
  ws: string,
  build: string,
  out: string,
  art = fixtureTextures(),
  decoy?: { document: unknown; frames: (f: number) => boolean },
) {
  const sk = loadSkeleton(
    JSON.parse(await readFile(join(build, "fixture_character.json"), "utf8")),
  );
  const cache = new Map<string, Texture>();
  const texture = (p: string) => {
    let t = cache.get(p);
    if (!t) {
      const im = art.get(p)!;
      cache.set(p, (t = premultiply(im.width, im.height, im.rgba)));
    }
    return t;
  };
  const W = 300,
    H = 360,
    fps = 30,
    N = 40,
    D = N / fps;
  const view = { x0: -140, y0: 330, scale: 1, width: W, height: H };
  const p = spawn(
    "ffmpeg",
    [
      ...["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24"],
      ...["-s", `${W}x${H}`, "-r", String(fps), "-i", "-"],
      ...["-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out],
    ],
    { stdio: ["pipe", "ignore", "inherit"] },
  );
  const done = new Promise<number>((ok) => p.on("close", (c) => ok(c ?? 1)));
  for (let f = 0; f < 2 * N; f++) {
    pose(sk, "IDLE", frameTime(f % N, N, D, fps));
    let canvas = render(sk, texture, view);
    if (decoy?.frames(f % N)) {
      const other = loadSkeleton(decoy.document);
      pose(other, "IDLE", frameTime(f % N, N, D, fps));
      for (const slot of other.skeleton.slots)
        if (slot.data.name !== "Arm_R") slot.setAttachment(null);
      const top = render(other, texture, view);
      canvas = canvas.map((v, i) => top[i]! + v * (1 - top[i - (i % 4) + 3]!));
    }
    const rgb = flatten(canvas, W, H, [0.93, 0.95, 0.97]);
    if (!p.stdin.write(rgb)) await new Promise((ok) => p.stdin.once("drain", ok));
  }
  p.stdin.end();
  expect(await done).toBe(0);
  return out;
}
/** Each bone's IR rotation and translation on a frame, as the plan builds it. */
function irPose(plan: CharacterPlan) {
  const rigging = rigCharacter(plan, fixtureLayout());
  const animation = animateCharacter(rigging).animations[0]!;
  return (g: number) => sampleAnimation(animation, rigging.rigged.rig, g / 30);
}

describe("fit-video: a reference video drives the motion (ADR-036)", () => {
  it("scores how far a comparison is from passing", () => {
    const row = (id: string, ok: boolean, value: unknown) => ({ id, ok, value });
    const passed = [
      row("V1", true, [0.95, 0.9]),
      row("V2", true, [0.3, 1.0, "7 parts"]),
      row("V3", true, [1, 1.1]),
      row("V4", true, 0),
    ];
    expect(videoPenalty(passed)).toBe(0);
    const worse = [
      row("V1", false, [0.81, 0.72]),
      row("V2", false, [1.2, 3, "7 parts"]),
      row("V3", false, [4, 0.5]),
      row("V4", false, 0.004),
    ];
    // (0.9-0.81)/0.9 + (0.8-0.72)/0.8 + (1.2-0.6)/0.6 + (3-1.5)/1.5 + (4-2)/2 + (0.75-0.5)/0.75 + 1
    expect(videoPenalty(worse)).toBeCloseTo(0.1 + 0.1 + 1 + 1 + 1 + 1 / 3 + 1, 3);
    expect(videoPenalty([row("V2", false, "no part could be tracked")])).toBe(1);
  });

  it.skipIf(!hasFfmpeg)(
    "fits a guessed idle to the video's bob and sway on sparse keys, and passes",
    async () => {
      const { ws, plan } = await workspace();
      await writeFile(join(ws, "target.json"), JSON.stringify(moving(plan)));
      await buildCharacterFiles(join(ws, "plan.json"), join(ws, "build"));
      await buildCharacterFiles(join(ws, "target.json"), join(ws, "target"));
      const clip = await video(ws, join(ws, "target"), join(ws, "idle.mp4"));
      const lines: string[] = [];
      const fit = await fitVideoFiles(join(ws, "plan.json"), join(ws, "build"), join(ws, "fit"), {
        video: clip,
        every: 2,
        log: (l) => lines.push(l),
      });
      expect(fit.label).toBe("reference-fitted");
      expect(fit.pass).toBe(true);
      // What the run read: the plan, the images-only file and its images, the build and the video.
      const read = fit.inputs.map((i) => relative(ws, i.path));
      expect(read).toEqual(
        expect.arrayContaining(["plan.json", "build/fixture_character.json", "idle.mp4"]),
      );
      expect(read.filter((f) => f.startsWith("images/")).length).toBeGreaterThan(3);
      for (const i of fit.inputs) expect(i.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fit.rounds.length).toBeLessThanOrEqual(3);
      expect(fit.zero!.coverage).toBeGreaterThan(0.9);
      // The video repeats every 40 frames; two loops of it are folded into the plan's one.
      expect(Math.abs(fit.loop!.period - 40)).toBeLessThan(1);
      expect(fit.loop!.cycles).toBe(2);
      expect(fit.unfitted).toEqual([]);
      expect((await readdir(join(ws, "fit"))).sort()).toEqual(
        expect.arrayContaining(["base", "best", "pictures", "round-1", "summary.json"]),
      );
      expect(existsSync(join(ws, "fit", "best", "build", "fixture_character.json"))).toBe(true);
      // The source plan is not changed.
      expect(JSON.parse(await readFile(join(ws, "plan.json"), "utf8"))).toEqual(plan);
      // Sparse keys on shared frames: at most twice the idle density (here 4 over 40 frames).
      const best = JSON.parse(
        await readFile(join(ws, "fit", "best", "plan.json"), "utf8"),
      ) as CharacterPlan;
      const keyposes = best.motion.animations[0]!.keyposes!;
      expect(keyposes.length).toBeLessThanOrEqual(4);
      expect(keyposes[0]!.frame).toBe(0);
      // The bones come back within 2 degrees and the hips within a pixel. Tracked from both ends
      // (ADR-039), the fitted frames are within 0.65 degree on the spine and legs and 1.3 on the
      // arm; the cap of four shared keys spreads the rest onto the arm.
      const want = irPose(moving(plan)),
        got = irPose(best);
      let worst = 0;
      for (const g of [5, 10, 15, 20, 25, 30, 35]) {
        const a = want(g),
          b = got(g);
        for (const bone of ["spine", "arm_r", "thigh_r", "thigh_l", "head"])
          worst = Math.max(worst, Math.abs((a.rotations[bone] ?? 0) - (b.rotations[bone] ?? 0)));
        expect(Math.abs(a.translations.hips![1] - b.translations.hips![1])).toBeLessThan(1);
      }
      expect(worst).toBeLessThan(2);
      expect(fit.rounds[0]!.keys).toMatchObject({ frames: 4, capped: true });
      // A clean clip: both tracks agree everywhere and never lose a part.
      expect(fit.tracking).toMatchObject({
        disagree: {},
        singlePass: [],
        lost: { forward: 0, backward: 0 },
      });
      expect(lines.some((l) => l.startsWith("round 1: penalty 0 (passed)"))).toBe(true);
    },
    600_000,
  );

  it.skipIf(!hasFfmpeg)(
    "follows the arm past a look-alike of it and leaves out the frames a track jumped on (ADR-039)",
    async () => {
      const { ws, plan } = await workspace();
      const target = moving(plan),
        swung = moving(plan);
      swung.motion.animations[0]!.pose = { arm_r: { rotate: 28 } };
      await writeFile(join(ws, "target.json"), JSON.stringify(target));
      await writeFile(join(ws, "swung.json"), JSON.stringify(swung));
      await buildCharacterFiles(join(ws, "plan.json"), join(ws, "build"));
      await buildCharacterFiles(join(ws, "target.json"), join(ws, "target"));
      await buildCharacterFiles(join(ws, "swung.json"), join(ws, "swung"));
      // On frames 12-24 of each loop a copy of the arm, swung 28 degrees out, is drawn on top. A
      // frame fitted alone takes the copy (27.5 degrees off; V2 p90 3.1 %, V3 size 0.46: failed).
      const document = JSON.parse(
        await readFile(join(ws, "swung", "fixture_character.json"), "utf8"),
      ) as unknown;
      const clip = await video(ws, join(ws, "target"), join(ws, "idle.mp4"), fixtureTextures(), {
        document,
        frames: (f) => f >= 12 && f <= 24,
      });
      process.env.AUTOSPINE_DEBUG_TRACKS = "1";
      const fit = await fitVideoFiles(join(ws, "plan.json"), join(ws, "build"), join(ws, "fit"), {
        video: clip,
        every: 4,
        rounds: 1,
      }).finally(() => delete process.env.AUTOSPINE_DEBUG_TRACKS);
      // Tracked, the arm is found within 1.5 degrees on every frame kept; the frames on which
      // one track took the copy disagree with the other, and are left as gaps and named.
      const want = irPose(target),
        tracks = JSON.parse(await readFile(join(ws, "fit", "round-1", "tracks.json"), "utf8")) as {
          channels: string[];
          absolute: (number | null)[][];
        };
      const arm = tracks.absolute[tracks.channels.indexOf("arm_r.rotate")]!;
      arm.forEach((v, g) => {
        if (v !== null) expect(Math.abs(v - want(g % 40).rotations.arm_r!)).toBeLessThan(1.5);
      });
      const gaps = (fit.tracking!.disagree as Record<string, number[]>).arm_r ?? [];
      for (const f of gaps) expect(f % 40).toBeGreaterThanOrEqual(12);
      for (const f of gaps) expect(f % 40).toBeLessThanOrEqual(24);
      expect(fit.hints.some((h) => h.startsWith("arm_r: the forward and backward tracks"))).toBe(
        gaps.length > 0,
      );
      expect(fit.pass).toBe(true);
    },
    600_000,
  );

  it.skipIf(!hasFfmpeg)(
    "refuses a video of other art before fitting anything",
    async () => {
      const { ws, plan } = await workspace();
      await buildCharacterFiles(join(ws, "plan.json"), join(ws, "build"));
      // The same figure drawn in other colours: the parts are not in the video.
      const other = new Map(
        [...fixtureTextures()].map(([k, im]) => {
          const rgba = Uint8Array.from(im.rgba, (v, i) => (i % 4 === 3 ? v : 255 - v));
          return [k, { ...im, rgba }] as const;
        }),
      );
      await writeFile(join(ws, "target.json"), JSON.stringify(moving(plan)));
      await buildCharacterFiles(join(ws, "target.json"), join(ws, "target"));
      const clip = await video(ws, join(ws, "target"), join(ws, "other.mp4"), other);
      const run = cli(
        "fit-video",
        join(ws, "plan.json"),
        join(ws, "build"),
        join(ws, "fit"),
        `--video=${clip}`,
      );
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/CLI_FIT_VIDEO: frame 0 covers .* the video does not draw/);
      expect((await readdir(join(ws, "fit"))).filter((d) => d.startsWith("round"))).toEqual([]);
      // The MCP tool says why, without the workspace's paths.
      const server = new AutoSpineMcpServer(ws);
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
      const r = (await server.receive({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "autospine_fit_video",
          arguments: {
            planPath: "plan.json",
            buildDir: "build",
            videoPath: "other.mp4",
            outputDir: "fit-mcp",
          },
        },
      })) as { result: { isError?: boolean; structuredContent: unknown } };
      expect(r.result.isError).toBe(true);
      expect(r.result.structuredContent).toMatchObject({
        code: "MCP_FIT_VIDEO",
        reason: expect.stringMatching(/^frame 0 covers .* the video does not draw/),
      });
      expect(JSON.stringify(r.result.structuredContent)).not.toContain(ws);
    },
    300_000,
  );

  it.skipIf(!hasFfmpeg || process.platform === "win32")(
    "delivers the build as given, and says why, when a fit cannot run",
    async () => {
      const { ws, plan } = await workspace();
      // use: "fit" without plan.qa.view: the fit is refused before it reads the video.
      delete plan.qa!.view;
      plan.motion.animations[0]!.reference = { video: "idle.mp4", use: "fit" };
      await writeFile(join(ws, "plan.json"), JSON.stringify(plan));
      await buildCharacterFiles(join(ws, "plan.json"), join(ws, "build"));
      const delivered = await deliverFiles(
        join(ws, "plan.json"),
        join(ws, "build"),
        join(ws, "Delivery"),
        undefined,
      );
      expect(delivered.fitError).toMatch(/^IDLE: CLI_FIT_VIEW/);
      expect(delivered.fitted).toBeUndefined();
      expect(delivered.video).not.toBeNull();
      expect(delivered.json ?? delivered.spine).not.toBeNull();
      // The comparison still runs, and reports the missing video without blocking.
      expect(delivered.referenceError).toMatch(/CLI_VIDEO/);
    },
    300_000,
  );
});
