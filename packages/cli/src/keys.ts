import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  comparePlayback,
  loadSkeleton,
  readTimelines,
  reduceSpineKeys,
  reviewFrames,
  samplePose,
  type KeyReductionMode,
  type KeyReductionOptions,
  type KeyReductionReport,
  type PlaybackDifference,
} from "@autospine/reference";
import {
  drawtextValue,
  json,
  newDirectory,
  runSpine,
  sha256,
  spineExecutable,
  textures,
} from "./character.js";

type Raw = Record<string, unknown>;
export interface ReduceKeysFileOptions extends Omit<
  KeyReductionOptions,
  "mode" | "baseline" | "maxError" | "rmsError"
> {
  /** Modes to run, each into its own folder (default both). */
  modes?: KeyReductionMode[];
  /** Limits per mode, skeleton px (default: by mode from the skeleton's size). */
  limits?: Partial<Record<KeyReductionMode, { maxError?: number; rmsError?: number }>>;
  /** The untouched original of an earlier reduction (.json, or .spine with the editor). */
  baseline?: string;
  /** Spine editor executable; false: no import or export (JSON input only, no formal check). */
  spine?: string | false;
  /** Editor version for import and export (default the source's, else 4.0.64). */
  spineVersion?: string;
  /** Images for the preview (default the source's `skeleton.images` beside the input). */
  images?: string;
  /** Render the preview video (needs ffmpeg and the images; default true). */
  video?: boolean;
  font?: string;
  /** Preview tile height, px (default 480). */
  height?: number;
}
const MODE_NAMES: Record<KeyReductionMode, string> = {
  fidelity: "保真精簡",
  posable: "可編修姿勢",
};
const EXPORT_SETTINGS = {
  class: "export-json",
  extension: ".json",
  format: "JSON",
  prettyPrint: true,
  nonessential: true,
  cleanUp: false,
  packAtlas: null,
  warnings: true,
};

