#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { AssetParseError, parsePngParts, parsePsd, type PngPartsManifest } from "@autospine/assets";

import {
  SpineCompileError,
  compileSpine40,
  validateSpine40,
  type MinimalSpineInput,
} from "@autospine/spine";

async function main(): Promise<void> {
  const [command, source, destination, manifestPath, extra] = process.argv.slice(2);
  if (!source || !destination || extra || resolve(source) === resolve(destination))
    throw new Error(
      "Usage: autospine <compile-minimal|parse-png|parse-psd> <input> <output.json> [manifest.json]",
    );
  if (command === "compile-minimal" && !manifestPath) {
    const input = JSON.parse(await readFile(source, "utf8")) as MinimalSpineInput;
    const document = compileSpine40(input);
    const validation = validateSpine40(document);
    if (validation.status !== "passed") throw new SpineCompileError(validation);
    await writeFile(destination, `${JSON.stringify(document)}\n`, "utf8");
    return;
  }
  if (command === "parse-png") {
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
  if (command === "parse-psd" && !manifestPath) {
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
  throw new Error(
    "Usage: autospine <compile-minimal|parse-png|parse-psd> <input> <output.json> [manifest.json]",
  );
}

main().catch((error: unknown) => {
  if (error instanceof SpineCompileError || error instanceof AssetParseError)
    console.error(JSON.stringify(error.validation));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
