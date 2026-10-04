// Verify exactly the staged publication snapshot, not unrelated local diagnostics.
// No uploads, Git mutation, network dependency downloads, or destructive cleanup.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { format, resolveConfig } from "prettier";
import process from "node:process";
import console from "node:console";

const [destination] = process.argv.slice(2);
if (!destination || process.argv.length !== 3)
  throw new Error("Usage: verify-index.mjs <new-report.json>");
const index = spawnSync("git", ["ls-files", "--stage"], { encoding: "utf8" });
if (index.status !== 0) throw new Error("Cannot read publication index");
const directory = await mkdtemp(resolve("docs/local-reviews/gate-17-clean-"));
const exported = spawnSync(
  "git",
  ["checkout-index", "--all", "--prefix=" + directory.replaceAll("\\", "/") + "/"],
  { encoding: "utf8" },
);
if (exported.status !== 0) throw new Error("Cannot export index without modifying it");
const checks = [];
const commands = [
  [
    "offline-install",
    [
      "node_modules/npm/bin/npm-cli.js",
      "ci",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
    ],
  ],
  ["format", ["node_modules/prettier/bin/prettier.cjs", "--check", "."]],
  ["lint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["types", ["node_modules/typescript/bin/tsc", "-b"]],
  ["test-types", ["node_modules/typescript/bin/tsc", "-p", "tests/tsconfig.json", "--noEmit"]],
  ["tests", ["node_modules/vitest/vitest.mjs", "run", "--pool=threads"]],
  ["node-tests", ["tools/run-node-tests.mjs"]],
];
// npm is the existing host executable, not an undeclared copied dependency.
const npm =
  process.env.npm_execpath || resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js");
for (const [name, args] of commands) {
  const run = spawnSync(
    process.execPath,
    name === "offline-install" ? [npm, ...args.slice(1)] : args,
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (run.error) throw run.error;
  const output = stripVTControlCharacters(run.stdout + run.stderr);
  const entry = {
    name,
    exitCode: run.status,
    passed: run.status === 0,
    outputHash: createHash("sha256").update(output).digest("hex"),
    ...(name === "tests"
      ? {
          passedTests: Number(/Tests\s+(\d+) passed/.exec(output)?.[1] ?? 0),
          skippedTests: Number(/(\d+) skipped/.exec(output)?.[1] ?? 0),
        }
      : name === "node-tests"
        ? {
            passedTests: Number(/pass (\d+)/.exec(output)?.[1] ?? 0),
            skippedTests: Number(/skipped (\d+)/.exec(output)?.[1] ?? 0),
          }
        : {}),
  };
  checks.push(entry);
  console.log(JSON.stringify(entry));
  if (!entry.passed) {
    console.error(output);
    break;
  }
}
const after = spawnSync("git", ["ls-files", "--stage"], { encoding: "utf8" });
const unchanged = after.status === 0 && after.stdout === index.stdout;
const report = {
  date: "2026-10-05",
  purpose: "exact-staged-source-publication-verification",
  directory,
  indexSha256: createHash("sha256").update(index.stdout).digest("hex"),
  indexUnchanged: unchanged,
  result:
    unchanged && checks.length === commands.length && checks.every((c) => c.passed)
      ? "PASSED"
      : "FAILED",
  checks,
  privateArtworkCopied: false,
  dependenciesDownloaded: false,
  scope:
    "Index export, independent offline npm ci and full portable suite; no unpublished local diagnostics, live AI, artist corpus or editor GUI",
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [
        "package-lock.json",
        "packages/mcp/src/index.ts",
        "packages/planning/src/planner.ts",
        "skills/autospine/SKILL.md",
        "tests/gate17-skill.test.ts",
      ].map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(resolve(directory, path)))
          .digest("hex"),
      ]),
    ),
  ),
};
await writeFile(
  resolve(destination),
  await format(JSON.stringify(report), { ...(await resolveConfig(destination)), parser: "json" }),
  { flag: "wx" },
);
if (report.result !== "PASSED") process.exitCode = 1;
