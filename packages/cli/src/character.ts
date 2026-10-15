import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PNG } from "pngjs";
import { pngThroughIend } from "@autospine/assets";
import { Value } from "@sinclair/typebox/value";
import { CharacterPlanSchema, type CharacterPlan, type KeyposeEase } from "@autospine/schemas";
import { readImagesOnlyLayout } from "@autospine/spine";
import {
  buildCharacter,
  addKeyposes,
  compileCharacter,
  handoverNotes,
  lintCharacterPlan,
  mergePlans,
  motionFor,
  rigCharacter,
  type CharacterLayout,
  type CharacterPart,
  type Params,
} from "@autospine/character";
import {
  checkAcceptance,
  compareToReference,
  fitKeyPoses,
  fitRestPose,
  initialSearchState,
  loadSkeleton,
  reviewFrames,
  makeObjective,
  patternSearch,
  placementDelta,
  premultiply,
  prepareReference,
  stripToImagesOnly,
  type SearchState,
  type Texture,
} from "@autospine/reference";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const json = (v: unknown) => `${JSON.stringify(v, null, 1)}\n`;
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
/** Outputs never overwrite: a build or comparison goes into a new directory. */
async function newDirectory(path: string) {
  if (await exists(path))
    throw new Error(`CLI_OUTPUT_EXISTS: ${path} already exists; choose a new output directory`);
  await mkdir(path, { recursive: true });
}

