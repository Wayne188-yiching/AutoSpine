#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  SpineCompileError,
  compileSpine40,
  validateSpine40,
  type MinimalSpineInput,
} from "@autospine/spine";

async function main(): Promise<void> {
  const [command, source, destination, extra] = process.argv.slice(2);
  if (command !== "compile-minimal" || !source || !destination || extra) {
    throw new Error("Usage: autospine compile-minimal <input.json> <output.json>");
  }
  const input = JSON.parse(await readFile(source, "utf8")) as MinimalSpineInput;
  const document = compileSpine40(input);
  const validation = validateSpine40(document);
  if (validation.status !== "passed") throw new SpineCompileError(validation);
  await writeFile(destination, `${JSON.stringify(document)}\n`, "utf8");
}

main().catch((error: unknown) => {
  if (error instanceof SpineCompileError) console.error(JSON.stringify(error.validation));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
