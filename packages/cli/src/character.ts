import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { Value } from "@sinclair/typebox/value";
import { CharacterPlanSchema, type CharacterPlan } from "@autospine/schemas";
import { readImagesOnlyLayout } from "@autospine/spine";
import {
  buildCharacter,
  compileCharacter,
  lintCharacterPlan,
  rigCharacter,
  type CharacterLayout,
  type CharacterPart,
  type Params,
} from "@autospine/character";
import {
  checkAcceptance,
  compareToReference,
  initialSearchState,
  loadSkeleton,
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
    return PNG.sync.read(bytes);
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
    const doc = compileCharacter(built.rigging, built.animations, flipped),
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
  for (const s of built.specs) await writeFile(join(outDir, `keypose-${s.name}.json`), json(s));
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
  const options = {
    probes,
    deformExclude: plan.qa?.deformExclude ?? [],
    alpha: tex.alpha,
    name: plan.name,
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
    await writeFile(join(outDir, `compare-${a}.png`), PNG.sync.write(png));
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
