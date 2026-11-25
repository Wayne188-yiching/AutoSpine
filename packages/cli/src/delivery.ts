import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  DELIVERY_LIMITS,
  DELIVERY_TARGETS,
  SYMBOL_KINDS,
  attachmentImagePaths,
  checkDelivery,
  isTextOrNumber,
  type DeliveryCheck,
  type DeliveryKind,
  type DeliveryRow,
  type DeliveryTarget,
} from "@autospine/spine";
import { spineExecutable } from "./character.js";
import { exportProject } from "./keys.js";

export interface CheckDeliveryFileOptions {
  kind?: DeliveryKind;
  largeBoard?: boolean;
  /** The folder of the runtime export (.skel, .atlas and pages) to check as well. */
  exportDir?: string;
  /** Spine editor executable, for a .spine input. */
  spine?: string;
  /**
   * The item folder to check (F1-F5): folders, Photoshop files, images and delivery names.
   * Default the folder of a .spine input; false skips. Its `Export` folder is checked as the
   * runtime export when `exportDir` is not given.
   */
  folder?: string | false;
}

/** Width and height of a PNG or JPEG, from its header; null for anything else. */
async function imageSize(file: string): Promise<[number, number] | null> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(24);
    await handle.read(head, 0, 24, 0);
    if (head.readUInt32BE(0) === 0x89504e47) return [head.readUInt32BE(16), head.readUInt32BE(20)];
    if (head[0] !== 0xff || head[1] !== 0xd8) return null;
    // JPEG: walk the segments to the first start-of-frame (SOF0-SOF15 but DHT, JPG and DAC).
    let pos = 2;
    const seg = Buffer.alloc(9);
    for (;;) {
      const { bytesRead } = await handle.read(seg, 0, 9, pos);
      if (bytesRead < 4 || seg[0] !== 0xff) return null;
      const marker = seg[1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return bytesRead < 9 ? null : [seg.readUInt16BE(7), seg.readUInt16BE(5)];
      pos += 2 + seg.readUInt16BE(2);
    }
  } finally {
    await handle.close();
  }
}

const IMAGE = /\.(png|jpe?g)$/i;
const PREVIEW = /\.mp4$/i;

/** Delivery names by kind: [pattern, what it is]. */
const DELIVERY_NAMES: Partial<Record<DeliveryKind, [RegExp, string][]>> = {
  loading: [
    [/_Loading\.skel(\.bytes)?$/i, "<Game>_Loading.skel (binary export)"],
    [/_Loading_Bg\.jpe?g$/i, "<Game>_Loading_Bg.jpg (background)"],
    [/_Loading_Logo\.png$/i, "<Game>_Loading_Logo.png (logo)"],
    [/_影片\.mp4$/i, "<Game>_影片.mp4 (preview)"],
  ],
  icon: [
    [/^Icon_.+\.png$/, "Icon_<Game>.png (static image)"],
    [/^Spine_.+\.skel(\.bytes)?$/, "Spine_<Game>.skel (binary export)"],
    [/^影片_.+\.mp4$/, "影片_<Game>.mp4 (preview)"],
  ],
};

/**
 * F1-F5: the item folder around a skeleton. F1 folders and Photoshop files, F2 the images folder
 * (names, images no attachment draws), F3 even static symbol sizes, F4 loading background and
 * icon sizes, F5 delivery names. `skeletonDir` is the folder of the .spine (its Images, Previews
 * and Export are the skeleton's).
 */
