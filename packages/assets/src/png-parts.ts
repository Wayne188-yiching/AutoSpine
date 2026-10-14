import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { PNG } from "pngjs";
import type { AssetPart, AssetSpec } from "@autospine/schemas";
import { alphaPivot, encodeAlphaMask } from "./alpha-mask.js";
import { acceptAsset, failAsset } from "./validation.js";

const GroupSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    parentId: Type.Optional(Type.String({ minLength: 1 })),
    visible: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const ManifestPartSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    file: Type.String({ minLength: 1 }),
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    height: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    pivotCandidate: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
    parentId: Type.Optional(Type.String({ minLength: 1 })),
    drawOrder: Type.Integer({ minimum: 0 }),
    visible: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
/**
 * The PNG up to the end of its IEND chunk. Some image tools append bytes after IEND (seen on the
 * GoldTree artist images, 8.7 KB); decoders such as pngjs reject them, editors ignore them.
 */
export function pngThroughIend(bytes: Buffer): Buffer {
  let o = 8;
  while (o + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(o),
      type = bytes.toString("ascii", o + 4, o + 8);
    o += 12 + len;
    if (type === "IEND") return o < bytes.length ? bytes.subarray(0, o) : bytes;
  }
  return bytes;
}
export const PngPartsManifestSchema = Type.Object(
  {
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
    groups: Type.Optional(Type.Array(GroupSchema)),
    parts: Type.Array(ManifestPartSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type PngPartsManifest = Static<typeof PngPartsManifestSchema>;

export interface PngPartsOptions {
  id: string;
  name: string;
  sourcePath?: string;
  manifest?: PngPartsManifest;
}

async function readPngInside(
  directory: string,
  file: string,
): Promise<{
  file: string;
  width: number;
  height: number;
  alpha: Uint8Array;
}> {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized))
    failAsset("PATH_ESCAPE", "PNG path must be relative to the parts directory", file);
  let root: string;
  try {
    root = await realpath(directory);
  } catch {
    failAsset("DIRECTORY_UNREADABLE", "PNG parts directory cannot be read", directory);
  }
  const candidate = resolve(root, normalized);
  const inside = (path: string) => {
    const subpath = relative(root, path);
    return (
      subpath &&
      subpath !== ".." &&
      !subpath.startsWith(`..\\`) &&
      !subpath.startsWith("../") &&
      !isAbsolute(subpath)
    );
  };
  if (!inside(candidate)) failAsset("PATH_ESCAPE", "PNG path escapes the parts directory", file);
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    failAsset("PNG_MISSING", "Referenced PNG does not exist", file);
  }
  if (!inside(actual)) failAsset("PATH_ESCAPE", "PNG symlink escapes the parts directory", file);
  let bytes: Buffer;
  try {
    bytes = await readFile(actual);
  } catch {
    failAsset("PNG_UNREADABLE", "Referenced PNG cannot be read", file);
  }
  if (bytes.length > 32 * 1024 * 1024)
    failAsset("PNG_TOO_LARGE", "PNG exceeds the 32 MiB input limit", file);
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 26 || bytes.subarray(0, 8).toString("hex") !== signature)
    failAsset("PNG_INVALID", "Invalid PNG signature or header", file);
  if (bytes[24] !== 8)
    failAsset("PNG_BIT_DEPTH", "Gate 2 requires 8-bit PNG alpha for exact mask preservation", file);
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 25_000_000)
    failAsset("PNG_DIMENSIONS", "PNG dimensions exceed Gate 2 limits", file);
  let image: PNG;
  try {
    image = PNG.sync.read(pngThroughIend(bytes), { checkCRC: true });
  } catch {
    failAsset("PNG_INVALID", "PNG could not be decoded", file);
  }
  if (image.width !== width || image.height !== height || image.data.length !== width * height * 4)
    failAsset("PNG_INVALID", "PNG pixel data size does not match its header", file);
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = image.data[index * 4 + 3]!;
  return { file: normalized, width, height, alpha };
}

export async function parsePngParts(
  directory: string,
  options: PngPartsOptions,
): Promise<AssetSpec> {
  if (options.manifest && !Value.Check(PngPartsManifestSchema, options.manifest))
    failAsset("MANIFEST_SCHEMA", "PNG parts manifest shape is invalid");
  const manifest = options.manifest;
  let entries: PngPartsManifest["parts"];
  if (manifest) entries = manifest.parts;
  else {
    let names: string[];
    try {
      names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".png")
        .map((entry) => entry.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } catch {
      failAsset("DIRECTORY_UNREADABLE", "PNG parts directory cannot be read", directory);
    }
    if (!names.length) failAsset("NO_PNG", "PNG parts directory has no top-level PNG files");
    entries = names.map((file, drawOrder) => ({
      id: file.slice(0, -4),
      name: file.slice(0, -4),
      file,
      x: 0,
      y: 0,
      drawOrder,
    }));
  }
  const parts: AssetPart[] = [];
  let autoWidth = 0,
    autoHeight = 0;
  for (const entry of entries) {
    const image = await readPngInside(directory, entry.file);
    autoWidth = Math.max(autoWidth, image.width);
    autoHeight = Math.max(autoHeight, image.height);
    const bounds = {
      x: entry.x,
      y: entry.y,
      width: entry.width ?? image.width,
      height: entry.height ?? image.height,
    };
    const pivotCandidate =
      entry.pivotCandidate ?? alphaPivot(image.alpha, image.width, image.height, bounds);
    if (!pivotCandidate) failAsset("EMPTY_ALPHA", "PNG has no visible pixels", entry.file);
    parts.push({
      id: entry.id,
      name: entry.name,
      sourcePath: image.file,
      bounds,
      pivotCandidate,
      drawOrder: entry.drawOrder,
      ...(entry.parentId ? { parentId: entry.parentId } : {}),
      ...(entry.visible !== undefined ? { visible: entry.visible } : {}),
      alphaMask: encodeAlphaMask(image.width, image.height, image.alpha),
    });
  }
  parts.sort((a, b) => a.drawOrder - b.drawOrder);
  const asset: AssetSpec = {
    schemaVersion: "0.1",
    kind: "asset",
    id: options.id,
    name: options.name,
    source: { type: "png-parts", path: options.sourcePath ?? basename(resolve(directory)) },
    width: manifest?.width ?? autoWidth,
    height: manifest?.height ?? autoHeight,
    ...(manifest?.groups ? { groups: manifest.groups } : {}),
    parts,
  };
  return acceptAsset(asset);
}
