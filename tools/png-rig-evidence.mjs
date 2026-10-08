// Local PNG-only evidence. The child cannot read sibling references or write files.
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";
import { PNG } from "pngjs";
import { analyzeImageRegions } from "../packages/rig/dist/image-regions.js";
import { analyzeImageConnections } from "../packages/rig/dist/image-connections.js";
import { analyzeImagePath } from "../packages/rig/dist/image-path.js";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
export function runPngEvidence(path) {
  return runWorker(path, "--worker");
}
export function runPngConnectionEvidence(path) {
  return runWorker(path, "--connection-worker");
}
export function runPngPathEvidence(path) {
  return runWorker(path, "--path-worker");
}
function runWorker(path, mode) {
  const pngPath = realpathSync(path);
  const readable = [
    script,
    resolve(root, "package.json"),
    resolve(root, "packages/rig/package.json"),
    resolve(root, "packages/rig/dist/image-regions.js"),
    resolve(root, "packages/rig/dist/image-connections.js"),
    resolve(root, "packages/rig/dist/image-path.js"),
    resolve(root, "node_modules/pngjs"),
    pngPath,
  ];
  const result = spawnSync(
    process.execPath,
    ["--permission", ...readable.map((p) => `--allow-fs-read=${p}`), script, mode, pngPath],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PNG_EVIDENCE_FAILED: ${result.stderr.slice(-2000)}`);
  return JSON.parse(result.stdout);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (["--worker", "--connection-worker", "--path-worker"].includes(args[0])) {
    if (args.length !== 2 || !process.permission)
      throw new Error("PNG evidence worker requires explicit filesystem permissions");
    if (statSync(args[1]).size > 64 * 1024 * 1024) throw new Error("PNG file budget exceeded");
    const bytes = readFileSync(args[1]);
    // Check dimensions before PNG decode can allocate an unbounded raster.
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(signature) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(8) !== 13
    )
      throw new Error("PNG header required");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 4_000_000)
      throw new Error("PNG pixel budget exceeded");
    const png = PNG.sync.read(bytes);
    const input = { width: png.width, height: png.height, rgba: png.data };
    const evidence =
      args[0] === "--worker"
        ? analyzeImageRegions(input)
        : args[0] === "--connection-worker"
          ? analyzeImageConnections(input)
          : analyzeImagePath(input);
    console.log(
      JSON.stringify({
        pngSha256: createHash("sha256").update(bytes).digest("hex"),
        input: "PNG pixels only; no names, manual bones, mesh or evaluation scores",
        fileReadBoundary: "Node permission allowlist for code and this PNG only",
        ...evidence,
      }),
    );
  } else {
    if (args.length < 1 || args.length > 2)
      throw new Error("Usage: node tools/png-rig-evidence.mjs image.png [NEW_evidence.json]");
    const evidence = runPngEvidence(args[0]);
    const output = JSON.stringify(evidence, null, 2) + "\n";
    if (args[1]) writeFileSync(args[1], output, { flag: "wx" });
    else console.log(output);
  }
}