async function checkFolder(
  folder: string,
  skeletonDir: string | undefined,
  doc: Record<string, unknown>,
  target: DeliveryTarget,
  kind: DeliveryKind,
): Promise<{ rows: DeliveryRow[]; exportDir?: string; exportImageBytes: number }> {
  const spec = DELIVERY_TARGETS[target];
  const rows: DeliveryRow[] = [];
  const error = (id: string, message: string) => rows.push({ id, level: "error", message });
  const warn = (id: string, message: string) => rows.push({ id, level: "warning", message });
  const files = (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
  const rel = (f: string) => relative(folder, f).split(sep).join("/") || ".";
  const parts = (f: string) => rel(f).toLowerCase().split("/");
  const child = async (dir: string, name: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }))
      if (e.isDirectory() && e.name.toLowerCase() === name.toLowerCase()) return join(dir, e.name);
    return undefined;
  };

  // F1: next to every .spine an Images, a Previews with an .mp4 and an Export folder; the .psd.
  const projects = files.filter((f) => extname(f).toLowerCase() === ".spine");
  if (!projects.length) warn("F1", "no .spine project in the folder (deliver the editor file)");
  for (const dir of new Set(projects.map(dirname)))
    for (const need of ["Images", "Previews", "Export"]) {
      const found = await child(dir, need);
      if (!found) error("F1", `${rel(dir)}: no ${need} folder`);
      else if (need === "Previews" && !(await readdir(found)).some((n) => PREVIEW.test(n)))
        error("F1", `${rel(found)}: no .mp4 preview`);
    }
  if (!files.some((f) => extname(f).toLowerCase() === ".psd"))
    warn("F1", "no .psd (the layered source of the parts)");
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (ext === ".psb") error("F1", `${rel(f)}: save as .psd, not .psb`);
    if (ext === ".psd" && (await stat(f)).size > 2 * 1024 ** 3)
      error("F1", `${rel(f)} is over 2 GB`);
  }

  // F2: the skeleton's images folder: names, and images no attachment draws.
  const dir = skeletonDir ?? (projects.length === 1 ? dirname(projects[0]!) : folder);
  const images = await child(dir, "Images");
  if (images) {
    const used = attachmentImagePaths(doc).map((p) => p.toLowerCase());
    const shared = projects.filter((p) => dirname(p) === dir).length > 1;
    if (shared)
      warn("F2", `${rel(images)} serves several .spine projects; unused images are not checked`);
    for (const f of files.filter((f) => IMAGE.test(f) && !relative(images, f).startsWith(".."))) {
      const stem = relative(images, f)
        .split(sep)
        .join("/")
        .replace(/\.[^.]+$/, "");
      // Reference images (a part starting with _) are not exported: E3 reports them if they are.
      if (stem.split("/").some((part) => part.startsWith("_"))) continue;
      if (!stem.split("/").every((part) => spec.names.test(part)))
        error(
          "F2",
          `image ${rel(f)}: only letters, digits and _${target === "cocos" ? "" : " or -"}`,
        );
      const s = stem.toLowerCase();
      const drawn = used.some((u) => s === u || s.endsWith(`/${u}`) || u.endsWith(`/${s}`));
      if (!shared && !drawn) warn("F2", `image ${rel(f)} is drawn by no attachment; delete it`);
    }
  }

  // F3, F4: image sizes outside the images folder (atlas pages excepted).
  const pages = new Set<string>();
  for (const f of files.filter((f) => /\.atlas(\.txt)?$/i.test(f)))
    for (const p of atlasPages(await readFile(f, "utf8"))) pages.add(p.file.toLowerCase());
  for (const f of files.filter((f) => IMAGE.test(f))) {
    const name = basename(f);
    // Not the parts (Images, layer exports in a PSD folder) and not atlas pages.
    const where = parts(f).slice(0, -1);
    if (where.includes("images") || where.some((p) => p.includes("psd"))) continue;
    if (pages.has(name.toLowerCase())) continue;
    const size = await imageSize(f);
    if (!size) continue;
    const [w, h] = size;
    if (SYMBOL_KINDS.includes(kind) && (w % 2 || h % 2))
      error("F3", `${rel(f)} is ${w}x${h}; static symbol sizes are even (the centre is size / 2)`);
    if (kind === "loading" && /_Loading_Bg\.jpe?g$/i.test(name)) {
      const ok = ["840x840", "840x360", "360x840"].includes(`${w}x${h}`);
      if (!ok)
        error(
          "F4",
          `${rel(f)} is ${w}x${h}; the background is 840x840 (the page rule) or 840x360 / 360x840 (the landscape / portrait template), shown at 2x`,
        );
    }
    if (kind === "icon" && /^Icon_.+\.png$/.test(name) && !(w === 200 && h === 400))
      error("F4", `${rel(f)} is ${w}x${h}; the static icon is 200x400`);
  }

  // F5: delivery names.
  const names = files.map((f) => basename(f));
  for (const [pattern, what] of DELIVERY_NAMES[kind] ?? [])
    if (!names.some((n) => pattern.test(n))) error("F5", `no ${what}`);

  const exportDir = await child(dir, "Export");
  let exportImageBytes = 0;
  for (const f of files)
    if (IMAGE.test(f) && parts(f).includes("export")) exportImageBytes += (await stat(f)).size;
  return { rows, ...(exportDir ? { exportDir } : {}), exportImageBytes };
}