function decodePng(bytes: Buffer, file: string) {
  try {
    return PNG.sync.read(pngThroughIend(bytes));
  } catch {
    throw new Error(`CLI_PNG: cannot decode ${file}`);
  }
}
/** Images-only document + image folder -> placed parts with exact alpha. */
export async function loadLayout(
  imagesOnlyPath: string,
  imagesDir: string,
): Promise<{ layout: CharacterLayout; document: unknown }> {
  const document = JSON.parse(await readFile(imagesOnlyPath, "utf8")) as unknown;
  const read = readImagesOnlyLayout(document);
  const parts = new Map<string, CharacterPart>();
  for (const a of read.attachments) {
    const file = resolve(imagesDir, a.path + ".png");
    const png = decodePng(await readFile(file), file);
    if (png.width !== a.width || png.height !== a.height)
      throw new Error(
        `CLI_PNG_SIZE: ${a.path}.png is ${png.width}x${png.height}, layout says ${a.width}x${a.height}`,
      );
    const alpha = new Uint8Array(png.width * png.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = png.data[i * 4 + 3]!;
    parts.set(a.key, {
      key: a.key,
      slot: a.slot,
      attachment: a.attachment,
      path: a.path,
      setup: a.setup,
      order: a.order,
      width: a.width,
      height: a.height,
      alpha,
      affine: a.affine,
      sheared: a.sheared,
      ...(a.color ? { color: a.color } : {}),
    });
  }
  return { layout: { slots: read.slots, parts, skeleton: read.skeleton }, document };
}
export async function readPlan(planPath: string): Promise<CharacterPlan> {
  const plan = JSON.parse(await readFile(planPath, "utf8")) as unknown;
  if (!Value.Check(CharacterPlanSchema, plan)) {
    const errors = [...Value.Errors(CharacterPlanSchema, plan)]
      .slice(0, 8)
      .map((e) => `${e.path}: ${e.message}`);
    throw new Error(
      `CLI_PLAN_SCHEMA: ${planPath} is not a valid character plan\n  ${errors.join("\n  ")}`,
    );
  }
  return plan;
}
const planPaths = (planPath: string, plan: CharacterPlan) => ({
  imagesOnly: resolve(dirname(planPath), plan.source.imagesOnly),
  images: resolve(dirname(planPath), plan.source.images),
});
function textures(imagesDir: string) {
  const cache = new Map<string, { png: PNG; texture?: Texture }>();
  const get = (path: string) => {
    let e = cache.get(path);
    if (!e) {
      const file = resolve(imagesDir, path + ".png");
      cache.set(path, (e = { png: decodePngSync(file) }));
    }
    return e;
  };
  return {
    texture: (path: string) => {
      const e = get(path);
      return (e.texture ??= premultiply(e.png.width, e.png.height, e.png.data));
    },
    alpha: (path: string) => {
      const e = get(path),
        alpha = new Uint8Array(e.png.width * e.png.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = e.png.data[i * 4 + 3]!;
      return { width: e.png.width, height: e.png.height, alpha };
    },
  };
}
// Synchronous read for the runtime callbacks (review sheets only).
function decodePngSync(file: string) {
  return decodePng(readFileSync(file), file);
}

/**
 * merge-plans <new-plan.json> <plan.json> <plan.json>...: one plan from several plans of the same
 * character (ADR-031), so one build (one Spine project) holds every animation. The plans must read
 * the same images-only layout; the new plan names it from its own folder. Returns what the merge
 * decided (inserted parents, renamed blocks, animations with their own motion).
 */
export async function mergePlanFiles(
  outPath: string,
  planFiles: readonly string[],
  opts: { id?: string; name?: string } = {},
) {
  if (existsSync(outPath))
    throw new Error(`CLI_OUTPUT_EXISTS: ${outPath} already exists; choose a new file name`);
  const plans = await Promise.all(planFiles.map(readPlan));
  const sources = plans.map((p, i) => planPaths(planFiles[i]!, p));
  for (const [i, s] of sources.entries())
    if (s.imagesOnly !== sources[0]!.imagesOnly || s.images !== sources[0]!.images)
      throw new Error(`CLI_MERGE_SOURCE: ${planFiles[i]} reads another images-only layout`);
  const from = (p: string) =>
    relative(dirname(resolve(outPath)), p)
      .split(sep)
      .join("/");
  const source = { imagesOnly: from(sources[0]!.imagesOnly), images: from(sources[0]!.images) };
  const { plan, notes } = mergePlans(
    plans.map((p) => ({ ...p, source })),
    opts,
  );
  const { layout } = await loadLayout(sources[0]!.imagesOnly, sources[0]!.images);
  assertLint(lintCharacterPlan(plan, layout.parts.keys()), outPath);
  await writeFile(outPath, json(plan));
  return { output: outPath, animations: plan.motion.animations.map((a) => a.name), notes };
}

/**
 * lint-plan <plan.json>: schema plus cross-reference check against the images-only layout (part
 * names, joints, bones, meshes, constraints, motion parameters). No pixels are read.
 */
export async function lintPlanFile(planPath: string) {
  const plan = await readPlan(planPath);
  const paths = planPaths(planPath, plan);
  const layout = readImagesOnlyLayout(
    JSON.parse(await readFile(paths.imagesOnly, "utf8")) as unknown,
  );
  const lint = lintCharacterPlan(
    plan,
    layout.attachments.map((a) => a.key),
  );
  for (const a of layout.attachments)
    if (!(await exists(resolve(paths.images, a.path + ".png"))))
      lint.errors.push(`images: ${a.path}.png is missing`);
  return lint;
}
function assertLint(lint: { errors: string[] }, planPath: string) {
  if (lint.errors.length)
    throw new Error(
      `CLI_PLAN_LINT: ${planPath} has ${lint.errors.length} problem(s)\n  ${lint.errors.slice(0, 20).join("\n  ")}`,
    );
}

/** strip-images <artist.json> <images-dir> <out-images-only.json> */
export async function stripImages(artistPath: string, imagesDir: string, outPath: string) {
  if (await exists(outPath)) throw new Error(`CLI_OUTPUT_EXISTS: ${outPath} already exists`);
  const artist = JSON.parse(await readFile(artistPath, "utf8")) as unknown;
  const result = stripToImagesOnly(artist, (path) => {
    const file = resolve(imagesDir, path + ".png");
    if (!existsSync(file)) return undefined;
    const b = readFileSync(file);
    if (b.readUInt32BE(12) !== 0x49484452) throw new Error(`CLI_PNG: ${path}.png is not a PNG`);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  });
  await writeFile(outPath, `${JSON.stringify(result.document, null, 2)}\n`, { flag: "wx" });
  await writeFile(outPath.replace(/\.json$/, "") + ".strip-report.json", json(result.report), {
    flag: "wx",
  });
  return result.report.summary;
}

/**
 * build-character <plan.json> <new-output-dir> [--params=p.json]: rig, weights, motion and Spine
 * output from a plan; IK bends are checked against the images-only setup and flipped if needed.
 */
export async function buildCharacterFiles(planPath: string, outDir: string, paramsPath?: string) {
  const plan = await readPlan(planPath);
  const paths = planPaths(planPath, plan);
  const { layout, document: imagesOnly } = await loadLayout(paths.imagesOnly, paths.images);
  assertLint(lintCharacterPlan(plan, layout.parts.keys()), planPath);
  const params: Params = paramsPath
    ? (JSON.parse(await readFile(paramsPath, "utf8")) as Params)
    : {};
  const built = buildCharacter(plan, layout, { params });
  // Setup check with the official runtime: every image must sit where the images-only file puts it.
  const img = loadSkeleton(imagesOnly);
  const deviation = (doc: unknown) => {
    const d = placementDelta(img, loadSkeleton(doc));
    return Math.max(0, ...Object.values(d).filter((v): v is number => v !== null));
  };
  let bend: Record<string, boolean> = {},
    document = built.document,
    worst = deviation(document);
  for (const ik of built.rigging.ik) {
    if (worst <= 2) break;
    const flipped = { ...bend, [ik.name]: !ik.bendPositive };
    const doc = compileCharacter(built.rigging, built.animations, flipped, built.colorTimelines),
      w = deviation(doc);
    if (w < worst) [bend, document, worst] = [flipped, doc, w];
  }
  await newDirectory(outDir);
  const name = `${plan.id}.json`;
  await writeFile(join(outDir, name), `${JSON.stringify(document, null, 1)}\n`);
  await writeFile(
    join(outDir, "ir.json"),
    JSON.stringify({
      rig: built.rigging.rigged.rig,
      meshes: Object.fromEntries(
        [...built.rigging.meshes].map(([k, v]) => [k, { mesh: v.mesh, weights: v.weights }]),
      ),
      animations: built.animations,
    }),
  );
  // Animation names may hold Spine folders ("History/_Look"): file names keep safe characters only.
  for (const s of built.specs)
    await writeFile(
      join(outDir, `keypose-${s.name.replace(/[^A-Za-z0-9_-]/g, "_")}.json`),
      json(s),
    );
  const record = {
    plan: { id: plan.id, sha256: sha256(await readFile(planPath)) },
    imagesOnly: { sha256: sha256(await readFile(paths.imagesOnly)) },
    params: { ...plan.motion.params, ...params },
    joints: Object.fromEntries(
      Object.entries(built.rigging.rigged.joints).map(([k, v]) => [k, v.map((x) => +x.toFixed(2))]),
    ),
    faceMix: built.rigging.faceMix,
    bend: Object.fromEntries(built.rigging.ik.map((c) => [c.name, bend[c.name] ?? c.bendPositive])),
    setupDeviationPx: +worst.toFixed(3),
    seams: built.seams,
    evidence: built.rigging.evidence,
    artistQualityAccepted: false,
  };
  await writeFile(join(outDir, "build-record.json"), json(record));
  // Handover notes for whoever edits the Spine file next (ADR-026).
  await writeFile(join(outDir, "HANDOVER.md"), handoverNotes(built.rigging, built.animations));
  // Self-contained for Spine import: the images the document uses, under images/.
  const used = new Set([...layout.parts.values()].map((p) => p.path));
  for (const p of used) {
    const target = join(outDir, plan.output?.imagesPath ?? "./images/", p + ".png");
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(paths.images, p + ".png"), target);
  }
  return {
    output: join(outDir, name),
    bones: built.rigging.rigged.rig.bones.length,
    slots: built.rigging.slots.length,
    setupDeviationPx: record.setupDeviationPx,
    seams: built.seams.length,
    bend: record.bend,
  };
}

/** The plan's looping animations; the rest are one-shots (ADR-030). */
const loopNames = (plan: CharacterPlan) =>
  plan.motion.animations.filter((a) => a.loop !== false).map((a) => a.name);

/**
 * compare-reference <plan.json> <generated-dir> <artist.json> <new-output-dir>: pre-registered
 * acceptance of a build against the artist file, with review sheets and the criteria check.
 */
export async function compareReferenceFiles(
  planPath: string,
  buildDir: string,
  artistPath: string,
  outDir: string,
) {
  const plan = await readPlan(planPath);
  const paths = planPaths(planPath, plan);
  const probes = plan.qa?.probes;
  if (!probes) throw new Error("CLI_PLAN_QA: comparison needs qa.probes in the plan");
  const tex = textures(paths.images);
  const artist = JSON.parse(await readFile(artistPath, "utf8")) as unknown;
  const imagesOnly = JSON.parse(await readFile(paths.imagesOnly, "utf8")) as unknown;
  const generated = JSON.parse(
    await readFile(join(buildDir, `${plan.id}.json`), "utf8"),
  ) as unknown;
  const ir = JSON.parse(await readFile(join(buildDir, "ir.json"), "utf8")) as {
    animations: Parameters<typeof compareToReference>[3]["animations"];
  };
  const record = JSON.parse(await readFile(join(buildDir, "build-record.json"), "utf8")) as {
    seams: { maxDrift: number }[];
  };
  // Loops get phase-invariant chain metrics (ADR-020) and a loop seam; one-shots (ADR-030) neither.
  const options = {
    probes,
    deformExclude: plan.qa?.deformExclude ?? [],
    alpha: tex.alpha,
    name: plan.name,
    loop: loopNames(plan),
  };
  const reference = prepareReference(artist, imagesOnly, options);
  const { result, sheets } = compareToReference(reference, generated, imagesOnly, {
    ...options,
    texture: tex.texture,
    ...(plan.qa?.view ? { view: plan.qa.view } : {}),
    ...(ir.animations ? { animations: ir.animations } : {}),
  });
  const check = checkAcceptance(result, record.seams);
  await newDirectory(outDir);
  await writeFile(join(outDir, "acceptance-results.json"), json(result));
  await writeFile(join(outDir, "acceptance-check.json"), json(check));
  for (const [a, s] of Object.entries(sheets)) {
    const png = new PNG({ width: s.width, height: s.height });
    png.data.set(s.rgba);
    await writeFile(
      join(outDir, `compare-${a.replace(/[^A-Za-z0-9_-]/g, "_")}.png`),
      PNG.sync.write(png),
    );
  }
  return check;
}

/**
 * optimize-motion <plan.json> <artist.json> <state-dir> [--budget=seconds] [--margin=n] [--seed=n]:
 * resumable pattern search of the plan's motion parameters against the artist baseline.
 * Writes state.json, best-params.json and a JSONL log; rerun the same command to continue.
 */
export async function optimizeMotionFiles(
  planPath: string,
  artistPath: string,
  stateDir: string,
  opts: {
    budgetSeconds?: number;
    margin?: number;
    seed?: number;
    trajectoryWeight?: number;
    deformWeight?: number;
    bandShrink?: number;
  },
) {
  const plan = await readPlan(planPath);
  const space = plan.motion.search;
  if (!space || !Object.keys(space).length)
    throw new Error("CLI_PLAN_SEARCH: motion.search lists no parameters");
  const probes = plan.qa?.probes;
  if (!probes) throw new Error("CLI_PLAN_QA: optimisation needs qa.probes in the plan");
  const paths = planPaths(planPath, plan);
  const { layout, document: imagesOnly } = await loadLayout(paths.imagesOnly, paths.images);
  assertLint(lintCharacterPlan(plan, layout.parts.keys()), planPath);
  const artist = JSON.parse(await readFile(artistPath, "utf8")) as unknown;
  const tex = textures(paths.images);
  const reference = prepareReference(artist, imagesOnly, {
    probes,
    deformExclude: plan.qa?.deformExclude ?? [],
    alpha: tex.alpha,
    name: plan.name,
    loop: loopNames(plan),
  });
  const rigging = rigCharacter(plan, layout);
  const evaluate = makeObjective(rigging, reference, {
    probes,
    deformExclude: plan.qa?.deformExclude ?? [],
    ...(opts.margin !== undefined ? { margin: opts.margin } : {}),
    ...(opts.trajectoryWeight !== undefined ? { trajectoryWeight: opts.trajectoryWeight } : {}),
    ...(opts.deformWeight !== undefined ? { deformWeight: opts.deformWeight } : {}),
    ...(opts.bandShrink !== undefined ? { bandShrink: opts.bandShrink } : {}),
  });
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, "state.json");
  const state: SearchState = (await exists(statePath))
    ? (JSON.parse(await readFile(statePath, "utf8")) as SearchState)
    : initialSearchState(plan.motion.params, space, plan.motion.cycle, opts.seed);
  const lines: string[] = [];
  patternSearch(state, space, plan.motion.cycle, evaluate, {
    deadline: Date.now() + (opts.budgetSeconds ?? 150) * 1000,
    log: (e) => lines.push(JSON.stringify(e)),
  });
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(join(stateDir, "best-params.json"), json(state.x));
  await writeFile(
    join(stateDir, "search-log.jsonl"),
    lines.join("\n") + (lines.length ? "\n" : ""),
    { flag: "a" },
  );
  const best = state.best!;
  return {
    status: best.pass ? "passed" : state.finished ? "stopped" : "paused",
    evaluations: state.evaluations,
    sweep: state.sweep,
    penalty: best.penalty,
    critic: Object.fromEntries(
      Object.entries(best.perf).map(([a, p]) => [a, `${p.within}/${p.total}`]),
    ),
    failing: Object.fromEntries(Object.entries(best.perf).map(([a, p]) => [a, p.failing])),
    trajectory: best.trajectory,
  };
}

