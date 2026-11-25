#!/usr/bin/env node
// Hands one read-only review to the OpenAI Codex CLI and prints Codex's final message (ADR-055).
// Written by hand; tools/build-plugin.mjs does not touch this folder.
//
// Usage:
//   node codex-review.mjs --cd=<folder> [--model=<id>] [--effort=<level>] [--image=<file>]...
//                         [--timeout=<seconds>] < prompt.txt
//   node codex-review.mjs --find      print the Codex CLI it would use, exit 3 when there is none
//
// The prompt comes on stdin. Codex runs with a read-only sandbox, without saving the session
// (--ephemeral), in <folder>. --model and --effort default to AUTOSPINE_CODEX_MODEL and
// AUTOSPINE_CODEX_EFFORT, then to the user's own Codex config.
// Exit: 0 reviewed, 1 bad arguments, 3 no Codex CLI found, 4 Codex failed or timed out.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];

/**
 * The Codex CLI to run: AUTOSPINE_CODEX, then `codex` on PATH, then (Windows) the newest
 * codex.exe the Codex desktop app keeps under %LOCALAPPDATA%\OpenAI\Codex\bin\<build>\.
 * Returns null when there is none.
 */
export function findCodex({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  listDirs = (dir) => readdirSync(dir),
  mtime = (file) => statSync(file).mtimeMs,
} = {}) {
  const set = env.AUTOSPINE_CODEX?.trim();
  if (set) return exists(set) ? resolve(set) : null;
  const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean))
    for (const name of names) if (exists(join(dir, name))) return join(dir, name);
  if (platform === "win32" && env.LOCALAPPDATA) {
    const bin = join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    let builds;
    try {
      builds = listDirs(bin);
    } catch {
      return null;
    }
    const found = builds.map((b) => join(bin, b, "codex.exe")).filter((f) => exists(f));
    found.sort((a, b) => mtime(b) - mtime(a));
    return found[0] ?? null;
  }
  return null;
}

/** Parses the command line; throws an Error with a message for bad arguments. */
export function parseArgs(argv, env = process.env) {
  const opts = { find: false, cd: "", model: "", effort: "", images: [], timeout: 600 };
  for (const arg of argv) {
    const [key, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (key === "--find") opts.find = true;
    else if (key === "--cd") opts.cd = value;
    else if (key === "--model") opts.model = value;
    else if (key === "--effort") opts.effort = value;
    else if (key === "--image") opts.images.push(value);
    else if (key === "--timeout") opts.timeout = Number(value);
    else throw new Error(`unknown argument ${arg}`);
  }
  opts.model ||= env.AUTOSPINE_CODEX_MODEL?.trim() ?? "";
  opts.effort ||= env.AUTOSPINE_CODEX_EFFORT?.trim() ?? "";
  if (opts.find) return opts;
  if (!opts.cd) throw new Error("--cd=<folder> is required");
  if (opts.effort && !EFFORTS.includes(opts.effort))
    throw new Error(`--effort must be one of ${EFFORTS.join(", ")}`);
  if (!(opts.timeout > 0)) throw new Error("--timeout must be a positive number of seconds");
  return opts;
}

/** Arguments for `codex exec`: read-only, not saved, the prompt read from stdin. */
export function codexArgs(opts, lastMessageFile) {
  const args = ["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check"];
  args.push("--color", "never", "--cd", opts.cd, "--output-last-message", lastMessageFile);
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--config", `model_reasoning_effort=${opts.effort}`);
  for (const image of opts.images) args.push("--image", image);
  args.push("-");
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`codex-review: ${error.message}\n`);
    return 1;
  }
  const codex = findCodex();
  if (!codex) {
    process.stderr.write(
      "codex-review: no Codex CLI found (set AUTOSPINE_CODEX, put codex on PATH, or install the Codex app)\n",
    );
    return 3;
  }
  if (opts.find) {
    process.stdout.write(`${codex}\n`);
    return 0;
  }
  for (const path of [opts.cd, ...opts.images])
    if (!existsSync(path)) {
      process.stderr.write(`codex-review: ${path} does not exist\n`);
      return 1;
    }
  const prompt = await readStdin();
  if (!prompt.trim()) {
    process.stderr.write("codex-review: the prompt on stdin is empty\n");
    return 1;
  }
  const dir = await mkdtemp(join(tmpdir(), "autospine-codex-"));
  const lastMessage = join(dir, "last-message.md");
  try {
    const shell = /\.(cmd|bat)$/i.test(codex);
    const args = codexArgs(opts, lastMessage);
    const child = spawn(
      shell ? `"${codex}"` : codex,
      shell ? args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)) : args,
      { shell, stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill(), opts.timeout * 1000);
    const code = await new Promise((done) => {
      child.on("error", () => done(-1));
      child.on("close", (c) => done(c));
    });
    clearTimeout(timer);
    const text = await readFile(lastMessage, "utf8").catch(() => "");
    if (code !== 0 || !text.trim()) {
      const tail = stderr.trim().split("\n").slice(-20).join("\n");
      process.stderr.write(`codex-review: Codex exited with ${code}\n${tail}\n`);
      return 4;
    }
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main();