/** Exports a .spine project to JSON with the editor; returns the JSON path. */
async function exportProject(exe: string, version: string, project: string, outDir: string) {
  await mkdir(outDir, { recursive: true });
  const settings = join(outDir, ".autospine-export.json");
  await writeFile(settings, JSON.stringify(EXPORT_SETTINGS));
  try {
    const run = await runSpine(exe, ["-u", version, "-i", project, "-o", outDir, "-e", settings]);
    const files = (await readdir(outDir)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    if (run.code !== 0 || files.length !== 1)
      throw new Error(
        `CLI_SPINE: export of ${project} failed (${run.code}): ${run.output.trim().slice(-600)}`,
      );
    return { json: join(outDir, files[0]!), log: run.output.trim() };
  } finally {
    await rm(settings, { force: true });
  }
}
/** Imports JSON into a new .spine project with the editor. */
async function importProject(
  exe: string,
  version: string,
  jsonPath: string,
  project: string,
  name: string,
) {
  const run = await runSpine(exe, ["-u", version, "-i", jsonPath, "-o", project, "-r", name]);
  if (run.code !== 0 || !existsSync(project))
    throw new Error(
      `CLI_SPINE: import of ${jsonPath} failed (${run.code}): ${run.output.trim().slice(-600)}`,
    );
  return run.output.trim();
}

/** What a document holds: the features its keys exercise, for the coverage table. */
export function documentFeatures(doc: Raw) {
  const anims = (doc.animations ?? {}) as Record<string, Raw>;
  const kinds = new Map<string, number>();
  const add = (k: string, n: number) => kinds.set(k, (kinds.get(k) ?? 0) + n);
  let stepped = 0,
    bezier = 0,
    linear = 0,
    subFrame = 0,
    multiTurn = 0;
  const fps =
    typeof (doc.skeleton as Raw)?.fps === "number" ? ((doc.skeleton as Raw).fps as number) : 30;
  const walk = (keys: Raw[]) => {
    for (const k of keys) {
      if (k.curve === "stepped") stepped++;
      else if (Array.isArray(k.curve)) bezier++;
      else linear++;
      const f = ((k.time as number) ?? 0) * fps;
      if (Math.abs(f - Math.round(f)) > 0.02) subFrame++;
    }
  };
  for (const a of Object.values(anims)) {
    for (const b of Object.values((a.bones ?? {}) as Record<string, Record<string, Raw[]>>))
      for (const [p, keys] of Object.entries(b)) {
        add(`bone ${p}`, keys.length);
        walk(keys);
        if (p === "rotate") {
          const v = keys.map((k) => (k.value as number) ?? 0);
          if (Math.max(...v) - Math.min(...v) > 360) multiTurn++;
        }
      }
    for (const s of Object.values((a.slots ?? {}) as Record<string, Record<string, Raw[]>>))
      for (const [p, keys] of Object.entries(s)) {
        add(`slot ${p}`, keys.length);
        if (p !== "attachment") walk(keys);
      }
    for (const [k, label] of [
      ["ik", "ik"],
      ["transform", "transform"],
    ] as const)
      for (const keys of Object.values((a[k] ?? {}) as Record<string, Raw[]>)) {
        add(label, keys.length);
        walk(keys);
      }
    for (const p of Object.values((a.path ?? {}) as Record<string, Record<string, Raw[]>>))
      for (const [q, keys] of Object.entries(p)) {
        add(`path ${q}`, keys.length);
        walk(keys);
      }
    for (const sk of Object.values(
      (a.deform ?? {}) as Record<string, Record<string, Record<string, Raw[]>>>,
    ))
      for (const sl of Object.values(sk))
        for (const keys of Object.values(sl)) {
          add("deform", keys.length);
          walk(keys);
        }
    if (a.drawOrder) add("drawOrder", (a.drawOrder as Raw[]).length);
    if (a.events) add("events", (a.events as Raw[]).length);
  }
  let regions = 0,
    meshes = 0,
    weighted = 0,
    linked = 0,
    clipping = 0,
    other = 0;
  for (const skin of (doc.skins ?? []) as { attachments?: Record<string, Record<string, Raw>> }[])
    for (const atts of Object.values(skin.attachments ?? {}))
      for (const att of Object.values(atts)) {
        const t = (att.type as string) ?? "region";
        if (t === "region") regions++;
        else if (t === "mesh") {
          meshes++;
          if ((att.vertices as number[]).length !== (att.uvs as number[]).length) weighted++;
        } else if (t === "linkedmesh") linked++;
        else if (t === "clipping") clipping++;
        else other++;
      }
  return {
    spine: String((doc.skeleton as Raw)?.spine ?? "unknown"),
    fps,
    bones: (doc.bones as unknown[]).length,
    slots: (doc.slots as unknown[]).length,
    ik: ((doc.ik ?? []) as unknown[]).length,
    transform: ((doc.transform ?? []) as unknown[]).length,
    path: ((doc.path ?? []) as unknown[]).length,
    attachments: { regions, meshes, weighted, linked, clipping, other },
    animations: Object.keys(anims).map((n) => ({
      name: n,
      duration: readTimelines(doc, n).duration,
    })),
    keys: Object.fromEntries([...kinds.entries()].sort()),
    curves: { stepped, bezier, linear, subFrame, multiTurn },
  };
}

/**
 * reduce-keys <input.json|input.spine> <new-output-dir>: key reduction (ADR-044) in both modes,
 * each checked on the official runtime against the untouched source; with the Spine editor, each
 * result is imported into a new project and exported again, and that export is checked too. The
 * source file is never written (its SHA-256 is compared before and after). Writes per mode the
 * JSON, the project, the report; a preview video original | fidelity | posable; an HTML report.
 */
export async function reduceKeysFiles(
  inputPath: string,
  outDir: string,
  opts: ReduceKeysFileOptions = {},
) {
  const input = resolve(inputPath),
    out = resolve(outDir);
  const before = sha256(await readFile(input));
  await newDirectory(out);
  const isProject = extname(input).toLowerCase() === ".spine";
  const exe = opts.spine === false ? undefined : spineExecutable(opts.spine || undefined);
  if (isProject && !exe)
    throw new Error(
      "CLI_SPINE: a .spine input needs the Spine editor (--spine=exe or AUTOSPINE_SPINE)",
    );
  const version = opts.spineVersion ?? "4.0.64";
  const notes: string[] = [];
  // The source as JSON, in the output folder.
  let sourceJson: string;
  if (isProject) {
    const exported = await exportProject(exe!, version, input, join(out, "source"));
    sourceJson = exported.json;
    // What the editor leaves out of any JSON export (and so out of every project made from it).
    const lines = exported.log.split(/\r?\n/);
    for (const l of lines.filter((x) => /not exported/i.test(x)))
      notes.push(`Spine 匯出未包含（原專案設定，任何 JSON 路徑都無法保留）：${l.trim()}`);
    const missing = lines.filter((x) => /is not in skeleton/i.test(x)).length;
    if (missing)
      notes.push(
        `Spine 匯出時列出 ${missing} 則「Bone is not in skeleton」警告（原專案狀態，與 Key 精簡無關）。`,
      );
  } else {
    await mkdir(join(out, "source"), { recursive: true });
    sourceJson = join(out, "source", basename(input));
    await copyFile(input, sourceJson);
  }
  const source = JSON.parse(await readFile(sourceJson, "utf8")) as Raw;
  const name = basename(sourceJson, ".json");
  const spineVersion = String((source.skeleton as Raw)?.spine ?? "");
  if (!spineVersion.startsWith("4.0"))
    throw new Error(
      `CLI_KEYS_VERSION: the source is Spine ${spineVersion || "unknown"}; key reduction reads Spine 4.0 data`,
    );
  let baseline: Raw | undefined;
  if (opts.baseline) {
    const b = resolve(opts.baseline);
    const path =
      extname(b).toLowerCase() === ".spine"
        ? exe
          ? (await exportProject(exe, version, b, join(out, "baseline"))).json
          : undefined
        : b;
    if (!path) throw new Error("CLI_SPINE: a .spine baseline needs the Spine editor");
    baseline = JSON.parse(await readFile(path, "utf8")) as Raw;
  }
  const features = documentFeatures(source);
  const modes = opts.modes ?? (["fidelity", "posable"] as KeyReductionMode[]);
  const runs: {
    mode: KeyReductionMode;
    json: string;
    spine: string | null;
    report: KeyReductionReport;
    formal: { vsReduced: PlaybackDifference[]; vsSource: PlaybackDifference[] } | null;
    /** Everything but the animations is byte-identical to the source (JSON; and after the editor). */
    setup: { json: boolean; editor: boolean | null };
    seconds: number;
  }[] = [];
  const roundTrips = new Map<string, Raw>();
  const {
    modes: _m,
    limits,
    baseline: _b,
    spine: _s,
    spineVersion: _v,
    images: _i,
    video: _vi,
    font: _f,
    height: _h,
    ...engine
  } = opts;
  void [_m, _b, _s, _v, _i, _vi, _f, _h];
  for (const mode of modes) {
    const dir = join(out, mode);
    await mkdir(dir, { recursive: true });
    const t0 = Date.now();
    const { document, report } = reduceSpineKeys(source, {
      ...engine,
      mode,
      ...(limits?.[mode]?.maxError !== undefined ? { maxError: limits[mode]!.maxError } : {}),
      ...(limits?.[mode]?.rmsError !== undefined ? { rmsError: limits[mode]!.rmsError } : {}),
      ...(baseline ? { baseline } : {}),
    });
    const seconds = (Date.now() - t0) / 1000;
    const jsonPath = join(dir, `${name}.json`);
    await writeFile(jsonPath, json(document));
    let spine: string | null = null,
      formal: (typeof runs)[number]["formal"] = null;
    if (exe) {
      // The formal output: import into a new project, export again, play both against the source.
      spine = join(dir, `${name}.spine`);
      await importProject(exe, version, jsonPath, spine, name);
      const back = JSON.parse(
        await readFile(
          (await exportProject(exe, version, spine, join(dir, "roundtrip"))).json,
          "utf8",
        ),
      ) as Raw;
      formal = {
        vsReduced: comparePlayback(document, back, { fps: report.fps }),
        vsSource: comparePlayback(source, back, { fps: report.fps }),
      };
      roundTrips.set(mode, back);
    }
    const setup = { json: setupOf(document) === setupOf(source), editor: null };
    await writeFile(join(dir, "key-report.json"), json({ ...report, formal, setup }));
    runs.push({ mode, json: jsonPath, spine, report, formal, setup, seconds });
  }
  // The editor's own round trip of the untouched source, for scale.
  let sourceRoundTrip: PlaybackDifference[] | null = null;
  if (exe) {
    const dir = join(out, "roundtrip-source");
    await mkdir(dir, { recursive: true });
    const project = join(dir, `${name}.spine`);
    await importProject(exe, version, sourceJson, project, name);
    const back = JSON.parse(
      await readFile(
        (await exportProject(exe, version, project, join(dir, "export"))).json,
        "utf8",
      ),
    ) as Raw;
    sourceRoundTrip = comparePlayback(source, back);
    // The editor writes the setup its own way: compare each mode's export with the source's export.
    for (const r of runs) r.setup.editor = setupOf(roundTrips.get(r.mode)!) === setupOf(back);
  } else notes.push("Spine 編輯器不可用：未做正式匯入／匯出驗證。");
  // Preview: original | each mode.
  let preview: string | null = null;
  if (opts.video !== false) {
    const images = resolve(
      opts.images ??
        resolve(dirname(input), String((source.skeleton as Raw)?.images ?? "./images/")),
    );
    try {
      preview = join(out, "preview.mp4");
      await previewVideo(
        [
          { label: "原始", doc: source },
          ...runs.map((r) => ({ label: MODE_NAMES[r.mode], doc: readJsonSync(r) })),
        ],
        images,
        preview,
        opts,
      );
    } catch (e) {
      notes.push(`未產生預覽影片：${e instanceof Error ? e.message : String(e)}`);
      preview = null;
    }
  }
  const after = sha256(await readFile(input));
  if (after !== before) throw new Error(`CLI_KEYS_SOURCE: ${input} changed during the run`);
  const summary = {
    input,
    sha256: before,
    sourceUnchanged: true,
    spine: exe ? version : null,
    features,
    runs: runs.map((r) => ({
      mode: r.mode,
      json: r.json,
      spine: r.spine,
      seconds: r.seconds,
      keys: r.report.keys,
      pass: r.report.pass,
      limits: r.report.limits,
      formal: r.formal,
      setup: r.setup,
    })),
    sourceRoundTrip,
    preview,
    notes,
  };
  await writeFile(join(out, "summary.json"), json(summary));
  await writeFile(join(out, "key-reduction-report.html"), reportHtml(summary, runs, source, out));
  await writeFile(join(out, "key-reduction-report.md"), reportMarkdown(summary, runs));
  return summary;
}
/**
 * The document without its animations: skeleton, bones, slots, constraints, skins, events. The
 * editor's `skeleton.hash` covers the animations too, so it is left out.
 */
const setupOf = (d: Raw) =>
  JSON.stringify(
    Object.entries(d)
      .filter(([k]) => k !== "animations")
      .map(([k, v]) => (k === "skeleton" ? [k, { ...(v as Raw), hash: undefined }] : [k, v])),
  );

/**
 * Features a key reduction must handle, whether this file has them, and the synthetic test that
 * covers them either way (tests/key-reduction.test.ts).
 */
function coverage(f: ReturnType<typeof documentFeatures>) {
  const has = (k: string) => Object.keys(f.keys).some((x) => x.startsWith(k));
  return [
    ["Bezier 曲線", f.curves.bezier > 0, "fidelity: refitted Beziers; runtime parity"],
    ["stepped（含跳變與停頓）", f.curves.stepped > 0, "protects steps, swaps…"],
    ["次幀 Key", f.curves.subFrame > 0, "posable: sub-frame turns keep their time"],
    ["超過一圈的旋轉", f.curves.multiTurn > 0, "multi-turn and ±180°"],
    ["骨骼 rotate/translate/scale/shear", has("bone"), "fidelity / posable / constant channels"],
    ["加權網格 Deform", f.attachments.weighted > 0 && has("deform"), "deform: offsets and weights"],
    ["非加權網格 Deform", has("deform"), "deform: fold-back keeps a key"],
    ["換圖（attachment）", has("slot attachment"), "protects steps, swaps…"],
    [
      "顏色（rgba）",
      has("slot rgba") || has("slot rgb") || has("slot alpha"),
      "protects steps… (slot rgba)",
    ],
    ["Draw order", has("drawOrder"), "protects steps, swaps, draw order"],
    ["Events", has("events"), "protects … events"],
    ["IK timeline（含 bend 切換）", has("ik"), "protects … IK bend switch"],
    ["Transform timeline", has("transform"), "protects … (transform:tc)"],
    ["Path timeline", has("path"), "protects … (path:pc/position)"],
    ["IK／Transform 約束（setup）", f.ik + f.transform > 0, "world check plays every constraint"],
    ["跟隨部件延遲", true, "posable: follow parts keep their lag"],
    ["循環接縫", true, "fidelity: seam unchanged"],
    ["誤差回退", true, "falls back past the budget"],
    ["重複執行不累積", true, "deterministic; baseline"],
  ] as const;
}

const docs = new Map<string, Raw>();
/** A reduced document by its path (written above; read once). */
function readJsonSync(r: { json: string }): Raw {
  let doc = docs.get(r.json);
  if (!doc) docs.set(r.json, (doc = JSON.parse(readFileSync(r.json, "utf8")) as Raw));
  return doc;
}

/** Side-by-side preview of every animation (wireframe, bones, plain motion), one video. */
async function previewVideo(
  sides: { label: string; doc: Raw }[],
  images: string,
  outPath: string,
  opts: { height?: number; font?: string },
) {
  if (!existsSync(images)) throw new Error(`找不到圖片資料夾 ${images}`);
  const tex = textures(images);
  const loaded = sides.map((s) => loadSkeleton(s.doc));
  // Each animation framed on what the original actually draws in it (the stored bounds can be
  // stale, and one animation's effects should not shrink the others), in tiles of one size.
  const animations = Object.keys((sides[0]!.doc.animations ?? {}) as Raw);
  const bounds = animations.map((a) => {
    let lx = Infinity,
      ly = Infinity,
      hx = -Infinity,
      hy = -Infinity;
    const d = readTimelines(sides[0]!.doc, a).duration;
    for (let k = 0; k <= 12; k++) {
      const p = samplePose(loaded[0]!, a, Math.min(d - 1e-5, (d * k) / 12));
      p.verts.forEach((v, si) => {
        if (!v || p.alpha[si]! <= 0.002) return;
        for (let i = 0; i + 1 < v.length; i += 2) {
          [lx, hx] = [Math.min(lx, v[i]!), Math.max(hx, v[i]!)];
          [ly, hy] = [Math.min(ly, v[i + 1]!), Math.max(hy, v[i + 1]!)];
        }
      });
    }
    const pad = Math.max(hx - lx, hy - ly) * 0.04;
    return { lx: lx - pad, ly: ly - pad, hx: hx + pad, hy: hy + pad };
  });
  const tileHeight = Math.round((opts.height ?? 480) / 2) * 2;
  const aspect = Math.min(
    1.6,
    Math.max(0.5, ...bounds.map((b) => (b.hx - b.lx) / Math.max(1e-6, b.hy - b.ly))),
  );
  const tileWidth = Math.round((tileHeight * aspect) / 2) * 2;
  const reviews = animations.map((a, k) => {
    const b = bounds[k]!;
    const scale = Math.min(tileWidth / (b.hx - b.lx), tileHeight / (b.hy - b.ly));
    const view = {
      x0: (b.lx + b.hx) / 2 - tileWidth / 2 / scale,
      y0: (b.ly + b.hy) / 2 + tileHeight / 2 / scale,
      scale,
      width: tileWidth,
      height: tileHeight,
    };
    return reviewFrames(loaded, tex.texture, view, a);
  });
  const view = { width: tileWidth, height: tileHeight };
  const head = 52;
  const width = reviews[0]!.width;
  const font =
    opts.font ?? (process.platform === "win32" ? "C:/Windows/Fonts/msjh.ttc" : undefined);
  const labels: { text: string; x: string; y: number; size: number; from?: number; to?: number }[] =
    [];
  const segName = { wireframe: "網格", bones: "骨架", motion: "動態" } as const;
  let t0 = 0;
  animations.forEach((a, k) => {
    const r = reviews[k]!;
    for (const s of ["wireframe", "bones", "motion"] as const) {
      const from = t0 + r.segmentStart(s);
      labels.push({
        text: `${a}   ${segName[s]}`,
        x: "(w-text_w)/2",
        y: 12,
        size: 24,
        from,
        to: from + (r.loops * r.frames) / r.fps,
      });
    }
    t0 += (3 * r.loops * r.frames) / r.fps;
  });
  sides.forEach((s, i) =>
    labels.push({ text: s.label, x: String(i * (view.width + 4) + 12), y: head + 8, size: 20 }),
  );
  const filters =
    font && existsSync(font)
      ? labels
          .map(
            (l) =>
              `drawtext=fontfile='${drawtextValue(font)}':text='${drawtextValue(l.text)}':x=${l.x}:y=${l.y}:fontsize=${l.size}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6` +
              (l.from !== undefined
                ? `:enable='between(t,${l.from.toFixed(3)},${l.to!.toFixed(3)})'`
                : ""),
          )
          .join(",")
      : "null";
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
      "30",
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
      outPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<number>((ok, fail) => {
    ffmpeg.on("error", (e) => fail(new Error(`需要 ffmpeg（${e.message}）`)));
    ffmpeg.on("close", (code) => ok(code ?? 1));
  });
  const write = (b: Uint8Array) =>
    new Promise<void>((ok) => (ffmpeg.stdin.write(b) ? ok() : ffmpeg.stdin.once("drain", ok)));
  const band = new Uint8Array(width * head * 3);
  for (let i = 0; i < band.length; i += 3) band.set([24, 27, 34], i);
  for (const r of reviews)
    for (const { raster } of r.play()) {
      await write(band);
      await write(raster.rgb);
    }
  ffmpeg.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`ffmpeg 失敗 (${code}): ${stderr.slice(-400)}`);
}

