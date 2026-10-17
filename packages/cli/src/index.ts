#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { buildJobFile } from "./build.js";
import {
  buildCharacterFiles,
  compareReferenceFiles,
  compareVideoFiles,
  fitVideoFiles,
  deliverFiles,
  initProjectFolder,
  lintPlanFile,
  optimizeMotionFiles,
  reviewVideoFiles,
  fitPoseFiles,
  mergePlanFiles,
  stripImages,
} from "./character.js";
import {
  AssetParseError,
  decodeAlphaMask,
  parsePngParts,
  parsePsd,
  validateAssetSpec,
  type PngPartsManifest,
} from "@autospine/assets";
import {
  generateMeshWithDiagnostics,
  MeshError,
  prepareAlphaForMesh,
  type MeshGenerationOptions,
} from "@autospine/mesh";
import { ChainRigError, generateChainRig } from "@autospine/rig";

import {
  SpineCompileError,
  compileSpine40,
  validateSpine40,
  type MinimalSpineInput,
} from "@autospine/spine";

const usage =
  "Usage: autospine <compile-minimal|parse-png|parse-psd|mesh-png|mesh-asset|rig-chain> <input> <output.json> [manifest.json|part-id|cleanup-fraction] [cleanup-fraction] [--intent=rigid|chain|unknown] [--reference-profile=profile.json]";

