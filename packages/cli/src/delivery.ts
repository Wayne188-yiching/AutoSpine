import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import {
  DELIVERY_LIMITS,
  DELIVERY_TARGETS,
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
): Promise<DeliveryCheck & { input: string; exportDir?: string }> {
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
  if (opts.exportDir) {
    const rows = await checkExport(resolve(opts.exportDir), target, check.kind);
    check.rows.push(...rows);
    check.errors += rows.filter((r) => r.level === "error").length;
    check.warnings += rows.filter((r) => r.level === "warning").length;
    check.pass = check.errors === 0;
  }
  return {
    input: resolve(input),
    ...(opts.exportDir ? { exportDir: resolve(opts.exportDir) } : {}),
    ...check,
  };
}
