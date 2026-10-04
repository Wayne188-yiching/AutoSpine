// Local self-acceptance evidence; no uploads, credits or automatic Git writes.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { format } from "prettier";
import process from "node:process";
import console from "node:console";

const [gate, destination, ...tests] = process.argv.slice(2);
if (!/^\d+$/.test(gate ?? "") || !destination || !tests.length)
  throw new Error("Usage: verify-gate.mjs <gate> <new-report.json> <test-files...>");
const commands = [
  ["format", ["node_modules/prettier/bin/prettier.cjs", "--check", "."]],
  ["lint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["types", ["node_modules/typescript/bin/tsc", "-b"]],
  ["test-types", ["node_modules/typescript/bin/tsc", "-p", "tests/tsconfig.json", "--noEmit"]],
  ["tests", ["node_modules/vitest/vitest.mjs", "run", "--pool=threads", ...tests]],
];
const checks = [];
for (const [name, args] of commands) {
  const run = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (run.error) throw run.error;
  const output = stripVTControlCharacters(run.stdout + run.stderr);
  checks.push({
    name,
    exitCode: run.status,
    passed: run.status === 0,
    outputHash: createHash("sha256").update(output).digest("hex"),
    ...(name === "tests"
      ? { passedTests: Number(/Tests\s+(\d+) passed/.exec(output)?.[1] ?? 0) }
      : {}),
  });
  console.log(JSON.stringify(checks.at(-1)));
  if (run.status !== 0) {
    console.error(output);
    break;
  }
}
const changes = spawnSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "packages",
    "schemas",
    "tests",
    "tools",
    "fixtures",
  ],
  { encoding: "utf8" },
);
if (changes.status !== 0) throw new Error("Cannot enumerate source evidence");
const sources = {};
for (const file of [...new Set(changes.stdout.trim().split(/\r?\n/))]
  .filter((f) => /\.(ts|mjs|json)$/.test(f))
  .sort())
  sources[file] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const report = {
  schemaVersion: "1",
  gate: Number(gate),
  date: "2026-10-05",
  reviewer: "assistant-self-review",
  authority: "owner explicit Gate17/self-acceptance instruction",
  result:
    checks.length === commands.length && checks.every((c) => c.passed)
      ? "ENGINEERING_CHECKS_PASSED"
      : "FAILED",
  checks,
  tests,
  sources,
  jevCalled: false,
  artistQualityAccepted: false,
  liveAIModelEvaluated: false,
  limitations: [
    "Source manifest includes local unpublished diagnostics; publication is a separate explicit allowlist",
    "Passing checks requires an additional recorded scope/boundary review before Gate closure",
    "No account-quota reading or scheduled wakeup tool available",
  ],
};
await writeFile(resolve(destination), await format(JSON.stringify(report), { parser: "json" }), {
  flag: "wx",
});
if (report.result === "FAILED") process.exitCode = 1;
