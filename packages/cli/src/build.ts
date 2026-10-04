import { access, mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { BuildJobSchema, type BuildManifest } from "@autospine/schemas";
import { parsePngParts } from "@autospine/assets";
import { buildChainWave } from "@autospine/pipeline";
import { compileWeightedSpine40 } from "@autospine/spine";
import { failStage } from "@autospine/rig";
import { previewHtml } from "./preview.js";

async function assertAbsent(path: string) {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  failStage("build", "BUILD_OUTPUT_EXISTS", "Output already exists; choose a new directory");
}
export async function buildJobFile(jobPath: string): Promise<string> {
  const jobFile = resolve(jobPath);
  let unknownJob: unknown;
  try {
    unknownJob = JSON.parse(await readFile(jobFile, "utf8"));
  } catch {
    failStage("build", "BUILD_JOB_READ", "Job must be readable valid JSON");
  }
  if (!Value.Check(BuildJobSchema, unknownJob))
    failStage("build", "BUILD_JOB_SCHEMA", "Invalid chain-wave BuildJob");
  const job = unknownJob,
    source = resolve(dirname(jobFile), job.source),
    output = resolve(dirname(jobFile), job.output);
  for (const input of [source, jobFile]) {
    const subpath = relative(output, input);
    if (
      subpath === "" ||
      (!subpath.startsWith("..\\") &&
        !subpath.startsWith("../") &&
        subpath !== ".." &&
        !isAbsolute(subpath))
    )
      failStage("build", "BUILD_INPUT_OVERWRITE", "Output cannot contain or replace input files");
  }
  await assertAbsent(output);
  if ((await stat(source)).size > 32 * 1024 * 1024)
    failStage("asset", "BUILD_PNG_SIZE", "PNG exceeds the 32 MiB input limit");
  const bytes = await readFile(source);
  if (bytes.length < 26 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    failStage("asset", "BUILD_PNG", "Valid PNG header required");
  const asset = await parsePngParts(dirname(source), {
    id: job.id + "-asset",
    name: job.name,
    sourcePath: basename(source),
    manifest: {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      parts: [
        { id: job.id + "-part", name: job.name, file: basename(source), x: 0, y: 0, drawOrder: 0 },
      ],
    },
  });
  if (!(await readFile(source)).equals(bytes))
    failStage(
      "build",
      "BUILD_SOURCE_CHANGED",
      "PNG changed while being parsed; rebuild from a stable input",
    );
  const result = buildChainWave(asset, job),
    document = compileWeightedSpine40({ ...result, imagesPath: "./images/" });
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(resolve(dirname(output), ".autospine-build-"));
  const files: Record<string, unknown> = {
    "asset.json": asset,
    "mesh.json": result.mesh,
    "rig.json": result.rig,
    "weights.json": result.weights,
    "animation.json": result.animation,
    "skeleton.json": document,
    "diagnostics.json": result.diagnostics,
  };
  const reference = (id: string) => ({ id, schemaVersion: "0.1" as const });
  const manifest: BuildManifest = {
    schemaVersion: "0.1",
    kind: "build-manifest",
    id: job.id,
    asset: reference(asset.id),
    mesh: reference(result.mesh.id),
    rig: reference(result.rig.id),
    weights: reference(result.weights.id),
    animation: reference(result.animation.id),
    outputs: [...Object.keys(files), "images/image.png", "preview.html", "manifest.json"],
  };
  files["manifest.json"] = manifest;
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(temporary, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
    });
  await mkdir(resolve(temporary, "images"));
  await writeFile(resolve(temporary, "images/image.png"), bytes, { flag: "wx" });
  await writeFile(
    resolve(temporary, "preview.html"),
    previewHtml(result, bytes.toString("base64")),
    { flag: "wx" },
  );
  // Keep failed staging folders recoverable; never delete existing source or output.
  await assertAbsent(output);
  await rename(temporary, output);
  return output;
}