/** An atlas's pages: file, size and region names (3.8 and 4.x layouts). */
function atlasPages(text: string) {
  const pages: { file: string; size: [number, number] | null; regions: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const s = line.trim();
    if (/\.(png|jpe?g|webp)$/i.test(s) && !s.includes(":"))
      pages.push({ file: s, size: null, regions: [] });
    else if (s.includes(":")) {
      const [key, value] = s.split(":");
      const page = pages.at(-1);
      if (key!.trim() === "size" && page && !page.size) {
        const [w, h] = value!.split(",").map(Number);
        page.size = [w!, h!];
      }
    } else pages.at(-1)?.regions.push(s);
  }
  return pages;
}

/** E1-E3: the runtime export's files, versions and atlas pages. */
async function checkExport(
  dir: string,
  target: DeliveryTarget,
  kind: DeliveryKind,
): Promise<DeliveryRow[]> {
  const spec = DELIVERY_TARGETS[target];
  const rows: DeliveryRow[] = [];
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
  const rel = (f: string) => relative(dir, f);
  const lower = (f: string) => f.toLowerCase();
  const skeletons = files.filter((f) => /\.skel(\.bytes)?$/i.test(f));
  const atlases = files.filter((f) => /\.atlas(\.txt)?$/i.test(f));
  if (!skeletons.length)
    rows.push({ id: "E1", level: "error", message: `no binary skeleton (${spec.skeleton})` });
  for (const f of skeletons) {
    if (!lower(f).endsWith(spec.skeleton) || (spec.skeleton === ".skel" && /\.bytes$/i.test(f)))
      rows.push({
        id: "E1",
        level: "error",
        message: `${rel(f)}: the ${target} runtime reads ${spec.skeleton}`,
      });
    const handle = await open(f, "r");
    const head = Buffer.alloc(80);
    await handle.read(head, 0, 80, 0);
    await handle.close();
    const version = /(\d\.\d+\.\d+)/.exec(head.toString("latin1"))?.[1];
    if (version !== spec.editor)
      rows.push({
        id: "E1",
        level: "error",
        message: `${rel(f)} was exported by Spine ${version ?? "?"}; the ${target} runtime reads ${spec.editor}`,
      });
  }
  for (const f of files)
    if (extname(f).toLowerCase() === ".json")
      rows.push({
        id: "E1",
        level: "warning",
        message: `${rel(f)}: the runtime gets the binary export, not JSON`,
      });
  const page = (DELIVERY_LIMITS as Record<string, readonly number[]>)[kind]?.[4];
  const pot = (n: number) => n > 0 && (n & (n - 1)) === 0;
  for (const f of atlases) {
    if (!lower(f).endsWith(spec.atlas) || (spec.atlas === ".atlas" && /\.txt$/i.test(f)))
      rows.push({
        id: "E2",
        level: "error",
        message: `${rel(f)}: the ${target} runtime reads ${spec.atlas}`,
      });
    for (const p of atlasPages(await readFile(f, "utf8"))) {
      const [w, h] = p.size ?? [0, 0];
      if (Math.max(w, h) > 2048)
        rows.push({
          id: "E2",
          level: "error",
          message: `${p.file} is ${w}x${h}; pages are 2048 at most`,
        });
      if (spec.squareAtlas && !(pot(w) && pot(h) && w === h))
        rows.push({
          id: "E2",
          level: "error",
          message: `${p.file} is ${w}x${h}; the ${target} runtime takes square power-of-two pages`,
        });
      if (page && Math.max(w, h) > page)
        rows.push({
          id: "E2",
          level: "warning",
          message: `${p.file} is ${w}x${h}; ${kind} pages are ${page} at most`,
        });
      for (const r of p.regions) {
        if (!r.split("/").every((part) => spec.names.test(part)))
          rows.push({
            id: "E3",
            level: "error",
            message: `image ${r}: only letters, digits and _`,
          });
        if (r.split("/").some((part) => part.startsWith("_")) && !isTextOrNumber(r))
          rows.push({
            id: "E3",
            level: "warning",
            message: `image ${r} starts with _ (a reference image?); turn its export off`,
          });
      }
    }
  }
  return rows;
}