type Summary = Awaited<ReturnType<typeof reduceKeysFiles>>;
type Run = {
  mode: KeyReductionMode;
  report: KeyReductionReport;
  formal: { vsReduced: PlaybackDifference[]; vsSource: PlaybackDifference[] } | null;
  setup: { json: boolean; editor: boolean | null };
  json: string;
};
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
const pct = (a: number, b: number) => (b ? `${(((b - a) / b) * 100).toFixed(1)}%` : "—");
const yes = (ok: boolean) => (ok ? `<b class="ok">通過</b>` : `<b class="bad">未通過</b>`);

/** Key times of every timeline of an animation, for the dope sheet. */
function keyTimes(doc: Raw, anim: string): Map<string, number[]> {
  const t = readTimelines(doc, anim);
  return new Map(t.curves.map((c) => [c.id, c.times]));
}
function dopeSheet(source: Raw, runs: Run[], anim: string, fps: number): string {
  const orig = keyTimes(source, anim);
  const reduced = runs.map((r) => keyTimes(readJsonSync(r), anim));
  const duration = readTimelines(source, anim).duration;
  // Moving timelines only (constant ones become one key and say nothing about poses).
  const ids = [...orig.keys()].filter((id) => {
    const tl = readTimelines(source, anim).curves.find((c) => c.id === id)!;
    return tl.values.some((v) => v.some((x, j) => Math.abs(x - tl.values[0]![j]!) > 1e-6));
  });
  const W = 760,
    left = 210,
    rowH = 5 * (1 + runs.length) + 6;
  const frames = Math.max(1, Math.round(duration * fps));
  const x = (t: number) => left + (t / Math.max(duration, 1e-6)) * (W - left - 10);
  const colors = ["#8a8f98", "#3b82f6", "#f59e0b"];
  let svg = `<svg viewBox="0 0 ${W} ${ids.length * rowH + 24}" width="100%" role="img" aria-label="${esc(anim)} key 分佈">`;
  for (let f = 0; f <= frames; f += Math.max(1, Math.round(frames / 20)))
    svg += `<line x1="${x(f / fps)}" x2="${x(f / fps)}" y1="0" y2="${ids.length * rowH + 6}" class="grid"/><text x="${x(f / fps)}" y="${ids.length * rowH + 20}" class="tick">${f}</text>`;
  ids.forEach((id, r) => {
    const y = r * rowH + 4;
    svg += `<text x="4" y="${y + rowH / 2 + 2}" class="lab">${esc(id.replace(/^bone:|^deform:default\//, ""))}</text>`;
    [orig.get(id)!, ...reduced.map((m) => m.get(id) ?? [])].forEach((ts, k) => {
      for (const t of ts)
        svg += `<rect x="${(x(t) - 1.5).toFixed(1)}" y="${y + k * 5}" width="3" height="4" fill="${colors[k]}"/>`;
    });
  });
  return svg + "</svg>";
}

