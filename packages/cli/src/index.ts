#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import {
  AssetParseError,
  decodeAlphaMask,
  parsePngParts,
  parsePsd,
  validateAssetSpec,
  type PngPartsManifest,
} from "@autospine/assets";
import { generateMesh, MeshError, prepareAlphaForMesh } from "@autospine/mesh";

import {
  SpineCompileError,
  compileSpine40,
  validateSpine40,
  type MinimalSpineInput,
} from "@autospine/spine";

const usage =
  "Usage: autospine <compile-minimal|parse-png|parse-psd|mesh-png|mesh-asset> <input> <output.json> [manifest.json|part-id|cleanup-fraction] [cleanup-fraction]";

async function writeMesh(
  part: Parameters<typeof generateMesh>[0],
  destination: string,
  cleanupArgument?: string,
): Promise<void> {
  if (!part.alphaMask) throw new Error("Selected part has no alpha mask");
  const decoded = decodeAlphaMask(part.alphaMask);
  const fraction = cleanupArgument === undefined ? undefined : Number(cleanupArgument);
  if (fraction !== undefined && (!Number.isFinite(fraction) || fraction < 0 || fraction > 1))
    throw new Error("Cleanup fraction must be a number between zero and one");
  const prepared =
    fraction === undefined
      ? undefined
      : prepareAlphaForMesh(decoded, part.alphaMask.width, part.alphaMask.height, fraction);
  const mesh = generateMesh(part, prepared?.alpha ?? decoded);
  await writeFile(destination, `${JSON.stringify(mesh, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  if (prepared)
    console.error(
      JSON.stringify({
        cleanup: {
          componentCount: prepared.componentCount,
          discardedPixels: prepared.discardedPixels,
          pinchFilledPixels: prepared.pinchFilledPixels,
          holeFilledPixels: prepared.holeFilledPixels,
          holeCount: prepared.holeCount,
        },
      }),
    );
}

async function main(): Promise<void> {
  const [command, source, destination, manifestPath, extra] = process.argv.slice(2);
  if (!source || !destination || resolve(source) === resolve(destination)) throw new Error(usage);
  if (command === "compile-minimal" && !manifestPath) {
    const input = JSON.parse(await readFile(source, "utf8")) as MinimalSpineInput;
    const document = compileSpine40(input);
    const validation = validateSpine40(document);
    if (validation.status !== "passed") throw new SpineCompileError(validation);
    await writeFile(destination, `${JSON.stringify(document)}\n`, "utf8");
    return;
  }
  if (command === "parse-png" && !extra) {
    if (manifestPath && resolve(manifestPath) === resolve(destination))
      throw new Error("Output path must not overwrite the input manifest");
    const manifest = manifestPath
      ? (JSON.parse(await readFile(manifestPath, "utf8")) as PngPartsManifest)
      : undefined;
    const name = basename(resolve(source));
    const asset = await parsePngParts(source, { id: name, name, manifest });
    await writeFile(destination, `${JSON.stringify(asset, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return;
  }
  if (command === "parse-psd" && !manifestPath && !extra) {
    const name = basename(source, extname(source));
    const asset = parsePsd(await readFile(source), {
      id: name,
      name,
      sourcePath: basename(source),
    });
    await writeFile(destination, `${JSON.stringify(asset, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return;
  }
  if (command === "mesh-png" && !extra) {
    const name = basename(source, extname(source));
    const header = await readFile(source);
    if (header.length < 24) throw new Error("Input PNG header is incomplete");
    const asset = await parsePngParts(dirname(source), {
      id: name,
      name,
      sourcePath: basename(source),
      manifest: {
        width: header.readUInt32BE(16),
        height: header.readUInt32BE(20),
        parts: [{ id: name, name, file: basename(source), x: 0, y: 0, drawOrder: 0 }],
      },
    });
    await writeMesh(asset.parts[0]!, destination, manifestPath);
    return;
  }
  if (command === "mesh-asset" && manifestPath) {
    const asset = JSON.parse(await readFile(source, "utf8")) as unknown;
    const validation = validateAssetSpec(asset);
    if (validation.status === "error") throw new AssetParseError(validation);
    const part = (asset as Awaited<ReturnType<typeof parsePngParts>>).parts.find(
      (candidate) => candidate.id === manifestPath,
    );
    if (!part) throw new Error(`AssetSpec has no part '${manifestPath}'`);
    await writeMesh(part, destination, extra);
    return;
  }
  throw new Error(usage);
}

main().catch((error: unknown) => {
  if (
    error instanceof SpineCompileError ||
    error instanceof AssetParseError ||
    error instanceof MeshError
  )
    console.error(JSON.stringify(error.validation));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