async function writeMesh(
  part: Parameters<typeof generateMeshWithDiagnostics>[0],
  destination: string,
  cleanupArgument?: string,
  options: MeshGenerationOptions = {},
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
  const { mesh, diagnostics } = generateMeshWithDiagnostics(
    part,
    prepared?.alpha ?? decoded,
    options,
  );
  await writeFile(destination, `${JSON.stringify(mesh, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.error(JSON.stringify({ meshDiagnostics: diagnostics }));
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

const characterUsage = `Character commands (ADR-017):
  autospine strip-images <artist.json> <images-dir> <images-only.json>
  autospine lint-plan <plan.json>
  autospine build-character <plan.json> <new-output-dir> [--params=params.json]
  autospine compare-reference <plan.json> <build-dir> <artist.json> <new-output-dir>
  autospine optimize-motion <plan.json> <artist.json> <state-dir> [--budget=s] [--margin=n] [--seed=n]
  autospine review-video <plan.json> <build-dir> [<artist.json>] <new-video.mp4> [--loops=n] [--height=px] [--font=file]
  autospine fit-pose <plan.json> <build-dir> <reference.png> <new-pose.json> [--animation=name] [--ignore=slot,...] [--window=units] [--max-rotate=deg]
  autospine fit-pose <plan.json> <build-dir> <frame>=<picture.png>... <new-keyposes.json> [--animation=name] [--zero=frame] [--ease=name] [--min-coverage=0..1] [--ignore=slot,...] [--window=units] [--max-rotate=deg]
  autospine merge-plans <new-plan.json> <plan.json> <plan.json>... [--id=id] [--name=name]
  autospine init-project <project-dir>
  autospine compare-video <plan.json> <build-dir> <new-output-dir> [--animation=name] [--video=file] [--start=s] [--font=file]
  autospine fit-video <plan.json> <build-dir> <new-dir> [--animation=name] [--video=file] [--start=s] [--rounds=3] [--every=1] [--ignore=slot,...] [--no-zero] [--font=file]
  autospine deliver <plan.json> <build-dir> <delivery-dir> [<artist.json>] [--name=file] [--images=dir] [--spine=exe] [--replace] [--force] [--no-video] [--no-reference]`;
async function characterCommand(args: string[]): Promise<boolean> {
  const flags = new Map(
    args
      .filter((a) => a.startsWith("--"))
      .map((a) => [a.slice(2).split("=")[0]!, a.split("=").slice(1).join("=")]),
  );
  const p = args.filter((a) => !a.startsWith("--"));
  const numberFlag = (k: string) => {
    if (!flags.has(k)) return undefined;
    const v = Number(flags.get(k));
    if (!Number.isFinite(v)) throw new Error(`--${k} needs a number\n${characterUsage}`);
    return v;
  };
  const known = (...k: string[]) => {
    for (const f of flags.keys())
      if (!k.includes(f)) throw new Error(`Unknown flag --${f}\n${characterUsage}`);
  };
  switch (p[0]) {
    case "strip-images":
      if (p.length !== 4) throw new Error(characterUsage);
      known();
      console.log(JSON.stringify(await stripImages(p[1]!, p[2]!, p[3]!)));
      return true;
    case "lint-plan": {
      if (p.length !== 2) throw new Error(characterUsage);
      known();
      const lint = await lintPlanFile(p[1]!);
      console.log(JSON.stringify(lint, null, 1));
      if (lint.errors.length) process.exitCode = 2;
      return true;
    }
    case "build-character":
      if (p.length !== 3) throw new Error(characterUsage);
      known("params");
      console.log(
        JSON.stringify(await buildCharacterFiles(p[1]!, p[2]!, flags.get("params") || undefined)),
      );
      return true;
    case "compare-reference": {
      if (p.length !== 5) throw new Error(characterUsage);
      known();
      const check = await compareReferenceFiles(p[1]!, p[2]!, p[3]!, p[4]!);
      for (const r of check.rows)
        console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id}  ${JSON.stringify(r.value)}`);
      console.log(check.pass ? "ALL AUTOMATABLE CRITERIA PASS" : "NOT PASSED");
      if (!check.pass) process.exitCode = 2;
      return true;
    }
    case "optimize-motion": {
      if (p.length !== 4) throw new Error(characterUsage);
      known("budget", "margin", "seed", "trajectory-weight", "deform-weight", "band-shrink");
      const opts = {
        budgetSeconds: numberFlag("budget"),
        margin: numberFlag("margin"),
        seed: numberFlag("seed"),
        trajectoryWeight: numberFlag("trajectory-weight"),
        deformWeight: numberFlag("deform-weight"),
        bandShrink: numberFlag("band-shrink"),
      };
      const result = await optimizeMotionFiles(
        p[1]!,
        p[2]!,
        p[3]!,
        Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
      );
      console.log(JSON.stringify(result));
      // 0 passed, 3 paused (rerun to continue), 4 converged without passing.
      if (result.status === "paused") process.exitCode = 3;
      if (result.status === "stopped") process.exitCode = 4;
      return true;
    }
    case "review-video": {
      if (p.length !== 4 && p.length !== 5) throw new Error(characterUsage);
      known("loops", "height", "font");
      const opts = {
        loops: numberFlag("loops"),
        height: numberFlag("height"),
        font: flags.get("font"),
      };
      console.log(
        JSON.stringify(
          await reviewVideoFiles(
            p[1]!,
            p[2]!,
            p.length === 5 ? p[3]! : undefined,
            p.at(-1)!,
            Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
          ),
        ),
      );
      return true;
    }
    case "compare-video": {
      if (p.length !== 4) throw new Error(characterUsage);
      known("animation", "video", "start", "font");
      const opts = {
        animation: flags.get("animation") || undefined,
        video: flags.get("video") || undefined,
        start: numberFlag("start"),
        font: flags.get("font") || undefined,
      };
      const check = await compareVideoFiles(
        p[1]!,
        p[2]!,
        p[3]!,
        Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
      );
      for (const a of check.animations) {
        console.log(`${a.animation}: ${a.output}`);
        for (const r of a.rows)
          console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.id}  ${JSON.stringify(r.value)}`);
        for (const h of a.hints) console.log(`  - ${h}`);
      }
      console.log(check.pass ? "MATCHES THE REFERENCE VIDEO" : "NOT PASSED");
      if (!check.pass) process.exitCode = 2;
      return true;
    }
    case "fit-video": {
      if (p.length !== 4) throw new Error(characterUsage);
      known("animation", "video", "start", "rounds", "every", "ignore", "no-zero", "font");
      const opts = {
        animation: flags.get("animation") || undefined,
        video: flags.get("video") || undefined,
        start: numberFlag("start"),
        rounds: numberFlag("rounds"),
        every: numberFlag("every"),
        ignore: flags.get("ignore")?.split(",").filter(Boolean),
        zero: flags.has("no-zero") ? false : undefined,
        font: flags.get("font") || undefined,
      };
      let fit: Awaited<ReturnType<typeof fitVideoFiles>>;
      try {
        fit = await fitVideoFiles(p[1]!, p[2]!, p[3]!, {
          ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
          log: (line: string) => console.error(line),
        });
      } catch (e) {
        // Refused before fitting (ADR-036): the video cannot drive this build.
        if (e instanceof Error && e.message.startsWith("CLI_FIT_VIDEO")) {
          console.error(e.message);
          process.exitCode = 2;
          return true;
        }
        throw e;
      }
      for (const r of fit.rounds) {
        console.log(
          `round ${r.round}: penalty ${r.penalty}, ${r.keys.frames} key frames (${r.keys.perSecond}/s, ${r.keys.prior.category} ${r.keys.prior.perSecond}/s), ${r.seconds}s`,
        );
        for (const row of r.rows)
          console.log(`  ${row.ok ? "PASS" : "FAIL"} ${row.id}  ${JSON.stringify(row.value)}`);
      }
      for (const h of fit.hints) console.log(`  - ${h}`);
      console.log(`best: round ${fit.best.round} -> ${fit.best.dir}`);
      console.log(fit.pass ? "MATCHES THE REFERENCE VIDEO (reference-fitted)" : "NOT PASSED");
      if (!fit.pass) process.exitCode = 2;
      return true;
    }
    case "init-project":
      if (p.length !== 2) throw new Error(characterUsage);
      known();
      console.log(JSON.stringify(await initProjectFolder(p[1]!)));
      return true;
    case "deliver": {
      if (p.length !== 4 && p.length !== 5) throw new Error(characterUsage);
      known("name", "images", "spine", "replace", "force", "no-video", "no-reference");
      const opts = {
        name: flags.get("name") || undefined,
        images: flags.get("images") || undefined,
        spine: flags.get("spine") || undefined,
        replace: flags.has("replace"),
        force: flags.has("force"),
        video: !flags.has("no-video"),
        reference: !flags.has("no-reference"),
      };
      console.log(JSON.stringify(await deliverFiles(p[1]!, p[2]!, p[3]!, p[4], opts)));
      return true;
    }
    case "merge-plans": {
      if (p.length < 4) throw new Error(characterUsage);
      known("id", "name");
      const opts = { id: flags.get("id"), name: flags.get("name") };
      console.log(
        JSON.stringify(
          await mergePlanFiles(
            p[1]!,
            p.slice(2),
            Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
          ),
        ),
      );
      return true;
    }
    case "fit-pose": {
      if (p.length < 5) throw new Error(characterUsage);
      known("animation", "window", "max-rotate", "min-coverage", "ease", "ignore", "zero");
      // <frame>=<picture.png> pairs are key poses (ADR-033); one plain picture is the rest pose.
      const keyed = p.slice(3, -1).map((a) => /^(\d+)=(.+)$/.exec(a));
      if (keyed.some((m) => !m) && p.length !== 5) throw new Error(characterUsage);
      const references = keyed.every((m) => m)
        ? keyed.map((m) => ({ frame: Number(m![1]), path: m![2]! }))
        : p[3]!;
      const ease = flags.get("ease");
      const eases = ["linear", "hold", "ease", "sine", "out", "in", "drift"] as const;
      if (ease !== undefined && !eases.includes(ease as (typeof eases)[number]))
        throw new Error(`CLI_FLAG: --ease must be one of ${eases.join(", ")}`);
      const opts = {
        animation: flags.get("animation"),
        window: numberFlag("window"),
        maxRotate: numberFlag("max-rotate"),
        minCoverage: numberFlag("min-coverage"),
        ease: ease as (typeof eases)[number] | undefined,
        ignore: flags.get("ignore")?.split(",").filter(Boolean),
        zeroFrame: numberFlag("zero"),
      };
      console.log(
        JSON.stringify(
          await fitPoseFiles(
            p[1]!,
            p[2]!,
            references,
            p.at(-1)!,
            Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
          ),
        ),
      );
      return true;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "build" && args.length === 2) {
    console.log(await buildJobFile(args[1]!));
    return;
  }
  if (await characterCommand(args)) return;
  const intentFlags = args.filter((arg) => arg.startsWith("--intent="));
  const profileFlags = args.filter((arg) => arg.startsWith("--reference-profile="));
  const positional = args.filter(
    (arg) => !arg.startsWith("--intent=") && !arg.startsWith("--reference-profile="),
  );
  const [command, source, destination, manifestPath, extra] = positional;
  if (
    positional.length > 5 ||
    intentFlags.length > 1 ||
    profileFlags.length > 1 ||
    ((intentFlags.length || profileFlags.length) &&
      command !== "mesh-png" &&
      command !== "mesh-asset")
  )
    throw new Error(usage);
  const intent = intentFlags[0]?.slice("--intent=".length) ?? "unknown";
  if (intent !== "rigid" && intent !== "chain" && intent !== "unknown") throw new Error(usage);
  if (!source || !destination || resolve(source) === resolve(destination)) throw new Error(usage);
  const profilePath = profileFlags[0]?.slice("--reference-profile=".length);
  if (profilePath === "") throw new Error(usage);
  const meshOptions: MeshGenerationOptions = {
    intent,
    referenceTopology: profilePath
      ? (JSON.parse(
          await readFile(profilePath, "utf8"),
        ) as MeshGenerationOptions["referenceTopology"])
      : undefined,
  };
  if (command === "rig-chain" && !manifestPath && !extra) {
    const input = JSON.parse(await readFile(source, "utf8")) as unknown;
    const rig = generateChainRig(input);
    await writeFile(destination, `${JSON.stringify(rig, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return;
  }
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
    await writeMesh(asset.parts[0]!, destination, manifestPath, meshOptions);
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
    await writeMesh(part, destination, extra, meshOptions);
    return;
  }
  throw new Error(`${usage}\n${characterUsage}`);
}

main().catch((error: unknown) => {
  if (
    (error instanceof Error && "validation" in error) ||
    error instanceof SpineCompileError ||
    error instanceof AssetParseError ||
    error instanceof MeshError ||
    error instanceof ChainRigError
  )
    console.error(JSON.stringify(error.validation));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