/**
 * fit-pose <plan.json> <build-dir> <reference.png> <new-pose.json> (ADR-024): the rest pose that
 * places the build's parts where a reference image shows them. The reference covers plan.qa.view
 * at any scale; frame 0 of the animation (default: the first) is the starting pose.
 *
 * fit-pose <plan.json> <build-dir> <frame>=<picture.png>... <new-keyposes.json> (ADR-033): key poses
 * from storyboard or video frames, each fitted over the build's pose on its frame. Pictures below
 * the coverage limit give no key pose. The written `keyposes` replace the animation's block: they
 * include key poses the plan already had, since the build was posed with them. With `zeroFrame`,
 * that frame's picture shows a pose the build already has (the rest pose fitted from it): it gives
 * no key pose, and what the matching reports for it is taken off the other pictures.
 */
export async function fitPoseFiles(
  planPath: string,
  buildDir: string,
  references: string | readonly { frame: number; path: string }[],
  outPath: string,
  opts: {
    animation?: string;
    window?: number;
    maxRotate?: number;
    minCoverage?: number;
    ease?: KeyposeEase;
    ignore?: readonly string[];
    zeroFrame?: number;
  } = {},
) {
  if (existsSync(outPath))
    throw new Error(`CLI_OUTPUT_EXISTS: ${outPath} already exists; choose a new file name`);
  const plan = await readPlan(planPath);
  const view = plan.qa?.view;
  if (!view)
    throw new Error("CLI_FIT_VIEW: fit-pose needs plan.qa.view, the world area of the reference");
  const animation = opts.animation ?? plan.motion.animations[0]!.name;
  const planned = plan.motion.animations.find((a) => a.name === animation);
  if (!planned) throw new Error(`CLI_FIT_ANIMATION: the plan has no animation ${animation}`);
  const document = JSON.parse(await readFile(join(buildDir, `${plan.id}.json`), "utf8")) as unknown;
  const pictures = typeof references === "string" ? [{ frame: 0, path: references }] : references;
  if (!pictures.length) throw new Error("CLI_FIT_FRAMES: give at least one picture");
  const loop = planned.loop !== false,
    last = loop ? planned.frames - 1 : planned.frames;
  const seen = new Set<number>();
  for (const { frame, path } of pictures) {
    if (!Number.isInteger(frame) || frame < 0 || frame > last)
      throw new Error(
        `CLI_FIT_FRAMES: ${path} is on frame ${frame}; ${animation} has frames 0-${last}`,
      );
    if (seen.has(frame)) throw new Error(`CLI_FIT_FRAMES: two pictures for frame ${frame}`);
    seen.add(frame);
  }
  if (opts.zeroFrame !== undefined && (typeof references === "string" || !seen.has(opts.zeroFrame)))
    throw new Error(`CLI_FIT_FRAMES: the zero frame ${opts.zeroFrame} needs one of the pictures`);
  const decoded = await Promise.all(
    pictures.map(async ({ frame, path }) => {
      const png = decodePng(await readFile(path), path);
      const sx = png.width / view.width,
        sy = png.height / view.height;
      if (Math.abs(sx / sy - 1) > 0.02)
        throw new Error(
          `CLI_FIT_VIEW: ${path} is ${png.width}x${png.height}; plan.qa.view is ${view.width}x${view.height}`,
        );
      return { frame, image: { width: png.width, height: png.height, rgba: png.data } };
    }),
  );
  const paths = planPaths(planPath, plan);
  // Only the plan's bones take offsets (the compiler adds helper frames for some of them).
  const { layout } = await loadLayout(paths.imagesOnly, paths.images);
  // The face rig stays with the head: a face that differs from the reference is an expression
  // (ADR-024 leaves expressions out), and its holes must stay over the eyes. The root and the
  // bones on it place the character on the ground: a rest pose does not move the ground.
  const rigging = rigCharacter(plan, layout),
    face = plan.face,
    fixed = new Set([
      "root",
      ...rigging.rigged.rig.bones.filter((b) => b.parentId === "root").map((b) => b.id),
      // A strand's bend on frame 0 is motion, not pose: chains, and end bones the plan swings
      // with rotate cycles (tufts, ears), follow their parent and their parts count toward it.
      // A bone bobbing with a translate cycle (a floating head) is structure and stays fitted.
      ...Object.values(rigging.rigged.chains).flat(),
      ...(motionFor(plan.motion, planned).cycles ?? [])
        .filter(
          (c) =>
            c.channel === "rotate" && !rigging.rigged.rig.bones.some((b) => b.parentId === c.bone),
        )
        .map((c) => c.bone),
      ...((rigging.evidence.faceCarriers as string[] | undefined) ?? []),
      ...(face
        ? [
            face.base,
            face.control,
            ...(face.counter ? [face.counter] : []),
            ...face.followers,
            ...(face.layers ?? []).map((l) => l.bone),
          ]
        : []),
    ]);
  const bones = rigging.rigged.rig.bones.map((b) => b.id).filter((id) => !fixed.has(id));
  // A chain's strand also places the bone it hangs from (hair and moustaches place the head).
  const groups: Record<string, string> = {};
  for (const entry of plan.bones)
    if ("chain" in entry)
      for (const id of rigging.rigged.chains[entry.chain.part] ?? [])
        groups[id] = entry.chain.parent;
  const images = new Map<string, PNG>();
  const texture = (path: string) => {
    let png = images.get(path);
    if (!png) images.set(path, (png = decodePngSync(resolve(paths.images, path + ".png"))));
    return { width: png.width, height: png.height, rgba: png.data };
  };
  const options = {
    view,
    bones,
    groups,
    // Only the hips (the main bone) and IK targets move; every other joint turns (ADR-025).
    translate: [
      motionFor(plan.motion, planned).main.bone,
      ...(plan.constraints?.ik ?? []).map((c) => c.target),
    ],
    ...(opts.window !== undefined ? { window: opts.window } : {}),
    ...(opts.maxRotate !== undefined ? { maxRotate: opts.maxRotate } : {}),
    ...(opts.ignore?.length ? { ignore: opts.ignore } : {}),
  };
  const unknown = opts.ignore?.filter((s) => !layout.slots.some((x) => x.name === s));
  if (unknown?.length) throw new Error(`CLI_FIT_SLOTS: no slot ${unknown.join(", ")}`);
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  if (typeof references === "string") {
    const result = fitRestPose(document, animation, decoded[0]!.image, texture, options);
    // Placements only serve key poses (ADR-033); the rest-pose file keeps its fields.
    const written: Partial<typeof result> = { ...result };
    delete written.placements;
    await writeFile(outPath, JSON.stringify({ animation, ...written }, null, 1), {
      encoding: "utf8",
      flag: "wx",
    });
    return {
      output: outPath,
      animation,
      bones: Object.keys(result.pose).length,
      parts: result.parts.length,
      used: result.parts.filter((p) => p.used).length,
      coverage: result.coverage,
      residual: result.residual,
    };
  }
  const fit = fitKeyPoses(document, animation, decoded, texture, {
    ...options,
    fps: plan.motion.fps ?? 30,
    ...(opts.minCoverage !== undefined ? { minCoverage: opts.minCoverage } : {}),
    ...(opts.zeroFrame !== undefined ? { zeroFrame: opts.zeroFrame } : {}),
  });
  const keyposes = fit.keyposes.length
    ? addKeyposes(planned.keyposes, fit.keyposes, planned.frames, loop, opts.ease)
    : (planned.keyposes ?? []);
  await writeFile(
    outPath,
    JSON.stringify(
      { animation, keyposes, frames: fit.frames, ...(fit.zero ? { zero: fit.zero } : {}) },
      null,
      1,
    ),
    { encoding: "utf8", flag: "wx" },
  );
  return {
    output: outPath,
    animation,
    keyposes: keyposes.length,
    bones: new Set(keyposes.flatMap((k) => Object.keys(k.pose))).size,
    ...(fit.zero
      ? {
          zero: { frame: fit.zero.frame, coverage: fit.zero.coverage, residual: fit.zero.residual },
        }
      : {}),
    // Parts the bones' fit does not explain: a bent mesh, another drawing, a hidden part.
    frames: fit.frames.map((f) => {
      const unused = f.parts.filter((p) => !p.used).map((p) => p.slot);
      return {
        frame: f.frame,
        accepted: f.accepted,
        coverage: f.coverage,
        residual: f.residual,
        ...(unused.length ? { unused } : {}),
      };
    }),
  };
}