function reportHtml(summary: Summary, runs: Run[], source: Raw, out: string): string {
  const f = summary.features;
  const anims = f.animations;
  const rows = (r: Run) =>
    r.report.animations
      .map(
        (a) =>
          `<tr><td>${esc(a.name)}</td><td>${a.loop ? "循環" : "單次"}</td><td>${a.keys.before}</td><td>${a.keys.after}</td><td>${pct(a.keys.after, a.keys.before)}</td><td>${a.keys.removedConstant}</td><td>${a.keys.removedMotion}</td><td>${a.world.max}</td><td>${a.world.rms}</td><td>${a.world.worstFrame}</td><td>${esc(a.world.worstSlot ?? "—")}</td><td>${a.insertions.length}</td><td>${a.fallbacks.length}</td><td>${a.discrete.stateMismatches + a.discrete.orderMismatches}</td><td>${yes(a.pass)}</td></tr>`,
      )
      .join("");
  const formalRows = (r: Run) =>
    r.formal
      ? r.formal.vsReduced
          .map((d, i) => {
            const s = r.formal!.vsSource[i]!;
            return `<tr><td>${esc(d.animation)}</td><td>${d.max}</td><td>${d.rms}</td><td>${d.stateMismatches}</td><td>${s.max}</td><td>${s.rms}</td><td>${d.duration[0]} / ${d.duration[1]}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7">未執行（Spine 編輯器不可用）</td></tr>`;
  const follow = (r: Run) =>
    r.report.animations
      .flatMap((a) =>
        a.follow.map(
          (c) =>
            `<tr><td>${esc(a.name)}</td><td>${esc(c.bone)}</td><td>${c.lagOriginal}</td><td>${c.lagReduced}</td><td>${c.maxShift ?? "轉折數不同"}</td><td>${c.peaksOriginal.join(", ")}</td></tr>`,
        ),
      )
      .join("") || `<tr><td colspan="6">沒有辨識出跟隨部件</td></tr>`;
  const poses = (r: Run) =>
    r.report.animations
      .map(
        (a) =>
          `<tr><td>${esc(a.name)}</td><td>${a.poses.map((p) => `${esc(p.label)} f${p.frame}（${p.error} px）`).join("、") || "—"}</td><td>${
            a.contacts
              .map((c) => `f${c.from}–${c.to} 滑動 ${c.slide} px（原 ${c.slideOriginal}）`)
              .join("；") || "無接地"
          }</td><td>${a.seam ? `姿勢差 ${a.seam.poseOriginal}→${a.seam.poseReduced} px；速度跳動 ${a.seam.velocityJumpOriginal}→${a.seam.velocityJumpReduced} px/幀` : "單次動作：保留原起訖"}</td></tr>`,
      )
      .join("");
  const groups = (r: Run) =>
    r.report.animations
      .map((a) => {
        const main = a.groups.filter((g) => g.role === "main");
        const fol = a.groups.filter((g) => g.role === "follow");
        return `<tr><td>${esc(a.name)}</td><td>${main.map((g) => `${esc(g.bones.join("+"))} @ ${g.frames.join(",")}`).join("<br>") || "—"}</td><td>${fol.map((g) => `${esc(g.bones.join("+"))}（晚 ${g.lagFrames} 幀）`).join("<br>") || "—"}</td></tr>`;
      })
      .join("");
  const timelineTable = (r: Run) =>
    r.report.animations
      .map(
        (a) =>
          `<details><summary>${esc(a.name)}：${a.timelines.length} 條通道</summary><table><thead><tr><th>通道</th><th>前</th><th>後</th><th>處理</th><th>通道容差</th><th>單位</th><th>補 Key</th><th>通道誤差</th><th>原因</th></tr></thead><tbody>${a.timelines
            .map(
              (t) =>
                `<tr><td>${esc(t.id)}</td><td>${t.before}</td><td>${t.after}</td><td>${t.status}</td><td>${t.tolerance}</td><td>${esc(t.unit)}</td><td>${t.inserted}</td><td>${t.channelError}</td><td>${esc(t.reason ?? "")}</td></tr>`,
            )
            .join("")}</tbody></table></details>`,
      )
      .join("");
  const notRun = [
    ...(summary.spine ? [] : ["正式 Spine 匯入／匯出驗證（編輯器不可用）"]),
    ...(summary.preview ? [] : ["對照預覽影片"]),
    "明顯穿插：沒有獨立的穿插偵測；兩部件間的相對位移不超過兩者最大頂點誤差之和（以頂點誤差界定）",
    "連續時間的數學保證：只保證已採樣的時間點",
    ...summary.notes,
  ];
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Key 精簡報告</title><style>
:root{--bg:#f7f7f5;--fg:#1d1f23;--mut:#666b73;--card:#fff;--line:#e2e2de;--ok:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e8e8e6;--mut:#9aa0a8;--card:#1f2228;--line:#30343b;--ok:#4ade80;--bad:#f87171}}
body{background:var(--bg);color:var(--fg);font:14px/1.55 "Microsoft JhengHei",system-ui,sans-serif;margin:0;padding:24px 16px}main{max-width:1200px;margin:auto}
h1{font-size:24px}h2{font-size:18px;margin-top:32px;border-bottom:1px solid var(--line);padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px;background:var(--card)}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}th{background:var(--line)}.ok{color:var(--ok)}.bad{color:var(--bad)}.mut{color:var(--mut)}
.wrap{overflow-x:auto}details{margin:6px 0}svg .grid{stroke:var(--line)}svg .tick,svg .lab{fill:var(--mut);font-size:8px}code{font-size:12px}
</style></head><body><main>
<h1>Key 精簡報告：${esc(basename(summary.input))}</h1>
<p class="mut">來源 SHA-256 <code>${summary.sha256}</code>，執行前後相同（來源未被寫入）。輸出資料夾：<code>${esc(out)}</code></p>
<h2>來源檔</h2>
<table><tr><th>Spine 版本</th><td>${esc(f.spine)}</td><th>FPS</th><td>${f.fps}</td><th>骨骼</th><td>${f.bones}</td><th>Slot</th><td>${f.slots}</td></tr>
<tr><th>IK／Transform／Path</th><td>${f.ik}／${f.transform}／${f.path}</td><th>附件</th><td colspan="5">region ${f.attachments.regions}、mesh ${f.attachments.meshes}（加權 ${f.attachments.weighted}）、linked ${f.attachments.linked}、clipping ${f.attachments.clipping}</td></tr>
<tr><th>動畫</th><td colspan="7">${anims.map((a) => `${esc(a.name)}（${a.duration} 秒）`).join("、")}</td></tr>
<tr><th>原始 Key</th><td colspan="7">${Object.entries(f.keys)
    .map(([k, n]) => `${esc(k)} ${n}`)
    .join("、")}</td></tr>
<tr><th>插值</th><td colspan="7">stepped ${f.curves.stepped}、bezier ${f.curves.bezier}、linear ${f.curves.linear}；次幀 Key ${f.curves.subFrame}；超過一圈的旋轉 ${f.curves.multiTurn}</td></tr></table>
<h2>測試覆蓋</h2>
<p class="mut">本檔沒有的功能由獨立測試資料（tests/key-reduction.test.ts 的合成骨架）覆蓋。</p>
<table><thead><tr><th>功能</th><th>本檔</th><th>獨立測試</th></tr></thead><tbody>${coverage(f)
    .map(([k, v, t]) => `<tr><td>${esc(k)}</td><td>${v ? "有" : "無"}</td><td>${esc(t)}</td></tr>`)
    .join("")}</tbody></table>
<h2>設定未變</h2>
<p>${runs
    .map(
      (r) =>
        `${MODE_NAMES[r.mode]}：JSON 除動畫外與原檔逐字相同 ${r.setup.json ? "是" : "<b class=bad>否</b>"}；經 Spine 匯入匯出後與原檔的匯入匯出相同 ${r.setup.editor === null ? "未執行" : r.setup.editor ? "是" : "<b class=bad>否</b>"}`,
    )
    .join("<br>")}</p>
<h2>容差與採樣</h2>
${runs
  .map(
    (r) =>
      `<p><b>${MODE_NAMES[r.mode]}</b>：世界頂點最大誤差 ≤ ${r.report.limits.maxError} px、RMS ≤ ${r.report.limits.rmsError} px（骨架高度 ${r.report.size} px 的 ${((r.report.limits.maxError / r.report.size) * 100).toFixed(2)}%／${((r.report.limits.rmsError / r.report.size) * 100).toFixed(2)}%）；通道預篩用最大誤差的 ${r.report.limits.localShare * 100}%，顏色 ${r.report.limits.colorTolerance.toFixed(4)}。</p>`,
  )
  .join("")}
<p class="mut">單位：${esc(runs[0]?.report.units.world ?? "")}。RMS：${esc(runs[0]?.report.units.rms ?? "")}。採樣：${esc(runs[0]?.report.sampling ?? "")}。容差不會為了刪除比例自動放寬。</p>
${runs
  .map(
    (
      r,
    ) => `<h2>${MODE_NAMES[r.mode]}（${r.mode}）：${r.report.keys.before} → ${r.report.keys.after} Key（少 ${pct(r.report.keys.after, r.report.keys.before)}）${yes(r.report.pass)}</h2>
<div class="wrap"><table><thead><tr><th>動畫</th><th>類型</th><th>前</th><th>後</th><th>減少</th><th>常數通道刪除</th><th>動作通道刪除</th><th>最大誤差 px</th><th>RMS px</th><th>最差幀</th><th>最差部件</th><th>補 Key</th><th>回退</th><th>離散不符</th><th>結果</th></tr></thead><tbody>${rows(r)}</tbody></table></div>
<h3>正式輸出（Spine ${esc(summary.spine ?? "—")} 匯入→匯出後再播放）</h3>
<div class="wrap"><table><thead><tr><th>動畫</th><th>對精簡 JSON 最大 px</th><th>RMS</th><th>離散不符</th><th>對原始最大 px</th><th>RMS</th><th>長度 前/後</th></tr></thead><tbody>${formalRows(r)}</tbody></table></div>
<h3>姿勢節點、接地與循環接縫</h3><div class="wrap"><table><thead><tr><th>動畫</th><th>姿勢節點（該時刻誤差）</th><th>接地／腳底滑動</th><th>循環接縫</th></tr></thead><tbody>${poses(r)}</tbody></table></div>
<h3>動作分組</h3><div class="wrap"><table><thead><tr><th>動畫</th><th>共用姿勢格（主要骨骼）</th><th>跟隨部件（保留延遲）</th></tr></thead><tbody>${groups(r)}</tbody></table></div>
<h3>跟隨相位</h3><div class="wrap"><table><thead><tr><th>動畫</th><th>骨骼</th><th>原延遲（幀）</th><th>精簡後延遲</th><th>轉折最大位移（幀）</th><th>原轉折（幀）</th></tr></thead><tbody>${follow(r)}</tbody></table></div>
<h3>回退與說明</h3><ul>${r.report.animations.flatMap((a) => [...a.fallbacks, ...a.notes].map((x) => `<li>${esc(a.name)}：${esc(x)}</li>`)).join("") || "<li>無回退</li>"}</ul>
<h3>每條通道</h3>${timelineTable(r)}`,
  )
  .join("")}
<h2>Spine 編輯器對原始檔的往返（參考）</h2>
<div class="wrap"><table><thead><tr><th>動畫</th><th>最大 px</th><th>RMS</th><th>離散不符</th></tr></thead><tbody>${
    summary.sourceRoundTrip
      ?.map(
        (d) =>
          `<tr><td>${esc(d.animation)}</td><td>${d.max}</td><td>${d.rms}</td><td>${d.stateMismatches}</td></tr>`,
      )
      .join("") ?? `<tr><td colspan="4">未執行</td></tr>`
  }</tbody></table></div>
<h2>Key 分佈（灰：原始，藍：${MODE_NAMES.fidelity}，橘：${MODE_NAMES.posable}；只列會動的通道）</h2>
${anims.map((a) => `<details><summary>${esc(a.name)}</summary>${dopeSheet(source, runs, a.name, f.fps)}</details>`).join("")}
<h2>預覽</h2><p>${summary.preview ? `<a href="preview.mp4">preview.mp4</a>：原始｜${runs.map((r) => MODE_NAMES[r.mode]).join("｜")}，每段動畫依序播放網格、骨架、動態。` : "未產生"}</p>
<h2>未執行或無法宣稱通過的檢查</h2><ul>${notRun.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
</main></body></html>
`;
}
function reportMarkdown(summary: Summary, runs: Run[]): string {
  const lines = [
    `# Key 精簡報告：${basename(summary.input)}`,
    "",
    `- 來源 SHA-256 \`${summary.sha256}\`（執行前後相同）`,
    `- Spine ${summary.features.spine}，${summary.features.fps} FPS，正式匯入匯出：${summary.spine ?? "未執行"}`,
    "",
  ];
  for (const r of runs) {
    lines.push(
      `## ${MODE_NAMES[r.mode]}（${r.mode}）：${r.report.keys.before} → ${r.report.keys.after}（${r.report.pass ? "通過" : "未通過"}）`,
      "",
      `最大誤差 ≤ ${r.report.limits.maxError} px，RMS ≤ ${r.report.limits.rmsError} px`,
      "",
      "| 動畫 | 前 | 後 | 常數通道刪除 | 動作通道刪除 | 最大 px | RMS px | 最差 | 補 Key | 回退 | 正式輸出對精簡 max | 結果 |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...r.report.animations.map((a, i) => {
        const formal = r.formal?.vsReduced[i];
        return `| ${a.name} | ${a.keys.before} | ${a.keys.after} | ${a.keys.removedConstant} | ${a.keys.removedMotion} | ${a.world.max} | ${a.world.rms} | f${a.world.worstFrame} ${a.world.worstSlot ?? ""} | ${a.insertions.length} | ${a.fallbacks.length} | ${formal ? formal.max : "—"} | ${a.pass ? "通過" : "未通過"} |`;
      }),
      "",
    );
  }
  if (summary.notes.length) lines.push("## 備註", "", ...summary.notes.map((n) => `- ${n}`), "");
  return lines.join("\n");
}