/**
 * check-delivery <skeleton.json|project.spine> --target=...: the delivery conventions (ADR-053) for
 * one skeleton, and the runtime export folder when given. A .spine project is exported with the
 * target's editor version first; a project that version cannot open was made in a newer one.
 */
export async function checkDeliveryFiles(
  input: string,
  target: DeliveryTarget,
  opts: CheckDeliveryFileOptions = {},
): Promise<
  DeliveryCheck & { input: string; folder?: string; exportDir?: string; exportImageBytes?: number }
> {
  if (!(target in DELIVERY_TARGETS))
    throw new Error(
      `CLI_DELIVERY_TARGET: ${target}; use ${Object.keys(DELIVERY_TARGETS).join(", ")}`,
    );
  const spec = DELIVERY_TARGETS[target];
  let doc: Record<string, unknown>;
  let version: string | false | undefined;
  if (extname(input).toLowerCase() === ".spine") {
    const exe = spineExecutable(opts.spine);
    if (!exe)
      throw new Error(
        "CLI_SPINE: a .spine input needs the Spine editor (--spine=exe or AUTOSPINE_SPINE)",
      );
    // Exported with the target's editor; a project it cannot open is exported with the editor
    // that made it (named in the refusal), and V1 reports that version.
    const temp = await mkdtemp(join(tmpdir(), "autospine-check-"));
    try {
      let exported: { json: string };
      try {
        exported = await exportProject(exe, spec.editor, resolve(input), temp);
        version = false;
      } catch (e) {
        const made = /Project version: (\d+\.\d+\.\d+)/.exec((e as Error).message)?.[1];
        if (!made) throw e;
        exported = await exportProject(exe, made, resolve(input), join(temp, "made"));
        version = made;
      }
      doc = JSON.parse(await readFile(exported.json, "utf8")) as Record<string, unknown>;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  } else doc = JSON.parse(await readFile(input, "utf8")) as Record<string, unknown>;
  const check = checkDelivery(doc, target, {
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.largeBoard ? { largeBoard: true } : {}),
    ...(version !== undefined ? { version } : {}),
  });
  const isProject = extname(input).toLowerCase() === ".spine";
  const folder =
    opts.folder === false
      ? undefined
      : opts.folder
        ? resolve(opts.folder)
        : isProject
          ? dirname(resolve(input))
          : undefined;
  const add = (rows: DeliveryRow[]) => {
    check.rows.push(...rows);
    check.errors += rows.filter((r) => r.level === "error").length;
    check.warnings += rows.filter((r) => r.level === "warning").length;
    check.pass = check.errors === 0;
  };
  let exportDir = opts.exportDir ? resolve(opts.exportDir) : undefined;
  let exportImageBytes: number | undefined;
  if (folder) {
    const found = await checkFolder(
      folder,
      isProject ? dirname(resolve(input)) : undefined,
      doc,
      target,
      check.kind,
    );
    add(found.rows);
    exportDir ??= found.exportDir;
    exportImageBytes = found.exportImageBytes;
  }
  if (exportDir) add(await checkExport(exportDir, target, check.kind));
  return {
    input: resolve(input),
    ...(folder ? { folder } : {}),
    ...(exportDir ? { exportDir } : {}),
    ...(exportImageBytes !== undefined ? { exportImageBytes } : {}),
    ...check,
  };
}