/** ffmpeg filter text: escape the characters drawtext treats specially. */
const drawtextValue = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
/**
 * review-video <plan.json> <build-dir> [<artist.json>] <new-video.mp4>: one video per plan, every
 * animation as artist | build (or the build alone), first with the mesh wireframe, then with the
 * bones, then the plain motion (the official 4.0 runtime, plan.qa.view). Needs ffmpeg on PATH; captions use --font
 * (default: Microsoft JhengHei on Windows) and are skipped without a font.
 */
export async function reviewVideoFiles(
  planPath: string,
  buildDir: string,
  artistPath: string | undefined,
  outPath: string,
  opts: { loops?: number; height?: number; font?: string } = {},
) {
  if (existsSync(outPath))
    throw new Error(`CLI_OUTPUT_EXISTS: ${outPath} already exists; choose a new file name`);
  const plan = await readPlan(planPath);
  const paths = planPaths(planPath, plan);
  const generated = JSON.parse(
    await readFile(join(buildDir, `${plan.id}.json`), "utf8"),
  ) as unknown;
  const tex = textures(paths.images);
  // Without an artist file the video shows the build alone.
  const sides = artistPath
    ? [
        loadSkeleton(JSON.parse(await readFile(artistPath, "utf8")) as unknown),
        loadSkeleton(generated),
      ]
    : [loadSkeleton(generated)];
  const sk = (sides[0]!.raw.skeleton ?? {}) as Record<string, number>;
  const v = plan.qa?.view ?? {
    x: sk.x ?? -500,
    y: (sk.y ?? -500) + (sk.height ?? 1000),
    width: sk.width ?? 1000,
    height: sk.height ?? 1000,
  };
  const tileHeight = opts.height ?? 540,
    scale = tileHeight / v.height;
  const view = {
    x0: v.x,
    y0: v.y,
    scale,
    width: Math.round((v.width * scale) / 2) * 2,
    height: Math.round(tileHeight / 2) * 2,
  };
  const head = 56;
  const font =
    opts.font ?? (process.platform === "win32" ? "C:/Windows/Fonts/msjh.ttc" : undefined);
  const captions = font && existsSync(font);
  const labels: { text: string; x: string; y: number; size: number; from?: number; to?: number }[] =
    [];
  const reviews = plan.motion.animations.map((a) =>
    reviewFrames(sides, tex.texture, view, a.name, opts.loops ? { loops: opts.loops } : {}),
  );
  const width = reviews[0]!.width;
  let t0 = 0;
  const names = { wireframe: "1 佈線", bones: "2 骨架", motion: "3 完整動態" } as const;
  plan.motion.animations.forEach((a, k) => {
    const r = reviews[k]!,
      length = (3 * r.loops * r.frames) / r.fps;
    for (const s of ["wireframe", "bones", "motion"] as const) {
      const from = t0 + r.segmentStart(s),
        to = from + (r.loops * r.frames) / r.fps;
      labels.push({
        text: `${a.name}   ${names[s]}`,
        x: "(w-text_w)/2",
        y: 14,
        size: 26,
        from,
        to,
      });
    }
    t0 += length;
  });
  // Side labels sit inside each tile's top-left corner, under the segment title band.
  if (artistPath) {
    labels.push({ text: "人工", x: "12", y: head + 10, size: 22 });
    labels.push({ text: "AutoSpine", x: String(view.width + 16), y: head + 10, size: 22 });
  }
  const filters = captions
    ? labels
        .map(
          (l) =>
            `drawtext=fontfile='${drawtextValue(font!)}':text='${drawtextValue(l.text)}':x=${l.x}:y=${l.y}:fontsize=${l.size}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6` +
            (l.from !== undefined
              ? `:enable='between(t,${l.from.toFixed(3)},${l.to!.toFixed(3)})'`
              : ""),
        )
        .join(",")
    : "null";
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  const ffmpeg = spawn(
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
      `${width}x${view.height + head}`,
      "-r",
      String(reviews[0]!.fps),
      "-i",
      "-",
      "-vf",
      filters,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      resolve(outPath),
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<number>((ok, fail) => {
    ffmpeg.on("error", (e) =>
      fail(new Error(`CLI_FFMPEG: ffmpeg is needed on PATH for review videos (${e.message})`)),
    );
    ffmpeg.on("close", (code) => ok(code ?? 1));
  });
  const write = (b: Uint8Array) =>
    new Promise<void>((ok) => (ffmpeg.stdin.write(b) ? ok() : ffmpeg.stdin.once("drain", ok)));
  let frames = 0;
  const band = new Uint8Array(width * head * 3);
  for (let i = 0; i < band.length; i += 3) band.set([24, 27, 34], i);
  for (const r of reviews)
    for (const { raster } of r.play()) {
      await write(band);
      await write(raster.rgb);
      frames++;
    }
  ffmpeg.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`CLI_FFMPEG: ffmpeg failed (${code}): ${stderr.slice(-400)}`);
  return {
    output: outPath,
    frames,
    seconds: +(frames / reviews[0]!.fps).toFixed(2),
    width,
    height: view.height + head,
    captions: Boolean(captions),
    animations: plan.motion.animations.map((a) => a.name),
  };
}

/** Characters a Windows or macOS file name cannot hold. */
const safeFileName = (name: string) =>
  [...name]
    .map((c) => (/[\\/:*?"<>|]/.test(c) || c.charCodeAt(0) < 32 ? "_" : c))
    .join("")
    .trim() || "character";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch {
    // Across drives: copy, then remove the original.
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}
/** The Spine editor's command line: --spine, AUTOSPINE_SPINE, then the default install. */
export function spineExecutable(explicit?: string): string | undefined {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`CLI_SPINE: ${explicit} not found`);
    return explicit;
  }
  const candidates = [
    process.env.AUTOSPINE_SPINE,
    process.platform === "win32" ? "C:\\Program Files\\Spine\\Spine.com" : undefined,
    process.platform === "darwin" ? "/Applications/Spine.app/Contents/MacOS/Spine" : undefined,
  ];
  return candidates.find((c): c is string => !!c && existsSync(c));
}
/** Images folder as a skeleton `images` path relative to the delivered project. */
function imagesReference(from: string, images: string) {
  const rel = relative(from, images);
  if (isAbsolute(rel)) return images.split(sep).join("/") + "/"; // another drive
  const posix = rel.split(sep).join("/");
  return (posix === "" ? "." : posix.startsWith(".") ? posix : `./${posix}`) + "/";
}
function runSpine(exe: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((ok) => {
    let output = "";
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      ok({ code: -1, output: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      ok({ code: code ?? -1, output });
    });
  });
}

export interface DeliverOptions {
  /** File name without extension; default the plan id. */
  name?: string;
  /** The images folder the project points at; default the plan's (`source.images`). */
  images?: string;
  /** Spine editor executable; default AUTOSPINE_SPINE or the standard install. */
  spine?: string;
  /** Swap an earlier delivery for this build; the old files move into the build folder. */
  replace?: boolean;
  /** Replace even a project that was saved after it was delivered (edited in Spine). */
  force?: boolean;
  /** Render the review video (default true). */
  video?: boolean;
}
/**
 * deliver <plan.json> <build-dir> <delivery-dir> [<artist.json>]: the requester's folder gets only
 * `<name>.spine` (imported with the Spine command line, pointing at the original images folder)
 * and `<name>.mp4` (the review video, artist | build when an artist file is given). Plans, builds,
 * comparisons and every other working file stay where they are. Without the Spine editor the
 * project is delivered as `<name>.json` for Import Data instead.
 */
export async function deliverFiles(
  planPath: string,
  buildDir: string,
  deliveryDir: string,
  artistPath: string | undefined,
  opts: DeliverOptions = {},
) {
  const plan = await readPlan(planPath);
  const name = safeFileName(opts.name ?? plan.id);
  const images = resolve(opts.images ?? planPaths(planPath, plan).images);
  if (!(await exists(images))) throw new Error(`CLI_DELIVER_IMAGES: ${images} not found`);
  const document = JSON.parse(await readFile(join(buildDir, `${plan.id}.json`), "utf8")) as {
    skeleton: Record<string, unknown>;
  };
  const out = resolve(deliveryDir);
  const target = {
    spine: join(out, `${name}.spine`),
    json: join(out, `${name}.json`),
    video: join(out, `${name}.mp4`),
  };
  const present = Object.values(target).filter((p) => existsSync(p));
  if (present.length && !opts.replace)
    throw new Error(
      `CLI_OUTPUT_EXISTS: ${present.join(", ")} already delivered; pass --replace to swap in this build (the old files move into the build folder)`,
    );
  // The project and its video are written together; a project saved later was edited in Spine.
  if (present.length && !opts.force && existsSync(target.spine) && existsSync(target.video)) {
    const [project, video] = await Promise.all([stat(target.spine), stat(target.video)]);
    if (project.mtimeMs > video.mtimeMs + 120_000)
      throw new Error(
        `CLI_DELIVER_EDITED: ${target.spine} was saved after it was delivered, probably edited in Spine; keep those edits, or pass --force to replace it anyway`,
      );
  }
  // Render first, in the build folder: a missing ffmpeg leaves the delivery folder untouched.
  let staged: string | undefined;
  if (opts.video !== false) {
    staged = join(resolve(buildDir), `delivery-${stamp()}.mp4`);
    await reviewVideoFiles(planPath, buildDir, artistPath, staged);
  }
  let replaced: string | undefined;
  if (present.length) {
    replaced = join(resolve(buildDir), `replaced-${stamp()}`);
    await mkdir(replaced, { recursive: true });
    for (const p of present) await moveFile(p, join(replaced, basename(p)));
  }
  await mkdir(out, { recursive: true });
  document.skeleton = { ...document.skeleton, images: imagesReference(out, images) };
  const result: {
    spine: string | null;
    json: string | null;
    video: string | null;
    images: string;
    replaced: string | null;
    spineError?: string;
  } = {
    spine: null,
    json: null,
    video: null,
    images: String(document.skeleton.images),
    replaced: replaced ?? null,
  };
  const exe = spineExecutable(opts.spine);
  if (exe) {
    // Imported from beside the project, so the relative images path means the same to both.
    const temp = join(out, `.${name}.autospine-import.json`);
    await writeFile(temp, JSON.stringify(document));
    try {
      const run = await runSpine(exe, ["-u", "4.0.64", "-i", temp, "-o", target.spine, "-r", name]);
      if (run.code === 0 && existsSync(target.spine)) result.spine = target.spine;
      else result.spineError = `Spine exited ${run.code}: ${run.output.trim().slice(-600)}`;
    } finally {
      await rm(temp, { force: true });
    }
  }
  if (!result.spine) {
    await writeFile(target.json, json(document));
    result.json = target.json;
  }
  if (staged) {
    await moveFile(staged, target.video);
    result.video = target.video;
  }
  return result;
}
